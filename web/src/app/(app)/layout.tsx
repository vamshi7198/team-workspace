import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import { WorkspaceProvider } from "@/components/workspace-context";
import { getSessionCtx } from "@/server/http";
import { listMyWorkspaces } from "@/server/services/workspaces";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getSessionCtx(await headers());
  if (!ctx) redirect("/login");
  const workspaces = await listMyWorkspaces(ctx.userId);
  if (!workspaces.length) {
    return (
      <main className="flex min-h-full items-center justify-center p-8 text-center">
        <div className="max-w-sm space-y-2">
          <h1 className="text-lg font-semibold">You&apos;re not in any workspace</h1>
          <p className="text-sm text-muted-foreground">Ask an admin to invite you, then open the invitation link.</p>
        </div>
      </main>
    );
  }
  const preferred = (await cookies()).get("tw_ws")?.value;
  const workspace = workspaces.find((w) => w.id === preferred) ?? workspaces[0];
  return (
    <WorkspaceProvider value={{ me: ctx.user, workspace, workspaces }}>
      <AppShell>{children}</AppShell>
    </WorkspaceProvider>
  );
}
