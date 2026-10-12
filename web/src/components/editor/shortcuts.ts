// Notion-style keyboard shortcuts for the page editor (client only).
// Tiptap's defaults already cover marks (Ctrl+B/I/U/E, Ctrl+Shift+S/H), headings
// (Ctrl+Alt+0–3), lists (Ctrl+Shift+7/8/9), quote (Ctrl+Shift+B), code block (Ctrl+Alt+C),
// undo/redo and Markdown shortcuts while typing. This adds the rest of Notion's set.
import { Extension, type Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Selection, TextSelection } from "@tiptap/pm/state";

export const OPEN_COMMENTS_EVENT = "tw:open-comments";

export type ShortcutActions = {
  setLink: (editor: Editor) => void;
  addSubpage: (editor: Editor) => void;
};

/** The top-level block around the cursor: its index in the doc and its start position. */
function currentBlock(editor: Editor) {
  const { $from } = editor.state.selection;
  if ($from.depth < 1) return null;
  const index = $from.index(0);
  return { index, start: $from.before(1), node: editor.state.doc.child(index) };
}

function moveBlock(editor: Editor, dir: -1 | 1) {
  const block = currentBlock(editor);
  if (!block) return false;
  const { doc } = editor.state;
  const neighbourIndex = block.index + dir;
  if (neighbourIndex < 0 || neighbourIndex >= doc.childCount) return true; // already at the edge
  const neighbour = doc.child(neighbourIndex);
  const { from, to } = editor.state.selection;
  const shift = dir === -1 ? -neighbour.nodeSize : neighbour.nodeSize;
  const tr = editor.state.tr.delete(block.start, block.start + block.node.nodeSize);
  tr.insert(dir === -1 ? block.start - neighbour.nodeSize : block.start + neighbour.nodeSize, block.node);
  try {
    tr.setSelection(TextSelection.create(tr.doc, from + shift, to + shift));
  } catch {
    tr.setSelection(Selection.near(tr.doc.resolve(Math.min(from + shift, tr.doc.content.size))));
  }
  editor.view.dispatch(tr.scrollIntoView());
  return true;
}

function duplicateBlock(editor: Editor) {
  const block = currentBlock(editor);
  if (!block) return false;
  const end = block.start + block.node.nodeSize;
  // UniqueID gives the copy (and its children) fresh block ids.
  const copy: PMNode = block.node.type.create({ ...block.node.attrs, id: null }, block.node.content, block.node.marks);
  const tr = editor.state.tr.insert(end, copy);
  tr.setSelection(Selection.near(tr.doc.resolve(end + 1)));
  editor.view.dispatch(tr.scrollIntoView());
  return true;
}

function toggleTodo(editor: Editor) {
  const { $from } = editor.state.selection;
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if (node.type.name === "taskItem") {
      editor.view.dispatch(editor.state.tr.setNodeMarkup($from.before(d), undefined, { ...node.attrs, checked: !node.attrs.checked }));
      return true;
    }
  }
  return false;
}

export const NotionShortcuts = Extension.create<{ getActions: () => ShortcutActions }>({
  name: "notionShortcuts",
  addOptions() {
    return { getActions: () => ({ setLink: () => {}, addSubpage: () => {} }) };
  },
  addKeyboardShortcuts() {
    const actions = () => this.options.getActions();
    return {
      // Link the selection. With nothing selected, fall through to the global search.
      "Mod-k": ({ editor }) => {
        if (editor.state.selection.empty && !editor.isActive("link")) return false;
        actions().setLink(editor);
        return true;
      },
      "Mod-d": ({ editor }) => duplicateBlock(editor),
      "Mod-Shift-ArrowUp": ({ editor }) => moveBlock(editor, -1),
      "Mod-Shift-ArrowDown": ({ editor }) => moveBlock(editor, 1),
      "Mod-Enter": ({ editor }) => toggleTodo(editor),
      // Turn into: Ctrl+Alt+0–3 (text, headings) are Tiptap defaults; 4–9 follow Notion.
      "Mod-Alt-4": ({ editor }) => editor.chain().focus().toggleTaskList().run(),
      "Mod-Alt-5": ({ editor }) => editor.chain().focus().toggleBulletList().run(),
      "Mod-Alt-6": ({ editor }) => editor.chain().focus().toggleOrderedList().run(),
      "Mod-Alt-7": ({ editor }) => editor.chain().focus().setDetails().run(),
      "Mod-Alt-8": ({ editor }) => editor.chain().focus().toggleCodeBlock().run(),
      "Mod-Alt-9": ({ editor }) => {
        actions().addSubpage(editor);
        return true;
      },
      "Mod-Alt-m": () => {
        window.dispatchEvent(new CustomEvent(OPEN_COMMENTS_EVENT));
        return true;
      },
      "Mod-Shift-m": () => {
        window.dispatchEvent(new CustomEvent(OPEN_COMMENTS_EVENT));
        return true;
      },
    };
  },
});
