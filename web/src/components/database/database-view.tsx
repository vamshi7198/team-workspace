"use client";

import { Calendar as CalendarIcon, Download, Kanban, List, MoreHorizontal, Plus, Search, Table2, Trash2, Pencil } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useDialogs } from "@/components/dialogs";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useWorkspace } from "@/components/workspace-context";
import { api } from "@/lib/api";
import type { Property, View, ViewConfig } from "@/lib/db-engine/types";
import { useDatabaseByPage, useMembers, type Member } from "@/lib/queries";
import { useQuery } from "@tanstack/react-query";
import type { Row } from "@/lib/db-engine/types";
import { cn } from "@/lib/utils";
import { BoardView } from "./board-view";
import { CalendarView, ListView } from "./list-calendar-views";
import { PropertyDialog } from "./property-dialogs";
import { TableView } from "./table-view";
import { useDbActions } from "./use-db-actions";
import { FilterControl, GroupControl, PropertiesControl, SortControl } from "./view-controls";

const VIEW_ICONS = { table: Table2, board: Kanban, list: List, calendar: CalendarIcon };
const VIEW_LABELS = { table: "Table", board: "Board", list: "List", calendar: "Calendar" };

/** A database with its saved views. Used as a full page and embedded inside documents. */
export function DatabaseView({ pageId, embedded = false }: { pageId: string; embedded?: boolean }) {
  const { workspace } = useWorkspace();
  const meta = useDatabaseByPage(pageId);
  const members = useMembers(workspace.id);
  const db = meta.data;

  if (meta.isLoading) return <div className="space-y-2 py-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>;
  if (meta.isError || !db) {
    return <div className="rounded-md border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">This database doesn&apos;t exist or you don&apos;t have access to it.</div>;
  }
  return <DatabaseInner db={db} embedded={embedded} membersList={members.data ?? []} />;
}

