"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { PlatformSession } from "@/lib/platform-session";

// Same hover-expand icon rail as the tenant dashboard's Sidebar.tsx (.side-rail/.side-panel/.side-label), with
// the section set from Enrollium_Super_Admin_Dashboard.pdf's own overview page: Tenants, Usage & Cost, Billing,
// Tenant Support, Platform Health, Settings, Audit Log.
const NAV = [
  { href: "/platform/tenants", label: "Tenants", icon: Home },
  { href: "/platform/usage-cost", label: "Usage & Cost", icon: BarChart },
  { href: "/platform/billing", label: "Billing", icon: Card },
  { href: "/platform/support", label: "Tenant Support", icon: ShieldCheck },
  { href: "/platform/health", label: "Platform Health", icon: Activity },
  { href: "/platform/settings", label: "Settings", icon: Gear },
  { href: "/platform/audit-log", label: "Audit Log", icon: Clipboard },
] as const;

export function PlatformSidebar({ session }: { session: PlatformSession }) {
  const pathname = usePathname();
  return (
    <div className="side-rail relative">
      <div className="side-panel">
        <Link href="/platform/tenants" className="flex shrink-0 items-center gap-3 px-6 py-5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-accent font-heading text-sm font-semibold text-accent">E</span>
          <span className="side-label">
            <div className="font-heading text-base font-semibold text-ink">Enrollium</div>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">Platform Admin</div>
          </span>
        </Link>

        <nav className="flex flex-1 flex-col gap-0.5 overflow-hidden py-1">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || pathname.startsWith(href + "/");
            return (
              <Link key={href} href={href} className={`nav-item ${active ? "active" : ""}`}>
                <Icon />
                <span className="side-label">{label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="relative shrink-0 border-t px-3 py-3" style={{ borderColor: "var(--line)" }}>
          <div className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-tint text-xs font-semibold text-ink-2">
              {session.email ? session.email[0]!.toUpperCase() : "?"}
            </span>
            <span className="side-label min-w-0 flex-1">
              <div className="truncate text-[13px] font-semibold text-ink">{session.email ?? "—"}</div>
              <div className="text-[11px] text-muted">Super Admin</div>
            </span>
            <button onClick={session.signOut} className="side-label shrink-0 text-ink-2 hover:text-ink" aria-label="Sign out" title="Sign out">
              <LogoutIcon />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Home() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 9.5 12 3l9 6.5" /><path d="M5 10v10a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V10" /></svg>; }
function BarChart() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /></svg>; }
function Card() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="5" width="20" height="14" rx="2" /><line x1="2" y1="10" x2="22" y2="10" /></svg>; }
function ShieldCheck() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="m9 12 2 2 4-4" /></svg>; }
function Activity() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></svg>; }
function Gear() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>; }
function Clipboard() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="8" y="2" width="8" height="4" rx="1" /><path d="M9 4H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-4" /></svg>; }
function LogoutIcon() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>; }
