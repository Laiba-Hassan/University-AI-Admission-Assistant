"use client";
import { useEffect, useState } from "react";
import { apiFetch, apiJson } from "@/lib/api";

interface Lead {
  id: string; name: string | null; contact: string | null; program_interest: string | null;
  source: string | null; status: string; consent: boolean; assigned_email: string | null; created_at: string;
}

export default function LeadsPage() {
  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");

  const load = () => {
    const qs = new URLSearchParams({ ...(status && { status }), ...(search && { search }) }).toString();
    apiJson<{ data: Lead[] }>(`/api/v1/leads${qs ? `?${qs}` : ""}`).then((r) => setLeads(r.data)).catch(() => setLeads([]));
  };
  useEffect(load, [status, search]); // eslint-disable-line react-hooks/exhaustive-deps

  async function setLeadStatus(id: string, next: string) {
    await apiFetch(`/api/v1/leads/${id}`, { method: "PATCH", body: JSON.stringify({ status: next }) });
    load();
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-[26px] font-semibold text-ink">Leads</h1>
        <ExportButton />
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search leads…" className="rounded-lg border border-line bg-surface px-3 py-1.5 text-xs" />
        {["", "new", "contacted", "enrolled"].map((s) => (
          <button key={s} onClick={() => setStatus(s)} className={`rounded-full border px-3 py-1 text-xs font-semibold ${status === s ? "border-accent bg-accent text-white" : "border-line text-ink-2"}`}>
            {s === "" ? "All statuses" : s[0]!.toUpperCase() + s.slice(1)}
          </button>
        ))}
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
            {leads?.map((l) => (
              <tr key={l.id}>
                <td className="px-4 py-3 font-medium text-ink">{l.name ?? "—"}</td>
                <td className="px-4 py-3 text-ink-2">{l.program_interest ?? "—"}</td>
                <td className="px-4 py-3 text-ink-2">{l.source ?? "—"}</td>
                <td className="px-4 py-3">
                  <select value={l.status} onChange={(e) => setLeadStatus(l.id, e.target.value)} className="rounded-md border border-line bg-surface px-2 py-1 text-xs">
                    <option value="new">New</option><option value="contacted">Contacted</option><option value="enrolled">Enrolled</option>
                  </select>
                </td>
                <td className="px-4 py-3">{l.consent ? <span className="chip chip-approved">Yes</span> : <span className="chip chip-draft">Pending</span>}</td>
                <td className="px-4 py-3 text-ink-2">{l.assigned_email ?? "Unassigned"}</td>
                <td className="px-4 py-3 text-ink-2">{new Date(l.created_at).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
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
      a.href = url; a.download = "leads.csv"; a.click();
      URL.revokeObjectURL(url);
    } finally {
      setBusy(false);
    }
  }
  return (
    <button onClick={download} disabled={busy} className="rounded-full bg-accent px-4 py-2 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-60">
      {busy ? "Exporting…" : "↓ Export CSV"}
    </button>
  );
}
