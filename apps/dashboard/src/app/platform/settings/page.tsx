"use client";
import { useEffect, useState } from "react";
import { PlatformHeader } from "@/components/PlatformHeader";
import { apiFetch, apiJson } from "@/lib/api";
import { usePlatformSession } from "@/lib/platform-session";

interface PlanLimits { conversations: number; messages: number }
interface Settings { default_retention_days: number; default_plan_limits: Record<string, PlanLimits> }
interface SubProcessor { id: string; vendor: string; purpose: string; dpa_status: "not_reviewed" | "signed" | "not_required"; last_reviewed: string | null; notes: string | null }

export default function PlatformSettingsPage() {
  const session = usePlatformSession();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [retentionDraft, setRetentionDraft] = useState(90);
  const [subs, setSubs] = useState<SubProcessor[] | null>(null);
  const [newVendor, setNewVendor] = useState({ vendor: "", purpose: "" });

  async function loadSettings() {
    const s = await apiJson<Settings>("/api/platform/settings");
    setSettings(s); setRetentionDraft(s.default_retention_days);
  }
  async function loadSubs() { setSubs((await apiJson<{ sub_processors: SubProcessor[] }>("/api/platform/sub-processors")).sub_processors); }
  useEffect(() => { void loadSettings(); void loadSubs(); }, []);

  async function saveRetention() {
    await apiFetch("/api/platform/settings", { method: "PATCH", body: JSON.stringify({ default_retention_days: retentionDraft }) });
    await loadSettings();
  }
  async function addSub() {
    if (!newVendor.vendor.trim() || !newVendor.purpose.trim()) return;
    await apiFetch("/api/platform/sub-processors", { method: "POST", body: JSON.stringify(newVendor) });
    setNewVendor({ vendor: "", purpose: "" });
    await loadSubs();
  }
  async function setDpaStatus(s: SubProcessor, status: SubProcessor["dpa_status"]) {
    await apiFetch(`/api/platform/sub-processors/${s.id}`, { method: "PATCH", body: JSON.stringify({ dpa_status: status, last_reviewed: status === "signed" ? new Date().toISOString().slice(0, 10) : s.last_reviewed }) });
    await loadSubs();
  }
  async function removeSub(id: string) { await apiFetch(`/api/platform/sub-processors/${id}`, { method: "DELETE" }); await loadSubs(); }

  return (
    <div>
      <PlatformHeader title="Platform settings" />
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-5">
          <div className="card p-5">
            <h2 className="mb-3 font-heading text-base font-semibold text-ink">My account</h2>
            <Row label="Email"><span className="text-sm text-ink">{session.email}</span></Row>
            <Row label="Role"><span className="chip-approved rounded-full px-2 py-0.5 text-xs font-semibold">Super Admin</span></Row>
            <p className="mt-3 text-xs text-muted">Password and two-factor authentication are managed through your Supabase Auth account, not stored by this app.</p>
          </div>

          <div className="card p-5">
            <h2 className="mb-3 font-heading text-base font-semibold text-ink">Global defaults</h2>
            <Row label="Default data retention">
              <div className="flex items-center gap-2">
                <input type="number" min={1} value={retentionDraft} onChange={(e) => setRetentionDraft(Number(e.target.value))} className="w-20 rounded-lg border border-line bg-surface px-2 py-1 text-sm" />
                <span className="text-sm text-ink-2">days</span>
                <button onClick={saveRetention} className="rounded-lg border border-line px-2 py-1 text-xs font-semibold text-ink hover:bg-tint">Save</button>
              </div>
            </Row>
            {settings && (
              <div className="mt-4">
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Default plan limits (new tenants)</div>
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-xs text-muted"><th className="py-1">Plan</th><th className="py-1">Conversations/mo</th><th className="py-1">Messages/mo</th></tr></thead>
                  <tbody>
                    {Object.entries(settings.default_plan_limits).map(([plan, limits]) => (
                      <tr key={plan} className="border-t border-line"><td className="py-1.5 capitalize text-ink">{plan}</td><td className="py-1.5 text-ink-2">{limits.conversations.toLocaleString()}</td><td className="py-1.5 text-ink-2">{limits.messages.toLocaleString()}</td></tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-2 text-xs text-muted">Applied automatically to new tenants at approval; edit an individual tenant&apos;s cap from its detail page.</p>
              </div>
            )}
          </div>
        </div>

        <div className="card p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-heading text-base font-semibold text-ink">Sub-processors & DPA</h2>
          </div>
          <div className="mb-3 flex gap-2">
            <input value={newVendor.vendor} onChange={(e) => setNewVendor((v) => ({ ...v, vendor: e.target.value }))} placeholder="Vendor" className="w-1/3 rounded-lg border border-line bg-surface px-2 py-1.5 text-sm" />
            <input value={newVendor.purpose} onChange={(e) => setNewVendor((v) => ({ ...v, purpose: e.target.value }))} placeholder="Purpose" className="flex-1 rounded-lg border border-line bg-surface px-2 py-1.5 text-sm" />
            <button onClick={addSub} className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-ink hover:bg-tint">+ Add</button>
          </div>
          <div className="divide-y divide-line">
            {subs?.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-ink">{s.vendor}</div>
                  <div className="truncate text-xs text-muted">{s.purpose}{s.last_reviewed ? ` · reviewed ${s.last_reviewed}` : ""}</div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <select value={s.dpa_status} onChange={(e) => setDpaStatus(s, e.target.value as SubProcessor["dpa_status"])} className={`rounded-full border-0 px-2 py-0.5 text-xs font-semibold ${s.dpa_status === "signed" ? "chip-approved" : s.dpa_status === "not_required" ? "chip-neutral" : "chip-rejected"}`}>
                    <option value="not_reviewed">Not reviewed</option><option value="signed">Signed</option><option value="not_required">Not required</option>
                  </select>
                  <button onClick={() => removeSub(s.id)} className="text-xs text-muted hover:text-ink" aria-label="Remove">✕</button>
                </div>
              </div>
            ))}
            {subs?.length === 0 && <p className="py-2 text-sm text-muted">No sub-processors tracked yet.</p>}
          </div>
          <p className="mt-3 text-xs text-muted">DPA status is only ever marked &quot;Signed&quot; when a platform admin confirms it -- nothing here is pre-filled.</p>
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex items-center justify-between gap-3 border-b border-line py-2.5 last:border-0"><span className="text-sm text-ink-2">{label}</span>{children}</div>;
}
