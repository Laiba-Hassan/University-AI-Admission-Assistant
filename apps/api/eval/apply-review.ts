// Re-imports a filled-in eval/review/native-speaker-review.csv back into the eval datasets:
//   pnpm --filter @uaa/api eval:apply-review
// For each row with ok=yes: marks the case review:"native_reviewed" (unchanged text).
// For each row with ok=no and a fixed_text for turn_1: replaces that case's first turn and marks it reviewed.
//   (Multi-turn cases with a correction needed on turn_2/turn_3 are rare here; edit datasets/*.jsonl directly for
//   those, then re-run eval:build only if you also want to regenerate the machine-derived cases.)
// Rows left blank (no ok value) are skipped and stay "needs_native_review".
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { EvalCase } from "./build-dataset.js";

const here = dirname(fileURLToPath(import.meta.url));
const csvFile = join(here, "review", "native-speaker-review.csv");

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", inQuotes = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (inQuotes) {
      if (c === '"' && s[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else cell += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && s[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.length > 1 || r[0]);
}

const [header, ...dataRows] = parseCsv(readFileSync(csvFile, "utf-8"));
const col = (name: string) => header!.indexOf(name);
const idxId = col("id"), idxOk = col("ok(yes/no)"), idxFixed = col("fixed_text");
if ([idxId, idxOk, idxFixed].includes(-1)) throw new Error("review CSV is missing expected columns");

let reviewed = 0, corrected = 0, skipped = 0;
for (const tenant of ["crescent-valley", "nexora"]) {
  const file = join(here, "datasets", `${tenant}.jsonl`);
  const cases: EvalCase[] = readFileSync(file, "utf-8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const byId = new Map(cases.map((c) => [c.id, c]));
  for (const row of dataRows) {
    const c = byId.get(row[idxId] ?? "");
    if (!c) continue;
    const ok = (row[idxOk] ?? "").trim().toLowerCase();
    if (ok === "yes") { c.review = "native_reviewed"; reviewed++; }
    else if (ok === "no") {
      const fixed = (row[idxFixed] ?? "").trim();
      if (fixed) { c.turns[0] = fixed; c.review = "native_reviewed"; reviewed++; corrected++; }
      else skipped++; // marked "no" but no replacement text given yet
    } else skipped++;
  }
  writeFileSync(file, cases.map((c) => JSON.stringify(c)).join("\n") + "\n");
}
console.log(`applied: ${reviewed - corrected} approved as-is, ${corrected} corrected, ${skipped} still need attention (${reviewed} total reviewed)`);
