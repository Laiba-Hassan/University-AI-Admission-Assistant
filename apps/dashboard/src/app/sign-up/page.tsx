"use client";
import Link from "next/link";
import { useState } from "react";
import { AuthCard, Divider, Field, GoogleButton } from "@/components/AuthCard";
import { supabase } from "@/lib/supabase";
import { API_URL } from "@/lib/config";

export default function SignUpPage() {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [university, setUniversity] = useState("");
  const [password, setPassword] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function createAccount(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase) return setError("Auth is not configured yet -- ask your admin to set NEXT_PUBLIC_SUPABASE_ANON_KEY.");
    if (!agreed) return setError("Please agree to the Terms of Service and Privacy Policy.");
    setBusy(true);
    setError(null);
    const { error: signUpErr } = await supabase.auth.signUp({ email, password });
    if (signUpErr) { setBusy(false); return setError(signUpErr.message); }
    try {
      const res = await fetch(`${API_URL}/api/public/access-requests`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ university_name: university, contact_name: fullName, email }),
      });
      if (!res.ok) throw new Error("request_failed");
      setDone(true);
    } catch {
      setError("Your account was created, but we couldn't submit your university for review. Contact support.");
    } finally {
      setBusy(false);
    }
  }

  async function signUpWithGoogle() {
    if (!supabase) return setError("Auth is not configured yet -- ask your admin to set NEXT_PUBLIC_SUPABASE_ANON_KEY.");
    await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: `${window.location.origin}/sign-up/complete` } });
  }

  if (done) {
    return (
      <AuthCard title="Request submitted" subtitle="We'll review your university and email you once it's approved.">
        <p className="text-center text-sm text-ink-2">
          Signup requests are typically reviewed within a business day. You can sign in once approved.
        </p>
        <Link href="/sign-in" className="mt-6 block w-full rounded-lg bg-accent py-2.5 text-center text-sm font-semibold text-white hover:opacity-90">
          Back to sign in
        </Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Create your account" subtitle="Set up Enrollium for your university">
      <GoogleButton onClick={signUpWithGoogle} />
      <Divider text="or continue with email" />
      <form onSubmit={createAccount}>
        <Field label="Full name" value={fullName} onChange={setFullName} placeholder="Sana Malik" required />
        <Field label="Work email" type="email" value={email} onChange={setEmail} placeholder="sana@fairview.edu" required />
        <Field label="University name" value={university} onChange={setUniversity} placeholder="Fairview College" required />
        <Field label="Password" type="password" value={password} onChange={setPassword} placeholder="••••••••" hint="At least 8 characters" required />
        <label className="mb-4 flex items-start gap-2 text-xs text-ink-2">
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-0.5" />
          <span>
            I agree to the <Link href="/legal/terms" className="font-semibold text-accent hover:underline">Terms of Service</Link> and{" "}
            <Link href="/legal/privacy" className="font-semibold text-accent hover:underline">Privacy Policy</Link>
          </span>
        </label>
        {error && <p className="mb-4 text-sm" style={{ color: "var(--chip-rejected-fg)" }}>{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-lg bg-accent py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
        >
          {busy ? "Creating account…" : "Create account"}
        </button>
      </form>
      <p className="mt-5 text-center text-sm text-ink-2">
        Already have an account? <Link href="/sign-in" className="font-semibold text-accent hover:underline">Sign in</Link>
      </p>
    </AuthCard>
  );
}
