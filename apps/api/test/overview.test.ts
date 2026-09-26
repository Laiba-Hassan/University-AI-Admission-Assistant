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

  // Two closed (AI-resolved), one escalated conversation, all inside the 30-day window.
  const contactIds: string[] = [];
  for (let i = 0; i < 3; i++) {
    contactIds.push((await asOwner(A, "INSERT INTO contacts (tenant_id, channel, external_id) VALUES (current_tenant_id(), 'web', $1) RETURNING id", [`c${i}`]))[0]!.id);
  }
  const conv = async (contactId: string, status: string) =>
    (await asOwner(A, "INSERT INTO conversations (tenant_id, contact_id, channel, status, started_at, last_message_at) VALUES (current_tenant_id(), $1, 'web', $2, now() - interval '2 days', now()) RETURNING id", [contactId, status]))[0]!.id as string;
  const closed1 = await conv(contactIds[0]!, "closed");
  const closed2 = await conv(contactIds[1]!, "closed");
  const escalated = await conv(contactIds[2]!, "needs_human");

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
    assert.equal(body.kpis.conversations, 4);
    assert.equal(body.kpis.leads_captured, 2);
    assert.equal(body.kpis.handoff_rate, pct(1, 4));
    assert.equal(body.kpis.unanswered_rate, pct(1, 3));
    assert.equal(body.kpis.verified_reply_rate, pct(1, 2)); // 1 of 2 verifier-checked replies passed
    assert.equal(body.needs_attention.conversations_waiting.count, 1);
    assert.equal(body.top_unanswered_questions[0]!.question_text, "refund policy?");
    assert.equal(body.top_unanswered_questions[0]!.count, 5);
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