function DatabaseInner({ db, embedded, membersList }: { db: NonNullable<ReturnType<typeof useDatabaseByPage>["data"]>; embedded: boolean; membersList: Member[] }) {
  const canEdit = db.access >= 3;
  const actions = useDbActions(db.id);
  const { prompt } = useDialogs();
  const storageKey = `tw:view:${db.id}`;
  const [viewId, setViewId] = useState<string>(() => db.views[0]?.id);
  const view = db.views.find((v) => v.id === viewId) ?? db.views[0];
  const [config, setConfig] = useState<ViewConfig>(view?.config ?? {});
  const [search, setSearch] = useState("");
  const [propDialog, setPropDialog] = useState<{ open: boolean; property: Property | null }>({ open: false, property: null });
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- read browser storage after mount so server and client render the same HTML
      if (saved && db.views.some((v) => v.id === saved)) setViewId(saved);
    } catch {}
  }, [storageKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // eslint-disable-next-line react-hooks/set-state-in-effect -- the editable copy resets when another view is selected or the saved config changes
  useEffect(() => setConfig(view?.config ?? {}), [view?.id, view?.config]);

  const selectView = (id: string) => {
    setViewId(id);
    try { localStorage.setItem(storageKey, id); } catch {}
  };

  /** Changes apply immediately; editors also save them to the view (viewers keep them for this session). */
  const changeConfig = (c: ViewConfig) => {
    setConfig(c);
    if (!canEdit || !view) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => actions.updateView(view.id, { config: c }), 500);
  };

  const rows = useQuery({
    queryKey: ["rows", db.id, view?.id, search, config.filter, config.sorts],
    queryFn: () => api.post<{ rows: Row[]; total: number }>(`/databases/${db.id}/query`, { viewId: view?.id, search: search || undefined, filter: config.filter ?? { mode: "and", conditions: [] }, sorts: config.sorts ?? [] }),
    placeholderData: (p) => p,
  });
  const membersMap = useMemo(() => new Map(membersList.map((m) => [m.id, m])), [membersList]);

  const addView = async (type: View["type"]) => {
    const statusProp = db.properties.find((p) => p.type === "status" || p.type === "select");
    const dateProp = db.properties.find((p) => p.type === "date");
    const v = await actions.createView({ name: VIEW_LABELS[type], type, config: { groupBy: type === "board" ? statusProp?.id ?? null : null, dateProperty: type === "calendar" ? dateProp?.id ?? null : null } });
    if (v) selectView(v.id);
  };

  const props = {
    db, view: view!, config, rows: rows.data?.rows ?? [], members: membersMap, membersList, canEdit, actions,
    onConfig: changeConfig, onEditProperty: (p: Property | null) => setPropDialog({ open: true, property: p }),
  };

  return (
    <section aria-label={db.title || "Database"} className="min-w-0">
      {embedded && (
        <Link href={`/p/${db.pageId}`} className="mb-1 inline-flex items-center gap-1.5 text-lg font-semibold !no-underline hover:underline">
          <span>{db.icon ?? "🗃️"}</span>{db.title || "Untitled database"}
        </Link>
      )}
      <div className="mb-2 flex flex-wrap items-center gap-1 border-b pb-1">
        <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
          {db.views.map((v) => {
            const Icon = VIEW_ICONS[v.type];
            const active = v.id === view?.id;
            return (
              <div key={v.id} className={cn("group flex flex-none items-center rounded-md", active && "bg-accent")}>
                <button type="button" onClick={() => selectView(v.id)} className={cn("flex h-7 items-center gap-1.5 px-2 text-sm", active ? "font-medium" : "text-muted-foreground hover:text-foreground")}>
                  <Icon className="size-3.5" />{v.name}
                </button>
                {active && canEdit && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button type="button" aria-label="View options" className="mr-1 rounded p-0.5 hover:bg-background"><MoreHorizontal className="size-3.5" /></button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      <DropdownMenuItem onSelect={async () => { const name = await prompt({ title: "Rename view", initial: v.name }); if (name?.trim()) await actions.updateView(v.id, { name: name.trim() }); }}><Pencil className="size-4" /> Rename</DropdownMenuItem>
                      {db.views.length > 1 && <DropdownMenuItem variant="destructive" onSelect={async () => { if (await actions.deleteView(v)) selectView(db.views.find((x) => x.id !== v.id)!.id); }}><Trash2 className="size-4" /> Delete view</DropdownMenuItem>}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            );
          })}
          {canEdit && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="size-7 flex-none" aria-label="Add view"><Plus className="size-4" /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {(Object.keys(VIEW_LABELS) as View["type"][]).map((t) => {
                  const Icon = VIEW_ICONS[t];
                  return <DropdownMenuItem key={t} onSelect={() => addView(t)}><Icon className="size-4" /> {VIEW_LABELS[t]}</DropdownMenuItem>;
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-0.5">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1.5 size-3.5 text-muted-foreground" />
            <Input aria-label="Search this database" placeholder="Search" value={search} onChange={(e) => setSearch(e.target.value)} className="h-7 w-32 pl-7 text-sm focus:w-48" />
          </div>
          <FilterControl config={config} properties={db.properties} members={membersList} onChange={changeConfig} />
          <SortControl config={config} properties={db.properties} onChange={changeConfig} />
          {view?.type === "board" && <GroupControl config={config} properties={db.properties} onChange={changeConfig} />}
          <PropertiesControl config={config} properties={db.properties} onChange={changeConfig} canEdit={canEdit} onAddProperty={() => setPropDialog({ open: true, property: null })} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="size-7" aria-label="More database actions"><MoreHorizontal className="size-4" /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild><a href={`/api/databases/${db.id}/export`}><Download className="size-4" /> Export as CSV</a></DropdownMenuItem>
              {canEdit && <><DropdownMenuSeparator /><DropdownMenuItem onSelect={() => setPropDialog({ open: true, property: null })}><Plus className="size-4" /> New property</DropdownMenuItem></>}
            </DropdownMenuContent>
          </DropdownMenu>
          {canEdit && <Button size="sm" className="ml-1 h-7" onClick={() => actions.createRow()}>New</Button>}
        </div>
      </div>

      {rows.isError ? (
        <p className="py-4 text-sm text-destructive">Couldn&apos;t load rows. <button className="underline" onClick={() => rows.refetch()}>Retry</button></p>
      ) : rows.isLoading ? (
        <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
      ) : (
        <div className={cn(rows.isFetching && "opacity-80 transition-opacity")}>
          {view?.type === "board" ? <BoardView {...props} /> : view?.type === "calendar" ? <CalendarView {...props} /> : view?.type === "list" ? <ListView {...props} /> : <TableView {...props} />}
          {(rows.data?.rows.length ?? 0) === 0 && view?.type === "table" && (
            <p className="px-2 py-4 text-sm text-muted-foreground">
              {search || config.filter?.conditions.length ? "No rows match this view’s filters." : canEdit ? "No rows yet. Click New to add one." : "No rows yet."}
            </p>
          )}
          <p className="mt-1 px-1 text-xs text-muted-foreground">{rows.data?.rows.length ?? 0} of {rows.data?.total ?? 0}</p>
        </div>
      )}

      <PropertyDialog open={propDialog.open} onOpenChange={(o) => setPropDialog((s) => ({ ...s, open: o }))} db={db} property={propDialog.property} actions={actions} />
    </section>
  );
}
