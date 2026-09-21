import type { Tx } from "../db.js";

// lookup_facts (PRD Section 5): exact facts straight from PostgreSQL, APPROVED rows only, never from model memory.
// Every fact carries last_verified_at, and computed fields (days remaining, deadline passed, credit-hour totals) are
// produced HERE so the model never does arithmetic. Runs inside withTenant(), so RLS scopes every query.

export type Topic = "programs" | "fees" | "intakes" | "requirements" | "scholarships" | "campuses" | "faculties";
export interface FactsArgs { topic: Topic; program?: string; campus?: string; student_type?: "local" | "international"; item_type?: "tuition" | "admission" | "hostel" | "other"; credit_hours?: number }
export type FactsResult = { status: "ok" | "no_data" | "needs_clarification"; topic: Topic; today: string; [k: string]: unknown };

const DAY = 86_400_000;
const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / DAY);
const iso = (d: unknown) => (d instanceof Date ? d.toISOString().slice(0, 10) : d ? String(d).slice(0, 10) : null);
const money = (n: number) => Math.round(n * 100) / 100;

interface ProgramRow { id: string; name: string; code: string | null; degree_level: string; total_credit_hours: number | null; faculty: string | null }

async function findPrograms(tx: Tx, query: string): Promise<ProgramRow[]> {
  const q = query.trim();
  const { rows } = await tx.query(
    `SELECT p.id, p.name, p.code, p.degree_level, p.total_credit_hours, f.name AS faculty
       FROM programs p LEFT JOIN faculties f ON f.tenant_id = p.tenant_id AND f.id = p.faculty_id AND f.status = 'approved'
      WHERE p.status = 'approved' AND (lower(p.code) = lower($1) OR lower(p.name) = lower($1) OR p.name ILIKE '%' || $1 || '%')
      ORDER BY (lower(p.code) = lower($1) OR lower(p.name) = lower($1)) DESC, p.name`, [q]);
  // An exact code/name match wins over partial matches ("BSCS" must not also return "MSCS").
  const exact = rows.filter((r) => r.code?.toLowerCase() === q.toLowerCase() || r.name.toLowerCase() === q.toLowerCase());
  return exact.length ? exact : rows;
}

const campusesOffering = async (tx: Tx, programId: string) =>
  (await tx.query(
    `SELECT c.id, c.name, c.city FROM program_campuses pc JOIN campuses c ON c.tenant_id = pc.tenant_id AND c.id = pc.campus_id
      WHERE pc.program_id = $1 AND c.status = 'approved' ORDER BY c.name`, [programId])).rows as { id: string; name: string; city: string }[];

