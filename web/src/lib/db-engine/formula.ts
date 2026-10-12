// A small, sandboxed formula language. Expressions are parsed into an AST and
// interpreted; nothing is ever passed to eval/Function. Supported syntax is
// documented in docs/FORMULAS.md and mirrored by FORMULA_FUNCTIONS below.

export type FValue = number | string | boolean | Date | null;

type Node =
  | { k: "num"; v: number }
  | { k: "str"; v: string }
  | { k: "bool"; v: boolean }
  | { k: "prop"; name: string }
  | { k: "call"; fn: string; args: Node[] }
  | { k: "un"; op: "-" | "not"; a: Node }
  | { k: "bin"; op: string; a: Node; b: Node };

export class FormulaError extends Error {}

const MAX_LENGTH = 2000;
const MAX_DEPTH = 40;

type Tok = { t: "num" | "str" | "id" | "op" | "eof"; v: string };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      const n = src.slice(i, j);
      if (!/^\d*\.?\d+$|^\d+\.$/.test(n)) throw new FormulaError(`Bad number "${n}"`);
      out.push({ t: "num", v: n });
      i = j;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      let s = "";
      while (j < src.length && src[j] !== c) {
        if (src[j] === "\\" && j + 1 < src.length) { s += src[j + 1]; j += 2; continue; }
        s += src[j++];
      }
      if (j >= src.length) throw new FormulaError("Unterminated string");
      out.push({ t: "str", v: s });
      i = j + 1;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j++;
      out.push({ t: "id", v: src.slice(i, j) });
      i = j;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (["==", "!=", ">=", "<=", "&&", "||"].includes(two)) { out.push({ t: "op", v: two }); i += 2; continue; }
    if ("+-*/%()<>,!".includes(c)) { out.push({ t: "op", v: c }); i++; continue; }
    throw new FormulaError(`Unexpected character "${c}"`);
  }
  out.push({ t: "eof", v: "" });
  return out;
}

export function parseFormula(src: string): Node {
  if (src.length > MAX_LENGTH) throw new FormulaError("Formula is too long");
  const toks = tokenize(src);
  let p = 0;
  let depth = 0;
  const peek = () => toks[p];
  const next = () => toks[p++];
  const isOp = (v: string) => peek().t === "op" && peek().v === v;
  const isKw = (v: string) => peek().t === "id" && peek().v.toLowerCase() === v;
  const expect = (v: string) => {
    if (!isOp(v)) throw new FormulaError(`Expected "${v}"`);
    next();
  };
  const guard = <T>(fn: () => T): T => {
    if (++depth > MAX_DEPTH) throw new FormulaError("Formula is nested too deeply");
    try { return fn(); } finally { depth--; }
  };

  const or = (): Node => guard(() => {
    let a = and();
    while (isOp("||") || isKw("or")) { next(); a = { k: "bin", op: "or", a, b: and() }; }
    return a;
  });
  const and = (): Node => {
    let a = not();
    while (isOp("&&") || isKw("and")) { next(); a = { k: "bin", op: "and", a, b: not() }; }
    return a;
  };
  const not = (): Node => {
    if (isOp("!") || isKw("not")) { next(); return guard(() => ({ k: "un", op: "not", a: not() })); }
    return cmp();
  };
  const cmp = (): Node => {
    const a = add();
    for (const op of ["==", "!=", ">=", "<=", ">", "<"]) {
      if (isOp(op)) { next(); return { k: "bin", op, a, b: add() }; }
    }
    return a;
  };
  const add = (): Node => {
    let a = mul();
    while (isOp("+") || isOp("-")) { const op = next().v; a = { k: "bin", op, a, b: mul() }; }
    return a;
  };
  const mul = (): Node => {
    let a = unary();
    while (isOp("*") || isOp("/") || isOp("%")) { const op = next().v; a = { k: "bin", op, a, b: unary() }; }
    return a;
  };
  const unary = (): Node => {
    if (isOp("-")) { next(); return guard(() => ({ k: "un", op: "-", a: unary() })); }
    return primary();
  };
  const primary = (): Node => {
    const t = next();
    if (t.t === "num") return { k: "num", v: Number(t.v) };
    if (t.t === "str") return { k: "str", v: t.v };
    if (t.t === "op" && t.v === "(") { const e = or(); expect(")"); return e; }
    if (t.t === "id") {
      const lower = t.v.toLowerCase();
      if (lower === "true" || lower === "false") return { k: "bool", v: lower === "true" };
      if (!isOp("(")) throw new FormulaError(`Unknown name "${t.v}". Use prop("Name") to read a property.`);
      next();
      const args: Node[] = [];
      if (!isOp(")")) {
        do { args.push(or()); } while (isOp(",") && next());
      }
      expect(")");
      if (lower === "prop") {
        if (args.length !== 1 || args[0].k !== "str") throw new FormulaError('prop() takes a property name in quotes, e.g. prop("Status")');
        return { k: "prop", name: args[0].v };
      }
      if (!(lower in FUNCS)) throw new FormulaError(`Unknown function "${t.v}"`);
      return { k: "call", fn: lower, args };
    }
    throw new FormulaError(t.t === "eof" ? "Unexpected end of formula" : `Unexpected "${t.v}"`);
  };

  const ast = or();
  if (peek().t !== "eof") throw new FormulaError(`Unexpected "${peek().v}"`);
  return ast;
}

