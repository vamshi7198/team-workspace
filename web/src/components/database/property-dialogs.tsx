"use client";

import { useQuery } from "@tanstack/react-query";
import {
  AlignLeft, ArrowUpRight, AtSign, Calendar, CheckSquare, CircleDot, Clock, Hash, Link as LinkIcon, List, Sigma, Tag as TagIcon,
  Type, User, UserPlus, Calculator, Trash2, Plus,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useWorkspace } from "@/components/workspace-context";
import { api } from "@/lib/api";
import { FORMULA_FUNCTIONS } from "@/lib/db-engine/formula";
import { OPTION_COLORS, type Property, type PropertyConfig, type PropertyType, type RollupFunction, type SelectOption } from "@/lib/db-engine/types";
import { useDatabase, type DatabaseMeta } from "@/lib/queries";
import type { useDbActions } from "./use-db-actions";

export const PROPERTY_ICONS: Record<PropertyType, React.ComponentType<{ className?: string }>> = {
  title: Type, text: AlignLeft, number: Hash, status: CircleDot, select: TagIcon, multi_select: List, date: Calendar, checkbox: CheckSquare,
  url: LinkIcon, email: AtSign, person: User, created_time: Clock, edited_time: Clock, created_by: UserPlus, relation: ArrowUpRight, formula: Calculator, rollup: Sigma,
};

const ADDABLE: [PropertyType, string][] = [
  ["text", "Text"], ["number", "Number"], ["select", "Select"], ["multi_select", "Multi-select"], ["status", "Status"], ["date", "Date"],
  ["person", "Person"], ["checkbox", "Checkbox"], ["url", "URL"], ["email", "Email"], ["relation", "Relation"], ["rollup", "Rollup"],
  ["formula", "Formula"], ["created_time", "Created time"], ["edited_time", "Last edited time"], ["created_by", "Created by"],
];
const ROLLUPS: [RollupFunction, string][] = [
  ["count", "Count linked pages"], ["count_values", "Count non-empty values"], ["sum", "Sum"], ["average", "Average"], ["min", "Minimum"], ["max", "Maximum"],
  ["percent_checked", "Percent checked"], ["percent_where", "Percent complete (status)"], ["show_original", "Show values"],
];

