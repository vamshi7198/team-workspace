import { expect, test } from "@playwright/test";

// Runs last: it deliberately exhausts the sign-in rate limit.
test("blocks rapid repeated sign-in attempts", async ({ request }) => {
  const statuses: number[] = [];
  for (let i = 0; i < 8; i++) {
    const r = await request.post("/api/auth/sign-in/email", { data: { email: "attacker@e2e.test", password: `guess-${i}-xxxxxx` }, headers: { Origin: "http://localhost:3100" } });
    statuses.push(r.status());
  }
  expect(statuses).toContain(429);
});
