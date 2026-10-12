// Filtering, sorting and grouping of database rows. Runs on fully resolved rows
// (including formula and rollup values), so every view operates on real data.
import type { DateValue, Filter, FilterCondition, Property, Row, SelectOption, Sort, Value } from "./types";

export type QueryContext = {
  /** "Today" in the workspace time zone, YYYY-MM-DD. */
  today: string;
  /** Current user, so filters can use the value "me". */
  userId: string;
  /** Optional: user names for sorting person columns. */
  userName?: (id: string) => string;
};

const TITLE = "title";

export function rawValue(row: Row, prop: Property | undefined, propertyId: string): Value {
  if (propertyId === TITLE || prop?.type === "title") return row.title;
  if (!prop) return null;
  switch (prop.type) {
    case "created_time": return row.createdAt;
    case "edited_time": return row.updatedAt;
    case "created_by": return row.createdBy ? [row.createdBy] : [];
    case "relation": return (row.relations[prop.id] ?? []).map((r) => r.id);
    default: return row.values[prop.id] ?? null;
  }
}

export function isEmptyValue(v: Value): boolean {
  if (v === null || v === undefined || v === "") return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "object" && !(v instanceof Date) && "start" in v) return !v.start;
  return false;
}

/** Date part (YYYY-MM-DD) of a date-ish value, or null. */
export function dayOf(v: Value): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "string") return /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null;
  if (typeof v === "object" && !Array.isArray(v) && "start" in v) return (v as DateValue).start ? (v as DateValue).start.slice(0, 10) : null;
  return null;
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Resolves relative date tokens used in saved filters. */
export function resolveDay(token: unknown, today: string): string | null {
  if (typeof token !== "string" || !token) return null;
  switch (token) {
    case "today": return today;
    case "tomorrow": return addDays(today, 1);
    case "yesterday": return addDays(today, -1);
    case "one_week_from_now": return addDays(today, 7);
    case "one_week_ago": return addDays(today, -7);
    default: return /^\d{4}-\d{2}-\d{2}/.test(token) ? token.slice(0, 10) : null;
  }
}

const asText = (v: Value): string => {
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) return v.join(" ");
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") return (v as DateValue).start ?? "";
  return String(v);
};

export function optionGroup(prop: Property | undefined, optionId: unknown): SelectOption["group"] | undefined {
  return prop?.config.options?.find((o) => o.id === optionId)?.group;
}

export function matchCondition(row: Row, c: FilterCondition, props: Map<string, Property>, ctx: QueryContext): boolean {
  const prop = props.get(c.propertyId);
  if (!prop && c.propertyId !== TITLE) return true; // property was deleted: ignore the condition
  const v = rawValue(row, prop, c.propertyId);
  const type = prop?.type ?? "title";
  const target = c.value === "me" ? ctx.userId : c.value;
  const list = Array.isArray(target) ? target.map((t) => (t === "me" ? ctx.userId : t)) : target != null ? [String(target)] : [];

  switch (c.op) {
    case "is_empty": return isEmptyValue(v);
    case "is_not_empty": return !isEmptyValue(v);
    case "is_checked": return v === true;
    case "is_not_checked": return v !== true;
    case "is_done": return optionGroup(prop, v) === "done";
    case "is_not_done": return optionGroup(prop, v) !== "done";
  }

  if (type === "date" || type === "created_time" || type === "edited_time" || (type === "formula" && dayOf(v))) {
    const day = dayOf(v);
    if (c.op === "within_next_days" || c.op === "within_past_days") {
      if (!day) return false;
      const n = Number(c.value ?? 7);
      return c.op === "within_next_days" ? day >= ctx.today && day <= addDays(ctx.today, n) : day <= ctx.today && day >= addDays(ctx.today, -n);
    }
    const ref = resolveDay(target, ctx.today);
    if (!day || !ref) return false;
    switch (c.op) {
      case "equals": return day === ref;
      case "not_equals": return day !== ref;
      case "before": return day < ref;
      case "after": return day > ref;
      case "on_or_before": return day <= ref;
      case "on_or_after": return day >= ref;
    }
    return true;
  }

  if (Array.isArray(v)) {
    // multi_select, person, relation, created_by
    switch (c.op) {
      case "contains": case "is_any_of": case "equals": return list.some((t) => v.includes(t));
      case "not_contains": case "is_none_of": case "not_equals": return !list.some((t) => v.includes(t));
    }
    return true;
  }

  if (type === "number" || type === "rollup" || typeof v === "number") {
    const n = typeof v === "number" ? v : Number(v);
    const t = Number(c.value);
    if (["gt", "gte", "lt", "lte", "equals", "not_equals"].includes(c.op) && (v === null || Number.isNaN(n))) return c.op === "not_equals";
    switch (c.op) {
      case "equals": return n === t;
      case "not_equals": return n !== t;
      case "gt": return n > t;
      case "gte": return n >= t;
      case "lt": return n < t;
      case "lte": return n <= t;
    }
  }

  if (type === "status" || type === "select") {
    switch (c.op) {
      case "equals": case "is_any_of": return list.includes(String(v ?? ""));
      case "not_equals": case "is_none_of": return !list.includes(String(v ?? ""));
    }
  }

  if (type === "checkbox") {
    if (c.op === "equals") return Boolean(v) === (c.value === true || c.value === "true");
  }

  const text = asText(v).toLowerCase();
  const q = String(target ?? "").toLowerCase();
  switch (c.op) {
    case "contains": return text.includes(q);
    case "not_contains": return !text.includes(q);
    case "equals": return text === q;
    case "not_equals": return text !== q;
    case "starts_with": return text.startsWith(q);
  }
  return true;
}

