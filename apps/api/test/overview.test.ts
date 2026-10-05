// The staff dashboard's Overview page (Phase 5): KPIs, weekly trend and "needs attention" computed from real
// conversations/leads/messages/unanswered_questions rows, behind the same staff auth as the rest of /api/v1.
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { createTenant, deleteTenants, staffToken, withOwner, type Fixture } from "./fixtures.js";

let A: Fixture, server: Server, base: string;
let db: typeof import("../src/db.js");

const asOwner = (t: Fixture, sql: string, params: unknown[] = []) => withOwner(async (c) => {
  await c.query("BEGIN");
  await c.query("SELECT set_config('app.tenant_id', $1, true)", [t.id]);
  const r = await c.query(sql, params);
  await c.query("COMMIT");
  return r.rows;
});

const overview = async (period?: string) => {
  const token = await staffToken(A.authUserId);
  return fetch(`${base}/api/v1/overview${period ? `?period=${period}` : ""}`, { headers: { authorization: `Bearer ${token}` } });
};

before(async () => {
  db = await import("../src/db.js");
  const { createApp } = await import("../src/app.js");
  A = await withOwner((c) => createTenant(c, "Overview", 100_000));
  server = createApp(async () => null).listen(0);
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

  // Two closed (AI-resolved) and two escalated conversations -- one handed off by the AI, one where the student
  // asked for a person -- all inside the 30-day window, so the Resolution split has both sources to separate.
  const contactIds: string[] = [];
  for (let i = 0; i < 4; i++) {
    contactIds.push((await asOwner(A, "INSERT INTO contacts (tenant_id, channel, external_id) VALUES (current_tenant_id(), 'web', $1) RETURNING id", [`c${i}`]))[0]!.id);
  }
  const conv = async (contactId: string, status: string) =>
    (await asOwner(A, "INSERT INTO conversations (tenant_id, contact_id, channel, status, started_at, last_message_at) VALUES (current_tenant_id(), $1, 'web', $2, now() - interval '2 days', now()) RETURNING id", [contactId, status]))[0]!.id as string;
  const closed1 = await conv(contactIds[0]!, "closed");
  const closed2 = await conv(contactIds[1]!, "closed");
  const escalated = await conv(contactIds[2]!, "needs_human");
  const escalatedByStudent = await conv(contactIds[3]!, "needs_human");
  await asOwner(A, "UPDATE conversations SET handoff_source = 'ai' WHERE id = $1", [escalated]);
  await asOwner(A, "UPDATE conversations SET handoff_source = 'student' WHERE id = $1", [escalatedByStudent]);

  // Verified assistant reply, an unverified one, and one flagged unanswered -- verified_reply_rate should be 1/2
  // (the unanswered one never ran the verifier), unanswered_rate 1/3.
  await asOwner(A, `INSERT INTO messages (tenant_id, conversation_id, role, content, metadata) VALUES
    (current_tenant_id(), $1, 'assistant', 'ok', '{"verifier":{"ok":true}}')`, [closed1]);
  await asOwner(A, `INSERT INTO messages (tenant_id, conversation_id, role, content, metadata) VALUES
    (current_tenant_id(), $1, 'assistant', 'ok', '{"verifier":{"ok":false}}')`, [closed2]);
  await asOwner(A, `INSERT INTO messages (tenant_id, conversation_id, role, content, metadata) VALUES
    (current_tenant_id(), $1, 'assistant', 'sorry', '{"unanswered":["what is the weather"]}')`, [escalated]);

  await asOwner(A, "INSERT INTO leads (tenant_id, contact_id, name, status) VALUES (current_tenant_id(), $1, 'Ayesha Khan', 'new')", [contactIds[0]]);
  await asOwner(A, "INSERT INTO unanswered_questions (tenant_id, question_text, count) VALUES (current_tenant_id(), 'refund policy?', 5)");
});
after(async () => { server.close(); await deleteTenants([A.id]); await db.pool.end(); });

