"use client";
import Link from "next/link";
import { useState } from "react";
import { AuthCard, Divider, Field, GoogleButton } from "@/components/AuthCard";
import { supabase } from "@/lib/supabase";

export default function SignInPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function signInWithEmail(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase) return setError("Auth is not configured yet -- ask your admin to set NEXT_PUBLIC_SUPABASE_ANON_KEY.");
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (err) return setError(err.message);
    window.location.href = "/";
  }

  async function signInWithGoogle() {
    if (!supabase) return setError("Auth is not configured yet -- ask your admin to set NEXT_PUBLIC_SUPABASE_ANON_KEY.");
    await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: `${window.location.origin}/` } });
  }

  return (
    <AuthCard title="Welcome back" subtitle="Sign in to your admissions dashboard">
      <GoogleButton onClick={signInWithGoogle} />
      <Divider text="or continue with email" />
      <form onSubmit={signInWithEmail}>
        <Field label="Work email" type="email" value={email} onChange={setEmail} placeholder="sana@northbridge.edu.pk" required />
        <Field
          label="Password"
          type="password"
          value={password}
          onChange={setPassword}
          placeholder="••••••••"
          required
          action={<Link href="/forgot-password" className="text-xs font-semibold text-accent hover:underline">Forgot password?</Link>}
        />
        {error && <p className="mb-4 text-sm" style={{ color: "var(--chip-rejected-fg)" }}>{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-lg bg-accent py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
      <p className="mt-5 text-center text-sm text-ink-2">
        Don&apos;t have an account? <Link href="/sign-up" className="font-semibold text-accent hover:underline">Sign up</Link>
      </p>
    </AuthCard>
  );
}
