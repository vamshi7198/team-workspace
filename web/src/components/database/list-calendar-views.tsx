"use client";

import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { addDays, dayOf } from "@/lib/db-engine/query";
import type { DateValue, Row } from "@/lib/db-engine/types";
import { cn } from "@/lib/utils";
import { CellDisplay } from "./cells";
import { visibleProperties } from "./view-controls";
import type { ViewProps } from "./view-types";

export function ListView({ db, config, rows, members, canEdit, actions }: ViewProps) {
  const router = useRouter();
  const props = visibleProperties(db.properties, config).filter((p) => p.type !== "title").slice(0, 4);
  return (
    <div>
      <ul className="divide-y border-y">
        {rows.map((r) => (
          <li key={r.id}>
            <button type="button" onClick={() => router.push(`/p/${r.id}`)} className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-2 py-2 text-left text-sm hover:bg-accent/40">
              <span className="min-w-0 flex-1 truncate font-medium">{r.icon && <span className="mr-1.5">{r.icon}</span>}{r.title || <span className="text-muted-foreground">Untitled</span>}</span>
              {props.map((p) => (
                <span key={p.id} className="flex max-w-56 min-w-0 items-center text-xs text-muted-foreground"><CellDisplay prop={p} row={r} members={members} /></span>
              ))}
            </button>
          </li>
        ))}
      </ul>
      {rows.length === 0 && <p className="px-2 py-6 text-center text-sm text-muted-foreground">Nothing here.</p>}
      {canEdit && <button type="button" onClick={() => actions.createRow()} className="flex h-8 w-full items-center gap-1.5 px-2 text-sm text-muted-foreground hover:bg-accent/40"><Plus className="size-4" /> New</button>}
    </div>
  );
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function CalendarView({ db, config, rows, canEdit, actions, onConfig }: ViewProps) {
  const router = useRouter();
  const dateProps = db.properties.filter((p) => p.type === "date");
  const dateProp = dateProps.find((p) => p.id === config.dateProperty) ?? dateProps[0];
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [dragOver, setDragOver] = useState<string | null>(null);
  const today = iso(new Date());

  const byDay = useMemo(() => {
    const m = new Map<string, Row[]>();
    if (!dateProp) return m;
    for (const r of rows) {
      const v = r.values[dateProp.id] as DateValue | null;
      const start = dayOf(v);
      if (!start) continue;
      const end = v?.end ? v.end.slice(0, 10) : start;
      // Multi-day items appear on every day they span (capped to keep the grid sane).
      for (let d = start, i = 0; d <= end && i < 62; d = addDays(d, 1), i++) {
        const list = m.get(d) ?? [];
        list.push(r);
        m.set(d, list);
      }
    }
    return m;
  }, [rows, dateProp]);

  if (!dateProp) return <p className="p-4 text-sm text-muted-foreground">Add a Date property to use the calendar.</p>;

  const first = new Date(month);
  const offset = (first.getDay() + 6) % 7;
  const gridStart = new Date(first.getFullYear(), first.getMonth(), 1 - offset);
  const days = Array.from({ length: 42 }, (_, i) => new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i));

  const moveTo = async (rowId: string, day: string) => {
    const row = rows.find((r) => r.id === rowId);
    const cur = row?.values[dateProp.id] as DateValue | null;
    const time = cur?.start && cur.start.length > 10 ? cur.start.slice(10) : "";
    let end: string | null = null;
    if (cur?.end && cur.start) {
      const span = Math.round((new Date(cur.end.slice(0, 10)).getTime() - new Date(cur.start.slice(0, 10)).getTime()) / 864e5);
      end = addDays(day, span);
    }
    await actions.setValue(rowId, dateProp.id, { start: `${day}${time}`, end });
  };

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="min-w-36 text-sm font-semibold">{month.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}</h3>
        <Button variant="ghost" size="icon" className="size-7" aria-label="Previous month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}><ChevronLeft className="size-4" /></Button>
        <Button variant="ghost" size="sm" className="h-7" onClick={() => { const d = new Date(); setMonth(new Date(d.getFullYear(), d.getMonth(), 1)); }}>Today</Button>
        <Button variant="ghost" size="icon" className="size-7" aria-label="Next month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}><ChevronRight className="size-4" /></Button>
        {dateProps.length > 1 && (
          <select className="ml-auto h-7 rounded-md border bg-background px-2 text-xs" value={dateProp.id} onChange={(e) => onConfig({ ...config, dateProperty: e.target.value })} aria-label="Date property">
            {dateProps.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
      </div>
      <div className="overflow-x-auto">
        <div className="grid min-w-[640px] grid-cols-7 border-l border-t text-sm">
          {WEEKDAYS.map((d) => <div key={d} className="border-b border-r px-2 py-1 text-xs text-muted-foreground">{d}</div>)}
          {days.map((d) => {
            const key = iso(d);
            const items = byDay.get(key) ?? [];
            const inMonth = d.getMonth() === month.getMonth();
            return (
              <div
                key={key}
                onDragOver={(e) => { if (canEdit) { e.preventDefault(); setDragOver(key); } }}
                onDragLeave={() => setDragOver(null)}
                onDrop={(e) => { e.preventDefault(); setDragOver(null); const id = e.dataTransfer.getData("text/row-id"); if (id) void moveTo(id, key); }}
                className={cn("group min-h-24 border-b border-r p-1", !inMonth && "bg-muted/30 text-muted-foreground", dragOver === key && "bg-blue-500/10")}
              >
                <div className="mb-1 flex items-center justify-between">
                  <span className={cn("flex size-6 items-center justify-center rounded-full text-xs", key === today && "bg-red-500 font-semibold text-white")}>{d.getDate()}</span>
                  {canEdit && (
                    <button type="button" aria-label={`New item on ${key}`} onClick={() => actions.createRow({ values: { [dateProp.id]: { start: key } } })} className="invisible rounded p-0.5 hover:bg-accent group-hover:visible">
                      <Plus className="size-3.5" />
                    </button>
                  )}
                </div>
                <div className="space-y-1">
                  {items.slice(0, 4).map((r) => (
                    <div
                      key={r.id}
                      draggable={canEdit}
                      onDragStart={(e) => e.dataTransfer.setData("text/row-id", r.id)}
                      onClick={() => router.push(`/p/${r.id}`)}
                      className="cursor-pointer truncate rounded border bg-background px-1.5 py-0.5 text-xs shadow-xs hover:bg-accent"
                      title={r.title}
                    >
                      {r.icon && <span className="mr-1">{r.icon}</span>}{r.title || "Untitled"}
                    </div>
                  ))}
                  {items.length > 4 && <div className="px-1 text-xs text-muted-foreground">+{items.length - 4} more</div>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
