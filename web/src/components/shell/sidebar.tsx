"use client";

import { CalendarDays, ChevronDown, ChevronsLeft, FileStack, Home, LogOut, Moon, Plus, Search, Settings, Sun, Trash2, Upload } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { switchWorkspace, useWorkspace } from "@/components/workspace-context";
import { authClient } from "@/lib/auth-client";
import { useCreatePage, useFavorites, useTeamspaces, useTree } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { PageTreeProvider, SectionDropZone, TreeList } from "./page-tree";

function NavItem({ href, icon: Icon, label, onClick, shortcut }: { href?: string; icon: React.ComponentType<{ className?: string }>; label: string; onClick?: () => void; shortcut?: string }) {
  const pathname = usePathname();
  const cls = cn(
    "flex h-7 w-full items-center gap-2 rounded-md px-2 text-sm text-sidebar-foreground/80 hover:bg-sidebar-accent",
    href && pathname === href && "bg-sidebar-accent font-medium text-sidebar-foreground",
  );
  const inner = (
    <>
      <Icon className="size-4 opacity-80" />
      <span className="flex-1 truncate text-left">{label}</span>
      {shortcut && <kbd className="text-[10px] text-muted-foreground">{shortcut}</kbd>}
    </>
  );
  return href ? <Link href={href} className={cls}>{inner}</Link> : <button type="button" onClick={onClick} className={cls}>{inner}</button>;
}

function SectionHeader({ label, onAdd, open, onToggle }: { label: string; onAdd?: () => void; open: boolean; onToggle: () => void }) {
  return (
    <div className="group mt-4 flex h-6 items-center px-2 text-xs font-medium text-muted-foreground">
      <button type="button" onClick={onToggle} className="flex flex-1 items-center gap-1 rounded hover:text-foreground">
        {label}
        <ChevronDown className={cn("size-3 opacity-0 transition group-hover:opacity-100", !open && "-rotate-90")} />
      </button>
      {onAdd && (
        <button type="button" aria-label={`New page in ${label}`} onClick={onAdd} className="flex size-5 items-center justify-center rounded opacity-0 hover:bg-sidebar-accent group-hover:opacity-100 max-md:opacity-100">
          <Plus className="size-3.5" />
        </button>
      )}
    </div>
  );
}

