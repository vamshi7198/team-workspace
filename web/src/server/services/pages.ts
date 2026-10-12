import { generateKeyBetween } from "fractional-indexing";
import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { emptyDoc, ensureBlockIds, extractPageLinks, extractText, regenerateBlockIds, sanitizeDoc, type Doc } from "@/lib/doc";
import { db, type DbOrTx } from "../db";
import {
  favorites,
  pageContent,
  pageGrants,
  pageLinks,
  pages,
  pageVisits,
  teamspaceMembers,
  user,
  workspaceMembers,
  type GeneralAccess,
} from "../db/schema";
import { badRequest, forbidden, notFound } from "../errors";
import { audit, recordActivity } from "./audit";
import { Access, ACCESS_NAMES, requireMember, requirePage } from "./permissions";

export type Section = { type: "private" } | { type: "workspace" } | { type: "teamspace"; teamspaceId: string };

export type TreeNode = {
  id: string;
  parentId: string | null;
  kind: "page" | "database";
  title: string;
  icon: string | null;
  sortKey: string;
  teamspaceId: string | null;
  generalAccess: GeneralAccess;
  ownerId: string | null;
  access: number;
};

/** All pages visible to the user, excluding rows, templates, archived and trashed pages (and their descendants). */
export async function listTree(userId: string, workspaceId: string): Promise<TreeNode[]> {
  await requireMember(userId, workspaceId);
  const rows = await db.execute<TreeNode & { parent_id: string; sort_key: string; teamspace_id: string; general_access: GeneralAccess; owner_id: string }>(sql`
    with recursive t as (
      select id, parent_id, kind, title, icon, sort_key, teamspace_id, general_access, owner_id
      from pages
      where workspace_id = ${workspaceId} and parent_id is null and kind <> 'row'
        and deleted_at is null and archived_at is null and not is_template
      union all
      select p.id, p.parent_id, p.kind, p.title, p.icon, p.sort_key, p.teamspace_id, p.general_access, p.owner_id
      from pages p join t on p.parent_id = t.id
      where p.kind <> 'row' and p.deleted_at is null and p.archived_at is null and not p.is_template
    )
    select * from (select t.*, page_access(${userId}::uuid, t.id) as access from t) x
    where access > 0
    order by sort_key
  `);
  return rows.map((r) => ({
    id: r.id,
    parentId: r.parent_id,
    kind: r.kind,
    title: r.title,
    icon: r.icon,
    sortKey: r.sort_key,
    teamspaceId: r.teamspace_id,
    generalAccess: r.general_access,
    ownerId: r.owner_id,
    access: Number(r.access),
  }));
}

async function lastChildKey(tx: DbOrTx, workspaceId: string, parentId: string | null) {
  const [last] = await tx
    .select({ sortKey: pages.sortKey })
    .from(pages)
    .where(and(eq(pages.workspaceId, workspaceId), parentId ? eq(pages.parentId, parentId) : isNull(pages.parentId)))
    .orderBy(desc(pages.sortKey))
    .limit(1);
  return last?.sortKey ?? null;
}

export async function assertTeamspaceMember(userId: string, teamspaceId: string, tx: DbOrTx = db) {
  const [m] = await tx
    .select()
    .from(teamspaceMembers)
    .where(and(eq(teamspaceMembers.teamspaceId, teamspaceId), eq(teamspaceMembers.userId, userId)));
  if (!m) throw forbidden("You are not a member of that teamspace");
}

function sectionPlacement(section: Section): { generalAccess: GeneralAccess; teamspaceId: string | null } {
  if (section.type === "private") return { generalAccess: "none", teamspaceId: null };
  if (section.type === "workspace") return { generalAccess: "edit", teamspaceId: null };
  return { generalAccess: "edit", teamspaceId: section.teamspaceId };
}

export type CreatePageInput = {
  workspaceId: string;
  parentId?: string | null;
  section?: Section;
  title?: string;
  icon?: string | null;
  doc?: Doc;
  templateId?: string | null;
  kind?: "page" | "database";
  isTemplate?: boolean;
};

