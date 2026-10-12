import { execSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { request } from "@playwright/test";
import { e2eEnv } from "../../playwright.config";
import { ADMIN, MEMBER, stateFile } from "./helpers";

export default async function globalSetup() {
  execSync("npx tsx --conditions=react-server scripts/e2e-seed.ts", { stdio: "inherit", env: { ...process.env, ...e2eEnv } });
  // Sign each user in once and reuse the session, so tests stay under the login rate limit.
  mkdirSync("test-results/.auth", { recursive: true });
  for (const who of [ADMIN, MEMBER]) {
    const ctx = await request.newContext({ baseURL: e2eEnv.APP_URL });
    const res = await ctx.post("/api/auth/sign-in/email", { data: { email: who.email, password: who.password }, headers: { Origin: e2eEnv.APP_URL } });
    if (!res.ok()) throw new Error(`Sign-in failed for ${who.email}: ${res.status()} ${await res.text()}`);
    await ctx.storageState({ path: stateFile(who) });
    await ctx.dispose();
  }
}
