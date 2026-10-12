import "server-only";
import { desc, eq, sql } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { PROPERTY_TYPES, VIEW_TYPES, GENERAL_ACCESS } from "../db/schema";
import { activity, user } from "../db/schema";
import { db } from "../db";
import { getAuth, resetLinkCapture } from "../auth";
import { env } from "../env";
import { badRequest } from "../errors";
import { body, query, type Ctx } from "../http";
import { audit } from "../services/audit";
import * as content from "../services/content";
import * as comments from "../services/comments";
import * as dbs from "../services/databases";
import * as exp from "../services/export";
import * as filesSvc from "../services/files";
import * as home from "../services/home";
import * as imp from "../services/import";
import * as meetings from "../services/meetings";
import * as pages from "../services/pages";
import { Access, requireAdmin, requireMember, requirePage } from "../services/permissions";
import * as presence from "../services/presence";
import * as searchSvc from "../services/search";
import * as ws from "../services/workspaces";
import { Router } from "./router";

const uuid = z.string().uuid();
const section = z.discriminatedUnion("type", [
  z.object({ type: z.literal("private") }),
  z.object({ type: z.literal("workspace") }),
  z.object({ type: z.literal("teamspace"), teamspaceId: uuid }),
]);
const accessName = z.enum(["none", "view", "comment", "edit", "full"]);
const filterSchema = z.object({
  mode: z.enum(["and", "or"]),
  conditions: z.array(z.object({ propertyId: z.string(), op: z.string(), value: z.any().optional() })).max(30),
});
const viewConfig = z.object({
  filter: filterSchema.optional(),
  sorts: z.array(z.object({ propertyId: z.string(), direction: z.enum(["asc", "desc"]) })).max(10).optional(),
  groupBy: z.string().nullable().optional(),
  propertyOrder: z.array(z.string()).optional(),
  hidden: z.array(z.string()).optional(),
  widths: z.record(z.string(), z.number().min(40).max(1200)).optional(),
  dateProperty: z.string().nullable().optional(),
  hideEmptyGroups: z.boolean().optional(),
});
const propertyConfig = z.record(z.string(), z.any());

const download = (filename: string, body: BodyInit, type: string) =>
  new NextResponse(body, {
    headers: {
      "Content-Type": type,
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "no-store",
    },
  });

async function readUpload(req: NextRequest, field = "file") {
  const form = await req.formData().catch(() => {
    throw badRequest("Expected a file upload");
  });
  const list = form.getAll(field).filter((f): f is File => typeof f !== "string");
  if (!list.length) throw badRequest("No file uploaded");
  return { form, files: list };
}

