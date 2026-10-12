"use client";

import { DndContext, DragOverlay, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent, type DragMoveEvent } from "@dnd-kit/core";
import { ChevronRight, Copy, Database, FileText, Link2, MoreHorizontal, MoveRight, Pencil, Plus, Star, Trash2, Archive } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useWorkspace } from "@/components/workspace-context";
import { cn } from "@/lib/utils";
import { useCreatePage, type TreeNode } from "@/lib/queries";
import { MoveDialog } from "./move-dialog";
import { usePageActions } from "./page-actions";

export type SectionKey = { type: "private" } | { type: "workspace" } | { type: "teamspace"; teamspaceId: string } | { type: "shared" };

type DropZone = "before" | "after" | "inside";
type DragState = { overId: string | null; zone: DropZone | null };

const TreeCtx = createContext<{
  children: Map<string, TreeNode[]>;
  expanded: Set<string>;
  toggle: (id: string, open?: boolean) => void;
  drag: DragState;
  favorites: Set<string>;
} | null>(null);

const EXPANDED_KEY = "tw:expanded";

function loadExpanded(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(EXPANDED_KEY) ?? "[]"));
  } catch {
    return new Set();
  }
}

/** Splits tree nodes into sidebar sections. */
export function classify(nodes: TreeNode[], meId: string) {
  const ids = new Set(nodes.map((n) => n.id));
  const children = new Map<string, TreeNode[]>();
  const sections = { private: [] as TreeNode[], workspace: [] as TreeNode[], shared: [] as TreeNode[], teamspaces: new Map<string, TreeNode[]>() };
  for (const n of nodes) {
    if (n.parentId && ids.has(n.parentId)) {
      const list = children.get(n.parentId) ?? [];
      list.push(n);
      children.set(n.parentId, list);
      continue;
    }
    if (n.parentId) sections.shared.push(n);
    else if (n.teamspaceId) {
      const list = sections.teamspaces.get(n.teamspaceId) ?? [];
      list.push(n);
      sections.teamspaces.set(n.teamspaceId, list);
    } else if (n.generalAccess === "none" && n.ownerId === meId) sections.private.push(n);
    else if (n.generalAccess === "none") sections.shared.push(n);
    else sections.workspace.push(n);
  }
  return { children, sections };
}

