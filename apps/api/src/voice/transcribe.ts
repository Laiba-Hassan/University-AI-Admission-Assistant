import { config } from "../config.js";

// Speech-to-text provider (PRD Decision Register #7: "Decided by the Phase 1 bake-off on real voice-note
// samples" -- left open in the PRD; resolved here as Gemini's native audio understanding, since it needs no new
// vendor account/credential beyond the GEMINI_API_KEY this project already has, and its multilingual support
// covers exactly the three scripts this project needs -- English, Roman Urdu, Urdu). Same injectable-provider
// shape as agent/llm.ts's LlmProvider, so the WhatsApp/web voice pipelines are testable without a live model.

export type Lang = "english" | "roman_urdu" | "urdu";
export type TranscriptionOutcome =
  | { ok: true; text: string; language: Lang | null }
  | { ok: false; reason: "silent" | "unintelligible" | "provider_error" };

export interface SttProvider {
  transcribe(audio: Buffer, mimeType: string, vocabularyHints: string[]): Promise<TranscriptionOutcome>;
}

const PROMPT = (hints: string[]) => `Transcribe this voice message exactly as spoken. The speaker may use English, Roman Urdu (Urdu written in Latin letters), or Urdu script -- transcribe in whichever script/language they actually used, do not translate or transliterate.

These program and campus names may come up; use their standard spelling if you hear something close to one of them: ${hints.length ? hints.join(", ") : "(none on file)"}.

Respond with ONLY a JSON object, no other text: {"transcript": string, "language": "english" | "roman_urdu" | "urdu" | null, "silent_or_unintelligible": boolean}
Set "silent_or_unintelligible" to true if the audio is silent, pure noise, or you genuinely cannot make out real words -- in that case "transcript" can be empty. "language" is your best guess at which of the three it is, or null if silent_or_unintelligible.`;

export class GeminiSttProvider implements SttProvider {
  async transcribe(audio: Buffer, mimeType: string, vocabularyHints: string[]): Promise<TranscriptionOutcome> {
    if (!config.GEMINI_API_KEY) return { ok: false, reason: "provider_error" };
    const body = {
      contents: [{ role: "user", parts: [{ text: PROMPT(vocabularyHints) }, { inlineData: { mimeType, data: audio.toString("base64") } }] }],
      generationConfig: { temperature: 0, responseMimeType: "application/json" },
    };
    let res: Response;
    try {
      res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${config.LLM_MODEL}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": config.GEMINI_API_KEY },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      return { ok: false, reason: "provider_error" };
    }
    if (!res.ok) return { ok: false, reason: "provider_error" };
    try {
      const json = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
      const raw = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
      const parsed = JSON.parse(raw) as { transcript?: string; language?: Lang | null; silent_or_unintelligible?: boolean };
      if (parsed.silent_or_unintelligible || !parsed.transcript?.trim()) return { ok: false, reason: "silent" };
      return { ok: true, text: parsed.transcript.trim(), language: parsed.language ?? null };
    } catch {
      return { ok: false, reason: "provider_error" };
    }
  }
}

export const defaultSttProvider = new GeminiSttProvider();
