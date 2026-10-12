import { describe, expect, it } from "vitest";
import { evaluateFormula, parseFormula, runFormula } from "@/lib/db-engine/formula";
import { applyFilter, applySorts, groupRows, searchRows, type QueryContext } from "@/lib/db-engine/query";
import type { Property, Row } from "@/lib/db-engine/types";

describe("formula", () => {
  const props: Record<string, unknown> = { Price: 120, Qty: 3, Name: "Widget", Due: "2026-10-20", Done: false };
  const get = (n: string) => (props[n] ?? null) as never;
  const now = new Date("2026-10-12T10:00:00Z");

  it("does arithmetic with precedence", () => {
    expect(runFormula('prop("Price") * prop("Qty") + 10', get).value).toBe(370);
    expect(runFormula("(1 + 2) * 3 - -1", get).value).toBe(10);
    expect(runFormula("7 % 4", get).value).toBe(3);
  });

  it("handles text, booleans and conditionals", () => {
    expect(runFormula('concat(upper(prop("Name")), "-", length("abc"))', get).value).toBe("WIDGET-3");
    expect(runFormula('if(prop("Done"), "yes", "no")', get).value).toBe("no");
    expect(runFormula('prop("Qty") > 2 and not prop("Done")', get).value).toBe(true);
    expect(runFormula('contains(prop("Name"), "idg")', get).value).toBe(true);
  });

  it("handles dates", () => {
    expect(runFormula('dateBetween(prop("Due"), today(), "days")', get, now).value).toBe(8);
    expect(runFormula('formatDate(dateAdd(prop("Due"), 1, "weeks"))', get, now).value).toBe("2026-10-27");
  });

  it("divides by zero safely", () => {
    expect(runFormula("1 / 0", get).value).toBeNull();
  });

  it("rejects anything that is not the formula language", () => {
    for (const bad of ["process.exit()", "constructor", 'prop("a"); alert(1)', "this", "x => x", "`template`", "a[0]", "{}"]) {
      const r = runFormula(bad, get);
      expect(r.error, bad).toBeTruthy();
    }
    expect(runFormula('unknownFn(1)', get).error).toMatch(/Unknown function/);
    expect(runFormula("(".repeat(100) + "1" + ")".repeat(100), get).error).toMatch(/nested/);
  });

  it("parses once and evaluates many times", () => {
    const ast = parseFormula('prop("Qty") * 2');
    expect(evaluateFormula(ast, () => 4)).toBe(8);
    expect(evaluateFormula(ast, () => 5)).toBe(10);
  });
});

const status: Property = {
  id: "status",
  name: "Status",
  type: "status",
  position: 1,
  config: {
    options: [
      { id: "todo", name: "Not started", color: "gray", group: "todo" },
      { id: "doing", name: "In progress", color: "blue", group: "in_progress" },
      { id: "done", name: "Done", color: "green", group: "done" },
    ],
  },
};
const due: Property = { id: "due", name: "Due", type: "date", position: 2, config: {} };
const assignee: Property = { id: "assignee", name: "Assignee", type: "person", position: 3, config: {} };
const points: Property = { id: "points", name: "Points", type: "number", position: 4, config: {} };
const props = [status, due, assignee, points];

const row = (id: string, title: string, values: Row["values"]): Row => ({
  id, title, icon: null, sortKey: id, createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z",
  createdBy: "u1", updatedBy: "u1", values, relations: {},
});

const rows = [
  row("a", "Write spec", { status: "doing", due: { start: "2026-10-10" }, assignee: ["me-id"], points: 3 }),
  row("b", "Design review", { status: "todo", due: { start: "2026-10-14" }, assignee: ["u2"], points: 1 }),
  row("c", "Ship", { status: "done", due: { start: "2026-10-05" }, assignee: ["me-id"], points: 5 }),
  row("d", "Backlog idea", { status: "todo", due: null, assignee: [], points: null }),
];
const ctx: QueryContext = { today: "2026-10-12", userId: "me-id" };

describe("query engine", () => {
  it("filters overdue tasks (due before today and not done)", () => {
    const out = applyFilter(rows, { mode: "and", conditions: [
      { propertyId: "due", op: "before", value: "today" },
      { propertyId: "status", op: "is_not_done" },
    ] }, props, ctx);
    expect(out.map((r) => r.id)).toEqual(["a"]);
  });

  it("filters my tasks with the 'me' token", () => {
    const out = applyFilter(rows, { mode: "and", conditions: [{ propertyId: "assignee", op: "contains", value: "me" }] }, props, ctx);
    expect(out.map((r) => r.id)).toEqual(["a", "c"]);
  });

  it("filters tasks due within the next 7 days", () => {
    const out = applyFilter(rows, { mode: "and", conditions: [{ propertyId: "due", op: "within_next_days", value: 7 }] }, props, ctx);
    expect(out.map((r) => r.id)).toEqual(["b"]);
  });

  it("supports OR, number comparisons and empty checks", () => {
    expect(applyFilter(rows, { mode: "or", conditions: [{ propertyId: "points", op: "gte", value: 5 }, { propertyId: "due", op: "is_empty" }] }, props, ctx).map((r) => r.id)).toEqual(["c", "d"]);
    expect(applyFilter(rows, { mode: "and", conditions: [{ propertyId: "title", op: "contains", value: "SPEC" }] }, props, ctx).map((r) => r.id)).toEqual(["a"]);
  });

  it("ignores conditions on deleted properties", () => {
    expect(applyFilter(rows, { mode: "and", conditions: [{ propertyId: "gone", op: "equals", value: "x" }] }, props, ctx)).toHaveLength(4);
  });

  it("sorts by date with empties last, and by status option order", () => {
    expect(applySorts(rows, [{ propertyId: "due", direction: "asc" }], props, ctx).map((r) => r.id)).toEqual(["c", "a", "b", "d"]);
    expect(applySorts(rows, [{ propertyId: "due", direction: "desc" }], props, ctx).map((r) => r.id)).toEqual(["b", "a", "c", "d"]);
    expect(applySorts(rows, [{ propertyId: "status", direction: "asc" }, { propertyId: "title", direction: "asc" }], props, ctx).map((r) => r.id)).toEqual(["d", "b", "a", "c"]);
  });

  it("groups by status in option order", () => {
    const groups = groupRows(rows, status);
    expect(groups.map((g) => [g.key, g.rows.map((r) => r.id)])).toEqual([["todo", ["b", "d"]], ["doing", ["a"]], ["done", ["c"]]]);
  });

  it("searches titles and values", () => {
    expect(searchRows(rows, "ship").map((r) => r.id)).toEqual(["c"]);
  });
});
