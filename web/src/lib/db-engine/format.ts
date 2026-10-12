import type { DateValue, Property, Row, Value } from "./types";

export function formatDate(v: DateValue | string | null | undefined, includeTime = false): string {
  if (!v) return "";
  const start = typeof v === "string" ? v : v.start;
  const end = typeof v === "string" ? null : v.end;
  const fmt = (s: string) => {
    const hasTime = s.length > 10;
    const d = new Date(hasTime ? s : `${s}T00:00:00`);
    if (Number.isNaN(d.getTime())) return s;
    const date = d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
    return hasTime && includeTime !== false ? `${date} ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` : date;
  };
  return end ? `${fmt(start)} → ${fmt(end)}` : fmt(start);
}

export function formatNumber(n: number, format?: string) {
  if (format === "percent") return `${Math.round(n)}%`;
  if (format === "currency_inr") return n.toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });
  if (format === "currency_usd") return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
  return Number.isInteger(n) ? n.toLocaleString("en-IN") : n.toLocaleString("en-IN", { maximumFractionDigits: 4 });
}

/** Plain-text rendering of a cell, used for CSV export and simple displays. */
export function valueToText(prop: Property, row: Row, userName: (id: string) => string = (id) => id): string {
  if (prop.type === "title") return row.title;
  if (prop.type === "created_time") return row.createdAt;
  if (prop.type === "edited_time") return row.updatedAt;
  if (prop.type === "created_by") return row.createdBy ? userName(row.createdBy) : "";
  if (prop.type === "relation") return (row.relations[prop.id] ?? []).map((r) => r.title || "Untitled").join(", ");
  const v: Value = row.values[prop.id] ?? null;
  if (v === null || v === undefined) return "";
  switch (prop.type) {
    case "status":
    case "select":
      return prop.config.options?.find((o) => o.id === v)?.name ?? "";
    case "multi_select":
      return (v as string[]).map((id) => prop.config.options?.find((o) => o.id === id)?.name ?? "").filter(Boolean).join(", ");
    case "person":
      return (v as string[]).map(userName).join(", ");
    case "date":
      return typeof v === "object" && v !== null && "start" in v ? ((v as DateValue).end ? `${(v as DateValue).start} → ${(v as DateValue).end}` : (v as DateValue).start) : "";
    case "checkbox":
      return v ? "Yes" : "No";
    case "number":
    case "rollup":
      return typeof v === "number" ? (prop.config.numberFormat === "percent" ? `${v}%` : String(v)) : String(v);
    default:
      return String(v);
  }
}

export function toCsv(rows: string[][]): string {
  const esc = (s: string) => (/[",\n\r]/.test(s) || /^[=+\-@\t]/.test(s) ? `"${s.replace(/^([=+\-@\t])/, "'$1").replace(/"/g, '""')}"` : s);
  return rows.map((r) => r.map(esc).join(",")).join("\r\n") + "\r\n";
}
