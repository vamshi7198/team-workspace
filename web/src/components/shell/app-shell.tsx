"use client";

import { Menu, PanelLeftOpen } from "lucide-react";
import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, useState } from "react";
import { DialogsProvider } from "@/components/dialogs";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { SearchDialog } from "./search-dialog";
import { Sidebar } from "./sidebar";

const ShellCtx = createContext<{ openSearch: () => void; sidebarHidden: boolean; showSidebar: () => void }>({ openSearch: () => {}, sidebarHidden: false, showSidebar: () => {} });
export const useShell = () => useContext(ShellCtx);

const COLLAPSED_KEY = "tw:sidebar-collapsed";
const WIDTH = 260;

export function AppShell({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    try { setCollapsed(localStorage.getItem(COLLAPSED_KEY) === "1"); } catch {}
  }, []);
  useEffect(() => setMobileOpen(false), [pathname]);

  const setCollapsedPersist = (v: boolean) => {
    setCollapsed(v);
    try { localStorage.setItem(COLLAPSED_KEY, v ? "1" : "0"); } catch {}
  };

  // Global shortcuts: Ctrl/Cmd+K or Ctrl/Cmd+P search, Ctrl/Cmd+\ toggles the sidebar.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && (e.key === "k" || e.key === "p")) {
        e.preventDefault();
        setSearchOpen(true);
      } else if (mod && e.key === "\\") {
        e.preventDefault();
        setCollapsedPersist(!collapsed);
      }
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
        <SearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
      </ShellCtx.Provider>
    </DialogsProvider>
  );
}