export function Sidebar({ onSearch, onCollapse }: { onSearch: () => void; onCollapse: () => void }) {
  const { me, workspace, workspaces } = useWorkspace();
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const tree = useTree(workspace.id);
  const favorites = useFavorites(workspace.id);
  const teamspaces = useTeamspaces(workspace.id);
  const createPage = useCreatePage();
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const favIds = useMemo(() => new Set((favorites.data ?? []).map((f) => f.id)), [favorites.data]);

  const newPage = async (section: { type: string; teamspaceId?: string }) => {
    const r = await createPage.mutateAsync({ workspaceId: workspace.id, section });
    router.push(`/p/${r.id}`);
  };
  const toggle = (k: string) => setClosed((c) => ({ ...c, [k]: !c[k] }));

  return (
    <nav aria-label="Workspace" className="flex h-full w-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex items-center gap-1 p-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-sidebar-accent">
              <span className="flex size-6 flex-none items-center justify-center rounded bg-foreground text-xs font-semibold text-background">{workspace.icon ?? workspace.name.slice(0, 1).toUpperCase()}</span>
              <span className="truncate text-sm font-medium">{workspace.name}</span>
              <ChevronDown className="size-3.5 flex-none opacity-60" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64">
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">{me.email}</DropdownMenuLabel>
            {workspaces.length > 1 && (
              <>
                {workspaces.map((w) => (
                  <DropdownMenuItem key={w.id} onSelect={() => w.id !== workspace.id && switchWorkspace(w.id)}>
                    <span className="flex size-5 items-center justify-center rounded bg-muted text-xs">{w.icon ?? w.name.slice(0, 1)}</span>
                    {w.name} {w.id === workspace.id && <span className="ml-auto text-xs text-muted-foreground">current</span>}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuItem asChild><Link href="/settings"><Settings className="size-4" /> Settings & members</Link></DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setTheme(theme === "dark" ? "light" : "dark")}>
              {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />} {theme === "dark" ? "Light mode" : "Dark mode"}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={async () => {
                await authClient.signOut();
                window.location.href = "/login";
              }}
            >
              <LogOut className="size-4" /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button variant="ghost" size="icon" className="size-7 flex-none" onClick={onCollapse} aria-label="Collapse sidebar" title="Collapse sidebar (Ctrl+\)">
          <ChevronsLeft className="size-4" />
        </Button>
      </div>

      <div className="space-y-0.5 px-2">
        <NavItem icon={Search} label="Search" onClick={onSearch} shortcut="Ctrl K" />
        <NavItem href="/" icon={Home} label="Home" />
        <NavItem href="/meetings" icon={CalendarDays} label="Meetings" />
        <NavItem href="/settings" icon={Settings} label="Settings & members" />
        <NavItem icon={Plus} label="New page" onClick={() => newPage({ type: "private" })} />
      </div>

      <div className="mt-1 flex-1 overflow-y-auto px-2 pb-4">
        {tree.isLoading ? (
          <div className="mt-4 space-y-2 px-2">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-5 w-full" />)}
          </div>
        ) : tree.isError ? (
          <p className="mt-4 px-2 text-xs text-destructive">Couldn&apos;t load pages. <button className="underline" onClick={() => tree.refetch()}>Retry</button></p>
        ) : (
          <PageTreeProvider nodes={tree.data ?? []} favorites={favIds}>
            {({ sections }) => (
              <>
                {(favorites.data?.length ?? 0) > 0 && (
                  <>
                    <SectionHeader label="Favorites" open={!closed.fav} onToggle={() => toggle("fav")} />
                    {!closed.fav && (
                      <ul className="space-y-px">
                        {favorites.data!.map((f) => (
                          <li key={f.id}>
                            <Link href={`/p/${f.id}`} className="flex h-7 items-center gap-1.5 rounded-md px-2 text-sm text-sidebar-foreground/80 hover:bg-sidebar-accent">
                              <span className="w-5 text-center">{f.icon ?? "📄"}</span>
                              <span className="truncate">{f.title || "Untitled"}</span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                )}

                {(teamspaces.data ?? []).filter((t) => t.is_member).map((t) => (
                  <div key={t.id}>
                    <SectionHeader label={`${t.icon ?? "👥"} ${t.name}`} open={!closed[t.id]} onToggle={() => toggle(t.id)} onAdd={() => newPage({ type: "teamspace", teamspaceId: t.id })} />
                    {!closed[t.id] && (
                      <SectionDropZone id={`section:teamspace:${t.id}`}>
                        {(sections.teamspaces.get(t.id) ?? []).length ? <TreeList nodes={sections.teamspaces.get(t.id)!} /> : <p className="px-2 py-1 text-xs text-muted-foreground/70">No pages yet</p>}
                      </SectionDropZone>
                    )}
                  </div>
                ))}

                <SectionHeader label="Workspace" open={!closed.ws} onToggle={() => toggle("ws")} onAdd={() => newPage({ type: "workspace" })} />
                {!closed.ws && (
                  <SectionDropZone id="section:workspace">
                    {sections.workspace.length ? <TreeList nodes={sections.workspace} /> : <p className="px-2 py-1 text-xs text-muted-foreground/70">Pages everyone can see</p>}
                  </SectionDropZone>
                )}

                {sections.shared.length > 0 && (
                  <>
                    <SectionHeader label="Shared with you" open={!closed.shared} onToggle={() => toggle("shared")} />
                    {!closed.shared && <TreeList nodes={sections.shared} />}
                  </>
                )}

                <SectionHeader label="Private" open={!closed.priv} onToggle={() => toggle("priv")} onAdd={() => newPage({ type: "private" })} />
                {!closed.priv && (
                  <SectionDropZone id="section:private">
                    {sections.private.length ? <TreeList nodes={sections.private} /> : <p className="px-2 py-1 text-xs text-muted-foreground/70">Pages only you can see</p>}
                  </SectionDropZone>
                )}
              </>
            )}
          </PageTreeProvider>
        )}
      </div>

      <div className="space-y-0.5 border-t p-2">
        <NavItem href="/templates" icon={FileStack} label="Templates" />
        <NavItem href="/import" icon={Upload} label="Import" />
        <NavItem href="/trash" icon={Trash2} label="Trash" />
      </div>
    </nav>
  );
}
