"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { dateStr, money, PlatformHeader } from "@/components/PlatformHeader";
import { apiFetch, apiJson } from "@/lib/api";
export default function TenantDetailPage() {
  const {
    id
  } = useParams();
  const [detail, setDetail] = useState(null);
  const [limitsDraft, setLimitsDraft] = useState({
    conv: 0,
    msg: 0
  });
  const [billingDraft, setBillingDraft] = useState({
    price: 0,
    cycle: "monthly",
    status: "trial",
    invoicedOutside: false,
    note: ""
  });
  const [newNote, setNewNote] = useState("");
  const [saving, setSaving] = useState(null);
  const [planBusy, setPlanBusy] = useState(false);
  const [approvingPassword, setApprovingPassword] = useState(null);
  async function load() {
    const d = await apiJson(`/api/platform/tenants/${id}`);
    setDetail(d);
    setLimitsDraft({
      conv: d.monthly_conversation_limit,
      msg: d.monthly_message_limit
    });
    setBillingDraft({
      price: d.plan_price_cents / 100,
      cycle: d.billing_cycle,
      status: d.payment_status,
      invoicedOutside: d.invoiced_outside_platform,
      note: ""
    });
  }
  useEffect(() => {
    void load();
  }, [id]);
  if (!detail) return <p className="text-sm text-muted">Loading…</p>;
  async function saveLimits() {
    setSaving("limits");
    try {
      await apiFetch(`/api/platform/tenants/${id}/limits`, {
        method: "PATCH",
        body: JSON.stringify({
          monthly_conversation_limit: limitsDraft.conv,
          monthly_message_limit: limitsDraft.msg
        })
      });
      await load();
    } finally {
      setSaving(null);
    }
  }
  async function saveBilling() {
    setSaving("billing");
    try {
      await apiFetch(`/api/platform/tenants/${id}/billing`, {
        method: "PATCH",
        body: JSON.stringify({
          plan_price_cents: Math.round(billingDraft.price * 100),
          billing_cycle: billingDraft.cycle,
          payment_status: billingDraft.status,
          invoiced_outside_platform: billingDraft.invoicedOutside
        })
      });
      await load();
    } finally {
      setSaving(null);
    }
  }
  async function setPlan(whatsappEnabled) {
    if (whatsappEnabled === detail.whatsapp_enabled) return;
    setPlanBusy(true);
    try {
      await apiFetch(`/api/platform/tenants/${id}/plan`, {
        method: "PATCH",
        body: JSON.stringify({
          whatsapp_enabled: whatsappEnabled
        })
      });
      await load();
    } finally {
      setPlanBusy(false);
    }
  }
  async function approvePassword(userId) {
    setApprovingPassword(userId);
    try {
      await apiFetch(`/api/platform/tenants/${id}/team/${userId}/approve-password-change`, {
        method: "POST"
      });
      await load();
    } finally {
      setApprovingPassword(null);
    }
  }
  async function toggleStatus() {
    setSaving("status");
    try {
      await apiFetch(`/api/platform/tenants/${id}/status`, {
        method: "POST",
        body: JSON.stringify({
          status: detail.status === "active" ? "suspended" : "active"
        })
      });
      await load();
    } finally {
      setSaving(null);
    }
  }
  async function addNote() {
    if (!newNote.trim()) return;
    setSaving("note");
    try {
      await apiFetch(`/api/platform/tenants/${id}/support-notes`, {
        method: "POST",
        body: JSON.stringify({
          note: newNote.trim()
        })
      });
      setNewNote("");
      await load();
    } finally {
      setSaving(null);
    }
  }
  async function resolveNote(noteId, status) {
    await apiFetch(`/api/platform/tenants/${id}/support-notes/${noteId}`, {
      method: "PATCH",
      body: JSON.stringify({
        status
      })
    });
    await load();
  }
  return <div>
      <Link href="/platform/tenants" className="mb-3 inline-block text-xs font-semibold text-ink-2 hover:text-ink">← All tenants</Link>
      <PlatformHeader title={detail.name} action={<button onClick={toggleStatus} disabled={saving === "status"} className="rounded-lg border px-4 py-2 text-sm font-semibold hover:opacity-80 disabled:opacity-50" style={detail.status === "active" ? {
      borderColor: "var(--chip-rejected-fg)",
      color: "var(--chip-rejected-fg)"
    } : {
      borderColor: "var(--chip-approved-fg)",
      color: "var(--chip-approved-fg)"
    }}>
            {detail.status === "active" ? "Suspend tenant" : "Reactivate tenant"}
          </button>} />
      <p className="-mt-3 mb-5 text-sm text-ink-2 capitalize">{detail.plan_label} plan · {detail.staff_count} staff · subdomain {detail.subdomain} · joined {dateStr(detail.created_at)}</p>

      <div className="mb-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Kpi label="Conversations (30d)" value={detail.overview.kpis.conversations} />
        <Kpi label="Leads captured (30d)" value={detail.overview.kpis.leads_captured} />
        <Kpi label="Unanswered rate" value={`${detail.overview.kpis.unanswered_rate}%`} />
        <Kpi label="Staff" value={detail.staff_count} />
      </div>

      <div className="card mb-5 p-5">
        <h2 className="mb-3 font-heading text-base font-semibold text-ink">Plan</h2>
        <div className="flex gap-2">
          <button onClick={() => setPlan(false)} disabled={planBusy} className={`rounded-lg border px-4 py-2 text-sm font-semibold disabled:opacity-60 ${!detail.whatsapp_enabled ? "border-accent bg-tint text-accent" : "border-line text-ink-2 hover:bg-tint"}`}>
            Web only
          </button>
          <button onClick={() => setPlan(true)} disabled={planBusy} className={`rounded-lg border px-4 py-2 text-sm font-semibold disabled:opacity-60 ${detail.whatsapp_enabled ? "border-accent bg-tint text-accent" : "border-line text-ink-2 hover:bg-tint"}`}>
            Web + WhatsApp
          </button>
        </div>
        <p className="mt-2 text-xs text-muted">Switching to Web only doesn&apos;t disconnect an already-connected WhatsApp number -- it only stops a new connection from the Web-only plan.</p>
      </div>

      <div className="card mb-5 p-5">
        <h2 className="mb-3 font-heading text-base font-semibold text-ink">Usage limits</h2>
        <div className="flex flex-wrap items-end gap-4">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">Monthly conversation cap</span>
            <input type="number" min={0} value={limitsDraft.conv} onChange={e => setLimitsDraft(d => ({
            ...d,
            conv: Number(e.target.value)
          }))} className="w-40 rounded-lg border border-line bg-surface px-3 py-2 text-sm" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">Monthly message cap (WhatsApp)</span>
            <input type="number" min={0} value={limitsDraft.msg} onChange={e => setLimitsDraft(d => ({
            ...d,
            msg: Number(e.target.value)
          }))} className="w-40 rounded-lg border border-line bg-surface px-3 py-2 text-sm" />
          </label>
          <button onClick={saveLimits} disabled={saving === "limits"} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60">Save limits</button>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="card p-5">
          <h2 className="mb-3 font-heading text-base font-semibold text-ink">Billing</h2>
          <p className="mb-3 text-xs text-muted">Manually tracked -- no card is charged from here. In-platform billing (Stripe or a local gateway) is planned for a later release.</p>
          <div className="space-y-3">
            <Row label="Price/mo (USD)"><input type="number" min={0} value={billingDraft.price} onChange={e => setBillingDraft(d => ({
              ...d,
              price: Number(e.target.value)
            }))} className="w-28 rounded-lg border border-line bg-surface px-2 py-1 text-sm" /></Row>
            <Row label="Cycle">
              <select value={billingDraft.cycle} onChange={e => setBillingDraft(d => ({
              ...d,
              cycle: e.target.value
            }))} className="rounded-lg border border-line bg-surface px-2 py-1 text-sm">
                <option value="monthly">Monthly</option><option value="annual">Annual</option>
              </select>
            </Row>
            <Row label="Payment status">
              <select value={billingDraft.status} onChange={e => setBillingDraft(d => ({
              ...d,
              status: e.target.value
            }))} className="rounded-lg border border-line bg-surface px-2 py-1 text-sm">
                <option value="trial">Trial</option><option value="paid">Paid</option><option value="failed">Failed</option><option value="none">None</option>
              </select>
            </Row>
            <Row label="Invoiced outside platform">
              <input type="checkbox" checked={billingDraft.invoicedOutside} onChange={e => setBillingDraft(d => ({
              ...d,
              invoicedOutside: e.target.checked
            }))} className="h-4 w-4" />
            </Row>
            <Row label="Lifetime revenue"><span className="text-sm text-ink">{money(detail.lifetime_revenue_cents)}</span></Row>
            <button onClick={saveBilling} disabled={saving === "billing"} className="rounded-lg bg-accent px-4 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-60">Save billing</button>
          </div>
        </div>

        <div className="space-y-5">
          <div className="card p-5">
            <h2 className="mb-3 font-heading text-base font-semibold text-ink">Admin users</h2>
            {/* An Editor/Viewer's password-change request is approved by one of this tenant's own Admins from
               their Team page -- only an Admin's own request has no one above them inside the tenant to approve
               it, which is exactly why it surfaces here instead. */}
            <div className="divide-y divide-line">
              {detail.team.map(m => <div key={m.id} className="flex items-center justify-between gap-3 py-2">
                  <span className="min-w-0 truncate text-sm text-ink">{m.email}</span>
                  <span className="flex shrink-0 items-center gap-2">
                    {m.role === "admin" && m.password_change_requested_at && !m.password_change_approved_at && <button onClick={() => approvePassword(m.id)} disabled={approvingPassword === m.id} className="rounded-full bg-accent px-2.5 py-0.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-60">
                        {approvingPassword === m.id ? "Approving…" : "Approve password change"}
                      </button>}
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${m.role === "admin" ? "chip-approved" : "chip-neutral"}`}>{m.role}</span>
                  </span>
                </div>)}
              {detail.team.length === 0 && <p className="py-2 text-sm text-muted">No staff yet.</p>}
            </div>
          </div>

          <div className="card p-5">
            <h2 className="mb-3 font-heading text-base font-semibold text-ink">Support notes</h2>
            <div className="mb-3 flex gap-2">
              <input value={newNote} onChange={e => setNewNote(e.target.value)} placeholder="Add a note…" className="flex-1 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm" />
              <button onClick={addNote} disabled={saving === "note"} className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-ink hover:bg-tint">Add</button>
            </div>
            <div className="divide-y divide-line">
              {detail.support_notes.map(n => <div key={n.id} className="flex items-center justify-between gap-3 py-2">
                  <div>
                    <div className="text-sm text-ink">{n.note}</div>
                    <div className="text-xs text-muted">{n.created_by} · {dateStr(n.created_at)}</div>
                  </div>
                  <button onClick={() => resolveNote(n.id, n.status === "open" ? "resolved" : "open")} className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${n.status === "open" ? "chip-draft" : "chip-approved"}`}>
                    {n.status === "open" ? "Open" : "Resolved"}
                  </button>
                </div>)}
              {detail.support_notes.length === 0 && <p className="py-2 text-sm text-muted">No support notes.</p>}
            </div>
          </div>
        </div>
      </div>
    </div>;
}
function Kpi({
  label,
  value
}) {
  return <div className="card p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 font-heading text-xl font-semibold text-ink">{value}</div>
    </div>;
}
function Row({
  label,
  children
}) {
  return <div className="flex items-center justify-between gap-3"><span className="text-sm text-ink-2">{label}</span>{children}</div>;
}