import { db, type DbOrTx } from "../db";
import { activity, auditLog } from "../db/schema";

/** Sensitive administrative actions (membership, roles, exports, permission changes). */
export async function audit(
  e: { workspaceId?: string | null; actorId?: string | null; action: string; target?: string; meta?: Record<string, unknown>; ip?: string | null },
  tx: DbOrTx = db,
) {
  await tx.insert(auditLog).values({
    workspaceId: e.workspaceId ?? null,
    actorId: e.actorId ?? null,
    action: e.action,
    target: e.target,
    meta: e.meta ?? {},
    ip: e.ip ?? null,
  });
}

/** User-facing page activity (created, edited, moved, restored...). */
export async function recordActivity(
  e: { workspaceId: string; pageId?: string | null; actorId: string; action: string; meta?: Record<string, unknown> },
  tx: DbOrTx = db,
) {
  await tx.insert(activity).values({
    workspaceId: e.workspaceId,
    pageId: e.pageId ?? null,
    actorId: e.actorId,
    action: e.action,
    meta: e.meta ?? {},
  });
}
