import { Zip, ZipPassThrough, strToU8 } from "fflate";
import { asc, eq, inArray, sql } from "drizzle-orm";
import type { Doc } from "@/lib/doc";
import { toCsv, valueToText } from "@/lib/db-engine/format";
import { docToMarkdown } from "@/lib/markdown";
import { db } from "../db";
import * as s from "../db/schema";
import { audit } from "./audit";
import { getContent } from "./content";
import { getDatabase, queryRows } from "./databases";
import { requireAdmin } from "./permissions";
import { storage } from "../storage";

const slug = (t: string) => (t || "Untitled").replace(/[\\/:*?"<>|\0\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "Untitled";

export async function exportPageMarkdown(userId: string, pageId: string) {
  const { page, doc } = await getContent(userId, pageId);
  return { filename: `${slug(page.title)}.md`, body: docToMarkdown(doc as Doc, page.title || "Untitled") };
}

export async function exportPageJson(userId: string, pageId: string) {
  const { page, doc, version } = await getContent(userId, pageId);
  const out = {
    format: "team-workspace/page@1",
    exportedAt: new Date().toISOString(),
    page: { id: page.id, parentId: page.parentId, kind: page.kind, title: page.title, icon: page.icon, databaseId: page.databaseId, props: page.props, createdAt: page.createdAt, updatedAt: page.updatedAt },
    content: { version, doc },
  };
  return { filename: `${slug(page.title)}.json`, body: JSON.stringify(out, null, 2) };
}

async function userNames(workspaceId: string) {
  const rows = await db.select({ id: s.user.id, name: s.user.name }).from(s.workspaceMembers).innerJoin(s.user, eq(s.user.id, s.workspaceMembers.userId)).where(eq(s.workspaceMembers.workspaceId, workspaceId));
  return new Map(rows.map((r) => [r.id, r.name]));
}

export async function exportDatabaseCsv(userId: string, databaseId: string) {
  const meta = await getDatabase(userId, databaseId);
  const { rows } = await queryRows(userId, databaseId);
  const [d] = await db.select({ workspaceId: s.databases.workspaceId }).from(s.databases).where(eq(s.databases.id, databaseId));
  const names = await userNames(d.workspaceId);
  const props = meta.properties;
  const table = [["id", ...props.map((p) => p.name)], ...rows.map((r) => [r.id, ...props.map((p) => valueToText(p, r, (id) => names.get(id) ?? id))])];
  return { filename: `${slug(meta.title)}.csv`, body: toCsv(table) };
}

/**
 * Full workspace export (admins only): every table row for the workspace as JSON with
 * original IDs, a Markdown/CSV rendering of the page tree, and all attachments.
 * Streams a ZIP so large workspaces do not need to fit in memory.
 */
export async function exportWorkspaceZip(userId: string, workspaceId: string, ip: string | null): Promise<ReadableStream<Uint8Array>> {
  await requireAdmin(userId, workspaceId);
  await audit({ workspaceId, actorId: userId, action: "workspace.exported", ip });

  const ws = await db.select().from(s.workspaces).where(eq(s.workspaces.id, workspaceId));
  const members = await db
    .select({ id: s.user.id, name: s.user.name, email: s.user.email, role: s.workspaceMembers.role, joinedAt: s.workspaceMembers.createdAt })
    .from(s.workspaceMembers).innerJoin(s.user, eq(s.user.id, s.workspaceMembers.userId)).where(eq(s.workspaceMembers.workspaceId, workspaceId));
  const pageRows = await db.select().from(s.pages).where(eq(s.pages.workspaceId, workspaceId)).orderBy(asc(s.pages.createdAt));
  const pageIds = pageRows.map((p) => p.id);
  const inPages = <T extends { pageId: unknown }>(col: T["pageId"]) => (pageIds.length ? inArray(col as never, pageIds) : sql`false`);
  const content = await db.select({ pageId: s.pageContent.pageId, doc: s.pageContent.doc, version: s.pageContent.version, updatedAt: s.pageContent.updatedAt }).from(s.pageContent).where(inPages(s.pageContent.pageId));
  const dbs = await db.select().from(s.databases).where(eq(s.databases.workspaceId, workspaceId));
  const dbIds = dbs.map((d) => d.id);
  const props = dbIds.length ? await db.select().from(s.dbProperties).where(inArray(s.dbProperties.databaseId, dbIds)) : [];
  const views = dbIds.length ? await db.select().from(s.dbViews).where(inArray(s.dbViews.databaseId, dbIds)) : [];
  const propIds = props.map((p) => p.id);
  const relations = propIds.length ? await db.select().from(s.relationLinks).where(inArray(s.relationLinks.propertyId, propIds)) : [];
  const commentRows = await db.select().from(s.comments).where(inPages(s.comments.pageId));
  const grants = await db.select().from(s.pageGrants).where(inPages(s.pageGrants.pageId));
  const actionLinks = await db.select().from(s.actionItemTasks).where(inPages(s.actionItemTasks.meetingPageId));
  const fileRows = await db.select().from(s.files).where(eq(s.files.workspaceId, workspaceId));
  const teams = await db.select().from(s.teamspaces).where(eq(s.teamspaces.workspaceId, workspaceId));
  const teamMembers = teams.length ? await db.select().from(s.teamspaceMembers).where(inArray(s.teamspaceMembers.teamspaceId, teams.map((t) => t.id))) : [];

  const data = {
    format: "team-workspace/export@1",
    exportedAt: new Date().toISOString(),
    workspace: ws[0],
    members,
    teamspaces: teams,
    teamspaceMembers: teamMembers,
    pages: pageRows.map(({ searchTsv: _s, ...p }) => p),
    pageContent: content,
    pageGrants: grants,
    databases: dbs,
    properties: props,
    views,
    relationLinks: relations,
    actionItemTasks: actionLinks,
    comments: commentRows.map(({ bodyTsv: _b, ...c }) => c),
    files: fileRows.map((f) => ({ ...f, path: `files/${f.id}/${f.originalName}` })),
  };

  // Human-readable tree: folders by page title, Markdown for documents, CSV for databases.
  const byParent = new Map<string | null, typeof pageRows>();
  for (const p of pageRows) {
    if (p.kind === "row" || p.deletedAt) continue;
    const list = byParent.get(p.parentId) ?? [];
    list.push(p);
    byParent.set(p.parentId, list);
  }
  const contentById = new Map(content.map((c) => [c.pageId, c.doc as Doc]));
  const dbByPage = new Map(dbs.map((d) => [d.pageId, d]));
  const tree: { path: string; body: string }[] = [];
  const walk = async (parentId: string | null, dir: string) => {
    const used = new Set<string>();
    for (const p of byParent.get(parentId) ?? []) {
      let name = slug(p.title);
      while (used.has(name)) name += " (2)";
      used.add(name);
      const base = `${dir}${p.isTemplate ? "Templates/" : ""}${name}`;
      const d = dbByPage.get(p.id);
      if (d) {
        const csv = await exportDatabaseCsv(userId, d.id).catch(() => null);
        if (csv) tree.push({ path: `${base}.csv`, body: csv.body });
      } else {
        tree.push({ path: `${base}.md`, body: docToMarkdown(contentById.get(p.id) ?? { type: "doc" }, p.title || "Untitled") });
      }
      await walk(p.id, `${base}/`);
    }
  };
  await walk(null, "markdown/");

  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({ start: (c) => { controller = c; } });
  const zip = new Zip((err, chunk, final) => {
    if (err) return controller.error(err);
    controller.enqueue(chunk);
    if (final) controller.close();
  });
  const addText = (path: string, text: string) => {
    const f = new ZipPassThrough(path);
    zip.add(f);
    f.push(strToU8(text), true);
  };

  (async () => {
    try {
      addText("workspace.json", JSON.stringify(data, null, 2));
      addText("README.txt", "workspace.json holds every record with its original ID and relationships.\nmarkdown/ is a readable copy of the page tree (databases as CSV).\nfiles/ holds uploaded attachments, referenced from workspace.json.\n");
      for (const t of tree) addText(t.path, t.body);
      for (const f of fileRows) {
        const entry = new ZipPassThrough(`files/${f.id}/${f.originalName}`);
        zip.add(entry);
        try {
          const reader = (await storage().get(f.storageKey)).getReader();
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            entry.push(value);
          }
        } catch {
          // Missing file on disk: keep the export going, the JSON still lists it.
        }
        entry.push(new Uint8Array(0), true);
      }
      zip.end();
    } catch (err) {
      controller.error(err);
    }
  })();
  return stream;
}