describe("GET /api/v1/me", () => {
  it("returns the tenant name alongside id and role, for the sidebar/top bar", async () => {
    const token = await staffToken(A.authUserId);
    const res = await fetch(`${base}/api/v1/me`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { tenantId: string; role: string; tenantName: string };
    assert.equal(body.tenantId, A.id);
    assert.equal(body.role, "viewer");
    assert.equal(body.tenantName, A.name);
  });

  it("auto-fills full_name from a Google sign-in's token the first time it sees one, but never overwrites a name already on file", async () => {
    const token = await staffToken(A.authUserId, { claims: { user_metadata: { full_name: "Sana Tariq" } } });
    const res = await fetch(`${base}/api/v1/me`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal((await res.json() as { fullName: string }).fullName, "Sana Tariq");
    // getTeam() must see the same name the next request filled in, not just this response -- confirms it was
    // actually persisted to tenant_users, not merely echoed back from the token.
    const [row] = await asOwner(A, "SELECT full_name FROM tenant_users WHERE auth_user_id = $1", [A.authUserId]);
    assert.equal(row!.full_name, "Sana Tariq");

    // A second sign-in with a DIFFERENT Google name must not clobber what's already saved -- COALESCE, not
    // overwrite, is what makes a manual edit in Account Settings stick permanently afterward.
    const token2 = await staffToken(A.authUserId, { claims: { user_metadata: { full_name: "Someone Else" } } });
    const res2 = await fetch(`${base}/api/v1/me`, { headers: { authorization: `Bearer ${token2}` } });
    assert.equal((await res2.json() as { fullName: string }).fullName, "Sana Tariq");
  });

  it("PATCH /me persists a manually-entered full_name", async () => {
    const token = await staffToken(A.authUserId);
    const res = await fetch(`${base}/api/v1/me`, { method: "PATCH", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ full_name: "Sana Q. Tariq" }) });
    assert.equal(res.status, 204);
    const me = await (await fetch(`${base}/api/v1/me`, { headers: { authorization: `Bearer ${token}` } })).json() as { fullName: string };
    assert.equal(me.fullName, "Sana Q. Tariq");
  });
});

