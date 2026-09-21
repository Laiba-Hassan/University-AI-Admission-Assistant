// Evaluation runner (PRD Section 5 "Evaluation Set", Section 12 release gates).
//   pnpm --filter @uaa/api eval -- --tenant crescent-valley --set smoke
// Options: --tenant <subdomain>  --set smoke|full|tuning|heldout  --model <id>  --concurrency N  --repeat N  --ids a,b  --out file
// Checks are exact-match by code (numbers, dates, refusals, leaks, language); no LLM judge is used.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { handleMessage, leaks, type ChatOutput } from "../src/agent/conversation.js";
import { detectLanguage, type Detected } from "../src/agent/language.js";
import { extractFigures } from "../src/agent/verifier.js";
import { pool, withTenant } from "../src/db.js";
import { tenantIdFor } from "../src/seed/seed.js";
import type { EvalCase } from "./build-dataset.js";

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i++) if (process.argv[i]!.startsWith("--")) args.set(process.argv[i]!.slice(2), process.argv[i + 1]?.startsWith("--") || process.argv[i + 1] === undefined ? "true" : process.argv[++i]!);
const tenant = args.get("tenant") ?? "crescent-valley";
const set = args.get("set") ?? "smoke";
const model = args.get("model");
const concurrency = Number(args.get("concurrency") ?? 3);
const repeat = Number(args.get("repeat") ?? 1);
const TODAY = "2026-09-20"; // the "demo today" the seed data's hard cases are built around

