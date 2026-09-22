import { randomUUID } from "node:crypto";
import { config } from "../config.js";
import { withTenant, type Tx } from "../db.js";
import { embed, toVector } from "../embeddings.js";
import { recordUsage } from "../usage.js";
import { runAgent, type AgentRun } from "./agent.js";
import { GeminiProvider, type Content, type LlmProvider } from "./llm.js";
import { detectLanguage, type Detected, type Lang } from "./language.js";
import { maskPii } from "./pii.js";
import { buildSystemPrompt } from "./prompt.js";
import { extractFigures, verifyReply, type Verdict } from "./verifier.js";

// Channel-agnostic conversation core (PRD Section 3/6.4): the web widget and, later, WhatsApp both call handleMessage().
// Order of operations: check limits/consent, persist the (PII-masked) student message, run the agent, VERIFY, then
// persist and return the reply. Nothing unverified reaches the student.

export type ChatStatus = "ok" | "fallback" | "handoff" | "human" | "duplicate" | "limit_reached" | "opted_out";
export interface ChatInput {
  tenantId: string;
  channel: "web" | "whatsapp";
  externalId: string;          // web session id or WhatsApp wa_id
  text: string;
  channelMessageId?: string;   // WhatsApp message id: replay protection
  today?: string;              // injectable for deterministic evals
  provider?: LlmProvider;
  model?: string;
  forcedLanguage?: Lang;       // student picked a language chip in the widget; skips auto-detect for this turn
}
export interface FactCard { type: "fee" | "intake"; label: string; value: string; as_of: string | null; stale?: boolean }
export interface ChatOutput {
  reply: string; status: ChatStatus; language: Detected; conversationId: string | null; messageId: string | null; cards: FactCard[];
  debug?: { toolTrace: AgentRun["toolTrace"]; verdict: Verdict; flags: AgentRun["flags"]; leak: boolean; model: string; inputTokens: number; outputTokens: number; unanswered: string[] };
}

// A per-process canary placed in the system prompt; if it ever appears in a reply, the prompt is leaking.
const CANARY = `REF-${randomUUID().slice(0, 8)}`;
const LEAK_PATTERNS = [/INTERNAL REFERENCE/i, /AIza[0-9A-Za-z_-]{20,}/, /sb_(secret|publishable)_/i, /\b(lookup_facts|search_knowledge|capture_lead|request_human)\b/i,
  /\btenant_id\b|pgvector|row[- ]level security|\bapp_user\b/i, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i];
export const leaks = (reply: string) => reply.includes(CANARY) || LEAK_PATTERNS.some((p) => p.test(reply));

const scriptOf = (l: Detected): Lang => (l === "other" ? "english" : l);
const defaultProvider = new GeminiProvider();
const noReply = (status: ChatStatus, conversationId: string | null = null): ChatOutput => ({ reply: "", status, language: "english", conversationId, messageId: null, cards: [] });

/** Upserts the contact and, if the contact already has an open conversation, returns it. Never creates one: the
 * monthly conversation limit must be checked BEFORE a new conversation row exists, not after. */
async function findConversation(tx: Tx, channel: "web" | "whatsapp", externalId: string) {
  const contact = (await tx.query(
    `INSERT INTO contacts (tenant_id, channel, external_id) VALUES (current_tenant_id(), $1, $2)
     ON CONFLICT (tenant_id, channel, external_id) DO UPDATE SET external_id = EXCLUDED.external_id RETURNING id, opted_out`, [channel, externalId])).rows[0];
  const conv = (await tx.query("SELECT id, status FROM conversations WHERE contact_id = $1 AND status <> 'closed' ORDER BY last_message_at DESC LIMIT 1", [contact.id])).rows[0];
  return { contactId: contact.id as string, optedOut: contact.opted_out as boolean, conversationId: (conv?.id as string) ?? null, conversationStatus: (conv?.status as string) ?? null };
}

/** Creates a new conversation for a contact that has none open. Call only once any limit check has passed. */
async function createConversation(tx: Tx, contactId: string, channel: "web" | "whatsapp") {
  const conv = (await tx.query("INSERT INTO conversations (tenant_id, contact_id, channel) VALUES (current_tenant_id(), $1, $2) RETURNING id, status", [contactId, channel])).rows[0];
  return { conversationId: conv.id as string, conversationStatus: conv.status as string };
}

