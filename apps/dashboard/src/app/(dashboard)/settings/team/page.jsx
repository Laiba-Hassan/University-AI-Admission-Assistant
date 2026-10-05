"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/Modal";
import { apiFetch, apiJson } from "@/lib/api";
import { displayName } from "@/lib/names";
import { useStaffSession } from "@/lib/session";
export default function TeamTab() {
  const session = useStaffSession();
  const [team, setTeam] = useState(null);
  const [inviting, setInviting] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("viewer");
  const [inviteResult, setInviteResult] = useState(null);
  const [removing, setRemoving] = useState(null);
  const [removeError, setRemoveError] = useState(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const load = () => {
    void apiJson("/api/v1/settings/team").then(r => setTeam(r.data));
  };
  useEffect(load, []);
  async function invite() {
    if (!email.trim()) return;
    const res = await apiFetch("/api/v1/settings/team/invite", {
      method: "POST",
      body: JSON.stringify({
        email: email.trim(),
        role
      })
    });
    if (res.status === 403) {
      setInviteResult({ error: "Only Admins can invite staff." });
      return;
    }
    const { invite_token, emailed } = await res.json();
    const link = `${window.location.origin}/accept-invite?token=${invite_token}`;
    setInviteResult({ email, link, emailed });
    setEmail("");
    load();
  }
  async function approvePasswordChange(id) {
    await apiFetch(`/api/v1/settings/team/${id}/approve-password-change`, {
      method: "POST"
    });
    load();
  }
  const REMOVE_ERRORS = {
    last_admin: "This is the only Admin on the team -- promote someone else first.",
    not_found: "That team member is already gone."
  };
  async function confirmRemove() {
    setRemoveBusy(true);
    setRemoveError(null);
    try {
      const res = await apiFetch(`/api/v1/settings/team/${removing.id}`, {
        method: "DELETE"
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setRemoveError(REMOVE_ERRORS[body.error] ?? "Couldn't remove this team member.");
        return;
      }
      setRemoving(null);
      load();
    } finally {
      setRemoveBusy(false);
    }
  }
  return <div>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-heading text-lg font-semibold text-ink">Team</h2>
          <p className="text-sm text-ink-2">Only Admins can invite staff or change roles.</p>
        </div>
        <button onClick={() => {
        setInviting(true);
        setInviteResult(null);
      }} className="rounded-full bg-accent px-4 py-2 text-xs font-semibold text-white hover:opacity-90">+ Invite staff</button>
      </div>
      <div className="card mt-4 overflow-x-auto">
        <table className="w-full min-w-[480px] text-left text-sm">
          <thead className="border-b border-line text-[11px] uppercase tracking-wide text-muted">
            <tr><th className="px-4 py-3">Name</th><th className="px-4 py-3">Role</th><th className="px-4 py-3">Lead alerts</th><th className="px-4 py-3">Handoff alerts</th><th className="px-4 py-3">Password</th><th className="px-4 py-3">Actions</th></tr>
          </thead>
          <tbody className="divide-y divide-line">
            {team === null && <tr><td className="px-4 py-4 text-muted" colSpan={6}>Loading…</td></tr>}
            {team?.map(m => <tr key={m.id}>
                <td className="px-4 py-3">
                  <div className="font-medium text-ink">{displayName({ fullName: m.full_name, email: m.email })}</div>
                  <div className="text-xs text-muted">{m.email}</div>
                </td>
                <td className="px-4 py-3 text-ink-2 capitalize">{m.role}</td>
                <td className="px-4 py-3">{m.notify_leads ? "✓" : "✕"}</td>
                <td className="px-4 py-3">{m.notify_handoffs ? "✓" : "✕"}</td>
                <td className="px-4 py-3">
                  {m.role === "admin" ? <span className="text-xs text-muted">—</span> : m.password_change_approved_at ? <span className="chip chip-approved">Approved</span> : m.password_change_requested_at ? <button onClick={() => approvePasswordChange(m.id)} className="rounded-lg bg-accent px-3 py-1 text-xs font-semibold text-white hover:opacity-90">Approve request</button> : <span className="text-xs text-muted">—</span>}
                </td>
                <td className="px-4 py-3">
                  {m.email === session.email ? <span className="text-xs text-muted">—</span> : <button onClick={() => {
                  setRemoving(m);
                  setRemoveError(null);
                }} className="text-xs font-semibold hover:underline" style={{
                  color: "var(--chip-rejected-fg)"
                }}>Remove</button>}
                </td>
              </tr>)}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-[11px] text-muted">Viewers see read-only Leads and Knowledge Base pages and cannot open Settings → Team.</p>

      {inviting && <Modal title="Invite staff" onClose={() => setInviting(false)} footer={<>
              <button onClick={() => setInviting(false)} className="rounded-lg border border-line px-4 py-2 text-sm font-semibold text-ink hover:bg-tint">Cancel</button>
              <button onClick={() => {
        void invite();
      }} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:opacity-90">Send invite</button>
            </>}>
          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted">Email</span>
            <input value={email} onChange={e => setEmail(e.target.value)} placeholder="staff@university.edu" className="mt-1.5 w-full rounded-lg border border-line bg-surface px-3.5 py-2.5 text-sm text-ink focus:border-accent focus:outline-none" />
          </label>
          <label className="mt-4 block">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted">Role</span>
            <select value={role} onChange={e => setRole(e.target.value)} className="mt-1.5 w-full rounded-lg border border-line bg-surface px-3.5 py-2.5 text-sm text-ink">
              <option value="viewer">Viewer</option><option value="editor">Editor</option><option value="admin">Admin</option>
            </select>
          </label>
          {inviteResult?.error && <p className="mt-3 text-xs" style={{
          color: "var(--chip-rejected-fg)"
        }}>{inviteResult.error}</p>}
          {inviteResult?.emailed && <p className="mt-3 text-xs" style={{
          color: "var(--accent)"
        }}>✓ Email sent to {inviteResult.email}</p>}
          {inviteResult && !inviteResult.emailed && !inviteResult.error && <div className="mt-3 rounded-lg border border-line bg-surface p-3">
              <p className="text-xs text-ink-2">
                Invite created for <strong className="text-ink">{inviteResult.email}</strong>, but email isn't configured on this server yet -- copy this link and send it to them yourself (expires in 7 days):
              </p>
              <div className="mt-2 flex items-center gap-2">
                <input readOnly value={inviteResult.link} onFocus={e => e.target.select()} className="w-full rounded-lg border border-line bg-bg px-2.5 py-1.5 text-xs text-ink-2" />
                <button type="button" onClick={() => navigator.clipboard?.writeText(inviteResult.link)} className="shrink-0 rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-ink hover:bg-tint">Copy</button>
              </div>
            </div>}
        </Modal>}

      {removing && <Modal title="Remove team member?" onClose={() => setRemoving(null)} footer={<>
              <button onClick={() => setRemoving(null)} className="rounded-lg border border-line px-4 py-2 text-sm font-semibold text-ink hover:bg-tint">Cancel</button>
              <button onClick={confirmRemove} disabled={removeBusy} className="rounded-lg px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60" style={{
          background: "var(--chip-rejected-fg)"
        }}>
                {removeBusy ? "Removing…" : "Remove"}
              </button>
            </>}>
          <p className="text-sm text-ink-2">
            <strong className="text-ink">{removing.email}</strong> will immediately lose access to this dashboard. Their past activity (leads, conversations, invites) stays on record.
          </p>
          {removeError && <p className="mt-3 text-xs" style={{
        color: "var(--chip-rejected-fg)"
      }}>{removeError}</p>}
        </Modal>}
    </div>;
}