"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Globe, Lock, UserPlus, Users } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useWorkspace } from "@/components/workspace-context";
import { api } from "@/lib/api";
import { toastError, useMembers } from "@/lib/queries";

type Sharing = {
  myAccess: string;
  generalAccess: string;
  effectiveGeneralAccess: string;
  inheritedFrom: { id: string; title: string } | null;
  teamspaceId: string | null;
  owner: { id: string; name: string; email: string } | null;
  isRoot: boolean;
  grants: { userId: string; name: string; email: string; level: string; inherited: boolean }[];
};

const LEVELS: [string, string][] = [["full", "Full access"], ["edit", "Can edit"], ["comment", "Can comment"], ["view", "Can view"]];

export function ShareDialog({ pageId, kind, open, onOpenChange }: { pageId: string; kind: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { workspace } = useWorkspace();
  const qc = useQueryClient();
  const sharing = useQuery({ queryKey: ["sharing", pageId], queryFn: () => api.get<Sharing>(`/pages/${pageId}/sharing`), enabled: open });
  const members = useMembers(workspace.id);
  const [addUser, setAddUser] = useState("");
  const [addLevel, setAddLevel] = useState("edit");
  const s = sharing.data;
  const canManage = s?.myAccess === "full" && kind !== "row";
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["sharing", pageId] });
    qc.invalidateQueries({ queryKey: ["tree"] });
    qc.invalidateQueries({ queryKey: ["page", pageId] });
  };

  const setGeneral = async (value: string) => {
    try { await api.patch(`/pages/${pageId}/sharing`, { generalAccess: value }); refresh(); toast.success("Access updated"); } catch (e) { toastError(e); }
  };
  const setGrant = async (userId: string, level: string) => {
    try { await api.put(`/pages/${pageId}/sharing/${userId}`, { level }); refresh(); } catch (e) { toastError(e); }
  };

  const audience = s?.teamspaceId ? "Teamspace members" : "Everyone in the workspace";
  const grantedIds = new Set(s?.grants.filter((g) => !g.inherited).map((g) => g.userId));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Share</DialogTitle>
          <DialogDescription>Access is enforced on the server for the page, its sub-pages, search and attachments.</DialogDescription>
        </DialogHeader>
        {!s ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <div className="space-y-5 text-sm">
            {kind === "row" && <p className="rounded-md bg-muted px-3 py-2">Database rows use the access of their database. Share the database instead.</p>}
            <div className="flex items-start gap-3">
              <span className="mt-0.5">{s.effectiveGeneralAccess === "none" ? <Lock className="size-4" /> : s.teamspaceId ? <Users className="size-4" /> : <Globe className="size-4" />}</span>
              <div className="flex-1">
                <p className="font-medium">{audience}</p>
                <p className="text-xs text-muted-foreground">
                  {s.generalAccess === "inherit" && s.inheritedFrom ? `Same as “${s.inheritedFrom.title || "Untitled"}”` : "Set on this page"}
                </p>
              </div>
              <select
                aria-label="General access"
                disabled={!canManage}
                className="h-8 rounded-md border bg-background px-2"
                value={s.generalAccess}
                onChange={(e) => setGeneral(e.target.value)}
              >
                {!s.isRoot && <option value="inherit">Same as parent ({s.effectiveGeneralAccess === "none" ? "no access" : s.effectiveGeneralAccess})</option>}
                <option value="none">No access (restricted)</option>
                {LEVELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">People with access</p>
              {s.owner && (
                <div className="flex items-center gap-2">
                  <span className="flex size-7 items-center justify-center rounded-full bg-muted text-xs font-semibold">{s.owner.name.slice(0, 1)}</span>
                  <span className="flex-1">{s.owner.name} <span className="text-muted-foreground">· {s.owner.email}</span></span>
                  <span className="text-xs text-muted-foreground">Owner</span>
                </div>
              )}
              {s.grants.map((g) => (
                <div key={`${g.userId}-${g.inherited}`} className="flex items-center gap-2">
                  <span className="flex size-7 items-center justify-center rounded-full bg-muted text-xs font-semibold">{g.name.slice(0, 1)}</span>
                  <span className="flex-1">{g.name} <span className="text-muted-foreground">· {g.email}</span></span>
                  {g.inherited ? (
                    <span className="text-xs text-muted-foreground">{LEVELS.find(([v]) => v === g.level)?.[1]} (from a parent page)</span>
                  ) : (
                    <select aria-label={`Access for ${g.name}`} disabled={!canManage} className="h-8 rounded-md border bg-background px-2" value={g.level} onChange={(e) => setGrant(g.userId, e.target.value)}>
                      {LEVELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      <option value="none">Remove</option>
                    </select>
                  )}
                </div>
              ))}
            </div>

            {canManage && (
              <div className="flex flex-wrap items-center gap-2 border-t pt-4">
                <UserPlus className="size-4 text-muted-foreground" />
                <select aria-label="Person to invite" className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2" value={addUser} onChange={(e) => setAddUser(e.target.value)}>
                  <option value="">Add a person…</option>
                  {(members.data ?? []).filter((m) => !m.disabledAt && !grantedIds.has(m.id) && m.id !== s.owner?.id).map((m) => <option key={m.id} value={m.id}>{m.name} ({m.email})</option>)}
                </select>
                <select aria-label="Access level" className="h-8 rounded-md border bg-background px-2" value={addLevel} onChange={(e) => setAddLevel(e.target.value)}>
                  {LEVELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
                <Button size="sm" disabled={!addUser} onClick={async () => { await setGrant(addUser, addLevel); setAddUser(""); }}>Share</Button>
              </div>
            )}
            {!canManage && kind !== "row" && <p className="text-xs text-muted-foreground">Only people with full access can change sharing.</p>}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
