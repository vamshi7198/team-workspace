"use client";

import { Extension, type Editor, type Range } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import Suggestion from "@tiptap/suggestion";
import {
  AtSign, Bookmark, CheckSquare, ChevronRight, Code, Database, FileText, Heading1, Heading2, Heading3, Image as ImageIcon,
  Link2, List, ListOrdered, Minus, Paperclip, Quote, Table, Text, MessageSquareWarning,
} from "lucide-react";
import { suggestionRenderer, type MenuItem } from "./suggestion-popup";

/** Things the slash menu needs from the page (uploads, creating sub-pages...). */
export type EditorActions = {
  pickImage: (editor: Editor) => void;
  pickFile: (editor: Editor) => void;
  addBookmark: (editor: Editor) => void;
  addSubpage: (editor: Editor) => void;
  addDatabase: (editor: Editor) => void;
  linkDatabase: (editor: Editor) => void;
};

type SlashItem = MenuItem & { keywords: string; run: (editor: Editor, range: Range, actions: EditorActions) => void };

const i = (Icon: React.ComponentType<{ className?: string }>) => <Icon className="size-4" />;

export const SLASH_ITEMS: SlashItem[] = [
  { id: "text", group: "Basic blocks", title: "Text", subtitle: "Plain paragraph", icon: i(Text), keywords: "paragraph p plain", run: (e, r) => e.chain().focus().deleteRange(r).setParagraph().run() },
  { id: "h1", group: "Basic blocks", title: "Heading 1", subtitle: "Big section heading", icon: i(Heading1), keywords: "heading title h1 #", run: (e, r) => e.chain().focus().deleteRange(r).setHeading({ level: 1 }).run() },
  { id: "h2", group: "Basic blocks", title: "Heading 2", subtitle: "Medium heading", icon: i(Heading2), keywords: "heading subtitle h2 ##", run: (e, r) => e.chain().focus().deleteRange(r).setHeading({ level: 2 }).run() },
  { id: "h3", group: "Basic blocks", title: "Heading 3", subtitle: "Small heading", icon: i(Heading3), keywords: "heading h3 ###", run: (e, r) => e.chain().focus().deleteRange(r).setHeading({ level: 3 }).run() },
  { id: "todo", group: "Basic blocks", title: "To-do list", subtitle: "Track tasks with checkboxes", icon: i(CheckSquare), keywords: "todo task checkbox check action", run: (e, r) => e.chain().focus().deleteRange(r).toggleTaskList().run() },
  { id: "bullet", group: "Basic blocks", title: "Bulleted list", icon: i(List), keywords: "bullet unordered list ul -", run: (e, r) => e.chain().focus().deleteRange(r).toggleBulletList().run() },
  { id: "numbered", group: "Basic blocks", title: "Numbered list", icon: i(ListOrdered), keywords: "numbered ordered list ol 1.", run: (e, r) => e.chain().focus().deleteRange(r).toggleOrderedList().run() },
  { id: "toggle", group: "Basic blocks", title: "Toggle", subtitle: "Collapsible section", icon: i(ChevronRight), keywords: "toggle collapse details expand", run: (e, r) => e.chain().focus().deleteRange(r).setDetails().run() },
  { id: "quote", group: "Basic blocks", title: "Quote", icon: i(Quote), keywords: "quote blockquote citation", run: (e, r) => e.chain().focus().deleteRange(r).toggleBlockquote().run() },
  { id: "callout", group: "Basic blocks", title: "Callout", subtitle: "Make text stand out", icon: i(MessageSquareWarning), keywords: "callout note info warning tip", run: (e, r) => e.chain().focus().deleteRange(r).insertContent({ type: "callout", attrs: { icon: "💡", color: "gray" } }).run() },
  { id: "divider", group: "Basic blocks", title: "Divider", icon: i(Minus), keywords: "divider hr line separator ---", run: (e, r) => e.chain().focus().deleteRange(r).setHorizontalRule().run() },
  { id: "code", group: "Basic blocks", title: "Code", subtitle: "Code block with highlighting", icon: i(Code), keywords: "code snippet pre ```", run: (e, r) => e.chain().focus().deleteRange(r).toggleCodeBlock().run() },
  { id: "table", group: "Basic blocks", title: "Table", subtitle: "Simple table", icon: i(Table), keywords: "table grid rows columns", run: (e, r) => e.chain().focus().deleteRange(r).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
  { id: "page", group: "Pages", title: "Page", subtitle: "Create a sub-page inside this one", icon: i(FileText), keywords: "page subpage child new", run: (e, r, a) => { e.chain().focus().deleteRange(r).run(); a.addSubpage(e); } },
  { id: "mention", group: "Pages", title: "Mention a page or person", icon: i(AtSign), keywords: "mention link page person @", run: (e, r) => e.chain().focus().deleteRange(r).insertContent("@").run() },
  { id: "database", group: "Databases", title: "Database", subtitle: "New table, board or calendar", icon: i(Database), keywords: "database table board kanban calendar inline", run: (e, r, a) => { e.chain().focus().deleteRange(r).run(); a.addDatabase(e); } },
  { id: "linked", group: "Databases", title: "Linked view of database", subtitle: "Show an existing database here", icon: i(Link2), keywords: "linked database embed existing view tasks projects", run: (e, r, a) => { e.chain().focus().deleteRange(r).run(); a.linkDatabase(e); } },
  { id: "image", group: "Media", title: "Image", subtitle: "Upload an image", icon: i(ImageIcon), keywords: "image picture photo upload png jpg", run: (e, r, a) => { e.chain().focus().deleteRange(r).run(); a.pickImage(e); } },
  { id: "file", group: "Media", title: "File", subtitle: "Attach a file", icon: i(Paperclip), keywords: "file attachment upload pdf document", run: (e, r, a) => { e.chain().focus().deleteRange(r).run(); a.pickFile(e); } },
  { id: "bookmark", group: "Media", title: "Bookmark", subtitle: "Link card to a website", icon: i(Bookmark), keywords: "bookmark link url web embed", run: (e, r, a) => { e.chain().focus().deleteRange(r).run(); a.addBookmark(e); } },
];

export function filterSlashItems(query: string) {
  const q = query.toLowerCase().trim();
  if (!q) return SLASH_ITEMS;
  return SLASH_ITEMS.filter((it) => it.title.toLowerCase().includes(q) || it.keywords.includes(q));
}

export const SlashCommand = Extension.create<{ getActions: () => EditorActions }>({
  name: "slashCommand",
  addOptions() {
    return { getActions: () => { throw new Error("SlashCommand needs getActions"); } };
  },
  addProseMirrorPlugins() {
    return [
      Suggestion<SlashItem>({
        editor: this.editor,
        pluginKey: new PluginKey("slashCommand"),
        char: "/",
        startOfLine: false,
        // Allow "/heading 2", "/to do" etc.; the menu hides itself once nothing matches.
        allowSpaces: true,
        allow: ({ state, range }) => {
          // Not inside code blocks.
          const $from = state.doc.resolve(range.from);
          return $from.parent.type.name !== "codeBlock";
        },
        items: ({ query }) => filterSlashItems(query),
        command: ({ editor, range, props }) => props.run(editor, range, this.options.getActions()),
        render: suggestionRenderer<SlashItem>("No matching blocks", { hideWhenEmpty: true }),
      }),
    ];
  },
});
