// Built-in structure for a new workspace: the Projects, Tasks and Meetings databases
// (schemas and views only, no sample rows) and the starter templates.
import { docFromOutline, type Doc } from "@/lib/doc";
import type { SelectOption } from "@/lib/db-engine/types";
import type { DbOrTx } from "../db";
import { dbProperties } from "../db/schema";
import { createDatabase, insertRelationProperty } from "./databases";
import { createPage } from "./pages";
import { eq } from "drizzle-orm";

const opt = (name: string, color: SelectOption["color"], group?: SelectOption["group"]): SelectOption => ({ id: crypto.randomUUID(), name, color, group });

const priority = () => [opt("Low", "gray"), opt("Medium", "yellow"), opt("High", "orange"), opt("Urgent", "red")];

export const MEETING_TEMPLATE: Doc = docFromOutline([
  { h: 2, p: "Agenda" },
  { bullets: [""] },
  { h: 2, p: "Notes" },
  { p: "" },
  { h: 2, p: "Decisions" },
  { bullets: [""] },
  { h: 2, p: "Action items" },
  { todo: [""] },
]);

export const TEMPLATES: { title: string; icon: string; doc: Doc }[] = [
  { title: "Meeting notes", icon: "🗓️", doc: MEETING_TEMPLATE },
  {
    title: "Project brief",
    icon: "🚀",
    doc: docFromOutline([
      { callout: "One paragraph: what are we doing and why now?" },
      { h: 2, p: "Problem" }, { p: "" },
      { h: 2, p: "Goals" }, { bullets: [""] },
      { h: 2, p: "Non-goals" }, { bullets: [""] },
      { h: 2, p: "Scope and milestones" }, { todo: [""] },
      { h: 2, p: "Risks" }, { bullets: [""] },
      { h: 2, p: "Stakeholders" }, { bullets: [""] },
    ]),
  },
  {
    title: "Weekly status update",
    icon: "📈",
    doc: docFromOutline([
      { h: 2, p: "Highlights" }, { bullets: [""] },
      { h: 2, p: "Progress against plan" }, { p: "" },
      { h: 2, p: "Blockers" }, { bullets: [""] },
      { h: 2, p: "Next week" }, { todo: [""] },
    ]),
  },
  {
    title: "Standard operating procedure",
    icon: "📋",
    doc: docFromOutline([
      { callout: "Owner, last reviewed date and how often this SOP is reviewed." },
      { h: 2, p: "Purpose" }, { p: "" },
      { h: 2, p: "Scope" }, { p: "" },
      { h: 2, p: "Prerequisites" }, { bullets: [""] },
      { h: 2, p: "Procedure" }, { todo: ["Step 1", "Step 2"] },
      { h: 2, p: "Exceptions and escalation" }, { p: "" },
    ]),
  },
  {
    title: "Product requirements document",
    icon: "🧩",
    doc: docFromOutline([
      { h: 2, p: "Background" }, { p: "" },
      { h: 2, p: "Users and problems" }, { bullets: [""] },
      { h: 2, p: "Requirements" }, { todo: [""] },
      { h: 2, p: "Out of scope" }, { bullets: [""] },
      { h: 2, p: "Success metrics" }, { bullets: [""] },
      { h: 2, p: "Open questions" }, { bullets: [""] },
    ]),
  },
  {
    title: "Decision log",
    icon: "⚖️",
    doc: docFromOutline([
      { h: 2, p: "Context" }, { p: "" },
      { h: 2, p: "Options considered" }, { bullets: [""] },
      { h: 2, p: "Decisions" }, { bullets: [""] },
      { h: 2, p: "Consequences" }, { p: "" },
    ]),
  },
  {
    title: "Retrospective",
    icon: "🔁",
    doc: docFromOutline([
      { h: 2, p: "What went well" }, { bullets: [""] },
      { h: 2, p: "What didn't go well" }, { bullets: [""] },
      { h: 2, p: "What we'll try next" }, { bullets: [""] },
      { h: 2, p: "Action items" }, { todo: [""] },
    ]),
  },
  {
    title: "Team onboarding",
    icon: "👋",
    doc: docFromOutline([
      { callout: "Welcome! Work through this checklist in your first two weeks." },
      { h: 2, p: "Week 1" }, { todo: ["Get accounts set up", "Meet the team", "Read the company wiki"] },
      { h: 2, p: "Week 2" }, { todo: ["Shadow a project", "Ship a first small change"] },
      { h: 2, p: "Useful links" }, { bullets: [""] },
      { h: 2, p: "Who to ask" }, { bullets: [""] },
    ]),
  },
];

