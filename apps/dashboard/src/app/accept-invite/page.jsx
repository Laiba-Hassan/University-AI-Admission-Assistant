"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { AuthCard, Field } from "@/components/AuthCard";
import { API_URL } from "@/lib/config";
import { supabase } from "@/lib/supabase";
function AcceptInviteForm() {
  const token = useSearchParams().get("token") ?? "";
  const [mode, setMode] = useState("new");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [tenantName, setTenantName] = useState(null);
  async function submit(e) {
    e.preventDefault();
    if (!supabase) return setError("Auth is not configured yet.");
    if (!token) return setError("This invite link is missing its token.");
    setBusy(true);
    setError(null);
    const {
      data,
      error: authErr
    } = mode === "new" ? await supabase.auth.signUp({
      email,
      password
    }) : await supabase.auth.signInWithPassword({
      email,
      password
    });
    if (authErr) {
      setBusy(false);
      return setError(authErr.message);
    }
    if (!data.session) {
      setBusy(false);
      // signUp() with no error and no session almost always means the Supabase project requires email
      // confirmation before granting one -- the account was created, it just isn't usable yet. Saying that
      // plainly beats a generic "could not sign you in" that gives no indication anything actually happened.
      if (mode === "new" && data.user) {
        // Switch to sign-in mode right here, in place -- the email/password already typed stay filled, so once
        // the student/staff member confirms their email (in another tab) and comes back to THIS tab, clicking
        // "Accept invitation" again signs them in instead of retrying a sign-up that would now just fail.
        setMode("existing");
        return setError("Account created -- check your email to confirm it, then click \"Accept invitation\" again (no need to retype anything).");
      }
      return setError("Could not sign you in. Double-check your email and password.");
    }
    try {
      const res = await fetch(`${API_URL}/api/public/invites/accept`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${data.session.access_token}`
        },
        body: JSON.stringify({
          token
        })
      });
      if (!res.ok) throw new Error(res.status === 404 ? "This invite link is invalid or has expired." : "Something went wrong.");
      const body = await res.json();
      setTenantName(body.tenantName);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }
  if (tenantName) {
    return <AuthCard title="You're in!" subtitle={`You've joined ${tenantName}'s admissions dashboard.`}>
        <a href="/" className="block w-full rounded-lg bg-accent py-2.5 text-center text-sm font-semibold text-white hover:opacity-90">
          Go to dashboard
        </a>
      </AuthCard>;
  }
  return <AuthCard title="Join your team" subtitle="Accept your staff invitation">
      <div className="mb-4 flex gap-2 text-xs">
        <button onClick={() => setMode("new")} className={`rounded-full px-3 py-1 font-semibold ${mode === "new" ? "bg-accent text-white" : "border border-line text-ink-2"}`}>New account</button>
        <button onClick={() => setMode("existing")} className={`rounded-full px-3 py-1 font-semibold ${mode === "existing" ? "bg-accent text-white" : "border border-line text-ink-2"}`}>I already have an account</button>
      </div>
      <form onSubmit={submit}>
        <Field label="Work email" type="email" value={email} onChange={setEmail} placeholder="you@university.edu" required />
        <Field label="Password" type="password" value={password} onChange={setPassword} placeholder="••••••••" hint={mode === "new" ? "At least 8 characters" : undefined} required />
        {error && <p className="mb-4 text-sm" style={{
        color: "var(--chip-rejected-fg)"
      }}>{error}</p>}
        <button type="submit" disabled={busy} className="w-full rounded-lg bg-accent py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60">
          {busy ? "Joining…" : "Accept invitation"}
        </button>
      </form>
    </AuthCard>;
}
export default function AcceptInvitePage() {
  return <Suspense fallback={null}>
      <AcceptInviteForm />
    </Suspense>;
}