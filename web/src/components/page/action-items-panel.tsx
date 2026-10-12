"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, CheckCircle2, ListTodo } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useWorkspace } from "@/components/workspace-context";
import { api } from "@/lib/api";
import { toastError, useMembers } from "@/lib/queries";

type Item = { blockId: string; text: string; checked: boolean; task: { id: string; title: string; statusName: string | null; done: boolean } | null };

/** Meeting action items (to-dos under an "Action items" heading) and conversion to Tasks. */
export function ActionItemsPanel({ pageId, canEdit, flush }: { pageId: string; canEdit: boolean; flush: () => Promise<void> }) {
  const { workspace } = useWorkspace();
  const qc = useQueryClient();
  const members = useMembers(workspace.id);
  const items = useQuery({ queryKey: ["action-items", pageId], queryFn: () => api.get<Item[]>(`/pages/${pageId}/action-items`), refetchInterval: 15_000 });
  const [owners, setOwners] = useState<Record<string, string>>({});
  const [dues, setDues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const convert = async (list: Item[]) => {
    setBusy(true);
    try {
      await flush(); // make sure the server has the latest notes
      const res = await api.post<{ blockId: string; taskId: string; created: boolean }[]>(`/pages/${pageId}/action-items`, {
        items: list.map((i) => ({ blockId: i.blockId, assigneeId: owners[i.blockId] || null, due: dues[i.blockId] || null })),
      });
      const created = res.filter((r) => r.created).length;
      toast.success(created ? `Created ${created} task${created > 1 ? "s" : ""}` : "These items already have tasks");
      qc.invalidateQueries({ queryKey: ["action-items", pageId] });
      qc.invalidateQueries({ queryKey: ["rows"] });
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };

  const list = items.data ?? [];
  const pending = list.filter((i) => !i.task);
  return (
    <section className="mb-6 rounded-lg border bg-muted/20 p-3" aria-label="Action items">
      <div className="mb-2 flex items-center gap-2">
        <ListTodo className="size-4" />
        <h2 className="text-sm font-semibold">Action items</h2>
        <span className="text-xs text-muted-foreground">To-dos under an “Action items” heading can become tasks.</span>
        {canEdit && pending.length > 1 && <Button size="sm" variant="outline" className="ml-auto h-7" disabled={busy} onClick={() => convert(pending)}>Create all tasks</Button>}
      </div>
      {list.length === 0 ? (
        <p className="text-sm text-muted-foreground">No action items yet. Add to-dos under the Action items heading below.</p>
      ) : (
        <ul className="space-y-1.5">
          {list.map((i) => (
            <li key={i.blockId} className="flex flex-wrap items-center gap-2 text-sm">
              <span className={`min-w-0 flex-1 truncate ${i.checked ? "text-muted-foreground line-through" : ""}`}>{i.text}</span>
              {i.task ? (
                <Link href={`/p/${i.task.id}`} className="inline-flex items-center gap-1 rounded border bg-background px-2 py-0.5 text-xs hover:bg-accent">
                  {i.task.done ? <CheckCircle2 className="size-3.5 text-green-600" /> : <ArrowRight className="size-3.5" />}
                  Task{i.task.statusName ? ` · ${i.task.statusName}` : ""}
                </Link>
              ) : canEdit ? (
                <>
                  <select aria-label="Owner" className="h-7 rounded-md border bg-background px-1 text-xs" value={owners[i.blockId] ?? ""} onChange={(e) => setOwners({ ...owners, [i.blockId]: e.target.value })}>
                    <option value="">Owner…</option>
                    {(members.data ?? []).filter((m) => !m.disabledAt).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                  <Input aria-label="Due date" type="date" className="h-7 w-36 text-xs" value={dues[i.blockId] ?? ""} onChange={(e) => setDues({ ...dues, [i.blockId]: e.target.value })} />
                  <Button size="sm" variant="secondary" className="h-7" disabled={busy} onClick={() => convert([i])}>Create task</Button>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
