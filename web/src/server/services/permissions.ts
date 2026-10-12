import { and, eq, sql } from "drizzle-orm";
import { db, type DbOrTx } from "../db";
import { pages, user, workspaceMembers } from "../db/schema";
import { forbidden, notFound } from "../errors";

// 0 none, 1 view, 2 comment, 3 edit, 4 full — computed by the page_access() SQL function.
export const Access = { none: 0, view: 1, comment: 2, edit: 3, full: 4 } as const;
export type AccessLevel = (typeof Access)[keyof typeof Access];
export const ACCESS_NAMES = ["none", "view", "comment", "edit", "full"] as const;

export async function pageAccess(userId: string, pageId: string, tx: DbOrTx = db): Promise<number> {
  const rows = await tx.execute<{ level: number }>(
    sql`select page_access(${userId}::uuid, ${pageId}::uuid) as level`,
  );
  return Number(rows[0]?.level ?? 0);
}

/**
 * Loads a page the user can access at `min` level or throws. Missing and
 * inaccessible pages both produce 404 so page IDs cannot be probed.
 */
export async function requirePage(
  userId: string,
  pageId: string,
  min: number,
  opts: { allowDeleted?: boolean } = {},
  tx: DbOrTx = db,
) {
  if (!/^[0-9a-f-]{36}$/i.test(pageId)) throw notFound("Page not found");
  const [page] = await tx.select().from(pages).where(eq(pages.id, pageId));
  if (!page) throw notFound("Page not found");
  const level = await pageAccess(userId, pageId, tx);
  if (level === 0) throw notFound("Page not found");
  if (page.deletedAt && !opts.allowDeleted) throw notFound("Page is in the trash");
  if (level < min) throw forbidden();
  return { page, level };
}

export async function membership(userId: string, workspaceId: string, tx: DbOrTx = db) {
  const [m] = await tx
    .select({ role: workspaceMembers.role, disabledAt: user.disabledAt })
    .from(workspaceMembers)
    .innerJoin(user, eq(user.id, workspaceMembers.userId))
    .where(and(eq(workspaceMembers.userId, userId), eq(workspaceMembers.workspaceId, workspaceId)));
  if (!m || m.disabledAt) return null;
  return m.role;
}

export async function requireMember(userId: string, workspaceId: string, tx: DbOrTx = db) {
  if (!/^[0-9a-f-]{36}$/i.test(workspaceId)) throw notFound("Workspace not found");
  const role = await membership(userId, workspaceId, tx);
  if (!role) throw notFound("Workspace not found");
  return role;
}

export async function requireAdmin(userId: string, workspaceId: string, tx: DbOrTx = db) {
  const role = await requireMember(userId, workspaceId, tx);
  if (role !== "admin") throw forbidden("Only workspace admins can do that");
  return role;
}

/** SQL predicate: the current user can at least view the page referenced by `pageIdCol`. */
export const canView = (userId: string, pageIdCol: unknown) =>
  sql`page_access(${userId}::uuid, ${pageIdCol}) >= 1`;
