// The web widget's mic button (PRD 6B), POST /api/chat/voice: real audio (converted/probed by the real ffmpeg
// pipeline), a fake Gemini-shaped STT result, then the exact same challenge/limit/agent path text chat uses.
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { promisify } from "node:util";
import ffmpegPath from "ffmpeg-static";
import { createTenant, deleteTenants, withOwner, type Fixture } from "./fixtures.js";
import type { ChallengeVerifier } from "../src/challenge.js";
import type { Content, GenerateResult, LlmProvider } from "../src/agent/llm.js";
import type { SttProvider, TranscriptionOutcome } from "../src/voice/transcribe.js";

const run = promisify(execFile);
let A: Fixture, server: Server, base: string;
let db: typeof import("../src/db.js");

const say = (text: string): Content => ({ role: "model", parts: [{ text }] });
const call = (name: string, args: Record<string, unknown>): Content => ({ role: "model", parts: [{ functionCall: { name, args } }] });

/** Scripted turns pulled from a shared, mutable queue -- same pattern public-chat.test.ts uses so the whole file
 * can run against one long-lived server instead of standing up a new app per test. */
class QueueProvider implements LlmProvider {
  queue: Content[] = [];
  async generate(): Promise<GenerateResult> { return { content: this.queue.shift() ?? say("ok"), inputTokens: 100, outputTokens: 10, model: "fake" }; }
}
class QueueStt implements SttProvider {
  queue: TranscriptionOutcome[] = [];
  async transcribe(): Promise<TranscriptionOutcome> { return this.queue.shift() ?? { ok: false, reason: "provider_error" }; }
}
class FakeChallenge implements ChallengeVerifier { next = true; async verify() { return this.next; } }

const provider = new QueueProvider();
const stt = new QueueStt();
const fake = new FakeChallenge();

async function toneBuffer(seconds: number): Promise<Buffer> {
  const { stdout } = await run(ffmpegPath!, ["-y", "-f", "lavfi", "-i", `sine=frequency=440:duration=${seconds}`, "-c:a", "libopus", "-f", "webm", "pipe:1"],
    { encoding: "buffer", maxBuffer: 20 * 1024 * 1024 });
  return stdout as unknown as Buffer;
}
const session = () => randomUUID().replace(/-/g, "");
const randomIp = () => `10.${randomUUID().split("-").map((h) => parseInt(h, 16) % 256).slice(0, 3).join(".")}`;

async function newSession(ip: string): Promise<{ sid: string; headers: Record<string, string> }> {
  const sid = session();
  const res = await fetch(`${base}/api/widget/session`, {
    method: "POST", headers: { "content-type": "application/json", "x-widget-key": A.widgetKey, origin: A.origin, "x-forwarded-for": ip },
    body: JSON.stringify({ session_id: sid, turnstile_token: "ok" }),
  });
  const { challenge_pass } = (await res.json()) as { challenge_pass: string };
  return { sid, headers: { "x-challenge-pass": challenge_pass } };
}
async function postVoice(sid: string, audio: Buffer, ip: string, headers: Record<string, string> = {}, mime = "audio/webm") {
  const res = await fetch(`${base}/api/chat/voice?session_id=${sid}`, {
    method: "POST",
    headers: { "content-type": mime, "x-widget-key": A.widgetKey, origin: A.origin, "x-forwarded-for": ip, ...headers },
    body: audio as unknown as BodyInit,
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

before(async () => {
  db = await import("../src/db.js");
  const { createApp } = await import("../src/app.js");
  A = await withOwner((c) => createTenant(c, "VoiceChat", 145_000));
  server = createApp(async () => null, fake, provider, stt).listen(0);
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
after(async () => { server.close(); await deleteTenants([A.id]); await db.pool.end(); });

describe("POST /api/chat/voice", () => {
  it("transcribes real audio and answers from this tenant's data, with the transcript in the response", async () => {
    const ip = randomIp();
    const { sid, headers } = await newSession(ip);
    const audio = await toneBuffer(2);
    stt.queue.push({ ok: true, text: "What is the BSCS fee?", language: "english" });
    provider.queue.push(call("lookup_facts", { topic: "fees", program: "BSCS" }), say(`The tuition is PKR ${A.feeAmount.toLocaleString()} per semester.`));
    const { status, body } = await postVoice(sid, audio, ip, headers);
    assert.equal(status, 200);
    assert.equal(body.transcript, "What is the BSCS fee?");
    assert.match(body.reply as string, new RegExp(A.feeAmount.toLocaleString()));
  });

  it("stores the message as content_type='voice' with the transcript, never the audio bytes", async () => {
    const ip = randomIp();
    const { sid, headers } = await newSession(ip);
    const audio = await toneBuffer(2);
    stt.queue.push({ ok: true, text: "hostel fee?", language: "roman_urdu" });
    provider.queue.push(say("Not on file yet, sorry."));
    await postVoice(sid, audio, ip, headers);
    const rows = await db.withTenant(A.id, async (tx) =>
      (await tx.query(`SELECT content, content_type FROM messages m JOIN conversations c ON c.id = m.conversation_id JOIN contacts ct ON ct.id = c.contact_id WHERE ct.external_id = $1 AND m.role = 'user'`, [sid])).rows);
    assert.equal(rows[0]!.content, "hostel fee?");
    assert.equal(rows[0]!.content_type, "voice");
  });

  it("rejects an unsupported content type before touching the pipeline", async () => {
    const ip = randomIp();
    const { sid, headers } = await newSession(ip);
    const { status, body } = await postVoice(sid, Buffer.from("not audio"), ip, headers, "text/plain");
    assert.equal(status, 400);
    assert.equal(body.error, "unsupported_audio_format");
  });

  it("a silent/unintelligible clip returns 422 with a distinct error the widget can show 'please resend or type' for", async () => {
    const ip = randomIp();
    const { sid, headers } = await newSession(ip);
    const audio = await toneBuffer(2);
    stt.queue.push({ ok: false, reason: "silent" });
    const { status, body } = await postVoice(sid, audio, ip, headers);
    assert.equal(status, 422);
    assert.equal(body.error, "voice_silent");
  });

  it("requires the bot challenge for a brand-new conversation, same as text chat (no x-challenge-pass sent here)", async () => {
    const ip = randomIp();
    const audio = await toneBuffer(2);
    const { status } = await postVoice(session(), audio, ip); // no headers: never called /session for this one
    assert.equal(status, 403);
  });
});
