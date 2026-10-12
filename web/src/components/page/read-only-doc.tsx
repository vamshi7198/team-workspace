"use client";

import { EditorContent, useEditor } from "@tiptap/react";
import { documentExtensions } from "@/lib/editor/schema";
import { codeBlockExtension, nodeViewOverrides } from "@/components/editor/node-views";

/** Read-only rendering of a stored document (version previews). */
export function ReadOnlyDoc({ doc }: { doc: unknown }) {
  const editor = useEditor(
    {
      immediatelyRender: false,
      editable: false,
      content: doc as object,
      extensions: documentExtensions({ codeBlock: codeBlockExtension, overrides: nodeViewOverrides }),
    },
    [doc],
  );
  return (
    <div className="doc">
      <EditorContent editor={editor} />
    </div>
  );
}
