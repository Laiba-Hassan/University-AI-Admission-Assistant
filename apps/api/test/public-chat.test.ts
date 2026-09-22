// HTTP-level tests of the public widget/chat surface (PRD Section 6.1/11): the bot challenge, monthly and per-
// conversation limits, explicit handoff, feedback, forced language, and the widget config payload. Uses a fake
// challenge verifier and a scripted fake model, so nothing here calls Cloudflare or Gemini.
//
// Every test group uses its own synthetic client IP (sent as X-Forwarded-For; app.ts trusts one proxy hop) so that
// unrelated scenarios in this file don't trip each other's per-IP rate-limit bucket just from sharing 127.0.0.1 --
// the IP dimension itself is covered directly in ratelimit.test.ts.
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { createTenant, deleteTenants, withOwner, type Fixture } from "./fixtures.js";
import type { ChallengeVerifier } from "../src/challenge.js";
import type { Content, GenerateRequest, GenerateResult, LlmProvider } from "../src/agent/llm.js";

let A: Fixture, server: Server, base: string;
let db: typeof import("../src/db.js");
let config: typeof import("../src/config.js").config;

const say = (text: string): Content => ({ role: "model", parts: [{ text }] });
const randomIp = () => `10.${randomUUID().split("-").map((h) => parseInt(h, 16) % 256).slice(0, 3).join(".")}`;

class FakeChallenge implements ChallengeVerifier {
  next = true; // toggled per test
  async verify() { return this.next; }
}
/** Replies come from a shared, mutable queue so the whole file can run against ONE long-lived server. */
class QueueProvider implements LlmProvider {
  queue: Content[] = [];
  async generate(_req: GenerateRequest): Promise<GenerateResult> {
    return { content: this.queue.shift() ?? say("ok"), inputTokens: 100, outputTokens: 10, model: "fake" };
  }
}

const fake = new FakeChallenge();
const provider = new QueueProvider();

const post = (path: string, body: unknown, ip: string, headers: Record<string, string> = {}) =>
  fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json", "x-widget-key": A.widgetKey, origin: A.origin, "x-forwarded-for": ip, ...headers }, body: JSON.stringify(body) });
const get = (path: string, ip: string, headers: Record<string, string> = {}) =>
  fetch(`${base}${path}`, { headers: { "x-widget-key": A.widgetKey, origin: A.origin, "x-forwarded-for": ip, ...headers } });
const session = () => randomUUID().replace(/-/g, "");
async function newSession(ip: string): Promise<{ sid: string; headers: Record<string, string> }> {
  const sid = session();
  const { challenge_pass } = (await (await post("/api/widget/session", { session_id: sid, turnstile_token: "ok" }, ip)).json()) as { challenge_pass: string };
  return { sid, headers: { "x-challenge-pass": challenge_pass } };
}
async function chatWith(replies: Content[], sid: string, message: string, ip: string, headers: Record<string, string>, extra: Record<string, unknown> = {}) {
  provider.queue.push(...replies);
  const res = await post("/api/chat", { message, session_id: sid, ...extra }, ip, headers);
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}
async function setTenantLimit(tenantId: string, column: "monthly_conversation_limit" | "monthly_message_limit", value: number) {
  await withOwner(async (c) => {
    await c.query("BEGIN");
    await c.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    await c.query(`UPDATE tenant_limits SET ${column} = $1`, [value]);
    await c.query("COMMIT");
  });
}

