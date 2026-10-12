"use client";

import { useQuery } from "@tanstack/react-query";
import { Check, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Calendar } from "@/components/ui/calendar";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { formatDate, formatNumber } from "@/lib/db-engine/format";
import { OPTION_COLORS, type DateValue, type Property, type Row, type SelectOption, type Value } from "@/lib/db-engine/types";
import type { Member } from "@/lib/queries";
import { cn } from "@/lib/utils";

export const READONLY_TYPES = new Set(["created_time", "edited_time", "created_by", "formula", "rollup"]);

export function Tag({ option }: { option?: SelectOption }) {
  if (!option) return null;
  return <span className={`tag tag-${option.color}`}>{option.name}</span>;
}

export function Person({ id, members }: { id: string; members: Map<string, Member> }) {
  const m = members.get(id);
  return (
    <span className="inline-flex max-w-full items-center gap-1.5">
      <span className="flex size-5 flex-none items-center justify-center rounded-full bg-muted text-[10px] font-semibold">{(m?.name ?? "?").slice(0, 1).toUpperCase()}</span>
      <span className="truncate">{m?.name ?? "Former member"}</span>
    </span>
  );
}

export function rawOf(prop: Property, row: Row): Value {
  if (prop.type === "title") return row.title;
  if (prop.type === "created_time") return row.createdAt;
  if (prop.type === "edited_time") return row.updatedAt;
  if (prop.type === "created_by") return row.createdBy ? [row.createdBy] : [];
  return row.values[prop.id] ?? null;
}

