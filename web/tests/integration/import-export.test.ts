import { strToU8, unzipSync, zipSync } from "fflate";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { AppError } from "@/server/errors";
import { getContent } from "@/server/services/content";
import { getDatabaseByPage, queryRows } from "@/server/services/databases";
import { exportDatabaseCsv, exportPageMarkdown, exportWorkspaceZip } from "@/server/services/export";
import { openFile, uploadFile } from "@/server/services/files";
import { importArchive, inferColumn, readZip } from "@/server/services/import";
import { createPage } from "@/server/services/pages";
import { resetDb, seedWorkspace } from "../helpers";

// 1x1 transparent PNG
const PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="), (c) => c.charCodeAt(0));
const ID = (n: number) => String(n).padStart(32, "a");

function notionZip() {
  const inner = zipSync({
    [`Export-123/Wiki ${ID(1)}.md`]: strToU8(`# Wiki\n\nWelcome. See [Onboarding](Wiki%20${ID(1)}/Onboarding%20${ID(2)}.md).\n\n![logo](Wiki%20${ID(1)}/logo.png)\n`),
    [`Export-123/Wiki ${ID(1)}/Onboarding ${ID(2)}.md`]: strToU8("# Onboarding\n\n- [ ] Get laptop\n- [x] Sign contract\n"),
    [`Export-123/Wiki ${ID(1)}/logo.png`]: PNG,
    [`Export-123/Tasks ${ID(3)}.csv`]: strToU8("Name,Status,Due,Tags,Points\nWrite docs,Done,\"October 1, 2026\",\"docs, writing\",3\nFix bug,In progress,\"October 20, 2026\",bugs,5\nPlan,Not started,,,\n"),
    [`Export-123/Tasks ${ID(3)}_all.csv`]: strToU8("Name,Status,Due,Tags,Points\nWrite docs,Done,\"October 1, 2026\",\"docs, writing\",3\nFix bug,In progress,\"October 20, 2026\",bugs,5\nPlan,Not started,,,\nArchived one,Done,,,1\n"),
    [`Export-123/Tasks ${ID(3)}/Fix bug ${ID(4)}.md`]: strToU8("# Fix bug\n\nStatus: In progress\nDue: October 20, 2026\n\nThe login button is broken.\n"),
  });
  // Notion wraps large exports in an outer zip.
  return zipSync({ "Export-123-Part-1.zip": inner });
}

describe("import", () => {
  beforeAll(async () => {
    await resetDb();
  });

  it("infers column types", () => {
    expect(inferColumn("Done", ["Yes", "No", ""]).spec.type).toBe("checkbox");
    expect(inferColumn("Points", ["1", "2.5", ""]).spec.type).toBe("number");
    expect(inferColumn("Due", ["October 1, 2026", ""]).spec.type).toBe("date");
    expect(inferColumn("Status", ["Done", "Done", "Todo"]).spec.type).toBe("status");
    expect(inferColumn("Tags", ["a, b", "b", "a"]).spec.type).toBe("multi_select");
    expect(inferColumn("Notes", ["one", "two", "three"]).spec.type).toBe("text");
  });

  it("imports a Notion export: pages, hierarchy, images, links and databases", async () => {
    const ws = await seedWorkspace(1);
    const files = readZip(notionZip());
    const summary = await importArchive(ws.adminId, { workspaceId: ws.workspaceId, files, rootTitle: "Notion import" }, null);
    expect(summary).toMatchObject({ pages: 2, databases: 1, rows: 4, files: 1 });

    const pages = await db.execute<{ id: string; title: string; parent_id: string; kind: string }>(sql`select id, title, parent_id, kind from pages where workspace_id = ${ws.workspaceId} and created_at > now() - interval '1 minute'`);
    const byTitle = (t: string) => pages.find((p) => p.title === t)!;
    expect(byTitle("Onboarding").parent_id).toBe(byTitle("Wiki").id);
    expect(byTitle("Wiki").parent_id).toBe(summary.rootPageId);

    const wiki = JSON.stringify((await getContent(ws.adminId, byTitle("Wiki").id)).doc);
    expect(wiki).toContain(`/p/${byTitle("Onboarding").id}`); // link rewritten to the new page
    expect(wiki).toMatch(/\/api\/files\/[0-9a-f-]{36}/); // image uploaded
    const onboarding = (await getContent(ws.adminId, byTitle("Onboarding").id)).doc;
    expect(JSON.stringify(onboarding)).toContain('"taskItem"');

    const dbMeta = await getDatabaseByPage(ws.adminId, byTitle("Tasks").id);
    const types = Object.fromEntries(dbMeta.properties.map((p) => [p.name, p.type]));
    expect(types).toMatchObject({ Name: "title", Status: "status", Due: "date", Tags: "multi_select", Points: "number" });
    const { rows } = await queryRows(ws.adminId, dbMeta.id);
    expect(rows.map((r) => r.title).sort()).toEqual(["Archived one", "Fix bug", "Plan", "Write docs"]);
    const fix = rows.find((r) => r.title === "Fix bug")!;
    const due = dbMeta.properties.find((p) => p.name === "Due")!;
    expect(fix.values[due.id]).toEqual({ start: "2026-10-20", end: null });
    const body = JSON.stringify((await getContent(ws.adminId, fix.id)).doc);
    expect(body).toContain("The login button is broken.");
    expect(body).not.toContain("Status: In progress"); // property block stripped

    // Imported content is private to the importer.
    await expect(getContent(ws.members[0].id, byTitle("Wiki").id)).rejects.toBeInstanceOf(AppError);
  });
});

