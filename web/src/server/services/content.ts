import { and, desc, eq, sql } from "drizzle-orm";
import { ensureBlockIds, extractPageLinks, extractText, isDoc, sanitizeDoc, type Doc } from "@/lib/doc";
import { db } from "../db";
import { pageContent, pages, pageVersions, user } from "../db/schema";
import { badRequest, conflict, notFound } from "../errors";
import { recordActivity } from "./audit";
import { refreshLinks } from "./pages";
import { Access, requirePage } from "./permissions";

const SNAPSHOT_INTERVAL_MS = 10 * 60 * 1000;
const MAX_VERSIONS_PER_PAGE = 100;
const MAX_DOC_BYTES = 5 * 1024 * 1024;

export async function getContent(userId: string, pageId: string) {
  const { page, level } = await requirePage(userId, pageId, Access.view);
  const [c] = await db
    .select({ doc: pageContent.doc, version: pageContent.version, updatedAt: pageContent.updatedAt, updatedByName: user.name })
    .from(pageContent)
    .leftJoin(user, eq(user.id, pageContent.updatedBy))
    .where(eq(pageContent.pageId, pageId));
  if (!c) throw notFound("Page content not found");
  return { page, level, ...c };
}

/** Lightweight check used by open editors to notice someone else's save. */
export async function getContentVersion(userId: string, pageId: string) {
  await requirePage(userId, pageId, Access.view);
  const [c] = await db
    .select({ version: pageContent.version, updatedAt: pageContent.updatedAt, updatedBy: pageContent.updatedBy, updatedByName: user.name })
    .from(pageContent)
    .leftJoin(user, eq(user.id, pageContent.updatedBy))
    .where(eq(pageContent.pageId, pageId));
  return c ?? null;
}

export type SaveResult = { version: number; updatedAt: Date };

/**
 * Saves a document with optimistic concurrency. `baseVersion` is the version the
 * client started editing from. If someone else saved in the meantime, a 409 is
 * returned with the server copy. With `force`, the newer server copy is first
 * preserved in version history and then replaced, so nothing is silently lost.
 */
export async function saveContent(
  userId: string,
  pageId: string,
  input: { doc: unknown; baseVersion: number; force?: boolean },
): Promise<SaveResult> {
  if (!isDoc(input.doc)) throw badRequest("Invalid document");
  if (JSON.stringify(input.doc).length > MAX_DOC_BYTES) throw badRequest("Document is too large (5 MB limit)");
  const doc = ensureBlockIds(sanitizeDoc(input.doc));
  const text = extractText(doc);

  return db.transaction(async (tx) => {
    const { page } = await requirePage(userId, pageId, Access.edit, {}, tx);
    const [current] = await tx.select().from(pageContent).where(eq(pageContent.pageId, pageId)).for("update");
    if (!current) throw notFound("Page content not found");

    if (current.version !== input.baseVersion) {
      if (!input.force) {
        const [by] = current.updatedBy ? await tx.select({ name: user.name }).from(user).where(eq(user.id, current.updatedBy)) : [];
        throw conflict("This page was changed by someone else since you opened it", {
          serverVersion: current.version,
          serverDoc: current.doc,
          updatedAt: current.updatedAt,
          updatedByName: by?.name ?? null,
        });
      }
      await tx.insert(pageVersions).values({
        pageId,
        version: current.version,
        title: page.title,
        doc: current.doc,
        reason: "overwritten-in-conflict",
        createdBy: current.updatedBy,
      });
    }

    const now = new Date();
    const version = current.version + 1;
    await tx.update(pageContent).set({ doc, text, version, updatedBy: userId, updatedAt: now }).where(eq(pageContent.pageId, pageId));
    await tx.update(pages).set({ updatedAt: now, updatedBy: userId }).where(eq(pages.id, pageId));
    await refreshLinks(tx, pageId, extractPageLinks(doc));

    // Periodic snapshot: at most one every 10 minutes per editor.
    const [last] = await tx
      .select({ createdAt: pageVersions.createdAt, createdBy: pageVersions.createdBy })
      .from(pageVersions)
      .where(eq(pageVersions.pageId, pageId))
      .orderBy(desc(pageVersions.createdAt))
      .limit(1);
    if (!last || last.createdBy !== userId || now.getTime() - last.createdAt.getTime() > SNAPSHOT_INTERVAL_MS) {
      await tx.insert(pageVersions).values({ pageId, version, title: page.title, doc, reason: "autosave", createdBy: userId });
      await recordActivity({ workspaceId: page.workspaceId, pageId, actorId: userId, action: "page.edited" }, tx);
      await tx.execute(sql`
        delete from page_versions where page_id = ${pageId} and id not in (
          select id from page_versions where page_id = ${pageId} order by created_at desc limit ${MAX_VERSIONS_PER_PAGE}
        )`);
    }
    return { version, updatedAt: now };
  });
}

