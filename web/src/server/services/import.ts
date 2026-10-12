import { unzipSync } from "fflate";
import Papa from "papaparse";
import type { SelectOption } from "@/lib/db-engine/types";
import { markdownToDoc, splitTitle } from "@/lib/markdown";
import { db, type DbOrTx } from "../db";
import { badRequest } from "../errors";
import { audit } from "./audit";
import { writeContentUnchecked } from "./content";
import { createDatabase, createRow, type PropertySpec } from "./databases";
import { uploadFile } from "./files";
import { createPage, type Section } from "./pages";
import { requireContributor } from "./permissions";

const NOTION_ID = /\s+[0-9a-f]{32}$/i;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif)$/i;

export const cleanTitle = (name: string) => name.replace(/\.(md|csv)$/i, "").replace(/_all$/i, "").replace(NOTION_ID, "").trim() || "Untitled";

const dirname = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
function resolvePath(fromDir: string, rel: string): string {
  const parts = (fromDir ? fromDir.split("/") : []).concat(rel.split("/"));
  const out: string[] = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return out.join("/");
}

/** Unzips, flattening nested zips (Notion splits large exports into Part-N.zip files). */
export function readZip(data: Uint8Array, depth = 0): Map<string, Uint8Array> {
  if (depth > 2) return new Map();
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(data);
  } catch {
    throw badRequest("Could not read the ZIP file");
  }
  const out = new Map<string, Uint8Array>();
  for (const [rawPath, bytes] of Object.entries(entries)) {
    const path = rawPath.replace(/\\/g, "/");
    if (path.endsWith("/") || path.startsWith("__MACOSX/") || /(^|\/)\.[^/]+$/.test(path)) continue;
    if (path.toLowerCase().endsWith(".zip")) {
      for (const [p, b] of readZip(bytes, depth + 1)) out.set(p, b);
    } else {
      out.set(path, bytes);
    }
  }
  // Drop a single top-level folder that wraps everything (e.g. "Export-<id>/").
  const firstSegments = new Set([...out.keys()].map((p) => p.split("/")[0]));
  if (firstSegments.size === 1 && [...out.keys()].every((p) => p.includes("/"))) {
    const prefix = [...firstSegments][0] + "/";
    return new Map([...out].map(([p, b]) => [p.slice(prefix.length), b]));
  }
  return out;
}

// ---- CSV → database properties -----------------------------------------------

type Column = { name: string; spec: PropertySpec; parse: (raw: string) => unknown };

const COLORS: SelectOption["color"][] = ["blue", "green", "orange", "purple", "pink", "yellow", "red", "brown", "gray"];

function parseNotionDate(raw: string): { start: string; end?: string } | null {
  const toIso = (s: string) => {
    const t = s.replace(/\(GMT[^)]*\)/, "").trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
    const d = new Date(t.replace(/^(\d{4})\/(\d{2})\/(\d{2})/, "$1-$2-$3"));
    if (Number.isNaN(d.getTime())) return null;
    const pad = (n: number) => String(n).padStart(2, "0");
    const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    return /\d{1,2}:\d{2}/.test(t) ? `${date}T${pad(d.getHours())}:${pad(d.getMinutes())}` : date;
  };
  const [a, b] = raw.split("→").map((x) => x.trim());
  const start = toIso(a);
  if (!start) return null;
  const end = b ? toIso(b) : null;
  return end ? { start, end } : { start };
}

