"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type ConfirmOptions = { title: string; description?: React.ReactNode; confirmLabel?: string; destructive?: boolean };
type PromptOptions = { title: string; label?: string; initial?: string; confirmLabel?: string; placeholder?: string };

type Api = {
  confirm: (o: ConfirmOptions) => Promise<boolean>;
  prompt: (o: PromptOptions) => Promise<string | null>;
};
const DialogsCtx = createContext<Api | null>(null);

/** Promise-based confirm/prompt dialogs, so destructive actions always ask first. */
export function DialogsProvider({ children }: { children: React.ReactNode }) {
  const [confirmState, setConfirmState] = useState<ConfirmOptions | null>(null);
  const [promptState, setPromptState] = useState<PromptOptions | null>(null);
  const [value, setValue] = useState("");
  const resolver = useRef<(v: unknown) => void>(() => {});

  const confirm = useCallback((o: ConfirmOptions) => new Promise<boolean>((resolve) => {
    resolver.current = resolve as (v: unknown) => void;
    setConfirmState(o);
  }), []);
  const prompt = useCallback((o: PromptOptions) => new Promise<string | null>((resolve) => {
    resolver.current = resolve as (v: unknown) => void;
    setValue(o.initial ?? "");
    setPromptState(o);
  }), []);

  const closeConfirm = (v: boolean) => {
    setConfirmState(null);
    resolver.current(v);
  };
  const closePrompt = (v: string | null) => {
    setPromptState(null);
    resolver.current(v);
  };

  return (
    <DialogsCtx.Provider value={{ confirm, prompt }}>
      {children}
      <AlertDialog open={Boolean(confirmState)} onOpenChange={(o) => !o && closeConfirm(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmState?.title}</AlertDialogTitle>
            {confirmState?.description && <AlertDialogDescription>{confirmState.description}</AlertDialogDescription>}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => closeConfirm(false)}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={confirmState?.destructive ? "bg-destructive text-white hover:bg-destructive/90" : undefined}
              onClick={() => closeConfirm(true)}
            >
              {confirmState?.confirmLabel ?? "Continue"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Dialog open={Boolean(promptState)} onOpenChange={(o) => !o && closePrompt(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{promptState?.title}</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              closePrompt(value);
            }}
            className="space-y-4"
          >
            <Input autoFocus aria-label={promptState?.label ?? promptState?.title} placeholder={promptState?.placeholder} value={value} onChange={(e) => setValue(e.target.value)} />
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => closePrompt(null)}>Cancel</Button>
              <Button type="submit">{promptState?.confirmLabel ?? "Save"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </DialogsCtx.Provider>
  );
}

export function useDialogs() {
  const v = useContext(DialogsCtx);
  if (!v) throw new Error("useDialogs must be used inside DialogsProvider");
  return v;
}
