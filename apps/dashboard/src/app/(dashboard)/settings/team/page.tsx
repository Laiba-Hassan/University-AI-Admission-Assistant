"use client";
import { useEffect, useState } from "react";
import { apiFetch, apiJson } from "@/lib/api";

interface Member { id: string; email: string; role: string; notify_leads: boolean; notify_handoffs: boolean }

export default function TeamTab() {
  const [team, setTeam] = useState<Member[] | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("viewer");
  const [inviteResult, setInviteResult] = useState<string | null>(null);
  const load = () => { void apiJson<{ data: Member[] }>("/api/v1/settings/team").then((r) => setTeam(r.data)); };
  useEffect(load, []);

  async function invite() {
    if (!email.trim()) return;
    const res = await apiFetch("/api/v1/settings/team/invite", { method: "POST", body: JSON.stringify({ email: email.trim(), role }) });
    if (res.status === 403) { setInviteResult("Only Admins can invite staff."); return; }
    setInviteResult(`Invite created for ${email}.`);
    setEmail(""); load();
  }

  return (
    <div>
      <p className="text-sm text-ink-2">Only Admins can invite staff or change roles.</p>
      <div className="card mt-4 overflow-x-auto">
        <table className="w-full min-w-[480px] text-left text-sm">
          <thead className="border-b border-line text-[11px] uppercase tracking-wide text-muted">
            <tr><th className="px-4 py-3">Name</th><th className="px-4 py-3">Role</th><th className="px-4 py-3">Lead alerts</th><th className="px-4 py-3">Handoff alerts</th></tr>
          </thead>
          <tbody className="divide-y divide-line">
            {team === null && <tr><td className="px-4 py-4 text-muted" colSpan={4}>Loading…</td></tr>}
            {team?.map((m) => (
              <tr key={m.id}>
                <td className="px-4 py-3 font-medium text-ink">{m.email}</td>
                <td className="px-4 py-3 text-ink-2 capitalize">{m.role}</td>
                <td className="px-4 py-3">{m.notify_leads ? "✓" : "✕"}</td>
                <td className="px-4 py-3">{m.notify_handoffs ? "✓" : "✕"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-5 flex flex-wrap items-end gap-2">
        <div>
          <label className="text-xs font-medium text-ink-2">Email</label>
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="staff@university.edu" className="mt-1 block rounded-lg border border-line bg-surface px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="text-xs font-medium text-ink-2">Role</label>
          <select value={role} onChange={(e) => setRole(e.target.value)} className="mt-1 block rounded-lg border border-line bg-surface px-3 py-2 text-sm">
            <option value="viewer">Viewer</option><option value="editor">Editor</option><option value="admin">Admin</option>
          </select>
        </div>
        <button onClick={invite} className="rounded-full bg-accent px-4 py-2 text-xs font-semibold text-white hover:opacity-90">+ Invite staff</button>
      </div>
      {inviteResult && <p className="mt-2 text-xs text-ink-2">{inviteResult}</p>}
    </div>
  );
}
