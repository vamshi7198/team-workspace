"use client";

import { useQuery } from "@tanstack/react-query";
import { CalendarDays, CheckSquare, Clock, FileText, Plus, Rocket, Star } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { SimplePage } from "@/components/simple-page";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useWorkspace } from "@/components/workspace-context";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/db-engine/format";
import type { DateValue, Row, SelectOption } from "@/lib/db-engine/types";
import { useCreatePage } from "@/lib/queries";

type Link_ = { id: string; title: string; icon: string | null; kind?: string };
type Home = {
  recent: (Link_ & { visited_at: string })[];
  favorites: Link_[];
  projects: { pageId: string; rows: Row[]; statusId: string | null; progressId: string | null; dueId: string | null; options: SelectOption[] } | null;
  myTasks: { pageId: string; rows: Row[]; statusId: string; dueId: string | null; options: SelectOption[] } | null;
  meetings: { pageId: string; rows: (Link_ & { updated_at: string })[] } | null;
};

function Card({ title, icon: Icon, href, children }: { title: string; icon: React.ComponentType<{ className?: string }>; href?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-medium">
        <Icon className="size-4 text-muted-foreground" />
        {href ? <Link href={href} className="hover:underline">{title}</Link> : title}
      </div>
      {children}
    </section>
  );
}

const Empty = ({ children }: { children: React.ReactNode }) => <p className="text-sm text-muted-foreground">{children}</p>;

export default function HomePage() {
  const { workspace, me } = useWorkspace();
  const router = useRouter();
  const createPage = useCreatePage();
  const home = useQuery({ queryKey: ["home", workspace.id], queryFn: () => api.get<Home>(`/workspaces/${workspace.id}/home`) });
  const today = new Date().toISOString().slice(0, 10);
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const d = home.data;

  return (
    <SimplePage
      title={`${greeting}, ${me.name.split(" ")[0]}`}
      description={workspace.name}
      actions={
        <Button size="sm" className="gap-1" onClick={async () => { const r = await createPage.mutateAsync({ workspaceId: workspace.id, section: { type: "private" } }); router.push(`/p/${r.id}`); }}>
          <Plus className="size-4" /> New page
        </Button>
      }
      wide
    >
      {home.isLoading ? (
        <div className="grid gap-4 md:grid-cols-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-48 rounded-xl" />)}</div>
      ) : home.isError ? (
        <p className="text-sm text-destructive">Couldn&apos;t load your home page. <button className="underline" onClick={() => home.refetch()}>Retry</button></p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <Card title="Recently visited" icon={Clock}>
            {d!.recent.length ? (
              <ul className="space-y-0.5">
                {d!.recent.map((p) => (
                  <li key={p.id}><Link href={`/p/${p.id}`} className="flex items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-accent"><span className="w-5 text-center">{p.icon ?? "📄"}</span><span className="truncate">{p.title || "Untitled"}</span></Link></li>
                ))}
              </ul>
            ) : <Empty>Pages you open will show up here.</Empty>}
          </Card>

          <Card title="My open tasks" icon={CheckSquare} href={d!.myTasks ? `/p/${d!.myTasks.pageId}` : undefined}>
            {d!.myTasks?.rows.length ? (
              <ul className="space-y-1">
                {d!.myTasks.rows.map((t) => {
                  const due = d!.myTasks!.dueId ? (t.values[d!.myTasks!.dueId] as DateValue | null) : null;
                  const status = d!.myTasks!.options.find((o) => o.id === t.values[d!.myTasks!.statusId]);
                  const overdue = due?.start && due.start.slice(0, 10) < today;
                  return (
                    <li key={t.id}>
                      <Link href={`/p/${t.id}`} className="flex items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-accent">
                        <span className="min-w-0 flex-1 truncate">{t.title || "Untitled"}</span>
                        {status && <span className={`tag tag-${status.color}`}>{status.name}</span>}
                        {due?.start && <span className={`text-xs ${overdue ? "font-medium text-red-600" : "text-muted-foreground"}`}>{formatDate(due)}</span>}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : <Empty>Nothing assigned to you. Nice.</Empty>}
          </Card>

          <Card title="Active projects" icon={Rocket} href={d!.projects ? `/p/${d!.projects.pageId}` : undefined}>
            {d!.projects?.rows.length ? (
              <ul className="space-y-1.5">
                {d!.projects.rows.map((pr) => {
                  const progress = d!.projects!.progressId ? (pr.values[d!.projects!.progressId] as number | null) : null;
                  const status = d!.projects!.options.find((o) => o.id === pr.values[d!.projects!.statusId ?? ""]);
                  return (
                    <li key={pr.id}>
                      <Link href={`/p/${pr.id}`} className="flex items-center gap-3 rounded px-1.5 py-1 text-sm hover:bg-accent">
                        <span className="min-w-0 flex-1 truncate">{pr.icon && <span className="mr-1">{pr.icon}</span>}{pr.title || "Untitled"}</span>
                        {status && <span className={`tag tag-${status.color}`}>{status.name}</span>}
                        <span className="flex w-24 items-center gap-1.5">
                          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"><span className="block h-full bg-green-600" style={{ width: `${progress ?? 0}%` }} /></span>
                          <span className="w-8 text-right text-xs tabular-nums text-muted-foreground">{progress ?? 0}%</span>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : <Empty>No active projects yet.</Empty>}
          </Card>

          <Card title="Recently edited meetings" icon={CalendarDays} href="/meetings">
            {d!.meetings?.rows.length ? (
              <ul className="space-y-0.5">
                {d!.meetings.rows.map((m) => (
                  <li key={m.id}><Link href={`/p/${m.id}`} className="flex items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-accent"><span className="w-5 text-center">{m.icon ?? "🗓️"}</span><span className="min-w-0 flex-1 truncate">{m.title || "Untitled"}</span><span className="text-xs text-muted-foreground">{new Date(m.updated_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span></Link></li>
                ))}
              </ul>
            ) : <Empty>No meeting notes yet.</Empty>}
          </Card>

          {d!.favorites.length > 0 && (
            <Card title="Favorites" icon={Star}>
              <ul className="grid gap-1 sm:grid-cols-2">
                {d!.favorites.map((f) => (
                  <li key={f.id}><Link href={`/p/${f.id}`} className="flex items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-accent"><span className="w-5 text-center">{f.icon ?? <FileText className="inline size-4" />}</span><span className="truncate">{f.title || "Untitled"}</span></Link></li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      )}
    </SimplePage>
  );
}
