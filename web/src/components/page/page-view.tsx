"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive, ArchiveRestore, ChevronRight, Copy, Download, FileText, History, ImagePlus, Link2, MessageSquare, MoreHorizontal, MoveRight, Share2, SmilePlus, Star, Trash2,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { DatabaseView } from "@/components/database/database-view";
import { PropertyCell } from "@/components/database/property-cell";
import { useDbActions } from "@/components/database/use-db-actions";
import { DocEditor, type DocEditorHandle } from "@/components/editor/editor";
import { OPEN_COMMENTS_EVENT } from "@/components/editor/shortcuts";
import { EmojiPicker } from "@/components/emoji-picker";
import { useShell } from "@/components/shell/app-shell";
import { MoveDialog } from "@/components/shell/move-dialog";
import { usePageActions } from "@/components/shell/page-actions";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { useWorkspace } from "@/components/workspace-context";
import { api, ApiError, uploadFile } from "@/lib/api";
import type { Property, Row } from "@/lib/db-engine/types";
import { toastError, useCreatePage, useDatabase, useMembers, usePage, useInvalidateStructure, type PageData } from "@/lib/queries";
import { ActionItemsPanel } from "./action-items-panel";
import { CommentsPanel } from "./comments-panel";
import { HistoryDialog } from "./history-dialog";
import { ShareDialog } from "./share-dialog";

function TitleInput({ page, editable, onEnter }: { page: PageData["page"]; editable: boolean; onEnter: () => void }) {
  const [title, setTitle] = useState(page.title);
  const ref = useRef<HTMLTextAreaElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const qc = useQueryClient();
  const invalidate = useInvalidateStructure();
  const lastSent = useRef(page.title);

  useEffect(() => {
    // Accept server changes (e.g. someone else renamed) when we're not mid-edit.
    if (!timer.current && page.title !== lastSent.current) {
      setTitle(page.title);
      lastSent.current = page.title;
    }
  }, [page.title]);
  useEffect(() => {
    const el = ref.current;
    if (el) { el.style.height = "auto"; el.style.height = `${el.scrollHeight}px`; }
  }, [title]);

  const save = async (value: string) => {
    timer.current = null;
    if (value === lastSent.current) return;
    lastSent.current = value;
    try {
      await api.patch(`/pages/${page.id}`, { title: value });
      invalidate();
      qc.invalidateQueries({ queryKey: ["rows"] });
      document.title = `${value || "Untitled"} · Workspace`;
    } catch (e) { toastError(e); }
  };

  return (
    <textarea
      ref={ref}
      aria-label="Page title"
      rows={1}
      readOnly={!editable}
      value={title}
      placeholder="Untitled"
      maxLength={500}
      onChange={(e) => {
        const v = e.target.value.replace(/\n/g, "");
        setTitle(v);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => save(v), 500);
      }}
      onBlur={() => { if (timer.current) { clearTimeout(timer.current); void save(title); } }}
      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onEnter(); } }}
      className="w-full resize-none overflow-hidden bg-transparent text-3xl font-bold leading-tight tracking-tight outline-none placeholder:text-muted-foreground/40 sm:text-4xl"
    />
  );
}

function RowProperties({ rowId, canEdit }: { rowId: string; canEdit: boolean }) {
  const { workspace } = useWorkspace();
  const members = useMembers(workspace.id);
  const row = useQuery({ queryKey: ["row", rowId], queryFn: () => api.get<{ row: Row; properties: Property[]; access: number; database: { id: string; pageId: string; title: string } }>(`/rows/${rowId}`) });
  const actions = useDbActions(row.data?.database.id ?? "");
  const meta = useDatabase(row.data?.database.id);
  const qc = useQueryClient();
  if (!row.data) return <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-7 w-2/3" />)}</div>;
  const membersMap = new Map((members.data ?? []).map((m) => [m.id, m]));
  const props = row.data.properties.filter((p) => p.type !== "title");
  const after = () => qc.invalidateQueries({ queryKey: ["row", rowId] });
  return (
    <div className="mb-6 space-y-0.5 border-b pb-4">
      {props.map((p) => (
        <div key={p.id} className="flex items-start gap-2 text-sm">
          <div className="w-40 flex-none truncate py-1.5 text-muted-foreground" title={p.name}>{p.name}</div>
          <div className="min-w-0 flex-1 rounded hover:bg-accent/40">
            <PropertyCell
              prop={p}
              row={row.data.row}
              members={membersMap}
              membersList={members.data ?? []}
              canEdit={canEdit}
              compact
              onChange={async (v) => { await actions.setValue(rowId, p.id, v); after(); }}
              addOption={async (prop, name) => { const o = await actions.addOption(prop, name); after(); return o; }}
            />
          </div>
        </div>
      ))}
      {meta.data && <p className="pt-1 text-xs text-muted-foreground">In <Link href={`/p/${row.data.database.pageId}`} className="underline">{row.data.database.title || "Untitled database"}</Link></p>}
    </div>
  );
}

