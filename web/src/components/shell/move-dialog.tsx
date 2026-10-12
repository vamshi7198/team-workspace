"use client";

import { FileText, Lock, Users } from "lucide-react";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useWorkspace } from "@/components/workspace-context";
import { useTeamspaces, useTree, type TreeNode } from "@/lib/queries";

export type MoveTarget = { parentId?: string | null; section?: { type: string; teamspaceId?: string } };

/** Pick where to move a page: a section root or another page (never itself or a descendant). */
export function MoveDialog({ pageId, open, onOpenChange, onPick }: { pageId: string; open: boolean; onOpenChange: (o: boolean) => void; onPick: (t: MoveTarget, label: string) => void }) {
  const { workspace } = useWorkspace();
  const tree = useTree(workspace.id);
  const teamspaces = useTeamspaces(workspace.id);

  const excluded = new Set<string>([pageId]);
  const nodes = tree.data ?? [];
  let grew = true;
  while (grew) {
    grew = false;
    for (const n of nodes) if (n.parentId && excluded.has(n.parentId) && !excluded.has(n.id)) { excluded.add(n.id); grew = true; }
  }
  const candidates = nodes.filter((n: TreeNode) => n.kind === "page" && n.access >= 3 && !excluded.has(n.id));

  const pick = (t: MoveTarget, label: string) => {
    onPick(t, label);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0 sm:max-w-lg">
        <DialogTitle className="sr-only">Move page</DialogTitle>
        <Command>
          <CommandInput placeholder="Move page to…" />
          <CommandList className="max-h-96">
            <CommandEmpty>No matching pages.</CommandEmpty>
            <CommandGroup heading="Sections">
              <CommandItem onSelect={() => pick({ section: { type: "workspace" } }, "Workspace")}><Users className="size-4" /> Workspace (everyone)</CommandItem>
              <CommandItem onSelect={() => pick({ section: { type: "private" } }, "Private")}><Lock className="size-4" /> Private (only you)</CommandItem>
              {(teamspaces.data ?? []).filter((t) => t.is_member).map((t) => (
                <CommandItem key={t.id} onSelect={() => pick({ section: { type: "teamspace", teamspaceId: t.id } }, t.name)}>
                  <span className="w-4 text-center">{t.icon ?? "👥"}</span> {t.name}
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandGroup heading="Pages">
              {candidates.map((n) => (
                <CommandItem key={n.id} value={`${n.title} ${n.id}`} onSelect={() => pick({ parentId: n.id }, n.title || "Untitled")}>
                  <span className="w-4 text-center">{n.icon ?? <FileText className="size-4" />}</span>
                  <span className="truncate">{n.title || "Untitled"}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