export async function createPage(userId: string, input: CreatePageInput, tx?: DbOrTx) {
  const run = async (t: DbOrTx) => {
    await requireMember(userId, input.workspaceId, t);
    let parent: typeof pages.$inferSelect | null = null;
    let placement: { generalAccess: GeneralAccess; teamspaceId: string | null };
    if (input.parentId) {
      ({ page: parent } = await requirePage(userId, input.parentId, Access.edit, {}, t));
      if (parent.workspaceId !== input.workspaceId) throw badRequest("Parent is in another workspace");
      if (parent.kind === "database") throw badRequest("Add rows to a database through the database view");
      placement = { generalAccess: "inherit", teamspaceId: parent.teamspaceId };
    } else {
      const section = input.section ?? { type: "private" };
      if (section.type === "teamspace") await assertTeamspaceMember(userId, section.teamspaceId, t);
      placement = sectionPlacement(section);
      if (input.isTemplate) placement = { generalAccess: "view", teamspaceId: null };
    }

    let doc = input.doc ?? emptyDoc();
    let title = input.title ?? "";
    let icon = input.icon ?? null;
    if (input.templateId) {
      const { page: tpl } = await requirePage(userId, input.templateId, Access.view, {}, t);
      const [c] = await t.select().from(pageContent).where(eq(pageContent.pageId, tpl.id));
      doc = regenerateBlockIds((c?.doc as Doc) ?? emptyDoc());
      title = input.title ?? (tpl.isTemplate ? "" : tpl.title);
      icon = input.icon ?? tpl.icon;
    }

    const sortKey = generateKeyBetween(await lastChildKey(t, input.workspaceId, parent?.id ?? null), null);
    const [page] = await t
      .insert(pages)
      .values({
        workspaceId: input.workspaceId,
        parentId: parent?.id ?? null,
        kind: input.kind ?? "page",
        teamspaceId: placement.teamspaceId,
        ownerId: userId,
        generalAccess: placement.generalAccess,
        title,
        icon,
        sortKey,
        isTemplate: input.isTemplate ?? false,
        createdBy: userId,
        updatedBy: userId,
      })
      .returning();
    const clean = ensureBlockIds(sanitizeDoc(doc));
    await t.insert(pageContent).values({ pageId: page.id, doc: clean, text: extractText(clean), version: 1, updatedBy: userId });
    await refreshLinks(t, page.id, extractPageLinks(clean));
    await recordActivity({ workspaceId: input.workspaceId, pageId: page.id, actorId: userId, action: "page.created" }, t);
    return page;
  };
  return tx ? run(tx) : db.transaction(run);
}

export async function updatePageMeta(
  userId: string,
  pageId: string,
  patch: { title?: string; icon?: string | null; coverFileId?: string | null },
) {
  await requirePage(userId, pageId, Access.edit);
  const [page] = await db
    .update(pages)
    .set({ ...patch, updatedAt: new Date(), updatedBy: userId })
    .where(eq(pages.id, pageId))
    .returning();
  return page;
}

async function ancestors(pageId: string, tx: DbOrTx = db) {
  return tx.execute<{ id: string; parent_id: string | null; title: string; icon: string | null; kind: string; teamspace_id: string | null; general_access: GeneralAccess; owner_id: string | null; depth: number }>(sql`
    with recursive chain as (
      select id, parent_id, title, icon, kind, teamspace_id, general_access, owner_id, 0 as depth from pages where id = ${pageId}
      union all
      select p.id, p.parent_id, p.title, p.icon, p.kind, p.teamspace_id, p.general_access, p.owner_id, c.depth + 1
      from pages p join chain c on p.id = c.parent_id where c.depth < 100
    )
    select * from chain order by depth desc
  `);
}

