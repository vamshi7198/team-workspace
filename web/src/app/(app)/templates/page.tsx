"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { SimplePage } from "@/components/simple-page";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/components/workspace-context";
import { api } from "@/lib/api";
import { useCreatePage } from "@/lib/queries";

export default function TemplatesPage() {
  const { workspace } = useWorkspace();
  const router = useRouter();
  const createPage = useCreatePage();
  const templates = useQuery({ queryKey: ["templates", workspace.id], queryFn: () => api.get<{ id: string; title: string; icon: string | null }[]>(`/workspaces/${workspace.id}/templates`) });

  const use = async (templateId: string, section: "private" | "workspace") => {
    const r = await createPage.mutateAsync({ workspaceId: workspace.id, section: { type: section }, templateId, title: "" });
    router.push(`/p/${r.id}`);
  };
  const newTemplate = async () => {
    const r = await api.post<{ id: string }>("/pages", { workspaceId: workspace.id, isTemplate: true, title: "New template" });
    router.push(`/p/${r.id}`);
  };

  return (
    <SimplePage title="Templates" description="Start new pages from a shared structure. Anyone in the workspace can use and improve templates." actions={<Button size="sm" variant="outline" onClick={newTemplate}>New template</Button>}>
      <ul className="grid gap-3 sm:grid-cols-2">
        {(templates.data ?? []).map((t) => (
          <li key={t.id} className="flex flex-col rounded-xl border p-4">
            <Link href={`/p/${t.id}`} className="mb-3 flex items-center gap-2 font-medium hover:underline"><span className="text-2xl">{t.icon ?? "📄"}</span>{t.title || "Untitled"}</Link>
            <div className="mt-auto flex flex-wrap gap-2">
              <Button size="sm" onClick={() => use(t.id, "private")}>Use in Private</Button>
              <Button size="sm" variant="outline" onClick={() => use(t.id, "workspace")}>Use in Workspace</Button>
            </div>
          </li>
        ))}
      </ul>
      {templates.data?.length === 0 && <p className="text-sm text-muted-foreground">No templates yet.</p>}
    </SimplePage>
  );
}
