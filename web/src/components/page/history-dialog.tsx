"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { useDialogs } from "@/components/dialogs";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import { toastError } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { ReadOnlyDoc } from "./read-only-doc";

type Version = { id: string; version: number; reason: string; createdAt: string; createdByName: string | null; title: string };
type Activity = { id: number; action: string; createdAt: string; actor: string | null };

const REASONS: Record<string, string> = {
  autosave: "Edited",
  "before-restore": "Before a restore",
  "overwritten-in-conflict": "Replaced in an edit conflict",
  "unsaved-copy-from-conflict": "Unsaved copy kept after a conflict",
};
const reasonLabel = (r: string) => REASONS[r] ?? (r.startsWith("restored-from-v") ? `Restored from version ${r.slice(15)}` : r);
const ACTIONS: Record<string, string> = {
  "page.created": "created the page", "page.edited": "edited", "page.moved": "moved the page", "page.duplicated": "duplicated the page",
  "page.archived": "archived the page", "page.unarchived": "unarchived the page", "page.trashed": "moved the page to the trash",
  "page.restored": "restored the page", "page.version_restored": "restored an earlier version", "comment.added": "commented", "row.created": "created the row",
};

export function HistoryDialog({ pageId, open, onOpenChange, canRestore, onRestored }: { pageId: string; open: boolean; onOpenChange: (o: boolean) => void; canRestore: boolean; onRestored: () => void }) {
  const { confirm } = useDialogs();
  const versions = useQuery({ queryKey: ["versions", pageId], queryFn: () => api.get<Version[]>(`/pages/${pageId}/versions`), enabled: open });
  const activity = useQuery({ queryKey: ["activity", pageId], queryFn: () => api.get<Activity[]>(`/pages/${pageId}/activity`), enabled: open });
  const [selected, setSelected] = useState<string | null>(null);
  const preview = useQuery({ queryKey: ["version", pageId, selected], queryFn: () => api.get<{ doc: unknown }>(`/pages/${pageId}/versions/${selected}`), enabled: Boolean(selected) });

  const restore = async (v: Version) => {
    const ok = await confirm({ title: `Restore the version from ${new Date(v.createdAt).toLocaleString()}?`, description: "Restoring creates a new version. The current content is kept in history, so you can undo this.", confirmLabel: "Restore" });
    if (!ok) return;
    try {
      await api.post(`/pages/${pageId}/versions/${v.id}/restore`);
      toast.success("Version restored");
      onRestored();
      onOpenChange(false);
    } catch (e) { toastError(e); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] sm:max-w-5xl">
        <DialogHeader><DialogTitle>Page history</DialogTitle></DialogHeader>
        <Tabs defaultValue="versions">
          <TabsList>
            <TabsTrigger value="versions">Versions</TabsTrigger>
            <TabsTrigger value="activity">Activity</TabsTrigger>
          </TabsList>
          <TabsContent value="versions" className="grid gap-4 md:grid-cols-[16rem_1fr]">
            <ul className="max-h-[60vh] space-y-0.5 overflow-y-auto">
              {(versions.data ?? []).map((v) => (
                <li key={v.id}>
                  <button type="button" onClick={() => setSelected(v.id)} className={cn("w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent", selected === v.id && "bg-accent")}>
                    <span className="block font-medium">{new Date(v.createdAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                    <span className="block text-xs text-muted-foreground">{v.createdByName ?? "Unknown"} · {reasonLabel(v.reason)}</span>
                  </button>
                </li>
              ))}
              {versions.data?.length === 0 && <li className="px-2 text-sm text-muted-foreground">No saved versions yet. Versions are kept as you edit (at most one every 10 minutes per person).</li>}
            </ul>
            <div className="max-h-[60vh] min-h-48 overflow-y-auto rounded-md border p-4">
              {!selected ? (
                <p className="text-sm text-muted-foreground">Select a version to preview it.</p>
              ) : preview.data ? (
                <>
                  <div className="mb-3 flex items-center justify-between gap-2 border-b pb-2">
                    <span className="text-xs text-muted-foreground">Read-only preview</span>
                    {canRestore && <Button size="sm" onClick={() => restore(versions.data!.find((v) => v.id === selected)!)}>Restore this version</Button>}
                  </div>
                  <ReadOnlyDoc doc={preview.data.doc} />
                </>
              ) : (
                <p className="text-sm text-muted-foreground">Loading…</p>
              )}
            </div>
          </TabsContent>
          <TabsContent value="activity">
            <ul className="max-h-[60vh] space-y-2 overflow-y-auto text-sm">
              {(activity.data ?? []).map((a) => (
                <li key={a.id}><span className="font-medium">{a.actor ?? "Someone"}</span> {ACTIONS[a.action] ?? a.action} <span className="text-muted-foreground">· {new Date(a.createdAt).toLocaleString()}</span></li>
              ))}
              {activity.data?.length === 0 && <li className="text-muted-foreground">No activity yet.</li>}
            </ul>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