/** Read-only rendering of a property value. */
export function CellDisplay({ prop, row, members, compact }: { prop: Property; row: Row; members: Map<string, Member>; compact?: boolean }) {
  const v = rawOf(prop, row);
  switch (prop.type) {
    case "title":
      return <span className="truncate font-medium">{row.title || <span className="text-muted-foreground">Untitled</span>}</span>;
    case "status":
    case "select":
      return <Tag option={prop.config.options?.find((o) => o.id === v)} />;
    case "multi_select":
      return (
        <span className={cn("flex gap-1", compact ? "flex-wrap" : "overflow-hidden")}>
          {((v as string[]) ?? []).map((id) => <Tag key={id} option={prop.config.options?.find((o) => o.id === id)} />)}
        </span>
      );
    case "person":
    case "created_by":
      return (
        <span className="flex flex-wrap gap-2 overflow-hidden">
          {((v as string[]) ?? []).map((id) => <Person key={id} id={id} members={members} />)}
        </span>
      );
    case "date":
      return <span className="truncate">{v ? formatDate(v as DateValue) : ""}</span>;
    case "created_time":
    case "edited_time":
      return <span className="truncate text-muted-foreground">{v ? new Date(v as string).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : ""}</span>;
    case "checkbox":
      return <span className={cn("flex size-4 items-center justify-center rounded border", v === true && "border-blue-600 bg-blue-600 text-white")}>{v === true && <Check className="size-3" />}</span>;
    case "number":
      return <span className="block w-full truncate text-right tabular-nums">{typeof v === "number" ? formatNumber(v, prop.config.numberFormat) : ""}</span>;
    case "rollup":
      if (typeof v === "number" && prop.config.numberFormat === "percent") {
        return (
          <span className="flex w-full items-center gap-2">
            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full bg-green-600" style={{ width: `${Math.min(100, v)}%` }} /></span>
            <span className="w-9 text-right text-xs tabular-nums">{v}%</span>
          </span>
        );
      }
      return <span className="truncate tabular-nums">{v === null ? "" : typeof v === "number" ? formatNumber(v) : String(v)}</span>;
    case "url":
      return typeof v === "string" && /^https?:\/\//i.test(v) ? (
        <a href={v} target="_blank" rel="noopener noreferrer nofollow" className="truncate underline decoration-foreground/30 underline-offset-2" onClick={(e) => e.stopPropagation()}>{v.replace(/^https?:\/\//, "")}</a>
      ) : <span className="truncate">{(v as string) ?? ""}</span>;
    case "email":
      return v ? <a href={`mailto:${v}`} className="truncate underline decoration-foreground/30 underline-offset-2" onClick={(e) => e.stopPropagation()}>{String(v)}</a> : null;
    case "relation":
      return (
        <span className={cn("flex gap-1.5", compact ? "flex-wrap" : "overflow-hidden")}>
          {(row.relations[prop.id] ?? []).map((r) => (
            <Link key={r.id} href={`/p/${r.id}`} onClick={(e) => e.stopPropagation()} className="inline-flex max-w-48 items-center gap-1 truncate rounded px-1 text-sm underline decoration-foreground/25 underline-offset-2 hover:bg-accent">
              <span>{r.icon ?? "📄"}</span><span className="truncate">{r.title || "Untitled"}</span>
            </Link>
          ))}
        </span>
      );
    case "formula":
      if (v === null || v === undefined) return null;
      if (typeof v === "boolean") return <span className={cn("flex size-4 items-center justify-center rounded border", v && "border-blue-600 bg-blue-600 text-white")}>{v && <Check className="size-3" />}</span>;
      if (typeof v === "number") return <span className="block w-full text-right tabular-nums">{formatNumber(v)}</span>;
      return <span className="truncate">{/^\d{4}-\d{2}-\d{2}T/.test(String(v)) ? formatDate(String(v).slice(0, 10)) : String(v)}</span>;
    default:
      return <span className="truncate">{v === null ? "" : String(v)}</span>;
  }
}

// ---- editors -------------------------------------------------------------------

export function OptionPicker({ prop, value, multi, canAddOptions, onChange, onAddOption }: {
  prop: Property;
  value: string | string[] | null;
  multi: boolean;
  canAddOptions: boolean;
  onChange: (v: string | string[] | null) => void;
  onAddOption: (name: string) => Promise<SelectOption | null>;
}) {
  const [q, setQ] = useState("");
  const selected = new Set(multi ? ((value as string[]) ?? []) : value ? [value as string] : []);
  const options = prop.config.options ?? [];
  const exact = options.some((o) => o.name.toLowerCase() === q.trim().toLowerCase());
  const toggle = (id: string) => {
    if (multi) {
      const next = new Set(selected);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      onChange([...next]);
    } else onChange(selected.has(id) ? null : id);
  };
  return (
    <Command>
      <CommandInput placeholder={multi ? "Search or create options…" : "Search or create an option…"} value={q} onValueChange={setQ} />
      <CommandList>
        <CommandEmpty>{canAddOptions ? "Type to create a new option" : "No options"}</CommandEmpty>
        {selected.size > 0 && (
          <div className="flex flex-wrap gap-1 border-b p-2">
            {[...selected].map((id) => (
              <span key={id} className="inline-flex items-center">
                <Tag option={options.find((o) => o.id === id)} />
                <button type="button" aria-label="Remove" className="ml-0.5 rounded p-0.5 hover:bg-accent" onClick={() => toggle(id)}><X className="size-3" /></button>
              </span>
            ))}
          </div>
        )}
        <CommandGroup>
          {options.map((o) => (
            <CommandItem key={o.id} value={o.name} onSelect={() => toggle(o.id)}>
              <Tag option={o} />
              {selected.has(o.id) && <Check className="ml-auto size-4" />}
            </CommandItem>
          ))}
          {canAddOptions && q.trim() && !exact && (
            <CommandItem
              value={`__create__${q}`}
              onSelect={async () => {
                const o = await onAddOption(q.trim());
                if (o) {
                  if (multi) onChange([...selected, o.id]);
                  else onChange(o.id);
                }
                setQ("");
              }}
            >
              Create <span className={`tag tag-${OPTION_COLORS[options.length % OPTION_COLORS.length]}`}>{q.trim()}</span>
            </CommandItem>
          )}
        </CommandGroup>
      </CommandList>
    </Command>
  );
}

export function PersonPicker({ value, members, onChange }: { value: string[]; members: Member[]; onChange: (v: string[]) => void }) {
  const selected = new Set(value ?? []);
  return (
    <Command>
      <CommandInput placeholder="Search people…" />
      <CommandList>
        <CommandEmpty>No one found</CommandEmpty>
        <CommandGroup>
          {members.filter((m) => !m.disabledAt).map((m) => (
            <CommandItem
              key={m.id}
              value={`${m.name} ${m.email}`}
              onSelect={() => {
                const next = new Set(selected);
                if (next.has(m.id)) next.delete(m.id);
                else next.add(m.id);
                onChange([...next]);
              }}
            >
              <span className="flex size-5 items-center justify-center rounded-full bg-muted text-[10px] font-semibold">{m.name.slice(0, 1).toUpperCase()}</span>
              <span className="truncate">{m.name}</span>
              {selected.has(m.id) && <Check className="ml-auto size-4" />}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </Command>
  );
}

const toIsoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function DatePicker({ value, includeTime, onChange }: { value: DateValue | null; includeTime?: boolean; onChange: (v: DateValue | null) => void }) {
  const start = value?.start ?? null;
  const day = start ? new Date(`${start.slice(0, 10)}T00:00:00`) : undefined;
  const time = start && start.length > 10 ? start.slice(11, 16) : "";
  const [hasEnd, setHasEnd] = useState(Boolean(value?.end));
  const setDay = (d: Date | undefined) => {
    if (!d) return onChange(null);
    const iso = toIsoDay(d);
    onChange({ start: time && includeTime ? `${iso}T${time}` : iso, end: value?.end ?? null });
  };
  return (
    <div className="p-2">
      <Calendar mode="single" selected={day} onSelect={setDay} defaultMonth={day} />
      <div className="space-y-2 border-t px-1 pt-2">
        {includeTime && start && (
          <label className="flex items-center justify-between gap-2 text-sm">
            Time
            <Input type="time" className="h-8 w-32" value={time} onChange={(e) => onChange({ start: e.target.value ? `${start.slice(0, 10)}T${e.target.value}` : start.slice(0, 10), end: value?.end ?? null })} />
          </label>
        )}
        {start && (
          <label className="flex items-center justify-between gap-2 text-sm">
            <span className="flex items-center gap-2"><input type="checkbox" checked={hasEnd} onChange={(e) => { setHasEnd(e.target.checked); if (!e.target.checked) onChange({ start, end: null }); }} /> End date</span>
            {hasEnd && <Input type="date" className="h-8 w-40" value={value?.end?.slice(0, 10) ?? ""} min={start.slice(0, 10)} onChange={(e) => onChange({ start, end: e.target.value || null })} />}
          </label>
        )}
        <div className="flex justify-between gap-2">
          <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setDay(new Date())}>Today</button>
          {start && <button type="button" className="text-xs text-muted-foreground hover:text-destructive" onClick={() => onChange(null)}>Clear</button>}
        </div>
      </div>
    </div>
  );
}

export function RelationPicker({ prop, row, onChange }: { prop: Property; row: Row; onChange: (ids: string[]) => void }) {
  const [q, setQ] = useState("");
  const target = prop.config.targetDatabaseId;
  const results = useQuery({
    queryKey: ["pick", target, q],
    queryFn: () => api.get<{ id: string; title: string; icon: string | null }[]>(`/databases/${target}/pick?q=${encodeURIComponent(q)}`),
    enabled: Boolean(target),
    placeholderData: (p) => p,
  });
  const current = row.relations[prop.id] ?? [];
  const ids = new Set(current.map((r) => r.id));
  return (
    <Command shouldFilter={false}>
      <CommandInput placeholder="Search pages to link…" value={q} onValueChange={setQ} />
      <CommandList>
        {current.length > 0 && (
          <CommandGroup heading="Linked">
            {current.map((r) => (
              <CommandItem key={r.id} value={`linked-${r.id}`} onSelect={() => onChange([...ids].filter((x) => x !== r.id))}>
                <span>{r.icon ?? "📄"}</span><span className="truncate">{r.title || "Untitled"}</span><X className="ml-auto size-4" />
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        <CommandEmpty>No pages found</CommandEmpty>
        <CommandGroup heading="Add">
          {(results.data ?? []).filter((r) => !ids.has(r.id)).map((r) => (
            <CommandItem key={r.id} value={r.id} onSelect={() => onChange([...ids, r.id])}>
              <span>{r.icon ?? "📄"}</span><span className="truncate">{r.title || "Untitled"}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </Command>
  );
}
