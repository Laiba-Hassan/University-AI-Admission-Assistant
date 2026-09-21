import { config } from "../config.js";

// LLM provider abstraction (PRD Section 10: "LLM provider abstraction retained"). The agent only talks to this
// interface, so a different provider, or a fake in tests, is a drop-in replacement.

export type Part =
  | { text: string }
  | { functionCall: { name: string; args: Record<string, unknown> } }
  | { functionResponse: { name: string; response: Record<string, unknown> } };
export interface Content { role: "user" | "model"; parts: Part[] }
export interface ToolDecl { name: string; description: string; parameters: Record<string, unknown> }
export interface GenerateResult { content: Content; inputTokens: number; outputTokens: number; model: string }
export interface GenerateRequest { system: string; contents: Content[]; tools: ToolDecl[]; model?: string }

export interface LlmProvider { generate(req: GenerateRequest): Promise<GenerateResult> }

export const DEFAULT_MODEL = config.LLM_MODEL;

export class GeminiProvider implements LlmProvider {
  async generate({ system, contents, tools, model = DEFAULT_MODEL }: GenerateRequest): Promise<GenerateResult> {
    if (!config.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not set");
    let thinking: string | undefined = config.LLM_THINKING_LEVEL || undefined;
    const build = () => ({
      systemInstruction: { parts: [{ text: system }] },
      contents,
      tools: tools.length ? [{ functionDeclarations: tools }] : undefined,
      // Temperature 0 for reproducible answers (PRD: eval runs at temperature 0).
      generationConfig: { temperature: 0, maxOutputTokens: 1500, ...(thinking ? { thinkingConfig: { thinkingLevel: thinking } } : {}) },
    });
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": config.GEMINI_API_KEY },
          body: JSON.stringify(build()),
          signal: AbortSignal.timeout(45_000),
        });
      } catch (err) {
        // Timeout or network error: retry a couple of times before giving up.
        if (attempt < 2) continue;
        throw new Error(`LLM request failed (${err instanceof Error ? err.name : "network"})`);
      }
      if (res.ok) {
        const json = (await res.json()) as {
          candidates?: { content?: Content; finishReason?: string }[];
          usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
        };
        const content = json.candidates?.[0]?.content;
        // Content is kept verbatim (including any thought signatures) so multi-turn tool calls round-trip correctly.
        return {
          content: content?.parts?.length ? { role: "model", parts: content.parts } : { role: "model", parts: [] },
          inputTokens: json.usageMetadata?.promptTokenCount ?? 0,
          outputTokens: json.usageMetadata?.candidatesTokenCount ?? 0,
          model,
        };
      }
      // A model that does not support the thinking setting rejects it; retry once without it.
      if (res.status === 400 && thinking) { thinking = undefined; continue; }
      if ((res.status === 429 || res.status >= 500) && attempt < 6) {
        await new Promise((r) => setTimeout(r, Math.min(60_000, 2_000 * 2 ** attempt)));
        continue;
      }
      throw new Error(`LLM request failed (HTTP ${res.status})`); // body deliberately not surfaced
    }
  }
}
