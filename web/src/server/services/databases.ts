import { generateKeyBetween } from "fractional-indexing";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { emptyDoc, regenerateBlockIds, type Doc } from "@/lib/doc";
import { parseFormula, evaluateFormula, FormulaError, type FValue } from "@/lib/db-engine/formula";
import { applyFilter, applySorts, optionGroup, searchRows, type QueryContext } from "@/lib/db-engine/query";
import type { DateValue, Filter, Property, PropertyConfig, PropertyType, Row, Sort, Value, View, ViewConfig } from "@/lib/db-engine/types";
import { db, type DbOrTx } from "../db";
import { databases, dbProperties, dbViews, pageContent, pages, relationLinks, user, workspaceMembers } from "../db/schema";
import { badRequest, notFound } from "../errors";
import { recordActivity } from "./audit";
import { createPage, type Section } from "./pages";
import { Access, requirePage } from "./permissions";

const COMPUTED: PropertyType[] = ["created_time", "edited_time", "created_by", "formula", "rollup", "title"];

export function todayIn(tz = process.env.APP_TIMEZONE || "Asia/Kolkata", now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

const toProperty = (p: typeof dbProperties.$inferSelect): Property => ({
  id: p.id,
  name: p.name,
  type: p.type,
  config: p.config as PropertyConfig,
  systemKey: p.systemKey,
  position: p.position,
});
const toView = (v: typeof dbViews.$inferSelect): View => ({ id: v.id, name: v.name, type: v.type, config: v.config as ViewConfig, position: v.position });

async function loadDatabase(databaseId: string, tx: DbOrTx = db) {
  if (!/^[0-9a-f-]{36}$/i.test(databaseId)) throw notFound("Database not found");
  const [d] = await tx.select().from(databases).where(eq(databases.id, databaseId));
  if (!d) throw notFound("Database not found");
  return d;
}

/** Access to a database is access to its container page. */
export async function requireDatabase(userId: string, databaseId: string, min: number, tx: DbOrTx = db) {
  const d = await loadDatabase(databaseId, tx);
  const { page, level } = await requirePage(userId, d.pageId, min, {}, tx);
  return { database: d, page, level };
}

export async function getDatabaseByPage(userId: string, pageId: string) {
  const { page, level } = await requirePage(userId, pageId, Access.view);
  const [d] = await db.select().from(databases).where(eq(databases.pageId, pageId));
  if (!d) throw notFound("Database not found");
  return describeDatabase(d, page, level);
}

export async function getDatabase(userId: string, databaseId: string) {
  const { database, page, level } = await requireDatabase(userId, databaseId, Access.view);
  return describeDatabase(database, page, level);
}

async function describeDatabase(d: typeof databases.$inferSelect, page: typeof pages.$inferSelect, level: number) {
  const props = await db.select().from(dbProperties).where(eq(dbProperties.databaseId, d.id)).orderBy(asc(dbProperties.position));
  const views = await db.select().from(dbViews).where(eq(dbViews.databaseId, d.id)).orderBy(asc(dbViews.position));
  // Names of related databases, for relation pickers.
  const targetIds = [...new Set(props.map((p) => (p.config as PropertyConfig).targetDatabaseId).filter(Boolean) as string[])];
  const targets = targetIds.length
    ? await db.select({ id: databases.id, pageId: databases.pageId, title: pages.title }).from(databases).innerJoin(pages, eq(pages.id, databases.pageId)).where(inArray(databases.id, targetIds))
    : [];
  return {
    id: d.id,
    pageId: page.id,
    title: page.title,
    icon: page.icon,
    systemKey: d.systemKey,
    access: level,
    properties: props.map(toProperty),
    views: views.map(toView),
    relatedDatabases: targets,
  };
}

// ---------------------------------------------------------------------------
// Creating databases, properties and views
// ---------------------------------------------------------------------------

export type PropertySpec = { key?: string; name: string; type: PropertyType; config?: PropertyConfig };
export type ViewSpec = { name: string; type: View["type"]; config?: ViewConfig };

export async function createDatabase(
  userId: string,
  input: {
    workspaceId: string;
    parentId?: string | null;
    section?: Section;
    title: string;
    icon?: string | null;
    systemKey?: string | null;
    titleName?: string;
    properties?: PropertySpec[];
    views?: ViewSpec[];
    rowTemplate?: Doc | null;
  },
  tx?: DbOrTx,
) {
  const run = async (t: DbOrTx) => {
    const page = await createPage(userId, { workspaceId: input.workspaceId, parentId: input.parentId, section: input.section, title: input.title, icon: input.icon, kind: "database" }, t);
    const [d] = await t
      .insert(databases)
      .values({ workspaceId: input.workspaceId, pageId: page.id, systemKey: input.systemKey ?? null, rowTemplate: input.rowTemplate ?? null })
      .returning();
    const specs: PropertySpec[] = [{ key: "title", name: input.titleName ?? "Name", type: "title" }, ...(input.properties ?? [])];
    const keyToId: Record<string, string> = {};
    let position = 0;
    for (const s of specs) {
      const [p] = await t
        .insert(dbProperties)
        .values({ databaseId: d.id, name: s.name, type: s.type, config: s.config ?? {}, systemKey: s.key ?? null, position: position++ })
        .returning();
      if (s.key) keyToId[s.key] = p.id;
    }
    const views = input.views?.length ? input.views : [{ name: "Table", type: "table" as const }];
    let vpos = 0;
    for (const v of views) {
      await t.insert(dbViews).values({ databaseId: d.id, name: v.name, type: v.type, config: resolveViewKeys(v.config ?? {}, keyToId), position: vpos++ });
    }
    return { database: d, page, keyToId };
  };
  return tx ? run(tx) : db.transaction(run);
}

/** View configs in specs can reference properties by system key ("key:status"). */
function resolveViewKeys(config: ViewConfig, keyToId: Record<string, string>): ViewConfig {
  const r = (id: string | null | undefined) => (id && id.startsWith("key:") ? keyToId[id.slice(4)] ?? id : id);
  return {
    ...config,
    groupBy: r(config.groupBy) ?? null,
    dateProperty: r(config.dateProperty) ?? null,
    sorts: config.sorts?.map((s) => ({ ...s, propertyId: r(s.propertyId)! })),
    filter: config.filter ? { ...config.filter, conditions: config.filter.conditions.map((c) => ({ ...c, propertyId: r(c.propertyId)! })) } : undefined,
    hidden: config.hidden?.map((h) => r(h)!),
  };
}

async function nextPosition(t: DbOrTx, databaseId: string) {
  const [last] = await t.select({ position: dbProperties.position }).from(dbProperties).where(eq(dbProperties.databaseId, databaseId)).orderBy(desc(dbProperties.position)).limit(1);
  return (last?.position ?? 0) + 1;
}

function validateConfig(type: PropertyType, config: PropertyConfig) {
  if (type === "formula") {
    if (!config.expression) throw badRequest("A formula needs an expression");
    try {
      parseFormula(config.expression);
    } catch (e) {
      throw badRequest(e instanceof FormulaError ? `Formula error: ${e.message}` : "Invalid formula");
    }
  }
  if ((type === "select" || type === "status" || type === "multi_select") && config.options) {
    const ids = new Set<string>();
    for (const o of config.options) {
      if (!o.id || !o.name?.trim()) throw badRequest("Options need an id and a name");
      if (ids.has(o.id)) throw badRequest("Duplicate option id");
      ids.add(o.id);
    }
  }
}

export async function addProperty(
  userId: string,
  databaseId: string,
  input: { name: string; type: PropertyType; config?: PropertyConfig; twoWay?: boolean; reverseName?: string },
) {
  return db.transaction(async (tx) => {
    const { database } = await requireDatabase(userId, databaseId, Access.edit, tx);
    if (input.type === "title") throw badRequest("A database has exactly one title property");
    const config: PropertyConfig = { ...(input.config ?? {}) };
    if (input.type === "status" && !config.options?.length) {
      config.options = [
        { id: crypto.randomUUID(), name: "Not started", color: "gray", group: "todo" },
        { id: crypto.randomUUID(), name: "In progress", color: "blue", group: "in_progress" },
        { id: crypto.randomUUID(), name: "Done", color: "green", group: "done" },
      ];
    }
    validateConfig(input.type, config);
    const position = await nextPosition(tx, databaseId);

    if (input.type === "relation") {
      if (!config.targetDatabaseId) throw badRequest("Choose a database to relate to");
      const { database: target } = await requireDatabase(userId, config.targetDatabaseId, Access.edit, tx);
      if (target.workspaceId !== database.workspaceId) throw badRequest("Databases must be in the same workspace");
      const { forward } = await insertRelationProperty(tx, {
        databaseId,
        targetDatabaseId: target.id,
        name: input.name,
        reverseName: input.twoWay && target.id !== databaseId ? input.reverseName || "Related" : null,
      });
      return forward;
    }

    if (input.type === "rollup") {
      const [rel] = await tx.select().from(dbProperties).where(and(eq(dbProperties.id, config.relationPropertyId ?? ""), eq(dbProperties.databaseId, databaseId)));
      if (!rel || rel.type !== "relation") throw badRequest("A rollup needs a relation property from this database");
    }
    const [p] = await tx.insert(dbProperties).values({ databaseId, name: input.name, type: input.type, config, position }).returning();
    return toProperty(p);
  });
}

/** Creates a relation (and optionally its reverse side). Callers check permissions. */
export async function insertRelationProperty(
  tx: DbOrTx,
  input: { databaseId: string; targetDatabaseId: string; name: string; reverseName: string | null; key?: string; reverseKey?: string },
) {
  const [forward] = await tx
    .insert(dbProperties)
    .values({ databaseId: input.databaseId, name: input.name, type: "relation", config: { targetDatabaseId: input.targetDatabaseId }, systemKey: input.key ?? null, position: await nextPosition(tx, input.databaseId) })
    .returning();
  if (!input.reverseName) return { forward: toProperty(forward), reverse: null };
  const [reverse] = await tx
    .insert(dbProperties)
    .values({
      databaseId: input.targetDatabaseId,
      name: input.reverseName,
      type: "relation",
      config: { targetDatabaseId: input.databaseId, reverseOf: forward.id },
      systemKey: input.reverseKey ?? null,
      position: await nextPosition(tx, input.targetDatabaseId),
    })
    .returning();
  const [updated] = await tx
    .update(dbProperties)
    .set({ config: { targetDatabaseId: input.targetDatabaseId, reversePropertyId: reverse.id } })
    .where(eq(dbProperties.id, forward.id))
    .returning();
  return { forward: toProperty(updated), reverse: toProperty(reverse) };
}

export async function updateProperty(userId: string, propertyId: string, patch: { name?: string; config?: PropertyConfig; position?: number }) {
  const [p] = await db.select().from(dbProperties).where(eq(dbProperties.id, propertyId));
  if (!p) throw notFound("Property not found");
  await requireDatabase(userId, p.databaseId, Access.edit);
  const config = patch.config ? { ...(p.config as PropertyConfig), ...patch.config } : undefined;
  if (config) {
    // Structural relation fields cannot be changed after creation.
    const old = p.config as PropertyConfig;
    config.targetDatabaseId = old.targetDatabaseId;
    config.reverseOf = old.reverseOf;
    config.reversePropertyId = old.reversePropertyId;
    validateConfig(p.type, config);
  }
  const [out] = await db
    .update(dbProperties)
    .set({ name: patch.name?.trim() || p.name, config: config ?? p.config, position: patch.position ?? p.position })
    .where(eq(dbProperties.id, propertyId))
    .returning();
  return toProperty(out);
}

export async function deleteProperty(userId: string, propertyId: string) {
  const [p] = await db.select().from(dbProperties).where(eq(dbProperties.id, propertyId));
  if (!p) throw notFound("Property not found");
  await requireDatabase(userId, p.databaseId, Access.edit);
  if (p.type === "title") throw badRequest("The title property cannot be deleted");
  if (p.systemKey) throw badRequest("Built-in properties can be renamed or hidden, but not deleted");
  await db.transaction(async (tx) => {
    const cfg = p.config as PropertyConfig;
    // Deleting either side of a two-way relation removes both sides and the links.
    const forwardId = cfg.reverseOf ?? p.id;
    const [forward] = await tx.select().from(dbProperties).where(eq(dbProperties.id, forwardId));
    const reverseId = cfg.reverseOf ? p.id : cfg.reversePropertyId;
    if (reverseId) await tx.delete(dbProperties).where(eq(dbProperties.id, reverseId));
    if (forward) await tx.delete(dbProperties).where(eq(dbProperties.id, forward.id));
    await tx.delete(dbProperties).where(eq(dbProperties.id, p.id));
    // Remove stored values.
    await tx.execute(sql`update pages set props = props - ${p.id} where database_id = ${p.databaseId}`);
  });
}

export async function createView(userId: string, databaseId: string, input: { name: string; type: View["type"]; config?: ViewConfig }) {
  await requireDatabase(userId, databaseId, Access.edit);
  const [last] = await db.select({ position: dbViews.position }).from(dbViews).where(eq(dbViews.databaseId, databaseId)).orderBy(desc(dbViews.position)).limit(1);
  const [v] = await db.insert(dbViews).values({ databaseId, name: input.name, type: input.type, config: input.config ?? {}, position: (last?.position ?? 0) + 1 }).returning();
  return toView(v);
}

export async function updateView(userId: string, viewId: string, patch: { name?: string; type?: View["type"]; config?: ViewConfig; position?: number }) {
  const [v] = await db.select().from(dbViews).where(eq(dbViews.id, viewId));
  if (!v) throw notFound("View not found");
  await requireDatabase(userId, v.databaseId, Access.edit);
  const [out] = await db
    .update(dbViews)
    .set({ name: patch.name?.trim() || v.name, type: patch.type ?? v.type, config: patch.config ?? v.config, position: patch.position ?? v.position })
    .where(eq(dbViews.id, viewId))
    .returning();
  return toView(out);
}

export async function deleteView(userId: string, viewId: string) {
  const [v] = await db.select().from(dbViews).where(eq(dbViews.id, viewId));
  if (!v) throw notFound("View not found");
  await requireDatabase(userId, v.databaseId, Access.edit);
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(dbViews).where(eq(dbViews.databaseId, v.databaseId));
  if (count <= 1) throw badRequest("A database needs at least one view");
  await db.delete(dbViews).where(eq(dbViews.id, viewId));
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

type PageRow = typeof pages.$inferSelect;

async function memberNames(workspaceId: string, tx: DbOrTx = db) {
  const rows = await tx
    .select({ id: user.id, name: user.name })
    .from(workspaceMembers)
    .innerJoin(user, eq(user.id, workspaceMembers.userId))
    .where(eq(workspaceMembers.workspaceId, workspaceId));
  return new Map(rows.map((r) => [r.id, r.name]));
}

/** Loads relation values for `rowIds` and the titles of linked pages the user may see. */
async function loadRelations(userId: string, props: Property[], rowIds: string[], tx: DbOrTx = db) {
  const out = new Map<string, Record<string, { id: string; title: string; icon: string | null }[]>>();
  const relProps = props.filter((p) => p.type === "relation");
  if (!relProps.length || !rowIds.length) return out;
  const rowList = sql.join(rowIds.map((id) => sql`${id}::uuid`), sql`, `);
  for (const p of relProps) {
    const reverse = p.config.reverseOf;
    const links = await tx.execute<{ row_id: string; other_id: string; title: string; icon: string | null }>(
      reverse
        ? sql`select l.to_page_id as row_id, l.from_page_id as other_id, o.title, o.icon from relation_links l join pages o on o.id = l.from_page_id
              where l.property_id = ${reverse} and l.to_page_id in (${rowList}) and o.deleted_at is null and page_access(${userId}::uuid, o.id) >= 1
              order by o.sort_key`
        : sql`select l.from_page_id as row_id, l.to_page_id as other_id, o.title, o.icon from relation_links l join pages o on o.id = l.to_page_id
              where l.property_id = ${p.id} and l.from_page_id in (${rowList}) and o.deleted_at is null and page_access(${userId}::uuid, o.id) >= 1
              order by o.sort_key`,
    );
    for (const l of links) {
      const rec = out.get(l.row_id) ?? {};
      (rec[p.id] ??= []).push({ id: l.other_id, title: l.title, icon: l.icon });
      out.set(l.row_id, rec);
    }
  }
  return out;
}

/** Converts a stored value to the formula language's value space. */
function formulaValue(prop: Property, row: Row, names: Map<string, string>): FValue {
  if (prop.type === "title") return row.title;
  if (prop.type === "created_time") return new Date(row.createdAt);
  if (prop.type === "edited_time") return new Date(row.updatedAt);
  if (prop.type === "created_by") return row.createdBy ? names.get(row.createdBy) ?? "" : "";
  if (prop.type === "relation") return (row.relations[prop.id] ?? []).length;
  const v = row.values[prop.id];
  if (v === undefined || v === null) return null;
  switch (prop.type) {
    case "status":
    case "select":
      return prop.config.options?.find((o) => o.id === v)?.name ?? "";
    case "multi_select":
      return (v as string[]).map((id) => prop.config.options?.find((o) => o.id === id)?.name ?? "").join(", ");
    case "person":
      return (v as string[]).map((id) => names.get(id) ?? "").join(", ");
    case "date":
      return (v as DateValue).start ? new Date((v as DateValue).start.length === 10 ? `${(v as DateValue).start}T00:00:00Z` : (v as DateValue).start) : null;
    default:
      return v instanceof Date ? v : (v as FValue);
  }
}

async function computeRollups(userId: string, props: Property[], rows: Row[], tx: DbOrTx = db) {
  const rollups = props.filter((p) => p.type === "rollup");
  if (!rollups.length) return;
  const targetPropIds = [...new Set(rollups.map((r) => r.config.targetPropertyId).filter(Boolean) as string[])];
  const targetProps = targetPropIds.length ? (await tx.select().from(dbProperties).where(inArray(dbProperties.id, targetPropIds))).map(toProperty) : [];
  const tpMap = new Map(targetProps.map((p) => [p.id, p]));
  const linkedIds = [...new Set(rows.flatMap((r) => rollups.flatMap((ru) => (r.relations[ru.config.relationPropertyId ?? ""] ?? []).map((x) => x.id))))];
  const linked = linkedIds.length ? await tx.select({ id: pages.id, props: pages.props, title: pages.title }).from(pages).where(inArray(pages.id, linkedIds)) : [];
  const byId = new Map(linked.map((l) => [l.id, l]));

  for (const row of rows) {
    for (const ru of rollups) {
      const refs = row.relations[ru.config.relationPropertyId ?? ""] ?? [];
      const tp = tpMap.get(ru.config.targetPropertyId ?? "");
      const vals = refs.map((ref) => {
        const l = byId.get(ref.id);
        if (!l) return null;
        if (!tp || tp.type === "title") return l.title;
        return (l.props as Record<string, Value>)[tp.id] ?? null;
      });
      const nums = vals.map((v) => (typeof v === "number" ? v : null)).filter((v): v is number => v !== null);
      let out: Value = null;
      switch (ru.config.rollup ?? "count") {
        case "count": out = refs.length; break;
        case "count_values": out = vals.filter((v) => v !== null && v !== "" && !(Array.isArray(v) && !v.length)).length; break;
        case "sum": out = nums.reduce((a, b) => a + b, 0); break;
        case "average": out = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null; break;
        case "min": out = nums.length ? Math.min(...nums) : null; break;
        case "max": out = nums.length ? Math.max(...nums) : null; break;
        case "percent_checked": out = refs.length ? Math.round((vals.filter((v) => v === true).length / refs.length) * 100) : null; break;
        case "percent_where": {
          if (!refs.length) { out = null; break; }
          const target = ru.config.whereValue;
          const hit = vals.filter((v) => (target === "__done__" ? optionGroup(tp, v) === "done" : v === target)).length;
          out = Math.round((hit / refs.length) * 100);
          break;
        }
        case "show_original": out = vals.map((v) => (tp?.config.options?.find((o) => o.id === v)?.name ?? (v === null ? "" : String(v)))).filter(Boolean).join(", "); break;
      }
      row.values[ru.id] = out;
    }
  }
}

export function toRow(p: PageRow): Row {
  return {
    id: p.id,
    title: p.title,
    icon: p.icon,
    sortKey: p.sortKey,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    createdBy: p.createdBy,
    updatedBy: p.updatedBy,
    values: { ...(p.props as Record<string, Value>) },
    relations: {},
  };
}

/** Resolves relations, rollups and formulas for already-loaded rows. */
export async function resolveRows(userId: string, workspaceId: string, props: Property[], pageRows: PageRow[], tx: DbOrTx = db): Promise<Row[]> {
  const rows = pageRows.map(toRow);
  const rel = await loadRelations(userId, props, rows.map((r) => r.id), tx);
  for (const r of rows) r.relations = rel.get(r.id) ?? {};
  await computeRollups(userId, props, rows, tx);
  const formulas = props.filter((p) => p.type === "formula" && p.config.expression);
  if (formulas.length) {
    const names = await memberNames(workspaceId, tx);
    const byName = new Map(props.map((p) => [p.name.toLowerCase(), p]));
    const asts = new Map<string, ReturnType<typeof parseFormula> | null>();
    for (const f of formulas) {
      try { asts.set(f.id, parseFormula(f.config.expression!)); } catch { asts.set(f.id, null); }
    }
    const now = new Date();
    for (const row of rows) {
      for (const f of formulas) {
        const ast = asts.get(f.id);
        if (!ast) { row.values[f.id] = null; continue; }
        try {
          const v = evaluateFormula(ast, (name) => {
            const p = byName.get(name.toLowerCase());
            if (!p || p.id === f.id || p.type === "formula") return null; // no formula-on-formula, no cycles
            return formulaValue(p, row, names);
          }, now);
          row.values[f.id] = v instanceof Date ? v.toISOString() : v;
        } catch {
          row.values[f.id] = null;
        }
      }
    }
  }
  return rows;
}

export async function queryRows(
  userId: string,
  databaseId: string,
  opts: { viewId?: string; filter?: Filter; sorts?: Sort[]; search?: string } = {},
) {
  const { database } = await requireDatabase(userId, databaseId, Access.view);
  const props = (await db.select().from(dbProperties).where(eq(dbProperties.databaseId, databaseId)).orderBy(asc(dbProperties.position))).map(toProperty);
  let view: View | undefined;
  if (opts.viewId) {
    const [v] = await db.select().from(dbViews).where(and(eq(dbViews.id, opts.viewId), eq(dbViews.databaseId, databaseId)));
    if (v) view = toView(v);
  }
  const pageRows = (await db.execute(sql`
    select * from pages where database_id = ${databaseId} and deleted_at is null and page_access(${userId}::uuid, id) >= 1
    order by sort_key
  `)) as unknown as Record<string, unknown>[];
  const rowsRaw: PageRow[] = pageRows.map(fromSqlRow);
  const rows = await resolveRows(userId, database.workspaceId, props, rowsRaw);
  const names = await memberNames(database.workspaceId);
  const ctx: QueryContext = { today: todayIn(), userId, userName: (id) => names.get(id) ?? "" };
  const filter = opts.filter ?? view?.config.filter;
  const sorts = opts.sorts ?? view?.config.sorts;
  let out = applyFilter(rows, filter, props, ctx);
  out = searchRows(out, opts.search);
  out = applySorts(out, sorts, props, ctx);
  return { rows: out, total: rows.length };
}

/** Maps a raw snake_case SQL row onto the drizzle page type. */
function fromSqlRow(r: Record<string, unknown>): PageRow {
  const d = (v: unknown) => (v ? new Date(v as string) : null);
  return {
    id: r.id as string,
    workspaceId: r.workspace_id as string,
    parentId: r.parent_id as string | null,
    kind: r.kind as PageRow["kind"],
    teamspaceId: r.teamspace_id as string | null,
    ownerId: r.owner_id as string | null,
    generalAccess: r.general_access as PageRow["generalAccess"],
    title: r.title as string,
    icon: r.icon as string | null,
    coverFileId: r.cover_file_id as string | null,
    sortKey: r.sort_key as string,
    databaseId: r.database_id as string | null,
    props: (r.props ?? {}) as Record<string, unknown>,
    propsText: r.props_text as string,
    isTemplate: r.is_template as boolean,
    archivedAt: d(r.archived_at),
    deletedAt: d(r.deleted_at),
    deletedBy: r.deleted_by as string | null,
    createdBy: r.created_by as string | null,
    updatedBy: r.updated_by as string | null,
    createdAt: d(r.created_at)!,
    updatedAt: d(r.updated_at)!,
    searchTsv: r.search_tsv as string,
  };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?$/;

/** Validates and normalises one property value from client input. */
async function normaliseValue(prop: Property, value: unknown, workspaceId: string, tx: DbOrTx): Promise<Value> {
  if (value === null || value === undefined || value === "") return null;
  switch (prop.type) {
    case "text":
    case "url":
    case "email": {
      if (typeof value !== "string") throw badRequest(`${prop.name} must be text`);
      if (value.length > 10000) throw badRequest(`${prop.name} is too long`);
      if (prop.type === "email" && !/^[^\s@]+@[^\s@]+$/.test(value)) throw badRequest(`${prop.name} must be an email address`);
      return value;
    }
    case "number": {
      const n = typeof value === "number" ? value : Number(value);
      if (!Number.isFinite(n)) throw badRequest(`${prop.name} must be a number`);
      return n;
    }
    case "checkbox":
      return value === true || value === "true";
    case "status":
    case "select": {
      if (!prop.config.options?.some((o) => o.id === value)) throw badRequest(`Unknown option for ${prop.name}`);
      return value as string;
    }
    case "multi_select": {
      if (!Array.isArray(value)) throw badRequest(`${prop.name} must be a list`);
      const ids = new Set(prop.config.options?.map((o) => o.id));
      if (!value.every((v) => ids.has(v))) throw badRequest(`Unknown option for ${prop.name}`);
      return [...new Set(value as string[])];
    }
    case "date": {
      const v = value as DateValue;
      if (typeof v !== "object" || !v.start || !DATE_RE.test(v.start) || (v.end && !DATE_RE.test(v.end))) throw badRequest(`${prop.name} must be a date`);
      return { start: v.start, end: v.end || null };
    }
    case "person": {
      if (!Array.isArray(value)) throw badRequest(`${prop.name} must be a list of people`);
      const ids = [...new Set(value as string[])];
      if (ids.length) {
        const found = await tx
          .select({ id: workspaceMembers.userId })
          .from(workspaceMembers)
          .where(and(eq(workspaceMembers.workspaceId, workspaceId), inArray(workspaceMembers.userId, ids)));
        if (found.length !== ids.length) throw badRequest(`${prop.name}: everyone must be a workspace member`);
      }
      return ids;
    }
    default:
      throw badRequest(`${prop.name} cannot be edited`);
  }
}

/** Text used by full-text search for a row's properties. */
function propsSearchText(props: Property[], values: Record<string, Value>, names: Map<string, string>) {
  const parts: string[] = [];
  for (const p of props) {
    const v = values[p.id];
    if (v === null || v === undefined) continue;
    if (p.type === "text" || p.type === "url" || p.type === "email") parts.push(String(v));
    else if (p.type === "select" || p.type === "status") parts.push(p.config.options?.find((o) => o.id === v)?.name ?? "");
    else if (p.type === "multi_select") parts.push(...(v as string[]).map((id) => p.config.options?.find((o) => o.id === id)?.name ?? ""));
    else if (p.type === "person") parts.push(...(v as string[]).map((id) => names.get(id) ?? ""));
    else if (p.type === "number") parts.push(String(v));
  }
  return parts.filter(Boolean).join(" ");
}

async function setRelation(tx: DbOrTx, userId: string, prop: Property, rowId: string, targetIds: string[]) {
  if (!Array.isArray(targetIds) || targetIds.some((t) => typeof t !== "string")) throw badRequest(`${prop.name} must be a list of pages`);
  const ids = [...new Set(targetIds)];
  const targetDb = prop.config.targetDatabaseId!;
  if (ids.length) {
    const found = await tx.select({ id: pages.id }).from(pages).where(and(inArray(pages.id, ids), eq(pages.databaseId, targetDb), isNull(pages.deletedAt)));
    if (found.length !== ids.length) throw badRequest(`${prop.name}: linked pages must be rows of the related database`);
    for (const id of ids) {
      const acc = await tx.execute<{ a: number }>(sql`select page_access(${userId}::uuid, ${id}::uuid) as a`);
      if (Number(acc[0]?.a) < Access.view) throw notFound("Linked page not found");
    }
  }
  if (prop.config.reverseOf) {
    // Reverse side: links are stored as (forward property, other row -> this row).
    await tx.delete(relationLinks).where(and(eq(relationLinks.propertyId, prop.config.reverseOf), eq(relationLinks.toPageId, rowId)));
    if (ids.length) await tx.insert(relationLinks).values(ids.map((id) => ({ propertyId: prop.config.reverseOf!, fromPageId: id, toPageId: rowId }))).onConflictDoNothing();
  } else {
    await tx.delete(relationLinks).where(and(eq(relationLinks.propertyId, prop.id), eq(relationLinks.fromPageId, rowId)));
    if (ids.length) await tx.insert(relationLinks).values(ids.map((id) => ({ propertyId: prop.id, fromPageId: rowId, toPageId: id }))).onConflictDoNothing();
  }
}

export async function updateRow(
  userId: string,
  rowId: string,
  input: { title?: string; icon?: string | null; values?: Record<string, unknown> },
  tx?: DbOrTx,
) {
  const run = async (t: DbOrTx) => {
    const { page } = await requirePage(userId, rowId, Access.edit, {}, t);
    if (page.kind !== "row" || !page.databaseId) throw badRequest("Not a database row");
    const props = (await t.select().from(dbProperties).where(eq(dbProperties.databaseId, page.databaseId))).map(toProperty);
    const byId = new Map(props.map((p) => [p.id, p]));
    const values: Record<string, Value> = { ...(page.props as Record<string, Value>) };
    for (const [propId, raw] of Object.entries(input.values ?? {})) {
      const prop = byId.get(propId);
      if (!prop) throw badRequest("Unknown property");
      if (prop.type === "relation") {
        await setRelation(t, userId, prop, rowId, (raw ?? []) as string[]);
        continue;
      }
      if (COMPUTED.includes(prop.type)) throw badRequest(`${prop.name} is computed and cannot be edited`);
      const v = await normaliseValue(prop, raw, page.workspaceId, t);
      if (v === null) delete values[propId];
      else values[propId] = v;
    }
    const names = await memberNames(page.workspaceId, t);
    const [out] = await t
      .update(pages)
      .set({
        props: values,
        propsText: propsSearchText(props, values, names),
        ...(input.title !== undefined ? { title: input.title.slice(0, 500) } : {}),
        ...(input.icon !== undefined ? { icon: input.icon } : {}),
        updatedAt: new Date(),
        updatedBy: userId,
      })
      .where(eq(pages.id, rowId))
      .returning();
    return out;
  };
  return tx ? run(tx) : db.transaction(run);
}

export async function createRow(
  userId: string,
  databaseId: string,
  input: { title?: string; values?: Record<string, unknown>; afterId?: string | null; beforeId?: string | null; useTemplate?: boolean },
  tx?: DbOrTx,
) {
  const run = async (t: DbOrTx) => {
    const { database, page: dbPage } = await requireDatabase(userId, databaseId, Access.edit, t);
    const keyOf = async (id?: string | null) => {
      if (!id) return null;
      const [r] = await t.select({ sortKey: pages.sortKey }).from(pages).where(and(eq(pages.id, id), eq(pages.databaseId, databaseId)));
      return r?.sortKey ?? null;
    };
    let lo = await keyOf(input.afterId);
    let hi = await keyOf(input.beforeId);
    if (lo === null && hi === null) {
      const [last] = await t.select({ sortKey: pages.sortKey }).from(pages).where(eq(pages.databaseId, databaseId)).orderBy(desc(pages.sortKey)).limit(1);
      lo = last?.sortKey ?? null;
    }
    if (lo !== null && hi !== null && lo >= hi) hi = null;
    const [row] = await t
      .insert(pages)
      .values({
        workspaceId: database.workspaceId,
        parentId: dbPage.id,
        kind: "row",
        databaseId,
        teamspaceId: dbPage.teamspaceId,
        ownerId: userId,
        generalAccess: "inherit",
        title: (input.title ?? "").slice(0, 500),
        sortKey: generateKeyBetween(lo, hi),
        createdBy: userId,
        updatedBy: userId,
      })
      .returning();
    const doc = input.useTemplate !== false && database.rowTemplate ? regenerateBlockIds(database.rowTemplate as Doc) : emptyDoc();
    await t.insert(pageContent).values({ pageId: row.id, doc, text: "", version: 1, updatedBy: userId });
    // New rows start in the first "to-do" status (e.g. "Not started"), like Notion.
    const values: Record<string, unknown> = { ...(input.values ?? {}) };
    const statusProps = await t.select().from(dbProperties).where(and(eq(dbProperties.databaseId, databaseId), eq(dbProperties.type, "status")));
    for (const sp of statusProps) {
      if (values[sp.id] !== undefined) continue;
      const first = (sp.config as PropertyConfig).options?.find((o) => o.group === "todo");
      if (first) values[sp.id] = first.id;
    }
    if (Object.keys(values).length) await updateRow(userId, row.id, { values }, t);
    await recordActivity({ workspaceId: database.workspaceId, pageId: row.id, actorId: userId, action: "row.created", meta: { databaseId } }, t);
    const [fresh] = await t.select().from(pages).where(eq(pages.id, row.id));
    return fresh;
  };
  return tx ? run(tx) : db.transaction(run);
}

/** Reorders a row (and optionally changes a value, e.g. its status when dropped on a board column). */
export async function moveRow(userId: string, rowId: string, input: { afterId?: string | null; beforeId?: string | null; values?: Record<string, unknown> }) {
  return db.transaction(async (tx) => {
    const { page } = await requirePage(userId, rowId, Access.edit, {}, tx);
    if (page.kind !== "row" || !page.databaseId) throw badRequest("Not a database row");
    const keyOf = async (id?: string | null) => {
      if (!id) return null;
      const [r] = await tx.select({ sortKey: pages.sortKey }).from(pages).where(and(eq(pages.id, id), eq(pages.databaseId, page.databaseId!)));
      return r?.sortKey ?? null;
    };
    let lo = await keyOf(input.afterId);
    let hi = await keyOf(input.beforeId);
    if (lo !== null && hi !== null && lo >= hi) hi = null;
    if (lo !== null || hi !== null) await tx.update(pages).set({ sortKey: generateKeyBetween(lo, hi) }).where(eq(pages.id, rowId));
    if (input.values) await updateRow(userId, rowId, { values: input.values }, tx);
    return { ok: true };
  });
}

export async function getRow(userId: string, rowId: string) {
  const { page, level } = await requirePage(userId, rowId, Access.view);
  if (page.kind !== "row" || !page.databaseId) throw badRequest("Not a database row");
  const props = (await db.select().from(dbProperties).where(eq(dbProperties.databaseId, page.databaseId)).orderBy(asc(dbProperties.position))).map(toProperty);
  const [row] = await resolveRows(userId, page.workspaceId, props, [page]);
  const [d] = await db.select({ pageId: databases.pageId, title: pages.title }).from(databases).innerJoin(pages, eq(pages.id, databases.pageId)).where(eq(databases.id, page.databaseId));
  return { row, properties: props, access: level, database: { id: page.databaseId, pageId: d.pageId, title: d.title } };
}

/** Rows of a database for relation pickers. */
export async function pickRows(userId: string, databaseId: string, q?: string) {
  await requireDatabase(userId, databaseId, Access.view);
  const like = q?.trim() ? `%${q.trim().replace(/[%_]/g, "\\$&")}%` : null;
  return db.execute<{ id: string; title: string; icon: string | null }>(sql`
    select id, title, icon from pages
    where database_id = ${databaseId} and deleted_at is null and page_access(${userId}::uuid, id) >= 1
      ${like ? sql`and title ilike ${like}` : sql``}
    order by updated_at desc limit 50
  `);
}

export async function findSystemDatabase(workspaceId: string, key: string, tx: DbOrTx = db) {
  const [d] = await tx.select().from(databases).where(and(eq(databases.workspaceId, workspaceId), eq(databases.systemKey, key)));
  return d ?? null;
}

export async function propertyByKey(databaseId: string, key: string, tx: DbOrTx = db) {
  const [p] = await tx.select().from(dbProperties).where(and(eq(dbProperties.databaseId, databaseId), eq(dbProperties.systemKey, key)));
  return p ? toProperty(p) : null;
}
