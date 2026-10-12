"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArchiveRestore, RotateCcw, Trash2 } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { useDialogs } from "@/components/dialogs";
import { SimplePage } from "@/components/simple-page";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useWorkspace } from "@/components/workspace-context";
import { api } from "@/lib/api";
import { toastError, useInvalidateStructure } from "@/lib/queries";

type Trashed = { id: string; title: string; icon: string | null; kind: string; deleted_at: string; access: number };
type Archived = { id: string; title: string; icon: string | null; archived_at: string };

export default function TrashPage() {
  const { workspace } = useWorkspace();
  const qc = useQueryClient();
  const { confirm } = useDialogs();
  const invalidate = useInvalidateStructure();
  const trash = useQuery({ queryKey: ["trash", workspace.id], queryFn: () => api.get<Trashed[]>(`/workspaces/${workspace.id}/trash`) });
  const archived = useQuery({ queryKey: ["archived", workspace.id], queryFn: () => api.get<Archived[]>(`/workspaces/${workspace.id}/archived`) });
  const refresh = () => { qc.invalidateQueries({ queryKey: ["trash"] }); qc.invalidateQueries({ queryKey: ["archived"] }); qc.invalidateQueries({ queryKey: ["rows"] }); invalidate(); };

  const restore = async (id: string) => {
    try { await api.post(`/pages/${id}/restore`); toast.success("Restored"); refresh(); } catch (e) { toastError(e); }
  };
  const purge = async (t: Trashed) => {
    if (!(await confirm({ title: `Permanently delete “${t.title || "Untitled"}”?`, description: "The page, its sub-pages and attachments are deleted for good. This can't be undone.", confirmLabel: "Delete forever", destructive: true }))) return;
    try { await api.delete(`/pages/${t.id}/purge`); toast.success("Deleted permanently"); refresh(); } catch (e) { toastError(e); }
  };
  const unarchive = async (id: string) => {
    try { await api.post(`/pages/${id}/archive`, { archived: false }); toast.success("Unarchived"); refresh(); } catch (e) { toastError(e); }
  };

  return (
    <SimplePage title="Trash & archive" description="Trashed pages are permanently deleted after 30 days.">
      <Tabs defaultValue="trash">
        <TabsList><TabsTrigger value="trash">Trash</TabsTrigger><TabsTrigger value="archive">Archive</TabsTrigger></TabsList>
        <TabsContent value="trash" className="pt-3">
          {trash.data?.length ? (
            <ul className="divide-y rounded-lg border">
              {trash.data.map((t) => (
                <li key={t.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                  <span className="w-5 text-center">{t.icon ?? "📄"}</span>
                  <span className="min-w-0 flex-1 truncate">{t.title || "Untitled"} <span className="text-xs text-muted-foreground">· deleted {new Date(t.deleted_at).toLocaleDateString()}</span></span>
                  <Button size="sm" variant="ghost" className="h-7 gap-1" onClick={() => restore(t.id)}><RotateCcw className="size-3.5" /> Restore</Button>
                  {t.access >= 4 && <Button size="sm" variant="ghost" className="h-7 gap-1 text-destructive" onClick={() => purge(t)}><Trash2 className="size-3.5" /> Delete forever</Button>}
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-muted-foreground">{trash.isLoading ? "Loading…" : "The trash is empty."}</p>}
        </TabsContent>
        <TabsContent value="archive" className="pt-3">
          {archived.data?.length ? (
            <ul className="divide-y rounded-lg border">
              {archived.data.map((a) => (
                <li key={a.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                  <span className="w-5 text-center">{a.icon ?? "📄"}</span>
                  <Link href={`/p/${a.id}`} className="min-w-0 flex-1 truncate hover:underline">{a.title || "Untitled"}</Link>
                  <Button size="sm" variant="ghost" className="h-7 gap-1" onClick={() => unarchive(a.id)}><ArchiveRestore className="size-3.5" /> Unarchive</Button>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-muted-foreground">{archived.isLoading ? "Loading…" : "No archived pages."}</p>}
        </TabsContent>
      </Tabs>
    </SimplePage>
  );
}
