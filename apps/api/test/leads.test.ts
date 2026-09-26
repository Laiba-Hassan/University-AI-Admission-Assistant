// Staff dashboard: Leads list/filter/export/patch (Phase 5).
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { createTenant, deleteTenants, staffToken, withOwner, type Fixture } from "./fixtures.js";

let A: Fixture, server: Server, base: string;
let db: typeof import("../src/db.js");
let leadId: string;

const asOwner = (t: Fixture, sql: string, params: unknown[] = []) => withOwner(async (c) => {
  await c.query("BEGIN"); await c.query("SELECT set_config('app.tenant_id', $1, true)", [t.id]);
  const r = await c.query(sql, params); await c.query("COMMIT"); return r.rows;
});
const auth = async () => ({ authorization: `Bearer ${await staffToken(A.authUserId)}` });
const get = async (path: string) => fetch(`${base}${path}`, { headers: await auth() });
const patch = async (path: string, body: unknown) =>
  fetch(`${base}${path}`, { method: "PATCH", headers: { ...(await auth()), "content-type": "application/json" }, body: JSON.stringify(body) });

before(async () => {
  db = await import("../src/db.js");
  const { createApp } = await import("../src/app.js");
  A = await withOwner((c) => createTenant(c, "Leads", 100_000));
  server = createApp(async () => null).listen(0);
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  await asOwner(A, "UPDATE tenant_users SET role = 'editor' WHERE tenant_id = current_tenant_id()");
  const [contact] = await asOwner(A, "INSERT INTO contacts (tenant_id, channel, external_id) VALUES (current_tenant_id(), 'whatsapp', '923009998888') RETURNING id");
  leadId = (await asOwner(A, "INSERT INTO leads (tenant_id, contact_id, name, program_interest, source, status, consent) VALUES (current_tenant_id(), $1, 'Bilal Rehman', 'MBA', 'web', 'new', true) RETURNING id", [contact.id]))[0]!.id;
});
after(async () => { server.close(); await deleteTenants([A.id]); await db.pool.end(); });

describe("GET /api/v1/leads", () => {
  it("lists leads with assigned staff email joined in", async () => {
    const { data } = (await (await get("/api/v1/leads")).json()) as { data: { id: string; name: string; assigned_email: string | null }[] };
    const bilal = data.find((l) => l.id === leadId)!;
    assert.equal(bilal.name, "Bilal Rehman");
    assert.equal(bilal.assigned_email, null);
  });
  it("filters by status and search", async () => {
    const byStatus = (await (await get("/api/v1/leads?status=enrolled")).json()) as { data: unknown[] };
    assert.equal(byStatus.data.length, 0);
    const bySearch = (await (await get("/api/v1/leads?search=Bilal")).json()) as { data: { id: string }[] };
    assert.deepEqual(bySearch.data.map((l) => l.id), [leadId]);
  });
});

describe("GET /api/v1/leads/export.csv", () => {
  it("returns a CSV with a header row and the lead's data", async () => {
    const res = await get("/api/v1/leads/export.csv");
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type")!, /text\/csv/);
    const text = await res.text();
    assert.match(text, /^Name,Contact,Program Interest,Source,Status,Created/);
    assert.match(text, /Bilal Rehman/);
  });
});

describe("PATCH /api/v1/leads/:id", () => {
  it("updates status and self-assigns", async () => {
    const res = await patch(`/api/v1/leads/${leadId}`, { status: "contacted", assign_to_me: true });
    assert.equal(res.status, 204);
    const row = await asOwner(A, "SELECT l.status, tu.email FROM leads l JOIN tenant_users tu ON tu.id = l.assigned_to WHERE l.id = $1", [leadId]);
    assert.equal(row[0]!.status, "contacted");
    assert.equal(row[0]!.email, A.email);
  });
  it("404s for another tenant's lead id", async () => {
    const [B] = await withOwner(async (c) => [await createTenant(c, "LeadsOther", 50_000)]);
    assert.equal((await patch(`/api/v1/leads/${B.ids["leads"]}`, { status: "enrolled" })).status, 404);
    await deleteTenants([B.id]);
  });
});
