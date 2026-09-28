import { config } from "./config.js";
import type { ImportTarget } from "./import.js";

// Phase 7: "AI-assisted import with mandatory staged human review". This is deliberately just the extraction
// step -- it turns free text (pasted from a prospectus, a fee schedule PDF, an email) into rows shaped exactly
// like a CSV upload's parsed rows (Record<string,string>[]), which then go through the SAME validateRows() /
// createImportBatch() / reviewImportDraft() pipeline manual CSV imports already use. Nothing the model extracts
// ever reaches a real table without a staff member reviewing and accepting each row -- the "mandatory staged
// human review" part was already built (Phase 5) and is reused verbatim, not re-implemented here.

const FIELDS: Record<ImportTarget, string> = {
  programs: "name (string), code (short string, optional), degree_level (one of: diploma, bachelor, master, doctorate)",
  "fee-items": "program_code (must match a program's code), academic_year (e.g. 2026-27), student_type (local or international), item_type (tuition, admission, hostel, or other), amount (number), currency (3-letter code, e.g. PKR), per (semester, year, one-time, or credit_hour)",
  faqs: "question (string), answer (string)",
  scholarships: "name (string), criteria (string, optional), coverage (string, optional), conditions (string, optional)",
  intakes: "program_code (must match a program's code), intake_name (e.g. Fall 2026), application_deadline (a date, optional), seats (number, optional)",
  requirements: "program_code (must match a program's code), eligibility (string, optional), required_documents (string, optional) -- at least one of eligibility/required_documents",
  faculties: "name (string)",
  campuses: "name (string), city (string, optional), address (string, optional)",
};

const PROMPT = (target: ImportTarget, text: string) => `You extract structured records from university admissions text for a staged import (a human reviews every row before it's saved -- extract generously, do not skip anything that looks relevant).

Target: "${target}". Each row needs these fields: ${FIELDS[target]}

Extract every row you can find in the text below. Respond with ONLY a JSON array of objects, no other text, using exactly those field names as keys and string values (numbers as strings too, e.g. "amount": "85000"). Omit a field entirely if it's genuinely not present, rather than guessing. If nothing relevant is in the text, respond with [].

TEXT:
"""
${text.slice(0, 20_000)}
"""`;

export interface AiExtractProvider {
  extract(target: ImportTarget, text: string): Promise<Record<string, string>[]>;
}

export class GeminiAiExtractProvider implements AiExtractProvider {
  async extract(target: ImportTarget, text: string): Promise<Record<string, string>[]> {
    if (!config.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not set");
    const body = {
      contents: [{ role: "user", parts: [{ text: PROMPT(target, text) }] }],
      generationConfig: { temperature: 0, responseMimeType: "application/json", maxOutputTokens: 8000 },
    };
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${config.LLM_MODEL}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": config.GEMINI_API_KEY },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) throw new Error(`AI extraction failed (HTTP ${res.status})`);
    const json = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const raw = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "[]";
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { throw new Error("AI returned unparseable output"); }
    if (!Array.isArray(parsed)) throw new Error("AI did not return a JSON array");
    // Stringify every value: the model sometimes returns a real number/boolean even though the prompt asks for
    // strings, and validateRows()/the zod schemas (z.coerce.number(), etc.) expect the same string-keyed shape
    // parseCsv() produces either way, so this keeps both sources going through one identical code path.
    return parsed.map((row) => Object.fromEntries(Object.entries(row as Record<string, unknown>).map(([k, v]) => [k, v == null ? "" : String(v)])));
  }
}

export const defaultAiExtractProvider = new GeminiAiExtractProvider();
