import { eq, sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { docFromOutline, type Doc } from "@/lib/doc";
import { db } from "@/server/db";
import { pageVersions, session } from "@/server/db/schema";
import { AppError } from "@/server/errors";
import { getContent, listVersions, restoreVersion, saveContent } from "@/server/services/content";
import { createRow, getDatabaseByPage, queryRows, updateRow } from "@/server/services/databases";
import { convertActionItems, listActionItems, meetingsHub } from "@/server/services/meetings";
import { createPage, listTree, movePage, purgePage, restorePage, setGeneralAccess, setGrant, trashPage } from "@/server/services/pages";
import { Access, pageAccess } from "@/server/services/permissions";
import { search } from "@/server/services/search";
import { createTeamspace, removeMember } from "@/server/services/workspaces";
import { resetDb, seedWorkspace } from "../helpers";

const para = (text: string): Doc => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

async function expectError(p: Promise<unknown>, status: number) {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(AppError);
    expect((e as AppError).status).toBe(status);
    return e as AppError;
  }
  throw new Error(`Expected an error with status ${status}`);
}

beforeAll(async () => {
  await resetDb();
});

describe("workspace bootstrap", () => {
  it("creates the built-in databases and templates without sample rows", async () => {
    const ws = await seedWorkspace(0);
    const tree = await listTree(ws.adminId, ws.workspaceId);
    expect(tree.filter((n) => n.kind === "database").map((n) => n.title).sort()).toEqual(["Meetings", "Projects", "Tasks"]);
    const [{ n }] = await db.execute<{ n: number }>(sql`select count(*)::int as n from pages where workspace_id = ${ws.workspaceId} and kind = 'row'`);
    expect(n).toBe(0);
    const [{ t }] = await db.execute<{ t: number }>(sql`select count(*)::int as t from pages where workspace_id = ${ws.workspaceId} and is_template`);
    expect(t).toBe(8);
  });
});