/** Creates templates and the built-in databases. Runs inside the workspace-creation transaction. */
export async function bootstrapWorkspace(tx: DbOrTx, workspaceId: string, adminId: string) {
  for (const t of TEMPLATES) {
    await createPage(adminId, { workspaceId, title: t.title, icon: t.icon, doc: t.doc, isTemplate: true }, tx);
  }
  const workspace = { type: "workspace" as const };

  const projects = await createDatabase(adminId, {
    workspaceId,
    section: workspace,
    title: "Projects",
    icon: "🚀",
    systemKey: "projects",
    titleName: "Project name",
    rowTemplate: TEMPLATES[1].doc,
    properties: [
      { key: "status", name: "Status", type: "status", config: { options: [opt("Planned", "gray", "todo"), opt("Active", "blue", "in_progress"), opt("On hold", "yellow", "in_progress"), opt("Completed", "green", "done"), opt("Cancelled", "red", "done")] } },
      { key: "owner", name: "Owner", type: "person" },
      { key: "start", name: "Start date", type: "date" },
      { key: "due", name: "Due date", type: "date" },
      { key: "priority", name: "Priority", type: "select", config: { options: priority() } },
      { key: "description", name: "Description", type: "text" },
      { key: "created", name: "Created", type: "created_time" },
      { key: "updated", name: "Updated", type: "edited_time" },
    ],
    views: [
      { name: "All projects", type: "table" },
      { name: "Board", type: "board", config: { groupBy: "key:status" } },
      { name: "Active", type: "table", config: { filter: { mode: "and", conditions: [{ propertyId: "key:status", op: "is_not_done" }] }, sorts: [{ propertyId: "key:due", direction: "asc" }] } },
      { name: "Calendar", type: "calendar", config: { dateProperty: "key:due" } },
    ],
  }, tx);

  const tasks = await createDatabase(adminId, {
    workspaceId,
    section: workspace,
    title: "Tasks",
    icon: "✅",
    systemKey: "tasks",
    titleName: "Task",
    rowTemplate: docFromOutline([{ h: 2, p: "Description" }, { p: "" }, { h: 2, p: "Related documents" }, { bullets: [""] }]),
    properties: [
      { key: "status", name: "Status", type: "status", config: { options: [opt("Not started", "gray", "todo"), opt("In progress", "blue", "in_progress"), opt("Blocked", "red", "in_progress"), opt("Done", "green", "done")] } },
      { key: "assignee", name: "Assignee", type: "person" },
      { key: "priority", name: "Priority", type: "select", config: { options: priority() } },
      { key: "due", name: "Due date", type: "date" },
      { key: "created_by", name: "Created by", type: "created_by" },
      { key: "updated", name: "Last updated", type: "edited_time" },
    ],
    views: [
      { name: "All tasks", type: "table", config: { sorts: [{ propertyId: "key:due", direction: "asc" }] } },
      { name: "Board", type: "board", config: { groupBy: "key:status" } },
      { name: "My tasks", type: "list", config: { filter: { mode: "and", conditions: [{ propertyId: "key:assignee", op: "contains", value: "me" }, { propertyId: "key:status", op: "is_not_done" }] }, sorts: [{ propertyId: "key:due", direction: "asc" }] } },
      { name: "Overdue", type: "table", config: { filter: { mode: "and", conditions: [{ propertyId: "key:due", op: "before", value: "today" }, { propertyId: "key:status", op: "is_not_done" }] }, sorts: [{ propertyId: "key:due", direction: "asc" }] } },
      { name: "Due soon", type: "table", config: { filter: { mode: "and", conditions: [{ propertyId: "key:due", op: "within_next_days", value: 7 }, { propertyId: "key:status", op: "is_not_done" }] }, sorts: [{ propertyId: "key:due", direction: "asc" }] } },
      { name: "Completed", type: "table", config: { filter: { mode: "and", conditions: [{ propertyId: "key:status", op: "is_done" }] }, sorts: [{ propertyId: "key:updated", direction: "desc" }] } },
      { name: "Calendar", type: "calendar", config: { dateProperty: "key:due" } },
    ],
  }, tx);

  const meetings = await createDatabase(adminId, {
    workspaceId,
    section: workspace,
    title: "Meetings",
    icon: "🗓️",
    systemKey: "meetings",
    titleName: "Meeting",
    rowTemplate: MEETING_TEMPLATE,
    properties: [
      { key: "date", name: "Date", type: "date", config: { includeTime: true } },
      { key: "participants", name: "Participants", type: "person" },
      { key: "type", name: "Type", type: "select", config: { options: [opt("Standup", "blue"), opt("Planning", "purple"), opt("Review", "green"), opt("1:1", "orange"), opt("Client", "pink"), opt("Other", "gray")] } },
      { key: "created_by", name: "Created by", type: "created_by" },
    ],
    views: [
      { name: "Recent", type: "table", config: { filter: { mode: "and", conditions: [{ propertyId: "key:date", op: "on_or_before", value: "today" }] }, sorts: [{ propertyId: "key:date", direction: "desc" }] } },
      { name: "Upcoming", type: "table", config: { filter: { mode: "and", conditions: [{ propertyId: "key:date", op: "on_or_after", value: "today" }] }, sorts: [{ propertyId: "key:date", direction: "asc" }] } },
      { name: "Calendar", type: "calendar", config: { dateProperty: "key:date" } },
      { name: "All meetings", type: "table", config: { sorts: [{ propertyId: "key:date", direction: "desc" }] } },
    ],
  }, tx);

  // Relations between the built-in databases.
  const taskProject = await insertRelationProperty(tx, { databaseId: tasks.database.id, targetDatabaseId: projects.database.id, name: "Project", reverseName: "Tasks", key: "project", reverseKey: "tasks" });
  await insertRelationProperty(tx, { databaseId: tasks.database.id, targetDatabaseId: meetings.database.id, name: "Source meeting", reverseName: "Action item tasks", key: "meeting", reverseKey: "action_tasks" });
  await insertRelationProperty(tx, { databaseId: meetings.database.id, targetDatabaseId: projects.database.id, name: "Project", reverseName: "Meetings", key: "project", reverseKey: "meetings" });

  // Project progress = % of related tasks whose status is in the "done" group.
  const [taskStatus] = await tx.select().from(dbProperties).where(eq(dbProperties.id, tasks.keyToId.status));
  await tx.insert(dbProperties).values({
    databaseId: projects.database.id,
    name: "Progress",
    type: "rollup",
    systemKey: "progress",
    position: 50,
    config: { relationPropertyId: taskProject.reverse!.id, targetPropertyId: taskStatus.id, rollup: "percent_where", whereValue: "__done__", numberFormat: "percent" },
  });

  return { projects: projects.database.id, tasks: tasks.database.id, meetings: meetings.database.id };
}
