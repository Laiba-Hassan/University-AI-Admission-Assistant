"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { apiJson } from "@/lib/api";

interface Entry { id: number; timestamp: string; action: string; resource: string | null; staff_email: string | null; metadata: Record<string, unknown> }

export default function ChangeHistoryPage() {
  const [rows, setRows] = useState<Entry[] | null>(null);
  useEffect(() => { void apiJson<{ data: Entry[] }>("/api/v1/change-history").then((r) => setRows(r.data)).catch(() => setRows([])); }, []);

  return (
    <div>
      <Link href="/knowledge-base" className="text-xs font-semibold text-accent hover:underline">← Back to Knowledge Base</Link>
      <h1 className="mt-2 font-heading text-[26px] font-semibold text-ink">Change History</h1>
      <p className="text-sm text-ink-2">Every fee, FAQ, branding and access change -- drawn from the audit log.</p>
      <div className="card mt-4 overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="border-b border-line text-[11px] uppercase tracking-wide text-muted">
            <tr><th className="px-4 py-3">Timestamp</th><th className="px-4 py-3">Staff member</th><th className="px-4 py-3">Action</th><th className="px-4 py-3">Resource</th><th className="px-4 py-3">Details</th></tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows === null && <tr><td className="px-4 py-4 text-muted" colSpan={5}>Loading…</td></tr>}
            {rows?.length === 0 && <tr><td className="px-4 py-4 text-muted" colSpan={5}>No changes recorded yet.</td></tr>}
            {rows?.map((r) => (
              <tr key={r.id}>
                <td className="px-4 py-3 text-ink-2">{new Date(r.timestamp).toLocaleString()}</td>
                <td className="px-4 py-3 text-ink">{r.staff_email ?? "System"}</td>
                <td className="px-4 py-3"><span className="chip chip-draft">{r.action.replace(/_/g, " ")}</span></td>
                <td className="px-4 py-3 text-ink-2">{r.resource ?? "—"}</td>
                <td className="px-4 py-3 text-ink-2">{JSON.stringify(r.metadata)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
