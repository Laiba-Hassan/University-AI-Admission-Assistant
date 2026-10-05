"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { EyeIcon, EyeOffIcon } from "@/components/AuthCard";
import { Modal, ToggleSwitch } from "@/components/Modal";
import { apiFetch } from "@/lib/api";
import { canInstall, promptInstall, subscribeInstallPrompt } from "@/lib/installPrompt";
import { nameFromEmail } from "@/lib/names";
import { isPushSubscribed, pushSupported, subscribeToPush, unsubscribeFromPush } from "@/lib/push";
import { supabase } from "@/lib/supabase";

/** Account settings (Part 6/7 of the reference: opens as a modal from the profile menu, not a route). Email and
 * role come from the real session; full name has no backend field yet, so it's shown but not persisted. Photo is
 * real (PATCH /api/v1/me, same base64-data-URL pattern as the tenant branding logo). Change password is real
 * (supabase auth). */
export function AccountSettingsModal({
  session,
  onClose
}) {
  const [fullName, setFullName] = useState(session.fullName ?? nameFromEmail(session.email));
  const [changingPassword, setChangingPassword] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [photoError, setPhotoError] = useState(null);
  const [requestingPassword, setRequestingPassword] = useState(false);
  const [revealPassword, setRevealPassword] = useState(false);
  const fileInputRef = useRef(null);
  async function requestPasswordChange() {
    setRequestingPassword(true);
    try {
      await apiFetch("/api/v1/me/password-change-request", {
        method: "POST"
      });
      session.setPasswordChangeStatus?.("pending");
    } finally {
      setRequestingPassword(false);
    }
  }
  async function onPhotoChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) return setPhotoError("Please choose an image file.");
    if (file.size > 300 * 1024) return setPhotoError("Keep the photo under 300KB.");
    setPhotoError(null);
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = String(reader.result ?? "");
      await apiFetch("/api/v1/me", {
        method: "PATCH",
        body: JSON.stringify({
          avatar_url: dataUrl
        })
      });
      session.setAvatarUrl?.(dataUrl);
    };
    reader.readAsDataURL(file);
  }
  async function removePhoto() {
    await apiFetch("/api/v1/me", {
      method: "PATCH",
      body: JSON.stringify({
        avatar_url: null
      })
    });
    session.setAvatarUrl?.(null);
  }
  async function save() {
    setBusy(true);
    setStatus(null);
    try {
      const trimmedName = fullName.trim();
      if (trimmedName && trimmedName !== (session.fullName ?? "")) {
        await apiFetch("/api/v1/me", {
          method: "PATCH",
          body: JSON.stringify({ full_name: trimmedName })
        });
        session.setFullName?.(trimmedName);
      }
      if (changingPassword && password) {
        if (password.length < 8) {
          setStatus("Password must be at least 8 characters.");
          return;
        }
        if (password !== confirm) {
          setStatus("Passwords don't match.");
          return;
        }
        const {
          error
        } = await supabase.auth.updateUser({
          password
        });
        if (error) {
          setStatus(error.message);
          return;
        }
        // Our backend has no visibility into that supabase call (it never touches this API) -- this tells it
        // "the approved change just actually happened" so the one-time approval gets consumed, not left standing.
        // Applies to every role now -- an Admin's own password is gated by the platform team exactly the same way.
        await apiFetch("/api/v1/me/password-change-consumed", {
          method: "POST"
        });
        session.setPasswordChangeStatus?.("none");
        setPassword("");
        setConfirm("");
        setChangingPassword(false);
      }
      setStatus("Saved.");
    } finally {
      setBusy(false);
    }
  }
  return <Modal title="Account settings" onClose={onClose} footer={<>
          <button onClick={onClose} className="rounded-lg border border-line px-4 py-2 text-sm font-semibold text-ink hover:bg-tint">Cancel</button>
          <button onClick={save} disabled={busy} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60">
            {busy ? "Saving…" : "Save changes"}
          </button>
        </>}>
      <div className="flex items-center gap-3">
        {session.avatarUrl ? <img src={session.avatarUrl} alt="" className="h-14 w-14 shrink-0 rounded-full object-cover" /> : <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-tint text-lg font-semibold text-ink-2">
            {(session.email ?? "?")[0].toUpperCase()}
          </span>}
        <div>
          <button type="button" onClick={() => fileInputRef.current?.click()} className="text-sm font-semibold text-accent hover:underline">{session.avatarUrl ? "Change photo" : "Upload photo"}</button>
          {session.avatarUrl && <button type="button" onClick={removePhoto} className="ml-3 text-sm font-semibold text-ink-2 hover:underline">Remove</button>}
          <input ref={fileInputRef} type="file" accept="image/*" onChange={onPhotoChange} className="hidden" />
          <p className="text-xs text-muted">JPG or PNG, up to 300KB</p>
          {photoError && <p className="text-xs" style={{
          color: "var(--chip-rejected-fg)"
        }}>{photoError}</p>}
        </div>
      </div>

      <label className="mt-5 block">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted">Full name</span>
        <input value={fullName} onChange={e => setFullName(e.target.value)} className="mt-1.5 w-full rounded-lg border border-line bg-surface px-3.5 py-2.5 text-sm text-ink focus:border-accent focus:outline-none" />
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
        {session.passwordChangeStatus === "pending" ? <p className="mt-1.5 text-sm text-ink-2">
            Request sent — waiting for {session.role === "admin" ? "the platform admin" : "an admin"} to approve it.
          </p> : session.passwordChangeStatus !== "approved" ? <div className="mt-1.5">
            <button onClick={requestPasswordChange} disabled={requestingPassword} className="rounded-lg border border-line px-3.5 py-2 text-sm font-medium text-ink hover:bg-tint disabled:opacity-60">
              {requestingPassword ? "Requesting…" : "Request permission to change password"}
            </button>
            <p className="mt-1.5 text-xs text-muted">{session.role === "admin" ? "Admins need the platform admin to approve a password change before making one." : "Editors and Viewers need an Admin to approve a password change before making one."}</p>
          </div> : !changingPassword ? <div className="mt-1.5">
            <button onClick={() => setChangingPassword(true)} className="rounded-lg border border-line px-3.5 py-2 text-sm font-medium text-ink hover:bg-tint">Change password</button>
            <p className="mt-1.5 text-xs text-muted">{session.role === "admin" ? "The platform admin approved your request" : "An admin approved your request"} — this is a one-time use.</p>
          </div> : <div className="mt-1.5 space-y-2">
            <span className="relative block">
              <input type={revealPassword ? "text" : "password"} value={password} onChange={e => setPassword(e.target.value)} placeholder="New password" className="w-full rounded-lg border border-line bg-surface px-3.5 py-2.5 pr-10 text-sm text-ink focus:border-accent focus:outline-none" />
              <button type="button" onClick={() => setRevealPassword(r => !r)} tabIndex={-1} aria-label={revealPassword ? "Hide password" : "Show password"} className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted hover:text-ink-2">
                {revealPassword ? <EyeOffIcon /> : <EyeIcon />}
              </button>
            </span>
            <span className="relative block">
              <input type={revealPassword ? "text" : "password"} value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="Confirm new password" className="w-full rounded-lg border border-line bg-surface px-3.5 py-2.5 pr-10 text-sm text-ink focus:border-accent focus:outline-none" />
            </span>
          </div>}
      </div>
      {status && <p className="mt-3 text-xs text-ink-2">{status}</p>}
    </Modal>;
}
const roleLabel = r => r === "admin" ? "Admissions Admin" : r === "editor" ? "Admissions Editor" : r === "viewer" ? "Admissions Viewer" : "";

