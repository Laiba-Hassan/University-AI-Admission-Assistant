import type { Tx } from "./db.js";

export type Period = "7d" | "30d" | "90d";
const DAYS: Record<Period, number> = { "7d": 7, "30d": 30, "90d": 90 };

interface WorkingHours { tz?: string; mon_fri?: string | null; sat?: string | null; sun?: string | null }

/** Server-side port of apps/widget/src/working-hours.ts's isWithinWorkingHours, for counting after-hours replies. */
function isWithinWorkingHours(hours: WorkingHours | undefined, at: Date): boolean | undefined {
  if (!hours?.tz) return undefined;
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", { timeZone: hours.tz, hour: "2-digit", minute: "2-digit", hour12: false, weekday: "short" }).formatToParts(at);
  } catch { return undefined; }
  const weekday = parts.find((p) => p.type === "weekday")?.value;
  const hour = Number(parts.find((p) => p.type === "hour")?.value);
  const minute = Number(parts.find((p) => p.type === "minute")?.value);
  if (!weekday || Number.isNaN(hour) || Number.isNaN(minute)) return undefined;
  const range = weekday === "Sat" ? hours.sat : weekday === "Sun" ? hours.sun : hours.mon_fri;
  if (!range) return false;
  const m = /^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/.exec(range);
  if (!m) return undefined;
  const nowMinutes = hour * 60 + minute, start = Number(m[1]) * 60 + Number(m[2]), end = Number(m[3]) * 60 + Number(m[4]);
  return nowMinutes >= start && nowMinutes < end;
}

const pct = (n: number, d: number) => (d === 0 ? 0 : Math.round((n / d) * 1000) / 10);
const weekBucket = (d: Date) => { const t = new Date(d); t.setUTCHours(0, 0, 0, 0); t.setUTCDate(t.getUTCDate() - t.getUTCDay()); return t.toISOString().slice(0, 10); };

interface Bucket { conversations: number; leads: number; resolved: number; escalated: number; afterHours: number; verifiedOk: number; verifierRan: number; unanswered: number; assistantMsgs: number }
const emptyBucket = (): Bucket => ({ conversations: 0, leads: 0, resolved: 0, escalated: 0, afterHours: 0, verifiedOk: 0, verifierRan: 0, unanswered: 0, assistantMsgs: 0 });

/** Raw counts for one window (current or the prior, same-length window immediately before it), everything the
 * six KPI cards and their "vs {period}" comparison need. Also buckets by week so the two charts and each KPI's
 * sparkline have real history, not a single number. */
async function windowStats(tx: Tx, from: Date, to: Date, tenant: { working_hours: WorkingHours }) {
  const conversations = await tx.query(`SELECT id, status, started_at FROM conversations WHERE started_at >= $1 AND started_at < $2`, [from, to]);
  const leads = await tx.query(`SELECT id, created_at FROM leads WHERE created_at >= $1 AND created_at < $2`, [from, to]);
  const assistantMsgs = await tx.query(`SELECT "timestamp", metadata FROM messages WHERE role = 'assistant' AND "timestamp" >= $1 AND "timestamp" < $2`, [from, to]);

  const buckets = new Map<string, Bucket>();
  const get = (key: string) => { const b = buckets.get(key) ?? emptyBucket(); buckets.set(key, b); return b; };

  let afterHours = 0, verifiedOk = 0, verifierRan = 0, unanswered = 0;
  for (const row of assistantMsgs.rows as { timestamp: Date; metadata: { verifier?: { ok: boolean }; unanswered?: unknown[] } }[]) {
    const b = get(weekBucket(row.timestamp));
    b.assistantMsgs++;
    if (isWithinWorkingHours(tenant.working_hours, row.timestamp) === false) { afterHours++; b.afterHours++; }
    if (row.metadata.verifier) { verifierRan++; b.verifierRan++; if (row.metadata.verifier.ok) { verifiedOk++; b.verifiedOk++; } }
    if (row.metadata.unanswered?.length) { unanswered++; b.unanswered++; }
  }
  let escalated = 0;
  for (const c of conversations.rows as { status: string; started_at: Date }[]) {
    const b = get(weekBucket(c.started_at));
    b.conversations++;
    if (c.status === "needs_human" || c.status === "human") { escalated++; b.escalated++; } else if (c.status === "closed") b.resolved++;
  }
  for (const l of leads.rows as { created_at: Date }[]) get(weekBucket(l.created_at)).leads++;

  return {
    conversations: conversations.rows.length, leads: leads.rows.length, escalated, afterHours, verifiedOk, verifierRan, unanswered,
    assistantMsgs: assistantMsgs.rows.length, buckets,
  };
}

type Direction = "up" | "down" | "flat";
/** A trend chip like the reference's "↑ 12% vs 30d" or "↙ 1.2 pts vs 30d": `good` says whether the arrow should
 * read as green (an increase is good for leads captured, a decrease is good for handoff rate) so the client
 * never has to know which direction is "good" for which metric. */
function delta(current: number, prior: number, opts: { unit: "%" | "pts"; higherIsBetter: boolean }): { direction: Direction; magnitude: number; unit: string; good: boolean } | null {
  if (prior === 0 && current === 0) return null;
  const diff = opts.unit === "pts" ? current - prior : prior === 0 ? null : ((current - prior) / prior) * 100;
  if (diff === null) return null;
  const rounded = Math.round(Math.abs(diff) * 10) / 10;
  if (rounded === 0) return { direction: "flat", magnitude: 0, unit: opts.unit, good: true };
  const direction: Direction = diff > 0 ? "up" : "down";
  const good = direction === "up" ? opts.higherIsBetter : !opts.higherIsBetter;
  return { direction, magnitude: rounded, unit: opts.unit, good };
}

