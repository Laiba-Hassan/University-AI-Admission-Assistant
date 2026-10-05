"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AuthCard, Field } from "@/components/AuthCard";
import { API_URL } from "@/lib/config";
import { supabase } from "@/lib/supabase";

// Google sign-up lands here: supabase-js auto-parses the access_token out of the URL hash on load and
// establishes the session, same as it does on any other page -- this one's job is just to collect the one
// field Google doesn't give us (university name) and submit the same access_requests row the email/password
// sign-up flow does (apps/dashboard/src/app/sign-up/page.jsx's createAccount).
export default function SignUpCompletePage() {
  const [session, setSession] = useState(undefined); // undefined = still checking, null = none
  const [university, setUniversity] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!supabase) return setSession(null);
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null));
  }, []);

  async function submit(e) {
    e.preventDefault();
    if (!session) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/public/access-requests`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          university_name: university,
          contact_name: session.user.user_metadata?.full_name ?? session.user.email,
          email: session.user.email,
        }),
      });
      if (!res.ok) throw new Error("request_failed");
      setDone(true);
    } catch {
      setError("Couldn't submit your university for review. Try again, or contact support.");
    } finally {
      setBusy(false);
    }
  }

  if (session === undefined) {
    return <AuthCard title="One moment" subtitle="Finishing sign-up…"><p className="text-center text-sm text-muted">…</p></AuthCard>;
  }

  if (!session) {
    return <AuthCard title="Sign-up didn't complete" subtitle="We couldn't find your Google session.">
        <Link href="/sign-up" className="block w-full rounded-lg bg-accent py-2.5 text-center text-sm font-semibold text-white hover:opacity-90">
          Try again
        </Link>
      </AuthCard>;
  }

  if (done) {
    return <AuthCard title="Request submitted" subtitle="We'll review your university and email you once it's approved.">
        <p className="text-center text-sm text-ink-2">
          Signup requests are typically reviewed within a business day. You can sign in once approved.
        </p>
        <Link href="/sign-in" className="mt-6 block w-full rounded-lg bg-accent py-2.5 text-center text-sm font-semibold text-white hover:opacity-90">
          Back to sign in
        </Link>
      </AuthCard>;
  }

  return <AuthCard title="One more thing" subtitle={`Signed up as ${session.user.email}`}>
      <form onSubmit={submit}>
        <Field label="University name" value={university} onChange={setUniversity} placeholder="Fairview College" required />
        {error && <p className="mb-4 text-sm" style={{ color: "var(--chip-rejected-fg)" }}>{error}</p>}
        <button type="submit" disabled={busy} className="w-full rounded-lg bg-accent py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60">
          {busy ? "Submitting…" : "Submit for review"}
        </button>
      </form>
    </AuthCard>;
}
