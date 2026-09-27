"use client";
import { useEffect } from "react";
import { InstallPrompt } from "@/components/InstallPrompt";
import { Sidebar } from "@/components/Sidebar";
import { Toasts } from "@/components/Toasts";
import { useAlerts } from "@/lib/alerts";
import { useStaffSession } from "@/lib/session";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = useStaffSession();
  const alerts = useAlerts(session.status === "ready");

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
    <div className="flex h-dvh overflow-hidden bg-bg">
      <Sidebar onOpenInbox={alerts.clearBadge} />
      <main className="min-w-0 flex-1 overflow-y-auto px-8 py-7 lg:px-12">{children}</main>
      <Toasts toasts={alerts.toasts} onDismiss={alerts.dismiss} />
      <InstallPrompt />
    </div>
  );
}