/** Ancestors from the root down to (excluding) the page, stopping at the first one the user cannot see. */
export async function breadcrumbs(userId: string, pageId: string) {
  const chain = await ancestors(pageId);
  const out: { id: string; title: string; icon: string | null; kind: string }[] = [];
  const rows = await db.execute<{ id: string; access: number }>(sql`
    select id, page_access(${userId}::uuid, id) as access from pages where id in ${chain.length ? sql`(${sql.join(chain.map((c) => sql`${c.id}::uuid`), sql`, `)})` : sql`(null)`}
  `);
  const access = new Map(rows.map((r) => [r.id, Number(r.access)]));
  for (const c of chain) {
    if (c.id === pageId) break;
    if (!access.get(c.id)) {
      out.length = 0; // a hidden ancestor: only show the visible part below it
      continue;
    }
    out.push({ id: c.id, title: c.title, icon: c.icon, kind: c.kind });
  }
  return out;
}

type RootInfo = { teamspaceId: string | null; private: boolean; ownerId: string | null };
async function rootInfo(pageId: string, tx: DbOrTx): Promise<RootInfo> {
  const chain = await ancestors(pageId, tx);
  const root = chain[0];
  return { teamspaceId: root.teamspace_id, private: root.general_access === "none", ownerId: root.owner_id };
}
const sameSection = (a: RootInfo, b: RootInfo) =>
  a.teamspaceId === b.teamspaceId && a.private === b.private && (!a.private || a.ownerId === b.ownerId);

export type MoveInput = {
  parentId?: string | null;
  section?: Section;
  /** Place between these siblings (either may be omitted). */
  afterId?: string | null;
  beforeId?: string | null;
};

export async function movePage(userId: string, pageId: string, input: MoveInput) {
  return db.transaction(async (tx) => {
    const { page, level } = await requirePage(userId, pageId, Access.edit, {}, tx);
    if (page.kind === "row") throw badRequest("Database rows are moved inside their database");
    const from = await rootInfo(pageId, tx);

    let newParentId: string | null = null;
    let placement: { generalAccess: GeneralAccess; teamspaceId: string | null };
    let to: RootInfo;
    if (input.parentId) {
      const { page: parent } = await requirePage(userId, input.parentId, Access.edit, {}, tx);
      if (parent.workspaceId !== page.workspaceId) throw badRequest("Cannot move between workspaces");
      if (parent.kind === "database" || parent.kind === "row") throw badRequest("Pages cannot be moved into a database");
      const chain = await ancestors(parent.id, tx);
      if (chain.some((c) => c.id === pageId)) throw badRequest("A page cannot be moved inside itself");
      newParentId = parent.id;
      placement = { generalAccess: "inherit", teamspaceId: parent.teamspaceId };
      to = await rootInfo(parent.id, tx);
    } else {
      const section = input.section ?? { type: "private" };
      if (section.type === "teamspace") await assertTeamspaceMember(userId, section.teamspaceId, tx);
      placement = sectionPlacement(section);
      to = { teamspaceId: placement.teamspaceId, private: section.type === "private", ownerId: section.type === "private" ? userId : null };
    }
    // Changing who can see a page needs full access to it.
    if (!sameSection(from, to) && level < Access.full) throw forbidden("Moving this page to another section needs full access");
    // Keep a page's own explicit restriction when it stays in the same section.
    if (newParentId && sameSection(from, to) && page.parentId && page.generalAccess !== "inherit") {
      placement.generalAccess = page.generalAccess;
    }

    const siblingKey = async (id: string | null | undefined) => {
      if (!id) return null;
      const [s] = await tx.select({ sortKey: pages.sortKey, parentId: pages.parentId }).from(pages).where(eq(pages.id, id));
      return s && s.parentId === newParentId ? s.sortKey : null;
    };
    let lo = await siblingKey(input.afterId);
    let hi = await siblingKey(input.beforeId);
    if (lo === null && hi === null) lo = await lastChildKey(tx, page.workspaceId, newParentId);
    if (lo !== null && hi !== null && lo >= hi) hi = null;
    const sortKey = generateKeyBetween(lo, hi);

    await tx
      .update(pages)
      .set({ parentId: newParentId, sortKey, generalAccess: placement.generalAccess, teamspaceId: placement.teamspaceId, updatedAt: new Date(), updatedBy: userId })
      .where(eq(pages.id, pageId));
    // Descendants follow the page into its new teamspace (or out of one).
    await tx.execute(sql`
      with recursive d as (select id from pages where parent_id = ${pageId} union all select p.id from pages p join d on p.parent_id = d.id)
      update pages set teamspace_id = ${placement.teamspaceId} where id in (select id from d)
    `);
    await recordActivity({ workspaceId: page.workspaceId, pageId, actorId: userId, action: "page.moved", meta: { parentId: newParentId } }, tx);
    return { ok: true };
  });
}

