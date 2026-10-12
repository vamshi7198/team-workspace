// Custom block definitions shared by the browser editor and server-side conversion
// (Markdown import/export, text extraction). React node views are attached separately
// in the client so this file stays free of DOM/React dependencies.
import { mergeAttributes, Node } from "@tiptap/core";
import { Mention } from "@tiptap/extension-mention";

const escapeMd = (s: string) => s.replace(/([\[\]\\])/g, "\\$1");

export const Callout = Node.create({
  name: "callout",
  group: "block",
  content: "inline*",
  defining: true,
  addAttributes() {
    return {
      icon: { default: "💡" },
      color: { default: "gray" },
    };
  },
  parseHTML() {
    return [{ tag: "div[data-callout]" }];
  },
  renderHTML({ HTMLAttributes, node }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-callout": "", "data-color": node.attrs.color, class: "callout" }),
      ["span", { class: "callout-icon", contenteditable: "false" }, node.attrs.icon],
      ["div", { class: "callout-content" }, 0],
    ];
  },
  renderMarkdown: (node, h) => `> ${node.attrs?.icon ?? "💡"} ${h.renderChildren(node.content ?? [])}`,
});

export const FileAttachment = Node.create({
  name: "fileAttachment",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      fileId: { default: null },
      name: { default: "file" },
      size: { default: 0 },
      mimeType: { default: "" },
    };
  },
  parseHTML() {
    return [{ tag: "div[data-file-attachment]" }];
  },
  renderHTML({ HTMLAttributes, node }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-file-attachment": "" }),
      ["a", { href: `/api/files/${node.attrs.fileId}` }, node.attrs.name],
    ];
  },
  renderMarkdown: (node) => `📎 [${escapeMd(node.attrs?.name ?? "file")}](/api/files/${node.attrs?.fileId})`,
});

export const Bookmark = Node.create({
  name: "bookmark",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      url: { default: "" },
      title: { default: "" },
      description: { default: "" },
    };
  },
  parseHTML() {
    return [{ tag: "div[data-bookmark]" }];
  },
  renderHTML({ HTMLAttributes, node }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-bookmark": "" }),
      ["a", { href: node.attrs.url, rel: "noopener noreferrer nofollow", target: "_blank" }, node.attrs.title || node.attrs.url],
    ];
  },
  renderMarkdown: (node) => `🔖 [${escapeMd(node.attrs?.title || node.attrs?.url || "")}](${node.attrs?.url ?? ""})`,
});

// A block linking to a child (or any) page. Title is a snapshot; the UI shows the live title.
export const PageRef = Node.create({
  name: "pageRef",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      pageId: { default: null },
      title: { default: "Untitled" },
    };
  },
  parseHTML() {
    return [{ tag: "div[data-page-ref]" }];
  },
  renderHTML({ HTMLAttributes, node }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-page-ref": "" }),
      ["a", { href: `/p/${node.attrs.pageId}` }, node.attrs.title],
    ];
  },
  renderMarkdown: (node) => `📄 [${escapeMd(node.attrs?.title ?? "Untitled")}](/p/${node.attrs?.pageId})`,
});

// Inline view of a database (by its container page).
export const DatabaseEmbed = Node.create({
  name: "dbEmbed",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      pageId: { default: null },
      viewId: { default: null },
      title: { default: "Database" },
    };
  },
  parseHTML() {
    return [{ tag: "div[data-db-embed]" }];
  },
  renderHTML({ HTMLAttributes, node }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-db-embed": "" }),
      ["a", { href: `/p/${node.attrs.pageId}` }, node.attrs.title],
    ];
  },
  renderMarkdown: (node) => `🗃️ [${escapeMd(node.attrs?.title ?? "Database")}](/p/${node.attrs?.pageId})`,
});

// @-mentions of pages or people. `kind` distinguishes the two.
export const WorkspaceMention = Mention.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      kind: {
        default: "page",
        parseHTML: (el) => el.getAttribute("data-kind") ?? "page",
        renderHTML: (attrs) => ({ "data-kind": attrs.kind }),
      },
    };
  },
  renderMarkdown: (node) =>
    node.attrs?.kind === "user"
      ? `@${node.attrs?.label ?? "someone"}`
      : `[${escapeMd(node.attrs?.label ?? "page")}](/p/${node.attrs?.id})`,
});

export const BLOCK_ID_TYPES = [
  "paragraph",
  "heading",
  "blockquote",
  "bulletList",
  "orderedList",
  "listItem",
  "taskList",
  "taskItem",
  "codeBlock",
  "callout",
  "table",
  "image",
  "fileAttachment",
  "bookmark",
  "pageRef",
  "dbEmbed",
  "details",
  "horizontalRule",
];