export async function listVersions(userId: string, pageId: string) {
  await requirePage(userId, pageId, Access.view);
  return db
    .select({ id: pageVersions.id, version: pageVersions.version, reason: pageVersions.reason, createdAt: pageVersions.createdAt, createdByName: user.name, title: pageVersions.title })
    .from(pageVersions)
    .leftJoin(user, eq(user.id, pageVersions.createdBy))
    .where(eq(pageVersions.pageId, pageId))
    .orderBy(desc(pageVersions.createdAt))
    .limit(MAX_VERSIONS_PER_PAGE);
}

export async function getVersion(userId: string, pageId: string, versionId: string) {
  await requirePage(userId, pageId, Access.view);
  const [v] = await db.select().from(pageVersions).where(and(eq(pageVersions.id, versionId), eq(pageVersions.pageId, pageId)));
  if (!v) throw notFound("Version not found");
  return v;
}

/**
 * Keeps a copy of a document in history without changing the page. Used when someone
 * resolves a conflict by taking the other person's version, so their own edits survive.
 */
export async function saveCopyToHistory(userId: string, pageId: string, doc: unknown) {
  if (!isDoc(doc)) throw badRequest("Invalid document");
  if (JSON.stringify(doc).length > MAX_DOC_BYTES) throw badRequest("Document is too large (5 MB limit)");
  const { page } = await requirePage(userId, pageId, Access.edit);
  const [current] = await db.select({ version: pageContent.version }).from(pageContent).where(eq(pageContent.pageId, pageId));
  const [v] = await db
    .insert(pageVersions)
    .values({ pageId, version: current?.version ?? 0, title: page.title, doc: sanitizeDoc(doc), reason: "unsaved-copy-from-conflict", createdBy: userId })
    .returning({ id: pageVersions.id });
  return v;
}

/** Restoring creates a new version; the current content is snapshotted first. */
export async function restoreVersion(userId: string, pageId: string, versionId: string) {
  return db.transaction(async (tx) => {
    const { page } = await requirePage(userId, pageId, Access.edit, {}, tx);
    const [v] = await tx.select().from(pageVersions).where(and(eq(pageVersions.id, versionId), eq(pageVersions.pageId, pageId)));
    if (!v) throw notFound("Version not found");
    const [current] = await tx.select().from(pageContent).where(eq(pageContent.pageId, pageId)).for("update");
    await tx.insert(pageVersions).values({ pageId, version: current.version, title: page.title, doc: current.doc, reason: "before-restore", createdBy: userId });
    const doc = v.doc as Doc;
    const version = current.version + 1;
    const now = new Date();
    await tx.update(pageContent).set({ doc, text: extractText(doc), version, updatedBy: userId, updatedAt: now }).where(eq(pageContent.pageId, pageId));
    await tx.update(pages).set({ updatedAt: now, updatedBy: userId }).where(eq(pages.id, pageId));
    await tx.insert(pageVersions).values({ pageId, version, title: page.title, doc, reason: `restored-from-v${v.version}`, createdBy: userId });
    await refreshLinks(tx, pageId, extractPageLinks(doc));
    await recordActivity({ workspaceId: page.workspaceId, pageId, actorId: userId, action: "page.version_restored", meta: { from: v.version } }, tx);
    return { version };
  });
}

/** Writes content without concurrency checks. For server-side creation only (templates, imports). */
export async function writeContentUnchecked(tx: typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0], pageId: string, doc: Doc, userId: string | null) {
  const clean = ensureBlockIds(sanitizeDoc(doc));
  await tx
    .update(pageContent)
    .set({ doc: clean, text: extractText(clean), version: sql`${pageContent.version} + 1`, updatedBy: userId, updatedAt: new Date() })
    .where(eq(pageContent.pageId, pageId));
  await refreshLinks(tx, pageId, extractPageLinks(clean));
}
