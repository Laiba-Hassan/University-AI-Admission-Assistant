"use client";
import Link from "next/link";
import { useState } from "react";
import { AuthCard, Field } from "@/components/AuthCard";
import { supabase } from "@/lib/supabase";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase) return setError("Auth is not configured yet -- ask your admin to set NEXT_PUBLIC_SUPABASE_ANON_KEY.");
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/reset-password` });
    setBusy(false);
    // Always show the same confirmation, whether or not the email exists -- otherwise this becomes a way to
    // check which addresses have an account.
    if (err && err.message !== "User not found") return setError(err.message);
    setSent(true);
  }

  if (sent) {
    return (
      <AuthCard title="Check your email" subtitle="If that address has an account, a reset link is on its way.">
        <Link href="/sign-in" className="block w-full rounded-lg bg-accent py-2.5 text-center text-sm font-semibold text-white hover:opacity-90">
          Back to sign in
        </Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Reset your password" subtitle="Enter your work email and we'll send you a reset link">
      <form onSubmit={submit}>
        <Field label="Work email" type="email" value={email} onChange={setEmail} placeholder="sana@northbridge.edu.pk" required />
        {error && <p className="mb-4 text-sm" style={{ color: "var(--chip-rejected-fg)" }}>{error}</p>}
        <button type="submit" disabled={busy} className="w-full rounded-lg bg-accent py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60">
          {busy ? "Sending…" : "Send reset link"}
        </button>
      </form>
      <p className="mt-5 text-center text-sm text-ink-2">
        <Link href="/sign-in" className="font-semibold text-accent hover:underline">Back to sign in</Link>
      </p>
    </AuthCard>
  );
}
