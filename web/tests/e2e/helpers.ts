import { expect, type Page } from "@playwright/test";

export const ADMIN = { email: "admin@e2e.test", password: "e2e-password-123", name: "Asha Admin" };
export const MEMBER = { email: "member@e2e.test", password: "e2e-password-123", name: "Manoj Member" };
export const stateFile = (who: { email: string }) => `test-results/.auth/${who.email}.json`;

/** Signs in through the UI (only used by the sign-in test; others reuse saved sessions). */
export async function login(page: Page, who = ADMIN) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(who.email);
  await page.getByLabel("Password", { exact: true }).fill(who.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("navigation", { name: "Workspace" }).first()).toBeVisible();
}

export const sidebar = (page: Page) => page.getByRole("navigation", { name: "Workspace" }).first();
export const editor = (page: Page) => page.locator(".doc .ProseMirror").first();

export async function waitSaved(page: Page) {
  await expect(page.getByText("Saved", { exact: true }).first()).toBeVisible({ timeout: 20_000 });
}

export async function newPrivatePage(page: Page, title: string) {
  await page.goto("/");
  await sidebar(page).getByRole("button", { name: "New page", exact: true }).click();
  await page.waitForURL(/\/p\/[0-9a-f-]{36}/);
  const titleBox = page.getByLabel("Page title");
  await titleBox.fill(title);
  await titleBox.press("Enter");
  return page.url().split("/p/")[1];
}
