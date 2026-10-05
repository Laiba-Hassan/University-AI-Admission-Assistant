"use client";

import { useState } from "react";
import { AuthCard, Divider, Field, GoogleButton } from "@/components/AuthCard";
import { supabase } from "@/lib/supabase";

// A platform admin signs in through the same Supabase Auth as staff -- what makes them a platform admin is a
// row in platform_admins, checked server-side by GET /api/platform/me, never anything client-side. This page
// only exists to send them to /platform/tenants afterward instead of the tenant dashboard's "/".
export default function PlatformSignInPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  async function signIn(e) {
    e.preventDefault();
    if (!supabase) return setError("Auth is not configured yet -- ask your admin to set NEXT_PUBLIC_SUPABASE_ANON_KEY.");
    setBusy(true);
    setError(null);
    const {
      error: err
    } = await supabase.auth.signInWithPassword({
      email,
      password
    });
    setBusy(false);
    if (err) return setError(err.message);
    window.location.href = "/platform/tenants";
  }
  async function signInWithGoogle() {
    if (!supabase) return setError("Auth is not configured yet -- ask your admin to set NEXT_PUBLIC_SUPABASE_ANON_KEY.");
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/platform/tenants`
      }
    });
  }
  return <AuthCard title="Enrollium Platform" subtitle="Sign in with your platform admin account">
      <GoogleButton onClick={signInWithGoogle} />
      <Divider text="or continue with email" />
      <form onSubmit={signIn}>
        <Field label="Email" type="email" value={email} onChange={setEmail} placeholder="you@enrollium.ai" required />
        <Field label="Password" type="password" value={password} onChange={setPassword} placeholder="••••••••" required />
        {error && <p className="mb-4 text-sm" style={{
        color: "var(--chip-rejected-fg)"
      }}>{error}</p>}
        <button type="submit" disabled={busy} className="w-full rounded-lg bg-accent py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60">
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </AuthCard>;
}