export function PageTreeProvider({ nodes, favorites, children: render }: { nodes: TreeNode[]; favorites: Set<string>; children: (ctx: { sections: ReturnType<typeof classify>["sections"] }) => React.ReactNode }) {
  const { me } = useWorkspace();
  const actions = usePageActions();
  const { children, sections } = useMemo(() => classify(nodes, me.id), [nodes, me.id]);
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [drag, setDrag] = useState<DragState>({ overId: null, zone: null });
  const [activeId, setActiveId] = useState<string | null>(null);
  const pathname = usePathname();

  // eslint-disable-next-line react-hooks/set-state-in-effect -- read browser storage after mount so server and client render the same HTML
  useEffect(() => setExpanded(loadExpanded()), []);
  // Expand ancestors of the open page.
  useEffect(() => {
    const id = pathname.match(/^\/p\/([0-9a-f-]{36})/)?.[1];
    if (!id) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reveal the open page in the tree after navigating
    setExpanded((prev) => {
      const next = new Set(prev);
      let cur = byId.get(id)?.parentId;
      let changed = false;
      while (cur) {
        if (!next.has(cur)) { next.add(cur); changed = true; }
        cur = byId.get(cur)?.parentId ?? null;
      }
      return changed ? next : prev;
    });
  }, [pathname, byId]);

  const toggle = (id: string, open?: boolean) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      const shouldOpen = open ?? !next.has(id);
      if (shouldOpen) next.add(id);
      else next.delete(id);
      try { localStorage.setItem(EXPANDED_KEY, JSON.stringify([...next])); } catch {}
      return next;
    });

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const siblingsOf = (n: TreeNode): TreeNode[] => {
    if (n.parentId && byId.has(n.parentId)) return children.get(n.parentId) ?? [];
    if (n.teamspaceId && !n.parentId) return sections.teamspaces.get(n.teamspaceId) ?? [];
    for (const list of [sections.private, sections.workspace, sections.shared]) if (list.some((x) => x.id === n.id)) return list;
    return [];
  };
  const sectionOf = (n: TreeNode): SectionKey | null => {
    if (n.teamspaceId) return { type: "teamspace", teamspaceId: n.teamspaceId };
    if (sections.private.some((x) => x.id === n.id)) return { type: "private" };
    if (sections.workspace.some((x) => x.id === n.id)) return { type: "workspace" };
    return null;
  };

  const onMove = (e: DragMoveEvent) => {
    const over = e.over;
    if (!over) return setDrag({ overId: null, zone: null });
    const overId = String(over.id);
    if (overId.startsWith("section:")) return setDrag({ overId, zone: "inside" });
    const pointerY = (e.activatorEvent as PointerEvent).clientY + e.delta.y;
    const r = over.rect;
    const rel = (pointerY - r.top) / r.height;
    const target = byId.get(overId);
    const zone: DropZone = rel < 0.28 ? "before" : rel > 0.72 ? "after" : target?.kind === "page" ? "inside" : rel < 0.5 ? "before" : "after";
    setDrag({ overId, zone });
  };

  const onEnd = async (e: DragEndEvent) => {
    const { overId, zone } = drag;
    setDrag({ overId: null, zone: null });
    setActiveId(null);
    const id = String(e.active.id);
    if (!overId || !zone || overId === id) return;
    if (overId.startsWith("section:")) {
      const [, type, teamspaceId] = overId.split(":");
      await actions.move(id, { section: type === "teamspace" ? { type, teamspaceId } : { type } });
      return;
    }
    const target = byId.get(overId);
    if (!target) return;
    // Never drop a page inside its own subtree.
    let cur: string | null = target.id;
    while (cur) {
      if (cur === id) return;
      cur = byId.get(cur)?.parentId ?? null;
    }
    if (zone === "inside") {
      await actions.move(id, { parentId: target.id });
      toggle(target.id, true);
      return;
    }
    const sibs = siblingsOf(target).filter((s) => s.id !== id);
    const idx = sibs.findIndex((s) => s.id === target.id);
    const afterId = zone === "after" ? target.id : sibs[idx - 1]?.id ?? null;
    const beforeId = zone === "before" ? target.id : sibs[idx + 1]?.id ?? null;
    const parentVisible = target.parentId && byId.has(target.parentId);
    if (parentVisible) await actions.move(id, { parentId: target.parentId, afterId, beforeId });
    else {
      const section = sectionOf(target);
      if (section) await actions.move(id, { section, afterId, beforeId });
    }
  };

  const active = activeId ? byId.get(activeId) : null;
  return (
    <TreeCtx.Provider value={{ children, expanded, toggle, drag, favorites }}>
      <DndContext sensors={sensors} onDragStart={(e) => setActiveId(String(e.active.id))} onDragMove={onMove} onDragEnd={onEnd} onDragCancel={() => { setDrag({ overId: null, zone: null }); setActiveId(null); }}>
        {render({ sections })}
        <DragOverlay dropAnimation={null}>
          {active && (
            <div className="flex items-center gap-1.5 rounded-md bg-background px-2 py-1 text-sm shadow-lg ring-1 ring-border">
              <span>{active.icon ?? "📄"}</span>
              {active.title || "Untitled"}
            </div>
          )}
        </DragOverlay>
      </DndContext>
    </TreeCtx.Provider>
  );
}

export function SectionDropZone({ id, children }: { id: string; children: React.ReactNode }) {
  const { setNodeRef } = useDroppable({ id });
  const ctx = useContext(TreeCtx)!;
  return (
    <div ref={setNodeRef} className={cn("rounded-md", ctx.drag.overId === id && "bg-blue-500/10 ring-1 ring-blue-500/40")}>
      {children}
    </div>
  );
}

export function TreeList({ nodes, depth = 0, section }: { nodes: TreeNode[]; depth?: number; section?: SectionKey }) {
  return (
    <ul role={depth === 0 ? "tree" : "group"}>
      {nodes.map((n) => (
        <TreeItem key={n.id} node={n} depth={depth} section={section} />
      ))}
    </ul>
  );
}