describe("permissions", () => {
  let ws: Awaited<ReturnType<typeof seedWorkspace>>;
  let member: string;
  let outsider: string;
  beforeEach(async () => {
    await resetDb();
    ws = await seedWorkspace(2);
    member = ws.members[0].id;
    outsider = (await seedWorkspace(0)).adminId; // admin of a different workspace
  });

  it("keeps private pages private, including from search and from admins", async () => {
    const priv = await createPage(member, { workspaceId: ws.workspaceId, section: { type: "private" }, title: "My diary", doc: para("zebra secret plans") });
    expect(await pageAccess(member, priv.id)).toBe(Access.full);
    expect(await pageAccess(ws.adminId, priv.id)).toBe(Access.none);
    expect(await pageAccess(outsider, priv.id)).toBe(Access.none);
    expect((await listTree(ws.adminId, ws.workspaceId)).some((n) => n.id === priv.id)).toBe(false);
    await expectError(getContent(ws.adminId, priv.id), 404);
    expect((await search(member, ws.workspaceId, "zebra")).map((r) => r.id)).toContain(priv.id);
    expect(await search(ws.adminId, ws.workspaceId, "zebra")).toHaveLength(0);
  });

  it("shares workspace pages with members but never with other workspaces", async () => {
    const wiki = await createPage(ws.adminId, { workspaceId: ws.workspaceId, section: { type: "workspace" }, title: "Wiki" });
    const child = await createPage(ws.adminId, { workspaceId: ws.workspaceId, parentId: wiki.id, title: "Onboarding" });
    expect(await pageAccess(member, child.id)).toBe(Access.edit);
    expect(await pageAccess(outsider, child.id)).toBe(Access.none);
    await expectError(createPage(outsider, { workspaceId: ws.workspaceId, parentId: wiki.id }), 404);
  });

  it("restricted sub-pages hide from members until explicitly shared", async () => {
    const wiki = await createPage(ws.adminId, { workspaceId: ws.workspaceId, section: { type: "workspace" }, title: "Wiki" });
    const hr = await createPage(ws.adminId, { workspaceId: ws.workspaceId, parentId: wiki.id, title: "Salaries" });
    const deep = await createPage(ws.adminId, { workspaceId: ws.workspaceId, parentId: hr.id, title: "2026 bands", doc: para("quokka bands") });
    await setGeneralAccess(ws.adminId, hr.id, "none", null);
    expect(await pageAccess(member, hr.id)).toBe(Access.none);
    expect(await pageAccess(member, deep.id)).toBe(Access.none);
    expect(await search(member, ws.workspaceId, "quokka")).toHaveLength(0);

    await setGrant(ws.adminId, hr.id, member, "view", null);
    expect(await pageAccess(member, deep.id)).toBe(Access.view);
    await expectError(saveContent(member, deep.id, { doc: para("x"), baseVersion: 1 }), 403);
    // A member with only edit access cannot change sharing.
    await expectError(setGrant(ws.members[1].id, wiki.id, member, "full", null), 403);
  });

  it("teamspace pages are visible only to teamspace members", async () => {
    const team = await createTeamspace(ws.adminId, ws.workspaceId, { name: "Engineering", memberIds: [member] }, null);
    const page = await createPage(member, { workspaceId: ws.workspaceId, section: { type: "teamspace", teamspaceId: team.id }, title: "Runbook" });
    expect(await pageAccess(member, page.id)).toBe(Access.full);
    expect(await pageAccess(ws.members[1].id, page.id)).toBe(Access.none);
    await expectError(createPage(ws.members[1].id, { workspaceId: ws.workspaceId, section: { type: "teamspace", teamspaceId: team.id } }), 403);
  });

  it("removing a member revokes access and sessions immediately", async () => {
    const wiki = await createPage(ws.adminId, { workspaceId: ws.workspaceId, section: { type: "workspace" }, title: "Wiki" });
    await db.insert(session).values({ userId: member, token: "t1", expiresAt: new Date(Date.now() + 864e5) });
    await removeMember(ws.adminId, ws.workspaceId, member, null);
    expect(await pageAccess(member, wiki.id)).toBe(Access.none);
    expect(await db.select().from(session).where(eq(session.userId, member))).toHaveLength(0);
  });

  it("prevents moving a page inside its own descendant and moving others' pages across sections without full access", async () => {
    const a = await createPage(ws.adminId, { workspaceId: ws.workspaceId, section: { type: "workspace" }, title: "A" });
    const b = await createPage(ws.adminId, { workspaceId: ws.workspaceId, parentId: a.id, title: "B" });
    await expectError(movePage(ws.adminId, a.id, { parentId: b.id }), 400);
    // Member has edit (not full) on A: may not move it into their private section.
    await expectError(movePage(member, a.id, { section: { type: "private" } }), 403);
  });

  it("trash, restore and purge", async () => {
    const a = await createPage(member, { workspaceId: ws.workspaceId, section: { type: "workspace" }, title: "Temp" });
    await trashPage(member, a.id);
    await expectError(getContent(member, a.id), 404);
    await restorePage(member, a.id);
    expect((await getContent(member, a.id)).page.deletedAt).toBeNull();
    await trashPage(member, a.id);
    await expectError(purgePage(ws.members[1].id, a.id), 403); // edit is not enough to purge
    await purgePage(member, a.id);
    await expectError(getContent(member, a.id), 404);
  });
});