export function inferColumn(name: string, values: string[]): Column {
  const nonEmpty = values.map((v) => v.trim()).filter(Boolean);
  const text: Column = { name, spec: { name, type: "text" }, parse: (r) => r || null };
  if (!nonEmpty.length) return text;
  const all = (re: RegExp) => nonEmpty.every((v) => re.test(v));

  if (all(/^(yes|no)$/i)) return { name, spec: { name, type: "checkbox" }, parse: (r) => /^yes$/i.test(r.trim()) };
  if (all(/^-?[\d,]*\.?\d+%?$/)) return { name, spec: { name, type: "number" }, parse: (r) => (r.trim() ? Number(r.replace(/[,%]/g, "")) : null) };
  if (all(/^https?:\/\/\S+$/i)) return { name, spec: { name, type: "url" }, parse: (r) => r.trim() || null };
  if (all(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) return { name, spec: { name, type: "email" }, parse: (r) => r.trim() || null };
  if (nonEmpty.every((v) => parseNotionDate(v) !== null) && nonEmpty.some((v) => /\d{4}/.test(v)))
    return { name, spec: { name, type: "date" }, parse: (r) => (r.trim() ? parseNotionDate(r) : null) };

  const isMulti = nonEmpty.some((v) => v.includes(", ")) && !nonEmpty.some((v) => v.length > 200);
  const tokens = isMulti ? nonEmpty.flatMap((v) => v.split(",").map((t) => t.trim()).filter(Boolean)) : nonEmpty;
  const distinct = [...new Set(tokens)];
  const selectLike = distinct.length <= 30 && distinct.every((d) => d.length <= 60) && (nonEmpty.length >= 3 ? distinct.length < nonEmpty.length : true);
  if (!selectLike) return text;

  const isStatus = /^status$/i.test(name) && !isMulti;
  const options: SelectOption[] = distinct.map((d, i) => ({
    id: crypto.randomUUID(),
    name: d,
    color: COLORS[i % COLORS.length],
    ...(isStatus ? { group: /done|complete|closed|shipped/i.test(d) ? "done" : /progress|doing|review|blocked/i.test(d) ? "in_progress" : "todo" } : {}),
  }));
  const idOf = new Map(options.map((o) => [o.name, o.id]));
  if (isMulti) return { name, spec: { name, type: "multi_select", config: { options } }, parse: (r) => r.split(",").map((t) => idOf.get(t.trim())).filter(Boolean) };
  return { name, spec: { name, type: isStatus ? "status" : "select", config: { options } }, parse: (r) => idOf.get(r.trim()) ?? null };
}

// ---- main import -------------------------------------------------------------

type Entry = { path: string; key: string; title: string; kind: "page" | "database"; parentKey: string | null };

export type ImportSummary = { rootPageId: string; pages: number; databases: number; rows: number; files: number; skipped: string[] };

/**
 * Imports Markdown files and Notion "Markdown & CSV" exports. Everything is created
 * under a new page, so existing content is never modified or overwritten.
 */
export async function importArchive(
  userId: string,
  input: { workspaceId: string; files: Map<string, Uint8Array>; rootTitle: string; parentId?: string | null; section?: Section },
  ip: string | null,
): Promise<ImportSummary> {
  await requireContributor(userId, input.workspaceId);
  const entries = input.files;
  const decoder = new TextDecoder();
  const mdPaths = [...entries.keys()].filter((p) => p.toLowerCase().endsWith(".md"));
  const csvPaths = [...entries.keys()].filter((p) => p.toLowerCase().endsWith(".csv"));
  if (!mdPaths.length && !csvPaths.length) throw badRequest("No Markdown or CSV files found");

  // Databases: prefer "X_all.csv" (all rows) over "X.csv" (current view only).
  const dbByKey = new Map<string, string>();
  for (const p of csvPaths) {
    const key = p.replace(/\.csv$/i, "").replace(/_all$/i, "");
    if (!dbByKey.has(key) || /_all\.csv$/i.test(p)) dbByKey.set(key, p);
  }
  const all: Entry[] = [];
  for (const p of mdPaths) all.push({ path: p, key: p.replace(/\.md$/i, ""), title: cleanTitle(p.split("/").pop()!), kind: "page", parentKey: null });
  for (const [key, p] of dbByKey) all.push({ path: p, key, title: cleanTitle(key.split("/").pop()!), kind: "database", parentKey: null });
  const byKey = new Map(all.map((e) => [e.key, e]));
  for (const e of all) {
    let dir = dirname(e.key);
    while (dir && !byKey.has(dir)) dir = dirname(dir);
    e.parentKey = dir || null;
  }
  // Parents before children.
  const depth = (e: Entry): number => (e.parentKey ? 1 + depth(byKey.get(e.parentKey)!) : 0);
  all.sort((a, b) => depth(a) - depth(b) || a.title.localeCompare(b.title));

  const summary: ImportSummary = { rootPageId: "", pages: 0, databases: 0, rows: 0, files: 0, skipped: [] };

  await db.transaction(async (tx) => {
    const root = await createPage(userId, { workspaceId: input.workspaceId, parentId: input.parentId, section: input.section ?? { type: "private" }, title: input.rootTitle, icon: "📥" }, tx);
    summary.rootPageId = root.id;
    const pageIdByKey = new Map<string, string>();
    const databaseIdByKey = new Map<string, string>();
    const rowBodies: { pageId: string; path: string; markdown: string }[] = [];

    for (const e of all) {
      const parentPageId = e.parentKey ? pageIdByKey.get(e.parentKey) ?? root.id : root.id;
      const parentIsDb = e.parentKey ? databaseIdByKey.has(e.parentKey) : false;

      if (e.kind === "database") {
        const rows = Papa.parse<string[]>(decoder.decode(entries.get(e.path)!).replace(/^﻿/, ""), { skipEmptyLines: true }).data;
        const [header = [], ...body] = rows;
        if (!header.length) { summary.skipped.push(e.path); continue; }
        const columns = header.slice(1).map((name, i) => inferColumn(name, body.map((r) => r[i + 1] ?? "")));
        const created = await createDatabase(userId, {
          workspaceId: input.workspaceId,
          parentId: parentIsDb ? root.id : parentPageId,
          title: e.title,
          titleName: header[0] || "Name",
          properties: columns.map((c, i) => ({ ...c.spec, key: `col${i}` })),
        }, tx);
        pageIdByKey.set(e.key, created.page.id);
        databaseIdByKey.set(e.key, created.database.id);
        summary.databases++;
        // Row pages from the CSV; their Markdown bodies (if exported) are matched by title.
        const rowMd = new Map<string, { path: string }>();
        for (const p of mdPaths) if (dirname(p) === e.key) rowMd.set(cleanTitle(p.split("/").pop()!), { path: p });
        for (const r of body) {
          const values: Record<string, unknown> = {};
          columns.forEach((c, i) => {
            const v = c.parse(r[i + 1] ?? "");
            if (v !== null && v !== undefined && !(Array.isArray(v) && !v.length)) values[created.keyToId[`col${i}`]] = v;
          });
          const title = (r[0] ?? "").trim();
          const row = await createRow(userId, created.database.id, { title, values, useTemplate: false }, tx);
          summary.rows++;
          const md = rowMd.get(title || "Untitled");
          if (md) {
            pageIdByKey.set(md.path.replace(/\.md$/i, ""), row.id);
            rowBodies.push({ pageId: row.id, path: md.path, markdown: stripPropertyBlock(decoder.decode(entries.get(md.path)!), header) });
            rowMd.delete(title || "Untitled");
          }
        }
        continue;
      }

      if (parentIsDb && pageIdByKey.has(e.key)) continue; // already created as a row
      const page = await createPage(userId, { workspaceId: input.workspaceId, parentId: parentIsDb ? root.id : parentPageId, title: e.title }, tx);
      pageIdByKey.set(e.key, page.id);
      summary.pages++;
    }

    // Second pass: content, with links rewritten to the new pages and assets uploaded.
    const uploaded = new Map<string, string>();
    const convert = async (pageId: string, mdPath: string, markdown: string, txi: DbOrTx) => {
      const dir = dirname(mdPath);
      const rewritten = await replaceAsync(markdown, /(!?)\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, async (whole, bang: string, label: string, href: string) => {
        if (/^[a-z]+:/i.test(href) || href.startsWith("#")) return whole;
        let target: string;
        try { target = resolvePath(dir, decodeURIComponent(href)); } catch { return whole; }
        const key = target.replace(/\.(md|csv)$/i, "").replace(/_all$/i, "");
        if (/\.(md|csv)$/i.test(target) && pageIdByKey.has(key)) return `[${label}](/p/${pageIdByKey.get(key)})`;
        const bytes = entries.get(target);
        if (!bytes) return bang ? `*[missing image: ${label || target}]*` : label;
        let fileId = uploaded.get(target);
        if (!fileId) {
          try {
            const f = await uploadFile(userId, { pageId, name: target.split("/").pop()!, data: bytes }, txi);
            fileId = f.id;
            uploaded.set(target, fileId);
            summary.files++;
          } catch {
            summary.skipped.push(target);
            return label;
          }
        }
        return bang && IMAGE_EXT.test(target) ? `![${label}](/api/files/${fileId})` : `[${label || target.split("/").pop()}](/api/files/${fileId})`;
      });
      const { body } = splitTitle(rewritten);
      await writeContentUnchecked(txi, pageId, markdownToDoc(body), userId);
    };
    for (const e of all) {
      if (e.kind !== "page") continue;
      const pageId = pageIdByKey.get(e.key);
      if (!pageId || rowBodies.some((r) => r.pageId === pageId)) continue;
      await convert(pageId, e.path, decoder.decode(entries.get(e.path)!), tx);
    }
    for (const r of rowBodies) await convert(r.pageId, r.path, r.markdown, tx);

    await audit({ workspaceId: input.workspaceId, actorId: userId, action: "import.completed", target: root.id, meta: { ...summary, skipped: summary.skipped.length }, ip }, tx);
  });
  return summary;
}

/** Notion row exports repeat the properties as "Name: value" lines under the title; drop them. */
function stripPropertyBlock(markdown: string, headers: string[]): string {
  const names = new Set(headers.map((h) => h.trim().toLowerCase()));
  const { title, body } = splitTitle(markdown);
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  let i = 0;
  while (i < lines.length && lines[i].trim() === "") i++;
  let j = i;
  while (j < lines.length) {
    const m = /^([^:]{1,80}):\s?(.*)$/.exec(lines[j]);
    if (!m || !names.has(m[1].trim().toLowerCase())) break;
    j++;
  }
  const rest = j > i ? lines.slice(j).join("\n") : body;
  return title ? `# ${title}\n\n${rest}` : rest;
}

async function replaceAsync(input: string, re: RegExp, fn: (...m: string[]) => Promise<string>) {
  const matches = [...input.matchAll(re)];
  const replacements: string[] = [];
  for (const m of matches) replacements.push(await fn(...(m as unknown as string[])));
  let i = 0;
  return input.replace(re, () => replacements[i++]);
}

/** Single Markdown file(s) without a ZIP. */
export function filesFromMarkdown(list: { name: string; data: Uint8Array }[]) {
  const map = new Map<string, Uint8Array>();
  for (const f of list) map.set(f.name.replace(/\\/g, "/").split("/").pop()!, f.data);
  return map;
}