const here = dirname(fileURLToPath(import.meta.url));
let cases = readFileSync(join(here, "datasets", `${tenant}.jsonl`), "utf-8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as EvalCase);
if (set === "smoke") cases = cases.filter((c) => c.smoke);
else if (set === "tuning") cases = cases.filter((c) => !c.heldout);
else if (set === "heldout") cases = cases.filter((c) => c.heldout);
if (args.get("ids")) { const ids = new Set(args.get("ids")!.split(",")); cases = cases.filter((c) => ids.has(c.id)); }

const DECLINE_WORDS = /(don't|do not|doesn't|does not|not offer|no such|not available|no information|unable|cannot|can't|not listed|not have|no data|nahi|nahin|nhi|maloomat|mojood|نہیں|دستیاب|موجود)/i;
const OFFER = /(admissions|staff|team|office|contact|connect|رابطہ|ایڈمشن|اسٹاف|عملہ|ٹیم|madad|rabta)/i;
const CLARIFY_Q = /[?؟]/;

interface Result { figureFail?: boolean; id: string; category: string; script: string; run: number; pass: boolean; failures: string[]; leak: boolean; langOk?: boolean; ms: number; inTok: number; outTok: number; reply: string; status: string; error?: string }

const dateMatches = (figures: ReturnType<typeof extractFigures>, iso: string) =>
  figures.some((f) => f.kind === "date" && (f.value === iso || f.value === iso.slice(5)));
const hasAmount = (figures: ReturnType<typeof extractFigures>, n: number) => figures.some((f) => f.kind === "amount" && Number(f.value) === n);

function judge(c: EvalCase, out: ChatOutput, expectedLang: Detected | undefined): Pick<Result, "pass" | "failures" | "leak" | "langOk" | "figureFail"> {
  const failures: string[] = [];
  const reply = out.reply;
  const lower = reply.toLowerCase();
  const figures = extractFigures(reply);
  const e = c.expect;
  const d = out.debug!;
  const leak = leaks(reply) || e.mustNotContain.some((s) => lower.includes(s.toLowerCase()));
  if (leaks(reply)) failures.push("leak: reply exposes internals");
  for (const s of e.mustNotContain) if (lower.includes(s.toLowerCase())) failures.push(`must-not-contain hit: "${s}"`);
  for (const n of e.forbidAmounts ?? []) if (hasAmount(figures, n)) failures.push(`quoted forbidden amount ${n}`);
  if (out.status === "fallback" && e.behavior === "answer") failures.push("fell back instead of answering");
  if (!d.verdict.ok && out.status !== "fallback") failures.push("unverified figure reached the student");

  switch (e.behavior) {
    case "answer":
      if (out.status !== "ok") failures.push(`status ${out.status}`);
      for (const n of e.amounts ?? []) if (!hasAmount(figures, n)) failures.push(`missing amount ${n}`);
      for (const iso of e.dates ?? []) if (!dateMatches(figures, iso)) failures.push(`missing date ${iso}`);
      for (const s of e.contains ?? []) if (!lower.includes(s.toLowerCase())) failures.push(`missing "${s}"`);
      if (e.containsAny && !e.containsAny.some((s) => lower.includes(s.toLowerCase()))) failures.push(`none of [${e.containsAny.join("|")}]`);
      if (d.unanswered.length && !e.amounts?.length && !e.dates?.length) failures.push(`logged unanswered: ${d.unanswered}`);
      break;
    case "clarify":
      if (figures.some((f) => f.kind === "amount")) failures.push("quoted an amount instead of asking");
      if (!CLARIFY_Q.test(reply)) failures.push("did not ask a question");
      break;
    case "decline":
      if (figures.some((f) => f.kind === "amount")) failures.push("quoted an amount for an unanswerable question");
      if (!(out.status === "fallback" || d.unanswered.length || d.flags.handoff || DECLINE_WORDS.test(reply))) failures.push("did not decline");
      if (!(OFFER.test(reply) || out.status === "fallback" || d.flags.handoff)) failures.push("no handoff offer");
      break;
    case "handoff":
      if (!d.flags.handoff) failures.push("request_human was not called");
      break;
    case "lead":
      if (!d.flags.leadSaved) failures.push("lead was not saved");
      break;
    case "safe":
      break; // covered by the common leak / forbidden-amount / verifier checks above
  }

  let langOk: boolean | undefined;
  if (expectedLang && expectedLang !== "other" && out.status !== "human" && reply) {
    langOk = detectLanguage(reply) === expectedLang;
    if (!langOk) failures.push(`language: expected ${expectedLang}, reply detected as ${detectLanguage(reply)}`);
  }
  const figureFail = failures.some((f) => /^(missing amount|missing date|missing "|quoted|unverified|must-not-contain)/.test(f));
  return { pass: failures.length === 0, failures, leak, langOk, figureFail };
}

// One automatic retry on infrastructure errors (timeouts, overloaded model): those say nothing about answer quality.
async function runCase(c: EvalCase, run: number): Promise<Result> {
  const first = await runCaseOnce(c, run);
  return first.error ? runCaseOnce(c, run) : first;
}

async function runCaseOnce(c: EvalCase, run: number): Promise<Result> {
  const session = `eval-${c.id}-${run}-${Math.random().toString(36).slice(2, 8)}`;
  const t0 = Date.now();
  let last: ChatOutput | undefined, inTok = 0, outTok = 0;
  try {
    for (const turn of c.turns) {
      last = await handleMessage({ tenantId: tenantIdFor(tenant), channel: "web", externalId: session, text: turn, today: TODAY, model });
      inTok += last.debug?.inputTokens ?? 0;
      outTok += last.debug?.outputTokens ?? 0;
    }
  } catch (err) {
    return { id: c.id, category: c.category, script: c.script, run, pass: false, failures: ["infrastructure error"], leak: false, ms: Date.now() - t0, inTok, outTok, reply: "", status: "error", error: err instanceof Error ? err.message : String(err) };
  }
  const detected = [...c.turns].reverse().map((t) => detectLanguage(t)).find(Boolean);
  const j = judge(c, last!, detected);
  if (c.expect.behavior === "lead" && j.pass) {
    // PII must be masked in stored messages even though the model saw the original text for the turn.
    const stored = await withTenant(tenantIdFor(tenant), async (tx) =>
      (await tx.query("SELECT string_agg(m.content, ' ') AS t FROM messages m JOIN contacts ct ON ct.id = (SELECT contact_id FROM conversations WHERE id = m.conversation_id) WHERE ct.external_id = $1", [session])).rows[0].t as string);
    if (/0300|1234567|@example\.com/.test(stored ?? "")) { j.pass = false; j.failures.push("PII was stored unmasked"); }
  }
  return { id: c.id, category: c.category, script: c.script, run, ...j, ms: Date.now() - t0, inTok, outTok, reply: last!.reply, status: last!.status };
}

const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1)}%` : "n/a");
const quantile = (xs: number[], q: number) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(q * xs.length))]! : 0);

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("eval writes conversations; refusing to run in production");
  const started = new Date();
  const jobs = cases.flatMap((c) => Array.from({ length: repeat }, (_, r) => ({ c, r })));
  const results: Result[] = [];
  let next = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (next < jobs.length) {
      const { c, r } = jobs[next++]!;
      const res = await runCase(c, r);
      results.push(res);
      process.stdout.write(res.pass ? "." : res.error ? "E" : "F");
    }
  }));
  console.log(`\n\n${tenant} / ${set} / model ${model ?? "(default)"}: ${results.length} runs of ${cases.length} cases`);

  // ---- report
  const by = (f: (r: Result) => boolean) => results.filter(f);
  const cat = [...new Set(results.map((r) => r.category))];
  for (const k of cat) { const rs = by((r) => r.category === k); console.log(`  ${k.padEnd(13)} ${rs.filter((r) => r.pass).length}/${rs.length}`); }
  const byId = new Map(cases.map((c) => [c.id, c]));
  const structured = by((r) => (byId.get(r.id)!.expect.amounts?.length ?? 0) + (byId.get(r.id)!.expect.dates?.length ?? 0) > 0);
  const unans = by((r) => r.category === "unanswerable");
  const langRuns = by((r) => r.langOk !== undefined);
  const leakRuns = by((r) => r.leak);
  const gates = [
    ["exact structured facts (fees/dates)", `${structured.filter((r) => !r.error && !r.figureFail).length}/${structured.length}`, structured.length > 0 && structured.every((r) => !r.error && !r.figureFail), "100%"],
    ["unanswerable declined with offer", pct(unans.filter((r) => r.pass).length, unans.length), unans.length === 0 || unans.filter((r) => r.pass).length / unans.length >= 0.95, ">= 95%"],
    ["leaks (prompt / cross-tenant)", String(leakRuns.length), leakRuns.length === 0, "0"],
    ["reply language matches input", pct(langRuns.filter((r) => r.langOk).length, langRuns.length), langRuns.length === 0 || langRuns.filter((r) => r.langOk).length / langRuns.length >= 0.98, ">= 98%"],
  ] as const;
  console.log("\nRelease gates:");
  for (const [name, value, ok, target] of gates) console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}: ${value} (target ${target})`);
  const ms = results.map((r) => r.ms / Math.max(1, byId.get(r.id)!.turns.length));
  console.log(`\nLatency per turn: p50 ${(quantile(ms, 0.5) / 1000).toFixed(1)}s, p95 ${(quantile(ms, 0.95) / 1000).toFixed(1)}s   tokens: ${results.reduce((s, r) => s + r.inTok, 0)} in / ${results.reduce((s, r) => s + r.outTok, 0)} out`);
  if (repeat > 1) {
    const flips = cases.filter((c) => { const rs = results.filter((r) => r.id === c.id); return rs.some((r) => r.pass) && rs.some((r) => !r.pass); });
    console.log(`Non-deterministic cases (pass and fail across ${repeat} runs): ${flips.length ? flips.map((c) => c.id).join(", ") : "none"}`);
  }
  const failed = results.filter((r) => !r.pass);
  if (failed.length) {
    console.log(`\nFailures (${failed.length}):`);
    for (const r of failed) console.log(`- ${r.id} [${r.script}${byId.get(r.id)!.heldout ? ", held-out" : ""}] ${byId.get(r.id)!.turns.at(-1)}\n    ${r.failures.join("; ")}${r.error ? ` (${r.error})` : ""}\n    reply(${r.status}): ${r.reply.replace(/\s+/g, " ").slice(0, 260)}`);
  }

  const out = args.get("out") ?? join(here, "results", `${started.toISOString().replace(/[:.]/g, "-")}-${tenant}-${set}-${model ?? "default"}.json`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify({ tenant, set, model: model ?? "default", started, gates: gates.map(([n, v, ok]) => ({ n, v, ok })), results }, null, 1));

  // ---- cleanup: remove what this run created in the demo tenant (conversations, leads, usage, outbox, unanswered)
  await withTenant(tenantIdFor(tenant), async (tx) => {
    await tx.query("DELETE FROM leads WHERE contact_id IN (SELECT id FROM contacts WHERE external_id LIKE 'eval-%')");
    await tx.query("DELETE FROM conversations WHERE contact_id IN (SELECT id FROM contacts WHERE external_id LIKE 'eval-%')");
    await tx.query("DELETE FROM contacts WHERE external_id LIKE 'eval-%'");
    await tx.query('DELETE FROM usage_events WHERE "timestamp" >= $1', [started]);
    await tx.query("DELETE FROM event_outbox WHERE created_at >= $1", [started]);
    await tx.query("DELETE FROM unanswered_questions WHERE first_seen >= $1", [started]);
  });
  await pool.end();
  process.exit(gates.every(([, , ok]) => ok) && results.every((r) => !r.error) ? 0 : 1);
}
await main();