export async function getOverview(tx: Tx, period: Period) {
  const days = DAYS[period];
  const now = new Date();
  const since = new Date(now.getTime() - days * 86_400_000);
  const priorSince = new Date(since.getTime() - days * 86_400_000);
  const tenant = (await tx.query("SELECT working_hours, fee_stale_after_days FROM tenants")).rows[0] as
    { working_hours: WorkingHours; fee_stale_after_days: number };

  // Sequential, deliberately: tx is one PoolClient/connection, and firing queries concurrently on it (Promise.all)
  // is unsafe -- node-pg only queues them, but interleaves parameter binding in a way that silently corrupts
  // which $1 goes with which statement (this shipped once as a real bug: a bogus "column ... does not exist").
  const current = await windowStats(tx, since, now, tenant);
  const prior = await windowStats(tx, priorSince, since, tenant);

  const trend = [...current.buckets.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([week, v]) => ({ week, conversations: v.conversations, leads: v.leads, resolved: v.resolved, escalated: v.escalated }));
  // Per-KPI sparkline: the same weekly buckets, reduced to just the one number each card cares about (a rate
  // where the KPI itself is a rate, a running count otherwise) -- real history, not a decorative squiggle.
  const weeklySeries = [...current.buckets.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v);
  const sparkline = {
    conversations: weeklySeries.map((b) => b.conversations),
    leads_captured: weeklySeries.map((b) => b.leads),
    after_hours_answered: weeklySeries.map((b) => b.afterHours),
    handoff_rate: weeklySeries.map((b) => pct(b.escalated, b.conversations)),
    unanswered_rate: weeklySeries.map((b) => pct(b.unanswered, b.assistantMsgs)),
    verified_reply_rate: weeklySeries.map((b) => pct(b.verifiedOk, b.verifierRan)),
  };

  const currentPct = {
    handoff_rate: pct(current.escalated, current.conversations), unanswered_rate: pct(current.unanswered, current.assistantMsgs),
    verified_reply_rate: pct(current.verifiedOk, current.verifierRan),
  };
  const priorPct = {
    handoff_rate: pct(prior.escalated, prior.conversations), unanswered_rate: pct(prior.unanswered, prior.assistantMsgs),
    verified_reply_rate: pct(prior.verifiedOk, prior.verifierRan),
  };
  const fallbackFired = current.assistantMsgs - current.verifierRan; // replies that skipped the verifier (no facts to check)
  const kpi_trends = {
    conversations: delta(current.conversations, prior.conversations, { unit: "%", higherIsBetter: true }),
    leads_captured: delta(current.leads, prior.leads, { unit: "%", higherIsBetter: true }),
    after_hours_answered: delta(current.afterHours, prior.afterHours, { unit: "%", higherIsBetter: true }),
    handoff_rate: delta(currentPct.handoff_rate, priorPct.handoff_rate, { unit: "pts", higherIsBetter: false }),
    unanswered_rate: delta(currentPct.unanswered_rate, priorPct.unanswered_rate, { unit: "pts", higherIsBetter: false }),
    verified_reply_rate: delta(currentPct.verified_reply_rate, priorPct.verified_reply_rate, { unit: "pts", higherIsBetter: true }),
  };

  const needsReply = await tx.query(`SELECT count(*)::int AS n, max(extract(epoch from (now() - last_message_at)) / 60)::int AS longest_wait_minutes FROM conversations WHERE status = 'needs_human'`);
  const draftCount = await tx.query(`SELECT
      (SELECT count(*) FROM programs WHERE status = 'draft') + (SELECT count(*) FROM fee_items WHERE status = 'draft') +
      (SELECT count(*) FROM faqs WHERE NOT approved) + (SELECT count(*) FROM intakes WHERE status = 'draft') +
      (SELECT count(*) FROM requirements WHERE status = 'draft') + (SELECT count(*) FROM scholarships WHERE status = 'draft') +
      (SELECT count(*) FROM faculties WHERE status = 'draft') + (SELECT count(*) FROM campuses WHERE status = 'draft')
    AS n`);
  const staleFees = await tx.query(
    `SELECT count(*)::int AS n FROM fee_items WHERE status = 'approved' AND (last_verified_at IS NULL OR last_verified_at < now() - make_interval(days => $1))`,
    [tenant.fee_stale_after_days]);
  const topUnanswered = await tx.query(`SELECT question_text, count, last_seen FROM unanswered_questions WHERE status = 'open' ORDER BY count DESC LIMIT 5`);

  return {
    period,
    kpis: {
      conversations: current.conversations,
      leads_captured: current.leads,
      after_hours_answered: current.afterHours,
      handoff_rate: currentPct.handoff_rate,
      unanswered_rate: currentPct.unanswered_rate,
      verified_reply_rate: currentPct.verified_reply_rate,
    },
    kpi_trends,
    kpi_sparklines: sparkline,
    fallback_fired: fallbackFired,
    trend,
    needs_attention: {
      conversations_waiting: { count: needsReply.rows[0].n, longest_wait_minutes: needsReply.rows[0].longest_wait_minutes ?? 0 },
      knowledge_base_drafts: { count: draftCount.rows[0].n },
      stale_fees: { count: staleFees.rows[0].n },
    },
    top_unanswered_questions: topUnanswered.rows,
  };
}