describe("GET /api/v1/overview", () => {
  it("requires a staff session", async () => {
    const res = await fetch(`${base}/api/v1/overview`);
    assert.equal(res.status, 401);
  });

  it("computes KPIs from real conversation/message/lead rows", async () => {
    const res = await overview("30d");
    assert.equal(res.status, 200);
    const body = (await res.json()) as { kpis: Record<string, number>; needs_attention: { conversations_waiting: { count: number }; stale_fees: { count: number } }; top_unanswered_questions: { question_text: string; count: number }[] };
    // +1 conversation/lead throughout: createTenant's own fixture setup seeds one default (open) conversation
    // and lead alongside the three this test adds -- its message is role 'user', so it never counts toward the
    // assistant-only KPIs (verified_reply_rate, unanswered_rate).
    assert.equal(body.kpis.conversations, 5);
    assert.equal(body.kpis.leads_captured, 2);
    assert.equal(body.kpis.handoff_rate, pct(2, 5));
    assert.equal(body.kpis.unanswered_rate, pct(1, 3));
    assert.equal(body.kpis.verified_reply_rate, pct(1, 2)); // 1 of 2 verifier-checked replies passed
    assert.equal(body.needs_attention.conversations_waiting.count, 2);
    assert.equal(body.top_unanswered_questions[0]!.question_text, "refund policy?");
    assert.equal(body.top_unanswered_questions[0]!.count, 5);
  });

  it("splits escalations by who caused the handoff, instead of one combined total", async () => {
    const res = await overview("30d");
    const body = (await res.json()) as {
      kpis: Record<string, number>;
      escalation_sources: { ai: number; student: number; staff: number; unrecorded: number };
      trend: { escalated: number; escalated_ai: number; escalated_student: number; escalated_staff: number; escalated_unknown: number }[];
    };
    // "the AI gave up" and "the student asked for a person" are different problems; the chart has to tell them apart.
    assert.deepEqual(body.escalation_sources, { ai: 1, student: 1, staff: 0, unrecorded: 0 });
    // The per-source counts must still add up to the same total the handoff-rate KPI is computed from, so the
    // stacked bars can never disagree with the KPI card above them.
    const sum = (k: keyof (typeof body.trend)[number]) => body.trend.reduce((n, w) => n + w[k], 0);
    assert.equal(sum("escalated"), 2);
    assert.equal(sum("escalated_ai") + sum("escalated_student") + sum("escalated_staff") + sum("escalated_unknown"), sum("escalated"));
  });

  it("reports an escalation with no recorded source as unrecorded rather than guessing one", async () => {
    // Conversations escalated before migration 0020 existed have no source; they must still count toward the
    // total, just in their own bucket -- never silently attributed to the AI or the student.
    const contact = (await asOwner(A, "INSERT INTO contacts (tenant_id, channel, external_id) VALUES (current_tenant_id(), 'web', 'legacy') RETURNING id"))[0]!.id;
    const legacy = (await asOwner(A, "INSERT INTO conversations (tenant_id, contact_id, channel, status, started_at, last_message_at) VALUES (current_tenant_id(), $1, 'web', 'needs_human', now() - interval '2 days', now()) RETURNING id", [contact]))[0]!.id;
    try {
      const body = (await (await overview("30d")).json()) as { escalation_sources: { ai: number; unrecorded: number } };
      assert.equal(body.escalation_sources.unrecorded, 1);
      assert.equal(body.escalation_sources.ai, 1); // unchanged -- the unsourced row was not folded into a real source
    } finally {
      await asOwner(A, "DELETE FROM conversations WHERE id = $1", [legacy]);
      await asOwner(A, "DELETE FROM contacts WHERE id = $1", [contact]);
    }
  });

  it("computes a vs-prior-period trend per KPI, with the right sign of 'good' per metric", async () => {
    const res = await overview("30d");
    const body = (await res.json()) as { kpi_trends: Record<string, { direction: string; magnitude: number; unit: string; good: boolean } | null> };
    // Everything in this fixture happened inside the last 2 days -- the prior 30-day window (days 31-60 ago) is
    // empty, so every count-based KPI shows a 100%-style increase from zero... except delta() treats prior===0
    // as "can't compute a % from nothing" and returns null for those; only the two rate KPIs (already 0 in the
    // empty prior window) get a real pts comparison.
    assert.equal(body.kpi_trends.conversations, null);
    assert.ok(body.kpi_trends.handoff_rate); // 25% now vs 0% prior -> a real +25pts delta
    assert.equal(body.kpi_trends.handoff_rate!.direction, "up");
    assert.equal(body.kpi_trends.handoff_rate!.good, false); // handoff rate going UP is bad, so 'good' must be false
    assert.ok(body.kpi_trends.verified_reply_rate);
    assert.equal(body.kpi_trends.verified_reply_rate!.good, true); // verified reply rate going UP is good
  });

  it("rejects an invalid period instead of guessing, falling back to 30d", async () => {
    const res = await overview("1y");
    assert.equal(res.status, 200);
    assert.equal((await res.json() as { period: string }).period, "30d");
  });

  it("does not see another tenant's conversations", async () => {
    const [B] = await withOwner(async (c) => [await createTenant(c, "OverviewOther", 50_000)]);
    const token = await staffToken(B.authUserId);
    const res = await fetch(`${base}/api/v1/overview`, { headers: { authorization: `Bearer ${token}` } });
    const body = (await res.json()) as { kpis: { conversations: number } };
    assert.equal(body.kpis.conversations, 1); // B's own default fixture conversation only, never A's 4
    await deleteTenants([B.id]);
  });
});

function pct(n: number, d: number) { return d === 0 ? 0 : Math.round((n / d) * 1000) / 10; }
