"use client";

import { Upload } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { SimplePage } from "@/components/simple-page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useWorkspace } from "@/components/workspace-context";
import { api } from "@/lib/api";
import { toastError, useInvalidateStructure } from "@/lib/queries";

type Summary = { rootPageId: string; pages: number; databases: number; rows: number; files: number; skipped: string[] };

export default function ImportPage() {
  const { workspace } = useWorkspace();
  const invalidate = useInvalidateStructure();
  const [files, setFiles] = useState<File[]>([]);
  const [title, setTitle] = useState("Notion import");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Summary | null>(null);

  const run = async () => {
    setBusy(true);
    setResult(null);
    try {
      const form = new FormData();
      files.forEach((f) => form.append("file", f));
      form.append("title", title);
      const r = await api.upload<Summary>(`/workspaces/${workspace.id}/import`, form);
      setResult(r);
      setFiles([]);
      invalidate();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SimplePage title="Import" description="Bring in a Notion export or Markdown files. Imports go into a new private page, so nothing existing is changed.">
      <div className="space-y-6">
        <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
          <li>In Notion: <strong>Settings → Workspace → Export all workspace content</strong> (or ⋯ → Export on a page).</li>
          <li>Choose <strong>Markdown &amp; CSV</strong>, include sub-pages and files, and download the ZIP.</li>
          <li>Upload the ZIP here (up to 300 MB). Databases become real databases; pages keep their hierarchy, images and internal links.</li>
        </ol>
        <div className="space-y-4 rounded-xl border p-4">
          <div className="space-y-1.5">
            <Label htmlFor="import-title">Put everything under a page called</Label>
            <Input id="import-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="import-files">Notion ZIP or .md files</Label>
            <Input id="import-files" type="file" accept=".zip,.md,.markdown,.txt" multiple onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />
          </div>
          <Button onClick={run} disabled={!files.length || busy} className="gap-1"><Upload className="size-4" /> {busy ? "Importing… this can take a minute" : "Import"}</Button>
        </div>
        {result && (
          <div className="rounded-xl border border-green-600/40 bg-green-600/5 p-4 text-sm">
            <p className="font-medium">Import finished</p>
            <p className="mt-1">{result.pages} pages, {result.databases} databases with {result.rows} rows, {result.files} files.</p>
            {result.skipped.length > 0 && <p className="mt-1 text-muted-foreground">Skipped {result.skipped.length} item(s) (unsupported file types or unreadable files).</p>}
            <p className="mt-2"><Link href={`/p/${result.rootPageId}`} className="underline">Open the imported pages</Link>, then move them where they belong (⋯ → Move to). They start private to you.</p>
            <p className="mt-2 text-xs text-muted-foreground">Known limits: Notion relations and people columns arrive as text; comments and page permissions are not part of Notion&apos;s export.</p>
          </div>
        )}
      </div>
    </SimplePage>
  );
}
