import { expect, test } from "@playwright/test";
import { ADMIN, login } from "./helpers";

test("rejects a wrong password and signs in with the right one", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel("Email").fill(ADMIN.email);
  await page.getByLabel("Password", { exact: true }).fill("wrong-password-x");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Incorrect email or password.")).toBeVisible();
  await login(page);
  await expect(page.getByRole("heading", { name: /Good (morning|afternoon|evening), Asha/ })).toBeVisible();
});

test("API rejects unauthenticated and cross-site requests", async ({ request }) => {
  expect((await request.get("/api/workspaces")).status()).toBe(401);
  const res = await request.post("/api/pages", { data: {}, headers: { Origin: "https://evil.example", "Sec-Fetch-Site": "cross-site" } });
  expect(res.status()).toBe(403);
});
