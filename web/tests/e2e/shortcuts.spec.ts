import { expect, test } from "@playwright/test";
import { ADMIN, editor, newPrivatePage, stateFile, waitSaved } from "./helpers";

test.use({ storageState: stateFile(ADMIN) });

// Top-level blocks with text. The editor always keeps an empty line at the end (Tiptap's
// TrailingNode), so empty blocks are ignored.
const blocks = (page: import("@playwright/test").Page) => editor(page).locator(":scope > *").filter({ hasText: /\S/ });

test("Notion-style editor shortcuts: turn into, duplicate, move, tick, link, comments", async ({ page }) => {
  await newPrivatePage(page, "Shortcut practice");
  await editor(page).click();
  await page.keyboard.type("Alpha");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Bravo");

  // Ctrl+Alt+1 turns the block into a heading; Ctrl+Alt+0 turns it back into text.
  await page.keyboard.press("Control+Alt+1");
  await expect(editor(page).locator("h1", { hasText: "Bravo" })).toBeVisible();
  await page.keyboard.press("Control+Alt+0");
  await expect(editor(page).locator("p", { hasText: "Bravo" })).toBeVisible();

  // Ctrl+Shift+Up moves the block above "Alpha"; Ctrl+D duplicates it.
  await page.keyboard.press("Control+Shift+ArrowUp");
  await expect(blocks(page).first()).toHaveText("Bravo");
  await page.keyboard.press("Control+d");
  await expect(blocks(page)).toHaveText(["Bravo", "Bravo", "Alpha"]);

  // Ctrl+Alt+4 makes a to-do; Ctrl+Enter ticks it.
  await page.keyboard.press("Control+Alt+4");
  const todo = editor(page).getByRole("checkbox", { name: "Task item checkbox for Bravo" });
  await expect(todo).not.toBeChecked();
  await page.keyboard.press("Control+Enter");
  await expect(todo).toBeChecked();

  // Ctrl+K with text selected adds a link (and does not open search).
  await editor(page).locator("p", { hasText: "Alpha" }).click();
  await page.keyboard.press("End");
  await page.keyboard.press("Shift+Home");
  await expect.poll(() => page.evaluate(() => String(window.getSelection()))).toBe("Alpha");
  await page.keyboard.press("Control+k");
  const linkInput = page.getByRole("dialog").getByRole("textbox");
  await linkInput.fill("example.com");
  await page.keyboard.press("Enter");
  await expect(editor(page).locator('a[href="https://example.com"]', { hasText: "Alpha" })).toBeVisible();

  // Everything persists.
  await waitSaved(page);
  await page.reload();
  // The second "Bravo" is now a to-do (its text includes the checkbox label).
  await expect(blocks(page)).toHaveText([/^Bravo$/, /Bravo$/, /^Alpha$/]);
  await expect(editor(page).getByRole("checkbox", { name: "Task item checkbox for Bravo" })).toBeChecked();

  // Ctrl+Alt+M opens the comments panel.
  await editor(page).click();
  await page.keyboard.press("Control+Alt+m");
  await expect(page.getByRole("dialog", { name: /comments/i })).toBeVisible();
});

test("app shortcuts: help list, dark mode, new page", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Control+/");
  await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
  await page.keyboard.press("Escape");

  const dark = () => page.evaluate(() => document.documentElement.classList.contains("dark"));
  const before = await dark();
  await page.keyboard.press("Control+Shift+L");
  await expect.poll(dark).toBe(!before);
  await page.keyboard.press("Control+Shift+L");
  await expect.poll(dark).toBe(before);

  await page.keyboard.press("Control+Alt+n");
  await expect(page).toHaveURL(/\/p\/[0-9a-f-]{36}$/);
});
