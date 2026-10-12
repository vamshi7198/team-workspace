// Pure helpers over ProseMirror JSON documents. Used by the server (search text,
// backlinks, action items) and by tests. No DOM, no editor instance.
import type { JSONContent } from "@tiptap/core";
import { BLOCK_ID_TYPES } from "./editor/nodes";

export type Doc = JSONContent;

export const emptyDoc = (): Doc => ({ type: "doc", content: [{ type: "paragraph" }] });

export function isDoc(value: unknown): value is Doc {
  return typeof value === "object" && value !== null && (value as Doc).type === "doc";
}

export function walk(node: JSONContent, visit: (n: JSONContent, parents: JSONContent[]) => void, parents: JSONContent[] = []) {
  visit(node, parents);
  for (const child of node.content ?? []) walk(child, visit, [...parents, node]);
}

const BLOCK_BREAK = new Set(["paragraph", "heading", "listItem", "taskItem", "codeBlock", "callout", "tableCell", "tableHeader", "detailsSummary", "blockquote"]);

/** Plain text of a node, blocks separated by newlines. Used for search and snippets. */
export function nodeText(node: JSONContent): string {
  const parts: string[] = [];
  const rec = (n: JSONContent) => {
    if (n.type === "text") parts.push(n.text ?? "");
    else if (n.type === "hardBreak") parts.push("\n");
    else if (n.type === "mention") parts.push(`@${n.attrs?.label ?? ""}`);
    else if (n.type === "pageRef" || n.type === "dbEmbed") parts.push(String(n.attrs?.title ?? ""));
    else if (n.type === "bookmark") parts.push(`${n.attrs?.title ?? ""} ${n.attrs?.url ?? ""}`);
    else if (n.type === "fileAttachment") parts.push(String(n.attrs?.name ?? ""));
    for (const c of n.content ?? []) rec(c);
    if (n.type && BLOCK_BREAK.has(n.type)) parts.push("\n");
  };
  rec(node);
  return parts.join("").replace(/\n{3,}/g, "\n\n").trim();
}

export const extractText = (doc: Doc) => nodeText(doc);

/** IDs of pages this document links to (mentions, sub-page blocks, database embeds). */
export function extractPageLinks(doc: Doc): string[] {
  const ids = new Set<string>();
  walk(doc, (n) => {
    if (n.type === "mention" && n.attrs?.kind !== "user" && n.attrs?.id) ids.add(String(n.attrs.id));
    if ((n.type === "pageRef" || n.type === "dbEmbed") && n.attrs?.pageId) ids.add(String(n.attrs.pageId));
  });
  return [...ids].filter((id) => /^[0-9a-f-]{36}$/i.test(id));
}

/** Users mentioned in the document. */
export function extractUserMentions(doc: Doc): string[] {
  const ids = new Set<string>();
  walk(doc, (n) => {
    if (n.type === "mention" && n.attrs?.kind === "user" && n.attrs?.id) ids.add(String(n.attrs.id));
  });
  return [...ids];
}

/** File IDs referenced by images and attachments. */
export function extractFileIds(doc: Doc): string[] {
  const ids = new Set<string>();
  walk(doc, (n) => {
    if (n.type === "fileAttachment" && n.attrs?.fileId) ids.add(String(n.attrs.fileId));
    if (n.type === "image" && typeof n.attrs?.src === "string") {
      const m = /\/api\/files\/([0-9a-f-]{36})/i.exec(n.attrs.src);
      if (m) ids.add(m[1]);
    }
  });
  return [...ids];
}

/**
 * Gives every block that should carry an ID a unique one. Duplicated IDs (e.g. from
 * copy/paste) are replaced. Returns a new document; the input is not mutated.
 */
export function ensureBlockIds(doc: Doc, newId: () => string = () => crypto.randomUUID()): Doc {
  const seen = new Set<string>();
  const types = new Set(BLOCK_ID_TYPES);
  const rec = (n: JSONContent): JSONContent => {
    const out: JSONContent = { ...n };
    if (n.type && types.has(n.type)) {
      let id = n.attrs?.id as string | undefined;
      if (!id || seen.has(id)) id = newId();
      seen.add(id);
      out.attrs = { ...(n.attrs ?? {}), id };
    }
    if (n.content) out.content = n.content.map(rec);
    return out;
  };
  return rec(doc);
}

/** Replaces all block IDs (used when duplicating a page so IDs stay unique per page). */
export function regenerateBlockIds(doc: Doc): Doc {
  const strip = (n: JSONContent): JSONContent => {
    const out: JSONContent = { ...n };
    if (out.attrs && "id" in out.attrs) out.attrs = { ...out.attrs, id: null };
    if (n.content) out.content = n.content.map(strip);
    return out;
  };
  return ensureBlockIds(strip(doc));
}

