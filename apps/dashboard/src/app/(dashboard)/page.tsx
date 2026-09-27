"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Kpi, KpiStrip } from "@/components/Kpi";
import { ResolutionChart, VolumeTrendChart, type TrendPoint } from "@/components/TrendCharts";
import { API_URL } from "@/lib/config";
import { getAccessToken, useStaffSession } from "@/lib/session";

interface Overview {
  period: string;
  kpis: {
    conversations: number; leads_captured: number; after_hours_answered: number;
    handoff_rate: number; unanswered_rate: number; verified_reply_rate: number;
  };
  trend: TrendPoint[];
  needs_attention: {
    conversations_waiting: { count: number; longest_wait_minutes: number };
    knowledge_base_drafts: { count: number };
    stale_fees: { count: number };
  };
  top_unanswered_questions: { question_text: string; count: number; last_seen: string }[];
}
interface Channels { web_widget: { status: string } | null; whatsapp: { status: string } | null }

const PERIODS = [["7d", "7d"], ["30d", "30d"], ["90d", "90d"]] as const;

export default function OverviewPage() {
  const session = useStaffSession();
  const [period, setPeriod] = useState<string>("30d");
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [channels, setChannels] = useState<Channels | null>(null);
  const [syncedAt, setSyncedAt] = useState<Date | null>(null);

  useEffect(() => {
    (async () => {
      const token = await getAccessToken();
      if (!token) return;
      const res = await fetch(`${API_URL}/api/v1/settings/channels`, { headers: { authorization: `Bearer ${token}` } });
      if (res.ok) setChannels(await res.json());
    })();
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const token = await getAccessToken();
      if (!token) return;
      try {
        const res = await fetch(`${API_URL}/api/v1/overview?period=${period}`, { headers: { authorization: `Bearer ${token}` } });
        if (!res.ok) throw new Error(String(res.status));
        if (!cancelled) { setData(await res.json()); setSyncedAt(new Date()); }
      } catch {
        if (!cancelled) setError("Couldn't load the overview. Try refreshing.");
      }
    })();
    return () => { cancelled = true; };
  }, [period]);

  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">{session.tenantName ?? " "}</p>
          <h1 className="font-heading text-[26px] font-semibold text-ink">Overview</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs text-ink-2">
            {channels?.web_widget && <ChannelDot label="Web" live={channels.web_widget.status === "active"} />}
            {channels?.whatsapp && <ChannelDot label="WhatsApp" live={channels.whatsapp.status === "active"} />}
            {syncedAt && <span className="text-muted">Synced {relativeTime(syncedAt)}</span>}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 rounded-lg border border-line bg-surface p-1">
            {PERIODS.map(([value, label]) => (
              <button
                key={value}
                onClick={() => setPeriod(value)}
                className={`rounded-md px-3 py-1 text-xs font-semibold ${period === value ? "bg-accent text-white" : "text-ink-2 hover:text-ink"}`}
              >
                {label}
              </button>
            ))}
          </div>
          <button aria-label="Notifications" className="flex h-9 w-9 items-center justify-center rounded-full border border-line bg-surface text-ink-2 hover:text-ink">
            <BellIcon />
          </button>
        </div>
      </div>

      {error && <p className="mt-6 text-sm" style={{ color: "var(--chip-rejected-fg)" }}>{error}</p>}
      {!data && !error && <p className="mt-6 text-sm text-muted">Loading…</p>}

      {data && (
        <>
          <div className="mt-6">
            <KpiStrip>
              <Kpi label="Conversations" value={data.kpis.conversations.toLocaleString()} trend={trendLabel(data.trend, "conversations")} />
              <Kpi label="Leads captured" value={data.kpis.leads_captured.toLocaleString()} trend={trendLabel(data.trend, "leads")} />
              <Kpi label="After-hours answered" value={data.kpis.after_hours_answered.toLocaleString()} />
              <Kpi label="Handoff rate" value={data.kpis.handoff_rate} suffix="%" />
              <Kpi label="Unanswered rate" value={data.kpis.unanswered_rate} suffix="%" />
              <Kpi label="Verified reply rate" value={data.kpis.verified_reply_rate} suffix="%" />
            </KpiStrip>
          </div>

          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            <div className="card p-5">
              <h2 className="font-heading text-[15px] font-semibold text-ink">Volume trend</h2>
              <p className="text-xs text-muted">Last {data.period}</p>
              <div className="mt-4"><VolumeTrendChart points={data.trend} /></div>
            </div>
            <div className="card p-5">
              <h2 className="font-heading text-[15px] font-semibold text-ink">Resolution</h2>
              <p className="text-xs text-muted">Last {data.period}</p>
              <div className="mt-4"><ResolutionChart points={data.trend} /></div>
            </div>
          </div>

          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            <div className="card p-5">
              <h2 className="font-heading text-[15px] font-semibold text-ink">Needs attention</h2>
              <ul className="mt-3 divide-y divide-line">
                <AttentionRow
                  count={data.needs_attention.conversations_waiting.count}
                  label="Conversations waiting for a reply"
                  detail={data.needs_attention.conversations_waiting.count ? `Longest wait: ${data.needs_attention.conversations_waiting.longest_wait_minutes} min` : undefined}
                  href="/inbox" cta="Open Inbox"
                />
                <AttentionRow count={data.needs_attention.knowledge_base_drafts.count} label="Knowledge Base drafts awaiting approval" href="/knowledge-base" cta="Review drafts" />
                <AttentionRow count={data.needs_attention.stale_fees.count} label="Fee records unverified for 90+ days" href="/knowledge-base" cta="Open Knowledge Base" />
              </ul>
            </div>
            <div className="card p-5">
              <div className="flex items-center justify-between">
                <h2 className="font-heading text-[15px] font-semibold text-ink">Top unanswered questions</h2>
                <Link href="/unanswered" className="text-xs font-semibold text-accent hover:underline">View all →</Link>
              </div>
              <ul className="mt-3 divide-y divide-line">
                {data.top_unanswered_questions.length === 0 && <li className="py-4 text-sm text-muted">Nothing unanswered recently.</li>}
                {data.top_unanswered_questions.map((q) => (
                  <li key={q.question_text} className="flex items-start justify-between gap-3 py-3">
                    <div>
                      <div className="text-sm text-ink">{q.question_text}</div>
                      <div className="mt-0.5 text-xs text-muted">last asked {new Date(q.last_seen).toLocaleDateString()}</div>
                    </div>
                    <span className="shrink-0 text-sm font-semibold text-ink-2">{q.count}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function AttentionRow({ count, label, detail, href, cta }: { count: number; label: string; detail?: string; href: string; cta: string }) {
  if (count === 0) return null;
  return (
    <li className="flex items-center justify-between gap-3 py-3">
      <div className="flex items-center gap-3">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold" style={{ background: "var(--chip-rejected-bg)", color: "var(--chip-rejected-fg)" }}>
          {count}
        </span>
        <div>
          <div className="text-sm text-ink">{label}</div>
          {detail && <div className="mt-0.5 text-xs text-muted">{detail}</div>}
        </div>
      </div>
      <Link href={href} className="shrink-0 text-xs font-semibold text-accent hover:underline">{cta} →</Link>
    </li>
  );
}

function ChannelDot({ label, live }: { label: string; live: boolean }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`h-1.5 w-1.5 rounded-full ${live ? "bg-emerald-500" : "bg-muted"}`} />
      {label} · {live ? "Live" : "Off"}
    </span>
  );
}

function relativeTime(d: Date) {
  const s = Math.round((Date.now() - d.getTime()) / 1000);
  if (s < 10) return "just now";
  if (s < 60) return `${s}s ago`;
  return `${Math.round(s / 60)}m ago`;
}

// A real week-over-week comparison from the same trend buckets the charts use, not a fabricated percentage.
function trendLabel(trend: TrendPoint[], key: "conversations" | "leads"): string | undefined {
  if (trend.length < 2) return undefined;
  const last = trend[trend.length - 1]![key], prev = trend[trend.length - 2]![key];
  if (prev === 0) return undefined;
  const pct = Math.round(((last - prev) / prev) * 100);
  return `${pct >= 0 ? "↑" : "↓"} ${Math.abs(pct)}% vs prior week`;
}

function BellIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}
