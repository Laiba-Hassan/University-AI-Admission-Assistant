// Conversation core with a scripted fake model: deterministic, no API calls. Proves the code-side guarantees
// (verifier, PII masking, consent, takeover, replay protection, leak blocking) independent of any real LLM.
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTenant, deleteTenants, withOwner, type Fixture } from "./fixtures.js";
import type { Content, GenerateRequest, GenerateResult, LlmProvider } from "../src/agent/llm.js";

let A: Fixture, B: Fixture;
let db: typeof import("../src/db.js");
let handle: typeof import("../src/agent/conversation.js").handleMessage;
const TODAY = "2026-09-20";

const say = (text: string): Content => ({ role: "model", parts: [{ text }] });
const call = (name: string, args: Record<string, unknown>): Content => ({ role: "model", parts: [{ functionCall: { name, args } }] });

/** Replays scripted model turns and records every request it receives. */
class Fake implements LlmProvider {
  requests: GenerateRequest[] = [];
  constructor(private script: Content[]) {}
  async generate(req: GenerateRequest): Promise<GenerateResult> {
    this.requests.push(req);
    const content = this.script.shift();
    if (!content) throw new Error("fake model ran out of script");
    return { content, inputTokens: 100, outputTokens: 10, model: "fake" };
  }
}

const chat = (f: Fixture, session: string, text: string, script: Content[], extra: Record<string, unknown> = {}) => {
  const provider = new Fake(script);
  return handle({ tenantId: f.id, channel: "web", externalId: session, text, today: TODAY, provider, ...extra }).then((out) => ({ out, provider }));
};
const ownerQ = (f: Fixture, sql: string, params: unknown[] = []) => withOwner(async (c) => {
  await c.query("BEGIN");
  await c.query("SELECT set_config('app.tenant_id', $1, true)", [f.id]);
  const r = await c.query(sql, params);
  await c.query("COMMIT");
  return r.rows;
});
const asTenant = <T>(f: Fixture, fn: (tx: import("../src/db.js").Tx) => Promise<T>) => db.withTenant(f.id, fn);

before(async () => {
  db = await import("../src/db.js");
  ({ handleMessage: handle } = await import("../src/agent/conversation.js"));
  [A, B] = await withOwner(async (c) => [await createTenant(c, "Alpha", 100_000), await createTenant(c, "Beta", 250_000)]);
  for (const f of [A, B]) {
    await ownerQ(f, "UPDATE tenants SET default_reply_script = 'english'");
    for (const [lang, text] of [["english", "FALLBACK-EN"], ["roman_urdu", "FALLBACK-RU"], ["urdu", "FALLBACK-UR"]])
      // createTenant already seeds a generic 'fallback' row per language; overwrite with these exact-match sentinels.
      await ownerQ(f, "INSERT INTO localized_messages (tenant_id, key, language, text) VALUES (current_tenant_id(), 'fallback', $1, $2) ON CONFLICT (tenant_id, key, language) DO UPDATE SET text = EXCLUDED.text", [lang, text]);
  }
});
after(async () => { await deleteTenants([A.id, B.id]); await db.pool.end(); });