export async function duplicatePage(userId: string, pageId: string) {
  return db.transaction(async (tx) => {
    const { page } = await requirePage(userId, pageId, Access.view, {}, tx);
    if (page.kind !== "page") throw badRequest("Only documents can be duplicated");
    const placementParent = page.parentId;
    if (placementParent) await requirePage(userId, placementParent, Access.edit, {}, tx);

    const copyTree = async (src: typeof pages.$inferSelect, parentId: string | null, isRoot: boolean): Promise<string> => {
      const [content] = await tx.select().from(pageContent).where(eq(pageContent.pageId, src.id));
      const after = isRoot ? src.sortKey : null;
      let sortKey: string;
      if (isRoot) {
        const [next] = await tx
          .select({ sortKey: pages.sortKey })
          .from(pages)
          .where(and(eq(pages.workspaceId, src.workspaceId), parentId ? eq(pages.parentId, parentId) : isNull(pages.parentId), sql`${pages.sortKey} > ${after}`))
          .orderBy(pages.sortKey)
          .limit(1);
        sortKey = generateKeyBetween(after, next?.sortKey ?? null);
      } else sortKey = src.sortKey;
      const [copy] = await tx
        .insert(pages)
        .values({
          workspaceId: src.workspaceId,
          parentId,
          kind: "page",
          teamspaceId: src.teamspaceId,
          ownerId: userId,
          generalAccess: isRoot && !parentId ? (src.generalAccess === "inherit" ? "none" : src.generalAccess) : src.generalAccess,
          title: isRoot ? `${src.title || "Untitled"} (copy)` : src.title,
          icon: src.icon,
          coverFileId: src.coverFileId,
          sortKey,
          createdBy: userId,
          updatedBy: userId,
        })
        .returning();
      await tx.insert(pageContent).values({
        pageId: copy.id,
        doc: regenerateBlockIds((content?.doc as Doc) ?? emptyDoc()),
        text: content?.text ?? "",
        version: 1,
        updatedBy: userId,
      });
      const children = await tx
        .select()
        .from(pages)
        .where(and(eq(pages.parentId, src.id), eq(pages.kind, "page"), isNull(pages.deletedAt)));
      for (const child of children) {
        const acc = await tx.execute<{ a: number }>(sql`select page_access(${userId}::uuid, ${child.id}::uuid) as a`);
        if (Number(acc[0]?.a) >= Access.view) await copyTree(child, copy.id, false);
      }
      return copy.id;
    };
    const id = await copyTree(page, placementParent, true);
    await recordActivity({ workspaceId: page.workspaceId, pageId: id, actorId: userId, action: "page.duplicated", meta: { from: pageId } }, tx);
    return { id };
  });
}

export async function setArchived(userId: string, pageId: string, archived: boolean) {
  const { page } = await requirePage(userId, pageId, Access.edit);
  await db.update(pages).set({ archivedAt: archived ? new Date() : null, updatedAt: new Date(), updatedBy: userId }).where(eq(pages.id, pageId));
  await recordActivity({ workspaceId: page.workspaceId, pageId, actorId: userId, action: archived ? "page.archived" : "page.unarchived" });
}

export async function trashPage(userId: string, pageId: string) {
  const { page } = await requirePage(userId, pageId, Access.edit);
  await db.update(pages).set({ deletedAt: new Date(), deletedBy: userId }).where(eq(pages.id, pageId));
  await recordActivity({ workspaceId: page.workspaceId, pageId, actorId: userId, action: "page.trashed" });
}

