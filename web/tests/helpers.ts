import { sql } from "drizzle-orm";
import { db } from "@/server/db";
import { createWorkspaceWithAdmin, createInvitation, acceptInvitation } from "@/server/services/workspaces";

export async function resetDb() {
  const tables = await db.execute<{ tablename: string }>(sql`select tablename from pg_tables where schemaname = 'public'`);
  const names = tables.map((t) => `"${t.tablename}"`).join(", ");
  await db.execute(sql.raw(`truncate ${names} restart identity cascade`));
}

let counter = 0;

/** A workspace with one admin and `members` invited members. */
export async function seedWorkspace(members = 1) {
  const { workspace, user: admin, databases } = await createWorkspaceWithAdmin({
    workspaceName: "Test Co",
    adminEmail: `admin${++counter}@test.local`,
    adminName: "Admin",
    password: "correct-horse-battery",
  });
  const people: { id: string; email: string }[] = [];
  for (let i = 0; i < members; i++) {
    const email = `member${++counter}@test.local`;
    const inv = await createInvitation(admin.id, workspace.id, { email, role: "member" }, null);
    const token = inv.url.split("/invite/")[1];
    await acceptInvitation(token, { name: `Member ${i + 1}`, password: "correct-horse-battery" }, null);
    const [u] = await db.execute<{ id: string }>(sql`select id from "user" where email = ${email}`);
    people.push({ id: u.id, email });
  }
  return { workspaceId: workspace.id, adminId: admin.id, members: people, databases };
}
