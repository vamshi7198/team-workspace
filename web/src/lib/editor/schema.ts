// The single list of document extensions. Client and server must agree on it so that
// what the editor saves can always be parsed, searched and exported on the server.
import type { AnyExtension } from "@tiptap/core";
import { Details, DetailsContent, DetailsSummary } from "@tiptap/extension-details";
import { Highlight } from "@tiptap/extension-highlight";
import { Image } from "@tiptap/extension-image";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { TableKit } from "@tiptap/extension-table";
import { BackgroundColor, Color, TextStyle } from "@tiptap/extension-text-style";
import { UniqueID } from "@tiptap/extension-unique-id";
import { StarterKit } from "@tiptap/starter-kit";
import { BLOCK_ID_TYPES, Bookmark, Callout, DatabaseEmbed, FileAttachment, PageRef, WorkspaceMention } from "./nodes";

export type SchemaOptions = {
  /** Replacement for the plain code block (the client passes CodeBlockLowlight). */
  codeBlock?: AnyExtension;
  /** Extra client-only extensions (placeholder, slash menu, drag handle...). */
  extra?: AnyExtension[];
  /** Overrides for custom nodes (client attaches React node views). */
  overrides?: Partial<Record<"callout" | "fileAttachment" | "bookmark" | "pageRef" | "dbEmbed" | "mention", AnyExtension>>;
  mention?: AnyExtension;
};

export function documentExtensions(opts: SchemaOptions = {}): AnyExtension[] {
  const o = opts.overrides ?? {};
  return [
    StarterKit.configure({
      codeBlock: opts.codeBlock ? false : {},
      link: {
        openOnClick: false,
        autolink: true,
        protocols: ["http", "https", "mailto"],
        HTMLAttributes: { rel: "noopener noreferrer nofollow", target: "_blank" },
      },
      heading: { levels: [1, 2, 3] },
      undoRedo: { depth: 200 },
    }),
    ...(opts.codeBlock ? [opts.codeBlock] : []),
    TaskList,
    TaskItem.configure({ nested: true }),
    TableKit.configure({ table: { resizable: true } }),
    Details.configure({ persist: true, HTMLAttributes: { class: "toggle" } }),
    DetailsSummary,
    DetailsContent,
    TextStyle,
    Color,
    BackgroundColor,
    Highlight.configure({ multicolor: true }),
    Image.configure({ inline: false, allowBase64: false }),
    o.callout ?? Callout,
    o.fileAttachment ?? FileAttachment,
    o.bookmark ?? Bookmark,
    o.pageRef ?? PageRef,
    o.dbEmbed ?? DatabaseEmbed,
    o.mention ?? WorkspaceMention,
    UniqueID.configure({ types: BLOCK_ID_TYPES, attributeName: "id" }),
    ...(opts.extra ?? []),
  ];
}