function TreeItem({ node, depth, section }: { node: TreeNode; depth: number; section?: SectionKey }) {
  const ctx = useContext(TreeCtx)!;
  const { workspace } = useWorkspace();
  const pathname = usePathname();
  const router = useRouter();
  const actions = usePageActions();
  const createPage = useCreatePage();
  const [moveOpen, setMoveOpen] = useState(false);
  const kids = ctx.children.get(node.id) ?? [];
  const open = ctx.expanded.has(node.id);
  const activePage = pathname === `/p/${node.id}`;
  const { attributes, listeners, setNodeRef: dragRef, isDragging } = useDraggable({ id: node.id, disabled: node.access < 3 });
  const { setNodeRef: dropRef } = useDroppable({ id: node.id });
  const isOver = ctx.drag.overId === node.id;
  const canEdit = node.access >= 3;

  const addChild = async () => {
    const r = await createPage.mutateAsync({ workspaceId: workspace.id, parentId: node.id });
    ctx.toggle(node.id, true);
    router.push(`/p/${r.id}`);
  };

  return (
    <li role="treeitem" aria-expanded={kids.length ? open : undefined} aria-selected={activePage}>
      <div
        ref={(el) => { dragRef(el); dropRef(el); }}
        {...attributes}
        {...listeners}
        className={cn(
          "group relative flex h-7 items-center gap-1 rounded-md pr-1 text-sm text-sidebar-foreground/80 hover:bg-sidebar-accent",
          activePage && "bg-sidebar-accent font-medium text-sidebar-foreground",
          isDragging && "opacity-40",
          isOver && ctx.drag.zone === "inside" && "bg-blue-500/15 ring-1 ring-blue-500/50",
        )}
        style={{ paddingLeft: 4 + depth * 14 }}
      >
        {isOver && ctx.drag.zone === "before" && <span className="pointer-events-none absolute inset-x-1 -top-px h-0.5 rounded bg-blue-500" />}
        {isOver && ctx.drag.zone === "after" && <span className="pointer-events-none absolute inset-x-1 -bottom-px h-0.5 rounded bg-blue-500" />}
        <button
          type="button"
          aria-label={open ? "Collapse" : "Expand"}
          onClick={() => ctx.toggle(node.id)}
          className={cn("flex size-5 flex-none items-center justify-center rounded hover:bg-foreground/10", !kids.length && node.kind !== "page" && "invisible")}
        >
          <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90", !kids.length && "opacity-40")} />
        </button>
        <Link href={`/p/${node.id}`} className="flex min-w-0 flex-1 items-center gap-1.5 py-1" draggable={false}>
          <span className="flex w-5 flex-none justify-center text-[15px] leading-none">
            {node.icon ?? (node.kind === "database" ? <Database className="size-4 opacity-70" /> : <FileText className="size-4 opacity-70" />)}
          </span>
          <span className="truncate">{node.title || "Untitled"}</span>
        </Link>
        <div className="flex flex-none items-center opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 max-md:opacity-100">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" aria-label="Page actions" className="flex size-6 items-center justify-center rounded hover:bg-foreground/10">
                <MoreHorizontal className="size-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuItem onSelect={() => actions.favorite(node.id, !ctx.favorites.has(node.id))}>
                <Star className="size-4" /> {ctx.favorites.has(node.id) ? "Remove from favorites" : "Add to favorites"}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => actions.copyLink(node.id)}><Link2 className="size-4" /> Copy link</DropdownMenuItem>
              {canEdit && <DropdownMenuItem onSelect={() => actions.rename(node.id, node.title)}><Pencil className="size-4" /> Rename</DropdownMenuItem>}
              {node.kind === "page" && <DropdownMenuItem onSelect={() => actions.duplicate(node.id)}><Copy className="size-4" /> Duplicate</DropdownMenuItem>}
              {canEdit && <DropdownMenuItem onSelect={() => setMoveOpen(true)}><MoveRight className="size-4" /> Move to…</DropdownMenuItem>}
              {canEdit && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => actions.archive(node.id, true)}><Archive className="size-4" /> Archive</DropdownMenuItem>
                  <DropdownMenuItem variant="destructive" onSelect={() => actions.trash(node.id, node.title, pathname)}><Trash2 className="size-4" /> Move to trash</DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          {canEdit && node.kind === "page" && (
            <button type="button" aria-label="Add a page inside" onClick={addChild} className="flex size-6 items-center justify-center rounded hover:bg-foreground/10">
              <Plus className="size-4" />
            </button>
          )}
        </div>
      </div>
      {open && kids.length > 0 && <TreeList nodes={kids} depth={depth + 1} section={section} />}
      {open && !kids.length && node.kind === "page" && (
        <p className="py-1 text-xs text-muted-foreground/70" style={{ paddingLeft: 30 + depth * 14 }}>No pages inside</p>
      )}
      {moveOpen && <MoveDialog pageId={node.id} open={moveOpen} onOpenChange={setMoveOpen} onPick={(t) => actions.move(node.id, t)} />}
    </li>
  );
}
