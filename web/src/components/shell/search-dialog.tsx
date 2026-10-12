"use client";

import { Clock, Database, FileText, MessageSquare } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useWorkspace } from "@/components/workspace-context";
import { api } from "@/lib/api";

type Result = { type: "page" | "comment"; id: string; pageId: string; title: string; icon: string | null; kind: string; context: string | null; snippet: string | null; archived: boolean };

const RECENT_KEY = "tw:recent-searches";
const loadRecent = (): string[] => {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]"); } catch { return []; }
};
const saveRecent = (q: string) => {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify([q, ...loadRecent().filter((x) => x !== q)].slice(0, 6))); } catch {}
};

/** Renders a server snippet: text is escaped by React; \u0002…\u0003 mark matches. */
export function Snippet({ text }: { text: string }) {
  const parts = text.split(/(\u0002[^\u0003]*\u0003)/g);
  return (
    <>
      {parts.map((p, i) => (p.startsWith("\u0002") ? <mark key={i} className="hit">{p.slice(1, -1)}</mark> : <span key={i}>{p}</span>))}
    </>
  );
}

function Highlight({ text, q }: { text: string; q: string }) {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return <>{text}</>;
  const re = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
  return <>{text.split(re).map((p, i) => (i % 2 ? <mark key={i} className="hit">{p}</mark> : <span key={i}>{p}</span>))}</>;
}

export function SearchDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { workspace } = useWorkspace();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);

  useEffect(() => {
    if (open) setRecent(loadRecent());
  }, [open]);

  useEffect(() => {
    const term = q.trim();
    if (!term) {
      setResults([]);
      return;
    }
    setLoading(true);
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      api.get<Result[]>(`/workspaces/${workspace.id}/search?q=${encodeURIComponent(term)}`)
        .then((r) => !ctrl.signal.aborted && setResults(r))
        .catch(() => !ctrl.signal.aborted && setResults([]))
        .finally(() => !ctrl.signal.aborted && setLoading(false));
    }, 180);
    return () => {
      ctrl.abort();
      clearTimeout(t);
    };
  }, [q, workspace.id]);

  const go = (r: Result) => {
    saveRecent(q.trim());
    onOpenChange(false);
    setQ("");
    router.push(`/p/${r.pageId}${r.type === "comment" ? "?comments=1" : ""}`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-[15%] translate-y-0 overflow-hidden p-0 sm:max-w-2xl" showCloseButton={false}>
        <DialogTitle className="sr-only">Search</DialogTitle>
        <Command shouldFilter={false} loop>
          <CommandInput placeholder="Search pages, tasks, meetings and comments…" value={q} onValueChange={setQ} />
          <CommandList className="max-h-[60vh]">
            {q.trim() && !loading && <CommandEmpty>No results for “{q.trim()}”.</CommandEmpty>}
            {!q.trim() && recent.length > 0 && (
              <CommandGroup heading="Recent searches">
                {recent.map((r) => (
                  <CommandItem key={r} value={`recent-${r}`} onSelect={() => setQ(r)}>
                    <Clock className="size-4 text-muted-foreground" /> {r}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {results.length > 0 && (
              <CommandGroup heading={loading ? "Searching…" : "Results"}>
                {results.map((r) => (
                  <CommandItem key={`${r.type}-${r.id}`} value={`${r.type}-${r.id}`} onSelect={() => go(r)} className="items-start py-2">
                    <span className="mt-0.5 flex w-5 flex-none justify-center">
                      {r.type === "comment" ? <MessageSquare className="size-4" /> : r.icon ?? (r.kind === "database" ? <Database className="size-4" /> : <FileText className="size-4" />)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium"><Highlight text={r.title || "Untitled"} q={q} /></span>
                        {r.context && <span className="truncate text-xs text-muted-foreground">in {r.context}</span>}
                        {r.archived && <span className="tag tag-gray">Archived</span>}
                      </div>
                      {r.snippet && <p className="line-clamp-2 text-xs text-muted-foreground"><Snippet text={r.snippet} /></p>}
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
        <div className="flex items-center gap-3 border-t px-3 py-2 text-xs text-muted-foreground">
          <span>↑↓ to navigate</span><span>↵ to open</span><span>esc to close</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
