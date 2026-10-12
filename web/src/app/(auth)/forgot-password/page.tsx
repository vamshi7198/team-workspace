"use client";

import Link from "next/link";
import { useState } from "react";
import { AuthCard, FormError } from "@/components/auth-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await authClient.requestPasswordReset({ email: email.trim(), redirectTo: "/reset-password" });
    setBusy(false);
    if (error?.status === 429) return setError("Too many requests. Try again in a few minutes.");
    // Same message whether or not the account exists.
    setSent(true);
  }

  return (
    <AuthCard title="Reset your password">
      {sent ? (
        <div className="space-y-4 text-sm">
          <p>If an account exists for <strong>{email}</strong>, we&apos;ve sent a link to reset the password. It expires in one hour.</p>
          <p className="text-muted-foreground">No email? Your workspace may not have email set up. Ask an admin to create a reset link for you from Settings → Members.</p>
          <Link href="/login" className="block text-center underline underline-offset-4">Back to sign in</Link>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <FormError message={error} />
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? "Sending…" : "Send reset link"}
          </Button>
          <Link href="/login" className="block text-center text-sm text-muted-foreground hover:text-foreground">Back to sign in</Link>
        </form>
      )}
    </AuthCard>
  );
}
