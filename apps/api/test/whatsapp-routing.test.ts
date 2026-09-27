// The Mandatory WhatsApp Routing & Integrity Test (PRD Section "Mandatory WhatsApp Routing & Integrity Test
// (Phase 6A and 6B)") plus the WhatsApp half of the Mandatory Multi-Tenant Acceptance Test: a message to Tenant
// A's number is answered from A's data and stored only under A (and the same for B, asking in three languages),
// a replayed webhook does not duplicate anything, and delivery-status callbacks land on the right message.
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createTenant, deleteTenants, withOwner, type Fixture } from "./fixtures.js";
import type { Content, GenerateRequest, GenerateResult, LlmProvider } from "../src/agent/llm.js";
import type { SendResult, WhatsAppSender } from "../src/whatsapp/send.js";

let A: Fixture, B: Fixture;
let db: typeof import("../src/db.js");
let processChange: typeof import("../src/whatsapp/process.js").processWhatsAppChange;
let saveConnection: typeof import("../src/whatsapp/connection.js").saveWhatsAppConnection;

const say = (text: string): Content => ({ role: "model", parts: [{ text }] });
const call = (name: string, args: Record<string, unknown>): Content => ({ role: "model", parts: [{ functionCall: { name, args } }] });

/** Replays scripted model turns, same pattern as conversation.test.ts. */
class ScriptedProvider implements LlmProvider {
  constructor(private script: Content[]) {}
  async generate(_req: GenerateRequest): Promise<GenerateResult> {
    const content = this.script.shift();
    if (!content) throw new Error("fake model ran out of script");
    return { content, inputTokens: 100, outputTokens: 10, model: "fake" };
  }
}

/** Records every outbound WhatsApp send instead of calling the real Graph API. Message ids are globally unique
 * (randomUUID), not per-instance counters, since several tests reuse the same long-lived tenant fixtures and a
 * repeated id would collide with the real UNIQUE(tenant_id, channel_message_id) constraint. */
class FakeSender implements WhatsAppSender {
  sent: { phoneNumberId: string; to: string; text: string; messageId: string }[] = [];
  templatesSent: { to: string; templateName: string }[] = [];
  async sendText(args: { phoneNumberId: string; accessToken: string; to: string; text: string }): Promise<SendResult> {
    const messageId = `wamid.reply.${randomUUID()}`;
    this.sent.push({ phoneNumberId: args.phoneNumberId, to: args.to, text: args.text, messageId });
    return { ok: true, messageId };
  }
  async sendTemplate(args: { to: string; templateName: string }): Promise<SendResult> {
    const messageId = `wamid.template.${randomUUID()}`;
    this.templatesSent.push({ to: args.to, templateName: args.templateName });
    return { ok: true, messageId };
  }
}

const feeAsk = (program: string, amount: number, currency = "PKR") => [
  call("lookup_facts", { topic: "fees", program }),
  say(`The tuition for ${program} is ${currency} ${amount.toLocaleString()} per semester (as of today).`),
];

async function connectWhatsApp(f: Fixture) {
  await db.withTenant(f.id, (tx) => saveConnection(tx, { phoneNumberId: f.phoneNumberId, accessToken: `token-for-${f.id}`, templateName: "admissions_followup" }));
}
const ownerQ = (f: Fixture, sql: string, params: unknown[] = []) => withOwner(async (c) => {
  await c.query("BEGIN"); await c.query("SELECT set_config('app.tenant_id', $1, true)", [f.id]);
  const r = await c.query(sql, params); await c.query("COMMIT"); return r.rows;
});

before(async () => {
  db = await import("../src/db.js");
  ({ processWhatsAppChange: processChange } = await import("../src/whatsapp/process.js"));
  ({ saveWhatsAppConnection: saveConnection } = await import("../src/whatsapp/connection.js"));
  [A, B] = await withOwner(async (c) => [await createTenant(c, "WaAlpha", 145_000), await createTenant(c, "WaBeta", 210_000)]);
  await connectWhatsApp(A);
  await connectWhatsApp(B);
});
after(async () => { await deleteTenants([A.id, B.id]); await db.pool.end(); });

