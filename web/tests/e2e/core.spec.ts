import { expect, test } from "@playwright/test";
import { ADMIN, editor, MEMBER, newPrivatePage, sidebar, stateFile, waitSaved } from "./helpers";

test.describe.configure({ mode: "serial" });
test.use({ storageState: stateFile(ADMIN) });

let privatePageUrl = "";

test("creates a formatted document that survives a reload", async ({ page }) => {
  const id = await newPrivatePage(page, "Launch checklist");
  privatePageUrl = `/p/${id}`;
  await editor(page).click();
  await page.keyboard.type("/heading 2");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Before launch");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/to-do");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Write release notes");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Control+b");
  await page.keyboard.type("zebrafish important");
  await waitSaved(page);

  await page.reload();
  await expect(page.getByLabel("Page title")).toHaveValue("Launch checklist");
  await expect(editor(page).locator("h2", { hasText: "Before launch" })).toBeVisible();
  await expect(editor(page).locator('ul[data-type="taskList"]', { hasText: "Write release notes" })).toBeVisible();
  await expect(editor(page).locator("strong", { hasText: "zebrafish important" })).toBeVisible();
  await expect(sidebar(page).getByRole("link", { name: "Launch checklist" })).toBeVisible();
});

test("exports the page as Markdown", async ({ page }) => {
  const res = await page.request.get(`/api${privatePageUrl.replace("/p/", "/pages/")}/export?format=md`);
  expect(res.status()).toBe(200);
  const md = await res.text();
  expect(md).toContain("# Launch checklist");
  expect(md).toContain("## Before launch");
  expect(md).toContain("- [ ] Write release notes");
  expect(md).toContain("**zebrafish important**");
});

test("finds the page with search (Ctrl+K)", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Control+k");
  await page.getByPlaceholder(/Search pages/).fill("zebrafish");
  const result = page.getByRole("option", { name: /Launch checklist/ });
  await expect(result).toBeVisible();
  await expect(result.locator("mark.hit").first()).toHaveText(/zebrafish/i);
  await result.click();
  await expect(page).toHaveURL(new RegExp(privatePageUrl));
});

test("another member cannot open a private page or find it in search", async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: stateFile(MEMBER) });
  const page = await ctx.newPage();
  await page.goto(privatePageUrl);
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  const res = await page.request.get(`/api${privatePageUrl.replace("/p/", "/pages/")}`);
  expect(res.status()).toBe(404);
  await page.keyboard.press("Control+k");
  await page.getByPlaceholder(/Search pages/).fill("zebrafish");
  await expect(page.getByText(/No results for/)).toBeVisible();
  await ctx.close();
});

test("tasks: add a row, move it on the board, see it in Completed", async ({ page }) => {
  await page.goto("/");
  await sidebar(page).getByRole("link", { name: "Tasks" }).click();
  await expect(page.getByRole("button", { name: "All tasks" })).toBeVisible();
  await page.getByRole("button", { name: "New", exact: true }).first().click();
  await page.getByRole("button", { name: "Edit Task" }).last().click();
  await page.keyboard.type("Prepare demo");
  await page.keyboard.press("Enter");
  await expect(page.locator("table").getByText("Prepare demo")).toBeVisible();
  // New rows default to the first to-do status.
  await expect(page.locator("table").locator("span.tag", { hasText: "Not started" })).toBeVisible();

  await page.getByRole("button", { name: "Board", exact: true }).click();
  const card = page.getByText("Prepare demo", { exact: true });
  await expect(card).toBeVisible();
  const doneHeader = page.locator("span.tag", { hasText: /^Done$/ }).last();
  const from = await card.boundingBox();
  const to = await doneHeader.boundingBox();
  await page.mouse.move(from!.x + 10, from!.y + 5);
  await page.mouse.down();
  await page.mouse.move(from!.x + 30, from!.y + 20, { steps: 5 });
  await page.mouse.move(to!.x + 20, to!.y + 50, { steps: 20 });
  await page.mouse.up();

  await page.getByRole("button", { name: "Completed" }).click();
  await expect(page.locator("table").getByText("Prepare demo")).toBeVisible();
});

test("meeting action items become tasks exactly once", async ({ page }) => {
  await page.goto("/meetings");
  await page.getByRole("button", { name: "New meeting" }).click();
  await page.waitForURL(/\/p\//);
  await expect(editor(page).getByRole("heading", { name: "Action items" })).toBeVisible();
  await editor(page).locator('ul[data-type="taskList"] li p').last().click();
  await page.keyboard.type("Send the recap email");
  await waitSaved(page);
  const panel = page.getByRole("region", { name: "Action items" });
  await expect(panel.getByText("Send the recap email")).toBeVisible({ timeout: 25_000 });
  await panel.getByRole("button", { name: "Create task" }).click();
  await expect(page.getByText("Created 1 task")).toBeVisible();
  await expect(panel.getByRole("link", { name: /Task/ })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("region", { name: "Action items" }).getByRole("link", { name: /Task/ })).toBeVisible();
  await expect(page.getByRole("region", { name: "Action items" }).getByRole("button", { name: "Create task" })).toHaveCount(0);

  await page.getByRole("region", { name: "Action items" }).getByRole("link", { name: /Task/ }).click();
  await expect(page.getByLabel("Page title")).toHaveValue("Send the recap email");
  await expect(page.getByText("Source meeting")).toBeVisible();
});

test("concurrent edits ask before overwriting and keep the other version", async ({ browser }) => {
  const a = await browser.newContext({ storageState: stateFile(ADMIN) });
  const b = await browser.newContext({ storageState: stateFile(ADMIN) });
  const pa = await a.newPage();
  const pb = await b.newPage();
  await pa.goto(privatePageUrl);
  await pb.goto(privatePageUrl);
  await expect(editor(pa)).toBeVisible();
  await expect(editor(pb)).toBeVisible();
  await editor(pa).click();
  await pa.keyboard.press("Control+End");
  await pa.keyboard.type(" edit from A");
  await waitSaved(pa);
  await editor(pb).click();
  await pb.keyboard.press("Control+End");
  await pb.keyboard.type(" edit from B");
  await expect(pb.getByRole("dialog")).toContainText("changed this page while you were editing");
  await pb.getByRole("button", { name: "Keep my version" }).click();
  await waitSaved(pb);
  await pb.getByRole("button", { name: "More page actions" }).click();
  await pb.getByRole("menuitem", { name: "Page history" }).click();
  await expect(pb.getByText(/Replaced in an edit conflict/)).toBeVisible();
  await a.close();
  await b.close();
});
