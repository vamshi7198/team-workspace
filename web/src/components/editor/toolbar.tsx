"use client";

import type { Editor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { Bold, Code, Highlighter, Italic, Link2, Strikethrough, Underline, Baseline, Trash2, Rows3, Columns3 } from "lucide-react";
import { useDialogs } from "@/components/dialogs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const TEXT_COLORS: [string, string | null][] = [["Default", null], ["Gray", "#787774"], ["Brown", "#9f6b53"], ["Orange", "#d9730d"], ["Yellow", "#cb912f"], ["Green", "#448361"], ["Blue", "#337ea9"], ["Purple", "#9065b0"], ["Pink", "#c14c8a"], ["Red", "#d44c47"]];
const HIGHLIGHTS: [string, string | null][] = [["None", null], ["Gray", "#e3e2e080"], ["Brown", "#eee0da"], ["Orange", "#fadec9"], ["Yellow", "#fbf3db"], ["Green", "#ddedea"], ["Blue", "#ddebf1"], ["Purple", "#eae4f2"], ["Pink", "#f4dfeb"], ["Red", "#fbe4e4"]];

function Btn({ active, onClick, label, children }: { active?: boolean; onClick: () => void; label: string; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} onMouseDown={(e) => e.preventDefault()} onClick={onClick} className={cn("flex size-7 items-center justify-center rounded hover:bg-accent", active && "bg-accent text-blue-600 dark:text-blue-400")}>
      {children}
    </button>
  );
}

/** Inline formatting toolbar shown over a text selection. */
export function FormattingToolbar({ editor }: { editor: Editor }) {
  const { prompt } = useDialogs();

  const setLink = async () => {
    const prev = editor.getAttributes("link").href as string | undefined;
    const url = await prompt({ title: prev ? "Edit link" : "Add link", initial: prev ?? "https://", confirmLabel: "Apply" });
    if (url === null) return;
    const trimmed = url.trim();
    if (!trimmed || trimmed === "https://") editor.chain().focus().extendMarkRange("link").unsetLink().run();
    else editor.chain().focus().extendMarkRange("link").setLink({ href: /^(https?:|mailto:|\/)/i.test(trimmed) ? trimmed : `https://${trimmed}` }).run();
  };

  return (
    <BubbleMenu
      editor={editor}
      options={{ placement: "top", offset: 8 }}
      shouldShow={({ editor: e, state }) => {
        const { empty } = state.selection;
        if (empty || !e.isEditable) return false;
        if (e.isActive("codeBlock") || e.isActive("image") || e.isActive("pageRef") || e.isActive("dbEmbed") || e.isActive("fileAttachment") || e.isActive("bookmark")) return false;
        return true;
      }}
    >
      <div className="flex items-center gap-0.5 rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg">
        <Btn label="Bold (Ctrl+B)" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}><Bold className="size-4" /></Btn>
        <Btn label="Italic (Ctrl+I)" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}><Italic className="size-4" /></Btn>
        <Btn label="Underline (Ctrl+U)" active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()}><Underline className="size-4" /></Btn>
        <Btn label="Strikethrough" active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()}><Strikethrough className="size-4" /></Btn>
        <Btn label="Inline code (Ctrl+E)" active={editor.isActive("code")} onClick={() => editor.chain().focus().toggleCode().run()}><Code className="size-4" /></Btn>
        <Btn label="Link (Ctrl+K)" active={editor.isActive("link")} onClick={setLink}><Link2 className="size-4" /></Btn>
        <div className="mx-0.5 h-5 w-px bg-border" />
        <Popover>
          <PopoverTrigger asChild>
            <button type="button" aria-label="Text and highlight colour" title="Colour" onMouseDown={(e) => e.preventDefault()} className="flex h-7 items-center gap-1 rounded px-1.5 hover:bg-accent">
              <Baseline className="size-4" /><Highlighter className="size-3.5" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-56 p-2" onOpenAutoFocus={(e) => e.preventDefault()}>
            <p className="mb-1 text-xs text-muted-foreground">Text colour</p>
            <div className="mb-2 grid grid-cols-5 gap-1">
              {TEXT_COLORS.map(([name, c]) => (
                <button key={name} type="button" title={name} onClick={() => (c ? editor.chain().focus().setColor(c).run() : editor.chain().focus().unsetColor().run())} className="flex h-7 items-center justify-center rounded border text-sm font-semibold hover:bg-accent" style={{ color: c ?? undefined }}>A</button>
              ))}
            </div>
            <p className="mb-1 text-xs text-muted-foreground">Highlight</p>
            <div className="grid grid-cols-5 gap-1">
              {HIGHLIGHTS.map(([name, c]) => (
                <button key={name} type="button" title={name} onClick={() => (c ? editor.chain().focus().setHighlight({ color: c }).run() : editor.chain().focus().unsetHighlight().run())} className="h-7 rounded border hover:ring-1 hover:ring-ring" style={{ background: c ?? undefined }} />
              ))}
            </div>
          </PopoverContent>
        </Popover>
        {editor.isActive("table") && (
          <>
            <div className="mx-0.5 h-5 w-px bg-border" />
            <Btn label="Add row below" onClick={() => editor.chain().focus().addRowAfter().run()}><Rows3 className="size-4" /></Btn>
            <Btn label="Add column right" onClick={() => editor.chain().focus().addColumnAfter().run()}><Columns3 className="size-4" /></Btn>
            <Btn label="Delete row" onClick={() => editor.chain().focus().deleteRow().run()}><span className="text-xs">−R</span></Btn>
            <Btn label="Delete column" onClick={() => editor.chain().focus().deleteColumn().run()}><span className="text-xs">−C</span></Btn>
            <Btn label="Delete table" onClick={() => editor.chain().focus().deleteTable().run()}><Trash2 className="size-4" /></Btn>
          </>
        )}
      </div>
    </BubbleMenu>
  );
}