describe("WhatsApp routing & integrity", () => {
  it("answers a text message from the receiving tenant's own data and sends the reply back to that number", async () => {
    const sender = new FakeSender();
    const provider = new ScriptedProvider(feeAsk("BSCS", A.feeAmount));
    await processChange(A.id, { messages: [{ id: "wamid.A.1", from: "923001234567", type: "text", text: { body: "What is the BSCS fee?" } }] }, { sender, provider });

    assert.equal(sender.sent.length, 1);
    assert.equal(sender.sent[0]!.phoneNumberId, A.phoneNumberId);
    assert.equal(sender.sent[0]!.to, "923001234567");
    assert.match(sender.sent[0]!.text, new RegExp(A.feeAmount.toLocaleString()));

    const rows = await ownerQ(A, "SELECT content FROM messages WHERE channel_message_id = 'wamid.A.1'");
    assert.equal(rows.length, 1); // stored only under A
    const bRows = await withOwner(async (c) => {
      await c.query("BEGIN"); await c.query("SELECT set_config('app.tenant_id', $1, true)", [B.id]);
      const r = await c.query("SELECT content FROM messages WHERE channel_message_id = 'wamid.A.1'");
      await c.query("COMMIT"); return r.rows;
    });
    assert.equal(bRows.length, 0); // never visible under B
  });

  it("Tenant A and Tenant B give their own fee for the same question -- the core multi-tenant proof, over WhatsApp", async () => {
    const senderA = new FakeSender(), senderB = new FakeSender();
    await processChange(A.id, { messages: [{ id: "wamid.mt.a", from: "923000000001", type: "text", text: { body: "What is the BSCS fee?" } }] }, { sender: senderA, provider: new ScriptedProvider(feeAsk("BSCS", A.feeAmount)) });
    await processChange(B.id, { messages: [{ id: "wamid.mt.b", from: "923000000002", type: "text", text: { body: "What is the BSCS fee?" } }] }, { sender: senderB, provider: new ScriptedProvider(feeAsk("BSCS", B.feeAmount)) });

    assert.match(senderA.sent[0]!.text, new RegExp(A.feeAmount.toLocaleString()));
    assert.match(senderB.sent[0]!.text, new RegExp(B.feeAmount.toLocaleString()));
    assert.doesNotMatch(senderA.sent[0]!.text, new RegExp(B.feeAmount.toLocaleString()));
  });

  it("a replayed webhook (same WhatsApp message id) does not send a second reply or duplicate the stored message", async () => {
    const sender = new FakeSender();
    const from = "923001112222";
    const value = { messages: [{ id: "wamid.replay.1", from, type: "text", text: { body: "What is the BSCS fee?" } }] };
    await processChange(A.id, value, { sender, provider: new ScriptedProvider(feeAsk("BSCS", A.feeAmount)) });
    assert.equal(sender.sent.length, 1);

    // Second delivery of the exact same webhook: handleMessage's ON CONFLICT DO NOTHING means no new user message
    // is stored, out.reply comes back empty, and nothing new is sent -- the script provider is never even called.
    await processChange(A.id, value, { sender, provider: new ScriptedProvider([]) });
    assert.equal(sender.sent.length, 1);

    const rows = await ownerQ(A, "SELECT count(*)::int AS n FROM messages WHERE channel_message_id = 'wamid.replay.1'");
    assert.equal(rows[0]!.n, 1);
  });

  it("'STOP' opts the contact out and ends replies, including to the STOP message itself", async () => {
    const sender = new FakeSender();
    const from = "923003334444";
    await processChange(A.id, { messages: [{ id: "wamid.stop.1", from, type: "text", text: { body: "STOP" } }] }, { sender, provider: new ScriptedProvider([]) });
    assert.equal(sender.sent.length, 0);

    const rows = await ownerQ(A, "SELECT opted_out FROM contacts WHERE channel = 'whatsapp' AND external_id = $1", [from]);
    assert.equal(rows[0]!.opted_out, true);

    // A normal question afterwards also gets no reply -- handleMessage blocks on opted_out before the model runs.
    await processChange(A.id, { messages: [{ id: "wamid.stop.2", from, type: "text", text: { body: "What is the BSCS fee?" } }] }, { sender, provider: new ScriptedProvider([]) });
    assert.equal(sender.sent.length, 0);
  });

  it("an image or document gets a polite fallback instead of being passed to the model", async () => {
    const sender = new FakeSender();
    await processChange(A.id, { messages: [{ id: "wamid.img.1", from: "923005556666", type: "image" }] }, { sender, provider: new ScriptedProvider([]) });
    assert.equal(sender.sent.length, 1);
    assert.match(sender.sent[0]!.text, /text/i);
  });

  it("a delivery-status callback updates the matching message by WhatsApp message id", async () => {
    const sender = new FakeSender();
    await processChange(A.id, { messages: [{ id: "wamid.status.1", from: "923007778888", type: "text", text: { body: "What is the BSCS fee?" } }] }, { sender, provider: new ScriptedProvider(feeAsk("BSCS", A.feeAmount)) });
    const replyId = sender.sent[0]?.messageId;
    assert.ok(replyId);

    await processChange(A.id, { statuses: [{ id: replyId!, status: "delivered" }] }, { sender, provider: new ScriptedProvider([]) });
    const rows = await ownerQ(A, "SELECT delivery_status FROM messages WHERE channel_message_id = $1", [replyId]);
    assert.equal(rows[0]!.delivery_status, "delivered");
  });

  it("with no active WhatsApp connection, the message is still answered and stored but nothing is sent", async () => {
    const [C] = await withOwner(async (c) => [await createTenant(c, "WaGamma", 90_000)]);
    try {
      const sender = new FakeSender();
      await processChange(C.id, { messages: [{ id: "wamid.noconn.1", from: "923009990000", type: "text", text: { body: "What is the BSCS fee?" } }] }, { sender, provider: new ScriptedProvider(feeAsk("BSCS", C.feeAmount)) });
      assert.equal(sender.sent.length, 0);
      const rows = await ownerQ(C, "SELECT content FROM messages WHERE channel_message_id = 'wamid.noconn.1'");
      assert.equal(rows.length, 1);
    } finally {
      await deleteTenants([C.id]);
    }
  });
});