// ---- evaluation -----------------------------------------------------------

const toNum = (v: FValue): number => {
  if (v === null || v === "") return 0;
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v instanceof Date) return v.getTime();
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const toStr = (v: FValue): string => {
  if (v === null) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(Math.round(v * 1e6) / 1e6);
  return String(v);
};
const toBool = (v: FValue): boolean => (v instanceof Date ? true : Boolean(v));
const toDate = (v: FValue): Date | null => {
  if (v instanceof Date) return v;
  if (typeof v === "string" && v) { const d = new Date(v); return Number.isNaN(d.getTime()) ? null : d; }
  if (typeof v === "number") return new Date(v);
  return null;
};
const UNIT_MS: Record<string, number> = { minutes: 6e4, hours: 36e5, days: 864e5, weeks: 6048e5 };

const FUNCS: Record<string, { args: [number, number]; doc: string; fn: (a: FValue[], now: Date) => FValue }> = {
  if: { args: [3, 3], doc: "if(condition, then, else)", fn: () => null }, // lazily evaluated below
  concat: { args: [1, 20], doc: "concat(a, b, ...) joins text", fn: (a) => a.map(toStr).join("") },
  length: { args: [1, 1], doc: "length(text)", fn: ([s]) => toStr(s).length },
  lower: { args: [1, 1], doc: "lower(text)", fn: ([s]) => toStr(s).toLowerCase() },
  upper: { args: [1, 1], doc: "upper(text)", fn: ([s]) => toStr(s).toUpperCase() },
  contains: { args: [2, 2], doc: "contains(text, search)", fn: ([s, q]) => toStr(s).toLowerCase().includes(toStr(q).toLowerCase()) },
  empty: { args: [1, 1], doc: "empty(value) is true for blank values", fn: ([v]) => v === null || v === "" },
  round: { args: [1, 2], doc: "round(number, digits?)", fn: ([n, d]) => { const f = 10 ** Math.min(10, Math.max(0, toNum(d ?? 0))); return Math.round(toNum(n) * f) / f; } },
  floor: { args: [1, 1], doc: "floor(number)", fn: ([n]) => Math.floor(toNum(n)) },
  ceil: { args: [1, 1], doc: "ceil(number)", fn: ([n]) => Math.ceil(toNum(n)) },
  abs: { args: [1, 1], doc: "abs(number)", fn: ([n]) => Math.abs(toNum(n)) },
  min: { args: [1, 20], doc: "min(a, b, ...)", fn: (a) => Math.min(...a.map(toNum)) },
  max: { args: [1, 20], doc: "max(a, b, ...)", fn: (a) => Math.max(...a.map(toNum)) },
  sum: { args: [1, 20], doc: "sum(a, b, ...)", fn: (a) => a.reduce<number>((s, v) => s + toNum(v), 0) },
  tonumber: { args: [1, 1], doc: "toNumber(value)", fn: ([v]) => toNum(v) },
  format: { args: [1, 1], doc: "format(value) converts to text", fn: ([v]) => toStr(v) },
  now: { args: [0, 0], doc: "now()", fn: (_a, now) => now },
  today: { args: [0, 0], doc: "today()", fn: (_a, now) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) },
  datebetween: {
    args: [3, 3],
    doc: 'dateBetween(date1, date2, "days"|"weeks"|"hours"|"minutes"|"months"|"years")',
    fn: ([a, b, u]) => {
      const d1 = toDate(a), d2 = toDate(b);
      if (!d1 || !d2) return null;
      const unit = toStr(u);
      if (unit === "months" || unit === "years") {
        const m = (d1.getUTCFullYear() - d2.getUTCFullYear()) * 12 + (d1.getUTCMonth() - d2.getUTCMonth());
        return unit === "years" ? Math.trunc(m / 12) : m;
      }
      const ms = UNIT_MS[unit];
      if (!ms) throw new FormulaError(`Unknown unit "${unit}"`);
      return Math.trunc((d1.getTime() - d2.getTime()) / ms);
    },
  },
  dateadd: {
    args: [3, 3],
    doc: 'dateAdd(date, amount, "days"|"weeks"|"hours"|"minutes"|"months"|"years")',
    fn: ([d, n, u]) => {
      const date = toDate(d);
      if (!date) return null;
      const unit = toStr(u);
      const out = new Date(date);
      if (unit === "months") out.setUTCMonth(out.getUTCMonth() + toNum(n));
      else if (unit === "years") out.setUTCFullYear(out.getUTCFullYear() + toNum(n));
      else if (UNIT_MS[unit]) return new Date(date.getTime() + toNum(n) * UNIT_MS[unit]);
      else throw new FormulaError(`Unknown unit "${unit}"`);
      return out;
    },
  },
  formatdate: { args: [1, 1], doc: "formatDate(date) as YYYY-MM-DD", fn: ([d]) => { const x = toDate(d); return x ? x.toISOString().slice(0, 10) : ""; } },
};

