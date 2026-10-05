"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/Modal";
import { apiFetch, apiJson } from "@/lib/api";
import { useStaffSession } from "@/lib/session";
export default function RetentionTab() {
  const session = useStaffSession();
  const [days, setDays] = useState(null);
  const [draft, setDraft] = useState(0);
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  useEffect(() => {
    void apiJson("/api/v1/settings/retention").then(r => {
      setDays(r.retention_days);
      setDraft(r.retention_days);
    });
  }, []);
  if (days === null) return <p className="text-sm text-muted">Loading…</p>;
  async function save() {
    await apiFetch("/api/v1/settings/retention", {
      method: "PATCH",
      body: JSON.stringify({
        retention_days: draft
      })
    });
    setDays(draft);
    setEditing(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }
  async function exportData() {
    setExporting(true);
    try {
      // Full data export (PRD 7): every entity a tenant actually owns, not just conversations/leads -- the
      // generic /api/v1/:resource route (already used by the Knowledge Base pages) covers the rest without a
      // second backend implementation. Each capped at 500 rows, matching that route's own max.
      // CSV only -- a university's admin staff opens this in Excel, not a JSON viewer.
      const resources = ["programs", "faculties", "campuses", "fee-items", "intakes", "requirements", "scholarships", "faqs", "knowledge-documents"];
      const [conversations, leads, ...rest] = await Promise.all([apiJson("/api/v1/conversations?limit=500"), apiJson("/api/v1/leads?limit=1000"), ...resources.map(r => apiJson(`/api/v1/${r}?limit=500`))]);
      const bundle = {
        conversations: conversations.data,
        leads: leads.data
      };
      resources.forEach((r, i) => {
        bundle[r.replace("-", "_")] = rest[i].data;
      });
      const blob = new Blob([toCsvBundle(bundle)], {
        type: "text/csv"
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const slug = (session.tenantName ?? "data").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
      a.download = `${slug}-export.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }
  return <div>
      <h2 className="font-heading text-lg font-semibold text-ink">Retention &amp; data requests</h2>
      <p className="mt-3 text-sm text-ink-2">Transcripts and leads are kept for</p>
      {editing ? <div className="mt-1.5 flex items-center gap-2">
          <input type="number" min={1} value={draft} onChange={e => setDraft(Number(e.target.value))} className="w-28 rounded-lg border border-line bg-surface px-3 py-2 text-sm" />
          <span className="text-sm text-ink-2">days</span>
          <button onClick={save} className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90">Save</button>
          <button onClick={() => {
        setEditing(false);
        setDraft(days);
      }} className="text-xs font-semibold text-ink-2 hover:underline">Cancel</button>
        </div> : <div className="mt-1.5 flex items-center gap-3">
          <span className="font-heading text-2xl font-semibold text-ink">{days} days</span>
          <button onClick={() => setEditing(true)} className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-ink hover:bg-tint">Change</button>
          {saved && <span className="text-xs text-ink-2">Saved.</span>}
        </div>}
      <p className="mt-2 text-xs text-muted">WhatsApp opt-outs are honored immediately and independent of this setting.</p>

      <div className="mt-5 flex items-center gap-3">
        <button onClick={exportData} disabled={exporting} className="rounded-lg border border-line px-4 py-2 text-sm font-semibold text-ink hover:bg-tint disabled:opacity-60">
          {exporting ? "Exporting…" : "Export data"}
        </button>
        <button onClick={() => setConfirmingDelete(true)} className="rounded-lg border px-4 py-2 text-sm font-semibold hover:opacity-90" style={{
        borderColor: "var(--chip-rejected-fg)",
        color: "var(--chip-rejected-fg)"
      }}>
          Delete data
        </button>
      </div>

      {confirmingDelete && <Modal title="Delete tenant data?" onClose={() => setConfirmingDelete(false)} footer={<>
              <button onClick={() => setConfirmingDelete(false)} className="rounded-lg border border-line px-4 py-2 text-sm font-semibold text-ink hover:bg-tint">Cancel</button>
              <button disabled title="Bulk data deletion isn't wired up to a backend endpoint yet -- ask an engineer to run it directly against the database in the meantime." className="cursor-not-allowed rounded-lg px-4 py-2 text-sm font-semibold text-white opacity-60" style={{
        background: "var(--chip-rejected-fg)"
      }}>
                Delete everything
              </button>
            </>}>
          <p className="text-sm text-ink-2">
            This would permanently delete all conversation transcripts, leads and unanswered-question logs for this tenant. This action can&apos;t be undone.
          </p>
          <p className="mt-3 text-xs text-muted">This confirmation flow is built; the actual bulk-delete endpoint isn&apos;t implemented yet, so the button above is disabled rather than silently doing nothing destructive.</p>
        </Modal>}
    </div>;
}
// One CSV file, one "## section" per entity -- the bundle is heterogeneous (conversations, leads, programs...),
// so a single flat table doesn't fit; this keeps the export to one file without adding a zip dependency.
function toCsvBundle(bundle) {
  const escape = v => {
    if (v == null) return "";
    const s = typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, "\"\"")}"` : s;
  };
  return Object.entries(bundle).map(([name, rows]) => {
    if (!rows || rows.length === 0) return `## ${name}\n(no rows)\n`;
    const cols = Array.from(rows.reduce((set, r) => {
      Object.keys(r).forEach(k => set.add(k));
      return set;
    }, new Set()));
    const lines = [cols.join(","), ...rows.map(r => cols.map(c => escape(r[c])).join(","))];
    return `## ${name}\n${lines.join("\n")}\n`;
  }).join("\n");
}