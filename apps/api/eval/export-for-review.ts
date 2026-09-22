// Exports every Urdu / Roman Urdu eval question into a plain CSV for a native speaker to review — no code or
// terminal needed, just Excel/Sheets. PRD Section 5: "Urdu and Roman Urdu questions are written or reviewed by a
// native speaker, including spelling variants."
//   pnpm --filter @uaa/api eval:review
// Output: eval/review/native-speaker-review.csv
// Reviewer fills in ok (yes/no) and, for "no", a corrected version in fixed_text; notes is free text (e.g. flagging
// an unnatural spelling variant). Re-import with eval/apply-review.ts once done (see that file's header).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { EvalCase } from "./build-dataset.js";

const here = dirname(fileURLToPath(import.meta.url));
const csvCell = (v: string) => `"${v.replace(/"/g, '""')}"`;

const rows: string[] = [["id", "tenant", "category", "script", "turn_1", "turn_2", "turn_3", "ok(yes/no)", "fixed_text", "notes"].map(csvCell).join(",")];
let total = 0;
for (const tenant of ["crescent-valley", "nexora"]) {
  const cases: EvalCase[] = readFileSync(join(here, "datasets", `${tenant}.jsonl`), "utf-8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  for (const c of cases) {
    if (c.review !== "needs_native_review") continue;
    total++;
    const [t1, t2, t3] = c.turns;
    rows.push([c.id, c.tenant, c.category, c.script, t1 ?? "", t2 ?? "", t3 ?? "", "", "", ""].map(csvCell).join(","));
  }
}

const outDir = join(here, "review");
mkdirSync(outDir, { recursive: true });
const outFile = join(outDir, "native-speaker-review.csv");
// UTF-8 BOM so Excel opens Urdu/Roman Urdu correctly instead of mangling it as another codepage.
writeFileSync(outFile, "﻿" + rows.join("\r\n") + "\r\n", "utf-8");
console.log(`wrote ${total} rows needing native-speaker review to ${outFile}`);
console.log(`(${total} of ${112} total eval cases; the rest are English, already machine-reviewable)`);
