"use client";

import { DndContext, DragOverlay, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { groupRows, NO_VALUE } from "@/lib/db-engine/query";
import type { Property, Row } from "@/lib/db-engine/types";
import { cn } from "@/lib/utils";
import { CellDisplay } from "./cells";
import { visibleProperties } from "./view-controls";
import type { ViewProps } from "./view-types";

function groupValue(prop: Property, key: string): unknown {
  if (key === NO_VALUE) return prop.type === "person" ? [] : null;
  if (prop.type === "checkbox") return key === "true";
  if (prop.type === "person") return [key];
  return key;
}

function Card({ row, props, members, onOpen, overlay }: { row: Row; props: Property[]; members: ViewProps["members"]; onOpen?: () => void; overlay?: boolean }) {
  return (
    <div
      onClick={onOpen}
      className={cn("cursor-pointer space-y-1.5 rounded-md border bg-background p-2.5 text-sm shadow-xs hover:bg-accent/30", overlay && "rotate-2 shadow-lg")}
    >
      <div className="font-medium">{row.icon && <span className="mr-1">{row.icon}</span>}{row.title || <span className="text-muted-foreground">Untitled</span>}</div>
      {props.map((p) => {
        const v = p.type === "relation" ? row.relations[p.id] : row.values[p.id];
        if (v === null || v === undefined || (Array.isArray(v) && !v.length) || v === "") return null;
        return <div key={p.id} className="flex min-w-0 text-xs"><CellDisplay prop={p} row={row} members={members} compact /></div>;
      })}
    </div>
  );
}

function DraggableCard(props: { row: Row; props: Property[]; members: ViewProps["members"]; onOpen: () => void; disabled: boolean }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: props.row.id, disabled: props.disabled });
  const { setNodeRef: dropRef, isOver } = useDroppable({ id: `card:${props.row.id}` });
  return (
    <div ref={(el) => { setNodeRef(el); dropRef(el); }} {...attributes} {...listeners} className={cn(isDragging && "opacity-30", isOver && "border-t-2 border-blue-500 pt-1")}>
      <Card {...props} />
    </div>
  );
}

function Column({ id, children, over }: { id: string; children: React.ReactNode; over: boolean }) {
  const { setNodeRef } = useDroppable({ id: `col:${id}` });
  return <div ref={setNodeRef} className={cn("flex min-h-24 flex-col gap-2 rounded-lg p-1", over && "bg-blue-500/5 ring-1 ring-blue-500/30")}>{children}</div>;
}

export function BoardView({ db, config, rows, members, canEdit, actions }: ViewProps) {
  const router = useRouter();
  const groupProp = db.properties.find((p) => p.id === config.groupBy) ?? db.properties.find((p) => p.type === "status") ?? db.properties.find((p) => p.type === "select");
  const shown = visibleProperties(db.properties, config).filter((p) => p.type !== "title" && p.id !== groupProp?.id);
  const groups = groupRows(rows, groupProp, (id) => members.get(id)?.name ?? "Unknown").filter((g) => !config.hideEmptyGroups || g.rows.length);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const [active, setActive] = useState<Row | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);

  if (!groupProp) {
    return <p className="p-4 text-sm text-muted-foreground">Add a Status or Select property to use a board.</p>;
  }

  const colOf = (overId: string) => {
    if (overId.startsWith("col:")) return overId.slice(4);
    const rowId = overId.slice(5);
    return groups.find((g) => g.rows.some((r) => r.id === rowId))?.key ?? null;
  };

  const onEnd = async (e: DragEndEvent) => {
    setActive(null);
    setOverCol(null);
    if (!e.over) return;
    const rowId = String(e.active.id);
    const overId = String(e.over.id);
    const key = colOf(overId);
    if (!key) return;
    const target = groups.find((g) => g.key === key)!;
    const list = target.rows.filter((r) => r.id !== rowId);
    let beforeId: string | null = null;
    let afterId: string | null = null;
    if (overId.startsWith("card:")) {
      const idx = list.findIndex((r) => r.id === overId.slice(5));
      beforeId = list[idx]?.id ?? null;
      afterId = list[idx - 1]?.id ?? null;
    } else afterId = list[list.length - 1]?.id ?? null;
    const source = groups.find((g) => g.rows.some((r) => r.id === rowId));
    const changedGroup = source?.key !== key;
    if (!changedGroup && !beforeId && !afterId) return;
    await actions.moveRow(rowId, { afterId, beforeId, values: changedGroup ? { [groupProp.id]: groupValue(groupProp, key) } : undefined });
  };

  return (
    <DndContext
      sensors={sensors}
      onDragStart={(e) => setActive(rows.find((r) => r.id === e.active.id) ?? null)}
      onDragOver={(e) => setOverCol(e.over ? colOf(String(e.over.id)) : null)}
      onDragEnd={onEnd}
      onDragCancel={() => { setActive(null); setOverCol(null); }}
    >
      <div className="flex gap-3 overflow-x-auto pb-4">
        {groups.map((g) => (
          <div key={g.key} className="w-64 flex-none sm:w-72">
            <div className="mb-2 flex items-center gap-2 px-1 text-sm">
              <span className={`tag tag-${g.color}`}>{g.label}</span>
              <span className="text-muted-foreground">{g.rows.length}</span>
            </div>
            <Column id={g.key} over={overCol === g.key}>
              {g.rows.map((r) => (
                <DraggableCard key={r.id} row={r} props={shown} members={members} onOpen={() => router.push(`/p/${r.id}`)} disabled={!canEdit} />
              ))}
              {canEdit && (
                <button type="button" onClick={() => actions.createRow({ values: g.key === NO_VALUE ? {} : { [groupProp.id]: groupValue(groupProp, g.key) } })} className="flex h-8 items-center gap-1 rounded-md px-2 text-sm text-muted-foreground hover:bg-accent">
                  <Plus className="size-4" /> New
                </button>
              )}
            </Column>
          </div>
        ))}
      </div>
      <DragOverlay dropAnimation={null}>{active && <div className="w-64"><Card row={active} props={shown} members={members} overlay /></div>}</DragOverlay>
    </DndContext>
  );
}