export const router = new Router()
  // ---- public ----------------------------------------------------------------
  .public("GET", "/health", async () => {
    await db.execute(sql`select 1`);
    return { ok: true, time: new Date().toISOString() };
  })
  .public("GET", "/invitations/:token", async (_req, _ctx, p) => ws.describeInvitation(p.token))
  .public("POST", "/invitations/:token", async (req, ctx, p) => {
    const b = await body(req, z.object({ name: z.string().max(100).optional(), password: z.string().max(128).optional() }));
    return ws.acceptInvitation(p.token, { ...b, signedInUserId: ctx?.userId ?? null }, ctx?.ip ?? null);
  })

  // ---- me & workspaces ------------------------------------------------------
  .get("/me", async (_req, ctx) => ({ user: ctx.user, workspaces: await ws.listMyWorkspaces(ctx.userId) }))
  .get("/workspaces", async (_req, ctx) => ws.listMyWorkspaces(ctx.userId))
  .patch("/workspaces/:ws", async (req, ctx, p) => {
    const b = await body(req, z.object({ name: z.string().min(1).max(100) }));
    await ws.renameWorkspace(ctx.userId, p.ws, b.name, ctx.ip);
  })
  .get("/workspaces/:ws/tree", async (_req, ctx, p) => pages.listTree(ctx.userId, p.ws))
  .get("/workspaces/:ws/home", async (_req, ctx, p) => home.homeData(ctx.userId, p.ws))
  .get("/workspaces/:ws/favorites", async (_req, ctx, p) => pages.listFavorites(ctx.userId, p.ws))
  .get("/workspaces/:ws/recent", async (_req, ctx, p) => pages.listRecent(ctx.userId, p.ws, 20))
  .get("/workspaces/:ws/trash", async (_req, ctx, p) => pages.listTrash(ctx.userId, p.ws))
  .get("/workspaces/:ws/archived", async (_req, ctx, p) => pages.listArchived(ctx.userId, p.ws))
  .get("/workspaces/:ws/templates", async (_req, ctx, p) => {
    await requireMember(ctx.userId, p.ws);
    return db.execute(sql`
      select id, title, icon from pages where workspace_id = ${p.ws} and is_template and deleted_at is null
        and page_access(${ctx.userId}::uuid, id) >= 1 order by title`);
  })
  .get("/workspaces/:ws/databases", async (_req, ctx, p) => {
    await requireMember(ctx.userId, p.ws);
    return db.execute(sql`
      select d.id, d.page_id, p.title, p.icon, d.system_key from databases d join pages p on p.id = d.page_id
      where d.workspace_id = ${p.ws} and p.deleted_at is null and page_access(${ctx.userId}::uuid, p.id) >= 1 order by p.title`);
  })
  .get("/workspaces/:ws/search", async (req, ctx, p) => {
    const q = query(req, z.object({ q: z.string().max(200).default("") }));
    return searchSvc.search(ctx.userId, p.ws, q.q);
  })
  .get("/workspaces/:ws/suggest", async (req, ctx, p) => {
    const q = query(req, z.object({ q: z.string().max(100).default("") }));
    const [pagesFound, people] = await Promise.all([searchSvc.suggestPages(ctx.userId, p.ws, q.q, 8), ws.listMembers(ctx.userId, p.ws)]);
    const needle = q.q.toLowerCase();
    return {
      pages: pagesFound,
      people: people.filter((m) => !m.disabledAt && (m.name.toLowerCase().includes(needle) || m.email.toLowerCase().includes(needle))).slice(0, 6).map((m) => ({ id: m.id, name: m.name, email: m.email })),
    };
  })
  .get("/workspaces/:ws/meetings", async (_req, ctx, p) => meetings.meetingsHub(ctx.userId, p.ws))
  .get("/workspaces/:ws/activity", async (_req, ctx, p) => {
    await requireMember(ctx.userId, p.ws);
    return db.execute(sql`
      select a.id, a.action, a.created_at, a.page_id, pg.title, pg.icon, u.name as actor from activity a
      join pages pg on pg.id = a.page_id left join "user" u on u.id = a.actor_id
      where a.workspace_id = ${p.ws} and pg.deleted_at is null and page_access(${ctx.userId}::uuid, a.page_id) >= 1
      order by a.created_at desc limit 50`);
  })

  // ---- members, invitations, teamspaces, admin ---------------------------------
  .get("/workspaces/:ws/members", async (_req, ctx, p) => ws.listMembers(ctx.userId, p.ws))
  .patch("/workspaces/:ws/members/:user", async (req, ctx, p) => {
    const b = await body(req, z.object({ role: z.enum(["admin", "member"]) }));
    await ws.changeRole(ctx.userId, p.ws, p.user, b.role, ctx.ip);
  })
  .delete("/workspaces/:ws/members/:user", async (_req, ctx, p) => ws.removeMember(ctx.userId, p.ws, p.user, ctx.ip))
  .delete("/workspaces/:ws/members/:user/sessions", async (_req, ctx, p) => ws.revokeMemberSessions(ctx.userId, p.ws, p.user, ctx.ip))
  .post("/workspaces/:ws/members/:user/reset-link", async (_req, ctx, p) => {
    // For teams without email: the admin generates a one-time reset link to hand over.
    await requireAdmin(ctx.userId, p.ws);
    await requireMember(p.user, p.ws);
    const [target] = await db.select({ email: user.email }).from(user).where(eq(user.id, p.user));
    const capture: { url?: string } = {};
    await resetLinkCapture.run(capture, () =>
      getAuth().api.requestPasswordReset({ body: { email: target.email, redirectTo: `${env().APP_URL}/reset-password` } }),
    );
    await audit({ workspaceId: p.ws, actorId: ctx.userId, action: "member.reset_link_created", target: p.user, ip: ctx.ip });
    if (!capture.url) throw badRequest("Could not create a reset link");
    return { url: capture.url };
  })
  .get("/workspaces/:ws/invitations", async (_req, ctx, p) => ws.listInvitations(ctx.userId, p.ws))
  .post("/workspaces/:ws/invitations", async (req, ctx, p) => {
    const b = await body(req, z.object({ email: z.string().email().max(200), role: z.enum(["admin", "member"]).default("member") }));
    return ws.createInvitation(ctx.userId, p.ws, b, ctx.ip);
  })
  .delete("/workspaces/:ws/invitations/:id", async (_req, ctx, p) => ws.revokeInvitation(ctx.userId, p.ws, p.id, ctx.ip))
  .get("/workspaces/:ws/teamspaces", async (_req, ctx, p) => ws.listTeamspaces(ctx.userId, p.ws))
  .post("/workspaces/:ws/teamspaces", async (req, ctx, p) => {
    const b = await body(req, z.object({ name: z.string().min(1).max(100), icon: z.string().max(16).nullable().optional(), memberIds: z.array(uuid).max(200).optional() }));
    return ws.createTeamspace(ctx.userId, p.ws, b, ctx.ip);
  })
  .get("/workspaces/:ws/teamspaces/:team/members", async (_req, ctx, p) => ws.teamspaceMemberIds(ctx.userId, p.ws, p.team))
  .post("/workspaces/:ws/teamspaces/:team/members", async (req, ctx, p) => {
    const b = await body(req, z.object({ userId: uuid, member: z.boolean() }));
    await ws.setTeamspaceMember(ctx.userId, p.ws, p.team, b.userId, b.member, ctx.ip);
  })
  .get("/workspaces/:ws/audit", async (_req, ctx, p) => ws.listAudit(ctx.userId, p.ws))
  .get("/workspaces/:ws/export", async (_req, ctx, p) => {
    const stream = await exp.exportWorkspaceZip(ctx.userId, p.ws, ctx.ip);
    return download(`workspace-export-${new Date().toISOString().slice(0, 10)}.zip`, stream, "application/zip");
  })
  .post("/workspaces/:ws/import", async (req, ctx, p) => {
    const { form, files } = await readUpload(req, "file");
    const max = Number(process.env.IMPORT_MAX_MB ?? 300) * 1024 * 1024;
    const total = files.reduce((n, f) => n + f.size, 0);
    if (total > max) throw badRequest(`Imports are limited to ${max / 1024 / 1024} MB`);
    let entries: Map<string, Uint8Array>;
    if (files.length === 1 && files[0].name.toLowerCase().endsWith(".zip")) {
      entries = imp.readZip(new Uint8Array(await files[0].arrayBuffer()));
    } else {
      if (!files.every((f) => /\.(md|markdown|txt)$/i.test(f.name))) throw badRequest("Upload a .zip export or Markdown files");
      entries = imp.filesFromMarkdown(await Promise.all(files.map(async (f) => ({ name: f.name.replace(/\.(markdown|txt)$/i, ".md"), data: new Uint8Array(await f.arrayBuffer()) }))));
    }
    const parentId = form.get("parentId");
    return imp.importArchive(ctx.userId, {
      workspaceId: p.ws,
      files: entries,
      rootTitle: String(form.get("title") || `Import ${new Date().toISOString().slice(0, 10)}`).slice(0, 200),
      parentId: typeof parentId === "string" && parentId ? parentId : null,
    }, ctx.ip);
  })

  // ---- pages -------------------------------------------------------------------
  .post("/pages", async (req, ctx) => {
    const b = await body(req, z.object({
      workspaceId: uuid,
      parentId: uuid.nullable().optional(),
      section: section.optional(),
      title: z.string().max(500).optional(),
      icon: z.string().max(16).nullable().optional(),
      templateId: uuid.nullable().optional(),
      isTemplate: z.boolean().optional(),
    }));
    if (b.isTemplate) await requireMember(ctx.userId, b.workspaceId);
    const page = await pages.createPage(ctx.userId, b);
    return { id: page.id };
  })
  .get("/pages/:id", async (_req, ctx, p) => {
    const c = await content.getContent(ctx.userId, p.id);
    const [crumbs, fav, sharing] = await Promise.all([
      pages.breadcrumbs(ctx.userId, p.id),
      db.execute<{ on: boolean }>(sql`select exists(select 1 from favorites where user_id = ${ctx.userId} and page_id = ${p.id}) as on`),
      pages.getSharing(ctx.userId, p.id),
    ]);
    await pages.recordVisit(ctx.userId, p.id);
    const [creator] = c.page.createdBy ? await db.select({ name: user.name }).from(user).where(eq(user.id, c.page.createdBy)) : [];
    return {
      page: {
        id: c.page.id,
        workspaceId: c.page.workspaceId,
        parentId: c.page.parentId,
        kind: c.page.kind,
        title: c.page.title,
        icon: c.page.icon,
        coverFileId: c.page.coverFileId,
        databaseId: c.page.databaseId,
        isTemplate: c.page.isTemplate,
        archivedAt: c.page.archivedAt,
        createdAt: c.page.createdAt,
        updatedAt: c.page.updatedAt,
        createdByName: creator?.name ?? null,
        generalAccess: c.page.generalAccess,
      },
      access: c.level,
      doc: c.doc,
      version: c.version,
      contentUpdatedAt: c.updatedAt,
      contentUpdatedByName: c.updatedByName,
      breadcrumbs: crumbs,
      favorite: Boolean(fav[0]?.on),
      shared: sharing.grants.length > 0 || sharing.effectiveGeneralAccess !== "none",
    };
  })
  .patch("/pages/:id", async (req, ctx, p) => {
    const b = await body(req, z.object({ title: z.string().max(500).optional(), icon: z.string().max(16).nullable().optional(), coverFileId: uuid.nullable().optional() }));
    const page = await pages.updatePageMeta(ctx.userId, p.id, b);
    return { id: page.id, title: page.title, icon: page.icon, coverFileId: page.coverFileId };
  })
  .delete("/pages/:id", async (_req, ctx, p) => pages.trashPage(ctx.userId, p.id))
  .get("/pages/:id/version", async (_req, ctx, p) => content.getContentVersion(ctx.userId, p.id))
  .put("/pages/:id/content", async (req, ctx, p) => {
    const b = await body(req, z.object({ doc: z.any(), baseVersion: z.number().int().min(0), force: z.boolean().optional() }));
    return content.saveContent(ctx.userId, p.id, b);
  })
  .post("/pages/:id/move", async (req, ctx, p) => {
    const b = await body(req, z.object({ parentId: uuid.nullable().optional(), section: section.optional(), afterId: uuid.nullable().optional(), beforeId: uuid.nullable().optional() }));
    return pages.movePage(ctx.userId, p.id, b);
  })
  .post("/pages/:id/duplicate", async (_req, ctx, p) => pages.duplicatePage(ctx.userId, p.id))
  .post("/pages/:id/archive", async (req, ctx, p) => {
    const b = await body(req, z.object({ archived: z.boolean() }));
    await pages.setArchived(ctx.userId, p.id, b.archived);
  })
  .post("/pages/:id/restore", async (_req, ctx, p) => pages.restorePage(ctx.userId, p.id))
  .delete("/pages/:id/purge", async (_req, ctx, p) => pages.purgePage(ctx.userId, p.id))
  .post("/pages/:id/favorite", async (req, ctx, p) => {
    const b = await body(req, z.object({ on: z.boolean() }));
    await pages.setFavorite(ctx.userId, p.id, b.on);
  })
  .get("/pages/:id/children", async (_req, ctx, p) => {
    await requirePage(ctx.userId, p.id, Access.view);
    return pages.childPages(ctx.userId, p.id);
  })
  .get("/pages/:id/backlinks", async (_req, ctx, p) => {
    await requirePage(ctx.userId, p.id, Access.view);
    return pages.backlinks(ctx.userId, p.id);
  })
  .get("/pages/:id/sharing", async (_req, ctx, p) => pages.getSharing(ctx.userId, p.id))
  .patch("/pages/:id/sharing", async (req, ctx, p) => {
    const b = await body(req, z.object({ generalAccess: z.enum(GENERAL_ACCESS) }));
    await pages.setGeneralAccess(ctx.userId, p.id, b.generalAccess, ctx.ip);
  })
  .put("/pages/:id/sharing/:user", async (req, ctx, p) => {
    const b = await body(req, z.object({ level: accessName }));
    await pages.setGrant(ctx.userId, p.id, p.user, b.level, ctx.ip);
  })
  .get("/pages/:id/versions", async (_req, ctx, p) => content.listVersions(ctx.userId, p.id))
  .post("/pages/:id/versions", async (req, ctx, p) => {
    const b = await body(req, z.object({ doc: z.any() }));
    return content.saveCopyToHistory(ctx.userId, p.id, b.doc);
  })
  .get("/pages/:id/versions/:vid",async (_req, ctx, p) => content.getVersion(ctx.userId, p.id, p.vid))
  .post("/pages/:id/versions/:vid/restore", async (_req, ctx, p) => content.restoreVersion(ctx.userId, p.id, p.vid))
  .get("/pages/:id/activity", async (_req, ctx, p) => {
    await requirePage(ctx.userId, p.id, Access.view);
    return db
      .select({ id: activity.id, action: activity.action, createdAt: activity.createdAt, actor: user.name, meta: activity.meta })
      .from(activity)
      .leftJoin(user, eq(user.id, activity.actorId))
      .where(eq(activity.pageId, p.id))
      .orderBy(desc(activity.createdAt))
      .limit(100);
  })
  .get("/pages/:id/comments", async (_req, ctx, p) => comments.listComments(ctx.userId, p.id))
  .post("/pages/:id/comments", async (req, ctx, p) => {
    const b = await body(req, z.object({ body: z.string().min(1).max(10000), parentId: uuid.nullable().optional() }));
    return comments.addComment(ctx.userId, p.id, b);
  })
  .patch("/comments/:id", async (req, ctx, p) => {
    const b = await body(req, z.object({ body: z.string().max(10000).optional(), resolved: z.boolean().optional() }));
    if (b.body !== undefined) await comments.editComment(ctx.userId, p.id, b.body);
    if (b.resolved !== undefined) await comments.resolveComment(ctx.userId, p.id, b.resolved);
  })
  .delete("/comments/:id", async (_req, ctx, p) => comments.deleteComment(ctx.userId, p.id))
  .get("/pages/:id/export", async (req, ctx, p) => {
    const q = query(req, z.object({ format: z.enum(["md", "json"]).default("md") }));
    const out = q.format === "json" ? await exp.exportPageJson(ctx.userId, p.id) : await exp.exportPageMarkdown(ctx.userId, p.id);
    return download(out.filename, out.body, q.format === "json" ? "application/json" : "text/markdown; charset=utf-8");
  })
  .post("/pages/:id/presence", async (req, ctx, p) => {
    const b = await body(req, z.object({ editing: z.boolean().default(false), leaving: z.boolean().optional() }));
    await requirePage(ctx.userId, p.id, Access.view);
    if (b.leaving) {
      presence.leave(p.id, ctx.userId);
      return { others: [] };
    }
    return { others: presence.heartbeat(p.id, ctx.user, b.editing) };
  })
  .get("/pages/:id/action-items", async (_req, ctx, p) => meetings.listActionItems(ctx.userId, p.id))
  .post("/pages/:id/action-items", async (req, ctx, p) => {
    const b = await body(req, z.object({ items: z.array(z.object({ blockId: z.string().min(1).max(100), assigneeId: uuid.nullable().optional(), due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional() })).min(1).max(100) }));
    return meetings.convertActionItems(ctx.userId, p.id, b.items);
  })

  // ---- databases -------------------------------------------------------------------
  .post("/databases", async (req, ctx) => {
    const b = await body(req, z.object({ workspaceId: uuid, parentId: uuid.nullable().optional(), section: section.optional(), title: z.string().max(500).default("Untitled database") }));
    const created = await dbs.createDatabase(ctx.userId, {
      ...b,
      properties: [{ name: "Tags", type: "multi_select", config: { options: [] } }],
      views: [{ name: "Table", type: "table" }],
    });
    return { id: created.database.id, pageId: created.page.id };
  })
  .get("/databases/:id", async (_req, ctx, p) => dbs.getDatabase(ctx.userId, p.id))
  .get("/databases/by-page/:pageId", async (_req, ctx, p) => dbs.getDatabaseByPage(ctx.userId, p.pageId))
  .post("/databases/:id/query", async (req, ctx, p) => {
    const b = await body(req, z.object({ viewId: uuid.optional(), search: z.string().max(200).optional(), filter: filterSchema.optional(), sorts: viewConfig.shape.sorts }));
    return dbs.queryRows(ctx.userId, p.id, b as Parameters<typeof dbs.queryRows>[2]);
  })
  .post("/databases/:id/rows", async (req, ctx, p) => {
    const b = await body(req, z.object({ title: z.string().max(500).optional(), values: z.record(z.string(), z.any()).optional(), afterId: uuid.nullable().optional(), beforeId: uuid.nullable().optional() }));
    const row = await dbs.createRow(ctx.userId, p.id, b);
    return { id: row.id };
  })
  .get("/databases/:id/pick", async (req, ctx, p) => {
    const q = query(req, z.object({ q: z.string().max(100).optional() }));
    return dbs.pickRows(ctx.userId, p.id, q.q);
  })
  .post("/databases/:id/properties", async (req, ctx, p) => {
    const b = await body(req, z.object({ name: z.string().min(1).max(100), type: z.enum(PROPERTY_TYPES), config: propertyConfig.optional(), twoWay: z.boolean().optional(), reverseName: z.string().max(100).optional() }));
    return dbs.addProperty(ctx.userId, p.id, b);
  })
  .patch("/properties/:id", async (req, ctx, p) => {
    const b = await body(req, z.object({ name: z.string().max(100).optional(), config: propertyConfig.optional(), position: z.number().int().optional() }));
    return dbs.updateProperty(ctx.userId, p.id, b);
  })
  .delete("/properties/:id", async (_req, ctx, p) => dbs.deleteProperty(ctx.userId, p.id))
  .post("/databases/:id/views", async (req, ctx, p) => {
    const b = await body(req, z.object({ name: z.string().min(1).max(100), type: z.enum(VIEW_TYPES), config: viewConfig.optional() }));
    return dbs.createView(ctx.userId, p.id, b as Parameters<typeof dbs.createView>[2]);
  })
  .patch("/views/:id", async (req, ctx, p) => {
    const b = await body(req, z.object({ name: z.string().max(100).optional(), type: z.enum(VIEW_TYPES).optional(), config: viewConfig.optional(), position: z.number().int().optional() }));
    return dbs.updateView(ctx.userId, p.id, b as Parameters<typeof dbs.updateView>[2]);
  })
  .delete("/views/:id", async (_req, ctx, p) => dbs.deleteView(ctx.userId, p.id))
  .get("/databases/:id/export", async (_req, ctx, p) => {
    const out = await exp.exportDatabaseCsv(ctx.userId, p.id);
    return download(out.filename, "﻿" + out.body, "text/csv; charset=utf-8");
  })
  .get("/rows/:id", async (_req, ctx, p) => dbs.getRow(ctx.userId, p.id))
  .patch("/rows/:id", async (req, ctx, p) => {
    const b = await body(req, z.object({ title: z.string().max(500).optional(), icon: z.string().max(16).nullable().optional(), values: z.record(z.string(), z.any()).optional() }));
    const row = await dbs.updateRow(ctx.userId, p.id, b);
    return { id: row.id, updatedAt: row.updatedAt };
  })
  .post("/rows/:id/move", async (req, ctx, p) => {
    const b = await body(req, z.object({ afterId: uuid.nullable().optional(), beforeId: uuid.nullable().optional(), values: z.record(z.string(), z.any()).optional() }));
    return dbs.moveRow(ctx.userId, p.id, b);
  })

  // ---- files -----------------------------------------------------------------------
  .post("/files", async (req, ctx) => {
    const { form, files } = await readUpload(req);
    const pageId = uuid.parse(form.get("pageId"));
    const f = files[0];
    if (f.size > env().MAX_UPLOAD_MB * 1024 * 1024) throw badRequest(`Files must be smaller than ${env().MAX_UPLOAD_MB} MB`);
    const row = await filesSvc.uploadFile(ctx.userId, { pageId, name: f.name, data: new Uint8Array(await f.arrayBuffer()) });
    return { id: row.id, name: row.originalName, size: row.size, mimeType: row.mimeType, url: `/api/files/${row.id}` };
  })
  .get("/files/:id", async (req, ctx, p) => {
    const { file, stream } = await filesSvc.openFile(ctx.userId, p.id);
    const inline = filesSvc.isInline(file.mimeType) && req.nextUrl.searchParams.get("download") !== "1";
    return new NextResponse(stream, {
      headers: {
        "Content-Type": file.mimeType,
        "Content-Length": String(file.size),
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.originalName)}`,
        "Content-Security-Policy": "default-src 'none'; img-src 'self'; media-src 'self'; sandbox",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, max-age=3600",
      },
    });
  });

export type { Ctx };