/** Finds this contact's open conversation, or creates both the contact and a new conversation. Used where no
 * monthly-limit gate applies (the explicit, model-independent handoff action below). */
async function resolveConversation(tx: Tx, channel: "web" | "whatsapp", externalId: string) {
  const found = await findConversation(tx, channel, externalId);
  if (found.conversationId) return { ...found, isNew: false };
  const created = await createConversation(tx, found.contactId, channel);
  return { ...found, ...created, isNew: true };
}

/** Explicit, model-independent handoff (the widget's always-visible "Talk to admissions" button). */
export async function requestHandoff(tenantId: string, channel: "web" | "whatsapp", externalId: string, reason: string): Promise<{ conversationId: string; already: boolean }> {
  return withTenant(tenantId, async (tx) => {
    const { conversationId, conversationStatus } = await resolveConversation(tx, channel, externalId);
    if (conversationStatus === "needs_human" || conversationStatus === "human") return { conversationId, already: true };
    await tx.query("UPDATE conversations SET status = 'needs_human', last_message_at = now() WHERE id = $1", [conversationId]);
    await tx.query("INSERT INTO event_outbox (tenant_id, event_type, payload) VALUES (current_tenant_id(), 'handoff_requested', $1)", [JSON.stringify({ conversation_id: conversationId, reason: maskPii(reason).text })]);
    await recordUsage(tx, "handoff_requested", channel);
    return { conversationId, already: false };
  });
}

