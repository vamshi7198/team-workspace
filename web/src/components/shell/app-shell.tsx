"use client";

import { Menu, PanelLeftOpen } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { createContext, useContext, useEffect, useState } from "react";
import { DialogsProvider } from "@/components/dialogs";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useWorkspace } from "@/components/workspace-context";
import { useCreatePage } from "@/lib/queries";
import { canContribute } from "@/lib/roles";
import { SearchDialog } from "./search-dialog";
import { ShortcutsDialog } from "./shortcuts-dialog";
import { Sidebar } from "./sidebar";

const ShellCtx = createContext<{ openSearch: () => void; sidebarHidden: boolean; showSidebar: () => void }>({ openSearch: () => {}, sidebarHidden: false, showSidebar: () => {} });
export const useShell = () => useContext(ShellCtx);

const COLLAPSED_KEY = "tw:sidebar-collapsed";
const WIDTH = 260;

export function AppShell({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const { workspace } = useWorkspace();
  const createPage = useCreatePage();

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read browser storage after mount so server and client render the same HTML
    try { setCollapsed(localStorage.getItem(COLLAPSED_KEY) === "1"); } catch {}
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- close the mobile sidebar after navigating
  useEffect(() => setMobileOpen(false), [pathname]);

  const setCollapsedPersist = (v: boolean) => {
    setCollapsed(v);
    try { localStorage.setItem(COLLAPSED_KEY, v ? "1" : "0"); } catch {}
  };

  // Global shortcuts (the full list is in shortcuts-dialog.tsx). The editor handles its own
  // first; anything it handled (e.g. Ctrl+K on selected text = link) is skipped here.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      // e.code keeps Alt/Shift combinations layout-independent (Alt changes e.key on macOS).
      const run = (fn: () => void) => { e.preventDefault(); fn(); };
      if (!e.altKey && !e.shiftKey && (e.key === "k" || e.key === "p")) run(() => setSearchOpen(true));
      else if (e.key === "\\") run(() => setCollapsedPersist(!collapsed));
      else if (e.code === "Slash" && !e.altKey) run(() => setShortcutsOpen((o) => !o));
      else if (e.shiftKey && !e.altKey && e.code === "KeyL") run(() => setTheme(resolvedTheme === "dark" ? "light" : "dark"));
      else if (e.altKey && !e.shiftKey && e.code === "KeyN") {
        if (!canContribute(workspace.role)) return;
        run(async () => {
          const r = await createPage.mutateAsync({ workspaceId: workspace.id, section: { type: "private" } }).catch(() => null);
          if (r) router.push(`/p/${r.id}`);
        });
      } else if (!e.altKey && !e.shiftKey && e.code === "BracketLeft") run(() => router.back());
      else if (!e.altKey && !e.shiftKey && e.code === "BracketRight") run(() => router.forward());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const sidebar = <Sidebar onSearch={() => { setMobileOpen(false); setSearchOpen(true); }} onCollapse={() => (mobileOpen ? setMobileOpen(false) : setCollapsedPersist(true))} />;

  return (
    <DialogsProvider>
      <ShellCtx.Provider value={{ openSearch: () => setSearchOpen(true), sidebarHidden: collapsed, showSidebar: () => setCollapsedPersist(false) }}>
        <div className="flex h-full">
          {!collapsed && (
            <aside className="hidden h-full flex-none border-r md:block" style={{ width: WIDTH }}>
              {sidebar}
            </aside>
          )}
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetContent side="left" className="w-[280px] p-0" showCloseButton={false}>
              <SheetTitle className="sr-only">Navigation</SheetTitle>
              {sidebar}
            </SheetContent>
          </Sheet>
          <div className="relative flex h-full min-w-0 flex-1 flex-col">
            <div className="absolute left-2 top-2 z-20 flex gap-1">
              <Button variant="ghost" size="icon" className="size-8 md:hidden" onClick={() => setMobileOpen(true)} aria-label="Open navigation">
                <Menu className="size-4" />
              </Button>
              {collapsed && (
                <Button variant="ghost" size="icon" className="hidden size-8 md:flex" onClick={() => setCollapsedPersist(false)} aria-label="Show sidebar" title="Show sidebar (Ctrl+\)">
                  <PanelLeftOpen className="size-4" />
                </Button>
              )}
            </div>
            <main className="h-full overflow-y-auto" id="main">{children}</main>
          </div>
        </div>
        <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
        <SearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
      </ShellCtx.Provider>
    </DialogsProvider>
  );
}
