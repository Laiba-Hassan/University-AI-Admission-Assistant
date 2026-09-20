// Phase 1 exit-condition check: "Clean /data folder ready to seed".
// Validates shapes (zod), referential integrity, and that the flagship dataset really contains the
// hard cases required by PRD Section 1.1. Run: pnpm validate:data
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { TenantFile, Faculty, Campus, Program, FeeItem, Intake, Requirement, Scholarship, Faq } from "./schemas.js";

const DATA = join(dirname(fileURLToPath(import.meta.url)), "../../../data");
const TODAY = "2026-09-20"; // fixed "demo today" so the passed-deadline case is deterministic
const errors: string[] = [];
const fail = (m: string) => errors.push(m);

const load = <T extends z.ZodTypeAny>(tenant: string, file: string, schema: T): z.infer<T> => {
  const raw = JSON.parse(readFileSync(join(DATA, tenant, file), "utf-8"));
  const r = schema.safeParse(raw);
  if (!r.success) {
    for (const i of r.error.issues) fail(`${tenant}/${file}: ${i.path.join(".")}: ${i.message}`);
    return raw;
  }
  return r.data;
};

const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

function checkTenant(tenant: string, flagship: boolean) {
  const t = load(tenant, "tenant.json", TenantFile);
  const faculties = load(tenant, "faculties.json", z.array(Faculty));
  const campuses = load(tenant, "campuses.json", z.array(Campus));
  const programs = load(tenant, "programs.json", z.array(Program));
  const fees = load(tenant, "fee_items.json", z.array(FeeItem));
  const intakes = load(tenant, "intakes.json", z.array(Intake));
  const reqs = load(tenant, "requirements.json", z.array(Requirement));
  const schol = load(tenant, "scholarships.json", z.array(Scholarship));
  const faqs = load(tenant, "faqs.json", z.array(Faq));

  const facKeys = new Set(faculties.map((f) => f.key));
  const campKeys = new Set(campuses.map((c) => c.key));
  const progKeys = new Set(programs.map((p) => p.key));
  for (const p of programs) {
    if (!facKeys.has(p.faculty)) fail(`${tenant}: program ${p.key} -> unknown faculty ${p.faculty}`);
    for (const c of p.campuses) if (!campKeys.has(c)) fail(`${tenant}: program ${p.key} -> unknown campus ${c}`);
  }
  for (const f of fees) {
    if (f.program && !progKeys.has(f.program)) fail(`${tenant}: ${f.key} -> unknown program ${f.program}`);
    if (f.campus && !campKeys.has(f.campus)) fail(`${tenant}: ${f.key} -> unknown campus ${f.campus}`);
    if (f.program && f.campus) {
      const p = programs.find((x) => x.key === f.program)!;
      if (!p.campuses.includes(f.campus)) fail(`${tenant}: ${f.key} prices ${f.program} at a campus that does not offer it`);
    }
  }
  const seenFee = new Set<string>();
  for (const f of fees) {
    const id = [f.program, f.campus, f.academic_year, f.student_type, f.item_type, f.per].join("|");
    if (seenFee.has(id)) fail(`${tenant}: duplicate fee item ${id}`);
    seenFee.add(id);
  }
  for (const r of reqs) if (!progKeys.has(r.program)) fail(`${tenant}: requirement -> unknown program ${r.program}`);
  for (const p of programs) if (!reqs.some((r) => r.program === p.key)) fail(`${tenant}: program ${p.key} has no requirements row`);

  // documents: front matter + non-trivial body
  const docDir = join(DATA, tenant, "documents");
  const docs = existsSync(docDir) ? readdirSync(docDir).filter((f) => f.endsWith(".md")) : [];
  for (const d of docs) {
    const s = readFileSync(join(docDir, d), "utf-8");
    if (!/^---\ntitle: .+\nsource_type: .+\napproved: (true|false)\n---\n/.test(s.replace(/\r\n/g, "\n"))) fail(`${tenant}/documents/${d}: bad front matter`);
    if (s.length < 300) fail(`${tenant}/documents/${d}: suspiciously short`);
  }

  const counts = `${faculties.length} faculties, ${programs.length} programs, ${campuses.length} campuses, ${fees.length} fee items, ${intakes.length} intakes, ${schol.length} scholarships, ${faqs.length} FAQs, ${docs.length} documents`;
  console.log(`${tenant}: ${counts}`);

  if (flagship) {
    const within = (n: number, lo: number, hi: number, what: string) => { if (n < lo || n > hi) fail(`${tenant}: ${what} = ${n}, PRD target ${lo}-${hi}`); };
    within(faculties.length, 3, 3, "faculties");
    within(programs.length, 12, 15, "programs");
    within(campuses.length, 2, 2, "campuses");
    within(fees.length, 25, 30, "fee items");
    within(intakes.length, 3, 3, "intakes");
    within(schol.length, 6, 6, "scholarships");
    within(faqs.length, 28, 35, "FAQs (~30)");
    within(docs.length, 9, 12, "documents (~10)");

    // PRD 1.1 hard cases
    const tuitionByCampus = (code: string) => new Set(fees.filter((f) => f.program === programs.find((p) => p.code === code)!.key && f.item_type === "tuition" && f.student_type === "local").map((f) => `${f.campus}:${f.amount}`));
    const bscs = tuitionByCampus("BSCS");
    if (bscs.size < 2) fail("hard case: a program with different fees on two campuses (BSCS) is missing");
    const bscsKey = programs.find((p) => p.code === "BSCS")!.key;
    const types = new Set(fees.filter((f) => f.program === bscsKey && f.item_type === "tuition").map((f) => f.student_type));
    if (!(types.has("local") && types.has("international"))) fail("hard case: local + international tuition for the same program is missing");
    const pers = new Set(fees.map((f) => f.per));
    for (const p of ["semester", "year", "one-time"] as const) if (!pers.has(p)) fail(`hard case: fee frequency '${p}' missing`);
    const noFee = programs.filter((p) => !fees.some((f) => f.program === p.key && f.item_type === "tuition"));
    if (noFee.length < 1) fail("hard case: a program with no fee data is missing");
    else console.log(`  hard case ok: program with no fee data -> ${noFee.map((p) => p.code).join(", ")}`);
    if (!intakes.some((i) => i.application_deadline < TODAY)) fail("hard case: an intake with a passed deadline is missing");
    const stale = fees.filter((f) => daysBetween(f.last_verified_at, TODAY) > t.fee_stale_after_days);
    if (stale.length < 1) fail("hard case: a fee with an old last_verified_at is missing");
    else console.log(`  hard case ok: ${stale.length} stale fee item(s): ${stale.map((f) => f.key).join(", ")}`);
    const text = JSON.stringify(schol).toLowerCase();
    for (const kw of ["marks|score", "sibling", "income"]) if (!new RegExp(kw).test(text)) fail(`hard case: scholarship condition '${kw}' missing`);
    const scholDoc = readFileSync(join(docDir, "03-scholarships-explained.md"), "utf-8");
    for (const s of schol) if (!scholDoc.includes(s.name)) fail(`hard case: scholarship "${s.name}" has no narrative in the RAG documents`);
  } else {
    if (!fees.some((f) => f.per === "credit_hour")) fail(`${tenant}: second tenant must use per-credit-hour fees`);
    console.log("  structural difference ok: per-credit-hour fees");
  }
  return { programs, fees };
}

const cvu = checkTenant("crescent-valley", true);
const nexora = checkTenant("nexora", false);

// Multi-tenant acceptance test precondition: same program code, different fee answer.
const tuition = (x: { programs: z.infer<typeof Program>[]; fees: z.infer<typeof FeeItem>[] }) => {
  const k = x.programs.find((p) => p.code === "BSCS")?.key;
  return x.fees.filter((f) => f.program === k && f.item_type === "tuition" && f.student_type === "local").map((f) => `${f.amount} ${f.currency}/${f.per}`);
};
if (JSON.stringify(tuition(cvu)) === JSON.stringify(tuition(nexora))) fail("BSCS local tuition must differ between tenants (multi-tenant acceptance test)");
else console.log(`multi-tenant precondition ok: BSCS -> Crescent Valley ${tuition(cvu).join(" / ")} vs Nexora ${tuition(nexora).join(" / ")}`);

if (errors.length) {
  console.error(`\n${errors.length} problem(s):\n - ` + errors.join("\n - "));
  process.exit(1);
}
console.log("\nData validation: ALL CHECKS PASSED");
