import { sql } from "drizzle-orm";
import { db } from "../db";
import { findSystemDatabase, propertyByKey, queryRows } from "./databases";
import { listFavorites, listRecent } from "./pages";
import { requireMember } from "./permissions";

/** Data for the Home screen: recents, favorites, active projects, my open tasks, recent meetings. */
export async function homeData(userId: string, workspaceId: string) {
  await requireMember(userId, workspaceId);
  const [recent, favorites] = await Promise.all([listRecent(userId, workspaceId, 8), listFavorites(userId, workspaceId)]);

  const projectsDb = await findSystemDatabase(workspaceId, "projects");
  const tasksDb = await findSystemDatabase(workspaceId, "tasks");
  const meetingsDb = await findSystemDatabase(workspaceId, "meetings");

  const safe = async <T>(fn: () => Promise<T>, fallback: T) => {
    try { return await fn(); } catch { return fallback; } // e.g. no access to a built-in database
  };

  const projects = projectsDb
    ? await safe(async () => {
        const status = await propertyByKey(projectsDb.id, "status");
        const { rows } = await queryRows(userId, projectsDb.id, {
          filter: status ? { mode: "and", conditions: [{ propertyId: status.id, op: "is_not_done" }] } : undefined,
          sorts: [{ propertyId: (await propertyByKey(projectsDb.id, "due"))?.id ?? "title", direction: "asc" }],
        });
        return { pageId: projectsDb.pageId, rows: rows.slice(0, 8), statusId: status?.id ?? null, progressId: (await propertyByKey(projectsDb.id, "progress"))?.id ?? null, dueId: (await propertyByKey(projectsDb.id, "due"))?.id ?? null, options: status?.config.options ?? [] };
      }, null)
    : null;

  const myTasks = tasksDb
    ? await safe(async () => {
        const assignee = await propertyByKey(tasksDb.id, "assignee");
        const status = await propertyByKey(tasksDb.id, "status");
        const due = await propertyByKey(tasksDb.id, "due");
        if (!assignee || !status) return null;
        const { rows } = await queryRows(userId, tasksDb.id, {
          filter: { mode: "and", conditions: [{ propertyId: assignee.id, op: "contains", value: "me" }, { propertyId: status.id, op: "is_not_done" }] },
          sorts: due ? [{ propertyId: due.id, direction: "asc" }] : [],
        });
        return { pageId: tasksDb.pageId, rows: rows.slice(0, 10), statusId: status.id, dueId: due?.id ?? null, options: status.config.options ?? [] };
      }, null)
    : null;

  const meetings = meetingsDb
    ? await safe(async () => {
        const rows = await db.execute<{ id: string; title: string; icon: string | null; updated_at: string }>(sql`
          select id, title, icon, updated_at from pages
          where database_id = ${meetingsDb.id} and deleted_at is null and page_access(${userId}::uuid, id) >= 1
          order by updated_at desc limit 6`);
        return { pageId: meetingsDb.pageId, rows };
      }, null)
    : null;

  return { recent, favorites, projects, myTasks, meetings };
}
