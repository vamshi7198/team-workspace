"use client";

import { createContext, useContext } from "react";

export type WorkspaceSummary = { id: string; name: string; icon: string | null; role: "admin" | "member" };
export type Me = { id: string; name: string; email: string };

type Value = { me: Me; workspace: WorkspaceSummary; workspaces: WorkspaceSummary[] };
const Ctx = createContext<Value | null>(null);

export function WorkspaceProvider({ value, children }: { value: Value; children: React.ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWorkspace() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useWorkspace must be used inside the app shell");
  return v;
}

export function switchWorkspace(id: string) {
  document.cookie = `tw_ws=${id}; path=/; max-age=31536000; samesite=lax`;
  window.location.href = "/";
}
