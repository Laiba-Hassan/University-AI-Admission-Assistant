import { z } from "zod";
import type { Tx } from "./db.js";

// Phase 5: CSV/JSON bulk import with row-level validation, staged as drafts (import_batches/import_drafts) --
// nothing reaches a real table until a staff member reviews and accepts each row (PRD: "Records land as drafts
// ... until approved", the same rule the later AI-assisted import in Phase 7 also has to follow).
export type ImportTarget = "programs" | "fee-items" | "faqs" | "scholarships" | "intakes" | "requirements" | "faculties" | "campuses";

const SCHEMAS: Record<ImportTarget, z.ZodTypeAny> = {
  programs: z.object({
    name: z.string().min(1), code: z.string().min(1).optional(),
    degree_level: z.enum(["diploma", "bachelor", "master", "doctorate"]),
  }),
  "fee-items": z.object({
    program_code: z.string().min(1), academic_year: z.string().min(1),
    student_type: z.enum(["local", "international"]), item_type: z.enum(["tuition", "admission", "hostel", "other"]),
    amount: z.coerce.number().nonnegative(), currency: z.string().length(3),
    per: z.enum(["semester", "year", "one-time", "credit_hour"]),
  }),
  faqs: z.object({ question: z.string().min(1), answer: z.string().min(1) }),
  scholarships: z.object({
    name: z.string().min(1), criteria: z.string().optional(), coverage: z.string().optional(), conditions: z.string().optional(),
  }),
  intakes: z.object({
    program_code: z.string().min(1), intake_name: z.string().min(1),
    application_deadline: z.string().min(1).optional(), seats: z.coerce.number().int().positive().optional(),
  }),
  requirements: z.object({
    program_code: z.string().min(1), eligibility: z.string().optional(), required_documents: z.string().optional(),
  }).refine((v) => v.eligibility || v.required_documents, { message: "at least one of eligibility/required_documents is required" }),
  faculties: z.object({ name: z.string().min(1) }),
  campuses: z.object({ name: z.string().min(1), city: z.string().optional(), address: z.string().optional() }),
};

