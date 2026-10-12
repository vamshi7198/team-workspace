"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useDialogs } from "@/components/dialogs";
import { api } from "@/lib/api";
import { OPTION_COLORS, type Property, type PropertyConfig, type SelectOption, type View, type ViewConfig } from "@/lib/db-engine/types";
import { toastError, useInvalidateStructure } from "@/lib/queries";

/** Mutations for a database; every call refreshes affected queries (rows of related databases too). */
export function useDbActions(databaseId: string) {
  const qc = useQueryClient();
  const { confirm } = useDialogs();
  const invalidateStructure = useInvalidateStructure();
  const refreshRows = () => {
    qc.invalidateQueries({ queryKey: ["rows"] }); // rollups/relations can change other databases' rows
    qc.invalidateQueries({ queryKey: ["row"] });
  };
  const refreshMeta = () => {
    qc.invalidateQueries({ queryKey: ["db", databaseId] });
    qc.invalidateQueries({ queryKey: ["db-by-page"] });
    qc.invalidateQueries({ queryKey: ["row"] });
  };
  const guard = async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    try { return await fn(); } catch (e) { toastError(e); return undefined; }
  };

  return {
    setValue: (rowId: string, propertyId: string, value: unknown) =>
      guard(async () => { await api.patch(`/rows/${rowId}`, { values: { [propertyId]: value } }); refreshRows(); }),
    setTitle: (rowId: string, title: string) =>
      guard(async () => { await api.patch(`/rows/${rowId}`, { title }); refreshRows(); invalidateStructure(); qc.invalidateQueries({ queryKey: ["page", rowId] }); }),
    createRow: (input: { title?: string; values?: Record<string, unknown> } = {}) =>
      guard(async () => { const r = await api.post<{ id: string }>(`/databases/${databaseId}/rows`, input); refreshRows(); return r.id; }),
    moveRow: (rowId: string, input: { afterId?: string | null; beforeId?: string | null; values?: Record<string, unknown> }) =>
      guard(async () => { await api.post(`/rows/${rowId}/move`, input); refreshRows(); }),
    deleteRow: async (rowId: string, title: string) => {
      const ok = await confirm({ title: `Delete “${title || "Untitled"}”?`, description: "It moves to the trash and can be restored for 30 days.", confirmLabel: "Delete", destructive: true });
      if (!ok) return false;
      await guard(async () => { await api.delete(`/pages/${rowId}`); refreshRows(); });
      return true;
    },
    addOption: async (prop: Property, name: string): Promise<SelectOption | null> => {
      const option: SelectOption = { id: crypto.randomUUID(), name, color: OPTION_COLORS[(prop.config.options?.length ?? 0) % OPTION_COLORS.length], ...(prop.type === "status" ? { group: "todo" as const } : {}) };
      const done = await guard(async () => { await api.patch(`/properties/${prop.id}`, { config: { options: [...(prop.config.options ?? []), option] } }); refreshMeta(); return true; });
      return done ? option : null;
    },
    addProperty: (input: { name: string; type: Property["type"]; config?: PropertyConfig; twoWay?: boolean; reverseName?: string }) =>
      guard(async () => { const p = await api.post<Property>(`/databases/${databaseId}/properties`, input); refreshMeta(); refreshRows(); return p; }),
    updateProperty: (id: string, patch: { name?: string; config?: PropertyConfig }) =>
      guard(async () => { await api.patch(`/properties/${id}`, patch); refreshMeta(); refreshRows(); }),
    deleteProperty: async (prop: Property) => {
      const ok = await confirm({ title: `Delete the “${prop.name}” property?`, description: "Its values are removed from every row. This can't be undone.", confirmLabel: "Delete property", destructive: true });
      if (!ok) return;
      await guard(async () => { await api.delete(`/properties/${prop.id}`); refreshMeta(); refreshRows(); });
    },
    createView: (input: { name: string; type: View["type"]; config?: ViewConfig }) =>
      guard(async () => { const v = await api.post<View>(`/databases/${databaseId}/views`, input); refreshMeta(); return v; }),
    updateView: (id: string, patch: { name?: string; config?: ViewConfig }) =>
      guard(async () => { await api.patch(`/views/${id}`, patch); refreshMeta(); }),
    deleteView: async (view: View) => {
      const ok = await confirm({ title: `Delete the “${view.name}” view?`, description: "Only the view is deleted; rows are not affected.", confirmLabel: "Delete view", destructive: true });
      if (!ok) return false;
      await guard(async () => { await api.delete(`/views/${view.id}`); refreshMeta(); });
      return true;
    },
  };
}
