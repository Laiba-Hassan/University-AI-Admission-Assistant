"use client";
import { useEffect } from "react";
import { Sidebar } from "@/components/Sidebar";
import { useStaffSession } from "@/lib/session";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = useStaffSession();

  useEffect(() => {
    if (session.status === "signed-out") window.location.href = "/sign-in";
  }, [session.status]);

  if (session.status === "unconfigured") {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-bg px-6 text-center">
        <p className="max-w-sm text-sm text-ink-2">
          Auth isn&apos;t configured yet (missing <code className="rounded bg-tint px-1 py-0.5">NEXT_PUBLIC_SUPABASE_ANON_KEY</code>).
          Set it and reload to sign in.
        </p>
      </div>
    );
  }
  if (session.status === "loading" || session.status === "signed-out") {
    return <div className="flex min-h-dvh items-center justify-center bg-bg" />;
  }

  return (
    <div className="flex min-h-dvh bg-bg">
      <Sidebar />
      <main className="min-w-0 flex-1 px-8 py-7 lg:px-12">{children}</main>
    </div>
  );
}