/** Minimal RFC-4180-ish CSV parser: quoted fields, escaped quotes ("") and commas inside quotes. Good enough for
 * the university-provided template this feature targets, not a general-purpose CSV library replacement. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let field = "", row: string[] = [], inQuotes = false;
  const pushField = () => { row.push(field); field = ""; };
  const pushRow = () => { pushField(); rows.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") pushField();
    else if (c === "\n") { if (field || row.length) pushRow(); }
    else if (c !== "\r") field += c;
  }
  if (field || row.length) pushRow();
  if (rows.length === 0) return [];
  const header = rows[0]!.map((h) => h.trim());
  return rows.slice(1).filter((r) => r.some((v) => v.trim() !== "")).map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? "").trim()])));
}

export interface StagedRow { row: number; ok: boolean; payload?: Record<string, unknown>; errors?: string[] }

export function validateRows(target: ImportTarget, rows: Record<string, string>[]): StagedRow[] {
  const schema = SCHEMAS[target];
  return rows.map((raw, i) => {
    const result = schema.safeParse(raw);
    return result.success ? { row: i + 1, ok: true, payload: result.data as Record<string, unknown> } : { row: i + 1, ok: false, errors: result.error.issues.map((e) => `${e.path.join(".")}: ${e.message}`) };
  });
}

export async function createImportBatch(tx: Tx, sourceType: "csv" | "json", target: ImportTarget, staged: StagedRow[], createdBy: string | null) {
  const batch = (await tx.query(`INSERT INTO import_batches (tenant_id, source_type, created_by) VALUES (current_tenant_id(), $1, $2) RETURNING id`, [sourceType, createdBy])).rows[0] as { id: string };
  for (const s of staged) {
    if (!s.ok) continue; // invalid rows are reported back immediately, never staged as a draft to review
    await tx.query(`INSERT INTO import_drafts (tenant_id, batch_id, target_table, payload) VALUES (current_tenant_id(), $1, $2, $3)`, [batch.id, target, JSON.stringify(s.payload)]);
  }
  return batch.id;
}

export async function listImportDrafts(tx: Tx, batchId?: string) {
  return (await tx.query(
    `SELECT d.id, d.batch_id, d.target_table, d.payload, d.review_status, b.source_type, b.created_at
     FROM import_drafts d JOIN import_batches b ON b.id = d.batch_id
     ${batchId ? "WHERE d.batch_id = $1" : "WHERE d.review_status = 'pending'"}
     ORDER BY b.created_at DESC`, batchId ? [batchId] : []).then((r) => r.rows));
}

const TARGET_INSERT: Record<ImportTarget, (tx: Tx, p: Record<string, unknown>) => Promise<void>> = {
  programs: async (tx, p) => {
    await tx.query(`INSERT INTO programs (tenant_id, name, code, degree_level, status) VALUES (current_tenant_id(), $1, $2, $3, 'draft')`, [p.name, p.code ?? null, p.degree_level]);
  },
  "fee-items": async (tx, p) => {
    const program = (await tx.query(`SELECT id FROM programs WHERE code = $1`, [p.program_code])).rows[0] as { id: string } | undefined;
    if (!program) throw new Error(`No program with code ${p.program_code as string} -- import its program row first`);
    await tx.query(
      `INSERT INTO fee_items (tenant_id, program_id, academic_year, student_type, item_type, amount, currency, per, status)
       VALUES (current_tenant_id(), $1, $2, $3, $4, $5, $6, $7, 'draft')`,
      [program.id, p.academic_year, p.student_type, p.item_type, p.amount, p.currency, p.per]);
  },
  faqs: async (tx, p) => { await tx.query(`INSERT INTO faqs (tenant_id, question, answer, approved) VALUES (current_tenant_id(), $1, $2, false)`, [p.question, p.answer]); },
  scholarships: async (tx, p) => {
    await tx.query(`INSERT INTO scholarships (tenant_id, name, criteria, coverage, conditions, status) VALUES (current_tenant_id(), $1, $2, $3, $4, 'draft')`,
      [p.name, p.criteria ?? null, p.coverage ?? null, p.conditions ?? null]);
  },
  intakes: async (tx, p) => {
    const program = (await tx.query(`SELECT id FROM programs WHERE code = $1`, [p.program_code])).rows[0] as { id: string } | undefined;
    if (!program) throw new Error(`No program with code ${p.program_code as string} -- import its program row first`);
    await tx.query(
      `INSERT INTO intakes (tenant_id, program_id, intake_name, application_deadline, seats, status) VALUES (current_tenant_id(), $1, $2, $3, $4, 'draft')`,
      [program.id, p.intake_name, p.application_deadline ?? null, p.seats ?? null]);
  },
  requirements: async (tx, p) => {
    const program = (await tx.query(`SELECT id FROM programs WHERE code = $1`, [p.program_code])).rows[0] as { id: string } | undefined;
    if (!program) throw new Error(`No program with code ${p.program_code as string} -- import its program row first`);
    await tx.query(
      `INSERT INTO requirements (tenant_id, program_id, eligibility, required_documents, status) VALUES (current_tenant_id(), $1, $2, $3, 'draft')`,
      [program.id, p.eligibility ?? null, p.required_documents ?? null]);
  },
  faculties: async (tx, p) => { await tx.query(`INSERT INTO faculties (tenant_id, name, status) VALUES (current_tenant_id(), $1, 'draft')`, [p.name]); },
  campuses: async (tx, p) => {
    await tx.query(`INSERT INTO campuses (tenant_id, name, city, address, status) VALUES (current_tenant_id(), $1, $2, $3, 'draft')`, [p.name, p.city ?? null, p.address ?? null]);
  },
};

export async function reviewImportDraft(tx: Tx, id: string, action: "accept" | "reject", reviewerId: string | null, editedPayload?: Record<string, unknown>) {
  const draft = (await tx.query(`SELECT target_table, payload FROM import_drafts WHERE id = $1 AND review_status = 'pending'`, [id])).rows[0] as
    { target_table: ImportTarget; payload: Record<string, unknown> } | undefined;
  if (!draft) return { ok: false, error: "not_found" as const };

  if (action === "reject") {
    await tx.query(`UPDATE import_drafts SET review_status = 'rejected', reviewed_by = $1 WHERE id = $2`, [reviewerId, id]);
    return { ok: true };
  }
  const payload = editedPayload ?? draft.payload;
  const schema = SCHEMAS[draft.target_table];
  const revalidated = schema.safeParse(payload);
  if (!revalidated.success) return { ok: false, error: "invalid_edit" as const, issues: revalidated.error.issues.map((e) => e.message) };
  try {
    await TARGET_INSERT[draft.target_table](tx, revalidated.data as Record<string, unknown>);
  } catch (err) {
    return { ok: false, error: "insert_failed" as const, message: err instanceof Error ? err.message : String(err) };
  }
  await tx.query(`UPDATE import_drafts SET review_status = $1, reviewed_by = $2, payload = $3 WHERE id = $4`, [editedPayload ? "edited" : "accepted", reviewerId, JSON.stringify(payload), id]);
  return { ok: true };
}
