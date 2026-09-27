"use client";
import { useEffect, useState } from "react";
import { Modal, ToggleSwitch } from "@/components/Modal";
import { isPushSubscribed, pushSupported, subscribeToPush, unsubscribeFromPush } from "@/lib/push";
import type { StaffSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";

/** Account settings (Part 6/7 of the reference: opens as a modal from the profile menu, not a route). Email and
 * role come from the real session; full name/photo have no backend field yet, so they're shown but not
 * persisted -- see the Phase-5-fidelity report for that gap. Change password is real (supabase auth). */
export function AccountSettingsModal({ session, onClose }: { session: StaffSession; onClose: () => void }) {
  const [fullName, setFullName] = useState(session.email?.split("@")[0] ?? "");
  const [changingPassword, setChangingPassword] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    setStatus(null);
    try {
      if (changingPassword && password) {
        if (password.length < 8) { setStatus("Password must be at least 8 characters."); return; }
        if (password !== confirm) { setStatus("Passwords don't match."); return; }
        const { error } = await supabase!.auth.updateUser({ password });
        if (error) { setStatus(error.message); return; }
        setPassword(""); setConfirm(""); setChangingPassword(false);
      }
      setStatus("Saved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Account settings"
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className="rounded-lg border border-line px-4 py-2 text-sm font-semibold text-ink hover:bg-tint">Cancel</button>
          <button onClick={save} disabled={busy} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60">
            {busy ? "Saving…" : "Save changes"}
          </button>
        </>
      }
    >
      <div className="flex items-center gap-3">
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-tint text-lg font-semibold text-ink-2">
          {(session.email ?? "?")[0]!.toUpperCase()}
        </span>
        <div>
          <button type="button" className="text-sm font-semibold text-accent hover:underline" title="Photo upload isn't wired up yet">Change photo</button>
          <p className="text-xs text-muted">JPG or PNG, up to 2MB</p>
        </div>
      </div>

      <label className="mt-5 block">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted">Full name</span>
        <input value={fullName} onChange={(e) => setFullName(e.target.value)} className="mt-1.5 w-full rounded-lg border border-line bg-surface px-3.5 py-2.5 text-sm text-ink focus:border-accent focus:outline-none" />
      </label>

      <label className="mt-4 block">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted">Email</span>
        <input value={session.email ?? ""} disabled className="mt-1.5 w-full rounded-lg border border-line bg-tint px-3.5 py-2.5 text-sm text-ink-2" />
      </label>

      <div className="mt-4">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted">Role</span>
        <p className="mt-1.5 text-sm text-ink">
          {roleLabel(session.role)} · <span className="chip chip-draft">{(session.role ?? "").toUpperCase()}</span>
        </p>
      </div>

      <div className="mt-4">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted">Password</span>
        {!changingPassword ? (
          <div className="mt-1.5">
            <button onClick={() => setChangingPassword(true)} className="rounded-lg border border-line px-3.5 py-2 text-sm font-medium text-ink hover:bg-tint">Change password</button>
          </div>
        ) : (
          <div className="mt-1.5 space-y-2">
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="New password" className="w-full rounded-lg border border-line bg-surface px-3.5 py-2.5 text-sm text-ink focus:border-accent focus:outline-none" />
            <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Confirm new password" className="w-full rounded-lg border border-line bg-surface px-3.5 py-2.5 text-sm text-ink focus:border-accent focus:outline-none" />
          </div>
        )}
      </div>
      {status && <p className="mt-3 text-xs text-ink-2">{status}</p>}
    </Modal>
  );
}

const roleLabel = (r?: string) => (r === "admin" ? "Admissions Admin" : r === "editor" ? "Admissions Editor" : r === "viewer" ? "Admissions Viewer" : "");

/** Notification preferences. "Desktop notifications" is real: it subscribes/unsubscribes this browser for web
 * push (PRD 6A) via lib/push.ts. Settings > Team shows the per-staff notify_leads/notify_handoffs columns this
 * account already has (read-only there); email/digest/sound have no backend field yet and stay a per-viewer
 * localStorage convenience until one exists. */
export function NotificationsModal({ onClose }: { onClose: () => void }) {
  const [prefs, setPrefs] = useState(() => readLocalPrefs());
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);

  useEffect(() => {
    if (!pushSupported()) return;
    void isPushSubscribed().then((sub) => setPrefs((p) => ({ ...p, desktop: sub })));
  }, []);

  async function toggleDesktop(next: boolean) {
    setPushError(null);
    if (!pushSupported()) { setPushError("Push notifications aren't supported in this browser."); return; }
    setPushBusy(true);
    try {
      if (next) {
        const result = await subscribeToPush();
        if (!result.ok) { setPushError(result.error); return; }
      } else {
        await unsubscribeFromPush();
      }
      setPrefs((p) => ({ ...p, desktop: next }));
    } finally {
      setPushBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    try {
      writeLocalPrefs(prefs);
      setStatus("Saved.");
      setTimeout(onClose, 400);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Notification preferences"
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className="rounded-lg border border-line px-4 py-2 text-sm font-semibold text-ink hover:bg-tint">Cancel</button>
          <button onClick={save} disabled={busy} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60">
            {busy ? "Saving…" : "Save changes"}
          </button>
        </>
      }
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">Email</p>
      <div className="mt-2 divide-y divide-line">
        <Row label="New lead captured" checked={prefs.newLead} onChange={(v) => setPrefs((p) => ({ ...p, newLead: v }))} />
        <Row label="Conversation escalated to me" checked={prefs.escalated} onChange={(v) => setPrefs((p) => ({ ...p, escalated: v }))} />
        <Row label="Weekly summary digest" checked={prefs.weeklyDigest} onChange={(v) => setPrefs((p) => ({ ...p, weeklyDigest: v }))} />
      </div>
      <p className="mt-5 text-xs font-semibold uppercase tracking-wide text-muted">In-app</p>
      <div className="mt-2 divide-y divide-line">
        <Row label="Desktop notifications" checked={prefs.desktop} onChange={toggleDesktop} disabled={pushBusy} />
        <Row label="Sound alerts" checked={prefs.sound} onChange={(v) => setPrefs((p) => ({ ...p, sound: v }))} />
      </div>
      {pushError && <p className="mt-2 text-xs" style={{ color: "var(--chip-rejected-fg)" }}>{pushError}</p>}
      {status && <p className="mt-3 text-xs text-ink-2">{status}</p>}
    </Modal>
  );
}

function Row({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className="flex items-center justify-between py-3">
      <span className="text-sm text-ink">{label}</span>
      <ToggleSwitch checked={checked} onChange={onChange} disabled={disabled} />
    </div>
  );
}

interface LocalPrefs { newLead: boolean; escalated: boolean; weeklyDigest: boolean; desktop: boolean; sound: boolean }
const PREFS_KEY = "enrollium-notification-prefs";
function readLocalPrefs(): LocalPrefs {
  const fallback: LocalPrefs = { newLead: true, escalated: true, weeklyDigest: false, desktop: true, sound: false };
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}
function writeLocalPrefs(p: LocalPrefs) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch { /* private window, etc. */ }
}

