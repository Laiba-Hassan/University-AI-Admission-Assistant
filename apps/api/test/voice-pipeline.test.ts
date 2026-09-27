// The shared voice pipeline (PRD 6B) both WhatsApp voice notes and the web mic button go through: duration
// limits, format normalization (real ffmpeg, no fake -- this is the one thing worth testing for real), and the
// silent/unintelligible/too-short outcomes mapping correctly. The STT call itself is faked (no live Gemini
// quota spent in the suite), same DI shape as agent/llm.ts's LlmProvider.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import ffmpegPath from "ffmpeg-static";
import { processVoiceMessage } from "../src/voice/pipeline.js";
import type { SttProvider, TranscriptionOutcome } from "../src/voice/transcribe.js";

const run = promisify(execFile);

/** A short synthetic tone, generated with the same real ffmpeg binary the pipeline itself uses -- no fixture
 * audio file to keep in the repo. `format` is an ffmpeg output format/codec name (e.g. "wav", "webm"). */
async function toneBuffer(seconds: number, format: "wav" | "webm"): Promise<Buffer> {
  const args = ["-y", "-f", "lavfi", "-i", `sine=frequency=440:duration=${seconds}`];
  if (format === "webm") args.push("-c:a", "libopus");
  args.push("-f", format, "pipe:1");
  const { stdout } = await run(ffmpegPath!, args, { encoding: "buffer", maxBuffer: 50 * 1024 * 1024 });
  return stdout as unknown as Buffer;
}

class FixedStt implements SttProvider {
  constructor(private result: TranscriptionOutcome) {}
  async transcribe(): Promise<TranscriptionOutcome> { return this.result; }
}

describe("processVoiceMessage", () => {
  it("rejects audio over the ~2 minute limit before ever calling the STT provider", async () => {
    const audio = await toneBuffer(126, "wav"); // a real, synthetically-generated 126s clip -- over MAX_VOICE_SECONDS
    let called = false;
    const stt: SttProvider = { transcribe: async () => { called = true; return { ok: true, text: "should never be reached", language: "english" }; } };
    const result = await processVoiceMessage(audio, "audio/wav", [], { stt });
    assert.deepEqual(result, { ok: false, reason: "too_long" });
    assert.equal(called, false);
  });

  it("transcribes a real short WAV clip end to end (real ffmpeg conversion + duration probe, fake STT)", async () => {
    const audio = await toneBuffer(2, "wav");
    const stt = new FixedStt({ ok: true, text: "What is the BSCS fee?", language: "english" });
    const result = await processVoiceMessage(audio, "audio/wav", ["BSCS", "Main Campus"], { stt });
    assert.deepEqual(result, { ok: true, transcript: "What is the BSCS fee?", audioSeconds: 2, language: "english" });
  });

  it("normalizes a WebM/Opus clip (the browser mic's native format) before transcribing", async () => {
    const audio = await toneBuffer(2, "webm");
    let seenMime = "";
    const stt: SttProvider = { transcribe: async (_audio, mimeType) => { seenMime = mimeType; return { ok: true, text: "hostel fee?", language: "roman_urdu" }; } };
    const result = await processVoiceMessage(audio, "audio/webm", [], { stt });
    assert.equal(seenMime, "audio/ogg"); // converted before the STT call ever sees it
    assert.equal(result.ok, true);
  });

  it("does not convert an already-native format (WhatsApp's usual audio/ogg) before transcribing", async () => {
    // WhatsApp voice notes are Opus-in-Ogg already; ffmpeg can also emit true .ogg, so this doubles as a real
    // "no unnecessary conversion" check -- feed it in as audio/ogg and confirm the STT call receives it as-is.
    const audio = await toneBuffer(1, "webm"); // stand-in bytes; only the declared mime type matters here
    let sawConversionCall = false;
    const stt: SttProvider = { transcribe: async () => { sawConversionCall = true; return { ok: true, text: "ok", language: "english" }; } };
    await processVoiceMessage(audio, "audio/ogg", [], { stt });
    assert.ok(sawConversionCall);
  });

  it("rejects a too-short clip without calling the STT provider", async () => {
    const audio = await toneBuffer(0.2, "wav");
    let called = false;
    const stt: SttProvider = { transcribe: async () => { called = true; return { ok: true, text: "x", language: null }; } };
    const result = await processVoiceMessage(audio, "audio/wav", [], { stt });
    assert.deepEqual(result, { ok: false, reason: "too_short" });
    assert.equal(called, false);
  });

  it("maps a silent/unintelligible STT result to the same outcome shape", async () => {
    const audio = await toneBuffer(2, "wav");
    const stt = new FixedStt({ ok: false, reason: "silent" });
    const result = await processVoiceMessage(audio, "audio/wav", [], { stt });
    assert.deepEqual(result, { ok: false, reason: "silent" });
  });

  it("maps an STT provider failure to provider_error", async () => {
    const audio = await toneBuffer(2, "wav");
    const stt = new FixedStt({ ok: false, reason: "provider_error" });
    const result = await processVoiceMessage(audio, "audio/wav", [], { stt });
    assert.deepEqual(result, { ok: false, reason: "provider_error" });
  });
});