describe("WhatsApp voice notes (Phase 6B)", () => {
  const fakeMedia = (buffer = Buffer.from("fake-ogg-bytes"), mimeType = "audio/ogg") =>
    async (_mediaId: string, _accessToken: string) => ({ buffer, mimeType });

  it("downloads the media, transcribes it, answers from that tenant's data, and stores it as content_type='voice'", async () => {
    const sender = new FakeSender();
    const stt: import("../src/voice/transcribe.js").SttProvider = { transcribe: async () => ({ ok: true, text: "What is the BSCS fee?", language: "english" }) };
    await processChange(A.id, { messages: [{ id: "wamid.voice.1", from: "923001110000", type: "audio", audio: { id: "media123", mime_type: "audio/ogg" } }] },
      { sender, provider: new ScriptedProvider(feeAsk("BSCS", A.feeAmount)), stt, downloadMedia: fakeMedia() });

    assert.equal(sender.sent.length, 1);
    assert.match(sender.sent[0]!.text, new RegExp(A.feeAmount.toLocaleString()));
    const rows = await ownerQ(A, "SELECT content, content_type FROM messages WHERE channel_message_id = 'wamid.voice.1'");
    assert.equal(rows[0]!.content, "What is the BSCS fee?");
    assert.equal(rows[0]!.content_type, "voice");
  });

  it("Tenant A and Tenant B each get their own fee, asked by voice", async () => {
    const senderA = new FakeSender(), senderB = new FakeSender();
    const sttFor = (text: string): import("../src/voice/transcribe.js").SttProvider => ({ transcribe: async () => ({ ok: true, text, language: "english" }) });
    await processChange(A.id, { messages: [{ id: "wamid.voice.mt.a", from: "923001110001", type: "audio", audio: { id: "m1", mime_type: "audio/ogg" } }] },
      { sender: senderA, provider: new ScriptedProvider(feeAsk("BSCS", A.feeAmount)), stt: sttFor("What is the BSCS fee?"), downloadMedia: fakeMedia() });
    await processChange(B.id, { messages: [{ id: "wamid.voice.mt.b", from: "923001110002", type: "audio", audio: { id: "m2", mime_type: "audio/ogg" } }] },
      { sender: senderB, provider: new ScriptedProvider(feeAsk("BSCS", B.feeAmount)), stt: sttFor("What is the BSCS fee?"), downloadMedia: fakeMedia() });

    assert.match(senderA.sent[0]!.text, new RegExp(A.feeAmount.toLocaleString()));
    assert.match(senderB.sent[0]!.text, new RegExp(B.feeAmount.toLocaleString()));
  });

  it("a silent/unintelligible voice note gets the 'please resend or type' fallback, never reaches the model", async () => {
    const sender = new FakeSender();
    const stt: import("../src/voice/transcribe.js").SttProvider = { transcribe: async () => ({ ok: false, reason: "silent" }) };
    await processChange(A.id, { messages: [{ id: "wamid.voice.silent", from: "923001110003", type: "audio", audio: { id: "m3", mime_type: "audio/ogg" } }] },
      { sender, provider: new ScriptedProvider([]), stt, downloadMedia: fakeMedia() });
    assert.equal(sender.sent.length, 1);
    assert.match(sender.sent[0]!.text, /resend|type/i);
  });

  it("when the media download fails, also falls back gracefully instead of throwing", async () => {
    const sender = new FakeSender();
    await processChange(A.id, { messages: [{ id: "wamid.voice.nodl", from: "923001110004", type: "audio", audio: { id: "m4", mime_type: "audio/ogg" } }] },
      { sender, provider: new ScriptedProvider([]), downloadMedia: async () => null });
    assert.equal(sender.sent.length, 1);
    assert.match(sender.sent[0]!.text, /resend|type/i);
  });

  it("the audio buffer is never persisted -- only the transcript ends up in the database", async () => {
    const sender = new FakeSender();
    const stt: import("../src/voice/transcribe.js").SttProvider = { transcribe: async () => ({ ok: true, text: "hostel fee kitni hai", language: "roman_urdu" }) };
    await processChange(A.id, { messages: [{ id: "wamid.voice.noretain", from: "923001110005", type: "audio", audio: { id: "m5", mime_type: "audio/ogg" } }] },
      { sender, provider: new ScriptedProvider([say("Hostel fee is not on file yet, sorry.")]), stt, downloadMedia: fakeMedia(Buffer.from("this-is-definitely-not-a-transcript")) });
    const rows = await ownerQ(A, "SELECT content FROM messages WHERE channel_message_id = 'wamid.voice.noretain'");
    assert.equal(rows[0]!.content, "hostel fee kitni hai");
    assert.doesNotMatch(rows[0]!.content as string, /this-is-definitely-not-a-transcript/);
  });

  it("a replayed voice-note webhook (same message id) does not re-transcribe, re-download, or reply twice", async () => {
    const sender = new FakeSender();
    let transcribeCalls = 0, downloadCalls = 0;
    const stt: import("../src/voice/transcribe.js").SttProvider = { transcribe: async () => { transcribeCalls++; return { ok: true, text: "What is the BSCS fee?", language: "english" }; } };
    const downloadMedia: typeof import("../src/voice/whatsapp-media.js").downloadWhatsAppMedia = async (...args) => { downloadCalls++; return fakeMedia()(...args); };
    const value = { messages: [{ id: "wamid.voice.replay", from: "923001110006", type: "audio", audio: { id: "m6", mime_type: "audio/ogg" } }] };
    await processChange(A.id, value, { sender, provider: new ScriptedProvider(feeAsk("BSCS", A.feeAmount)), stt, downloadMedia });
    assert.equal(sender.sent.length, 1);
    assert.equal(transcribeCalls, 1);
    assert.equal(downloadCalls, 1);

    // Same message id again: the already-stored-message check short-circuits before the media download even
    // happens, so no wasted download, no wasted STT call, and no second reply.
    await processChange(A.id, value, { sender, provider: new ScriptedProvider([]), stt, downloadMedia });
    assert.equal(sender.sent.length, 1);
    assert.equal(transcribeCalls, 1);
    assert.equal(downloadCalls, 1);
    const rows = await ownerQ(A, "SELECT count(*)::int AS n FROM messages WHERE channel_message_id = 'wamid.voice.replay'");
    assert.equal(rows[0]!.n, 1);
  });
});
