"use client";

import { Placeholder } from "@tiptap/extensions";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import type { EditorView } from "@tiptap/pm/view";
import { useRouter } from "next/navigation";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { toast } from "sonner";
import { useDialogs } from "@/components/dialogs";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useWorkspace } from "@/components/workspace-context";
import { api, uploadFile } from "@/lib/api";
import { WorkspaceMention } from "@/lib/editor/nodes";
import { documentExtensions } from "@/lib/editor/schema";
import { toastError, useInvalidateStructure } from "@/lib/queries";
import { BlockHandle } from "./block-handle";
import { codeBlockExtension, nodeViewOverrides } from "./node-views";
import { SlashCommand, type EditorActions } from "./slash-command";
import { suggestionRenderer, type MenuItem } from "./suggestion-popup";
import { FormattingToolbar } from "./toolbar";
import { useAutosave } from "./use-autosave";
import { ConflictDialog, SaveIndicator } from "./save-ui";

export type DocEditorHandle = { flush: () => Promise<void>; reload: () => Promise<void> };

type MentionItem = MenuItem & { kind: "page" | "user" };

function pickFiles(accept: string): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.multiple = true;
    input.onchange = () => resolve(Array.from(input.files ?? []));
    input.click();
  });
}

export const DocEditor = forwardRef<DocEditorHandle, {
  pageId: string;
  doc: unknown;
  version: number;
  editable: boolean;
  placeholder?: string;
  onStatusChange?: (s: ReturnType<typeof useAutosave>) => void;
}>(function DocEditor({ pageId, doc, version, editable, placeholder }, ref) {
  const { workspace } = useWorkspace();
  const router = useRouter();
  const { prompt } = useDialogs();
  const invalidate = useInvalidateStructure();
  const [linkDbOpen, setLinkDbOpen] = useState(false);
  const [databases, setDatabases] = useState<{ id: string; page_id: string; title: string; icon: string | null }[]>([]);
  const editorRef = useRef<Editor | null>(null);
  const autosaveRef = useRef<ReturnType<typeof useAutosave> | null>(null);

  const uploadInto = async (editor: Editor, files: File[], at?: number) => {
    for (const file of files) {
      const t = toast.loading(`Uploading ${file.name}…`);
      try {
        const f = await uploadFile(pageId, file);
        const node = f.mimeType.startsWith("image/")
          ? { type: "image", attrs: { src: f.url, alt: f.name } }
          : { type: "fileAttachment", attrs: { fileId: f.id, name: f.name, size: f.size, mimeType: f.mimeType } };
        const chain = editor.chain().focus();
        (at !== undefined ? chain.insertContentAt(at, node) : chain.insertContent(node)).run();
        toast.success(`Uploaded ${file.name}`, { id: t });
      } catch (e) {
        toast.dismiss(t);
        toastError(e);
      }
    }
  };

  const actions: EditorActions = {
    pickImage: async (editor) => uploadInto(editor, await pickFiles("image/png,image/jpeg,image/gif,image/webp")),
    pickFile: async (editor) => uploadInto(editor, await pickFiles("*/*")),
    addBookmark: async (editor) => {
      const url = await prompt({ title: "Add a bookmark", placeholder: "https://example.com", confirmLabel: "Add" });
      if (!url?.trim()) return;
      const href = /^https?:\/\//i.test(url.trim()) ? url.trim() : `https://${url.trim()}`;
      let host = href;
      try { host = new URL(href).host; } catch { return toast.error("That doesn't look like a web address"); }
      editor.chain().focus().insertContent({ type: "bookmark", attrs: { url: href, title: host } }).run();
    },
    addSubpage: async (editor) => {
      try {
        const r = await api.post<{ id: string }>("/pages", { workspaceId: workspace.id, parentId: pageId });
        editor.chain().focus().insertContent({ type: "pageRef", attrs: { pageId: r.id, title: "Untitled" } }).run();
        await autosaveRef.current?.flush();
        invalidate();
        router.push(`/p/${r.id}`);
      } catch (e) { toastError(e); }
    },
    addDatabase: async (editor) => {
      try {
        const r = await api.post<{ id: string; pageId: string }>("/databases", { workspaceId: workspace.id, parentId: pageId, title: "Untitled database" });
        editor.chain().focus().insertContent({ type: "dbEmbed", attrs: { pageId: r.pageId, title: "Untitled database" } }).run();
        invalidate();
      } catch (e) { toastError(e); }
    },
    linkDatabase: async () => {
      try {
        setDatabases(await api.get(`/workspaces/${workspace.id}/databases`));
        setLinkDbOpen(true);
      } catch (e) { toastError(e); }
    },
  };
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  const editor = useEditor({
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    editable,
    content: doc as object,
    extensions: documentExtensions({
      codeBlock: codeBlockExtension,
      overrides: {
        ...nodeViewOverrides,
        mention: WorkspaceMention.configure({
          HTMLAttributes: { class: "mention" },
          renderHTML: ({ options, node }) => [
            "span",
            { ...options.HTMLAttributes, "data-type": "mention", "data-id": node.attrs.id, "data-kind": node.attrs.kind, "data-label": node.attrs.label },
            node.attrs.kind === "user" ? `@${node.attrs.label}` : `${node.attrs.label}`,
          ],
          suggestion: {
            char: "@",
            items: async ({ query }) => {
              try {
                const r = await api.get<{ pages: { id: string; title: string; icon: string | null }[]; people: { id: string; name: string; email: string }[] }>(`/workspaces/${workspace.id}/suggest?q=${encodeURIComponent(query)}`);
                return [
                  ...r.people.map((p) => ({ id: p.id, title: p.name, subtitle: p.email, icon: "👤", group: "People", kind: "user" as const })),
                  ...r.pages.map((p) => ({ id: p.id, title: p.title || "Untitled", icon: p.icon ?? "📄", group: "Pages", kind: "page" as const })),
                ] satisfies MentionItem[];
              } catch {
                return [];
              }
            },
            command: ({ editor: e, range, props }) => {
              const item = props as unknown as MentionItem;
              e.chain().focus().insertContentAt(range, [{ type: "mention", attrs: { id: item.id, label: item.title, kind: item.kind } }, { type: "text", text: " " }]).run();
            },
            render: suggestionRenderer<MentionItem>("No matching pages or people"),
          },
        }),
      },
      extra: [
        Placeholder.configure({
          placeholder: ({ node }) => (node.type.name === "heading" ? `Heading ${node.attrs.level}` : placeholder ?? "Type '/' for commands, '@' to mention"),
          showOnlyCurrent: true,
        }),
        SlashCommand.configure({ getActions: () => actionsRef.current }),
      ],
    }),
    editorProps: {
      attributes: { class: "focus:outline-none", "aria-label": "Page content" },
      handlePaste: (view: EditorView, event: ClipboardEvent) => {
        const files = Array.from(event.clipboardData?.files ?? []);
        if (!files.length || !editorRef.current?.isEditable) return false;
        event.preventDefault();
        void uploadInto(editorRef.current, files);
        return true;
      },
      handleDrop: (view: EditorView, event: DragEvent, _slice, moved) => {
        const files = Array.from(event.dataTransfer?.files ?? []);
        if (moved || !files.length || !editorRef.current?.isEditable) return false;
        event.preventDefault();
        const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
        void uploadInto(editorRef.current, files, pos);
        return true;
      },
      handleClick: (_view, _pos, event) => {
        const el = event.target as HTMLElement;
        const mention = el.closest<HTMLElement>("span.mention[data-kind='page']");
        if (mention?.dataset.id) {
          router.push(`/p/${mention.dataset.id}`);
          return true;
        }
        const a = el.closest("a");
        const href = a?.getAttribute("href");
        if (href && (event.metaKey || event.ctrlKey || !editorRef.current?.isEditable || href.startsWith("/p/"))) {
          if (href.startsWith("/")) router.push(href);
          else window.open(href, "_blank", "noopener,noreferrer");
          return true;
        }
        return false;
      },
    },
    onCreate: ({ editor: e }) => { editorRef.current = e; },
    onUpdate: ({ transaction }) => {
      if (transaction.docChanged && !transaction.getMeta("remote")) autosaveRef.current?.markDirty();
    },
  }, [pageId]);

  const applyDoc = (next: unknown) => {
    const e = editorRef.current;
    if (!e) return;
    const { from, to } = e.state.selection;
    e.commands.setContent(next as object, { emitUpdate: false });
    try { e.commands.setTextSelection({ from: Math.min(from, e.state.doc.content.size), to: Math.min(to, e.state.doc.content.size) }); } catch {}
  };

  const autosave = useAutosave({
    pageId,
    initialVersion: version,
    enabled: editable,
    getDoc: () => editorRef.current?.getJSON() ?? doc,
    applyDoc,
    onRemoteUpdate: (by) => toast.info(`Updated with ${by ? `${by}'s` : "the latest"} changes`),
  });
  autosaveRef.current = autosave;

  useEffect(() => {
    editor?.setEditable(editable);
  }, [editor, editable]);

  useImperativeHandle(ref, () => ({ flush: autosave.flush, reload: autosave.reload }), [autosave.flush, autosave.reload]);

  // Presence: tell others this page is open, and whether we are editing.
  const [others, setOthers] = useState<{ id: string; name: string; editing: boolean }[]>([]);
  useEffect(() => {
    let alive = true;
    const beat = async () => {
      try {
        const r = await api.post<{ others: typeof others }>(`/pages/${pageId}/presence`, { editing: autosaveRef.current?.status !== "saved" });
        if (alive) setOthers(r.others);
      } catch {}
    };
    void beat();
    const t = setInterval(beat, 20_000);
    return () => {
      alive = false;
      clearInterval(t);
      void fetch(`/api/pages/${pageId}/presence`, { method: "POST", keepalive: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ leaving: true }) });
    };
  }, [pageId]);

  return (
    <div className="doc relative">
      <div className="pointer-events-none sticky top-2 z-10 -mb-6 flex justify-end">
        <div className="pointer-events-auto">
          <SaveIndicator status={autosave.status} lastSavedAt={autosave.lastSavedAt} others={others} editable={editable} />
        </div>
      </div>

      {autosave.draft && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
          <span className="flex-1">Unsaved changes from {new Date(autosave.draft.at).toLocaleString()} were found on this device.</span>
          <button className="font-medium underline" onClick={autosave.restoreDraft}>Restore them</button>
          <button className="text-muted-foreground underline" onClick={autosave.discardDraft}>Discard</button>
        </div>
      )}
      {autosave.remoteChanged && autosave.status !== "conflict" && (
        <div className="mb-3 rounded-md border border-blue-500/40 bg-blue-500/10 px-3 py-2 text-sm">
          {autosave.remoteChanged} also edited this page. When you next save, you&apos;ll be asked which version to keep. Nothing will be lost.
        </div>
      )}

      {editor && editable && <FormattingToolbar editor={editor} />}
      {editor && editable && <BlockHandle editor={editor} />}
      <EditorContent editor={editor} />

      <ConflictDialog conflict={autosave.conflict} onKeepMine={autosave.keepMine} onTakeTheirs={autosave.takeTheirs} getMine={() => editorRef.current?.getJSON()} />

      <Dialog open={linkDbOpen} onOpenChange={setLinkDbOpen}>
        <DialogContent className="overflow-hidden p-0 sm:max-w-md">
          <DialogTitle className="sr-only">Link a database</DialogTitle>
          <Command>
            <CommandInput placeholder="Choose a database to show here…" />
            <CommandList>
              <CommandEmpty>No databases found.</CommandEmpty>
              <CommandGroup>
                {databases.map((d) => (
                  <CommandItem
                    key={d.id}
                    value={`${d.title} ${d.id}`}
                    onSelect={() => {
                      editorRef.current?.chain().focus().insertContent({ type: "dbEmbed", attrs: { pageId: d.page_id, title: d.title } }).run();
                      setLinkDbOpen(false);
                    }}
                  >
                    <span className="w-5 text-center">{d.icon ?? "🗃️"}</span> {d.title || "Untitled"}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </DialogContent>
      </Dialog>
    </div>
  );
});
