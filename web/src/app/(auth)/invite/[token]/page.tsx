"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AuthCard, FormError } from "@/components/auth-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, ApiError } from "@/lib/api";
import { authClient } from "@/lib/auth-client";

type Invite = { email: string; workspaceName: string; existingAccount: boolean };

export default function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const session = authClient.useSession();
  const [invite, setInvite] = useState<Invite | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get<Invite>(`/invitations/${encodeURIComponent(token)}`).then(setInvite, (e) => setLoadError(e instanceof ApiError ? e.message : "Could not load the invitation"));
  }, [token]);

  if (loadError) {
    return (
      <AuthCard title="Invitation unavailable">
        <FormError message={loadError} />
        <p className="mt-4 text-sm text-muted-foreground">Ask your workspace admin to send a new invitation.</p>
      </AuthCard>
    );
  }
  if (!invite || session.isPending) return <AuthCard title="Loading invitation…">{null}</AuthCard>;

  const signedInAs = session.data?.user.email;

  async function accept(e?: React.FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post(`/invitations/${encodeURIComponent(token)}`, invite!.existingAccount ? {} : { name, password });
      if (!invite!.existingAccount) {
        const { error } = await authClient.signIn.email({ email: invite!.email, password });
        if (error) throw new Error("Account created. Please sign in.");
      }
      router.replace("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not accept the invitation");
      setBusy(false);
    }
  }

  if (invite.existingAccount) {
    return (
      <AuthCard title={`Join ${invite.workspaceName}`} subtitle={<>Invitation for <strong>{invite.email}</strong></>}>
        {signedInAs === invite.email ? (
          <div className="space-y-4">
            <FormError message={error} />
            <Button className="w-full" onClick={() => accept()} disabled={busy}>Accept invitation</Button>
          </div>
        ) : (
          <div className="space-y-3 text-sm">
            <p>You already have an account. Sign in as {invite.email} to accept.</p>
            <Button asChild className="w-full"><Link href={`/login?next=/invite/${token}`}>Sign in</Link></Button>
          </div>
        )}
      </AuthCard>
    );
  }

  return (
    <AuthCard title={`Join ${invite.workspaceName}`} subtitle={<>Create your account for <strong>{invite.email}</strong></>}>
      <form onSubmit={accept} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="name">Your name</Label>
          <Input id="name" required autoFocus maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password">Password</Label>
          <Input id="password" type="password" autoComplete="new-password" required minLength={10} value={password} onChange={(e) => setPassword(e.target.value)} />
          <p className="text-xs text-muted-foreground">At least 10 characters.</p>
        </div>
        <FormError message={error} />
        <Button type="submit" className="w-full" disabled={busy}>{busy ? "Creating account…" : "Create account and join"}</Button>
      </form>
    </AuthCard>
  );
}
