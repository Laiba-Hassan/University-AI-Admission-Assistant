"use client";

import { useEffect } from "react";
import { PlatformSidebar } from "@/components/PlatformSidebar";
import { PlatformSessionProvider, usePlatformSession } from "@/lib/platform-session";
export default function PlatformLayout({
  children
}) {
  return <PlatformSessionProvider><PlatformShell>{children}</PlatformShell></PlatformSessionProvider>;
}
function PlatformShell({
  children
}) {
  const session = usePlatformSession();
  useEffect(() => {
    if (session.status === "signed-out") window.location.href = "/platform-sign-in";
  }, [session.status]);
  if (session.status === "unconfigured") {
    return <div className="flex min-h-dvh items-center justify-center bg-bg px-6 text-center">
        <p className="max-w-sm text-sm text-ink-2">
          Auth isn&apos;t configured yet (missing <code className="rounded bg-tint px-1 py-0.5">NEXT_PUBLIC_SUPABASE_ANON_KEY</code>).
        </p>
      </div>;
  }
  if (session.status === "forbidden") {
    return <div className="flex min-h-dvh items-center justify-center bg-bg px-6 text-center">
        <div className="max-w-sm">
          <p className="text-sm text-ink-2">
            You&apos;re signed in, but this account isn&apos;t a platform admin. Ask an existing platform admin to add you.
          </p>
          <button onClick={session.signOut} className="mt-4 rounded-lg border border-line px-4 py-2 text-sm font-semibold text-ink hover:bg-tint">Sign out</button>
        </div>
      </div>;
  }
  if (session.status === "loading" || session.status === "signed-out") {
    return <div className="flex min-h-dvh items-center justify-center bg-bg" />;
  }
  return <div className="flex h-dvh overflow-hidden bg-bg">
      <PlatformSidebar session={session} />
      <main className="min-w-0 flex-1 overflow-y-auto px-8 py-7 lg:px-12">{children}</main>
    </div>;
}