describe("conflict-safe editing and history", () => {
  it("rejects stale saves, keeps the newer copy when forcing, and restores as a new version", async () => {
    await resetDb();
    const ws = await seedWorkspace(1);
    const [alice, bob] = [ws.adminId, ws.members[0].id];
    const page = await createPage(alice, { workspaceId: ws.workspaceId, section: { type: "workspace" }, title: "Spec" });

    const s1 = await saveContent(alice, page.id, { doc: para("alice v2"), baseVersion: 1 });
    expect(s1.version).toBe(2);
    // Bob still has version 1 open.
    const err = await expectError(saveContent(bob, page.id, { doc: para("bob edit"), baseVersion: 1 }), 409);
    expect((err.details as { serverVersion: number }).serverVersion).toBe(2);
    expect((await getContent(alice, page.id)).doc).toMatchObject(para("alice v2"));

    // Bob chooses to overwrite: Alice's copy must be preserved in history.
    const s2 = await saveContent(bob, page.id, { doc: para("bob edit"), baseVersion: 1, force: true });
    expect(s2.version).toBe(3);
    const versions = await db.select().from(pageVersions).where(eq(pageVersions.pageId, page.id));
    expect(versions.some((v) => v.reason === "overwritten-in-conflict" && JSON.stringify(v.doc).includes("alice v2"))).toBe(true);

    const aliceVersion = (await listVersions(alice, page.id)).find((v) => v.version === 2)!;
    const restored = await restoreVersion(alice, page.id, aliceVersion.id);
    expect(restored.version).toBe(4);
    expect(JSON.stringify((await getContent(bob, page.id)).doc)).toContain("alice v2");
  });

  it("sanitises unsafe links and image sources", async () => {
    await resetDb();
    const ws = await seedWorkspace(0);
    const page = await createPage(ws.adminId, { workspaceId: ws.workspaceId, section: { type: "private" } });
    const evil: Doc = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "click", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] }] },
        { type: "image", attrs: { src: "http://evil.example/x.png" } },
      ],
    };
    await saveContent(ws.adminId, page.id, { doc: evil, baseVersion: 1 });
    const json = JSON.stringify((await getContent(ws.adminId, page.id)).doc);
    expect(json).not.toContain("javascript:");
    expect(json).not.toContain("evil.example");
  });
});

