import type { Tx } from "./db.js";

export async function acceptStaffInvite(tx: Tx, tokenHash: string, authUserId: string) {
  const row = (await tx.query(`SELECT out_tenant_id, out_tenant_name, out_role FROM accept_staff_invite($1, $2)`, [tokenHash, authUserId])).rows[0] as
    { out_tenant_id: string; out_tenant_name: string; out_role: string } | undefined;
  return row ? { tenant_id: row.out_tenant_id, tenant_name: row.out_tenant_name, role: row.out_role } : null;
}
