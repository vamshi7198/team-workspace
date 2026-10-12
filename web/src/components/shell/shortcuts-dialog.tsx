"use client";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

const GROUPS: { title: string; items: [string, string][] }[] = [
  {
    title: "Anywhere",
    items: [
      ["Ctrl+K or Ctrl+P", "Search"],
      ["Ctrl+Alt+N", "New page"],
      ["Ctrl+[ / Ctrl+]", "Back / forward"],
      ["Ctrl+\\", "Show or hide the sidebar"],
      ["Ctrl+Shift+L", "Dark / light mode"],
      ["Ctrl+/", "This list"],
    ],
  },
  {
    title: "Text",
    items: [
      ["Ctrl+B / I / U", "Bold / italic / underline"],
      ["Ctrl+Shift+S", "Strikethrough"],
      ["Ctrl+E", "Inline code"],
      ["Ctrl+K (with text selected)", "Add or edit a link"],
      ["Ctrl+Shift+H", "Highlight"],
      ["Ctrl+Z / Ctrl+Shift+Z", "Undo / redo"],
    ],
  },
  {
    title: "Blocks",
    items: [
      ["/", "Insert any block"],
      ["@", "Mention a page or person"],
      ["Ctrl+Alt+0", "Turn into text"],
      ["Ctrl+Alt+1 / 2 / 3", "Turn into heading 1 / 2 / 3"],
      ["Ctrl+Alt+4 / 5 / 6", "Turn into to-do / bulleted / numbered list"],
      ["Ctrl+Alt+7 / 8", "Turn into toggle / code block"],
      ["Ctrl+Alt+9", "New sub-page"],
      ["Ctrl+Shift+B", "Quote"],
      ["Ctrl+D", "Duplicate block"],
      ["Ctrl+Shift+↑ / ↓", "Move block up / down"],
      ["Ctrl+Enter", "Tick or untick a to-do"],
      ["Tab / Shift+Tab", "Indent / outdent list item"],
      ["Ctrl+Alt+M or Ctrl+Shift+M", "Open comments"],
    ],
  },
  {
    title: "Markdown while typing",
    items: [
      ["# , ## , ###", "Headings"],
      ["- or *", "Bulleted list"],
      ["1.", "Numbered list"],
      ["[]", "To-do"],
      ["> ", "Quote"],
      ["```", "Code block"],
      ["---", "Divider"],
      ["**text** / _text_ / `text`", "Bold / italic / code"],
    ],
  },
];

export function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogTitle>Keyboard shortcuts</DialogTitle>
        <p className="-mt-2 text-xs text-muted-foreground">On a Mac, use ⌘ for Ctrl and ⌥ for Alt.</p>
        <div className="grid gap-6 sm:grid-cols-2">
          {GROUPS.map((g) => (
            <section key={g.title}>
              <h3 className="mb-2 text-sm font-semibold">{g.title}</h3>
              <dl className="space-y-1 text-sm">
                {g.items.map(([keys, what]) => (
                  <div key={keys} className="flex items-baseline justify-between gap-3">
                    <dt className="text-muted-foreground">{what}</dt>
                    <dd><kbd className="whitespace-nowrap rounded border bg-muted px-1.5 py-0.5 font-mono text-xs">{keys}</kbd></dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
