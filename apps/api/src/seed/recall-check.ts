// Embedding bake-off check (Phase 1 decision, run in Phase 2): recall@3 of the Urdu / Roman Urdu / English test
// queries against Crescent Valley's knowledge chunks, measured AFTER the tenant filter, split by script.
// Only queries whose expected answer lives in the knowledge base (faq / document) are scored; "fact" queries are
// answered by lookup_facts from structured tables, and "none" queries test refusals in Phase 3.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { withTenant, pool } from "../db.js";
import { searchKnowledge } from "../knowledge.js";
import { tenantIdFor } from "./seed.js";

interface Query { id: string; script: string; text: string; expects: { kind: string; ref: string } }
const file = join(dirname(fileURLToPath(import.meta.url)), "../../../../data/bakeoff/queries.jsonl");
const queries: Query[] = readFileSync(file, "utf-8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const scored = queries.filter((q) => q.expects.kind === "faq" || q.expects.kind === "document");

const bucket: Record<string, { hit: number; total: number }> = {};
const misses: string[] = [];
const tenant = tenantIdFor("crescent-valley");
for (const q of scored) {
  const hits = await withTenant(tenant, (tx) => searchKnowledge(tx, q.text, 3));
  const ok = hits.some((h) => (q.expects.kind === "faq" ? h.metadata.faq_question === q.expects.ref : h.title === q.expects.ref));
  for (const key of [q.script, "all"]) {
    bucket[key] ??= { hit: 0, total: 0 };
    bucket[key].total++;
    if (ok) bucket[key].hit++;
  }
  if (!ok) misses.push(`${q.id} [${q.script}] "${q.text}" -> expected ${q.expects.ref}; got ${hits.map((h) => h.title).join(" | ")}`);
}
for (const [k, v] of Object.entries(bucket)) console.log(`${k.padEnd(11)} recall@3 = ${v.hit}/${v.total} (${Math.round((100 * v.hit) / v.total)}%)`);
console.log(`scored ${scored.length} of ${queries.length} queries (rest are fact/none kinds)`);
if (misses.length) console.log("\nmisses:\n" + misses.join("\n"));
await pool.end();
