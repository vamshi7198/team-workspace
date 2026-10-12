"use client";

import { AlertTriangle, Check, CloudOff, Loader2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { nodeText, type Doc } from "@/lib/doc";
import type { Conflict, SaveStatus } from "./use-autosave";

export function SaveIndicator({ status, lastSavedAt, others, editable }: { status: SaveStatus; lastSavedAt: Date | null; others: { id: string; name: string; editing: boolean }[]; editable: boolean }) {
  return (
    <div className="flex items-center gap-2 rounded-md bg-background/80 px-2 py-1 text-xs text-muted-foreground backdrop-blur">
      {others.length > 0 && (
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex -space-x-1.5" aria-label={`Also here: ${others.map((o) => o.name).join(", ")}`}>
              {others.slice(0, 4).map((o) => (
                <span key={o.id} className={`flex size-5 items-center justify-center rounded-full border-2 border-background text-[10px] font-semibold text-white ${o.editing ? "bg-orange-500" : "bg-blue-500"}`}>
                  {o.name.slice(0, 1).toUpperCase()}
                </span>
              ))}
            </div>
          </TooltipTrigger>
          <TooltipContent>
            {others.map((o) => `${o.name}${o.editing ? " (editing)" : " (viewing)"}`).join(", ")}
            <br />Simultaneous editing isn&apos;t live yet. If you both edit, you&apos;ll be asked which version to keep.
          </TooltipContent>
        </Tooltip>
      )}
      {!editable ? (
        <span>View only</span>
      ) : status === "saving" ? (
        <span className="flex items-center gap-1"><Loader2 className="size-3 animate-spin" /> Saving…</span>
      ) : status === "dirty" ? (
        <span>Unsaved changes</span>
      ) : status === "error" ? (
        <span className="flex items-center gap-1 text-destructive"><CloudOff className="size-3" /> Not saved. Retrying (kept on this device)</span>
      ) : status === "conflict" ? (
        <span className="flex items-center gap-1 text-amber-600"><AlertTriangle className="size-3" /> Needs your decision</span>
      ) : (
        <span className="flex items-center gap-1" title={lastSavedAt ? `Saved at ${lastSavedAt.toLocaleTimeString()}` : undefined}><Check className="size-3" /> Saved</span>
      )}
    </div>
  );
}

export function ConflictDialog({ conflict, onKeepMine, onTakeTheirs, getMine }: { conflict: Conflict | null; onKeepMine: () => Promise<void>; onTakeTheirs: () => Promise<void>; getMine: () => unknown }) {
  const [busy, setBusy] = useState(false);
  if (!conflict) return null;
  const theirs = nodeText(conflict.serverDoc as Doc);
  const mine = nodeText((getMine() ?? { type: "doc" }) as Doc);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try { await fn(); } finally { setBusy(false); }
  };
  return (
    <Dialog open>
      <DialogContent className="sm:max-w-3xl" showCloseButton={false} onInteractOutside={(e) => e.preventDefault()} onEscapeKeyDown={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{conflict.updatedByName ?? "Someone"} changed this page while you were editing</DialogTitle>
          <DialogDescription>
            Choose which version to keep. The other version is saved in Page history, so nothing is lost.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">Your version</p>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md border bg-muted/40 p-3 font-sans text-xs">{mine || "(empty)"}</pre>
          </div>
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">Their version · {new Date(conflict.updatedAt).toLocaleString()}</p>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md border bg-muted/40 p-3 font-sans text-xs">{theirs || "(empty)"}</pre>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => run(onTakeTheirs)}>Use their version</Button>
          <Button disabled={busy} onClick={() => run(onKeepMine)}>Keep my version</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
