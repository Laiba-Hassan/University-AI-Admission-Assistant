import type { Tx } from "../db.js";
import { convertToOgg, needsConversion, probeDurationSeconds } from "./convert.js";
import { defaultSttProvider, type Lang, type SttProvider } from "./transcribe.js";

export const MAX_VOICE_SECONDS = 125; // "about 2 minutes" (PRD 6.1/6.2), with a little headroom over an exact 120
const MIN_VOICE_SECONDS = 0.5; // shorter than this can't possibly contain a spoken question

export type VoicePipelineResult =
  | { ok: true; transcript: string; audioSeconds: number; language: Lang | null }
  | { ok: false; reason: "too_long" | "too_short" | "silent" | "unintelligible" | "provider_error" };

/** Program/campus names to prime the STT model with (PRD 6.2: "speech-to-text with tenant vocabulary hints"),
 * shared by both the WhatsApp and web mic pipelines. Takes an already-tenant-scoped transaction rather than a
 * tenant id, since the web path (chat.ts) already has one open for the challenge/limit checks around it. */
export async function vocabularyHints(tx: Tx): Promise<string[]> {
  const rows = await tx.query(`SELECT name FROM programs WHERE status = 'approved' UNION SELECT name FROM campuses WHERE status = 'approved'`);
  return (rows.rows as { name: string }[]).map((r) => r.name);
}

const EXT_FOR_MIME: Record<string, string> = {
  "audio/ogg": "ogg", "audio/webm": "webm", "audio/mp4": "mp4", "audio/aac": "aac",
  "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/wav": "wav", "audio/amr": "amr", "audio/3gpp": "3gp",
};

/** The one voice pipeline both WhatsApp voice notes and the web mic button go through (PRD: "transcribed by the
 * same pipeline"): probe duration and reject anything over the ~2-minute limit before spending a transcription
 * call on it, normalize to a format Gemini accepts natively if the source format isn't one already, transcribe,
 * and map a silent/unintelligible/too-short result onto the same "please resend or type" outcome the caller
 * turns into a localized reply. Nothing here writes the audio to permanent storage; convert.ts's temp files are
 * already cleaned up by the time this returns, and the caller never persists `raw` either. */
export async function processVoiceMessage(
  raw: Buffer, mimeType: string, vocabularyHints: string[],
  deps: { stt?: SttProvider } = {},
): Promise<VoicePipelineResult> {
  const stt = deps.stt ?? defaultSttProvider;
  const ext = EXT_FOR_MIME[mimeType.split(";")[0]!.trim().toLowerCase()] ?? "bin";

  const duration = await probeDurationSeconds(raw, ext);
  if (duration !== null) {
    if (duration > MAX_VOICE_SECONDS) return { ok: false, reason: "too_long" };
    if (duration < MIN_VOICE_SECONDS) return { ok: false, reason: "too_short" };
  }

  let audio = raw, audioMime = mimeType;
  if (needsConversion(mimeType)) {
    try {
      audio = await convertToOgg(raw, ext);
      audioMime = "audio/ogg";
    } catch {
      return { ok: false, reason: "provider_error" };
    }
  }

  const outcome = await stt.transcribe(audio, audioMime, vocabularyHints);
  if (!outcome.ok) return { ok: false, reason: outcome.reason };
  return { ok: true, transcript: outcome.text, audioSeconds: duration ?? 0, language: outcome.language };
}
