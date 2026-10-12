"use client";

import { ArrowDown, ArrowUp, EyeOff, Maximize2, MoreHorizontal, Pencil, Plus, Settings2, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "@/components/ui/context-menu";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useDialogs } from "@/components/dialogs";
import type { Property } from "@/lib/db-engine/types";
import { PropertyCell } from "./property-cell";
import { PROPERTY_ICONS } from "./property-dialogs";
import type { ViewProps } from "./view-types";
import { visibleProperties } from "./view-controls";

const DEFAULT_WIDTH: Partial<Record<Property["type"], number>> = { title: 280, checkbox: 90, number: 120, date: 170, status: 150, select: 150, rollup: 160 };

export function TableView({ db, config, rows, members, membersList, canEdit, actions, onConfig, onEditProperty }: ViewProps) {
  const router = useRouter();
  const { prompt } = useDialogs();
  const props = visibleProperties(db.properties, config);
  const [widths, setWidths] = useState<Record<string, number>>(config.widths ?? {});
  const resizing = useRef<{ id: string; startX: number; startW: number } | null>(null);
  const widthOf = (p: Property) => widths[p.id] ?? DEFAULT_WIDTH[p.type] ?? 200;

  const startResize = (e: React.PointerEvent, p: Property) => {
    e.preventDefault();
    resizing.current = { id: p.id, startX: e.clientX, startW: widthOf(p) };
    const move = (ev: PointerEvent) => {
      const r = resizing.current;
      if (!r) return;
      setWidths((w) => ({ ...w, [r.id]: Math.max(60, Math.min(800, r.startW + ev.clientX - r.startX)) }));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      resizing.current = null;
      setWidths((w) => {
        onConfig({ ...config, widths: w });
        return w;
      });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const sortBy = (p: Property, direction: "asc" | "desc") => onConfig({ ...config, sorts: [{ propertyId: p.id, direction }] });
  const total = props.reduce((s, p) => s + widthOf(p), 0) + 40;

  return (
    <div className="overflow-x-auto">
      <table className="border-collapse text-sm" style={{ width: total, tableLayout: "fixed" }}>
        <colgroup>
          {props.map((p) => <col key={p.id} style={{ width: widthOf(p) }} />)}
          <col style={{ width: 40 }} />
        </colgroup>
        <thead>
          <tr className="border-y text-left text-muted-foreground">
            {props.map((p) => {
              const Icon = PROPERTY_ICONS[p.type];
              return (
                <th key={p.id} className="relative border-r p-0 font-normal last:border-r-0">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button type="button" className="flex h-8 w-full items-center gap-1.5 px-2 text-left hover:bg-accent">
                        <Icon className="size-3.5 flex-none" /><span className="truncate">{p.name}</span>
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-52">
                      {canEdit && <DropdownMenuItem onSelect={async () => { const name = await prompt({ title: "Rename property", initial: p.name }); if (name?.trim()) await actions.updateProperty(p.id, { name: name.trim() }); }}><Pencil className="size-4" /> Rename</DropdownMenuItem>}
                      {canEdit && p.type !== "title" && <DropdownMenuItem onSelect={() => onEditProperty(p)}><Settings2 className="size-4" /> Edit property</DropdownMenuItem>}
                      <DropdownMenuItem onSelect={() => sortBy(p, "asc")}><ArrowUp className="size-4" /> Sort ascending</DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => sortBy(p, "desc")}><ArrowDown className="size-4" /> Sort descending</DropdownMenuItem>
                      {p.type !== "title" && <DropdownMenuItem onSelect={() => onConfig({ ...config, hidden: [...(config.hidden ?? []), p.id] })}><EyeOff className="size-4" /> Hide in view</DropdownMenuItem>}
                      {canEdit && p.type !== "title" && !p.systemKey && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem variant="destructive" onSelect={() => actions.deleteProperty(p)}><Trash2 className="size-4" /> Delete property</DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <span role="separator" aria-orientation="vertical" aria-label={`Resize ${p.name}`} onPointerDown={(e) => startResize(e, p)} className="absolute -right-1 top-0 z-10 h-full w-2 cursor-col-resize hover:bg-blue-500/40" />
                </th>
              );
            })}
            <th className="p-0">
              {canEdit && (
                <button type="button" aria-label="Add property" className="flex h-8 w-full items-center justify-center hover:bg-accent" onClick={() => onEditProperty(null)}>
                  <Plus className="size-4" />
                </button>
              )}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <ContextMenu key={row.id}>
              <ContextMenuTrigger asChild>
                <tr className="group border-b hover:bg-accent/30">
                  {props.map((p) => (
                    <td key={p.id} className="relative border-r p-0 align-top last:border-r-0">
                      <PropertyCell
                        prop={p}
                        row={row}
                        members={members}
                        membersList={membersList}
                        canEdit={canEdit}
                        onChange={(v) => actions.setValue(row.id, p.id, v)}
                        onTitle={(t) => actions.setTitle(row.id, t)}
                        addOption={actions.addOption}
                      />
                      {p.type === "title" && (
                        <button
                          type="button"
                          onClick={() => router.push(`/p/${row.id}`)}
                          className="absolute right-1 top-1 hidden items-center gap-1 rounded border bg-background px-1.5 py-0.5 text-xs text-muted-foreground shadow-sm hover:text-foreground group-hover:flex"
                        >
                          <Maximize2 className="size-3" /> Open
                        </button>
                      )}
                    </td>
                  ))}
                  <td className="p-0 text-center">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button type="button" aria-label="Row actions" className="invisible rounded p-1 hover:bg-accent group-hover:visible"><MoreHorizontal className="size-4" /></button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => router.push(`/p/${row.id}`)}><Maximize2 className="size-4" /> Open as page</DropdownMenuItem>
                        {canEdit && <DropdownMenuItem variant="destructive" onSelect={() => actions.deleteRow(row.id, row.title)}><Trash2 className="size-4" /> Delete</DropdownMenuItem>}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItem onSelect={() => router.push(`/p/${row.id}`)}>Open as page</ContextMenuItem>
                {canEdit && (
                  <>
                    <ContextMenuSeparator />
                    <ContextMenuItem variant="destructive" onSelect={() => actions.deleteRow(row.id, row.title)}>Delete</ContextMenuItem>
                  </>
                )}
              </ContextMenuContent>
            </ContextMenu>
          ))}
        </tbody>
      </table>
      {canEdit && (
        <button type="button" onClick={() => actions.createRow()} className="flex h-8 w-full items-center gap-1.5 border-b px-2 text-sm text-muted-foreground hover:bg-accent/40" style={{ maxWidth: total }}>
          <Plus className="size-4" /> New
        </button>
      )}
    </div>
  );
}