export type SectionItem = { blockId: string; text: string; checked: boolean };

const norm = (s: string) => s.trim().toLowerCase().replace(/[^a-z ]/g, "").trim();

/**
 * Collects items under a heading whose text matches one of `names` (case-insensitive),
 * until the next heading of the same or higher level. Used for meeting "Action items"
 * and "Decisions".
 */
export function sectionItems(doc: Doc, names: string[], kinds: "tasks" | "blocks"): SectionItem[] {
  const wanted = new Set(names.map(norm));
  const items: SectionItem[] = [];
  const top = doc.content ?? [];
  let activeLevel: number | null = null;
  for (const block of top) {
    if (block.type === "heading") {
      const level = Number(block.attrs?.level ?? 1);
      if (activeLevel !== null && level <= activeLevel) activeLevel = null;
      if (wanted.has(norm(nodeText(block)))) activeLevel = level;
      continue;
    }
    if (activeLevel === null) continue;
    if (kinds === "tasks") {
      walk(block, (n) => {
        if (n.type === "taskItem") {
          const text = nodeText({ type: "x", content: (n.content ?? []).filter((c) => c.type !== "taskList") });
          if (text) items.push({ blockId: String(n.attrs?.id ?? ""), text, checked: Boolean(n.attrs?.checked) });
        }
      });
    } else {
      const collect = (n: JSONContent) => {
        if (n.type === "bulletList" || n.type === "orderedList" || n.type === "taskList") {
          for (const li of n.content ?? []) {
            const text = nodeText({ type: "x", content: (li.content ?? []).filter((c) => !["bulletList", "orderedList", "taskList"].includes(c.type ?? "")) });
            if (text) items.push({ blockId: String(li.attrs?.id ?? ""), text, checked: Boolean(li.attrs?.checked) });
          }
        } else {
          const text = nodeText(n);
          if (text) items.push({ blockId: String(n.attrs?.id ?? ""), text, checked: false });
        }
      };
      collect(block);
    }
  }
  return items;
}

export const actionItems = (doc: Doc) => sectionItems(doc, ["action items", "action item", "next steps", "todos", "to do", "todo"], "tasks");
export const decisions = (doc: Doc) => sectionItems(doc, ["decisions", "decision", "decisions made"], "blocks");

const SAFE_URL = /^(https?:|mailto:|\/(?!\/)|#)/i;
const SAFE_IMG = /^(https:\/\/|\/api\/files\/[0-9a-f-]{36}$)/i;

/**
 * Removes unsafe URLs from links, images and bookmarks, and drops unknown attributes
 * that could carry script (defence in depth; the editor also validates on input).
 */
export function sanitizeDoc(doc: Doc): Doc {
  const rec = (n: JSONContent): JSONContent => {
    const out: JSONContent = { ...n };
    if (n.marks) {
      out.marks = n.marks
        .map((m) => (m.type === "link" ? { ...m, attrs: { ...m.attrs, href: SAFE_URL.test(String(m.attrs?.href ?? "")) ? m.attrs?.href : null } } : m))
        .filter((m) => m.type !== "link" || m.attrs?.href);
    }
    if (n.type === "image" && !SAFE_IMG.test(String(n.attrs?.src ?? ""))) return { type: "paragraph" };
    if (n.type === "bookmark" && !/^https?:\/\//i.test(String(n.attrs?.url ?? ""))) return { type: "paragraph" };
    if (n.content) out.content = n.content.map(rec);
    return out;
  };
  return rec(doc);
}

/** Builds a simple document from headings and paragraphs (used by templates). */
export function docFromOutline(outline: Array<{ h?: 1 | 2 | 3; p?: string; todo?: string[]; bullets?: string[]; callout?: string }>): Doc {
  const content: JSONContent[] = [];
  const text = (t: string) => (t ? [{ type: "text", text: t }] : undefined);
  for (const item of outline) {
    if (item.h) content.push({ type: "heading", attrs: { level: item.h }, content: text(item.p ?? "") });
    else if (item.callout !== undefined) content.push({ type: "callout", attrs: { icon: "💡", color: "gray" }, content: text(item.callout) });
    else if (item.todo) content.push({ type: "taskList", content: item.todo.map((t) => ({ type: "taskItem", attrs: { checked: false }, content: [{ type: "paragraph", content: text(t) }] })) });
    else if (item.bullets) content.push({ type: "bulletList", content: item.bullets.map((t) => ({ type: "listItem", content: [{ type: "paragraph", content: text(t) }] })) });
    else content.push({ type: "paragraph", content: text(item.p ?? "") });
  }
  return ensureBlockIds({ type: "doc", content });
}
