import { and, eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { Doc } from "@/lib/doc";
import { db } from "@/server/db";
import { workspaceMembers } from "@/server/db/schema";
import { AppError } from "@/server/errors";
import { addComment } from "@/server/services/comments";
import { saveContent } from "@/server/services/content";
import { createRow } from "@/server/services/databases";
import { uploadFile } from "@/server/services/files";
import { createPage, setGrant } from "@/server/services/pages";
import { Access, pageAccess, requireCanManage } from "@/server/services/permissions";
import { search } from "@/server/services/search";
import { acceptInvitation, changeRole, createInvitation, removeMember, revokeMemberSessions } from "@/server/services/workspaces";
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

const roleOf = async (workspaceId: string, userId: string) =>
  (await db.select({ role: workspaceMembers.role }).from(workspaceMembers).where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId))))[0]?.role;

describe("workspace roles", () => {
  let ws: Awaited<ReturnType<typeof seedWorkspace>>;
  let owner: string;
  let admin: string;
  let member: string;
  let viewer: string;
  beforeEach(async () => {
    await resetDb();
    ws = await seedWorkspace(3);
    owner = ws.adminId;
    [admin, member, viewer] = ws.members.map((m) => m.id);
    await changeRole(owner, ws.workspaceId, admin, "admin", null);
    await changeRole(owner, ws.workspaceId, viewer, "viewer", null);
  });

  it("makes the workspace creator the one and only owner", async () => {
    expect(await roleOf(ws.workspaceId, owner)).toBe("owner");
    // The database itself refuses a second owner.
    await expect(db.update(workspaceMembers).set({ role: "owner" }).where(eq(workspaceMembers.userId, member))).rejects.toThrow();
  });

  it("gives viewers read-only access everywhere, even with an explicit edit grant", async () => {
    const page = await createPage(member, { workspaceId: ws.workspaceId, section: { type: "workspace" }, title: "Handbook", doc: para("narwhal policy") });
    expect(await pageAccess(member, page.id)).toBe(Access.full);
    expect(await pageAccess(viewer, page.id)).toBe(Access.view);
    expect((await search(viewer, ws.workspaceId, "narwhal")).map((r) => r.id)).toContain(page.id);

    await setGrant(member, page.id, viewer, "edit", null);
    expect(await pageAccess(viewer, page.id)).toBe(Access.view);

    await expectError(saveContent(viewer, page.id, { doc: para("vandalised"), baseVersion: 1 }), 403);
    await expectError(addComment(viewer, page.id, { body: "hello" }), 403);
    await expectError(uploadFile(viewer, { pageId: page.id, name: "a.txt", data: new TextEncoder().encode("hi") }), 403);
    await expectError(createRow(viewer, ws.databases.tasks, { title: "Sneaky task" }), 403);
    await expectError(createPage(viewer, { workspaceId: ws.workspaceId, section: { type: "private" }, title: "Mine" }), 403);
    await expectError(createPage(viewer, { workspaceId: ws.workspaceId, parentId: page.id, title: "Child" }), 403);
  });

  it("demoting someone to viewer makes even their own pages read-only; promoting restores it", async () => {
    const page = await createPage(member, { workspaceId: ws.workspaceId, section: { type: "private" }, title: "Notes" });
    await changeRole(owner, ws.workspaceId, member, "viewer", null);
    expect(await pageAccess(member, page.id)).toBe(Access.view);
    await changeRole(owner, ws.workspaceId, member, "member", null);
    expect(await pageAccess(member, page.id)).toBe(Access.full);
  });

  it("stops admins from managing the owner or other admins (no account takeover)", async () => {
    const otherAdmin = member;
    await changeRole(owner, ws.workspaceId, otherAdmin, "admin", null);
    await expectError(requireCanManage(admin, ws.workspaceId, owner), 403); // also guards the password reset link
    await expectError(requireCanManage(admin, ws.workspaceId, otherAdmin), 403);
    await expectError(changeRole(admin, ws.workspaceId, owner, "member", null), 403);
    await expectError(changeRole(admin, ws.workspaceId, otherAdmin, "member", null), 403);
    await expectError(removeMember(admin, ws.workspaceId, owner, null), 403);
    await expectError(revokeMemberSessions(admin, ws.workspaceId, otherAdmin, null), 403);
    await expectError(changeRole(admin, ws.workspaceId, viewer, "admin", null), 403);
    await expectError(createInvitation(admin, ws.workspaceId, { email: "new-admin@test.local", role: "admin" }, null), 403);
    // Admins still manage members and viewers.
    await changeRole(admin, ws.workspaceId, viewer, "member", null);
    expect(await roleOf(ws.workspaceId, viewer)).toBe("member");
    await createInvitation(admin, ws.workspaceId, { email: "new-viewer@test.local", role: "viewer" }, null);
  });

  it("members and viewers can't manage anyone", async () => {
    await expectError(changeRole(member, ws.workspaceId, viewer, "member", null), 403);
    await expectError(createInvitation(viewer, ws.workspaceId, { email: "x@test.local", role: "member" }, null), 403);
  });

  it("transfers ownership: the new owner takes over, the old owner becomes an admin", async () => {
    await expectError(changeRole(owner, ws.workspaceId, owner, "member", null), 403);
    await changeRole(owner, ws.workspaceId, admin, "owner", null);
    expect(await roleOf(ws.workspaceId, admin)).toBe("owner");
    expect(await roleOf(ws.workspaceId, owner)).toBe("admin");
    const [{ n }] = await db.execute<{ n: number }>(sql`select count(*)::int as n from workspace_members where workspace_id = ${ws.workspaceId} and role = 'owner'`);
    expect(n).toBe(1);
    // The former owner is now an ordinary admin and can't act on the new owner.
    await expectError(removeMember(owner, ws.workspaceId, admin, null), 403);
  });

  it("an invitation accepted by an existing member never downgrades the owner", async () => {
    const inv = await createInvitation(owner, ws.workspaceId, { email: "late@test.local", role: "viewer" }, null);
    await acceptInvitation(inv.url.split("/invite/")[1], { name: "Late", password: "correct-horse-battery" }, null);
    const [u] = await db.execute<{ id: string }>(sql`select id from "user" where email = 'late@test.local'`);
    expect(await roleOf(ws.workspaceId, u.id)).toBe("viewer");
    expect(await roleOf(ws.workspaceId, owner)).toBe("owner");
  });
});
