// First-run setup: creates the workspace and its first admin account.
//   npm run setup -- --workspace "Uncanned" --email you@uncanned.in --name "Your Name"
// The password is read from ADMIN_PASSWORD or prompted for (not echoed).
import { config } from "dotenv";
import { createInterface } from "node:readline";
import { parseArgs } from "node:util";

config({ path: ".env.local", quiet: true });
config({ quiet: true });

function promptHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const out = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream };
    out._writeToOutput = (s: string) => {
      if (s.includes(question)) out.output.write(s);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
  });
}

async function main() {
  const { values } = parseArgs({
    options: { workspace: { type: "string" }, email: { type: "string" }, name: { type: "string" } },
  });
  if (!values.workspace || !values.email || !values.name) {
    console.error('Usage: npm run setup -- --workspace "Name" --email admin@example.com --name "Admin Name"');
    process.exit(1);
  }
  const { db } = await import("../src/server/db");
  const { workspaces } = await import("../src/server/db/schema");
  const existing = await db.select().from(workspaces).limit(1);
  if (existing.length && !process.argv.includes("--another")) {
    console.error("A workspace already exists. Invite people from Settings > Members instead (or pass --another).");
    process.exit(1);
  }
  const password = process.env.ADMIN_PASSWORD || (await promptHidden("Admin password (min 10 characters): "));
  const { createWorkspaceWithAdmin } = await import("../src/server/services/workspaces");
  const res = await createWorkspaceWithAdmin({ workspaceName: values.workspace, adminEmail: values.email, adminName: values.name, password });
  console.log(`Created workspace "${res.workspace.name}" owned by ${res.user.email}.`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Setup failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
