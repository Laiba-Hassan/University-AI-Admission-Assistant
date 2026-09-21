import { randomUUID } from "node:crypto";
import { withTenant } from "../db.js";
import { embed, toVector } from "../embeddings.js";
import { recordUsage } from "../usage.js";
import { runAgent, type AgentRun } from "./agent.js";
import { GeminiProvider, type Content, type LlmProvider } from "./llm.js";
import { detectLanguage, type Detected, type Lang } from "./language.js";
import { maskPii } from "./pii.js";
import { buildSystemPrompt } from "./prompt.js";
import { extractFigures, verifyReply, type Verdict } from "./verifier.js";

// Channel-agnostic conversation core (PRD Section 3/6.4): the web widget and, later, WhatsApp both call handleMessage().
// Order of operations: persist the (PII-masked) student message, run the agent, VERIFY, then persist and return the
// reply. Nothing unverified reaches the student.

export type ChatStatus = "ok" | "fallback" | "handoff" | "human" | "duplicate";
export interface ChatInput {
  tenantId: string;
  channel: "web" | "whatsapp";
  externalId: string;          // web session id or WhatsApp wa_id
  text: string;
  channelMessageId?: string;   // WhatsApp message id: replay protection
  today?: string;              // injectable for deterministic evals
  provider?: LlmProvider;
  model?: string;
}
export interface FactCard { type: "fee" | "intake"; label: string; value: string; as_of: string | null; stale?: boolean }
export interface ChatOutput {
  reply: string; status: ChatStatus; language: Detected; conversationId: string; cards: FactCard[];
  debug?: { toolTrace: AgentRun["toolTrace"]; verdict: Verdict; flags: AgentRun["flags"]; leak: boolean; model: string; inputTokens: number; outputTokens: number; unanswered: string[] };
}

// A per-process canary placed in the system prompt; if it ever appears in a reply, the prompt is leaking.
const CANARY = `REF-${randomUUID().slice(0, 8)}`;
const LEAK_PATTERNS = [/INTERNAL REFERENCE/i, /AIza[0-9A-Za-z_-]{20,}/, /sb_(secret|publishable)_/i, /\b(lookup_facts|search_knowledge|capture_lead|request_human)\b/i,
  /\btenant_id\b|pgvector|row[- ]level security|\bapp_user\b/i, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i];
export const leaks = (reply: string) => reply.includes(CANARY) || LEAK_PATTERNS.some((p) => p.test(reply));

const scriptOf = (l: Detected): Lang => (l === "other" ? "english" : l);
const defaultProvider = new GeminiProvider();

