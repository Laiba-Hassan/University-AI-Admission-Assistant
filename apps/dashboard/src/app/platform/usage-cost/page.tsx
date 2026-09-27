"use client";
import { useEffect, useState } from "react";
import { money, PlatformHeader } from "@/components/PlatformHeader";
import { apiJson } from "@/lib/api";

interface Row { tenant_id: string; name: string; conversations: number; whatsapp_messages: number; tokens: number; estimated_cost_cents: number; nearing_limit: boolean }
interface UsageCost { totals: { conversations: number; tokens: number; cost_cents: number }; tenants: Row[]; note: string }

const fmtTokens = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(0)}K` : String(n));

export default function UsageCostPage() {
  const [u, setU] = useState<UsageCost | null>(null);
  useEffect(() => { void apiJson<UsageCost>("/api/platform/usage-cost").then(setU); }, []);
  if (!u) return <p className="text-sm text-muted">Loading…</p>;

  return (
    <div>
      <PlatformHeader title="Usage & Cost" />
      <div className="mb-5 grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Kpi label="Conversations (30d)" value={u.totals.conversations.toLocaleString()} />
        <Kpi label="Tokens consumed (30d)" value={fmtTokens(u.totals.tokens)} />
        <Kpi label="Estimated AI cost (30d)" value={money(u.totals.cost_cents)} />
      </div>
      <p className="mb-4 text-xs text-muted">{u.note}</p>

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs font-semibold uppercase tracking-wide text-muted">
              <th className="px-5 py-3">Tenant</th><th className="px-3 py-3">Conversations</th><th className="px-3 py-3">WhatsApp msgs</th>
              <th className="px-3 py-3">Tokens</th><th className="px-3 py-3">Est. cost</th><th className="px-5 py-3">Flag</th>
            </tr>
          </thead>
          <tbody>
            {u.tenants.map((t) => (
              <tr key={t.tenant_id} className="border-b border-line last:border-0">
                <td className="px-5 py-3 font-medium text-ink">{t.name}</td>
                <td className="px-3 py-3 text-ink-2">{t.conversations.toLocaleString()}</td>
                <td className="px-3 py-3 text-ink-2">{t.whatsapp_messages.toLocaleString()}</td>
                <td className="px-3 py-3 text-ink-2">{fmtTokens(t.tokens)}</td>
                <td className="px-3 py-3 text-ink-2">{money(t.estimated_cost_cents)}</td>
                <td className="px-5 py-3">{t.nearing_limit && <span className="chip-rejected rounded-full px-2 py-0.5 text-xs font-semibold">Nearing limit</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-muted">&quot;Nearing limit&quot; = 90%+ of the monthly conversation cap.</p>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="card p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 font-heading text-xl font-semibold text-ink">{value}</div>
    </div>
  );
}
