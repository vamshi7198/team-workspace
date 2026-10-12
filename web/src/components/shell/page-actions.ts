"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useDialogs } from "@/components/dialogs";
import { api } from "@/lib/api";
import { toastError, useInvalidateStructure } from "@/lib/queries";

/** Page operations shared by the sidebar and the page header. */
export function usePageActions() {
  const router = useRouter();
  const qc = useQueryClient();
  const { confirm, prompt } = useDialogs();
  const invalidate = useInvalidateStructure();
  const refreshPage = (id: string) => qc.invalidateQueries({ queryKey: ["page", id] });

  const run = async <T,>(fn: () => Promise<T>, success?: string) => {
    try {
      const r = await fn();
      if (success) toast.success(success);
      invalidate();
      return r;
    } catch (e) {
      toastError(e);
      return undefined;
    }
  };

  return {
    rename: async (id: string, current: string) => {
      const title = await prompt({ title: "Rename page", initial: current, confirmLabel: "Rename" });
      if (title === null) return;
      await run(() => api.patch(`/pages/${id}`, { title: title.trim() }));
      refreshPage(id);
    },
    setIcon: async (id: string, icon: string | null) => {
      await run(() => api.patch(`/pages/${id}`, { icon }));
      refreshPage(id);
    },
    favorite: async (id: string, on: boolean) => {
      await run(() => api.post(`/pages/${id}/favorite`, { on }), on ? "Added to favorites" : "Removed from favorites");
      refreshPage(id);
    },
    duplicate: async (id: string) => {
      const r = await run(() => api.post<{ id: string }>(`/pages/${id}/duplicate`), "Page duplicated");
      if (r) router.push(`/p/${r.id}`);
    },
    copyLink: async (id: string) => {
      await navigator.clipboard.writeText(`${window.location.origin}/p/${id}`);
      toast.success("Link copied. Only people with access can open it.");
    },
    archive: async (id: string, archived: boolean) => {
      await run(() => api.post(`/pages/${id}/archive`, { archived }), archived ? "Page archived. Find it in Settings → Archive." : "Page restored from archive");
      refreshPage(id);
    },
    trash: async (id: string, title: string, currentPath?: string) => {
      const ok = await confirm({
        title: `Move “${title || "Untitled"}” to the trash?`,
        description: "Sub-pages go with it. You can restore it from the trash for 30 days.",
        confirmLabel: "Move to trash",
        destructive: true,
      });
      if (!ok) return false;
      const done = await run(() => api.delete(`/pages/${id}`), "Moved to trash");
      if (done !== undefined && currentPath?.includes(id)) router.push("/");
      return done !== undefined;
    },
    move: async (id: string, target: { parentId?: string | null; section?: { type: string; teamspaceId?: string }; afterId?: string | null; beforeId?: string | null }) => {
      await run(() => api.post(`/pages/${id}/move`, target));
      refreshPage(id);
    },
  };
}
