"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, MoreHorizontal, RotateCcw, Trash2 } from "lucide-react";
import { useState } from "react";
import { useDialogs } from "@/components/dialogs";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { useWorkspace } from "@/components/workspace-context";
import { api } from "@/lib/api";
import { toastError } from "@/lib/queries";

type Comment = { id: string; parentId: string | null; body: string; resolvedAt: string | null; createdAt: string; authorId: string | null; authorName: string | null };

export function CommentsPanel({ pageId, open, onOpenChange, canComment }: { pageId: string; open: boolean; onOpenChange: (o: boolean) => void; canComment: boolean }) {
  const { me } = useWorkspace();
  const qc = useQueryClient();
  const { confirm } = useDialogs();
  const comments = useQuery({ queryKey: ["comments", pageId], queryFn: () => api.get<Comment[]>(`/pages/${pageId}/comments`), enabled: open });
  const [body, setBody] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [showResolved, setShowResolved] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ["comments", pageId] });

  const post = async () => {
    if (!body.trim()) return;
    try {
      await api.post(`/pages/${pageId}/comments`, { body, parentId: replyTo });
      setBody("");
      setReplyTo(null);
      refresh();
    } catch (e) { toastError(e); }
  };

  const all = comments.data ?? [];
  const threads = all.filter((c) => !c.parentId && (showResolved || !c.resolvedAt));
  const replies = (id: string) => all.filter((c) => c.parentId === id);

  const CommentItem = ({ c }: { c: Comment }) => (
    <div className="group">
      <div className="flex items-center gap-2 text-xs">
        <span className="flex size-6 items-center justify-center rounded-full bg-muted font-semibold">{(c.authorName ?? "?").slice(0, 1)}</span>
        <span className="font-medium">{c.authorName ?? "Former member"}</span>
        <span className="text-muted-foreground">{new Date(c.createdAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
        {(c.authorId === me.id || !c.parentId) && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" aria-label="Comment actions" className="ml-auto rounded p-0.5 opacity-0 hover:bg-accent group-hover:opacity-100"><MoreHorizontal className="size-3.5" /></button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {!c.parentId && canComment && (
                <DropdownMenuItem onSelect={async () => { try { await api.patch(`/comments/${c.id}`, { resolved: !c.resolvedAt }); refresh(); } catch (e) { toastError(e); } }}>
                  {c.resolvedAt ? <><RotateCcw className="size-4" /> Re-open</> : <><Check className="size-4" /> Resolve</>}
                </DropdownMenuItem>
              )}
              {c.authorId === me.id && (
                <DropdownMenuItem variant="destructive" onSelect={async () => {
                  if (!(await confirm({ title: "Delete this comment?", confirmLabel: "Delete", destructive: true }))) return;
                  try { await api.delete(`/comments/${c.id}`); refresh(); } catch (e) { toastError(e); }
                }}><Trash2 className="size-4" /> Delete</DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <p className="mt-1 whitespace-pre-wrap break-words pl-8 text-sm">{c.body}</p>
    </div>
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b">
          <SheetTitle>Comments</SheetTitle>
          <label className="flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} /> Show resolved</label>
        </SheetHeader>
        <div className="flex-1 space-y-5 overflow-y-auto p-4">
          {comments.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {!comments.isLoading && threads.length === 0 && <p className="text-sm text-muted-foreground">No comments yet.</p>}
          {threads.map((t) => (
            <div key={t.id} className={`space-y-3 rounded-lg border p-3 ${t.resolvedAt ? "opacity-60" : ""}`}>
              <CommentItem c={t} />
              {replies(t.id).map((r) => <div key={r.id} className="border-l-2 pl-3"><CommentItem c={r} /></div>)}
              {canComment && !t.resolvedAt && <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setReplyTo(t.id)}>Reply</button>}
            </div>
          ))}
        </div>
        {canComment ? (
          <div className="space-y-2 border-t p-3">
            {replyTo && <p className="text-xs text-muted-foreground">Replying to a thread · <button className="underline" onClick={() => setReplyTo(null)}>cancel</button></p>}
            <Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Add a comment…" rows={3} onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void post(); }} />
            <div className="flex justify-end"><Button size="sm" disabled={!body.trim()} onClick={post}>Comment</Button></div>
          </div>
        ) : (
          <p className="border-t p-3 text-xs text-muted-foreground">You can view comments but not add them on this page.</p>
        )}
      </SheetContent>
    </Sheet>
  );
}