export async function handleMessage(input: ChatInput): Promise<ChatOutput> {
  const provider = input.provider ?? defaultProvider;
  const today = input.today ?? new Date().toISOString().slice(0, 10);
  const masked = maskPii(input.text).text;

  // 1. Load context. No message is written yet: a blocked-by-monthly-cap request should not itself count against
  // future limits, and a brand-new conversation should not be created only to immediately refuse it.
  const setup = await withTenant(input.tenantId, async (tx) => {
    const tenant = (await tx.query(
      `SELECT t.name, t.default_reply_script, t.status,
              COALESCE(l.monthly_conversation_limit, 2147483647) AS monthly_conversation_limit,
              COALESCE(l.monthly_message_limit, 2147483647) AS monthly_message_limit
         FROM tenants t LEFT JOIN tenant_limits l ON l.tenant_id = t.id`)).rows[0];
    let conv = await findConversation(tx, input.channel, input.externalId);

    if (conv.optedOut) return { blocked: "opted_out" as const, conversationId: conv.conversationId };

    if (!conv.conversationId) {
      // Counted BEFORE any conversation row is created (pre-increment): n is how many conversations already started
      // this month, so >= blocks once that count reaches the limit (a limit of 0 must block the very first attempt).
      const n = (await tx.query("SELECT count(*)::int AS n FROM usage_events WHERE event_type = 'conversation_started' AND \"timestamp\" >= date_trunc('month', now())")).rows[0].n;
      if (n >= tenant.monthly_conversation_limit) return { blocked: "monthly_conversation" as const, conversationId: null };
      conv = { ...conv, ...(await createConversation(tx, conv.contactId, input.channel)) };
      await recordUsage(tx, "conversation_started", input.channel);
    }

    const prior = (await tx.query(
      `SELECT role, content, detected_language FROM messages WHERE conversation_id = $1 ORDER BY "timestamp" DESC, id LIMIT 12`, [conv.conversationId])).rows.reverse();
    const previousLang = [...prior].reverse().find((m) => m.role === "user" && m.detected_language)?.detected_language as Detected | undefined;
    const language: Detected = input.forcedLanguage ?? detectLanguage(input.text) ?? previousLang ?? (tenant.default_reply_script as Lang);

    const inserted = await tx.query(
      `INSERT INTO messages (tenant_id, conversation_id, role, content, detected_language, channel_message_id)
       VALUES (current_tenant_id(), $1, 'user', $2, $3, $4) ON CONFLICT (tenant_id, channel_message_id) DO NOTHING RETURNING id`,
      [conv.conversationId, masked, language, input.channelMessageId ?? null]);
    if (!inserted.rowCount) return { blocked: "duplicate" as const, conversationId: conv.conversationId };
    await recordUsage(tx, "message_received", input.channel);
    await tx.query("UPDATE conversations SET last_message_at = now() WHERE id = $1", [conv.conversationId]);

    // Monthly message cap and per-conversation token cap: the message is already stored (it's a real received
    // message either way), but the model is never called past either limit.
    // Counted AFTER recordUsage above (post-increment, includes this message), so > is correct here: the message
    // that tips the count past the limit is still stored, just not answered by the model.
    const monthlyMessages = (await tx.query("SELECT count(*)::int AS n FROM usage_events WHERE event_type = 'message_received' AND \"timestamp\" >= date_trunc('month', now())")).rows[0].n;
    const tokensSoFar = (await tx.query(
      "SELECT COALESCE(SUM((metadata->>'input_tokens')::int),0) + COALESCE(SUM((metadata->>'output_tokens')::int),0) AS n FROM messages WHERE conversation_id = $1 AND role = 'assistant'", [conv.conversationId])).rows[0].n;
    if (monthlyMessages > tenant.monthly_message_limit) return { blocked: "monthly_message" as const, conversationId: conv.conversationId, language };
    if (tokensSoFar >= config.MAX_CONVERSATION_TOKENS) return { blocked: "token_cap" as const, conversationId: conv.conversationId, language };

    const programs = (await tx.query("SELECT code, name FROM programs WHERE status = 'approved' ORDER BY name")).rows;
    const campuses = (await tx.query("SELECT name, city FROM campuses WHERE status = 'approved' ORDER BY name")).rows;
    const fixed = (await tx.query("SELECT key, language, text FROM localized_messages")).rows as { key: string; language: string; text: string }[];
    return { blocked: undefined, tenant, contactId: conv.contactId, conversationId: conv.conversationId, status: conv.conversationStatus, prior, language, programs, campuses, fixed };
  });

  const fixedTextFor = (fixed: { key: string; language: string; text: string }[], language: Detected, key: string) =>
    fixed.find((f) => f.key === key && f.language === scriptOf(language))?.text ?? fixed.find((f) => f.key === key && f.language === "english")?.text ?? "";

  if (setup.blocked) {
    switch (setup.blocked) {
      case "opted_out": return noReply("opted_out", setup.conversationId);
      case "duplicate": return noReply("duplicate", setup.conversationId);
      case "monthly_conversation":
        await withTenant(input.tenantId, (tx) => recordUsage(tx, "limit_blocked", input.channel, { reason: "monthly_conversation" }));
        return { ...noReply("limit_reached", null), reply: "This assistant is unavailable right now, please contact admissions directly.", language: input.forcedLanguage ?? "english" };
      case "monthly_message":
      case "token_cap": {
        // A real message was stored; reply with the tenant's own fallback text in its language, but skip the model.
        const fixed = (await withTenant(input.tenantId, async (tx) => (await tx.query("SELECT key, language, text FROM localized_messages")).rows)) as { key: string; language: string; text: string }[];
        const language = setup.language ?? "english";
        const reply = fixedTextFor(fixed, language, "fallback");
        await withTenant(input.tenantId, (tx) => recordUsage(tx, "limit_blocked", input.channel, { reason: setup.blocked }));
        return { reply, status: "limit_reached", language, conversationId: setup.conversationId, messageId: null, cards: [] };
      }
    }
  }
  const { language, fixed } = setup;
  const fixedText = (key: string) => fixedTextFor(fixed, language, key);

  // A staff member has taken over: store the message, stay silent (PRD 6.4 step 5).
  if (setup.status === "human") return { ...noReply("human", setup.conversationId), language };

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
  const messageId = await withTenant(input.tenantId, async (tx) => {
    const id = (await tx.query(
      `INSERT INTO messages (tenant_id, conversation_id, role, content, detected_language, metadata)
       VALUES (current_tenant_id(), $1, 'assistant', $2, $3, $4) RETURNING id`,
      [setup.conversationId, reply, language, JSON.stringify({
        tool_calls: run.toolTrace, verifier: { ok: verdict.ok && !leak, unsupported: verdict.unsupported.map((u) => u.raw), leak_blocked: leak },
        model: run.model, input_tokens: run.inputTokens, output_tokens: run.outputTokens, unanswered,
      })])).rows[0].id as string;
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
    return id;
  });

  return {
    reply, status, language, conversationId: setup.conversationId, messageId, cards,
    debug: { toolTrace: run.toolTrace, verdict, flags: run.flags, leak, model: run.model, inputTokens: run.inputTokens, outputTokens: run.outputTokens, unanswered },
  };
}