export async function handleMessage(input: ChatInput): Promise<ChatOutput> {
  const provider = input.provider ?? defaultProvider;
  const today = input.today ?? new Date().toISOString().slice(0, 10);
  const masked = maskPii(input.text).text;

  // 1. Load context and persist the student's message (masked) in one short transaction.
  const setup = await withTenant(input.tenantId, async (tx) => {
    const tenant = (await tx.query("SELECT name, default_reply_script FROM tenants")).rows[0];
    const contactId = (await tx.query(
      `INSERT INTO contacts (tenant_id, channel, external_id) VALUES (current_tenant_id(), $1, $2)
       ON CONFLICT (tenant_id, channel, external_id) DO UPDATE SET external_id = EXCLUDED.external_id RETURNING id`, [input.channel, input.externalId])).rows[0].id as string;
    let conv = (await tx.query("SELECT id, status FROM conversations WHERE contact_id = $1 AND status <> 'closed' ORDER BY last_message_at DESC LIMIT 1", [contactId])).rows[0];
    if (!conv) {
      conv = (await tx.query("INSERT INTO conversations (tenant_id, contact_id, channel) VALUES (current_tenant_id(), $1, $2) RETURNING id, status", [contactId, input.channel])).rows[0];
      await recordUsage(tx, "conversation_started", input.channel);
    }
    const prior = (await tx.query(
      `SELECT role, content, detected_language FROM messages WHERE conversation_id = $1 ORDER BY "timestamp" DESC, id LIMIT 12`, [conv.id])).rows.reverse();
    const previousLang = [...prior].reverse().find((m) => m.role === "user" && m.detected_language)?.detected_language as Detected | undefined;
    const language: Detected = detectLanguage(input.text) ?? previousLang ?? (tenant.default_reply_script as Lang);
    const inserted = await tx.query(
      `INSERT INTO messages (tenant_id, conversation_id, role, content, detected_language, channel_message_id)
       VALUES (current_tenant_id(), $1, 'user', $2, $3, $4) ON CONFLICT (tenant_id, channel_message_id) DO NOTHING RETURNING id`,
      [conv.id, masked, language, input.channelMessageId ?? null]);
    if (!inserted.rowCount) return { duplicate: true as const, conversationId: conv.id as string };
    await recordUsage(tx, "message_received", input.channel);
    await tx.query("UPDATE conversations SET last_message_at = now() WHERE id = $1", [conv.id]);

    const programs = (await tx.query("SELECT code, name FROM programs WHERE status = 'approved' ORDER BY name")).rows;
    const campuses = (await tx.query("SELECT name, city FROM campuses WHERE status = 'approved' ORDER BY name")).rows;
    const fixed = (await tx.query("SELECT key, language, text FROM localized_messages")).rows as { key: string; language: string; text: string }[];
    return { duplicate: false as const, tenant, contactId, conversationId: conv.id as string, status: conv.status as string, prior, language, programs, campuses, fixed };
  });

  if (setup.duplicate) return { reply: "", status: "duplicate", language: "english", conversationId: setup.conversationId, cards: [] };
  const { language, fixed } = setup;
  const fixedText = (key: string) => fixed.find((f) => f.key === key && f.language === scriptOf(language))?.text ?? fixed.find((f) => f.key === key && f.language === "english")?.text ?? "";

  // A staff member has taken over: store the message, stay silent (PRD 6.4 step 5).
  if (setup.status === "human") return { reply: "", status: "human", language, conversationId: setup.conversationId, cards: [] };

  // 2. Agent turn. The model sees the ORIGINAL text for this turn (needed to capture a lead), history is masked.
  const history: Content[] = setup.prior.map((m) => ({ role: m.role === "user" ? "user" : "model", parts: [{ text: m.content as string }] }));
  const system = buildSystemPrompt({ universityName: setup.tenant.name, today, language, programs: setup.programs, campuses: setup.campuses, canary: CANARY });
  const userTexts = [input.text, ...setup.prior.filter((m) => m.role === "user").map((m) => m.content as string)];
  let run: AgentRun;
  try {
    run = await runAgent({ provider, system, history, userText: input.text, ctx: { tenantId: input.tenantId, channel: input.channel, conversationId: setup.conversationId, contactId: setup.contactId, today, userTexts }, model: input.model });
  } catch (err) {
    console.error("agent failed:", err instanceof Error ? err.message : err);
    throw new Error("assistant_unavailable");
  }

  // 3. Verify. Evidence: this turn's lookup_facts results, retrieved chunks, and the student's own words.
  const verdict = run.text ? verifyReply(run.text, { facts: run.facts, chunks: run.chunks, userTexts }) : { ok: false, unsupported: [] };
  const leak = leaks(run.text);
  const rejected = !run.text || !verdict.ok || leak;

  const unanswered: string[] = [];
  if (rejected) unanswered.push(!run.text ? "no_reply" : leak ? "leak_blocked" : "verifier_rejected");
  if (run.flags.noData) unanswered.push("no_data");
  if (run.flags.lowRetrieval && !run.flags.usedFacts && !run.flags.handoff) unanswered.push("low_retrieval");

  const reply = rejected ? fixedText("fallback") : run.text;
  const status: ChatStatus = rejected ? "fallback" : run.flags.handoff ? "handoff" : "ok";

  // 4. Fact cards for the widget: only figures that survived verification and appear in the reply.
  const shown = new Set(rejected ? [] : extractFigures(reply).map((f) => `${f.kind}:${f.value}`));
  const cards: FactCard[] = [];
  for (const f of run.facts as { fees?: Record<string, unknown>[]; intakes?: Record<string, unknown>[] }[]) {
    for (const r of f.fees ?? []) if (shown.has(`amount:${r.amount}`))
      cards.push({ type: "fee", label: `${r.applies_to} · ${r.campus} · ${r.student_type} · ${r.item}`, value: `${r.currency} ${Number(r.amount).toLocaleString("en-US")} / ${String(r.per).replace("_", " ")}`, as_of: r.last_verified_at as string | null, stale: Boolean(r.is_stale) });
    for (const r of f.intakes ?? []) if (shown.has(`date:${r.application_deadline}`))
      cards.push({ type: "intake", label: `${r.intake} · ${r.applies_to} · application deadline`, value: String(r.application_deadline), as_of: r.last_verified_at as string | null });
  }

  // 5. Persist the reply with its metadata, meter usage, and log unanswered questions.
  await withTenant(input.tenantId, async (tx) => {
    await tx.query(
      `INSERT INTO messages (tenant_id, conversation_id, role, content, detected_language, metadata)
       VALUES (current_tenant_id(), $1, 'assistant', $2, $3, $4)`,
      [setup.conversationId, reply, language, JSON.stringify({
        tool_calls: run.toolTrace, verifier: { ok: verdict.ok && !leak, unsupported: verdict.unsupported.map((u) => u.raw), leak_blocked: leak },
        model: run.model, input_tokens: run.inputTokens, output_tokens: run.outputTokens, unanswered,
      })]);
    await tx.query("UPDATE conversations SET last_message_at = now() WHERE id = $1", [setup.conversationId]);
    await recordUsage(tx, "ai_reply", input.channel, { model: run.model, input_tokens: run.inputTokens, output_tokens: run.outputTokens });
    if (unanswered.length) {
      const hit = await tx.query(
        "UPDATE unanswered_questions SET count = count + 1, last_seen = now() WHERE lower(question_text) = lower($1) AND status = 'open' RETURNING id", [masked]);
      if (!hit.rowCount) {
        let vector: string | null = null;
        try { vector = toVector((await embed([masked], "RETRIEVAL_QUERY"))[0]!); } catch { /* embedding is best-effort here */ }
        await tx.query("INSERT INTO unanswered_questions (tenant_id, question_text, embedding) VALUES (current_tenant_id(), $1, $2::vector)", [masked, vector]);
      }
    }
    if (rejected) await tx.query("INSERT INTO event_outbox (tenant_id, event_type, payload) VALUES (current_tenant_id(), 'unanswered_logged', $1)", [JSON.stringify({ conversation_id: setup.conversationId, reasons: unanswered })]);
  });

  return {
    reply, status, language, conversationId: setup.conversationId, cards,
    debug: { toolTrace: run.toolTrace, verdict, flags: run.flags, leak, model: run.model, inputTokens: run.inputTokens, outputTokens: run.outputTokens, unanswered },
  };
}
