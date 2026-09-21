// Quick manual probe: pnpm --filter @uaa/api exec tsx --env-file=../../.env eval/try.ts crescent-valley "question 1" "question 2"
import { randomUUID } from "node:crypto";
import { handleMessage } from "../src/agent/conversation.js";
import { pool } from "../src/db.js";
import { tenantIdFor } from "../src/seed/seed.js";

const [tenant, ...questions] = process.argv.slice(2);
const session = randomUUID().replace(/-/g, "").slice(0, 20);
for (const q of questions) {
  const t0 = Date.now();
  const out = await handleMessage({ tenantId: tenantIdFor(tenant!), channel: "web", externalId: session, text: q, today: "2026-09-20" });
  console.log(`\nQ: ${q}\nA [${out.status}/${out.language}, ${Date.now() - t0}ms]: ${out.reply}`);
  console.log(`   tools: ${out.debug?.toolTrace.map((t) => `${t.name}(${JSON.stringify(t.args)})=${t.status}`).join(" | ") || "none"}`);
  if (out.debug && (!out.debug.verdict.ok || out.debug.unanswered.length)) console.log(`   verifier: ${JSON.stringify(out.debug.verdict.unsupported.map((u) => u.raw))} unanswered: ${out.debug.unanswered}`);
  if (out.cards.length) console.log(`   cards: ${JSON.stringify(out.cards)}`);
}
await pool.end();
