"use client";

import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { DateValue, Property, Row, SelectOption } from "@/lib/db-engine/types";
import type { Member } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { CellDisplay, DatePicker, OptionPicker, PersonPicker, READONLY_TYPES, RelationPicker, rawOf } from "./cells";

const INLINE = new Set(["title", "text", "url", "email", "number"]);

/** A property value that can be edited in place (table cell, card, row page). */
export function PropertyCell({
  prop, row, members, membersList, canEdit, onChange, onTitle, addOption, className, compact,
}: {
  prop: Property;
  row: Row;
  members: Map<string, Member>;
  membersList: Member[];
  canEdit: boolean;
  onChange: (value: unknown) => void;
  onTitle?: (title: string) => void;
  addOption: (prop: Property, name: string) => Promise<SelectOption | null>;
  className?: string;
  compact?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(false);
  const editable = canEdit && !READONLY_TYPES.has(prop.type);
  const base = cn("flex min-h-8 w-full min-w-0 items-center px-2 py-1 text-sm", className);

  if (!editable) {
    return <div className={base}><CellDisplay prop={prop} row={row} members={members} compact={compact} /></div>;
  }

  if (prop.type === "checkbox") {
    return (
      <button type="button" className={base} role="checkbox" aria-checked={row.values[prop.id] === true} aria-label={prop.name} onClick={() => onChange(!(row.values[prop.id] === true))}>
        <CellDisplay prop={prop} row={row} members={members} />
      </button>
    );
  }

  if (INLINE.has(prop.type)) {
    const current = prop.type === "title" ? row.title : row.values[prop.id];
    const commit = () => {
      setEditing(false);
      const value = draft.trim();
      if (prop.type === "title") {
        if (value !== row.title) onTitle?.(value);
      } else if (prop.type === "number") {
        const n = value === "" ? null : Number(value.replace(/,/g, ""));
        if (n !== null && Number.isNaN(n)) return;
        if (n !== current) onChange(n);
      } else if (value !== (current ?? "")) onChange(value || null);
    };
    if (editing) {
      return (
        <input
          autoFocus
          aria-label={prop.name}
          className={cn(base, "bg-background outline-none ring-2 ring-blue-500/50", prop.type === "number" && "text-right")}
          inputMode={prop.type === "number" ? "decimal" : undefined}
          type={prop.type === "email" ? "email" : "text"}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") setEditing(false);
          }}
        />
      );
    }
    return (
      <div
        role="button"
        tabIndex={0}
        aria-label={`Edit ${prop.name}`}
        className={cn(base, "cursor-text")}
        onClick={() => { setDraft(current === null || current === undefined ? "" : String(current)); setEditing(true); }}
        onKeyDown={(e) => { if (e.key === "Enter") { setDraft(current === null || current === undefined ? "" : String(current)); setEditing(true); } }}
      >
        <CellDisplay prop={prop} row={row} members={members} compact={compact} />
      </div>
    );
  }

  const value = rawOf(prop, row);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className={cn(base, "text-left")} aria-label={`Edit ${prop.name}`}>
          <CellDisplay prop={prop} row={row} members={members} compact={compact} />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        {(prop.type === "select" || prop.type === "status" || prop.type === "multi_select") && (
          <OptionPicker
            prop={prop}
            value={value as string | string[] | null}
            multi={prop.type === "multi_select"}
            canAddOptions={canEdit}
            onChange={(v) => {
              onChange(v);
              if (prop.type !== "multi_select") setOpen(false);
            }}
            onAddOption={(name) => addOption(prop, name)}
          />
        )}
        {prop.type === "person" && <PersonPicker value={(value as string[]) ?? []} members={membersList} onChange={onChange} />}
        {prop.type === "date" && <DatePicker value={value as DateValue | null} includeTime={prop.config.includeTime} onChange={onChange} />}
        {prop.type === "relation" && <RelationPicker prop={prop} row={row} onChange={onChange} />}
      </PopoverContent>
    </Popover>
  );
}