export async function lookupFacts(tx: Tx, args: FactsArgs, today: string): Promise<FactsResult> {
  const base = { topic: args.topic, today };
  const staleAfter = (await tx.query("SELECT fee_stale_after_days FROM tenants")).rows[0]?.fee_stale_after_days ?? 90;

  // Resolve the program once for the topics that need it.
  let program: ProgramRow | undefined;
  if (args.program && ["fees", "intakes", "requirements", "programs"].includes(args.topic)) {
    const found = await findPrograms(tx, args.program);
    if (!found.length) return { ...base, status: "no_data", reason: "program_not_found" };
    if (found.length > 1 && args.topic !== "programs")
      return { ...base, status: "needs_clarification", ask: ["program"], options: { programs: found.map((p) => `${p.name} (${p.code ?? "no code"})`) } };
    if (found.length === 1) program = found[0];
    else if (args.topic === "programs") return { ...base, status: "ok", programs: await describePrograms(tx, found) };
  }

  switch (args.topic) {
    case "programs": {
      const rows = program ? [program] : ((await tx.query(
        `SELECT p.id, p.name, p.code, p.degree_level, p.total_credit_hours, f.name AS faculty FROM programs p
           LEFT JOIN faculties f ON f.tenant_id = p.tenant_id AND f.id = p.faculty_id AND f.status = 'approved'
          WHERE p.status = 'approved' ORDER BY p.name`)).rows as ProgramRow[]);
      return { ...base, status: rows.length ? "ok" : "no_data", programs: await describePrograms(tx, rows) };
    }

    case "campuses": {
      const rows = (await tx.query("SELECT name, city FROM campuses WHERE status = 'approved' ORDER BY name")).rows;
      return { ...base, status: rows.length ? "ok" : "no_data", campuses: rows };
    }

    case "faculties": {
      const rows = (await tx.query("SELECT name FROM faculties WHERE status = 'approved' ORDER BY name")).rows;
      return { ...base, status: rows.length ? "ok" : "no_data", faculties: rows };
    }

    case "requirements": {
      if (!program) return { ...base, status: "needs_clarification", ask: ["program"] };
      const rows = (await tx.query("SELECT eligibility, required_documents FROM requirements WHERE program_id = $1 AND status = 'approved'", [program.id])).rows;
      return { ...base, status: rows.length ? "ok" : "no_data", program: program.name, requirements: rows };
    }

    case "scholarships": {
      const rows = (await tx.query("SELECT name, criteria, coverage, conditions, deadline FROM scholarships WHERE status = 'approved' ORDER BY name")).rows;
      return {
        ...base, status: rows.length ? "ok" : "no_data",
        scholarships: rows.map((r) => {
          const deadline = iso(r.deadline);
          return { ...r, deadline, ...(deadline ? { deadline_passed: deadline < today, days_until_deadline: deadline >= today ? daysBetween(today, deadline) : null } : {}) };
        }),
      };
    }

    case "intakes": {
      const rows = (await tx.query(
        `SELECT i.intake_name, i.applications_open, i.application_deadline, i.test_date, i.classes_start, i.last_verified_at, p.name AS program
           FROM intakes i LEFT JOIN programs p ON p.tenant_id = i.tenant_id AND p.id = i.program_id
          WHERE i.status = 'approved' AND ($1::uuid IS NULL OR i.program_id IS NULL OR i.program_id = $1)
          ORDER BY i.application_deadline`, [program?.id ?? null])).rows;
      return {
        ...base, status: rows.length ? "ok" : "no_data",
        intakes: rows.map((r) => {
          const d = { applications_open: iso(r.applications_open), application_deadline: iso(r.application_deadline), test_date: iso(r.test_date), classes_start: iso(r.classes_start) };
          return {
            intake: r.intake_name, applies_to: r.program ?? "all programs", ...d, last_verified_at: iso(r.last_verified_at),
            deadline_passed: d.application_deadline ? d.application_deadline < today : null,
            days_until_deadline: d.application_deadline && d.application_deadline >= today ? daysBetween(today, d.application_deadline) : null,
            days_until_test: d.test_date && d.test_date >= today ? daysBetween(today, d.test_date) : null,
          };
        }),
      };
    }

    case "fees": {
      // "BSCS fee" means tuition; general items (hostel, admission, other) need an explicit item_type.
      const itemType = args.item_type ?? (program ? "tuition" : undefined);
      // Tuition differs by program, so a program is required; hostel/admission/other items may be general.
      if (!program && (!itemType || itemType === "tuition")) return { ...base, status: "needs_clarification", ask: ["program"], note: "Ask which program before quoting tuition." };
      // Campus filter (must be offered by the program if both are given).
      let campus: { id: string; name: string } | undefined;
      if (args.campus) {
        const c = (await tx.query("SELECT id, name FROM campuses WHERE status = 'approved' AND (name ILIKE '%' || $1 || '%' OR city ILIKE '%' || $1 || '%')", [args.campus])).rows;
        if (c.length !== 1) return { ...base, status: c.length ? "needs_clarification" : "no_data", ...(c.length ? { ask: ["campus"], options: { campuses: c.map((x) => x.name) } } : { reason: "campus_not_found" }) };
        campus = c[0];
        if (program && !(await campusesOffering(tx, program.id)).some((x) => x.id === campus!.id))
          return { ...base, status: "no_data", reason: "program_not_offered_at_campus", program: program.name, offered_at: (await campusesOffering(tx, program.id)).map((x) => x.name) };
      }
      const rows = (await tx.query(
        `SELECT fi.item_type, fi.amount, fi.currency, fi.per, fi.academic_year, fi.student_type, fi.effective_from, fi.last_verified_at, fi.note,
                c.name AS campus, p.name AS program
           FROM fee_items fi
           LEFT JOIN campuses c ON c.tenant_id = fi.tenant_id AND c.id = fi.campus_id
           LEFT JOIN programs p ON p.tenant_id = fi.tenant_id AND p.id = fi.program_id
          WHERE fi.status = 'approved'
            AND ($1::uuid IS NULL OR fi.program_id IS NULL OR fi.program_id = $1)
            AND ($2::uuid IS NULL OR fi.campus_id IS NULL OR fi.campus_id = $2)
            AND ($3::text IS NULL OR fi.student_type::text = $3)
            AND ($4::text IS NULL OR fi.item_type::text = $4)
            AND ($1::uuid IS NOT NULL OR fi.program_id IS NULL)
          ORDER BY fi.item_type, fi.academic_year DESC, c.name`, [program?.id ?? null, campus?.id ?? null, args.student_type ?? null, itemType ?? null])).rows;
      if (!rows.length) return { ...base, status: "no_data", reason: "no_fee_data", ...(program ? { program: program.name } : {}) };

      // Ask before quoting when several campuses / student types would give different amounts for the same item.
      const groups = new Map<string, typeof rows>();
      for (const r of rows) {
        const k = `${r.item_type}|${r.per}|${r.academic_year}|${r.program ?? ""}`;
        groups.set(k, [...(groups.get(k) ?? []), r]);
      }
      const ask = new Set<string>();
      const options: Record<string, string[]> = {};
      for (const g of groups.values()) {
        if (new Set(g.map((r) => Number(r.amount))).size < 2) continue;
        if (new Set(g.map((r) => r.campus ?? "")).size > 1) { ask.add("campus"); options.campuses = [...new Set(g.map((r) => r.campus).filter(Boolean))]; }
        if (new Set(g.map((r) => r.student_type)).size > 1) { ask.add("student_type"); options.student_types = [...new Set(g.map((r) => r.student_type))]; }
      }
      if (ask.size) return { ...base, status: "needs_clarification", ask: [...ask], options, note: "Amounts differ; ask the student which applies before quoting any figure." };

      const totalHours = program?.total_credit_hours ?? null;
      return {
        ...base, status: "ok",
        ...(program ? { program: program.name, program_total_credit_hours: totalHours } : {}),
        fees: rows.map((r) => {
          const verified = iso(r.last_verified_at);
          const amount = Number(r.amount);
          const perHour = r.per === "credit_hour";
          return {
            item: r.item_type, amount, currency: r.currency, per: r.per, academic_year: r.academic_year, student_type: r.student_type,
            campus: r.campus ?? "all campuses", applies_to: r.program ?? "all programs", effective_from: iso(r.effective_from),
            last_verified_at: verified, is_stale: verified ? daysBetween(verified, today) > staleAfter : true, ...(r.note ? { note: r.note } : {}),
            ...(perHour && args.credit_hours ? { credit_hours: args.credit_hours, computed_total: money(amount * args.credit_hours) } : {}),
            ...(perHour && totalHours ? { full_degree_credit_hours: totalHours, computed_full_degree_total: money(amount * totalHours) } : {}),
          };
        }),
      };
    }
  }
}

async function describePrograms(tx: Tx, rows: ProgramRow[]) {
  const out = [];
  for (const p of rows) // sequential: a single pooled client cannot run queries concurrently
    out.push({ name: p.name, code: p.code, level: p.degree_level, faculty: p.faculty, total_credit_hours: p.total_credit_hours, offered_at: (await campusesOffering(tx, p.id)).map((c) => `${c.name} (${c.city})`) });
  return out;
}