export async function restorePage(userId: string, pageId: string) {
  return db.transaction(async (tx) => {
    const { page } = await requirePage(userId, pageId, Access.edit, { allowDeleted: true }, tx);
    // Restore trashed ancestors too, otherwise the page would stay hidden.
    const chain = await ancestors(pageId, tx);
    const ids = chain.map((c) => c.id);
    await tx.update(pages).set({ deletedAt: null, deletedBy: null }).where(and(inArray(pages.id, ids), isNotNull(pages.deletedAt)));
    await recordActivity({ workspaceId: page.workspaceId, pageId, actorId: userId, action: "page.restored" }, tx);
  });
}

export async function purgePage(userId: string, pageId: string) {
  const { page } = await requirePage(userId, pageId, Access.full, { allowDeleted: true });
  if (!page.deletedAt) throw badRequest("Move the page to the trash first");
  await db.delete(pages).where(eq(pages.id, pageId));
  await audit({ workspaceId: page.workspaceId, actorId: userId, action: "page.purged", target: pageId, meta: { title: page.title } });
}

export async function listTrash(userId: string, workspaceId: string) {
  await requireMember(userId, workspaceId);
  return db.execute<{ id: string; title: string; icon: string | null; kind: string; deleted_at: string; access: number }>(sql`
    select * from (
      select id, title, icon, kind, deleted_at, page_access(${userId}::uuid, id) as access
      from pages where workspace_id = ${workspaceId} and deleted_at is not null
    ) x where access >= ${Access.edit}
    order by deleted_at desc limit 200
  `);
}

export async function listArchived(userId: string, workspaceId: string) {
  await requireMember(userId, workspaceId);
  return db.execute<{ id: string; title: string; icon: string | null; archived_at: string }>(sql`
    select * from (
      select id, title, icon, archived_at, page_access(${userId}::uuid, id) as access
      from pages where workspace_id = ${workspaceId} and archived_at is not null and deleted_at is null
    ) x where access >= 1
    order by archived_at desc limit 200
  `);
}

/** Purges pages that have been in the trash for more than `days` days. */
export async function purgeOldTrash(days = 30) {
  const res = await db.execute(sql`delete from pages where deleted_at < now() - make_interval(days => ${days}) returning id`);
  return res.length;
}

// ---- favorites & recents ---------------------------------------------------

export async function setFavorite(userId: string, pageId: string, on: boolean) {
  if (on) {
    await requirePage(userId, pageId, Access.view);
    await db.insert(favorites).values({ userId, pageId }).onConflictDoNothing();
  } else {
    await db.delete(favorites).where(and(eq(favorites.userId, userId), eq(favorites.pageId, pageId)));
  }
}

export async function listFavorites(userId: string, workspaceId: string) {
  return db.execute<{ id: string; title: string; icon: string | null; kind: string }>(sql`
    select p.id, p.title, p.icon, p.kind from favorites f join pages p on p.id = f.page_id
    where f.user_id = ${userId} and p.workspace_id = ${workspaceId} and p.deleted_at is null
      and page_access(${userId}::uuid, p.id) >= 1
    order by f.created_at
  `);
}

export async function recordVisit(userId: string, pageId: string) {
  await db
    .insert(pageVisits)
    .values({ userId, pageId, visitedAt: new Date() })
    .onConflictDoUpdate({ target: [pageVisits.userId, pageVisits.pageId], set: { visitedAt: new Date() } });
}

export async function listRecent(userId: string, workspaceId: string, limit = 12) {
  return db.execute<{ id: string; title: string; icon: string | null; kind: string; visited_at: string; updated_at: string }>(sql`
    select p.id, p.title, p.icon, p.kind, v.visited_at, p.updated_at from page_visits v join pages p on p.id = v.page_id
    where v.user_id = ${userId} and p.workspace_id = ${workspaceId} and p.deleted_at is null
      and page_access(${userId}::uuid, p.id) >= 1
    order by v.visited_at desc limit ${limit}
  `);
}

export async function backlinks(userId: string, pageId: string) {
  return db.execute<{ id: string; title: string; icon: string | null }>(sql`
    select p.id, p.title, p.icon from page_links l join pages p on p.id = l.from_page_id
    where l.to_page_id = ${pageId} and p.deleted_at is null and page_access(${userId}::uuid, p.id) >= 1
    order by p.updated_at desc limit 50
  `);
}

