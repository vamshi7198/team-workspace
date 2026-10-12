"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DatabaseView } from "@/components/database/database-view";
import { SimplePage } from "@/components/simple-page";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useWorkspace } from "@/components/workspace-context";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/db-engine/format";
import { toastError } from "@/lib/queries";

type Hub = {
  meetingsPageId: string | null;
  decisions: { meetingId: string; meetingTitle: string; date: string | null; text: string }[];
  actionItems: { meetingId: string; meetingTitle: string; date: string | null; blockId: string; text: string; task: { id: string; statusName: string | null } | null }[];
};

export default function MeetingsPage() {
  const { workspace } = useWorkspace();
  const router = useRouter();
  const hub = useQuery({ queryKey: ["meetings-hub", workspace.id], queryFn: () => api.get<Hub>(`/workspaces/${workspace.id}/meetings`) });
  const meetingsDb = useQuery({
    queryKey: ["meetings-db", hub.data?.meetingsPageId],
    queryFn: () => api.get<{ id: string }>(`/databases/by-page/${hub.data!.meetingsPageId}`),
    enabled: Boolean(hub.data?.meetingsPageId),
  });

  const newMeeting = async () => {
    if (!meetingsDb.data) return;
    try {
      const today = new Date();
      const pad = (n: number) => String(n).padStart(2, "0");
      const props = await api.get<{ properties: { id: string; systemKey?: string | null }[] }>(`/databases/${meetingsDb.data.id}`);
      const dateProp = props.properties.find((p) => p.systemKey === "date");
      const r = await api.post<{ id: string }>(`/databases/${meetingsDb.data.id}/rows`, {
        title: `Meeting ${today.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`,
        values: dateProp ? { [dateProp.id]: { start: `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}T${pad(today.getHours())}:00` } } : {},
      });
      router.push(`/p/${r.id}`);
    } catch (e) { toastError(e); }
  };

  return (
    <SimplePage title="Meetings" description="Notes, decisions and action items from every meeting you can see." actions={meetingsDb.data && <Button size="sm" onClick={newMeeting}>New meeting</Button>} wide>
      <Tabs defaultValue="meetings">
        <TabsList>
          <TabsTrigger value="meetings">Meetings</TabsTrigger>
          <TabsTrigger value="actions">Open action items {hub.data ? `(${hub.data.actionItems.length})` : ""}</TabsTrigger>
          <TabsTrigger value="decisions">Decisions</TabsTrigger>
        </TabsList>
        <TabsContent value="meetings" className="pt-3">
          {hub.data?.meetingsPageId ? <DatabaseView pageId={hub.data.meetingsPageId} /> : hub.isLoading ? null : <p className="text-sm text-muted-foreground">The Meetings database isn&apos;t available to you.</p>}
        </TabsContent>
        <TabsContent value="actions" className="pt-3">
          {hub.data?.actionItems.length ? (
            <ul className="divide-y rounded-lg border">
              {hub.data.actionItems.map((a) => (
                <li key={`${a.meetingId}-${a.blockId}`} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                  <span className="min-w-0 flex-1">{a.text}</span>
                  {a.task ? <Link href={`/p/${a.task.id}`} className="tag tag-blue">Task{a.task.statusName ? ` · ${a.task.statusName}` : ""}</Link> : <span className="tag tag-gray">No task yet</span>}
                  <Link href={`/p/${a.meetingId}`} className="text-xs text-muted-foreground hover:underline">{a.meetingTitle || "Untitled"}{a.date ? ` · ${formatDate(a.date.slice(0, 10))}` : ""}</Link>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-muted-foreground">No open action items.</p>}
        </TabsContent>
        <TabsContent value="decisions" className="pt-3">
          {hub.data?.decisions.length ? (
            <ul className="divide-y rounded-lg border">
              {hub.data.decisions.map((d, i) => (
                <li key={i} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                  <span className="min-w-0 flex-1">⚖️ {d.text}</span>
                  <Link href={`/p/${d.meetingId}`} className="text-xs text-muted-foreground hover:underline">{d.meetingTitle || "Untitled"}{d.date ? ` · ${formatDate(d.date.slice(0, 10))}` : ""}</Link>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-muted-foreground">No decisions recorded. Add bullets under a “Decisions” heading in meeting notes.</p>}
        </TabsContent>
      </Tabs>
    </SimplePage>
  );
}
