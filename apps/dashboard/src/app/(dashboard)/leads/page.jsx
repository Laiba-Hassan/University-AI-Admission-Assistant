"use client";

import { useEffect, useState } from "react";
import { apiFetch, apiJson } from "@/lib/api";
import { useStaffSession } from "@/lib/session";
export default function LeadsPage() {
  const session = useStaffSession();
  // RBAC audit finding: PATCH /leads/:id and GET /leads/export.csv are both admin/editor-only on the backend
  // (bulk PII export and status changes are materially different from read-only viewing), but this page showed
  // the status dropdown and Export button to every role regardless -- a viewer's click would just 403 silently.
  const canEdit = session.role === "admin" || session.role === "editor";
  const [leads, setLeads] = useState(null);
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const load = () => {
    if (from && to && from > to) return;
    const qs = new URLSearchParams({
      ...(status && {
        status
      }),
      ...(search && {
        search
      }),
      ...(from && {
        from
      }),
      ...(to && {
        to
      })
    }).toString();
    apiJson(`/api/v1/leads${qs ? `?${qs}` : ""}`).then(r => setLeads(r.data)).catch(() => setLeads([]));
  };
  useEffect(load, [status, search, from, to]); // eslint-disable-line react-hooks/exhaustive-deps

  async function setLeadStatus(id, next) {
    await apiFetch(`/api/v1/leads/${id}`, {
      method: "PATCH",
      body: JSON.stringify({
        status: next
      })
    });
    load();
  }
  return <div>
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-[26px] font-semibold text-ink">Leads</h1>
        {canEdit && <ExportButton />}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search leads…" className="rounded-lg border border-line bg-surface px-3 py-1.5 text-xs" />
        {["", "new", "contacted", "enrolled"].map(s => <button key={s} onClick={() => setStatus(s)} className={`rounded-full border px-3 py-1 text-xs font-semibold ${status === s ? "border-accent bg-accent text-white" : "border-line text-ink-2"}`}>
            {s === "" ? "All statuses" : s[0].toUpperCase() + s.slice(1)}
          </button>)}
        <label className="ml-2 flex items-center gap-1.5 text-xs text-ink-2">From
          <input type="date" value={from} max={to || undefined} onChange={e => setFrom(e.target.value)} className="rounded-lg border border-line bg-surface px-2 py-1 text-ink" />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-ink-2">To
          <input type="date" value={to} min={from || undefined} max={new Date().toISOString().slice(0, 10)} onChange={e => setTo(e.target.value)} className="rounded-lg border border-line bg-surface px-2 py-1 text-ink" />
        </label>
        {(from || to) && <button onClick={() => {
        setFrom("");
        setTo("");
      }} className="text-xs font-semibold text-ink-2 hover:underline">Clear dates</button>}
        {from && to && from > to && <span className="text-xs" style={{
        color: "var(--chip-rejected-fg)"
      }}>"From" must be before "To".</span>}
      </div>
      <div className="card mt-4 overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="border-b border-line text-[11px] uppercase tracking-wide text-muted">
            <tr>
              <th className="px-4 py-3">Name</th><th className="px-4 py-3">Program interest</th><th className="px-4 py-3">Source</th>
              <th className="px-4 py-3">Status</th><th className="px-4 py-3">Consent</th><th className="px-4 py-3">Assigned to</th><th className="px-4 py-3">Created</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {leads === null && <tr><td className="px-4 py-4 text-muted" colSpan={7}>Loading…</td></tr>}
            {leads?.length === 0 && <tr><td className="px-4 py-4 text-muted" colSpan={7}>No leads match these filters.</td></tr>}
            {leads?.map(l => <tr key={l.id}>
                <td className="px-4 py-3 font-medium text-ink">{l.name ?? "—"}</td>
                <td className="px-4 py-3 text-ink-2">{l.program_interest ?? "—"}</td>
                <td className="px-4 py-3 text-ink-2">{l.source ?? "—"}</td>
                <td className="px-4 py-3">
                  {canEdit ? <select value={l.status} onChange={e => setLeadStatus(l.id, e.target.value)} className="rounded-md border border-line bg-surface px-2 py-1 text-xs">
                      <option value="new">New</option><option value="contacted">Contacted</option><option value="enrolled">Enrolled</option>
                    </select> : <span className="chip chip-neutral capitalize">{l.status}</span>}
                </td>
                <td className="px-4 py-3">{l.consent ? <span className="chip chip-approved">Yes</span> : <span className="chip chip-draft">Pending</span>}</td>
                <td className="px-4 py-3 text-ink-2">{l.assigned_email ?? "Unassigned"}</td>
                <td className="px-4 py-3 text-ink-2">{new Date(l.created_at).toLocaleDateString()}</td>
              </tr>)}
          </tbody>
        </table>
      </div>
    </div>;
}
function ExportButton() {
  const [busy, setBusy] = useState(false);
  async function download() {
    // A plain <a href> or window.open can't attach the Bearer token this endpoint needs, so fetch the CSV
    // through apiFetch (which does) and save the blob via a throwaway object URL instead.
    setBusy(true);
    try {
      const res = await apiFetch("/api/v1/leads/export.csv");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "leads.csv";
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setBusy(false);
    }
  }
  return <button onClick={download} disabled={busy} className="rounded-full bg-accent px-4 py-2 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-60">
      {busy ? "Exporting…" : "↓ Export CSV"}
    </button>;
}