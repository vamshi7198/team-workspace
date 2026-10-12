import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "../db";
import { comments, user } from "../db/schema";
import { badRequest, forbidden, notFound } from "../errors";
import { recordActivity } from "./audit";
import { Access, requirePage } from "./permissions";

export async function listComments(userId: string, pageId: string) {
  await requirePage(userId, pageId, Access.view);
  return db
    .select({
      id: comments.id,
      parentId: comments.parentId,
      body: comments.body,
      resolvedAt: comments.resolvedAt,
      createdAt: comments.createdAt,
      updatedAt: comments.updatedAt,
      authorId: comments.authorId,
      authorName: user.name,
    })
    .from(comments)
    .leftJoin(user, eq(user.id, comments.authorId))
    .where(and(eq(comments.pageId, pageId), isNull(comments.deletedAt)))
    .orderBy(asc(comments.createdAt));
}

export async function addComment(userId: string, pageId: string, input: { body: string; parentId?: string | null }) {
  const { page } = await requirePage(userId, pageId, Access.comment);
  const body = input.body.trim();
  if (!body) throw badRequest("Comment is empty");
  if (body.length > 10000) throw badRequest("Comment is too long");
  if (input.parentId) {
    const [parent] = await db.select().from(comments).where(and(eq(comments.id, input.parentId), eq(comments.pageId, pageId)));
    if (!parent) throw notFound("Comment not found");
  }
  const [c] = await db.insert(comments).values({ pageId, parentId: input.parentId ?? null, authorId: userId, body }).returning();
  await recordActivity({ workspaceId: page.workspaceId, pageId, actorId: userId, action: "comment.added" });
  return c;
}

async function loadOwnComment(userId: string, commentId: string, minIfNotOwner: number) {
  const [c] = await db.select().from(comments).where(and(eq(comments.id, commentId), isNull(comments.deletedAt)));
  if (!c) throw notFound("Comment not found");
  const { level } = await requirePage(userId, c.pageId, Access.view);
  if (c.authorId !== userId && level < minIfNotOwner) throw forbidden();
  return { c, level };
}

export async function editComment(userId: string, commentId: string, body: string) {
  const { c } = await loadOwnComment(userId, commentId, Number.POSITIVE_INFINITY);
  if (!body.trim()) throw badRequest("Comment is empty");
  await db.update(comments).set({ body: body.trim().slice(0, 10000), updatedAt: new Date() }).where(eq(comments.id, c.id));
}

export async function deleteComment(userId: string, commentId: string) {
  const { c } = await loadOwnComment(userId, commentId, Access.full);
  await db.update(comments).set({ deletedAt: new Date() }).where(eq(comments.id, c.id));
}

export async function resolveComment(userId: string, commentId: string, resolved: boolean) {
  const { c } = await loadOwnComment(userId, commentId, Access.comment);
  await db.update(comments).set({ resolvedAt: resolved ? new Date() : null }).where(eq(comments.id, c.id));
}
