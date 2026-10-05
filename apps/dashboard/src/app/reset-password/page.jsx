"use client";

import { useState } from "react";
import { AuthCard, Field } from "@/components/AuthCard";
import { supabase } from "@/lib/supabase";
export default function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  // Supabase's own redirect from the emailed link puts a recovery session in the URL hash and its client picks
  // it up automatically (detectSessionInUrl); by the time this form submits there is already an active session
  // to update, so this is just supabase.auth.updateUser -- no separate token to read or verify here.
  async function submit(e) {
    e.preventDefault();
    if (!supabase) return setError("Auth is not configured yet.");
    if (password.length < 8) return setError("Password must be at least 8 characters.");
    setBusy(true);
    setError(null);
    const {
      error: err
    } = await supabase.auth.updateUser({
      password
    });
    setBusy(false);
    if (err) return setError(err.message);
    setDone(true);
  }
  if (done) {
    return <AuthCard title="Password updated" subtitle="You can now sign in with your new password.">
        <a href="/sign-in" className="block w-full rounded-lg bg-accent py-2.5 text-center text-sm font-semibold text-white hover:opacity-90">
          Go to sign in
        </a>
      </AuthCard>;
  }
  return <AuthCard title="Choose a new password" subtitle="At least 8 characters">
      <form onSubmit={submit}>
        <Field label="New password" type="password" value={password} onChange={setPassword} placeholder="••••••••" required />
        {error && <p className="mb-4 text-sm" style={{
        color: "var(--chip-rejected-fg)"
      }}>{error}</p>}
        <button type="submit" disabled={busy} className="w-full rounded-lg bg-accent py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60">
          {busy ? "Saving…" : "Save password"}
        </button>
      </form>
    </AuthCard>;
}