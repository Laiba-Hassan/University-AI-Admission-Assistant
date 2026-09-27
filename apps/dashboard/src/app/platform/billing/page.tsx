"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { money, PlatformHeader } from "@/components/PlatformHeader";
import { apiJson } from "@/lib/api";

interface Row {
  id: string; name: string; plan_label: string; plan_price_cents: number; billing_cycle: string; payment_status: string;
  invoiced_outside_platform: boolean; status: string;
}
interface Billing { mrr_cents: number; arr_cents: number; new_this_month: number; churned_this_month: number; failed_payments: { count: number; total_cents: number }; tenants: Row[] }

export default function BillingPage() {
  const [b, setB] = useState<Billing | null>(null);
  useEffect(() => { void apiJson<Billing>("/api/platform/billing").then(setB); }, []);
  if (!b) return <p className="text-sm text-muted">Loading…</p>;

  const failed = b.tenants.filter((t) => t.payment_status === "failed");

  return (
    <div>
      <PlatformHeader title="Billing" />
      <div className="mb-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Kpi label="Monthly recurring revenue" value={money(b.mrr_cents)} />
        <Kpi label="ARR run rate" value={money(b.arr_cents)} />
        <Kpi label="New vs. churned (this month)" value={`+${b.new_this_month} / −${b.churned_this_month}`} />
        <Kpi label="Failed payments" value={`${b.failed_payments.count} · ${money(b.failed_payments.total_cents)}`} warn={b.failed_payments.count > 0} />
      </div>

      {failed.length > 0 && (
        <div className="card mb-5 border-l-4 p-4 text-sm" style={{ borderLeftColor: "var(--chip-rejected-fg)", background: "color-mix(in srgb, var(--chip-rejected-bg) 60%, var(--bg))" }}>
          <strong>{failed.length} tenant{failed.length > 1 ? "s" : ""} have failed payments</strong> — {failed.map((t) => `${t.name} (${money(t.plan_price_cents)})`).join(", ")}.{" "}
          {money(failed.reduce((s, t) => s + t.plan_price_cents, 0))} total past due.
        </div>
      )}

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[820px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs font-semibold uppercase tracking-wide text-muted">
              <th className="px-5 py-3">Tenant</th><th className="px-3 py-3">Plan</th><th className="px-3 py-3">Price</th><th className="px-3 py-3">Cycle</th>
              <th className="px-3 py-3">Payment status</th><th className="px-3 py-3">Invoiced outside platform</th><th className="px-5 py-3 text-right">Detail</th>
            </tr>
          </thead>
          <tbody>
            {b.tenants.map((t) => (
              <tr key={t.id} className="border-b border-line last:border-0">
                <td className="px-5 py-3 font-medium text-ink">{t.name}</td>
                <td className="px-3 py-3 capitalize text-ink-2">{t.plan_label}</td>
                <td className="px-3 py-3 text-ink-2">{t.plan_price_cents ? `${money(t.plan_price_cents)}/mo` : "$0"}</td>
                <td className="px-3 py-3 capitalize text-ink-2">{t.billing_cycle}</td>
                <td className="px-3 py-3">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${t.payment_status === "paid" ? "chip-approved" : t.payment_status === "failed" ? "chip-rejected" : "chip-neutral"}`}>{t.payment_status}</span>
                </td>
                <td className="px-3 py-3 text-ink-2">{t.invoiced_outside_platform ? "Yes" : "No"}</td>
                <td className="px-5 py-3 text-right"><Link href={`/platform/tenants/${t.id}`} className="text-xs font-semibold text-accent hover:underline">View →</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-muted">&quot;Invoiced outside platform&quot; tracks manual invoicing until in-platform billing (Stripe or a local gateway) ships in a later release.</p>
    </div>
  );
}

function Kpi({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="card p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 font-heading text-xl font-semibold" style={warn ? { color: "var(--chip-rejected-fg)" } : { color: "var(--ink)" }}>{value}</div>
    </div>
  );
}