export async function childPages(userId: string, pageId: string) {
  return db.execute<{ id: string; title: string; icon: string | null; kind: string }>(sql`
    select id, title, icon, kind from pages
    where parent_id = ${pageId} and kind <> 'row' and deleted_at is null and archived_at is null
      and page_access(${userId}::uuid, id) >= 1
    order by sort_key
  `);
}

// ---- sharing ---------------------------------------------------------------

export async function getSharing(userId: string, pageId: string) {
  const { page, level } = await requirePage(userId, pageId, Access.view);
  const chain = await ancestors(pageId);
  const boundary = [...chain].reverse().find((c) => c.general_access !== "inherit");
  const grants = await db
    .select({ userId: pageGrants.userId, level: pageGrants.level, name: user.name, email: user.email, pageId: pageGrants.pageId })
    .from(pageGrants)
    .innerJoin(user, eq(user.id, pageGrants.userId))
    .where(inArray(pageGrants.pageId, chain.map((c) => c.id)));
  const [owner] = page.ownerId ? await db.select({ id: user.id, name: user.name, email: user.email }).from(user).where(eq(user.id, page.ownerId)) : [];
  return {
    myAccess: ACCESS_NAMES[level],
    generalAccess: page.generalAccess,
    effectiveGeneralAccess: boundary?.general_access ?? "none",
    inheritedFrom: page.generalAccess === "inherit" && boundary ? { id: boundary.id, title: boundary.title } : null,
    teamspaceId: page.teamspaceId,
    owner: owner ?? null,
    isRoot: !page.parentId,
    grants: grants.map((g) => ({ ...g, level: ACCESS_NAMES[g.level], inherited: g.pageId !== pageId })),
  };
}

export async function setGeneralAccess(userId: string, pageId: string, value: GeneralAccess, ip: string | null) {
  const { page } = await requirePage(userId, pageId, Access.full);
  if (page.kind === "row") throw badRequest("Rows share the access of their database");
  if (!page.parentId && value === "inherit") throw badRequest("Top-level pages cannot inherit access");
  await db.update(pages).set({ generalAccess: value }).where(eq(pages.id, pageId));
  await audit({ workspaceId: page.workspaceId, actorId: userId, action: "page.general_access", target: pageId, meta: { value }, ip });
}

export async function setGrant(userId: string, pageId: string, targetUserId: string, levelName: (typeof ACCESS_NAMES)[number], ip: string | null) {
  const { page } = await requirePage(userId, pageId, Access.full);
  if (page.kind === "row") throw badRequest("Rows share the access of their database");
  const [member] = await db
    .select()
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, page.workspaceId), eq(workspaceMembers.userId, targetUserId)));
  if (!member) throw notFound("That person is not a member of this workspace");
  const level = ACCESS_NAMES.indexOf(levelName);
  if (level <= 0) {
    await db.delete(pageGrants).where(and(eq(pageGrants.pageId, pageId), eq(pageGrants.userId, targetUserId)));
  } else {
    await db
      .insert(pageGrants)
      .values({ pageId, userId: targetUserId, level, grantedBy: userId })
      .onConflictDoUpdate({ target: [pageGrants.pageId, pageGrants.userId], set: { level, grantedBy: userId } });
  }
  await audit({ workspaceId: page.workspaceId, actorId: userId, action: "page.grant", target: pageId, meta: { user: targetUserId, level: levelName }, ip });
}

export async function refreshLinks(tx: DbOrTx, pageId: string, targetIds: string[]) {
  await tx.delete(pageLinks).where(eq(pageLinks.fromPageId, pageId));
  if (!targetIds.length) return;
  const existing = await tx.select({ id: pages.id }).from(pages).where(inArray(pages.id, targetIds));
  const values = existing.filter((e) => e.id !== pageId).map((e) => ({ fromPageId: pageId, toPageId: e.id }));
  if (values.length) await tx.insert(pageLinks).values(values).onConflictDoNothing();
}
