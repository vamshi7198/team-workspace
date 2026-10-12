"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { Property, Row, View } from "@/lib/db-engine/types";
import { api, ApiError } from "./api";

export type TreeNode = {
  id: string;
  parentId: string | null;
  kind: "page" | "database";
  title: string;
  icon: string | null;
  sortKey: string;
  teamspaceId: string | null;
  generalAccess: string;
  ownerId: string | null;
  access: number;
};
export type PageLink = { id: string; title: string; icon: string | null; kind?: string };
export type Member = { id: string; name: string; email: string; role: "admin" | "member"; disabledAt: string | null; image: string | null };
export type Teamspace = { id: string; name: string; icon: string | null; is_member: boolean; member_count: number };

export type PageData = {
  page: {
    id: string;
    workspaceId: string;
    parentId: string | null;
    kind: "page" | "database" | "row";
    title: string;
    icon: string | null;
    coverFileId: string | null;
    databaseId: string | null;
    isTemplate: boolean;
    archivedAt: string | null;
    createdAt: string;
    updatedAt: string;
    createdByName: string | null;
    generalAccess: string;
  };
  access: number;
  doc: unknown;
  version: number;
  contentUpdatedAt: string;
  contentUpdatedByName: string | null;
  breadcrumbs: PageLink[];
  favorite: boolean;
  shared: boolean;
};

export type DatabaseMeta = {
  id: string;
  pageId: string;
  title: string;
  icon: string | null;
  systemKey: string | null;
  access: number;
  properties: Property[];
  views: View[];
  relatedDatabases: { id: string; pageId: string; title: string }[];
};

export const qk = {
  tree: (ws: string) => ["tree", ws] as const,
  favorites: (ws: string) => ["favorites", ws] as const,
  page: (id: string) => ["page", id] as const,
  db: (id: string) => ["db", id] as const,
  rows: (dbId: string) => ["rows", dbId] as const,
  members: (ws: string) => ["members", ws] as const,
  teamspaces: (ws: string) => ["teamspaces", ws] as const,
};

export function toastError(err: unknown) {
  toast.error(err instanceof ApiError || err instanceof Error ? err.message : "Something went wrong");
}

export const useTree = (ws: string) => useQuery({ queryKey: qk.tree(ws), queryFn: () => api.get<TreeNode[]>(`/workspaces/${ws}/tree`) });
export const useFavorites = (ws: string) => useQuery({ queryKey: qk.favorites(ws), queryFn: () => api.get<PageLink[]>(`/workspaces/${ws}/favorites`) });
export const useMembers = (ws: string) => useQuery({ queryKey: qk.members(ws), queryFn: () => api.get<Member[]>(`/workspaces/${ws}/members`), staleTime: 60_000 });
export const useTeamspaces = (ws: string) => useQuery({ queryKey: qk.teamspaces(ws), queryFn: () => api.get<Teamspace[]>(`/workspaces/${ws}/teamspaces`), staleTime: 60_000 });
export const usePage = (id: string) => useQuery({ queryKey: qk.page(id), queryFn: () => api.get<PageData>(`/pages/${id}`), staleTime: 0 });
export const useDatabase = (id: string | null | undefined) =>
  useQuery({ queryKey: qk.db(id ?? ""), queryFn: () => api.get<DatabaseMeta>(`/databases/${id}`), enabled: Boolean(id) });
export const useDatabaseByPage = (pageId: string | null | undefined) =>
  useQuery({ queryKey: ["db-by-page", pageId], queryFn: () => api.get<DatabaseMeta>(`/databases/by-page/${pageId}`), enabled: Boolean(pageId) });

export function useRows(dbId: string, viewId: string | undefined, search: string) {
  return useQuery({
    queryKey: [...qk.rows(dbId), viewId, search],
    queryFn: () => api.post<{ rows: Row[]; total: number }>(`/databases/${dbId}/query`, { viewId, search: search || undefined }),
    enabled: Boolean(dbId),
    placeholderData: (prev) => prev,
  });
}

/** Invalidate everything that shows page titles/structure. */
export function useInvalidateStructure() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["tree"] });
    qc.invalidateQueries({ queryKey: ["favorites"] });
  };
}

export function useCreatePage() {
  const invalidate = useInvalidateStructure();
  return useMutation({
    mutationFn: (input: { workspaceId: string; parentId?: string | null; section?: { type: string; teamspaceId?: string }; title?: string; templateId?: string | null }) =>
      api.post<{ id: string }>("/pages", input),
    onSuccess: invalidate,
    onError: toastError,
  });
}
