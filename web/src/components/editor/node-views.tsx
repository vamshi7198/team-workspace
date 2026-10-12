"use client";

import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { CodeBlockLowlight } from "@tiptap/extension-code-block-lowlight";
import { common, createLowlight } from "lowlight";
import { Bookmark as BookmarkIcon, Download, ExternalLink, FileText, Paperclip } from "lucide-react";
import Link from "next/link";
import { DatabaseView } from "@/components/database/database-view";
import { EmojiPicker } from "@/components/emoji-picker";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useWorkspace } from "@/components/workspace-context";
import { Bookmark, Callout, DatabaseEmbed, FileAttachment, PageRef } from "@/lib/editor/nodes";
import { useTree } from "@/lib/queries";

export const lowlight = createLowlight(common);

const CALLOUT_COLORS = ["gray", "blue", "green", "yellow", "orange", "red", "purple"];

function CalloutView({ node, updateAttributes, editor }: NodeViewProps) {
  const editable = editor.isEditable;
  return (
    <NodeViewWrapper className="callout" data-color={node.attrs.color} data-callout="">
      {editable ? (
        <EmojiPicker value={node.attrs.icon} onChange={(v) => updateAttributes({ icon: v ?? "💡" })} allowRemove={false}>
          <button type="button" contentEditable={false} className="callout-icon" aria-label="Change callout icon">{node.attrs.icon}</button>
        </EmojiPicker>
      ) : (
        <span className="callout-icon" contentEditable={false}>{node.attrs.icon}</span>
      )}
      <NodeViewContent className="callout-content" />
      {editable && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" contentEditable={false} className="h-5 self-start rounded px-1 text-xs text-muted-foreground opacity-0 hover:bg-foreground/10 group-hover:opacity-100 [.callout:hover_&]:opacity-100" aria-label="Callout color">Color</button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            {CALLOUT_COLORS.map((c) => (
              <DropdownMenuItem key={c} onSelect={() => updateAttributes({ color: c })}>
                <span className={`tag tag-${c} size-4 p-0`} /> {c[0].toUpperCase() + c.slice(1)}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </NodeViewWrapper>
  );
}

const formatSize = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n > 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`);

function FileView({ node, selected }: NodeViewProps) {
  return (
    <NodeViewWrapper data-drag-handle="" className={`my-1 flex items-center gap-3 rounded-md border px-3 py-2 ${selected ? "ring-2 ring-blue-500/40" : ""}`} contentEditable={false}>
      <Paperclip className="size-4 flex-none text-muted-foreground" />
      <a href={`/api/files/${node.attrs.fileId}`} target="_blank" rel="noopener" className="min-w-0 flex-1 truncate !no-underline hover:!underline">{node.attrs.name}</a>
      <span className="text-xs text-muted-foreground">{formatSize(Number(node.attrs.size) || 0)}</span>
      <a href={`/api/files/${node.attrs.fileId}?download=1`} aria-label="Download" className="rounded p-1 hover:bg-accent"><Download className="size-4" /></a>
    </NodeViewWrapper>
  );
}

function BookmarkView({ node, selected }: NodeViewProps) {
  let host = "";
  try { host = new URL(node.attrs.url).host; } catch {}
  return (
    <NodeViewWrapper data-drag-handle="" contentEditable={false} className={`my-1 ${selected ? "rounded-md ring-2 ring-blue-500/40" : ""}`}>
      <a href={node.attrs.url} target="_blank" rel="noopener noreferrer nofollow" className="flex items-center gap-3 rounded-md border px-3 py-2.5 !no-underline hover:bg-accent/50">
        <BookmarkIcon className="size-4 flex-none text-muted-foreground" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{node.attrs.title || host || node.attrs.url}</span>
          <span className="block truncate text-xs text-muted-foreground">{node.attrs.url}</span>
        </span>
        <ExternalLink className="size-4 flex-none text-muted-foreground" />
      </a>
    </NodeViewWrapper>
  );
}

function PageRefView({ node, selected }: NodeViewProps) {
  const { workspace } = useWorkspace();
  const tree = useTree(workspace.id);
  const live = tree.data?.find((n) => n.id === node.attrs.pageId);
  return (
    <NodeViewWrapper data-drag-handle="" contentEditable={false} className={selected ? "rounded-md ring-2 ring-blue-500/40" : ""}>
      <Link href={`/p/${node.attrs.pageId}`} className="my-0.5 flex items-center gap-2 rounded-md px-1 py-1 !no-underline hover:bg-accent">
        <span className="flex w-5 justify-center">{live?.icon ?? <FileText className="size-4 opacity-70" />}</span>
        <span className="truncate font-medium underline decoration-foreground/20 underline-offset-4">{live?.title || node.attrs.title || "Untitled"}</span>
      </Link>
    </NodeViewWrapper>
  );
}

function DbEmbedView({ node, selected }: NodeViewProps) {
  return (
    <NodeViewWrapper data-drag-handle="" contentEditable={false} className={`my-3 ${selected ? "rounded-md ring-2 ring-blue-500/40" : ""}`}>
      <DatabaseView pageId={node.attrs.pageId} embedded />
    </NodeViewWrapper>
  );
}

const LANGUAGES = ["plaintext", "bash", "css", "go", "html", "java", "javascript", "json", "markdown", "python", "rust", "sql", "typescript", "xml", "yaml"];

function CodeBlockView({ node, updateAttributes, editor }: NodeViewProps) {
  return (
    <NodeViewWrapper className="relative">
      <pre>
        {editor.isEditable && (
          <select
            contentEditable={false}
            value={node.attrs.language ?? "plaintext"}
            onChange={(e) => updateAttributes({ language: e.target.value === "plaintext" ? null : e.target.value })}
            className="absolute right-2 top-2 rounded border bg-background px-1 py-0.5 font-sans text-xs text-muted-foreground"
            aria-label="Code language"
          >
            {LANGUAGES.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        )}
        <NodeViewContent<"code"> as="code" />
      </pre>
    </NodeViewWrapper>
  );
}

export const nodeViewOverrides = {
  callout: Callout.extend({ addNodeView: () => ReactNodeViewRenderer(CalloutView) }),
  fileAttachment: FileAttachment.extend({ addNodeView: () => ReactNodeViewRenderer(FileView) }),
  bookmark: Bookmark.extend({ addNodeView: () => ReactNodeViewRenderer(BookmarkView) }),
  pageRef: PageRef.extend({ addNodeView: () => ReactNodeViewRenderer(PageRefView) }),
  dbEmbed: DatabaseEmbed.extend({ addNodeView: () => ReactNodeViewRenderer(DbEmbedView) }),
};

export const codeBlockExtension = CodeBlockLowlight.extend({
  addNodeView: () => ReactNodeViewRenderer(CodeBlockView),
}).configure({ lowlight });