describe("files", () => {
  it("accepts allowed types, rejects HTML/SVG, and checks page access on download", async () => {
    await resetDb();
    const ws = await seedWorkspace(1);
    const priv = await createPage(ws.adminId, { workspaceId: ws.workspaceId, section: { type: "private" } });
    const f = await uploadFile(ws.adminId, { pageId: priv.id, name: "pixel.png", data: PNG });
    expect(f.mimeType).toBe("image/png");
    await expect(uploadFile(ws.adminId, { pageId: priv.id, name: "x.html", data: strToU8("<script>alert(1)</script>") })).rejects.toMatchObject({ status: 400 });
    await expect(uploadFile(ws.adminId, { pageId: priv.id, name: "x.svg", data: strToU8('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>') })).rejects.toMatchObject({ status: 400 });
    const txt = await uploadFile(ws.adminId, { pageId: priv.id, name: "notes.txt", data: strToU8("hello") });
    expect(txt.mimeType).toBe("text/plain");
    expect((await openFile(ws.adminId, f.id)).file.id).toBe(f.id);
    await expect(openFile(ws.members[0].id, f.id)).rejects.toMatchObject({ status: 404 });
    await expect(uploadFile(ws.members[0].id, { pageId: priv.id, name: "p.png", data: PNG })).rejects.toMatchObject({ status: 404 });
  });
});

describe("export", () => {
  it("exports Markdown, CSV and a full workspace zip with IDs and files", async () => {
    await resetDb();
    const ws = await seedWorkspace(1);
    const page = await createPage(ws.adminId, { workspaceId: ws.workspaceId, section: { type: "workspace" }, title: "Runbook", doc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Restart the server" }] }] } });
    await uploadFile(ws.adminId, { pageId: page.id, name: "pixel.png", data: PNG });
    const md = await exportPageMarkdown(ws.adminId, page.id);
    expect(md.body).toBe("# Runbook\n\nRestart the server\n");
    const csv = await exportDatabaseCsv(ws.adminId, ws.databases.tasks);
    expect(csv.body.split("\r\n")[0]).toContain("Task");

    await expect(exportWorkspaceZip(ws.members[0].id, ws.workspaceId, null)).rejects.toMatchObject({ status: 403 });
    const stream = await exportWorkspaceZip(ws.adminId, ws.workspaceId, null);
    const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
    const zip = unzipSync(bytes);
    const data = JSON.parse(new TextDecoder().decode(zip["workspace.json"]));
    expect(data.pages.some((p: { id: string }) => p.id === page.id)).toBe(true);
    expect(data.properties.length).toBeGreaterThan(10);
    expect(Object.keys(zip).some((k) => k.startsWith("markdown/Runbook.md"))).toBe(true);
    expect(Object.keys(zip).some((k) => k.startsWith("files/") && k.endsWith("pixel.png"))).toBe(true);
    expect(JSON.stringify(data)).not.toContain("password");
  });
});
