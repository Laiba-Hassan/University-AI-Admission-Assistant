// Staff dashboard: Knowledge Base Editor approve action + Change History (Phase 5).
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { createTenant, deleteTenants, staffToken, withOwner, type Fixture } from "./fixtures.js";

let A: Fixture, server: Server, base: string;
let db: typeof import("../src/db.js");
let draftProgramId: string, draftFaqId: string;

const asOwner = (t: Fixture, sql: string, params: unknown[] = []) => withOwner(async (c) => {
  await c.query("BEGIN"); await c.query("SELECT set_config('app.tenant_id', $1, true)", [t.id]);
  const r = await c.query(sql, params); await c.query("COMMIT"); return r.rows;
});
const auth = async () => ({ authorization: `Bearer ${await staffToken(A.authUserId)}` });
const get = async (path: string) => fetch(`${base}${path}`, { headers: await auth() });
const post = async (path: string) => fetch(`${base}${path}`, { method: "POST", headers: await auth() });

before(async () => {
  db = await import("../src/db.js");
  const { createApp } = await import("../src/app.js");
  A = await withOwner((c) => createTenant(c, "Kb", 100_000));
  server = createApp(async () => null).listen(0);
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  await asOwner(A, "UPDATE tenant_users SET role = 'editor' WHERE tenant_id = current_tenant_id()");
  draftProgramId = (await asOwner(A, "INSERT INTO programs (tenant_id, name, code, degree_level, status) VALUES (current_tenant_id(), 'BS Data Science', 'BSDS', 'bachelor', 'draft') RETURNING id"))[0]!.id;
  draftFaqId = (await asOwner(A, "INSERT INTO faqs (tenant_id, question, answer, approved) VALUES (current_tenant_id(), 'Do you offer online classes?', 'No.', false) RETURNING id"))[0]!.id;
});
after(async () => { server.close(); await deleteTenants([A.id]); await db.pool.end(); });

describe("POST /api/v1/kb/:entity/:id/approve", () => {
  it("approves a row_status-based entity (programs)", async () => {
    const res = await post(`/api/v1/kb/programs/${draftProgramId}/approve`);
    assert.equal(res.status, 204);
    const row = await asOwner(A, "SELECT status FROM programs WHERE id = $1", [draftProgramId]);
    assert.equal(row[0]!.status, "approved");
  });

  it("approves a boolean-based entity (faqs) and records it in the change history", async () => {
    const res = await post(`/api/v1/kb/faqs/${draftFaqId}/approve`);
    assert.equal(res.status, 204);
    const row = await asOwner(A, "SELECT approved FROM faqs WHERE id = $1", [draftFaqId]);
    assert.equal(row[0]!.approved, true);

    const history = (await (await get("/api/v1/change-history")).json()) as { data: { action: string; resource: string; staff_email: string }[] };
    const entry = history.data.find((h) => h.resource === "faqs")!;
    assert.equal(entry.action, "approved_draft");
    assert.equal(entry.staff_email, A.email);
  });

  it("404s for an unknown entity name or id", async () => {
    assert.equal((await post(`/api/v1/kb/not-a-real-entity/${draftProgramId}/approve`)).status, 404);
    assert.equal((await post(`/api/v1/kb/programs/00000000-0000-0000-0000-000000000000/approve`)).status, 404);
  });

  it("a viewer cannot approve", async () => {
    await asOwner(A, "UPDATE tenant_users SET role = 'viewer' WHERE tenant_id = current_tenant_id()");
    assert.equal((await post(`/api/v1/kb/programs/${draftProgramId}/approve`)).status, 403);
    await asOwner(A, "UPDATE tenant_users SET role = 'editor' WHERE tenant_id = current_tenant_id()");
  });
});
