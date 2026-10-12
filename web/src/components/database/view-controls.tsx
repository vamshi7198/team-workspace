"use client";

import { ArrowDown, ArrowUp, Eye, EyeOff, Filter, Group, Plus, SortAsc, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { FilterCondition, FilterOp, Property, ViewConfig } from "@/lib/db-engine/types";
import type { Member } from "@/lib/queries";
import { cn } from "@/lib/utils";

const OPS_BY_TYPE: Record<string, [FilterOp, string][]> = {
  text: [["contains", "contains"], ["not_contains", "does not contain"], ["equals", "is"], ["not_equals", "is not"], ["starts_with", "starts with"], ["is_empty", "is empty"], ["is_not_empty", "is not empty"]],
  number: [["equals", "="], ["not_equals", "≠"], ["gt", ">"], ["gte", "≥"], ["lt", "<"], ["lte", "≤"], ["is_empty", "is empty"], ["is_not_empty", "is not empty"]],
  select: [["is_any_of", "is any of"], ["is_none_of", "is none of"], ["is_empty", "is empty"], ["is_not_empty", "is not empty"]],
  status: [["is_any_of", "is any of"], ["is_none_of", "is none of"], ["is_done", "is complete"], ["is_not_done", "is not complete"]],
  multi_select: [["contains", "contains"], ["not_contains", "does not contain"], ["is_empty", "is empty"], ["is_not_empty", "is not empty"]],
  person: [["contains", "includes"], ["not_contains", "does not include"], ["is_empty", "is empty"], ["is_not_empty", "is not empty"]],
  relation: [["is_empty", "is empty"], ["is_not_empty", "is not empty"]],
  date: [["equals", "is"], ["before", "is before"], ["after", "is after"], ["on_or_before", "is on or before"], ["on_or_after", "is on or after"], ["within_next_days", "is within the next (days)"], ["within_past_days", "is within the past (days)"], ["is_empty", "is empty"], ["is_not_empty", "is not empty"]],
  checkbox: [["is_checked", "is checked"], ["is_not_checked", "is not checked"]],
};
const opsFor = (p?: Property): [FilterOp, string][] => {
  const t = p?.type ?? "title";
  if (t === "title" || t === "url" || t === "email" || t === "formula") return OPS_BY_TYPE.text;
  if (t === "created_time" || t === "edited_time") return OPS_BY_TYPE.date;
  if (t === "created_by") return OPS_BY_TYPE.person;
  if (t === "rollup") return OPS_BY_TYPE.number;
  return OPS_BY_TYPE[t] ?? OPS_BY_TYPE.text;
};
const NO_VALUE_OPS = new Set(["is_empty", "is_not_empty", "is_checked", "is_not_checked", "is_done", "is_not_done"]);
const DATE_TOKENS = [["today", "Today"], ["tomorrow", "Tomorrow"], ["yesterday", "Yesterday"], ["one_week_from_now", "One week from now"], ["one_week_ago", "One week ago"]];

function ConditionValue({ cond, prop, members, onChange }: { cond: FilterCondition; prop?: Property; members: Member[]; onChange: (v: FilterCondition["value"]) => void }) {
  if (NO_VALUE_OPS.has(cond.op)) return null;
  const t = prop?.type;
  if (t === "select" || t === "status" || t === "multi_select") {
    const selected = new Set(Array.isArray(cond.value) ? cond.value : cond.value ? [String(cond.value)] : []);
    return (
      <div className="flex flex-wrap gap-1">
        {(prop!.config.options ?? []).map((o) => (
          <button key={o.id} type="button" onClick={() => {
            const next = new Set(selected);
            if (next.has(o.id)) next.delete(o.id); else next.add(o.id);
            onChange([...next]);
          }} className={cn(`tag tag-${o.color}`, selected.has(o.id) ? "ring-2 ring-blue-500/60" : "opacity-60")}>{o.name}</button>
        ))}
      </div>
    );
  }
  if (t === "person" || t === "created_by") {
    return (
      <select className="h-8 rounded-md border bg-background px-2 text-sm" value={String(cond.value ?? "")} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">Choose…</option>
        <option value="me">Me (whoever is viewing)</option>
        {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
      </select>
    );
  }
  if (t === "date" || t === "created_time" || t === "edited_time") {
    if (cond.op === "within_next_days" || cond.op === "within_past_days") {
      return <Input type="number" min={1} className="h-8 w-20" value={String(cond.value ?? 7)} onChange={(e) => onChange(Number(e.target.value) || 7)} />;
    }
    const isToken = DATE_TOKENS.some(([k]) => k === cond.value);
    return (
      <div className="flex gap-1">
        <select className="h-8 rounded-md border bg-background px-2 text-sm" value={isToken ? String(cond.value) : "exact"} onChange={(e) => onChange(e.target.value === "exact" ? new Date().toISOString().slice(0, 10) : e.target.value)}>
          {DATE_TOKENS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          <option value="exact">Exact date</option>
        </select>
        {!isToken && <Input type="date" className="h-8 w-36" value={String(cond.value ?? "")} onChange={(e) => onChange(e.target.value)} />}
      </div>
    );
  }
  return <Input className="h-8 w-40" type={t === "number" || t === "rollup" ? "number" : "text"} value={String(cond.value ?? "")} onChange={(e) => onChange(t === "number" || t === "rollup" ? Number(e.target.value) : e.target.value)} placeholder="Value" />;
}

export function FilterControl({ config, properties, members, onChange }: { config: ViewConfig; properties: Property[]; members: Member[]; onChange: (c: ViewConfig) => void }) {
  const filter = config.filter ?? { mode: "and" as const, conditions: [] };
  const props = new Map(properties.map((p) => [p.id, p]));
  const set = (conditions: FilterCondition[], mode = filter.mode) => onChange({ ...config, filter: { mode, conditions } });
  const filterable = properties;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className={cn("h-7 gap-1 px-2 text-muted-foreground", filter.conditions.length && "text-blue-600 dark:text-blue-400")}>
          <Filter className="size-3.5" /> Filter{filter.conditions.length ? ` (${filter.conditions.length})` : ""}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(36rem,calc(100vw-2rem))] space-y-2 p-3">
        {filter.conditions.length === 0 && <p className="text-sm text-muted-foreground">No filters. Rows are shown unfiltered.</p>}
        {filter.conditions.map((c, i) => (
          <div key={i} className="flex flex-wrap items-center gap-1.5">
            <span className="w-12 text-xs text-muted-foreground">
              {i === 0 ? "Where" : i === 1 ? (
                <select className="rounded border bg-background text-xs" value={filter.mode} onChange={(e) => set(filter.conditions, e.target.value as "and" | "or")}>
                  <option value="and">and</option><option value="or">or</option>
                </select>
              ) : filter.mode}
            </span>
            <select className="h-8 max-w-40 rounded-md border bg-background px-2 text-sm" value={c.propertyId} onChange={(e) => { const p = props.get(e.target.value); set(filter.conditions.map((x, j) => (j === i ? { propertyId: e.target.value, op: opsFor(p)[0][0], value: null } : x))); }}>
              {filterable.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <select className="h-8 rounded-md border bg-background px-2 text-sm" value={c.op} onChange={(e) => set(filter.conditions.map((x, j) => (j === i ? { ...x, op: e.target.value as FilterOp } : x)))}>
              {opsFor(props.get(c.propertyId)).map(([op, label]) => <option key={op} value={op}>{label}</option>)}
            </select>
            <ConditionValue cond={c} prop={props.get(c.propertyId)} members={members} onChange={(v) => set(filter.conditions.map((x, j) => (j === i ? { ...x, value: v } : x)))} />
            <Button variant="ghost" size="icon" className="ml-auto size-7" aria-label="Remove filter" onClick={() => set(filter.conditions.filter((_, j) => j !== i))}><Trash2 className="size-3.5" /></Button>
          </div>
        ))}
        <Button variant="ghost" size="sm" className="h-7 gap-1 px-2" onClick={() => { const p = properties[0]; set([...filter.conditions, { propertyId: p.id, op: opsFor(p)[0][0], value: null }]); }}>
          <Plus className="size-3.5" /> Add filter
        </Button>
      </PopoverContent>
    </Popover>
  );
}

export function SortControl({ config, properties, onChange }: { config: ViewConfig; properties: Property[]; onChange: (c: ViewConfig) => void }) {
  const sorts = config.sorts ?? [];
  const set = (s: ViewConfig["sorts"]) => onChange({ ...config, sorts: s });
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className={cn("h-7 gap-1 px-2 text-muted-foreground", sorts.length && "text-blue-600 dark:text-blue-400")}>
          <SortAsc className="size-3.5" /> Sort{sorts.length ? ` (${sorts.length})` : ""}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 space-y-2 p-3">
        {sorts.length === 0 && <p className="text-sm text-muted-foreground">Rows are in manual order.</p>}
        {sorts.map((s, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <select className="h-8 flex-1 rounded-md border bg-background px-2 text-sm" value={s.propertyId} onChange={(e) => set(sorts.map((x, j) => (j === i ? { ...x, propertyId: e.target.value } : x)))}>
              {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <Button variant="outline" size="sm" className="h-8 gap-1" onClick={() => set(sorts.map((x, j) => (j === i ? { ...x, direction: x.direction === "asc" ? "desc" : "asc" } : x)))}>
              {s.direction === "asc" ? <><ArrowUp className="size-3.5" /> Asc</> : <><ArrowDown className="size-3.5" /> Desc</>}
            </Button>
            <Button variant="ghost" size="icon" className="size-8" aria-label="Remove sort" onClick={() => set(sorts.filter((_, j) => j !== i))}><Trash2 className="size-3.5" /></Button>
          </div>
        ))}
        <Button variant="ghost" size="sm" className="h-7 gap-1 px-2" onClick={() => set([...sorts, { propertyId: properties[0].id, direction: "asc" }])}><Plus className="size-3.5" /> Add sort</Button>
      </PopoverContent>
    </Popover>
  );
}

export function GroupControl({ config, properties, onChange }: { config: ViewConfig; properties: Property[]; onChange: (c: ViewConfig) => void }) {
  const groupable = properties.filter((p) => ["status", "select", "person", "checkbox"].includes(p.type));
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-muted-foreground"><Group className="size-3.5" /> Group</Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 space-y-2 p-3">
        <label className="block text-xs text-muted-foreground">Group cards by</label>
        <select className="h-8 w-full rounded-md border bg-background px-2 text-sm" value={config.groupBy ?? ""} onChange={(e) => onChange({ ...config, groupBy: e.target.value || null })}>
          {groupable.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={Boolean(config.hideEmptyGroups)} onChange={(e) => onChange({ ...config, hideEmptyGroups: e.target.checked })} /> Hide empty groups</label>
      </PopoverContent>
    </Popover>
  );
}

export function PropertiesControl({ config, properties, onChange, onAddProperty, canEdit }: { config: ViewConfig; properties: Property[]; onChange: (c: ViewConfig) => void; onAddProperty: () => void; canEdit: boolean }) {
  const ordered = orderProperties(properties, config);
  const hidden = new Set(config.hidden ?? []);
  const move = (id: string, dir: -1 | 1) => {
    const ids = ordered.map((p) => p.id);
    const i = ids.indexOf(id);
    const j = i + dir;
    if (j < 1 || j >= ids.length) return; // title stays first
    [ids[i], ids[j]] = [ids[j], ids[i]];
    onChange({ ...config, propertyOrder: ids });
  };
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-muted-foreground"><Eye className="size-3.5" /> Properties</Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-2">
        <ul className="max-h-80 space-y-0.5 overflow-y-auto">
          {ordered.map((p, i) => (
            <li key={p.id} className="flex items-center gap-1 rounded px-1 py-0.5 text-sm hover:bg-accent">
              <span className="flex-1 truncate">{p.name}</span>
              {i > 1 && <button type="button" aria-label={`Move ${p.name} up`} className="rounded p-0.5 hover:bg-background" onClick={() => move(p.id, -1)}><ArrowUp className="size-3.5" /></button>}
              {i > 0 && i < ordered.length - 1 && <button type="button" aria-label={`Move ${p.name} down`} className="rounded p-0.5 hover:bg-background" onClick={() => move(p.id, 1)}><ArrowDown className="size-3.5" /></button>}
              {p.type !== "title" && (
                <button type="button" aria-label={hidden.has(p.id) ? `Show ${p.name}` : `Hide ${p.name}`} className="rounded p-0.5 hover:bg-background" onClick={() => {
                  const next = new Set(hidden);
                  if (next.has(p.id)) next.delete(p.id); else next.add(p.id);
                  onChange({ ...config, hidden: [...next] });
                }}>
                  {hidden.has(p.id) ? <EyeOff className="size-3.5 text-muted-foreground" /> : <Eye className="size-3.5" />}
                </button>
              )}
            </li>
          ))}
        </ul>
        {canEdit && <Button variant="ghost" size="sm" className="mt-1 h-7 w-full justify-start gap-1 px-2" onClick={onAddProperty}><Plus className="size-3.5" /> New property</Button>}
      </PopoverContent>
    </Popover>
  );
}

/** Properties in view order: title first, then the saved order, then the rest. */
export function orderProperties(properties: Property[], config: ViewConfig): Property[] {
  const title = properties.filter((p) => p.type === "title");
  const rest = properties.filter((p) => p.type !== "title");
  const order = config.propertyOrder ?? [];
  const pos = (id: string) => { const i = order.indexOf(id); return i === -1 ? 1e6 : i; };
  return [...title, ...rest.sort((a, b) => pos(a.id) - pos(b.id) || a.position - b.position)];
}

export function visibleProperties(properties: Property[], config: ViewConfig) {
  const hidden = new Set(config.hidden ?? []);
  return orderProperties(properties, config).filter((p) => p.type === "title" || !hidden.has(p.id));
}
