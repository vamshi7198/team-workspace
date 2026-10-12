"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";

export type SaveStatus = "saved" | "dirty" | "saving" | "error" | "conflict";
export type Conflict = { serverVersion: number; serverDoc: unknown; updatedAt: string; updatedByName: string | null };
type Draft = { doc: unknown; baseVersion: number; at: number };

const draftKey = (pageId: string) => `tw:draft:${pageId}`;
const readDraft = (pageId: string): Draft | null => {
  try { return JSON.parse(localStorage.getItem(draftKey(pageId)) ?? "null"); } catch { return null; }
};
const RETRY_MS = [2000, 5000, 10000, 30000];

/**
 * Autosave with optimistic concurrency. Edits are buffered in localStorage until the
 * server acknowledges them, so a crash or lost connection never silently drops work.
 */
export function useAutosave(opts: {
  pageId: string;
  initialVersion: number;
  enabled: boolean;
  getDoc: () => unknown;
  /** Replace the editor content without marking it dirty. */
  applyDoc: (doc: unknown) => void;
  onRemoteUpdate?: (byName: string | null) => void;
}) {
  const { pageId, enabled } = opts;
  const [status, setStatus] = useState<SaveStatus>("saved");
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [remoteChanged, setRemoteChanged] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);

  const version = useRef(opts.initialVersion);
  const seq = useRef(0);
  const savedSeq = useRef(0);
  const inflight = useRef<Promise<void> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retry = useRef(0);
  const conflictRef = useRef(false);
  const optsRef = useRef(opts);
  // Callbacks read the latest options through this ref. Layout effects run at commit, before
  // any timer or editor event can call them.
  useLayoutEffect(() => {
    optsRef.current = opts;
  });
  const saveRef = useRef<(force?: boolean) => Promise<void>>(async () => {});

  const isDirty = () => seq.current !== savedSeq.current;

  const writeDraft = useCallback(() => {
    try {
      localStorage.setItem(draftKey(pageId), JSON.stringify({ doc: optsRef.current.getDoc(), baseVersion: version.current, at: Date.now() } satisfies Draft));
    } catch { /* storage full or disabled: the in-memory editor still has the content */ }
  }, [pageId]);
  const clearDraft = useCallback(() => {
    try { localStorage.removeItem(draftKey(pageId)); } catch {}
  }, [pageId]);

  const schedule = useCallback((ms: number) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void saveRef.current(), ms);
  }, []);

  const save = useCallback(async (force = false): Promise<void> => {
    if (inflight.current) {
      await inflight.current;
      if (!isDirty() && !force) return;
    }
    if ((!isDirty() && !force) || (conflictRef.current && !force)) return;
    const mySeq = seq.current;
    const doc = optsRef.current.getDoc();
    setStatus("saving");
    const run = (async () => {
      try {
        const r = await api.put<{ version: number; updatedAt: string }>(`/pages/${pageId}/content`, { doc, baseVersion: version.current, force: force || undefined });
        version.current = r.version;
        savedSeq.current = mySeq;
        retry.current = 0;
        setLastSavedAt(new Date());
        if (conflictRef.current) { conflictRef.current = false; setConflict(null); }
        if (isDirty()) {
          setStatus("dirty");
          schedule(300);
        } else {
          setStatus("saved");
          clearDraft();
        }
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) {
          conflictRef.current = true;
          setConflict(e.details as Conflict);
          setStatus("conflict");
        } else {
          setStatus("error");
          const wait = RETRY_MS[Math.min(retry.current++, RETRY_MS.length - 1)];
          schedule(wait);
        }
      } finally {
        inflight.current = null;
      }
    })();
    inflight.current = run;
    return run;
  }, [pageId, clearDraft, schedule]);  
  useLayoutEffect(() => {
    saveRef.current = save;
  }, [save]);

  /** Call on every local edit. */
  const markDirty = useCallback(() => {
    if (!enabled) return;
    seq.current++;
    if (!conflictRef.current) setStatus((s) => (s === "saving" ? s : "dirty"));
    writeDraft();
    schedule(800);
  }, [enabled, writeDraft, schedule]);  

  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    await save();
  }, [save]);

  /** Conflict: overwrite with my version (the server keeps theirs in history). */
  const keepMine = useCallback(async () => {
    await save(true);
  }, [save]);

  /** Conflict: take their version; mine is stored in page history first. */
  const takeTheirs = useCallback(async () => {
    const c = conflict;
    if (!c) return;
    await api.post(`/pages/${pageId}/versions`, { doc: optsRef.current.getDoc() });
    optsRef.current.applyDoc(c.serverDoc);
    version.current = c.serverVersion;
    savedSeq.current = seq.current;
    conflictRef.current = false;
    setConflict(null);
    setStatus("saved");
    clearDraft();
  }, [conflict, pageId, clearDraft]);

  /** Reload the latest server copy (used after restoring a version). */
  const reload = useCallback(async () => {
    const p = await api.get<{ doc: unknown; version: number }>(`/pages/${pageId}`);
    optsRef.current.applyDoc(p.doc);
    version.current = p.version;
    savedSeq.current = seq.current;
    setStatus("saved");
    setRemoteChanged(null);
    clearDraft();
  }, [pageId, clearDraft]);

  // Offer to recover a local draft that never reached the server.
  useEffect(() => {
    if (!enabled) return;
    const d = readDraft(pageId);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read browser storage after mount so server and client render the same HTML
    if (d) setDraft(d);
  }, [pageId, enabled]);

  const restoreDraft = useCallback(() => {
    if (!draft) return;
    optsRef.current.applyDoc(draft.doc);
    version.current = Math.min(version.current, draft.baseVersion);
    setDraft(null);
    markDirty();
  }, [draft, markDirty]);
  const discardDraft = useCallback(() => {
    setDraft(null);
    clearDraft();
  }, [clearDraft]);

  // Notice other people's saves: reload silently when we have no local edits.
  useEffect(() => {
    const t = setInterval(async () => {
      if (document.visibilityState !== "visible" || inflight.current) return;
      try {
        const v = await api.get<{ version: number; updatedByName: string | null } | null>(`/pages/${pageId}/version`);
        if (!v || v.version <= version.current) return;
        if (!isDirty() && !conflictRef.current) {
          const p = await api.get<{ doc: unknown; version: number }>(`/pages/${pageId}`);
          if (isDirty()) return;
          optsRef.current.applyDoc(p.doc);
          version.current = p.version;
          setRemoteChanged(null);
          optsRef.current.onRemoteUpdate?.(v.updatedByName);
        } else {
          setRemoteChanged(v.updatedByName ?? "Someone");
        }
      } catch { /* offline: try again next tick */ }
    }, 10_000);
    return () => clearInterval(t);
  }, [pageId]);  

  // Warn before closing the tab with unsaved edits; save on unmount.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirty() || inflight.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      if (timer.current) clearTimeout(timer.current);
      if (isDirty() && !conflictRef.current) void save();
    };
  }, [save]);

  return { status, conflict, lastSavedAt, remoteChanged, draft, markDirty, flush, keepMine, takeTheirs, reload, restoreDraft, discardDraft, isDirty, version };
}