describe("projects, tasks and meetings", () => {
  it("links tasks to projects and computes progress from real tasks", async () => {
    await resetDb();
    const ws = await seedWorkspace(1);
    const me = ws.adminId;
    const projectsDb = await getDatabaseByPage(me, (await db.execute<{ page_id: string }>(sql`select page_id from databases where id = ${ws.databases.projects}`))[0].page_id);
    const tasksMeta = await db.execute<{ id: string; system_key: string; config: { options?: { id: string; group: string }[] } }>(sql`select id, system_key, config from db_properties where database_id = ${ws.databases.tasks}`);
    const key = (k: string) => tasksMeta.find((p) => p.system_key === k)!;
    const statusOpt = (g: string) => key("status").config.options!.find((o) => o.group === g)!.id;

    const project = await createRow(me, ws.databases.projects, { title: "Website relaunch" });
    const t1 = await createRow(me, ws.databases.tasks, { title: "Design", values: { [key("project").id]: [project.id], [key("status").id]: statusOpt("todo") } });
    await createRow(me, ws.databases.tasks, { title: "Build", values: { [key("project").id]: [project.id], [key("status").id]: statusOpt("todo") } });

    const progressId = projectsDb.properties.find((p) => p.systemKey === "progress")!.id;
    const tasksRelId = projectsDb.properties.find((p) => p.systemKey === "tasks")!.id;
    let rows = (await queryRows(me, ws.databases.projects)).rows;
    expect(rows[0].relations[tasksRelId].map((r) => r.title).sort()).toEqual(["Build", "Design"]);
    expect(rows[0].values[progressId]).toBe(0);

    await updateRow(me, t1.id, { values: { [key("status").id]: statusOpt("done") } });
    rows = (await queryRows(me, ws.databases.projects)).rows;
    expect(rows[0].values[progressId]).toBe(50);

    // Invalid values are rejected.
    await expectError(updateRow(me, t1.id, { values: { [key("status").id]: "not-an-option" } }), 400);
    await expectError(updateRow(me, t1.id, { values: { [key("assignee").id]: ["00000000-0000-4000-8000-000000000000"] } }), 400);
  });

  it("filters tasks using saved views (overdue, my tasks)", async () => {
    await resetDb();
    const ws = await seedWorkspace(1);
    const me = ws.adminId;
    const props = await db.execute<{ id: string; system_key: string; config: { options?: { id: string; group: string }[] } }>(sql`select id, system_key, config from db_properties where database_id = ${ws.databases.tasks}`);
    const key = (k: string) => props.find((p) => p.system_key === k)!;
    const todo = key("status").config.options!.find((o) => o.group === "todo")!.id;
    await createRow(me, ws.databases.tasks, { title: "Late", values: { [key("due").id]: { start: "2000-01-01" }, [key("status").id]: todo, [key("assignee").id]: [me] } });
    await createRow(me, ws.databases.tasks, { title: "Future", values: { [key("due").id]: { start: "2999-01-01" }, [key("status").id]: todo, [key("assignee").id]: [ws.members[0].id] } });
    const views = await db.execute<{ id: string; name: string }>(sql`select id, name from db_views where database_id = ${ws.databases.tasks}`);
    const view = (n: string) => views.find((v) => v.name === n)!.id;
    expect((await queryRows(me, ws.databases.tasks, { viewId: view("Overdue") })).rows.map((r) => r.title)).toEqual(["Late"]);
    expect((await queryRows(me, ws.databases.tasks, { viewId: view("My tasks") })).rows.map((r) => r.title)).toEqual(["Late"]);
    expect((await queryRows(ws.members[0].id, ws.databases.tasks, { viewId: view("My tasks") })).rows.map((r) => r.title)).toEqual(["Future"]);
  });

  it("converts meeting action items to tasks exactly once, even when repeated concurrently", async () => {
    await resetDb();
    const ws = await seedWorkspace(1);
    const me = ws.adminId;
    const meeting = await createRow(me, ws.databases.meetings, { title: "Weekly sync" });
    const doc = docFromOutline([{ h: 2, p: "Decisions" }, { bullets: ["Adopt the new process"] }, { h: 2, p: "Action items" }, { todo: ["Send recap", "Update roadmap"] }]);
    const { version } = await getContent(me, meeting.id);
    await saveContent(me, meeting.id, { doc, baseVersion: version });

    const items = await listActionItems(me, meeting.id);
    expect(items.map((i) => i.text)).toEqual(["Send recap", "Update roadmap"]);
    const req = items.map((i) => ({ blockId: i.blockId, assigneeId: ws.members[0].id }));
    const [r1, r2] = await Promise.all([convertActionItems(me, meeting.id, req), convertActionItems(me, meeting.id, req)]);
    const r3 = await convertActionItems(me, meeting.id, req);
    expect(new Set([...r1, ...r2, ...r3].map((r) => r.taskId)).size).toBe(2);
    expect([...r1, ...r2].filter((r) => r.created)).toHaveLength(2);
    const [{ n }] = await db.execute<{ n: number }>(sql`select count(*)::int as n from pages where database_id = ${ws.databases.tasks}`);
    expect(n).toBe(2);

    // The task links back to its meeting.
    const tasks = (await queryRows(me, ws.databases.tasks)).rows;
    const meetingRel = (await db.execute<{ id: string }>(sql`select id from db_properties where database_id = ${ws.databases.tasks} and system_key = 'meeting'`))[0].id;
    expect(tasks[0].relations[meetingRel][0].id).toBe(meeting.id);

    const hub = await meetingsHub(me, ws.workspaceId);
    expect(hub.decisions.map((d) => d.text)).toEqual(["Adopt the new process"]);
    expect(hub.actionItems).toHaveLength(2);
    expect(hub.actionItems.every((a) => a.task !== null)).toBe(true);
  });
});
