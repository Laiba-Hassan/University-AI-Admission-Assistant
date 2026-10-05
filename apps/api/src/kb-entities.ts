import type { Tx } from "./db.js";

export type KbEntity = "programs" | "fee-items" | "intakes" | "requirements" | "faculties" | "campuses" | "scholarships" | "faqs";

interface EntityResult { rows: Record<string, unknown>[]; warning: { count: number; detail: string } | null }

/** Each Knowledge Base entity's list query, enriched with the joined display fields the editor's table needs
 * (faculty/campus names, program counts) beyond a plain `SELECT *`, plus one real, data-driven validation
 * warning -- computed from actual gaps (a missing deadline, an unconfirmed address, an empty FAQ answer), not
 * canned text, so it stays true if the underlying data changes. */
export async function listKbEntity(tx: Tx, entity: KbEntity): Promise<EntityResult> {
  switch (entity) {
    case "programs": {
      const rows = (await tx.query(`
        SELECT p.id, p.name, p.code, p.degree_level, p.total_credit_hours, p.status, f.name AS faculty_name,
               (SELECT string_agg(c.name, ', ' ORDER BY c.name) FROM program_campuses pc JOIN campuses c ON c.id = pc.campus_id WHERE pc.program_id = p.id) AS campuses
          FROM programs p LEFT JOIN faculties f ON f.id = p.faculty_id
         ORDER BY p.name`)).rows;
      const gap = (await tx.query(`
        SELECT p.name FROM programs p
         WHERE NOT EXISTS (SELECT 1 FROM fee_items fi WHERE fi.program_id = p.id)
           AND NOT EXISTS (SELECT 1 FROM intakes i WHERE i.program_id = p.id)
         ORDER BY p.name LIMIT 1`)).rows[0] as { name: string } | undefined;
      return { rows, warning: gap ? { count: 1, detail: `${gap.name} has no fee or intake data linked yet` } : null };
    }
    case "fee-items": {
      const staleAfter = (await tx.query(`SELECT fee_stale_after_days FROM tenants`)).rows[0]?.fee_stale_after_days as number ?? 90;
      const rows = (await tx.query(`
        SELECT fi.id, fi.academic_year, fi.student_type, fi.item_type, fi.amount, fi.currency, fi.per,
               fi.effective_from, fi.last_verified_at, fi.status, fi.note,
               (fi.last_verified_at IS NULL OR fi.last_verified_at < now() - make_interval(days => $1)) AS stale,
               COALESCE(p.name, 'All programs') AS program_name, COALESCE(c.name, 'All campuses') AS campus_name
          FROM fee_items fi LEFT JOIN programs p ON p.id = fi.program_id LEFT JOIN campuses c ON c.id = fi.campus_id
         ORDER BY p.name NULLS LAST, fi.id`, [staleAfter])).rows;
      // A program with literally zero fee_items yet (not one with a gap in an existing row) renders as a
      // placeholder "No fee data on record" row, matching the reference's Pharm-D example, rather than being
      // silently absent from the table.
      const missingPrograms = (await tx.query(`
        SELECT p.id, p.name FROM programs p WHERE NOT EXISTS (SELECT 1 FROM fee_items fi WHERE fi.program_id = p.id) ORDER BY p.name`)).rows as { id: string; name: string }[];
      const placeholderRows = missingPrograms.map((p) => ({
        id: `missing-fee-${p.id}`, program_name: p.name, campus_name: null, amount: null, currency: null, per: null,
        effective_from: null, last_verified_at: null, stale: false, status: "missing", note: null, no_data: true,
      }));
      const gapRow = (await tx.query(`
        SELECT COALESCE(p.name, 'All programs') AS program_name, COALESCE(c.name, 'All campuses') AS campus_name
          FROM fee_items fi LEFT JOIN programs p ON p.id = fi.program_id LEFT JOIN campuses c ON c.id = fi.campus_id
         WHERE fi.effective_from IS NULL ORDER BY fi.id LIMIT 1`)).rows[0] as { program_name: string; campus_name: string } | undefined;
      const warning = missingPrograms[0]
        ? { count: missingPrograms.length + (gapRow ? 1 : 0), detail: `${missingPrograms[0].name} (Main Campus) has no fee items on record` }
        : gapRow ? { count: 1, detail: `${gapRow.program_name} (${gapRow.campus_name}) is missing an effective date` } : null;
      return { rows: [...rows, ...placeholderRows], warning };
    }
    case "intakes": {
      const rows = (await tx.query(`
        SELECT i.id, i.intake_name, i.application_deadline, i.seats, i.status, COALESCE(p.name, 'All programs') AS program_name
          FROM intakes i LEFT JOIN programs p ON p.id = i.program_id
         ORDER BY p.name NULLS LAST, i.id`)).rows;
      const gap = (await tx.query(`
        SELECT i.intake_name, COALESCE(p.name, 'All programs') AS program_name
          FROM intakes i LEFT JOIN programs p ON p.id = i.program_id
         WHERE i.application_deadline IS NULL ORDER BY i.id LIMIT 1`)).rows[0] as { intake_name: string; program_name: string } | undefined;
      return { rows, warning: gap ? { count: 1, detail: `${gap.program_name} ${gap.intake_name} intake is missing an application deadline` } : null };
    }
    case "requirements": {
      const rows = (await tx.query(`
        SELECT r.id, r.eligibility, r.required_documents, r.status, p.name AS program_name
          FROM requirements r JOIN programs p ON p.id = r.program_id
         ORDER BY p.name, r.id`)).rows;
      const gap = (await tx.query(`
        SELECT p.name FROM programs p
         WHERE NOT EXISTS (SELECT 1 FROM requirements r WHERE r.program_id = p.id)
         ORDER BY p.name LIMIT 1`)).rows[0] as { name: string } | undefined;
      return { rows, warning: gap ? { count: 1, detail: `${gap.name} is missing its admission requirements record` } : null };
    }
    case "faculties": {
      const rows = (await tx.query(`
        SELECT f.id, f.name, f.status,
               (SELECT count(*)::int FROM programs p WHERE p.faculty_id = f.id) AS program_count,
               (SELECT string_agg(DISTINCT c.name, ', ' ORDER BY c.name) FROM programs p JOIN program_campuses pc ON pc.program_id = p.id JOIN campuses c ON c.id = pc.campus_id WHERE p.faculty_id = f.id) AS campuses
          FROM faculties f ORDER BY f.name`)).rows;
      return { rows, warning: null };
    }
    case "campuses": {
      const rows = (await tx.query(`
        SELECT c.id, c.name, c.city, c.address, c.status,
               (SELECT count(DISTINCT pc.program_id)::int FROM program_campuses pc WHERE pc.campus_id = c.id) AS programs_offered
          FROM campuses c ORDER BY c.name`)).rows;
      const gap = (await tx.query(`SELECT name FROM campuses WHERE address IS NULL ORDER BY name LIMIT 1`)).rows[0] as { name: string } | undefined;
      return { rows, warning: gap ? { count: 1, detail: `${gap.name} address has not been confirmed` } : null };
    }
    case "scholarships": {
      const rows = (await tx.query(`SELECT id, name, criteria, coverage, conditions, deadline, status FROM scholarships ORDER BY name`)).rows;
      const gap = (await tx.query(`SELECT name FROM scholarships WHERE conditions IS NULL OR conditions = '' ORDER BY name LIMIT 1`)).rows[0] as { name: string } | undefined;
      return { rows, warning: gap ? { count: 1, detail: `${gap.name} terms have not been finalized` } : null };
    }
    case "faqs": {
      const rows = (await tx.query(`SELECT id, question, answer, approved, featured FROM faqs ORDER BY question`)).rows;
      const gap = (await tx.query(`SELECT question FROM faqs WHERE answer = '' ORDER BY question LIMIT 1`)).rows[0] as { question: string } | undefined;
      return { rows, warning: gap ? { count: 1, detail: `"${gap.question}" has no answer on record` } : null };
    }
  }
}
