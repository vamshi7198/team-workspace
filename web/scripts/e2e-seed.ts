// Resets the E2E database and creates: an admin, a member, and the built-in structure.
// Refuses to run against anything that isn't an *_e2e database.
import { execSync } from "node:child_process";
import postgres from "postgres";
import { ensureDatabase } from "./ensure-db";

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  if (!/_e2e\b/.test(url)) throw new Error(`Refusing to reset a non-e2e database: ${url}`);
  await ensureDatabase(url);
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  await sql`drop schema if exists public cascade`;
  await sql`drop schema if exists drizzle cascade`;
  await sql`create schema public`;
  await sql.end();
  execSync("npx tsx scripts/migrate.ts", { stdio: "inherit", env: process.env });

  const { createWorkspaceWithAdmin, createInvitation, acceptInvitation } = await import("../src/server/services/workspaces");
  const { workspace, user } = await createWorkspaceWithAdmin({ workspaceName: "E2E Co", adminEmail: "admin@e2e.test", adminName: "Asha Admin", password: "e2e-password-123" });
  const inv = await createInvitation(user.id, workspace.id, { email: "member@e2e.test", role: "member" }, null);
  await acceptInvitation(inv.url.split("/invite/")[1], { name: "Manoj Member", password: "e2e-password-123" }, null);
  console.log("E2E seed complete");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
