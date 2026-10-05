"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useSidebarCounts } from "@/lib/alerts";
import { displayName } from "@/lib/names";
import { useStaffSession } from "@/lib/session";
import { AccountSettingsModal, HelpModal, LogoutConfirmModal, NotificationsModal } from "@/components/ProfileModals";
// Stripe's SDK is pulled in by PlanModal -- every other dashboard page would otherwise ship it in its bundle
// just because Sidebar renders on all of them. Loaded only once someone actually opens the modal.
const PlanModal = dynamic(() => import("@/components/PlanModal").then(m => m.PlanModal), { ssr: false });
const NAV = [{
  href: "/",
  label: "Overview",
  icon: Grid
}, {
  href: "/conversations",
  label: "Conversations",
  icon: Chat
}, {
  href: "/inbox",
  label: "Inbox",
  icon: Inbox,
  badgeKey: "inbox"
}, {
  href: "/leads",
  label: "Leads",
  icon: UserPlus
}, {
  href: "/unanswered",
  label: "Unanswered",
  icon: Help,
  badgeKey: "unanswered"
}, {
  href: "/knowledge-base",
  label: "Knowledge Base",
  icon: Book
}, {
  href: "/settings",
  label: "Settings",
  icon: Gear
}];
export function Sidebar({
  onOpenInbox
}) {
  const pathname = usePathname();
  const session = useStaffSession();
  const counts = useSidebarCounts(session.status === "ready");
  const [menuOpen, setMenuOpen] = useState(false);
  const [modal, setModal] = useState(null);
  return <div className="side-rail relative" onMouseLeave={() => setMenuOpen(false)}>
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

        <div className="side-label mx-3 mb-2 mt-3 shrink-0">
          <div className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 hover:bg-tint">
            {session.tenantLogo ? <img src={session.tenantLogo} alt="" className="h-7 w-7 shrink-0 rounded-full border border-line bg-white object-contain" /> : <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-tint text-[11px] font-semibold text-ink-2">
                {tenantInitials(session.tenantName)}
              </span>}
            <span className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-semibold text-ink">{session.tenantName ?? "—"}</div>
              <div className="truncate text-[11px] capitalize text-muted">{planLabelText(session.planLabel)}</div>
            </span>
          </div>
        </div>

        <nav className="flex flex-1 flex-col gap-0.5 overflow-hidden py-1">
          {NAV.map(({
          href,
          label,
          icon: Icon,
          badgeKey
        }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          const badge = badgeKey ? counts[badgeKey] : 0;
          return <Link key={href} href={href} onClick={href === "/inbox" ? onOpenInbox : undefined} className={`nav-item ${active ? "active" : ""}`}>
                <Icon />
                <span className="side-label">{label}</span>
                {badge > 0 && <span className="side-badge ml-auto h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold leading-none text-white">{badge}</span>}
              </Link>;
        })}
        </nav>

        <div className="relative shrink-0 border-t px-3 py-3" style={{
        borderColor: "var(--line)"
      }}>
          <div className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-tint">
            <button onClick={() => setMenuOpen(v => !v)} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
              {session.avatarUrl ? <img src={session.avatarUrl} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover" /> : <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-tint text-xs font-semibold text-ink-2">
                  {initials(session.email)}
                </span>}
              <span className="side-label min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-[13px] font-semibold text-ink">{displayName(session)}</span>
                  {session.role && <span className="chip chip-draft shrink-0 text-[9px]">{session.role.toUpperCase()}</span>}
                </div>
                <div className="truncate text-[11px] text-muted">{roleLabel(session.role)}</div>
              </span>
            </button>
            <button onClick={() => setMenuOpen(v => !v)} className="side-label shrink-0 px-1 text-ink-2 hover:text-ink" aria-label="Profile menu">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="12" cy="19" r="1.6" /></svg>
            </button>
          </div>
        </div>
      </div>

      {/* A sibling of .side-panel, not a child of it: .side-panel has overflow:hidden and only widens to 252px
         on hover, but this menu is wide enough that nested inside .side-panel its right edge (rounded corner
         included) was clipped off. .side-rail (this component's own root, position:relative) is the same
         positioning anchor either way, so this keeps the same bottom-16/left-3 placement while actually
         rendering as a complete, fully-rounded box. Width is 252px (the hover-expanded panel) minus the 12px
         side margins on both sides, so the menu sits fully inside the panel instead of overlapping the main
         content next to it. */}
      {menuOpen && <div className="card side-label absolute bottom-16 left-3 w-[228px] py-1.5 shadow-lg" style={{ zIndex: 40 }}>
          <div className="border-b border-line px-4 py-3">
            <div className="text-sm font-semibold text-ink">{displayName(session)}</div>
            <div className="truncate text-xs text-muted">{session.email}</div>
          </div>
          <div className="py-1">
            <MenuButton icon={<GearIcon />} onClick={() => {
          setMenuOpen(false);
          setModal("account");
        }}>Account settings</MenuButton>
            <MenuButton icon={<BellIcon />} onClick={() => {
          setMenuOpen(false);
          setModal("notifications");
        }}>Notifications</MenuButton>
            <MenuButton icon={<CardIcon />} onClick={() => {
          setMenuOpen(false);
          setModal("plan");
        }}>Update plan</MenuButton>
            <MenuButton icon={<HelpIcon />} onClick={() => {
          setMenuOpen(false);
          setModal("help");
        }}>Help &amp; documentation</MenuButton>
          </div>
          <div className="border-t border-line py-1">
            <MenuButton icon={<LogoutIcon />} onClick={() => {
          setMenuOpen(false);
          setModal("logout");
        }}>Log out</MenuButton>
          </div>
        </div>}

      {modal === "account" && <AccountSettingsModal session={session} onClose={() => setModal(null)} />}
      {modal === "notifications" && <NotificationsModal onClose={() => setModal(null)} />}
      {modal === "plan" && <PlanModal session={session} onClose={() => setModal(null)} />}
      {modal === "help" && <HelpModal onClose={() => setModal(null)} />}
      {modal === "logout" && <LogoutConfirmModal tenantName={session.tenantName} onClose={() => setModal(null)} onConfirm={session.signOut} />}
    </div>;
}
function MenuButton({
  icon,
  onClick,
  children
}) {
  return <button onClick={onClick} className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm text-ink hover:bg-tint">
      <span className="text-ink-2">{icon}</span>
      {children}
    </button>;
}
const roleLabel = r => r === "admin" ? "Admissions Admin" : r === "editor" ? "Admissions Editor" : r === "viewer" ? "Admissions Viewer" : "";
const initials = email => email ? email[0].toUpperCase() : "?";
const tenantInitials = name => name ? name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join("") : "—";
// tenants.plan_label is 'demo' | 'starter' | 'growth' once a real choice has been made (billing.ts); a brand-new
// tenant that hasn't finished onboarding yet still carries the schema default 'trial'.
const planLabelText = label => label === "demo" ? "Demo plan" : label === "starter" ? "Starter plan" : label === "growth" ? "Growth plan" : "Trial";
function CardIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="1" y="4" width="22" height="16" rx="2" /><line x1="1" y1="10" x2="23" y2="10" /></svg>;
}
function Grid() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>;
}
function Chat() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" /></svg>;
}
function Inbox() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12" /><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" /></svg>;
}
function UserPlus() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="8.5" cy="7" r="4" /><line x1="20" y1="8" x2="20" y2="14" /><line x1="17" y1="11" x2="23" y2="11" /></svg>;
}
function Help() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <text x="12" y="16.3" textAnchor="middle" fontSize="12" fontWeight="700" fill="currentColor" stroke="none" fontFamily="system-ui, sans-serif">?</text>
    </svg>;
}
function Book() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></svg>;
}
function Gear() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>;
}
function GearIcon() {
  return <Gear />;
}
function HelpIcon() {
  return <Help />;
}
function BellIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></svg>;
}
function LogoutIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>;
}