export const FORMULA_FUNCTIONS = Object.values(FUNCS).map((f) => f.doc);

export function evaluateFormula(ast: Node, getProp: (name: string) => FValue, now = new Date()): FValue {
  let steps = 0;
  const ev = (n: Node): FValue => {
    if (++steps > 10000) throw new FormulaError("Formula is too complex");
    switch (n.k) {
      case "num": case "str": case "bool": return n.v;
      case "prop": return getProp(n.name);
      case "un": return n.op === "-" ? -toNum(ev(n.a)) : !toBool(ev(n.a));
      case "call": {
        const f = FUNCS[n.fn];
        if (n.args.length < f.args[0] || n.args.length > f.args[1]) throw new FormulaError(`Wrong number of arguments: ${f.doc}`);
        if (n.fn === "if") return toBool(ev(n.args[0])) ? ev(n.args[1]) : ev(n.args[2]);
        return f.fn(n.args.map(ev), now);
      }
      case "bin": {
        if (n.op === "and") return toBool(ev(n.a)) && toBool(ev(n.b));
        if (n.op === "or") return toBool(ev(n.a)) || toBool(ev(n.b));
        const a = ev(n.a), b = ev(n.b);
        switch (n.op) {
          case "+": return typeof a === "string" || typeof b === "string" ? toStr(a) + toStr(b) : toNum(a) + toNum(b);
          case "-": return toNum(a) - toNum(b);
          case "*": return toNum(a) * toNum(b);
          case "/": { const d = toNum(b); return d === 0 ? null : toNum(a) / d; }
          case "%": { const d = toNum(b); return d === 0 ? null : toNum(a) % d; }
          case "==": return cmpEq(a, b);
          case "!=": return !cmpEq(a, b);
          case ">": return cmpOrd(a, b) > 0;
          case ">=": return cmpOrd(a, b) >= 0;
          case "<": return cmpOrd(a, b) < 0;
          case "<=": return cmpOrd(a, b) <= 0;
        }
      }
    }
    throw new FormulaError("Invalid formula");
  };
  return ev(ast);
}

function cmpEq(a: FValue, b: FValue) {
  if (a instanceof Date || b instanceof Date) return toDate(a)?.getTime() === toDate(b)?.getTime();
  if (typeof a === "number" || typeof b === "number") return toNum(a) === toNum(b);
  if (typeof a === "boolean" || typeof b === "boolean") return toBool(a) === toBool(b);
  return toStr(a) === toStr(b);
}
function cmpOrd(a: FValue, b: FValue) {
  if (typeof a === "string" && typeof b === "string") return a.localeCompare(b);
  return toNum(a instanceof Date ? a.getTime() : a) - toNum(b instanceof Date ? b.getTime() : b);
}

/** Parse + evaluate, returning an error message instead of throwing. */
export function runFormula(expression: string, getProp: (name: string) => FValue, now = new Date()): { value: FValue; error?: string } {
  try {
    return { value: evaluateFormula(parseFormula(expression), getProp, now) };
  } catch (e) {
    return { value: null, error: e instanceof FormulaError ? e.message : "Invalid formula" };
  }
}
