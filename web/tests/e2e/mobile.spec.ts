import { expect, test } from "@playwright/test";
import { ADMIN, stateFile } from "./helpers";

test.use({ storageState: stateFile(ADMIN) });

test("works on a phone: open navigation, open a page", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Asha/ })).toBeVisible();
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("dialog").getByRole("link", { name: "Projects" }).click();
  await expect(page.getByLabel("Page title")).toHaveValue("Projects");
  // No horizontal page scroll at phone width.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
