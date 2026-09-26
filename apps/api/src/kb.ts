import type { Tx } from "./db.js";

// Every Knowledge Base entity, and how "approved" is represented on it: most use the row_status enum, faqs uses
// a plain boolean. Centralized here so the route stays a thin dispatcher instead of hardcoding 8 near-duplicates.
export const KB_TABLES: Record<string, { table: string; kind: "row_status" | "boolean" }> = {
  programs: { table: "programs", kind: "row_status" },
  "fee-items": { table: "fee_items", kind: "row_status" },
  intakes: { table: "intakes", kind: "row_status" },
  requirements: { table: "requirements", kind: "row_status" },
  faculties: { table: "faculties", kind: "row_status" },
  campuses: { table: "campuses", kind: "row_status" },
  scholarships: { table: "scholarships", kind: "row_status" },
  faqs: { table: "faqs", kind: "boolean" },
};

export async function approveKbRow(tx: Tx, entity: string, id: string, staffTenantUserId: string | null) {
  const spec = KB_TABLES[entity];
  if (!spec) return null;
  const sql = spec.kind === "row_status"
    ? `UPDATE ${spec.table} SET status = 'approved' WHERE id = $1 RETURNING id`
    : `UPDATE ${spec.table} SET approved = true WHERE id = $1 RETURNING id`;
  const updated = await tx.query(sql, [id]);
  if (!updated.rowCount) return { approved: false };
  await tx.query(
    `INSERT INTO audit_logs (tenant_id, user_id, action, resource, metadata) VALUES (current_tenant_id(), $1, 'approved_draft', $2, $3)`,
    [staffTenantUserId, entity, JSON.stringify({ id })]);
  return { approved: true };
}

export async function listChangeHistory(tx: Tx, limit: number) {
  const rows = (await tx.query(
    `SELECT a.id, a."timestamp", a.action, a.resource, a.metadata, tu.email AS staff_email
     FROM audit_logs a LEFT JOIN tenant_users tu ON tu.id = a.user_id
     ORDER BY a."timestamp" DESC LIMIT $1`, [limit])).rows;
  return rows;
}