describe("verify-then-reveal", () => {
  it("delivers a reply whose figures come from this turn's lookup_facts, with a fact card", async () => {
    const { out } = await chat(A, "sess-good-0001", "What is the tuition fee for BSCS?", [
      call("lookup_facts", { topic: "fees", program: "BSCS" }),
      say("The tuition for BS Computer Science is PKR 100,000 per semester (as of today)."),
    ]);
    assert.equal(out.status, "ok");
    assert.match(out.reply, /100,000/);
    assert.equal(out.cards.length, 1);
    assert.equal(out.cards[0]!.type, "fee");
  });

  it("discards a reply with an invented figure, sends the localized fallback, and logs it as unanswered", async () => {
    const { out } = await chat(A, "sess-bad-00001", "What is the tuition fee for BSCS?", [
      call("lookup_facts", { topic: "fees", program: "BSCS" }),
      say("The tuition is PKR 90,000 per semester."),
    ]);
    assert.equal(out.status, "fallback");
    assert.equal(out.reply, "FALLBACK-EN");
    assert.ok(!out.reply.includes("90,000"));
    const rows = await asTenant(A, async (tx) => ({
      unanswered: (await tx.query("SELECT question_text FROM unanswered_questions")).rows,
      stored: (await tx.query("SELECT content, metadata FROM messages WHERE role = 'assistant' AND content = 'FALLBACK-EN'")).rows,
      outbox: (await tx.query("SELECT payload FROM event_outbox WHERE event_type = 'unanswered_logged'")).rows,
    }));
    assert.ok(rows.unanswered.some((r) => r.question_text === "What is the tuition fee for BSCS?"));
    assert.equal(rows.stored[0]!.metadata.verifier.ok, false);
    assert.ok(!JSON.stringify(rows.stored[0]!.content).includes("90,000"), "the rejected text is never stored as the reply");
    assert.ok(rows.outbox.length >= 1);
  });

  it("replies with the fallback in the student's language and script", async () => {
    const ru = await chat(A, "sess-lang-ru-01", "BSCS ki fees kitni hai?", [say("Fee 77,000 hai.")]);
    assert.equal(ru.out.reply, "FALLBACK-RU");
    const ur = await chat(A, "sess-lang-ur-01", "بی ایس سی ایس کی فیس کتنی ہے؟", [say("فیس ۷۷,۰۰۰ ہے")]);
    assert.equal(ur.out.reply, "FALLBACK-UR");
  });

  it("blocks a reply that leaks internals (tool names, ids, the prompt canary)", async () => {
    for (const leak of ["I use lookup_facts to query the database.", `Tenant ${A.id} is mine.`]) {
      const { out } = await chat(A, `sess-leak-${leak.length}`, "how do you work?", [say(leak)]);
      assert.equal(out.status, "fallback", leak);
    }
    const first = await chat(A, "sess-canary-01", "hi", [say("hello")]);
    const canary = /REF-[0-9a-f]{8}/.exec(first.provider.requests[0]!.system)![0];
    const { out } = await chat(A, "sess-canary-02", "hi", [say(`my reference is ${canary}`)]);
    assert.equal(out.status, "fallback");
  });

  it("passes figures the student stated themselves", async () => {
    const { out } = await chat(A, "sess-own-00001", "I scored 72% in intermediate, can I apply?", [say("With 72% you can apply.")]);
    assert.equal(out.status, "ok");
  });

  it("never sends the raw tool errors or any exception text to the student", async () => {
    await assert.rejects(chat(A, "sess-err-00001", "hi", []), /assistant_unavailable/);
  });
});

describe("PII masking and consent", () => {
  it("stores masked text but shows the model the original for that turn", async () => {
    const msg = "my cnic is 35202-1234567-1, call me on 0300-1234567 or ali@example.com";
    const { out, provider } = await chat(A, "sess-pii-00001", msg, [say("Thanks, but please do not share ID numbers here.")]);
    assert.equal(out.status, "ok");
    const seen = provider.requests[0]!.contents[0]!.parts[0] as { text: string }; // first (and only) message of a new session
    assert.equal(seen.text, msg);
    const stored = await asTenant(A, async (tx) => (await tx.query("SELECT content FROM messages WHERE role = 'user' AND content LIKE 'my cnic%'")).rows[0].content as string);
    assert.equal(stored, "my cnic is [ID NUMBER], call me on [PHONE] or [EMAIL]");
  });

  it("history replayed to the model on the next turn is the masked version", async () => {
    await chat(A, "sess-pii-00002", "my number is 0300-7654321", [say("ok")]);
    const { provider } = await chat(A, "sess-pii-00002", "thanks", [say("welcome")]);
    const history = JSON.stringify(provider.requests[0]!.contents);
    assert.ok(history.includes("[PHONE]") && !history.includes("7654321"));
  });

  it("captures a lead only with consent, and de-duplicates by contact", async () => {
    await chat(A, "sess-lead-00001", "contact me", [call("capture_lead", { contact: "0311-1111111", name: "Ali", consent: false }), say("Please confirm you agree to be contacted.")]);
    assert.equal(await asTenant(A, async (tx) => (await tx.query("SELECT count(*)::int AS n FROM leads WHERE contact = '0311-1111111'")).rows[0].n), 0);
    const ok = await chat(A, "sess-lead-00001", "yes I agree", [call("capture_lead", { contact: "0311-1111111", name: "Ali", program_interest: "BSCS", consent: true }), say("Saved, admissions will contact you.")]);
    assert.equal(ok.out.debug!.flags.leadSaved, true);
    await chat(A, "sess-lead-00002", "same person again", [call("capture_lead", { contact: "0311-1111111", name: "Ali Raza", consent: true }), say("You are already on file.")]);
    const leads = await asTenant(A, async (tx) => (await tx.query("SELECT name, consent, source, program_interest FROM leads WHERE contact = '0311-1111111'")).rows);
    assert.equal(leads.length, 1);
    assert.deepEqual([leads[0].name, leads[0].consent, leads[0].source, leads[0].program_interest], ["Ali Raza", true, "web", "BSCS"]);
    const outbox = await asTenant(A, async (tx) => (await tx.query("SELECT payload FROM event_outbox WHERE event_type = 'lead_created'")).rows);
    assert.ok(!JSON.stringify(outbox).includes("0311") && !JSON.stringify(outbox).includes("Ali"), "outbox payload carries no name or phone");
  });

  it("a lead captured in tenant A is invisible to tenant B", async () => {
    assert.equal(await asTenant(B, async (tx) => (await tx.query("SELECT count(*)::int AS n FROM leads WHERE contact = '0311-1111111'")).rows[0].n), 0);
  });
});