before(async () => {
  db = await import("../src/db.js");
  ({ config } = await import("../src/config.js"));
  const { createApp } = await import("../src/app.js");
  A = await withOwner((c) => createTenant(c, "PublicChat", 100_000));
  server = createApp(async () => null, fake, provider).listen(0);
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
after(async () => { server.close(); await deleteTenants([A.id]); await db.pool.end(); });

describe("widget config", () => {
  it("includes suggested questions and the Turnstile site key", async () => {
    const body = (await (await get("/api/widget/config", randomIp())).json()) as { suggested_questions: string[]; turnstile_site_key: string | null };
    assert.ok(Array.isArray(body.suggested_questions));
    assert.ok("turnstile_site_key" in body);
  });
});

describe("bot challenge", () => {
  const ip = randomIp();
  it("rejects the first message of a new conversation without a challenge pass", async () => {
    const res = await post("/api/chat", { message: "hi", session_id: session() }, ip);
    assert.equal(res.status, 403);
    assert.deepEqual(await res.json(), { error: "challenge_required" });
  });
  it("POST /session refuses a failed Turnstile check and issues no pass", async () => {
    fake.next = false;
    try {
      const res = await post("/api/widget/session", { session_id: session(), turnstile_token: "bad" }, ip);
      assert.equal(res.status, 403);
    } finally { fake.next = true; }
  });
  it("a pass from /session lets the first message through; later messages in the same conversation need no pass", async () => {
    const { sid, headers } = await newSession(ip);
    const first = await chatWith([say("Hello there.")], sid, "hi", ip, headers);
    assert.equal(first.status, 200);
    const second = await chatWith([say("Still here.")], sid, "again", ip, {});
    assert.equal(second.status, 200, "no challenge pass needed once a conversation is already open");
  });
  it("a pass issued for one session cannot start a conversation under a different session id", async () => {
    const { headers } = await newSession(ip);
    const res = await post("/api/chat", { message: "hi", session_id: session() }, ip, headers);
    assert.equal(res.status, 403);
  });
});

describe("monthly and per-conversation limits", () => {
  const ip = randomIp();
  it("blocks a new conversation once the tenant's monthly conversation limit is reached, without creating one", async () => {
    await setTenantLimit(A.id, "monthly_conversation_limit", 0);
    try {
      const { sid, headers } = await newSession(ip);
      const before = await db.withTenant(A.id, async (tx) => (await tx.query("SELECT count(*)::int AS n FROM conversations")).rows[0].n as number);
      const r = await chatWith([], sid, "hi", ip, headers);
      assert.equal(r.status, 200);
      assert.equal(r.body.status, "limit_reached");
      assert.equal(r.body.conversation_id, null);
      const after = await db.withTenant(A.id, async (tx) => (await tx.query("SELECT count(*)::int AS n FROM conversations")).rows[0].n as number);
      assert.equal(after, before, "no conversation row was created for the blocked attempt");
    } finally { await setTenantLimit(A.id, "monthly_conversation_limit", 500); }
  });

  it("blocks once the monthly message limit is reached, but still stores the message that tipped it over", async () => {
    await setTenantLimit(A.id, "monthly_message_limit", 0);
    try {
      const { sid, headers } = await newSession(ip);
      const r = await chatWith([say("should not be used")], sid, "over the cap", ip, headers);
      assert.equal(r.body.status, "limit_reached");
      assert.ok(typeof r.body.reply === "string" && (r.body.reply as string).length > 0);
      const stored = await db.withTenant(A.id, async (tx) => (await tx.query("SELECT count(*)::int AS n FROM messages WHERE content = 'over the cap'")).rows[0].n as number);
      assert.equal(stored, 1);
    } finally { await setTenantLimit(A.id, "monthly_message_limit", 5000); }
  });

  it("blocks once the per-conversation token cap is reached, without calling the model again", async () => {
    const original = config.MAX_CONVERSATION_TOKENS;
    config.MAX_CONVERSATION_TOKENS = 1; // any prior reply already exceeds this
    try {
      const { sid, headers } = await newSession(ip);
      const first = await chatWith([say("first reply")], sid, "one", ip, headers);
      assert.equal(first.body.status, "ok");
      const second = await chatWith([say("should never be reached")], sid, "two", ip, {});
      assert.equal(second.body.status, "limit_reached");
    } finally { config.MAX_CONVERSATION_TOKENS = original; }
  });
});

describe("explicit handoff and feedback", () => {
  const ip = randomIp();
  it("POST /handoff hands off regardless of what the model would have decided, and is idempotent", async () => {
    const sid = session();
    const r1 = await post("/api/chat/handoff", { session_id: sid, reason: "wants a person, call 0300-1234567" }, ip);
    assert.equal(r1.status, 200);
    const body1 = (await r1.json()) as { conversation_id: string };
    const status = await db.withTenant(A.id, async (tx) => (await tx.query("SELECT status FROM conversations WHERE id = $1", [body1.conversation_id])).rows[0].status);
    assert.equal(status, "needs_human");
    const reason = await db.withTenant(A.id, async (tx) => (await tx.query("SELECT payload FROM event_outbox WHERE event_type = 'handoff_requested' ORDER BY created_at DESC LIMIT 1")).rows[0].payload);
    assert.ok(!JSON.stringify(reason).includes("1234567"), "handoff reason is PII-masked");
    const r2 = await post("/api/chat/handoff", { session_id: sid }, ip);
    assert.equal(((await r2.json()) as { conversation_id: string }).conversation_id, body1.conversation_id);
  });

  it("POST /feedback records a rating tenant-scoped to the caller, and 404s for an unknown message id", async () => {
    const { sid, headers } = await newSession(ip);
    const r = await chatWith([say("an answer")], sid, "question", ip, headers);
    const messageId = r.body.message_id as string;
    assert.ok(messageId);
    assert.equal((await post("/api/chat/feedback", { message_id: messageId, rating: 1 }, ip)).status, 204);
    const rating = await db.withTenant(A.id, async (tx) => (await tx.query("SELECT rating FROM message_feedback WHERE message_id = $1", [messageId])).rows[0].rating);
    assert.equal(rating, 1);
    assert.equal((await post("/api/chat/feedback", { message_id: messageId, rating: -1 }, ip)).status, 204, "re-rating updates in place");
    assert.equal((await post("/api/chat/feedback", { message_id: randomUUID(), rating: 1 }, ip)).status, 404);
  });
});

describe("forced language", () => {
  const ip = randomIp();
  it("a language chip overrides auto-detect for that reply", async () => {
    const { sid, headers } = await newSession(ip);
    const r = await chatWith([say("Some reply text.")], sid, "BSCS", ip, headers, { language: "urdu" });
    assert.equal(r.body.language, "urdu");
  });
});