/** Notification preferences. "Desktop notifications" is real: it subscribes/unsubscribes this browser for web
 * push (PRD 6A) via lib/push.ts. Settings > Team shows the per-staff notify_leads/notify_handoffs columns this
 * account already has (read-only there); email/digest/sound have no backend field yet and stay a per-viewer
 * localStorage convenience until one exists. */
export function NotificationsModal({
  onClose
}) {
  const [prefs, setPrefs] = useState(() => readLocalPrefs());
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushError, setPushError] = useState(null);
  const installable = useSyncExternalStore(subscribeInstallPrompt, canInstall, () => false);
  const standalone = typeof window !== "undefined" && window.matchMedia?.("(display-mode: standalone)").matches;
  useEffect(() => {
    if (!pushSupported()) return;
    void isPushSubscribed().then(sub => setPrefs(p => ({
      ...p,
      desktop: sub
    })));
  }, []);
  async function toggleDesktop(next) {
    setPushError(null);
    if (!pushSupported()) {
      setPushError("Push notifications aren't supported in this browser.");
      return;
    }
    setPushBusy(true);
    try {
      if (next) {
        const result = await subscribeToPush();
        if (!result.ok) {
          setPushError(result.error);
          return;
        }
      } else {
        await unsubscribeFromPush();
      }
      setPrefs(p => ({
        ...p,
        desktop: next
      }));
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
  return <Modal title="Notification preferences" onClose={onClose} footer={<>
          <button onClick={onClose} className="rounded-lg border border-line px-4 py-2 text-sm font-semibold text-ink hover:bg-tint">Cancel</button>
          <button onClick={save} disabled={busy} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60">
            {busy ? "Saving…" : "Save changes"}
          </button>
        </>}>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">Email</p>
      <div className="mt-2 divide-y divide-line">
        <Row label="New lead captured" checked={prefs.newLead} onChange={v => setPrefs(p => ({
        ...p,
        newLead: v
      }))} />
        <Row label="Conversation escalated to me" checked={prefs.escalated} onChange={v => setPrefs(p => ({
        ...p,
        escalated: v
      }))} />
        <Row label="Weekly summary digest" checked={prefs.weeklyDigest} onChange={v => setPrefs(p => ({
        ...p,
        weeklyDigest: v
      }))} />
      </div>
      <p className="mt-5 text-xs font-semibold uppercase tracking-wide text-muted">In-app</p>
      <div className="mt-2 divide-y divide-line">
        <Row label="Desktop notifications" checked={prefs.desktop} onChange={toggleDesktop} disabled={pushBusy} />
        <Row label="Sound alerts" checked={prefs.sound} onChange={v => setPrefs(p => ({
        ...p,
        sound: v
      }))} />
        {!standalone && <div className="flex items-center justify-between py-3">
            <div>
              <span className="text-sm text-ink">Install Enrollium on this device</span>
              {!installable && <p className="mt-0.5 text-xs text-muted">Not offered by this browser yet — look for an install icon in the address bar, or ⋯ menu → Install app.</p>}
            </div>
            {installable && <button type="button" onClick={() => promptInstall()} className="shrink-0 rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-ink hover:bg-tint">Install</button>}
          </div>}
      </div>
      {pushError && <p className="mt-2 text-xs" style={{
      color: "var(--chip-rejected-fg)"
    }}>{pushError}</p>}
      {status && <p className="mt-3 text-xs text-ink-2">{status}</p>}
    </Modal>;
}
function Row({
  label,
  checked,
  onChange,
  disabled
}) {
  return <div className="flex items-center justify-between py-3">
      <span className="text-sm text-ink">{label}</span>
      <ToggleSwitch checked={checked} onChange={onChange} disabled={disabled} />
    </div>;
}
const PREFS_KEY = "enrollium-notification-prefs";
function readLocalPrefs() {
  const fallback = {
    newLead: true,
    escalated: true,
    weeklyDigest: false,
    desktop: true,
    sound: false
  };
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return raw ? {
      ...fallback,
      ...JSON.parse(raw)
    } : fallback;
  } catch {
    return fallback;
  }
}
function writeLocalPrefs(p) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {/* private window, etc. */}
}
const HELP_ARTICLES = [{
  title: "Getting started with Enrollium",
  desc: "Set up your first tenant, channels and Knowledge Base"
}, {
  title: "Connecting WhatsApp Business",
  desc: "Templates, approval status and phone number setup"
}, {
  title: "Customizing your Knowledge Base",
  desc: "Import, verify and keep fee & deadline answers current"
}, {
  title: "Understanding conversation analytics",
  desc: "What handoff rate, verified reply rate and volume trend mean"
}, {
  title: "Inviting and managing your team",
  desc: "Roles, alert permissions and viewer access"
}, {
  title: "Data retention & privacy",
  desc: "How long transcripts are kept and how to export or delete data"
}];
export function HelpModal({
  onClose
}) {
  const [q, setQ] = useState("");
  const filtered = HELP_ARTICLES.filter(a => `${a.title} ${a.desc}`.toLowerCase().includes(q.toLowerCase()));
  return <Modal title="Help & documentation" onClose={onClose} width={560} footer={<>
          <span className="mr-auto text-xs text-muted">Still stuck? We reply within a few hours.</span>
          <a href="mailto:support@enrollium.app" className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:opacity-90">Contact support</a>
        </>}>
      <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search help articles…" className="w-full rounded-lg border border-line bg-surface px-3.5 py-2.5 text-sm text-ink placeholder:text-muted focus:border-accent focus:outline-none" />
      <div className="mt-3 divide-y divide-line">
        {filtered.map(a => <div key={a.title} className="py-3">
            <div className="text-sm font-semibold text-ink">{a.title}</div>
            <div className="text-xs text-ink-2">{a.desc}</div>
          </div>)}
        {filtered.length === 0 && <p className="py-4 text-sm text-muted">No articles match &ldquo;{q}&rdquo;.</p>}
      </div>
    </Modal>;
}
export function LogoutConfirmModal({
  tenantName,
  onClose,
  onConfirm
}) {
  return <Modal title="Log out of Enrollium?" onClose={onClose} footer={<>
          <button onClick={onClose} className="rounded-lg border border-line px-4 py-2 text-sm font-semibold text-ink hover:bg-tint">Cancel</button>
          <button onClick={onConfirm} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:opacity-90">Log out</button>
        </>}>
      <p className="text-sm text-ink-2">You&apos;ll need to sign in again to access the {tenantName ?? "tenant"} dashboard.</p>
    </Modal>;
}