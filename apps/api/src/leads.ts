import type { Tx } from "./db.js";

export interface LeadFilters { status?: "new" | "contacted" | "enrolled"; search?: string; limit: number }

export async function listLeads(tx: Tx, f: LeadFilters) {
  const where: string[] = [];
  const params: unknown[] = [];
  const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
  if (f.status) where.push(`l.status = ${p(f.status)}`);
  if (f.search) where.push(`(l.name ILIKE ${p(`%${f.search}%`)} OR l.program_interest ILIKE ${p(`%${f.search}%`)})`);

  const sql = `
    SELECT l.id, l.tenant_id, l.name, l.contact, l.program_interest, l.source, l.status, l.consent, l.notes, l.created_at,
      tu.email AS assigned_email
    FROM leads l LEFT JOIN tenant_users tu ON tu.id = l.assigned_to
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY l.created_at DESC LIMIT ${p(f.limit)}`;
  return (await tx.query(sql, params)).rows;
}

export async function updateLead(tx: Tx, id: string, patch: { status?: string; notes?: string; assignToSelf?: string }) {
  if (patch.status) await tx.query(`UPDATE leads SET status = $1 WHERE id = $2`, [patch.status, id]);
  if (patch.notes !== undefined) await tx.query(`UPDATE leads SET notes = $1 WHERE id = $2`, [patch.notes, id]);
  if (patch.assignToSelf) {
    const staffRow = (await tx.query(`SELECT id FROM tenant_users WHERE auth_user_id = $1`, [patch.assignToSelf])).rows[0] as { id: string } | undefined;
    if (staffRow) await tx.query(`UPDATE leads SET assigned_to = $1 WHERE id = $2`, [staffRow.id, id]);
  }
  const row = (await tx.query(`SELECT id FROM leads WHERE id = $1`, [id])).rows[0];
  return !!row;
}

function csvEscape(v: unknown) {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export function leadsToCsv(rows: { name: string | null; contact: string | null; program_interest: string | null; source: string | null; status: string; created_at: Date }[]) {
  const header = ["Name", "Contact", "Program Interest", "Source", "Status", "Created"];
  const lines = rows.map((r) => [r.name, r.contact, r.program_interest, r.source, r.status, new Date(r.created_at).toISOString()].map(csvEscape).join(","));
  return [header.join(","), ...lines].join("\n");
}
