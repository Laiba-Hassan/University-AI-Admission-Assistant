"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useStaffSession } from "@/lib/session";

const NAV = [
  { href: "/", label: "Overview", icon: Grid },
  { href: "/conversations", label: "Conversations", icon: Chat },
  { href: "/inbox", label: "Inbox", icon: Inbox },
  { href: "/leads", label: "Leads", icon: UserPlus },
  { href: "/unanswered", label: "Unanswered", icon: Help },
  { href: "/knowledge-base", label: "Knowledge Base", icon: Book },
  { href: "/settings", label: "Settings", icon: Gear },
] as const;

export function Sidebar() {
  const pathname = usePathname();
  const session = useStaffSession();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="side-rail relative">
      <div className="side-panel">
        <Link href="/" className="flex shrink-0 items-center gap-3 px-6 py-5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-accent font-heading text-sm font-semibold text-accent">
            E
          </span>
          <span className="side-label">
            <div className="font-heading text-base font-semibold text-ink">Enrollium</div>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">Admissions AI</div>
          </span>
        </Link>

        <nav className="flex flex-1 flex-col gap-0.5 overflow-hidden py-1">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
            return (
              <Link key={href} href={href} className={`nav-item ${active ? "active" : ""}`}>
                <Icon />
                <span className="side-label">{label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="relative shrink-0 border-t px-3 py-3" style={{ borderColor: "var(--line)" }}>
          <button onClick={() => setMenuOpen((v) => !v)} className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-tint">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-tint text-xs font-semibold text-ink-2">
              {initials(session.email)}
            </span>
            <span className="side-label min-w-0 flex-1">
              <div className="truncate text-[13px] font-medium text-ink">{session.email ?? "Not signed in"}</div>
              <div className="text-[11px] text-muted">{roleLabel(session.role)}</div>
            </span>
          </button>
          {menuOpen && (
            <div className="card side-label absolute bottom-14 left-3 w-56 py-1.5 shadow-lg">
              <MenuLink href="/settings">Account settings</MenuLink>
              <MenuLink href="/settings/notifications">Notifications</MenuLink>
              <MenuLink href="/help">Help &amp; documentation</MenuLink>
              <button onClick={session.signOut} className="block w-full px-4 py-2 text-left text-sm text-ink hover:bg-tint">
                Log out
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MenuLink({ href, children }: { href: string; children: React.ReactNode }) {
  return <Link href={href} className="block px-4 py-2 text-sm text-ink hover:bg-tint">{children}</Link>;
}
const roleLabel = (r?: string) => (r ? `${r[0]!.toUpperCase()}${r.slice(1)}` : "");
const initials = (email?: string) => (email ? email[0]!.toUpperCase() : "?");

function Grid() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>; }
function Chat() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" /></svg>; }
function Inbox() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12" /><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" /></svg>; }
function UserPlus() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="8.5" cy="7" r="4" /><line x1="20" y1="8" x2="20" y2="14" /><line x1="17" y1="11" x2="23" y2="11" /></svg>; }
function Help() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 2-3 4" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>; }
function Book() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></svg>; }
function Gear() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>; }