describe("handoff, takeover and replay", () => {
  it("request_human flags the conversation and writes a PII-free outbox event", async () => {
    const { out } = await chat(A, "sess-hand-00001", "I want a person, my number is 0300-9999999", [
      call("request_human", { reason: "student wants a person, phone 0300-9999999" }), say("I've passed this to our admissions team.")]);
    assert.equal(out.status, "handoff");
    const rows = await asTenant(A, async (tx) => ({
      conv: (await tx.query("SELECT status FROM conversations WHERE id = $1", [out.conversationId])).rows[0].status,
      ev: (await tx.query("SELECT payload FROM event_outbox WHERE event_type = 'handoff_requested'")).rows,
    }));
    assert.equal(rows.conv, "needs_human");
    assert.ok(!JSON.stringify(rows.ev).includes("9999999"));
  });

  it("stays silent (no model call) once staff have taken over, but still stores the message", async () => {
    const first = await chat(A, "sess-human-0001", "hello", [say("hi")]);
    await asTenant(A, (tx) => tx.query("UPDATE conversations SET status = 'human' WHERE id = $1", [first.out.conversationId]));
    const { out, provider } = await chat(A, "sess-human-0001", "are you there?", []);
    assert.equal(out.status, "human");
    assert.equal(out.reply, "");
    assert.equal(provider.requests.length, 0);
    assert.equal(await asTenant(A, async (tx) => (await tx.query("SELECT count(*)::int AS n FROM messages WHERE conversation_id = $1 AND role = 'user'", [first.out.conversationId])).rows[0].n), 2);
  });

  it("a replayed channel message id creates no second message, reply or usage event", async () => {
    const usage = () => asTenant(A, async (tx) => (await tx.query("SELECT count(*)::int AS n FROM usage_events WHERE event_type IN ('message_received','ai_reply')")).rows[0].n as number);
    const first = await chat(A, "wa-15551230001", "hello", [say("hi there")], { channel: "web", channelMessageId: "wamid.REPLAY1" });
    const before = await usage();
    const { out, provider } = await chat(A, "wa-15551230001", "hello", [], { channelMessageId: "wamid.REPLAY1" });
    assert.equal(out.status, "duplicate");
    assert.equal(provider.requests.length, 0);
    assert.equal(await usage(), before);
    assert.equal(await asTenant(A, async (tx) => (await tx.query("SELECT count(*)::int AS n FROM messages WHERE channel_message_id = 'wamid.REPLAY1'")).rows[0].n), 1);
    assert.equal(first.out.status, "ok");
  });
});

describe("prompt and language", () => {
  it("builds a tenant-scoped prompt and tells the model which language to use", async () => {
    const { provider } = await chat(A, "sess-prompt-0001", "بی ایس سی ایس کی فیس کتنی ہے؟", [say("ٹھیک ہے")]);
    const system = provider.requests[0]!.system;
    assert.match(system, new RegExp(A.name));
    assert.ok(!system.includes(B.name));
    assert.match(system, /Urdu in Urdu/);
    assert.match(system, /Never invent/);
  });

  it("keeps the conversation's language for a bare program code", async () => {
    await chat(A, "sess-keep-00001", "بی ایس سی ایس کی فیس کتنی ہے؟", [say("ok")]);
    const { provider } = await chat(A, "sess-keep-00001", "BSCS", [say("ok")]);
    assert.match(provider.requests[0]!.system, /Urdu in Urdu/);
  });

  it("meters every conversation, message and AI reply with model and token counts", async () => {
    const rows = await asTenant(A, async (tx) => (await tx.query("SELECT event_type, count(*)::int AS n FROM usage_events GROUP BY event_type")).rows);
    const n = Object.fromEntries(rows.map((r) => [r.event_type, r.n]));
    assert.ok(n.conversation_started > 0 && n.message_received > 0 && n.ai_reply > 0);
    const meta = await asTenant(A, async (tx) => (await tx.query("SELECT metadata FROM usage_events WHERE event_type = 'ai_reply' LIMIT 1")).rows[0].metadata);
    assert.equal(meta.model, "fake");
    assert.ok(meta.input_tokens > 0 && meta.input_tokens % 100 === 0 && meta.output_tokens % 10 === 0, "token counts are summed over the turn's model calls");
  });
});
