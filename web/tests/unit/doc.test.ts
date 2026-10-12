import { describe, expect, it } from "vitest";
import {
  actionItems,
  decisions,
  docFromOutline,
  ensureBlockIds,
  extractPageLinks,
  extractText,
  regenerateBlockIds,
  type Doc,
} from "@/lib/doc";
import { docToMarkdown, markdownToDoc, splitTitle } from "@/lib/markdown";

const PAGE = "11111111-1111-4111-8111-111111111111";

describe("document helpers", () => {
  it("extracts searchable text across blocks", () => {
    const doc: Doc = {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Launch plan" }] },
        { type: "paragraph", content: [{ type: "text", text: "Ship on " }, { type: "text", marks: [{ type: "bold" }], text: "Friday" }] },
        { type: "callout", attrs: { icon: "ðŸ’¡" }, content: [{ type: "text", text: "Remember QA" }] },
      ],
    };
    expect(extractText(doc)).toBe("Launch plan\nShip on Friday\nRemember QA");
  });

  it("finds page links from mentions, sub-page blocks and embeds, ignoring people", () => {
    const doc: Doc = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "mention", attrs: { id: PAGE, label: "Spec", kind: "page" } }, { type: "mention", attrs: { id: "u1", label: "Asha", kind: "user" } }] },
        { type: "pageRef", attrs: { pageId: PAGE, title: "Spec" } },
      ],
    };
    expect(extractPageLinks(doc)).toEqual([PAGE]);
  });

  it("assigns unique block ids and fixes duplicates", () => {
    const doc: Doc = { type: "doc", content: [{ type: "paragraph", attrs: { id: "a" } }, { type: "paragraph", attrs: { id: "a" } }, { type: "paragraph" }] };
    const out = ensureBlockIds(doc);
    const ids = out.content!.map((n) => n.attrs!.id);
    expect(ids[0]).toBe("a");
    expect(new Set(ids).size).toBe(3);
    expect(doc.content![2].attrs).toBeUndefined(); // input untouched
    const regenerated = regenerateBlockIds(out).content!.map((n) => n.attrs!.id);
    expect(regenerated).not.toContain("a");
  });

  it("reads action items and decisions from meeting sections", () => {
    const doc = docFromOutline([
      { h: 2, p: "Agenda" },
      { bullets: ["Budget"] },
      { h: 2, p: "Decisions" },
      { bullets: ["Use Postgres", "Ship Friday"] },
      { h: 2, p: "Action items" },
      { todo: ["Write spec", "Book venue"] },
      { h: 2, p: "Notes" },
      { todo: ["Not an action item"] },
    ]);
    const items = actionItems(doc);
    expect(items.map((i) => i.text)).toEqual(["Write spec", "Book venue"]);
    expect(items.every((i) => i.blockId.length > 0)).toBe(true);
    expect(decisions(doc).map((d) => d.text)).toEqual(["Use Postgres", "Ship Friday"]);
  });
});

describe("markdown", () => {
  it("round-trips common blocks and inline formatting", () => {
    const md = [
      "# Heading",
      "",
      "Some **bold**, *italic*, ~~struck~~ and `code` with a [link](https://example.com).",
      "",
      "- one",
      "- two",
      "",
      "1. first",
      "2. second",
      "",
      "- [ ] open task",
      "- [x] done task",
      "",
      "> quoted",
      "",
      "```ts",
      "const x = 1;",
      "```",
      "",
      "---",
    ].join("\n");
    const doc = markdownToDoc(md);
    const types = doc.content!.map((n) => n.type);
    expect(types).toEqual(["heading", "paragraph", "bulletList", "orderedList", "taskList", "blockquote", "codeBlock", "horizontalRule"]);
    const back = docToMarkdown(doc);
    for (const fragment of ["# Heading", "**bold**", "*italic*", "~~struck~~", "`code`", "[link](https://example.com)", "- one", "1. first", "- [ ] open task", "- [x] done task", "> quoted", "```ts", "const x = 1;", "---"]) {
      expect(back).toContain(fragment);
    }
  });

  it("exports custom blocks as readable markdown", () => {
    const doc: Doc = {
      type: "doc",
      content: [
        { type: "pageRef", attrs: { pageId: PAGE, title: "Child page" } },
        { type: "callout", attrs: { icon: "âš ï¸" }, content: [{ type: "text", text: "Careful" }] },
        { type: "bookmark", attrs: { url: "https://example.com", title: "Example" } },
      ],
    };
    const out = docToMarkdown(doc, "Title");
    expect(out).toContain("# Title");
    expect(out).toContain(`[Child page](/p/${PAGE})`);
    expect(out).toContain("> âš ï¸ Careful");
    expect(out).toContain("[Example](https://example.com)");
  });

  it("parses tables", () => {
    const doc = markdownToDoc("| a | b |\n| --- | --- |\n| 1 | 2 |\n");
    expect(doc.content![0].type).toBe("table");
  });

  it("splits a title heading", () => {
    expect(splitTitle("# Hello\n\nbody")).toEqual({ title: "Hello", body: "body" });
    expect(splitTitle("no title")).toEqual({ title: null, body: "no title" });
  });
});
