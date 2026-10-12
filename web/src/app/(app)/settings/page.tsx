"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Download, LogOut, MoreHorizontal, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useDialogs } from "@/components/dialogs";
import { SimplePage } from "@/components/simple-page";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useWorkspace } from "@/components/workspace-context";
import { api } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { toastError, useMembers, useTeamspaces, type Member } from "@/lib/queries";
import { assignableRoles, canManage, isAdminRole, ROLE_LABELS, type InviteRole, type Role } from "@/lib/roles";

function CopyBox({ label, url }: { label: string; url: string }) {
  return (
    <div className="space-y-1 rounded-md border bg-muted/40 p-3 text-sm">
      <p className="font-medium">{label}</p>
      <div className="flex gap-2">
        <Input readOnly value={url} className="h-8 font-mono text-xs" onFocus={(e) => e.target.select()} />
        <Button size="sm" variant="outline" className="h-8 gap-1" onClick={() => { void navigator.clipboard.writeText(url); toast.success("Copied"); }}><Copy className="size-3.5" /> Copy</Button>
      </div>
      <p className="text-xs text-muted-foreground">Share it privately (e.g. WhatsApp or email). Anyone with this link can use it once.</p>
    </div>
  );
}

function AccountTab() {
  const { me } = useWorkspace();
  const [name, setName] = useState(me.name);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const sessions = useQuery({ queryKey: ["sessions"], queryFn: async () => (await authClient.listSessions()).data ?? [] });
  const currentSession = authClient.useSession();

  return (
    <div className="max-w-lg space-y-8">
      <form className="space-y-2" onSubmit={async (e) => {
        e.preventDefault();
        const { error } = await authClient.updateUser({ name: name.trim() });
        if (error) toast.error(error.message ?? "Could not update your name");
        else toast.success("Name updated. Reload to see it everywhere.");
      }}>
        <Label htmlFor="name">Name</Label>
        <div className="flex gap-2"><Input id="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} /><Button type="submit" variant="outline">Save</Button></div>
        <p className="text-xs text-muted-foreground">Email: {me.email}</p>
      </form>

      <form className="space-y-2" onSubmit={async (e) => {
        e.preventDefault();
        if (next.length < 10) return toast.error("Use at least 10 characters");
        const { error } = await authClient.changePassword({ currentPassword: current, newPassword: next, revokeOtherSessions: true });
        if (error) toast.error(error.status === 429 ? "Too many attempts, try again later" : error.message ?? "Could not change password");
        else { toast.success("Password changed. Other devices were signed out."); setCurrent(""); setNext(""); void sessions.refetch(); }
      }}>
        <p className="font-medium">Change password</p>
        <Input type="password" autoComplete="current-password" placeholder="Current password" value={current} onChange={(e) => setCurrent(e.target.value)} required aria-label="Current password" />
        <Input type="password" autoComplete="new-password" placeholder="New password (10+ characters)" value={next} onChange={(e) => setNext(e.target.value)} required minLength={10} aria-label="New password" />
        <Button type="submit" variant="outline">Change password</Button>
      </form>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="font-medium">Signed-in devices</p>
          <Button size="sm" variant="outline" onClick={async () => { await authClient.revokeOtherSessions(); toast.success("Signed out of other devices"); void sessions.refetch(); }}>Sign out other devices</Button>
        </div>
        <ul className="divide-y rounded-lg border text-sm">
          {(sessions.data ?? []).map((s) => (
            <li key={s.id} className="flex items-center gap-2 px-3 py-2">
              <span className="min-w-0 flex-1 truncate">{s.userAgent ?? "Unknown device"}<span className="block text-xs text-muted-foreground">{s.ipAddress ?? ""} · since {new Date(s.createdAt).toLocaleDateString()}</span></span>
              {s.token === currentSession.data?.session.token ? <span className="text-xs text-muted-foreground">This device</span> : (
                <Button size="sm" variant="ghost" className="h-7" onClick={async () => { await authClient.revokeSession({ token: s.token }); void sessions.refetch(); }}><LogOut className="size-3.5" /></Button>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function MembersTab() {
  const { workspace, me } = useWorkspace();
  const isAdmin = isAdminRole(workspace.role);
  const qc = useQueryClient();
  const { confirm } = useDialogs();
  const members = useMembers(workspace.id);
  const invites = useQuery({ queryKey: ["invites", workspace.id], queryFn: () => api.get<{ id: string; email: string; role: string; expiresAt: string }[]>(`/workspaces/${workspace.id}/invitations`), enabled: isAdmin });
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<InviteRole>("member");
  const setMemberRole = async (m: Member, next: Role) => {
    if (next === "owner" && !(await confirm({ title: `Make ${m.name} the owner?`, description: "Ownership moves to them and you become an admin. Only they can undo this.", confirmLabel: "Transfer ownership", destructive: true }))) return;
    try { await api.patch(`/workspaces/${workspace.id}/members/${m.id}`, { role: next }); toast.success(`${m.name} is now ${ROLE_LABELS[next].toLowerCase()}`); refresh(); if (next === "owner") window.location.reload(); } catch (e) { toastError(e); }
  };
  const [link, setLink] = useState<{ label: string; url: string } | null>(null);
  const refresh = () => { qc.invalidateQueries({ queryKey: ["members"] }); qc.invalidateQueries({ queryKey: ["invites"] }); };

  const invite = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const r = await api.post<{ url: string; emailed: boolean; email: string }>(`/workspaces/${workspace.id}/invitations`, { email, role });
      toast.success(r.emailed ? `Invitation emailed to ${r.email}` : "Invitation created");
      setLink({ label: r.emailed ? `Invite link for ${r.email} (also emailed)` : `Email isn't set up. Send this invite link to ${r.email}:`, url: r.url });
      setEmail("");
      refresh();
    } catch (err) { toastError(err); }
  };

  return (
    <div className="space-y-8">
      {isAdmin && (
        <form onSubmit={invite} className="space-y-2">
          <p className="font-medium">Invite someone</p>
          <div className="flex flex-wrap gap-2">
            <Input type="email" required placeholder="name@uncanned.in" value={email} onChange={(e) => setEmail(e.target.value)} className="min-w-56 flex-1" aria-label="Email to invite" />
            <select aria-label="Role" value={role} onChange={(e) => setRole(e.target.value as InviteRole)} className="h-9 rounded-md border bg-background px-2 text-sm">
              <option value="member">Member</option><option value="viewer">Viewer (read-only)</option>{workspace.role === "owner" && <option value="admin">Admin</option>}
            </select>
            <Button type="submit">Send invite</Button>
          </div>
        </form>
      )}
      {link && <CopyBox {...link} />}

      <div>
        <p className="mb-2 font-medium">Members ({members.data?.filter((m) => !m.disabledAt).length ?? 0})</p>
        <ul className="divide-y rounded-lg border text-sm">
          {(members.data ?? []).map((m) => (
            <li key={m.id} className="flex items-center gap-3 px-3 py-2">
              <span className="flex size-8 items-center justify-center rounded-full bg-muted text-xs font-semibold">{m.name.slice(0, 1).toUpperCase()}</span>
              <span className="min-w-0 flex-1"><span className="block truncate font-medium">{m.name}{m.id === me.id && " (you)"}</span><span className="block truncate text-xs text-muted-foreground">{m.email}</span></span>
              <span className="text-xs text-muted-foreground">{ROLE_LABELS[m.role]}</span>
              {m.id !== me.id && canManage(workspace.role, m.role) && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild><Button size="icon" variant="ghost" className="size-7" aria-label={`Manage ${m.name}`}><MoreHorizontal className="size-4" /></Button></DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    {assignableRoles(workspace.role).filter((r) => r !== m.role).map((r) => (
                      <DropdownMenuItem key={r} onSelect={() => setMemberRole(m, r)}>{r === "owner" ? "Transfer ownership…" : `Make ${ROLE_LABELS[r].toLowerCase()}`}</DropdownMenuItem>
                    ))}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={async () => { try { const r = await api.post<{ url: string }>(`/workspaces/${workspace.id}/members/${m.id}/reset-link`); setLink({ label: `Password reset link for ${m.name} (valid 1 hour)`, url: r.url }); } catch (e) { toastError(e); } }}>
                      Create password reset link
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={async () => { try { await api.delete(`/workspaces/${workspace.id}/members/${m.id}/sessions`); toast.success(`${m.name} was signed out everywhere`); } catch (e) { toastError(e); } }}>
                      Sign out of all devices
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onSelect={async () => {
                      if (!(await confirm({ title: `Remove ${m.name}?`, description: "They lose access immediately and are signed out. Pages they created stay in the workspace.", confirmLabel: "Remove", destructive: true }))) return;
                      try { await api.delete(`/workspaces/${workspace.id}/members/${m.id}`); toast.success(`${m.name} removed`); refresh(); } catch (e) { toastError(e); }
                    }}><Trash2 className="size-4" /> Remove from workspace</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </li>
          ))}
        </ul>
      </div>

      {isAdmin && (invites.data?.length ?? 0) > 0 && (
        <div>
          <p className="mb-2 font-medium">Pending invitations</p>
          <ul className="divide-y rounded-lg border text-sm">
            {invites.data!.map((i) => (
              <li key={i.id} className="flex items-center gap-2 px-3 py-2">
                <span className="min-w-0 flex-1 truncate">{i.email} <span className="text-xs text-muted-foreground">· {i.role} · expires {new Date(i.expiresAt).toLocaleDateString()}</span></span>
                <Button size="sm" variant="ghost" className="h-7" onClick={async () => { try { await api.delete(`/workspaces/${workspace.id}/invitations/${i.id}`); refresh(); } catch (e) { toastError(e); } }}>Revoke</Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function TeamspacesTab() {
  const { workspace } = useWorkspace();
  const isAdmin = isAdminRole(workspace.role);
  const qc = useQueryClient();
  const teamspaces = useTeamspaces(workspace.id);
  const members = useMembers(workspace.id);
  const [name, setName] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const teamMembers = useQuery({ queryKey: ["team-members", open], queryFn: () => api.get<string[]>(`/workspaces/${workspace.id}/teamspaces/${open}/members`), enabled: Boolean(open) });

  return (
    <div className="max-w-2xl space-y-6">
      <p className="text-sm text-muted-foreground">Teamspaces are sections of the sidebar visible only to their members, for example Engineering or Finance.</p>
      {isAdmin && (
        <form className="flex gap-2" onSubmit={async (e) => {
          e.preventDefault();
          try { await api.post(`/workspaces/${workspace.id}/teamspaces`, { name }); setName(""); qc.invalidateQueries({ queryKey: ["teamspaces"] }); } catch (err) { toastError(err); }
        }}>
          <Input placeholder="New teamspace name" value={name} onChange={(e) => setName(e.target.value)} required aria-label="Teamspace name" />
          <Button type="submit">Create</Button>
        </form>
      )}
      <ul className="divide-y rounded-lg border text-sm">
        {(teamspaces.data ?? []).map((t) => (
          <li key={t.id} className="px-3 py-2">
            <div className="flex items-center gap-2">
              <span>{t.icon ?? "👥"}</span>
              <span className="flex-1 font-medium">{t.name}</span>
              <span className="text-xs text-muted-foreground">{t.member_count} members{t.is_member ? " · you're in it" : ""}</span>
              {isAdmin && <Button size="sm" variant="ghost" className="h-7" onClick={() => setOpen(open === t.id ? null : t.id)}>{open === t.id ? "Done" : "Members"}</Button>}
            </div>
            {open === t.id && (
              <ul className="mt-2 grid gap-1 sm:grid-cols-2">
                {(members.data ?? []).filter((m) => !m.disabledAt).map((m) => {
                  const inTeam = teamMembers.data?.includes(m.id) ?? false;
                  return (
                    <li key={m.id}>
                      <label className="flex items-center gap-2">
                        <input type="checkbox" checked={inTeam} onChange={async (e) => {
                          try {
                            await api.post(`/workspaces/${workspace.id}/teamspaces/${t.id}/members`, { userId: m.id, member: e.target.checked });
                            qc.invalidateQueries({ queryKey: ["team-members", t.id] });
                            qc.invalidateQueries({ queryKey: ["teamspaces"] });
                            qc.invalidateQueries({ queryKey: ["tree"] });
                          } catch (err) { toastError(err); }
                        }} />
                        {m.name}
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </li>
        ))}
        {teamspaces.data?.length === 0 && <li className="px-3 py-2 text-muted-foreground">No teamspaces yet.</li>}
      </ul>
    </div>
  );
}

function AdminTab() {
  const { workspace } = useWorkspace();
  const [name, setName] = useState(workspace.name);
  const audit = useQuery({ queryKey: ["audit", workspace.id], queryFn: () => api.get<{ id: number; action: string; target: string | null; ip: string | null; created_at: string; actor: string | null }[]>(`/workspaces/${workspace.id}/audit`) });
  return (
    <div className="space-y-8">
      <form className="max-w-lg space-y-2" onSubmit={async (e) => {
        e.preventDefault();
        try { await api.patch(`/workspaces/${workspace.id}`, { name }); toast.success("Renamed. Reload to see it everywhere."); } catch (err) { toastError(err); }
      }}>
        <Label htmlFor="ws-name">Workspace name</Label>
        <div className="flex gap-2"><Input id="ws-name" value={name} onChange={(e) => setName(e.target.value)} /><Button type="submit" variant="outline">Save</Button></div>
      </form>
      <div className="max-w-lg space-y-2">
        <p className="font-medium">Export everything</p>
        <p className="text-sm text-muted-foreground">A ZIP with every page, database, comment and attachment, including private pages. Records keep their IDs and relationships (workspace.json), plus a readable Markdown/CSV copy. The export is logged below.</p>
        <Button asChild variant="outline" className="gap-1"><a href={`/api/workspaces/${workspace.id}/export`}><Download className="size-4" /> Download workspace export</a></Button>
      </div>
      <div>
        <p className="mb-2 font-medium">Audit log</p>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs text-muted-foreground"><tr><th className="px-3 py-2">When</th><th className="px-3 py-2">Who</th><th className="px-3 py-2">What</th><th className="px-3 py-2">IP</th></tr></thead>
            <tbody className="divide-y">
              {(audit.data ?? []).map((a) => (
                <tr key={a.id}><td className="whitespace-nowrap px-3 py-1.5">{new Date(a.created_at).toLocaleString()}</td><td className="px-3 py-1.5">{a.actor ?? "—"}</td><td className="px-3 py-1.5">{a.action}{a.target ? <span className="text-muted-foreground"> · {a.target}</span> : null}</td><td className="px-3 py-1.5 text-muted-foreground">{a.ip ?? ""}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const { workspace } = useWorkspace();
  const isAdmin = isAdminRole(workspace.role);
  return (
    <SimplePage title="Settings" description={`${workspace.name} · you are ${isAdmin ? "an admin" : "a member"}`}>
      <Tabs defaultValue="account">
        <TabsList className="mb-4">
          <TabsTrigger value="account">Account</TabsTrigger>
          <TabsTrigger value="members">Members</TabsTrigger>
          <TabsTrigger value="teamspaces">Teamspaces</TabsTrigger>
          {isAdmin && <TabsTrigger value="admin">Admin</TabsTrigger>}
        </TabsList>
        <TabsContent value="account"><AccountTab /></TabsContent>
        <TabsContent value="members"><MembersTab /></TabsContent>
        <TabsContent value="teamspaces"><TeamspacesTab /></TabsContent>
        {isAdmin && <TabsContent value="admin"><AdminTab /></TabsContent>}
      </Tabs>
    </SimplePage>
  );
}
