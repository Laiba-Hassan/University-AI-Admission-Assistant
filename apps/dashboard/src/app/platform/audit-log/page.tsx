"use client";
import { useEffect, useMemo, useState } from "react";
import { PlatformHeader } from "@/components/PlatformHeader";
import { apiJson } from "@/lib/api";

interface Entry { id: number; admin_email: string; action: string; target: string | null; details: string | null; created_at: string }

const FILTERS: { key: string; label: string; match: (a: string) => boolean }[] = [
  { key: "all", label: "All", match: () => true },
  { key: "approvals", label: "Approvals", match: (a) => a.includes("approved") || a.includes("rejected") },
  { key: "suspensions", label: "Suspensions", match: (a) => a.includes("suspended") || a.includes("reactivated") },
  { key: "limits", label: "Limit changes", match: (a) => a.includes("usage_limit") },
  { key: "billing", label: "Billing", match: (a) => a.includes("billing") },
];

const ACTION_LABEL: Record<string, string> = {
  approved_tenant: "Approved tenant", rejected_tenant_request: "Rejected tenant request", suspended_tenant: "Suspended tenant",
  reactivated_tenant: "Reactivated tenant", changed_usage_limit: "Changed usage limit", updated_billing: "Updated billing",
  added_sub_processor: "Added sub-processor", updated_sub_processor: "Updated sub-processor", removed_sub_processor: "Removed sub-processor",
  updated_global_default: "Updated global default",
};
const CHIP_CLASS: Record<string, string> = {
  approved_tenant: "chip-approved", rejected_tenant_request: "chip-rejected", suspended_tenant: "chip-rejected",
  reactivated_tenant: "chip-approved", changed_usage_limit: "chip-draft", updated_billing: "chip-neutral",
};

export default function AuditLogPage() {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [filter, setFilter] = useState("all");
  useEffect(() => { void apiJson<{ entries: Entry[] }>("/api/platform/audit-log?limit=200").then((r) => setEntries(r.entries)); }, []);

  const visible = useMemo(() => {
    if (!entries) return [];
    const f = FILTERS.find((f) => f.key === filter)!;
    return entries.filter((e) => f.match(e.action));
  }, [entries, filter]);

  return (
    <div>
      <PlatformHeader title="Audit Log" />
      <p className="mb-4 text-sm text-ink-2">Every approval, suspension, limit change and billing change a platform admin makes -- timestamped, for accountability.</p>
      <div className="mb-4 flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button key={f.key} onClick={() => setFilter(f.key)} className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${filter === f.key ? "border-accent bg-tint text-accent" : "border-line text-ink-2 hover:bg-tint"}`}>{f.label}</button>
        ))}
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[820px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs font-semibold uppercase tracking-wide text-muted">
              <th className="px-5 py-3">Timestamp</th><th className="px-3 py-3">Admin</th><th className="px-3 py-3">Action</th><th className="px-3 py-3">Target</th><th className="px-5 py-3">Details</th>
            </tr>
          </thead>
          <tbody>
            {entries === null && <tr><td colSpan={5} className="px-5 py-8 text-center text-sm text-muted">Loading…</td></tr>}
            {entries !== null && visible.length === 0 && <tr><td colSpan={5} className="px-5 py-8 text-center text-sm text-muted">No matching entries.</td></tr>}
            {visible.map((e) => (
              <tr key={e.id} className="border-b border-line last:border-0">
                <td className="whitespace-nowrap px-5 py-3 text-ink-2">{new Date(e.created_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</td>
                <td className="px-3 py-3 text-ink">{e.admin_email}</td>
                <td className="px-3 py-3"><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${CHIP_CLASS[e.action] ?? "chip-neutral"}`}>{ACTION_LABEL[e.action] ?? e.action}</span></td>
                <td className="px-3 py-3 text-ink">{e.target ?? "—"}</td>
                <td className="px-5 py-3 text-ink-2">{e.details ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {entries && <p className="mt-3 text-xs text-muted">Showing the last {visible.length} of {entries.length} loaded actions · retained indefinitely.</p>}
    </div>
  );
}
