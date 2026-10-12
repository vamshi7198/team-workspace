"use client";

import { DragHandle } from "@tiptap/extension-drag-handle-react";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { Editor } from "@tiptap/react";
import { Copy, GripVertical, Plus, Trash2, Type, Heading1, Heading2, Heading3, List, ListOrdered, CheckSquare, Quote, Code, MessageSquareWarning } from "lucide-react";
import { useRef, useState } from "react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

/** Notion-style block handle: "+" inserts a block below, the grip drags or opens block actions. */
export function BlockHandle({ editor }: { editor: Editor }) {
  const target = useRef<{ node: PMNode | null; pos: number }>({ node: null, pos: -1 });
  const [menuOpen, setMenuOpen] = useState(false);

  const withBlock = (fn: (node: PMNode, pos: number) => void) => {
    const { node, pos } = target.current;
    if (node && pos >= 0) fn(node, pos);
  };

  const turnInto = (apply: (e: Editor) => void) =>
    withBlock((node, pos) => {
      editor.chain().focus().setTextSelection(pos + 1).run();
      apply(editor);
    });

  return (
    <DragHandle
      editor={editor}
      onNodeChange={({ node, pos }) => {
        if (!menuOpen) target.current = { node, pos };
      }}
    >
      <div className="flex items-center gap-0.5 pr-1">
        <button
          type="button"
          aria-label="Add block below"
          className="drag-handle cursor-pointer"
          onClick={() =>
            withBlock((node, pos) => {
              const after = pos + node.nodeSize;
              editor.chain().insertContentAt(after, { type: "paragraph", content: [{ type: "text", text: "/" }] }).focus(after + 2).run();
            })
          }
        >
          <Plus className="size-4" />
        </button>
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <button type="button" aria-label="Drag to move, click for block actions" className="drag-handle" data-drag-handle="">
              <GripVertical className="size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="left" align="start" className="w-52">
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Turn into</DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => turnInto((e) => e.chain().focus().setParagraph().run())}><Type className="size-4" /> Text</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => turnInto((e) => e.chain().focus().setHeading({ level: 1 }).run())}><Heading1 className="size-4" /> Heading 1</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => turnInto((e) => e.chain().focus().setHeading({ level: 2 }).run())}><Heading2 className="size-4" /> Heading 2</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => turnInto((e) => e.chain().focus().setHeading({ level: 3 }).run())}><Heading3 className="size-4" /> Heading 3</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => turnInto((e) => e.chain().focus().toggleBulletList().run())}><List className="size-4" /> Bulleted list</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => turnInto((e) => e.chain().focus().toggleOrderedList().run())}><ListOrdered className="size-4" /> Numbered list</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => turnInto((e) => e.chain().focus().toggleTaskList().run())}><CheckSquare className="size-4" /> To-do list</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => turnInto((e) => e.chain().focus().toggleBlockquote().run())}><Quote className="size-4" /> Quote</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => turnInto((e) => e.chain().focus().toggleCodeBlock().run())}><Code className="size-4" /> Code</DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() =>
                withBlock((node, pos) => {
                  if (!node.isTextblock) return;
                  editor.chain().focus().insertContentAt({ from: pos, to: pos + node.nodeSize }, { type: "callout", attrs: { icon: "💡", color: "gray" }, content: node.content.toJSON() ?? undefined }).run();
                })
              }
            >
              <MessageSquareWarning className="size-4" /> Callout
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() =>
                withBlock((node, pos) => {
                  const json = node.toJSON();
                  editor.chain().focus().insertContentAt(pos + node.nodeSize, json).run();
                })
              }
            >
              <Copy className="size-4" /> Duplicate
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onSelect={() => withBlock((node, pos) => editor.chain().focus().deleteRange({ from: pos, to: pos + node.nodeSize }).run())}>
              <Trash2 className="size-4" /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </DragHandle>
  );
}
