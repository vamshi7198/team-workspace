import { and, eq, inArray, sql } from "drizzle-orm";
import { actionItems, decisions, type Doc } from "@/lib/doc";
import { optionGroup } from "@/lib/db-engine/query";
import { db } from "../db";
import { actionItemTasks, pageContent, pages } from "../db/schema";
import { badRequest, notFound } from "../errors";
import { createRow, findSystemDatabase, propertyByKey, requireDatabase } from "./databases";
import { Access, requireMember, requirePage } from "./permissions";

type TaskInfo = { id: string; title: string; statusName: string | null; done: boolean };

async function taskInfo(taskIds: string[], workspaceId: string): Promise<Map<string, TaskInfo>> {
  const out = new Map<string, TaskInfo>();
  if (!taskIds.length) return out;
  const tasksDb = await findSystemDatabase(workspaceId, "tasks");
  const status = tasksDb ? await propertyByKey(tasksDb.id, "status") : null;
  const rows = await db.select({ id: pages.id, title: pages.title, props: pages.props, deletedAt: pages.deletedAt }).from(pages).where(inArray(pages.id, taskIds));
  for (const r of rows) {
    const v = status ? (r.props as Record<string, unknown>)[status.id] : null;
    out.set(r.id, {
      id: r.id,
      title: r.title,
      statusName: status?.config.options?.find((o) => o.id === v)?.name ?? null,
      done: optionGroup(status ?? undefined, v) === "done" || Boolean(r.deletedAt),
    });
  }
  return out;
}

/** Action items in a meeting (to-dos under an "Action items" heading) and their linked tasks. */
export async function listActionItems(userId: string, meetingPageId: string) {
  const { page } = await requirePage(userId, meetingPageId, Access.view);
  const [c] = await db.select({ doc: pageContent.doc }).from(pageContent).where(eq(pageContent.pageId, meetingPageId));
  const items = actionItems((c?.doc as Doc) ?? { type: "doc" });
  const links = await db.select().from(actionItemTasks).where(eq(actionItemTasks.meetingPageId, meetingPageId));
  const byBlock = new Map(links.map((l) => [l.blockId, l.taskPageId]));
  const tasks = await taskInfo(links.map((l) => l.taskPageId), page.workspaceId);
  return items.map((i) => {
    const taskId = byBlock.get(i.blockId);
    return { ...i, task: taskId ? tasks.get(taskId) ?? null : null };
  });
}

/**
 * Converts action items into Tasks rows. Idempotent: each (meeting, block) pair maps
 * to at most one task, guarded by a unique key and a per-meeting lock, so repeating
 * the conversion (or two people clicking at once) never creates duplicates.
 */
