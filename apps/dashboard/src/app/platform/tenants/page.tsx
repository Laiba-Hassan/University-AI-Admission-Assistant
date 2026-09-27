"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { dateStr, PlatformHeader } from "@/components/PlatformHeader";
import { apiFetch, apiJson } from "@/lib/api";

interface AccessRequest { id: string; university_name: string; contact_name: string; email: string; phone: string | null; created_at: string }
interface Tenant {
  id: string; name: string; subdomain: string; status: "active" | "suspended"; plan_label: string; created_at: string;
  monthly_conversation_limit: number; staff_count: number; payment_status: string;
}

const FILTERS = ["all", "active", "trial", "suspended"] as const;
type Filter = (typeof FILTERS)[number];

export default function TenantsPage() {
  const [requests, setRequests] = useState<AccessRequest[] | null>(null);
  const [tenants, setTenants] = useState<Tenant[] | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    const [reqs, ten] = await Promise.all([
      apiJson<{ requests: AccessRequest[] }>("/api/platform/access-requests?status=pending"),
      apiJson<{ tenants: Tenant[] }>("/api/platform/tenants"),
    ]);
    setRequests(reqs.requests);
    setTenants(ten.tenants);
  }
  useEffect(() => { void load(); }, []);

  const counts = useMemo(() => {
    if (!tenants) return { all: 0, active: 0, trial: 0, suspended: 0 };
    return {
      all: tenants.length,
      active: tenants.filter((t) => t.status === "active" && t.payment_status !== "trial").length,
      trial: tenants.filter((t) => t.payment_status === "trial").length,
      suspended: tenants.filter((t) => t.status === "suspended").length,
    };
  }, [tenants]);

  const visible = useMemo(() => {
    if (!tenants) return [];
    return tenants.filter((t) => {
      if (filter === "active" && !(t.status === "active" && t.payment_status !== "trial")) return false;
      if (filter === "trial" && t.payment_status !== "trial") return false;
      if (filter === "suspended" && t.status !== "suspended") return false;
      if (query && !t.name.toLowerCase().includes(query.toLowerCase())) return false;
      return true;
    });
  }, [tenants, filter, query]);

  async function approve(id: string) {
    setBusy(id);
    try { await apiFetch(`/api/platform/access-requests/${id}/approve`, { method: "POST" }); await load(); } finally { setBusy(null); }
  }
  async function reject(id: string) {
    setBusy(id);
    try { await apiFetch(`/api/platform/access-requests/${id}/reject`, { method: "POST" }); await load(); } finally { setBusy(null); }
  }
  async function toggleStatus(t: Tenant) {
    setBusy(t.id);
    try {
      await apiFetch(`/api/platform/tenants/${t.id}/status`, { method: "POST", body: JSON.stringify({ status: t.status === "active" ? "suspended" : "active" }) });
      await load();
    } finally { setBusy(null); }
  }

  return (
    <div>
      <PlatformHeader title="Tenants" />

      {requests && requests.length > 0 && (
        <div className="card mb-5 p-5">
          <div className="mb-3 flex items-center gap-2">
            <ClockIcon />
            <h2 className="font-heading text-base font-semibold text-ink">Pending approval</h2>
            <span className="chip-draft rounded-full px-2 py-0.5 text-xs font-semibold">{requests.length} waiting</span>
          </div>
          <div className="divide-y divide-line">
            {requests.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-4 py-3">
                <div>
                  <div className="text-sm font-semibold text-ink">{r.university_name}</div>
                  <div className="text-xs text-muted">{r.contact_name} · {r.email}{r.phone ? ` · ${r.phone}` : ""} · submitted {timeAgo(r.created_at)}</div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button disabled={busy === r.id} onClick={() => reject(r.id)} className="rounded-lg border px-3 py-1.5 text-xs font-semibold hover:opacity-80 disabled:opacity-50" style={{ borderColor: "var(--chip-rejected-fg)", color: "var(--chip-rejected-fg)" }}>Reject</button>
                  <button disabled={busy === r.id} onClick={() => approve(r.id)} className="rounded-lg border px-3 py-1.5 text-xs font-semibold hover:opacity-80 disabled:opacity-50" style={{ borderColor: "var(--chip-approved-fg)", color: "var(--chip-approved-fg)" }}>Approve</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search universities…" className="w-full max-w-xs rounded-lg border border-line bg-surface px-3 py-2 text-sm sm:w-64" />
        <div className="flex gap-1.5">
          {FILTERS.map((f) => (
            <button key={f} onClick={() => setFilter(f)} className={`rounded-lg border px-3 py-1.5 text-xs font-semibold capitalize ${filter === f ? "border-accent bg-tint text-accent" : "border-line text-ink-2 hover:bg-tint"}`}>
              {f} · {counts[f]}
            </button>
          ))}
        </div>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[860px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs font-semibold uppercase tracking-wide text-muted">
              <th className="px-5 py-3">University</th><th className="px-3 py-3">Plan</th><th className="px-3 py-3">Status</th>
              <th className="px-3 py-3">Created</th><th className="px-3 py-3">Conv. cap</th><th className="px-3 py-3">Staff</th><th className="px-5 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {tenants === null && <tr><td colSpan={7} className="px-5 py-8 text-center text-sm text-muted">Loading…</td></tr>}
            {tenants !== null && visible.length === 0 && <tr><td colSpan={7} className="px-5 py-8 text-center text-sm text-muted">No tenants match.</td></tr>}
            {visible.map((t) => (
              <tr key={t.id} className="border-b border-line last:border-0 hover:bg-tint/40">
                <td className="px-5 py-3 font-medium text-ink">{t.name}</td>
                <td className="px-3 py-3 capitalize text-ink-2">{t.plan_label}</td>
                <td className="px-3 py-3">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${t.status === "suspended" ? "chip-rejected" : t.payment_status === "trial" ? "chip-draft" : "chip-approved"}`}>
                    {t.status === "suspended" ? "Suspended" : t.payment_status === "trial" ? "Trial" : "Live"}
                  </span>
                </td>
                <td className="px-3 py-3 text-ink-2">{dateStr(t.created_at)}</td>
                <td className="px-3 py-3 text-ink-2">{t.monthly_conversation_limit.toLocaleString()}</td>
                <td className="px-3 py-3 text-ink-2">{t.staff_count}</td>
                <td className="px-5 py-3 text-right">
                  <button disabled={busy === t.id} onClick={() => toggleStatus(t)} className={`mr-3 rounded-lg border px-3 py-1 text-xs font-semibold hover:opacity-80 disabled:opacity-50 ${t.status === "active" ? "" : ""}`} style={t.status === "active" ? { borderColor: "var(--chip-rejected-fg)", color: "var(--chip-rejected-fg)" } : { borderColor: "var(--chip-approved-fg)", color: "var(--chip-approved-fg)" }}>
                    {t.status === "active" ? "Suspend" : "Reactivate"}
                  </button>
                  <Link href={`/platform/tenants/${t.id}`} className="text-xs font-semibold text-accent hover:underline">View →</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {tenants && <p className="mt-3 text-xs text-muted">Showing {visible.length} of {tenants.length} tenants.</p>}
    </div>
  );
}

function timeAgo(iso: string) {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}
function ClockIcon() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-accent"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>; }
