// Markdown <-> document conversion using the same extensions as the editor.
import { MarkdownManager } from "@tiptap/markdown";
import { ensureBlockIds, type Doc } from "./doc";
import { documentExtensions } from "./editor/schema";

let manager: MarkdownManager | undefined;

function md() {
  if (!manager) manager = new MarkdownManager({ extensions: documentExtensions() });
  return manager;
}

export function docToMarkdown(doc: Doc, title?: string): string {
  const body = md().serialize(doc).trim();
  return title ? `# ${title}\n\n${body}\n` : `${body}\n`;
}

export function markdownToDoc(markdown: string): Doc {
  const parsed = md().parse(markdown.replace(/\r\n/g, "\n"));
  const doc: Doc = parsed.type === "doc" ? parsed : { type: "doc", content: parsed.content ?? [] };
  if (!doc.content?.length) doc.content = [{ type: "paragraph" }];
  return ensureBlockIds(doc);
}

/** Splits a leading "# Title" line off a Markdown document. */
export function splitTitle(markdown: string): { title: string | null; body: string } {
  const m = /^﻿?\s*#\s+(.+?)\s*\n/.exec(markdown);
  if (!m) return { title: null, body: markdown };
  return { title: m[1].trim(), body: markdown.slice(m[0].length) };
}