function OptionsEditor({ options, onChange, status }: { options: SelectOption[]; onChange: (o: SelectOption[]) => void; status: boolean }) {
  const update = (i: number, patch: Partial<SelectOption>) => onChange(options.map((o, j) => (j === i ? { ...o, ...patch } : o)));
  return (
    <div className="space-y-1.5">
      {options.map((o, i) => (
        <div key={o.id} className="flex items-center gap-1.5">
          <select aria-label="Colour" className={`tag tag-${o.color} h-8 w-24 border-0`} value={o.color} onChange={(e) => update(i, { color: e.target.value as SelectOption["color"] })}>
            {OPTION_COLORS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <Input className="h-8 flex-1" value={o.name} onChange={(e) => update(i, { name: e.target.value })} aria-label="Option name" />
          {status && (
            <select aria-label="Group" className="h-8 rounded-md border bg-background px-1 text-xs" value={o.group ?? "todo"} onChange={(e) => update(i, { group: e.target.value as SelectOption["group"] })}>
              <option value="todo">To-do</option><option value="in_progress">In progress</option><option value="done">Complete</option>
            </select>
          )}
          <Button variant="ghost" size="icon" className="size-8" aria-label="Delete option" onClick={() => onChange(options.filter((_, j) => j !== i))}><Trash2 className="size-3.5" /></Button>
        </div>
      ))}
      <Button variant="ghost" size="sm" className="h-7 gap-1 px-2" onClick={() => onChange([...options, { id: crypto.randomUUID(), name: "New option", color: OPTION_COLORS[options.length % OPTION_COLORS.length], ...(status ? { group: "todo" as const } : {}) }])}>
        <Plus className="size-3.5" /> Add option
      </Button>
    </div>
  );
}

/** Add a property (property = null) or edit an existing one. */
export function PropertyDialog({ open, onOpenChange, db, property, actions }: { open: boolean; onOpenChange: (o: boolean) => void; db: DatabaseMeta; property: Property | null; actions: ReturnType<typeof useDbActions> }) {
  const { workspace } = useWorkspace();
  const [name, setName] = useState("");
  const [type, setType] = useState<PropertyType>("text");
  const [config, setConfig] = useState<PropertyConfig>({});
  const [twoWay, setTwoWay] = useState(true);
  const [reverseName, setReverseName] = useState(db.title);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the form resets each time the dialog opens
    setName(property?.name ?? "");
    setType(property?.type ?? "text");
    setConfig(property?.config ?? {});
    setReverseName(db.title);
  }, [open, property, db.title]);

  const databases = useQuery({ queryKey: ["databases", workspace.id], queryFn: () => api.get<{ id: string; title: string }[]>(`/workspaces/${workspace.id}/databases`), enabled: open && type === "relation" && !property });
  const relationProp = db.properties.find((p) => p.id === config.relationPropertyId);
  const target = useDatabase(type === "rollup" ? relationProp?.config.targetDatabaseId : null);

  const save = async () => {
    setBusy(true);
    try {
      if (property) await actions.updateProperty(property.id, { name: name.trim() || property.name, config });
      else {
        const created = await actions.addProperty({ name: name.trim() || ADDABLE.find(([t]) => t === type)![1], type, config, twoWay, reverseName });
        if (!created) return;
      }
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  const hasOptions = type === "select" || type === "multi_select" || type === "status";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader><DialogTitle>{property ? `Edit “${property.name}”` : "New property"}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="prop-name">Name</Label>
            <Input id="prop-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Property name" />
          </div>
          {!property && (
            <div className="space-y-1.5">
              <Label>Type</Label>
              <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
                {ADDABLE.map(([t, label]) => {
                  const Icon = PROPERTY_ICONS[t];
                  return (
                    <button key={t} type="button" onClick={() => { setType(t); setConfig(t === "select" || t === "multi_select" ? { options: [] } : {}); }} className={`flex items-center gap-2 rounded-md border px-2 py-1.5 text-left text-sm ${type === t ? "border-blue-500 bg-blue-500/10" : "hover:bg-accent"}`}>
                      <Icon className="size-4" /> {label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {hasOptions && (property || type !== "status") && (
            <div className="space-y-1.5">
              <Label>Options</Label>
              <OptionsEditor options={config.options ?? []} onChange={(options) => setConfig({ ...config, options })} status={type === "status"} />
            </div>
          )}
          {!property && type === "status" && <p className="text-sm text-muted-foreground">Starts with Not started, In progress and Done. You can edit them afterwards.</p>}

          {type === "number" && (
            <div className="space-y-1.5">
              <Label>Format</Label>
              <select className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={config.numberFormat ?? "number"} onChange={(e) => setConfig({ ...config, numberFormat: e.target.value as PropertyConfig["numberFormat"] })}>
                <option value="number">Number</option><option value="percent">Percent</option><option value="currency_inr">Rupees (₹)</option><option value="currency_usd">US dollars ($)</option>
              </select>
            </div>
          )}
          {type === "date" && (
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={Boolean(config.includeTime)} onChange={(e) => setConfig({ ...config, includeTime: e.target.checked })} /> Include time</label>
          )}

          {type === "relation" && !property && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Related database</Label>
                <select className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={config.targetDatabaseId ?? ""} onChange={(e) => setConfig({ targetDatabaseId: e.target.value })}>
                  <option value="">Choose…</option>
                  {(databases.data ?? []).map((d) => <option key={d.id} value={d.id}>{d.title || "Untitled"}{d.id === db.id ? " (this database)" : ""}</option>)}
                </select>
              </div>
              {config.targetDatabaseId && config.targetDatabaseId !== db.id && (
                <>
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={twoWay} onChange={(e) => setTwoWay(e.target.checked)} /> Show on the related database too</label>
                  {twoWay && <Input value={reverseName} onChange={(e) => setReverseName(e.target.value)} aria-label="Name on the related database" placeholder="Name on the related database" />}
                </>
              )}
            </div>
          )}
          {type === "relation" && property && <p className="text-sm text-muted-foreground">Links to: {db.relatedDatabases.find((d) => d.id === property.config.targetDatabaseId)?.title ?? "another database"}</p>}

          {type === "formula" && (
            <div className="space-y-1.5">
              <Label htmlFor="formula">Formula</Label>
              <Textarea id="formula" className="font-mono text-sm" rows={3} value={config.expression ?? ""} onChange={(e) => setConfig({ ...config, expression: e.target.value })} placeholder={'if(prop("Status") == "Done", "✅", dateBetween(prop("Due date"), today(), "days") + " days left")'} />
              <details className="text-xs text-muted-foreground">
                <summary className="cursor-pointer">Available functions</summary>
                <p className="mt-1">Read properties with prop(&quot;Name&quot;). Operators: + - * / % == != &gt; &gt;= &lt; &lt;= and or not.</p>
                <ul className="mt-1 list-disc pl-4">{FORMULA_FUNCTIONS.map((f) => <li key={f}><code>{f}</code></li>)}</ul>
              </details>
            </div>
          )}

          {type === "rollup" && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Relation</Label>
                <select className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={config.relationPropertyId ?? ""} onChange={(e) => setConfig({ ...config, relationPropertyId: e.target.value, targetPropertyId: undefined })}>
                  <option value="">Choose…</option>
                  {db.properties.filter((p) => p.type === "relation").map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              {relationProp && (
                <div className="space-y-1.5">
                  <Label>Property of the linked pages</Label>
                  <select className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={config.targetPropertyId ?? ""} onChange={(e) => setConfig({ ...config, targetPropertyId: e.target.value || undefined })}>
                    <option value="">Title</option>
                    {(target.data?.properties ?? []).filter((p) => p.type !== "title").map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
              )}
              <div className="space-y-1.5">
                <Label>Calculate</Label>
                <select className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={config.rollup ?? "count"} onChange={(e) => {
                  const rollup = e.target.value as RollupFunction;
                  setConfig({ ...config, rollup, whereValue: rollup === "percent_where" ? "__done__" : undefined, numberFormat: rollup.startsWith("percent") ? "percent" : undefined });
                }}>
                  {ROLLUPS.map(([f, label]) => <option key={f} value={f}>{label}</option>)}
                </select>
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={busy || (type === "relation" && !property && !config.targetDatabaseId) || (type === "formula" && !config.expression?.trim()) || (type === "rollup" && !config.relationPropertyId)}>
            {property ? "Save" : "Add property"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
