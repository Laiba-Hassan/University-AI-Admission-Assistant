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

export async function getOverview(tx: Tx, period: Period) {
  const since = new Date(Date.now() - DAYS[period] * 86_400_000);
  const tenant = (await tx.query("SELECT working_hours, fee_stale_after_days FROM tenants")).rows[0] as
    { working_hours: WorkingHours; fee_stale_after_days: number };

  // Sequential, deliberately: tx is one PoolClient/connection, and firing queries concurrently on it (Promise.all)
  // is unsafe -- node-pg only queues them, but interleaves parameter binding in a way that silently corrupts
  // which $1 goes with which statement (this shipped once as a real bug: a bogus "column ... does not exist").
  const conversations = await tx.query(`SELECT id, status, started_at, last_message_at FROM conversations WHERE started_at >= $1`, [since]);
  const leads = await tx.query(`SELECT id, created_at FROM leads WHERE created_at >= $1`, [since]);
  const assistantMsgs = await tx.query(`SELECT "timestamp", metadata FROM messages WHERE role = 'assistant' AND "timestamp" >= $1`, [since]);

  let afterHours = 0, verifiedOk = 0, verifierRan = 0, unanswered = 0;
  for (const row of assistantMsgs.rows as { timestamp: Date; metadata: { verifier?: { ok: boolean }; unanswered?: unknown[] } }[]) {
    if (isWithinWorkingHours(tenant.working_hours, row.timestamp) === false) afterHours++;
    if (row.metadata.verifier) { verifierRan++; if (row.metadata.verifier.ok) verifiedOk++; }
    if (row.metadata.unanswered?.length) unanswered++;
  }
  const escalated = (conversations.rows as { status: string }[]).filter((c) => c.status === "needs_human" || c.status === "human").length;

  // Weekly buckets across the period, for the two charts (design doc: "Volume trend" and "Resolution").
  const buckets = new Map<string, { conversations: number; leads: number; resolved: number; escalated: number }>();
  for (const c of conversations.rows as { status: string; started_at: Date }[]) {
    const key = weekBucket(c.started_at);
    const b = buckets.get(key) ?? { conversations: 0, leads: 0, resolved: 0, escalated: 0 };
    b.conversations++;
    if (c.status === "needs_human" || c.status === "human") b.escalated++; else if (c.status === "closed") b.resolved++;
    buckets.set(key, b);
  }
  for (const l of leads.rows as { created_at: Date }[]) {
    const key = weekBucket(l.created_at);
    const b = buckets.get(key) ?? { conversations: 0, leads: 0, resolved: 0, escalated: 0 };
    b.leads++;
    buckets.set(key, b);
  }
  const trend = [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([week, v]) => ({ week, ...v }));

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
      conversations: conversations.rows.length,
      leads_captured: leads.rows.length,
      after_hours_answered: afterHours,
      handoff_rate: pct(escalated, conversations.rows.length),
      unanswered_rate: pct(unanswered, assistantMsgs.rows.length),
      verified_reply_rate: pct(verifiedOk, verifierRan),
    },
    trend,
    needs_attention: {
      conversations_waiting: { count: needsReply.rows[0].n, longest_wait_minutes: needsReply.rows[0].longest_wait_minutes ?? 0 },
      knowledge_base_drafts: { count: draftCount.rows[0].n },
      stale_fees: { count: staleFees.rows[0].n },
    },
    top_unanswered_questions: topUnanswered.rows,
  };
}