const HELP_ARTICLES = [
  { title: "Getting started with Enrollium", desc: "Set up your first tenant, channels and Knowledge Base" },
  { title: "Connecting WhatsApp Business", desc: "Templates, approval status and phone number setup" },
  { title: "Customizing your Knowledge Base", desc: "Import, verify and keep fee & deadline answers current" },
  { title: "Understanding conversation analytics", desc: "What handoff rate, verified reply rate and volume trend mean" },
  { title: "Inviting and managing your team", desc: "Roles, alert permissions and viewer access" },
  { title: "Data retention & privacy", desc: "How long transcripts are kept and how to export or delete data" },
];

export function HelpModal({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState("");
  const filtered = HELP_ARTICLES.filter((a) => `${a.title} ${a.desc}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <Modal
      title="Help & documentation"
      onClose={onClose}
      width={560}
      footer={
        <>
          <span className="mr-auto text-xs text-muted">Still stuck? We reply within a few hours.</span>
          <a href="mailto:support@enrollium.app" className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:opacity-90">Contact support</a>
        </>
      }
    >
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search help articles…"
        className="w-full rounded-lg border border-line bg-surface px-3.5 py-2.5 text-sm text-ink placeholder:text-muted focus:border-accent focus:outline-none"
      />
      <div className="mt-3 divide-y divide-line">
        {filtered.map((a) => (
          <div key={a.title} className="py-3">
            <div className="text-sm font-semibold text-ink">{a.title}</div>
            <div className="text-xs text-ink-2">{a.desc}</div>
          </div>
        ))}
        {filtered.length === 0 && <p className="py-4 text-sm text-muted">No articles match &ldquo;{q}&rdquo;.</p>}
      </div>
    </Modal>
  );
}

export function LogoutConfirmModal({ tenantName, onClose, onConfirm }: { tenantName?: string; onClose: () => void; onConfirm: () => void }) {
  return (
    <Modal
      title="Log out of Enrollium?"
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className="rounded-lg border border-line px-4 py-2 text-sm font-semibold text-ink hover:bg-tint">Cancel</button>
          <button onClick={onConfirm} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:opacity-90">Log out</button>
        </>
      }
    >
      <p className="text-sm text-ink-2">You&apos;ll need to sign in again to access the {tenantName ?? "tenant"} dashboard.</p>
    </Modal>
  );
}