export function PageView({ id }: { id: string }) {
  const page = usePage(id);
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const { workspace } = useWorkspace();
  const actions = usePageActions();
  const createPage = useCreatePage();
  const { sidebarHidden } = useShell();
  const editorRef = useRef<DocEditorHandle>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(params.get("comments") === "1");
  // Ctrl+Alt+M / Ctrl+Shift+M in the editor opens the comments panel.
  useEffect(() => {
    const open = () => setCommentsOpen(true);
    window.addEventListener(OPEN_COMMENTS_EVENT, open);
    return () => window.removeEventListener(OPEN_COMMENTS_EVENT, open);
  }, []);
  const [moveOpen, setMoveOpen] = useState(false);
  const rowDb = useDatabase(page.data?.page.kind === "row" ? page.data.page.databaseId : null);
  const backlinks = useQuery({ queryKey: ["backlinks", id], queryFn: () => api.get<{ id: string; title: string; icon: string | null }[]>(`/pages/${id}/backlinks`), enabled: page.isSuccess });

  useEffect(() => {
    if (page.data) document.title = `${page.data.page.title || "Untitled"} · Workspace`;
  }, [page.data]);

  if (page.isLoading) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 px-6 pt-24">
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-5/6" /><Skeleton className="h-4 w-4/6" />
      </div>
    );
  }
  if (page.isError || !page.data) {
    const notFound = page.error instanceof ApiError && page.error.status === 404;
    return (
      <div className="mx-auto max-w-md px-6 pt-32 text-center">
        <FileText className="mx-auto mb-3 size-8 text-muted-foreground" />
        <h1 className="text-lg font-semibold">{notFound ? "Page not found" : "Couldn't load this page"}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{notFound ? "It may have been deleted, or you don't have access. Ask the owner to share it with you." : "Check your connection and try again."}</p>
        <div className="mt-4 flex justify-center gap-2">
          {!notFound && <Button variant="outline" onClick={() => page.refetch()}>Retry</Button>}
          <Button asChild variant="ghost"><Link href="/">Go home</Link></Button>
        </div>
      </div>
    );
  }

  const { page: p, access } = page.data;
  const canEdit = access >= 3;
  const isMeeting = p.kind === "row" && rowDb.data?.systemKey === "meetings";

  const setCover = async () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/png,image/jpeg,image/webp,image/gif";
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return;
      try {
        const up = await uploadFile(id, f);
        await api.patch(`/pages/${id}`, { coverFileId: up.id });
        qc.invalidateQueries({ queryKey: ["page", id] });
      } catch (e) { toastError(e); }
    };
    input.click();
  };

  const useTemplate = async () => {
    const r = await createPage.mutateAsync({ workspaceId: workspace.id, section: { type: "private" }, templateId: id, title: "" });
    toast.success("Page created from template in Private");
    router.push(`/p/${r.id}`);
  };

  return (
    <div className="min-h-full">
      {/* Top bar */}
      <header className={`sticky top-0 z-10 flex h-11 items-center gap-2 bg-background/90 px-3 pl-12 backdrop-blur ${sidebarHidden ? "md:pl-12" : "md:pl-3"}`}>
        <nav aria-label="Breadcrumb" className="flex min-w-0 flex-1 items-center gap-0.5 text-sm text-muted-foreground">
          {page.data.breadcrumbs.map((b) => (
            <span key={b.id} className="flex min-w-0 items-center gap-0.5">
              <Link href={`/p/${b.id}`} className="flex max-w-40 items-center gap-1 truncate rounded px-1 py-0.5 hover:bg-accent hover:text-foreground">
                {b.icon && <span>{b.icon}</span>}<span className="truncate">{b.title || "Untitled"}</span>
              </Link>
              <ChevronRight className="size-3.5 flex-none" />
            </span>
          ))}
          <span className="flex min-w-0 items-center gap-1 truncate px-1 text-foreground">{p.icon && <span>{p.icon}</span>}<span className="truncate">{p.title || "Untitled"}</span></span>
        </nav>
        <span className="hidden text-xs text-muted-foreground lg:block" title={new Date(p.updatedAt).toLocaleString()}>
          Edited {new Date(page.data.contentUpdatedAt > p.updatedAt ? page.data.contentUpdatedAt : p.updatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
          {page.data.contentUpdatedByName ? ` by ${page.data.contentUpdatedByName}` : ""}
        </span>
        <Button variant="ghost" size="sm" className="h-7 gap-1" onClick={() => setShareOpen(true)}><Share2 className="size-3.5" /><span className="hidden sm:inline">Share</span></Button>
        <Button variant="ghost" size="icon" className="size-7" aria-label="Comments" onClick={() => setCommentsOpen(true)}><MessageSquare className="size-4" /></Button>
        <Button variant="ghost" size="icon" className="size-7" aria-label={page.data.favorite ? "Remove from favorites" : "Add to favorites"} onClick={() => actions.favorite(id, !page.data!.favorite)}>
          <Star className={`size-4 ${page.data.favorite ? "fill-yellow-400 text-yellow-500" : ""}`} />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="size-7" aria-label="More page actions"><MoreHorizontal className="size-4" /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem onSelect={() => actions.copyLink(id)}><Link2 className="size-4" /> Copy link</DropdownMenuItem>
            {p.kind === "page" && <DropdownMenuItem onSelect={() => actions.duplicate(id)}><Copy className="size-4" /> Duplicate</DropdownMenuItem>}
            {canEdit && p.kind !== "row" && <DropdownMenuItem onSelect={() => setMoveOpen(true)}><MoveRight className="size-4" /> Move to…</DropdownMenuItem>}
            {p.kind !== "database" && <DropdownMenuItem onSelect={() => setHistoryOpen(true)}><History className="size-4" /> Page history</DropdownMenuItem>}
            {p.kind !== "database" && (
              <>
                <DropdownMenuItem asChild><a href={`/api/pages/${id}/export?format=md`}><Download className="size-4" /> Export Markdown</a></DropdownMenuItem>
                <DropdownMenuItem asChild><a href={`/api/pages/${id}/export?format=json`}><Download className="size-4" /> Export JSON</a></DropdownMenuItem>
              </>
            )}
            {canEdit && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => actions.archive(id, !p.archivedAt)}>{p.archivedAt ? <><ArchiveRestore className="size-4" /> Unarchive</> : <><Archive className="size-4" /> Archive</>}</DropdownMenuItem>
                <DropdownMenuItem variant="destructive" onSelect={async () => { if (await actions.trash(id, p.title)) router.push(p.parentId ? `/p/${p.parentId}` : "/"); }}><Trash2 className="size-4" /> Move to trash</DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      {p.coverFileId && (
        <div className="group relative h-44 w-full overflow-hidden bg-muted sm:h-56">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/api/files/${p.coverFileId}`} alt="" className="size-full object-cover" />
          {canEdit && (
            <div className="absolute bottom-2 right-3 hidden gap-1 group-hover:flex">
              <Button size="sm" variant="secondary" className="h-7" onClick={setCover}>Change cover</Button>
              <Button size="sm" variant="secondary" className="h-7" onClick={async () => { await api.patch(`/pages/${id}`, { coverFileId: null }); qc.invalidateQueries({ queryKey: ["page", id] }); }}>Remove</Button>
            </div>
          )}
        </div>
      )}

      <div className={`mx-auto px-6 pb-16 sm:px-12 ${p.kind === "database" ? "max-w-6xl" : "max-w-3xl"}`}>
        {p.archivedAt && (
          <div className="mt-4 flex items-center gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
            <Archive className="size-4" /> <span className="flex-1">This page is archived. It&apos;s hidden from the sidebar.</span>
            {canEdit && <Button size="sm" variant="outline" className="h-7" onClick={() => actions.archive(id, false)}>Unarchive</Button>}
          </div>
        )}
        {p.isTemplate && (
          <div className="mt-4 flex items-center gap-3 rounded-md border border-blue-500/40 bg-blue-500/10 px-3 py-2 text-sm">
            <span className="flex-1">This is a template. Edits change the template for everyone.</span>
            <Button size="sm" className="h-7" onClick={useTemplate}>Use this template</Button>
          </div>
        )}

        <div className={p.coverFileId ? "pt-4" : "pt-16"}>
          {p.icon ? (
            canEdit ? (
              <EmojiPicker value={p.icon} onChange={(v) => actions.setIcon(id, v)}>
                <button type="button" aria-label="Change icon" className="mb-2 rounded-md text-5xl leading-none hover:bg-accent">{p.icon}</button>
              </EmojiPicker>
            ) : <div className="mb-2 text-5xl leading-none">{p.icon}</div>
          ) : null}
          {canEdit && (
            <div className="mb-1 flex gap-1 text-muted-foreground opacity-60 hover:opacity-100">
              {!p.icon && (
                <EmojiPicker value={null} onChange={(v) => actions.setIcon(id, v)}>
                  <Button variant="ghost" size="sm" className="h-7 gap-1"><SmilePlus className="size-4" /> Add icon</Button>
                </EmojiPicker>
              )}
              {!p.coverFileId && <Button variant="ghost" size="sm" className="h-7 gap-1" onClick={setCover}><ImagePlus className="size-4" /> Add cover</Button>}
            </div>
          )}
          <TitleInput key={id} page={p} editable={canEdit} onEnter={() => (document.querySelector(".doc .ProseMirror") as HTMLElement | null)?.focus()} />
          {p.createdByName && <p className="mt-1 text-xs text-muted-foreground">Created by {p.createdByName} · {new Date(p.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</p>}
        </div>

        <div className="mt-6">
          {p.kind === "database" ? (
            <DatabaseView pageId={id} />
          ) : (
            <>
              {p.kind === "row" && <RowProperties rowId={id} canEdit={canEdit} />}
              {isMeeting && <ActionItemsPanel pageId={id} canEdit={canEdit} flush={() => editorRef.current?.flush() ?? Promise.resolve()} />}
              <DocEditor key={id} ref={editorRef} pageId={id} doc={page.data.doc} version={page.data.version} editable={canEdit} />
            </>
          )}
        </div>

        {(backlinks.data?.length ?? 0) > 0 && (
          <section className="mt-10 border-t pt-4" aria-label="Backlinks">
            <h2 className="mb-2 text-xs font-medium text-muted-foreground">Linked from {backlinks.data!.length} page{backlinks.data!.length > 1 ? "s" : ""}</h2>
            <ul className="space-y-0.5">
              {backlinks.data!.map((b) => (
                <li key={b.id}><Link href={`/p/${b.id}`} className="inline-flex items-center gap-1.5 rounded px-1 py-0.5 text-sm hover:bg-accent"><span>{b.icon ?? "📄"}</span>{b.title || "Untitled"}</Link></li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <ShareDialog pageId={id} kind={p.kind} open={shareOpen} onOpenChange={setShareOpen} />
      {historyOpen && <HistoryDialog pageId={id} open={historyOpen} onOpenChange={setHistoryOpen} canRestore={canEdit} onRestored={() => { void editorRef.current?.reload(); qc.invalidateQueries({ queryKey: ["page", id] }); }} />}
      <CommentsPanel pageId={id} open={commentsOpen} onOpenChange={setCommentsOpen} canComment={access >= 2} />
      {moveOpen && <MoveDialog pageId={id} open={moveOpen} onOpenChange={setMoveOpen} onPick={(t, label) => { void actions.move(id, t).then(() => toast.success(`Moved to ${label}`)); }} />}
    </div>
  );
}