export async function convertActionItems(
  userId: string,
  meetingPageId: string,
  items: { blockId: string; assigneeId?: string | null; due?: string | null }[],
) {
  if (!items.length) throw badRequest("Choose at least one action item");
  return db.transaction(async (tx) => {
    const { page: meeting } = await requirePage(userId, meetingPageId, Access.edit, {}, tx);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${meetingPageId}))`);
    const tasksDb = await findSystemDatabase(meeting.workspaceId, "tasks", tx);
    if (!tasksDb) throw notFound("Tasks database not found");
    await requireDatabase(userId, tasksDb.id, Access.edit, tx);

    const [c] = await tx.select({ doc: pageContent.doc }).from(pageContent).where(eq(pageContent.pageId, meetingPageId));
    const docItems = new Map(actionItems((c?.doc as Doc) ?? { type: "doc" }).map((i) => [i.blockId, i]));
    const status = await propertyByKey(tasksDb.id, "status", tx);
    const assignee = await propertyByKey(tasksDb.id, "assignee", tx);
    const due = await propertyByKey(tasksDb.id, "due", tx);
    const meetingRel = await propertyByKey(tasksDb.id, "meeting", tx);
    const projectRel = await propertyByKey(tasksDb.id, "project", tx);
    const notStarted = status?.config.options?.find((o) => o.group === "todo")?.id;

    // Carry the meeting's project over to the task, if the meeting has one.
    let projectIds: string[] = [];
    const meetingsDb = await findSystemDatabase(meeting.workspaceId, "meetings", tx);
    const isMeetingRow = Boolean(meetingsDb && meeting.databaseId === meetingsDb.id);
    if (isMeetingRow && meetingsDb) {
      const mp = await propertyByKey(meetingsDb.id, "project", tx);
      if (mp) {
        const links = await tx.execute<{ id: string }>(sql`select to_page_id as id from relation_links where property_id = ${mp.id} and from_page_id = ${meetingPageId}`);
        projectIds = links.map((l) => l.id);
      }
    }

    const results: { blockId: string; taskId: string; created: boolean }[] = [];
    for (const item of items) {
      const source = docItems.get(item.blockId);
      if (!source) throw badRequest("That action item no longer exists in the meeting notes. Save and try again.");
      const [existing] = await tx.select().from(actionItemTasks).where(and(eq(actionItemTasks.meetingPageId, meetingPageId), eq(actionItemTasks.blockId, item.blockId)));
      if (existing) {
        results.push({ blockId: item.blockId, taskId: existing.taskPageId, created: false });
        continue;
      }
      const values: Record<string, unknown> = {};
      if (status && notStarted) values[status.id] = source.checked ? status.config.options?.find((o) => o.group === "done")?.id : notStarted;
      if (assignee && item.assigneeId) values[assignee.id] = [item.assigneeId];
      if (due && item.due) values[due.id] = { start: item.due };
      if (meetingRel && isMeetingRow) values[meetingRel.id] = [meetingPageId];
      if (projectRel && projectIds.length) values[projectRel.id] = projectIds;
      const task = await createRow(userId, tasksDb.id, { title: source.text.slice(0, 500), values, useTemplate: true }, tx);
      await tx.insert(actionItemTasks).values({ meetingPageId, blockId: item.blockId, taskPageId: task.id, createdBy: userId });
      results.push({ blockId: item.blockId, taskId: task.id, created: true });
    }
    return results;
  });
}

/** Decisions and outstanding action items across recent meetings the user can see. */
export async function meetingsHub(userId: string, workspaceId: string) {
  await requireMember(userId, workspaceId);
  const meetingsDb = await findSystemDatabase(workspaceId, "meetings");
  if (!meetingsDb) return { decisions: [], actionItems: [], meetingsPageId: null };
  const dateProp = await propertyByKey(meetingsDb.id, "date");
  const rows = await db.execute<{ id: string; title: string; props: Record<string, unknown>; doc: Doc }>(sql`
    select p.id, p.title, p.props, c.doc from pages p join page_content c on c.page_id = p.id
    where p.database_id = ${meetingsDb.id} and p.deleted_at is null and page_access(${userId}::uuid, p.id) >= 1
    order by p.created_at desc limit 200
  `);
  const dateOf = (props: Record<string, unknown>) => ((dateProp ? (props[dateProp.id] as { start?: string } | undefined)?.start : null) ?? null);
  const links = rows.length
    ? await db.select().from(actionItemTasks).where(inArray(actionItemTasks.meetingPageId, rows.map((r) => r.id)))
    : [];
  const linkKey = (m: string, b: string) => `${m}:${b}`;
  const byKey = new Map(links.map((l) => [linkKey(l.meetingPageId, l.blockId), l.taskPageId]));
  const tasks = await taskInfo(links.map((l) => l.taskPageId), workspaceId);

  const allDecisions: { meetingId: string; meetingTitle: string; date: string | null; text: string }[] = [];
  const openItems: { meetingId: string; meetingTitle: string; date: string | null; blockId: string; text: string; task: TaskInfo | null }[] = [];
  for (const r of rows) {
    const date = dateOf(r.props);
    for (const d of decisions(r.doc)) allDecisions.push({ meetingId: r.id, meetingTitle: r.title, date, text: d.text });
    for (const a of actionItems(r.doc)) {
      const taskId = byKey.get(linkKey(r.id, a.blockId));
      const task = taskId ? tasks.get(taskId) ?? null : null;
      const done = task ? task.done : a.checked;
      if (!done) openItems.push({ meetingId: r.id, meetingTitle: r.title, date, blockId: a.blockId, text: a.text, task });
    }
  }
  const byDateDesc = (a: { date: string | null }, b: { date: string | null }) => (b.date ?? "").localeCompare(a.date ?? "");
  return { decisions: allDecisions.sort(byDateDesc).slice(0, 200), actionItems: openItems.sort(byDateDesc).slice(0, 200), meetingsPageId: meetingsDb.pageId };
}