export function applyFilter(rows: Row[], filter: Filter | undefined, props: Property[], ctx: QueryContext): Row[] {
  if (!filter || filter.conditions.length === 0) return rows;
  const map = new Map(props.map((p) => [p.id, p]));
  return rows.filter((row) =>
    filter.mode === "or"
      ? filter.conditions.some((c) => matchCondition(row, c, map, ctx))
      : filter.conditions.every((c) => matchCondition(row, c, map, ctx)),
  );
}

function sortKeyOf(row: Row, prop: Property | undefined, propertyId: string, ctx: QueryContext): string | number | null {
  const v = rawValue(row, prop, propertyId);
  if (isEmptyValue(v)) return null;
  const type = prop?.type ?? "title";
  if (type === "status" || type === "select") {
    const idx = prop!.config.options?.findIndex((o) => o.id === v) ?? -1;
    return idx === -1 ? null : idx;
  }
  if (type === "multi_select") {
    const first = (v as string[])[0];
    return prop!.config.options?.findIndex((o) => o.id === first) ?? null;
  }
  if (type === "person" || type === "created_by") return (ctx.userName?.((v as string[])[0]) ?? (v as string[])[0]).toLowerCase();
  if (type === "relation") return (row.relations[prop!.id]?.[0]?.title ?? "").toLowerCase();
  if (type === "checkbox") return v ? 1 : 0;
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v instanceof Date) return v.getTime();
  if (typeof v === "object" && !Array.isArray(v)) return (v as DateValue).start;
  return String(v).toLowerCase();
}

export function applySorts(rows: Row[], sorts: Sort[] | undefined, props: Property[], ctx: QueryContext): Row[] {
  const map = new Map(props.map((p) => [p.id, p]));
  const active = (sorts ?? []).filter((s) => s.propertyId === TITLE || map.has(s.propertyId));
  const out = [...rows];
  out.sort((a, b) => {
    for (const s of active) {
      const prop = map.get(s.propertyId);
      const ka = sortKeyOf(a, prop, s.propertyId, ctx);
      const kb = sortKeyOf(b, prop, s.propertyId, ctx);
      if (ka === kb) continue;
      if (ka === null) return 1; // empty values always last
      if (kb === null) return -1;
      const cmp = typeof ka === "number" && typeof kb === "number" ? ka - kb : String(ka).localeCompare(String(kb), undefined, { numeric: true });
      if (cmp !== 0) return s.direction === "desc" ? -cmp : cmp;
    }
    return a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0;
  });
  return out;
}

export type Group = { key: string; label: string; color: string; rows: Row[] };
export const NO_VALUE = "__none__";

/** Groups rows for board views. Supported: status, select, person, checkbox. */
export function groupRows(rows: Row[], prop: Property | undefined, userName?: (id: string) => string): Group[] {
  if (!prop) return [{ key: "all", label: "All", color: "gray", rows }];
  if (prop.type === "status" || prop.type === "select") {
    const groups: Group[] = (prop.config.options ?? []).map((o) => ({ key: o.id, label: o.name, color: o.color, rows: [] }));
    const none: Group = { key: NO_VALUE, label: `No ${prop.name}`, color: "gray", rows: [] };
    const byKey = new Map(groups.map((g) => [g.key, g]));
    for (const r of rows) (byKey.get(String(r.values[prop.id] ?? "")) ?? none).rows.push(r);
    return none.rows.length ? [none, ...groups] : groups;
  }
  if (prop.type === "checkbox") {
    return [
      { key: "false", label: "Unchecked", color: "gray", rows: rows.filter((r) => r.values[prop.id] !== true) },
      { key: "true", label: "Checked", color: "green", rows: rows.filter((r) => r.values[prop.id] === true) },
    ];
  }
  if (prop.type === "person") {
    const map = new Map<string, Group>();
    const none: Group = { key: NO_VALUE, label: `No ${prop.name}`, color: "gray", rows: [] };
    for (const r of rows) {
      const ids = (r.values[prop.id] as string[] | null) ?? [];
      if (!ids.length) { none.rows.push(r); continue; }
      const id = ids[0];
      if (!map.has(id)) map.set(id, { key: id, label: userName?.(id) ?? id, color: "blue", rows: [] });
      map.get(id)!.rows.push(r);
    }
    return [none, ...map.values()].filter((g) => g.key !== NO_VALUE || g.rows.length);
  }
  return [{ key: "all", label: "All", color: "gray", rows }];
}

export function searchRows(rows: Row[], q: string | undefined): Row[] {
  const needle = q?.trim().toLowerCase();
  if (!needle) return rows;
  return rows.filter((r) => {
    if (r.title.toLowerCase().includes(needle)) return true;
    for (const v of Object.values(r.values)) if (asText(v).toLowerCase().includes(needle)) return true;
    for (const rel of Object.values(r.relations)) if (rel.some((x) => x.title.toLowerCase().includes(needle))) return true;
    return false;
  });
}
