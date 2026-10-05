"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Kpi, KpiStrip } from "@/components/Kpi";
import { PlanModal } from "@/components/PlanModal";
import { NotificationsModal } from "@/components/ProfileModals";
import { ResolutionChart, ResolutionLegend, VolumeTrendChart } from "@/components/TrendCharts";
import { API_URL } from "@/lib/config";
import { getAccessToken, useStaffSession } from "@/lib/session";
import { useTheme } from "@/lib/theme";
const todayStr = () => new Date().toISOString().slice(0, 10);
const daysAgoStr = n => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
export default function OverviewPage() {
  const session = useStaffSession();
  const theme = useTheme();
  // No more preset buttons -- just a date range, defaulting to the last 30 days so the page has data on load.
  const [customFrom, setCustomFrom] = useState(() => daysAgoStr(30));
  const [customTo, setCustomTo] = useState(todayStr);
  const [notifOpen, setNotifOpen] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [channels, setChannels] = useState(null);
  const [onboarding, setOnboarding] = useState(null);
  const [syncedAt, setSyncedAt] = useState(null);
  useEffect(() => {
    (async () => {
      const token = await getAccessToken();
      if (!token) return;
      const res = await fetch(`${API_URL}/api/v1/settings/channels`, {
        headers: {
          authorization: `Bearer ${token}`
        }
      });
      if (res.ok) setChannels(await res.json());
      const ob = await fetch(`${API_URL}/api/v1/onboarding/status`, {
        headers: {
          authorization: `Bearer ${token}`
        }
      });
      if (ob.ok) setOnboarding(await ob.json());
    })();
  }, []);
  useEffect(() => {
    if (!customFrom || !customTo || customFrom > customTo) return;
    let cancelled = false;
    (async () => {
      const token = await getAccessToken();
      if (!token) return;
      try {
        const qs = `period=custom&start=${customFrom}&end=${customTo}`;
        const res = await fetch(`${API_URL}/api/v1/overview?${qs}`, {
          headers: {
            authorization: `Bearer ${token}`
          }
        });
        if (!res.ok) throw new Error(String(res.status));
        if (!cancelled) {
          setData(await res.json());
          setSyncedAt(new Date());
        }
      } catch {
        if (!cancelled) setError("Couldn't load the overview. Try refreshing.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [customFrom, customTo]);
  return <div>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-[26px] font-semibold text-ink">Overview</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs text-ink-2">
            {channels?.web_widget && <ChannelDot label="Web" live={channels.web_widget.status === "active"} />}
            {channels?.whatsapp && <ChannelDot label="WhatsApp" live={channels.whatsapp.status === "active"} />}
            {syncedAt && <span className="text-muted">Synced {relativeTime(syncedAt)}</span>}
            {onboarding && !onboarding.completed && <Link href="/onboarding" className="font-semibold text-accent hover:underline">Finish tenant setup →</Link>}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 rounded-lg border border-line bg-surface px-2 py-1.5 text-xs">
            <label className="flex items-center gap-1.5 text-ink-2">From
              <input type="date" value={customFrom} max={customTo || undefined} onChange={e => setCustomFrom(e.target.value)} className="rounded border border-line bg-bg px-1.5 py-0.5 text-ink" />
            </label>
            <label className="flex items-center gap-1.5 text-ink-2">To
              <input type="date" value={customTo} min={customFrom || undefined} max={todayStr()} onChange={e => setCustomTo(e.target.value)} className="rounded border border-line bg-bg px-1.5 py-0.5 text-ink" />
            </label>
          </div>
          <button onClick={theme.toggle} aria-label={theme.dark ? "Switch to light mode" : "Switch to dark mode"} className="flex h-9 w-9 items-center justify-center rounded-full border border-line bg-surface text-ink-2 hover:text-ink">
            {theme.dark ? <MoonIcon /> : <SunIcon />}
          </button>
          <button onClick={() => setNotifOpen(true)} aria-label="Notifications" className="flex h-9 w-9 items-center justify-center rounded-full border border-line bg-surface text-ink-2 hover:text-ink">
            <BellIcon />
          </button>
        </div>
      </div>

      <DemoBanner session={session} />
      <PaymentFailedBanner session={session} />

      {customFrom && customTo && customFrom > customTo && <p className="mt-3 text-xs" style={{
      color: "var(--chip-rejected-fg)"
    }}>"From" must be before "To".</p>}

      {error && <p className="mt-6 text-sm" style={{
      color: "var(--chip-rejected-fg)"
    }}>{error}</p>}
      {!data && !error && <p className="mt-6 text-sm text-muted">Loading…</p>}

      {data && <>
          <div className="mt-6">
            <KpiStrip>
              <Kpi label="Conversations" value={data.kpis.conversations.toLocaleString()} sparkline={data.kpi_sparklines.conversations} />
              <Kpi label="Leads captured" value={data.kpis.leads_captured.toLocaleString()} sparkline={data.kpi_sparklines.leads_captured} />
              <Kpi label="After-hours answered" value={data.kpis.after_hours_answered.toLocaleString()} sparkline={data.kpi_sparklines.after_hours_answered} />
              <Kpi label="Handoff rate" value={data.kpis.handoff_rate} suffix="%" sparkline={data.kpi_sparklines.handoff_rate} />
              <Kpi label="Unanswered rate" value={data.kpis.unanswered_rate} suffix="%" sparkline={data.kpi_sparklines.unanswered_rate} />
              <Kpi label="Verified reply rate" value={data.kpis.verified_reply_rate} suffix="%" sparkline={data.kpi_sparklines.verified_reply_rate} />
            </KpiStrip>
          </div>

          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            <div className="card p-5">
              <h2 className="font-heading text-[15px] font-semibold text-ink">Volume trend</h2>
              <p className="text-xs text-muted">{periodLabel(data)}</p>
              <div className="mt-4"><VolumeTrendChart points={data.trend} /></div>
            </div>
            <div className="card p-5">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="font-heading text-[15px] font-semibold text-ink">Resolution</h2>
                  <p className="text-xs text-muted">{periodLabel(data)}</p>
                </div>
                <ResolutionLegend points={data.trend} />
              </div>
              <div className="mt-4"><ResolutionChart points={data.trend} /></div>
            </div>
          </div>

          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            <div className="card p-5">
              <h2 className="font-heading text-[15px] font-semibold text-ink">Needs attention</h2>
              <ul className="mt-3 divide-y divide-line">
                <AttentionRow count={data.needs_attention.conversations_waiting.count} label="Conversations waiting for a reply" detail={data.needs_attention.conversations_waiting.count ? `Longest wait: ${data.needs_attention.conversations_waiting.longest_wait_minutes} min` : undefined} href="/inbox" cta="Open Inbox" />
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
                {data.top_unanswered_questions.map(q => <li key={q.question_text} className="flex items-start justify-between gap-3 py-3">
                    <div>
                      <div className="text-sm text-ink">{q.question_text}</div>
                      <div className="mt-0.5 text-xs text-muted">last asked {new Date(q.last_seen).toLocaleDateString()}</div>
                    </div>
                    <span className="shrink-0 text-sm font-semibold text-ink-2">{q.count}</span>
                  </li>)}
              </ul>
            </div>
          </div>
        </>}
      {notifOpen && <NotificationsModal onClose={() => setNotifOpen(false)} />}
    </div>;
}
/** Demo urgency escalates day by day: "4d" -> "3d" -> "2d" -> "1d", then on the final calendar day a live
 * ticking clock instead of "0d"/"1d" (the user asked for this exact progression). Once the time is actually up,
 * the widget itself has already stopped answering (enforced server-side, migration 0023) -- this just reflects
 * that in the dashboard and traps the admin in a required, undismissable PlanModal until they pick one. */
function DemoBanner({
  session
}) {
  const [now, setNow] = useState(Date.now());
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const isDemo = session.planLabel === "demo" && session.demoExpiresAt;
  useEffect(() => {
    if (!isDemo) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isDemo]);
  if (!isDemo) return null;
  const msLeft = new Date(session.demoExpiresAt).getTime() - now;
  const expired = msLeft <= 0;
  const daysLeft = Math.floor(msLeft / 86_400_000);
  const showModal = expired || upgradeOpen;
  return <>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg px-3.5 py-2.5 text-sm" style={{
      background: expired ? "var(--chip-rejected-bg)" : "var(--tint)",
      color: expired ? "var(--chip-rejected-fg)" : "var(--ink-2)"
    }}>
        <span>
          {expired ? "Your demo has ended — choose a plan to keep your assistant answering students." : daysLeft >= 1 ? `Demo plan expires in ${daysLeft}d.` : `Demo plan expires in ${formatHMS(msLeft)}.`}
        </span>
        <button onClick={() => setUpgradeOpen(true)} className="shrink-0 rounded-full bg-accent px-3 py-1 text-xs font-semibold text-white hover:opacity-90">
          {expired ? "Choose a plan" : "Upgrade"}
        </button>
      </div>
      {showModal && <PlanModal session={session} required={expired} reason="demo" onClose={() => setUpgradeOpen(false)} onSuccess={() => setUpgradeOpen(false)} />}
    </>;
}
const GRACE_DAYS = 5; // mirrors billing.ts's GRACE_DAYS and migration 0024's resolver functions
/** Mirrors DemoBanner, for the OTHER reason the widget can stop answering: the card on file has been failing
 * since payment_failed_at (set by the Stripe webhook, billing.ts's onInvoicePaymentFailed). Same escalation
 * shape -- days remaining, then forced once the grace period is actually up. */
function PaymentFailedBanner({
  session
}) {
  const [now, setNow] = useState(Date.now());
  const [fixOpen, setFixOpen] = useState(false);
  const isFailing = Boolean(session.paymentFailedAt) && session.planLabel !== "demo";
  useEffect(() => {
    if (!isFailing) return;
    const id = setInterval(() => setNow(Date.now()), 60_000); // a day-granularity banner doesn't need 1s ticks
    return () => clearInterval(id);
  }, [isFailing]);
  if (!isFailing) return null;
  const deadline = new Date(session.paymentFailedAt).getTime() + GRACE_DAYS * 86_400_000;
  const daysLeft = Math.max(0, Math.ceil((deadline - now) / 86_400_000));
  const expired = now >= deadline;
  const showModal = expired || fixOpen;
  return <>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg px-3.5 py-2.5 text-sm" style={{
      background: "var(--chip-rejected-bg)",
      color: "var(--chip-rejected-fg)"
    }}>
        <span>
          {expired ? "Your last payment failed and the grace period is up — your assistant has stopped answering." : `Your last payment failed. Update your card within ${daysLeft}d to keep your assistant answering.`}
        </span>
        <button onClick={() => setFixOpen(true)} className="shrink-0 rounded-full bg-accent px-3 py-1 text-xs font-semibold text-white hover:opacity-90">
          {expired ? "Fix now" : "Update card"}
        </button>
      </div>
      {showModal && <PlanModal session={session} required={expired} reason="payment" onClose={() => setFixOpen(false)} onSuccess={() => setFixOpen(false)} />}
    </>;
}
function formatHMS(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = String(Math.floor(total / 3600)).padStart(2, "0");
  const m = String(Math.floor(total % 3600 / 60)).padStart(2, "0");
  const s = String(total % 60).padStart(2, "0");
  return `${h}:${m}:${s}`;
}
function AttentionRow({
  count,
  label,
  detail,
  href,
  cta
}) {
  if (count === 0) return null;
  return <li className="flex items-center justify-between gap-3 py-3">
      <div className="flex items-center gap-3">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold" style={{
        background: "var(--chip-rejected-bg)",
        color: "var(--chip-rejected-fg)"
      }}>
          {count}
        </span>
        <div>
          <div className="text-sm text-ink">{label}</div>
          {detail && <div className="mt-0.5 text-xs text-muted">{detail}</div>}
        </div>
      </div>
      <Link href={href} className="shrink-0 text-xs font-semibold text-accent hover:underline">{cta} →</Link>
    </li>;
}
function ChannelDot({
  label,
  live
}) {
  return <span className="flex items-center gap-1.5">
      <span className={`h-1.5 w-1.5 rounded-full ${live ? "bg-emerald-500" : "bg-muted"}`} />
      {label} · {live ? "Live" : "Off"}
    </span>;
}
function periodLabel(data) {
  if (data.period !== "custom") return `Last ${data.period}`;
  const fmt = iso => new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric"
  });
  return `${fmt(data.from)} – ${fmt(data.to)}`;
}
function relativeTime(d) {
  const s = Math.round((Date.now() - d.getTime()) / 1000);
  if (s < 10) return "just now";
  if (s < 60) return `${s}s ago`;
  return `${Math.round(s / 60)}m ago`;
}
function BellIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>;
}
function SunIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </svg>;
}
function MoonIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>;
}