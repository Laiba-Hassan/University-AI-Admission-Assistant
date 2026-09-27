// Phase 5 exit condition: "Stand up the second tenant (per-credit-hour fees, different programs, scholarships,
// and branding), loaded through the import template." This test is that proof -- it creates a brand-new tenant
// with nothing but a bare row, then builds up its entire academic catalog through the same public
// POST /api/v1/import/upload + /import/drafts/:id/review endpoints a real staff member would use, never by
// reaching into the database directly the way seed.ts does for the flagship/demo tenants.
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { createTenant, deleteTenants, staffToken, withOwner, type Fixture } from "./fixtures.js";

let A: Fixture, server: Server, base: string;
let db: typeof import("../src/db.js");

const asOwner = (t: Fixture, sql: string, params: unknown[] = []) => withOwner(async (c) => {
  await c.query("BEGIN"); await c.query("SELECT set_config('app.tenant_id', $1, true)", [t.id]);
  const r = await c.query(sql, params); await c.query("COMMIT"); return r.rows;
});
const auth = async () => ({ authorization: `Bearer ${await staffToken(A.authUserId)}` });
const post = async (path: string, body: unknown) =>
  fetch(`${base}${path}`, { method: "POST", headers: { ...(await auth()), "content-type": "application/json" }, body: JSON.stringify(body) });
const get = async (path: string) => fetch(`${base}${path}`, { headers: await auth() });
const patch = async (path: string, body: unknown) =>
  fetch(`${base}${path}`, { method: "PATCH", headers: { ...(await auth()), "content-type": "application/json" }, body: JSON.stringify(body) });

before(async () => {
  db = await import("../src/db.js");
  const { createApp } = await import("../src/app.js");
  // createTenant seeds one demo program/fee alongside the bare tenant row (fixture convenience, see fixtures.ts);
  // this test's own uploads are what actually stand up the tenant's real catalog, which is the point being proved.
  A = await withOwner((c) => createTenant(c, "SecondTenant", 1));
  server = createApp(async () => null).listen(0);
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  await asOwner(A, "UPDATE tenant_users SET role = 'admin' WHERE tenant_id = current_tenant_id()");
});
after(async () => { server.close(); await deleteTenants([A.id]); await db.pool.end(); });

async function uploadAndAcceptAll(target: string, format: "csv" | "json", content: string) {
  const upload = await post("/api/v1/import/upload", { target, format, content });
  assert.equal(upload.status, 201, `upload for ${target} failed`);
  const { batch_id, rejected } = (await upload.json()) as { batch_id: string; rejected: unknown[] };
  assert.deepEqual(rejected, [], `unexpected rejected rows for ${target}`);
  const drafts = (await (await get(`/api/v1/import/drafts?batch_id=${batch_id}`)).json()) as { data: { id: string }[] };
  for (const d of drafts.data) {
    const res = await post(`/api/v1/import/drafts/${d.id}/review`, { action: "accept" });
    assert.equal(res.status, 204, `accepting a ${target} draft failed`);
  }
  return drafts.data.length;
}

describe("Standing up a second tenant entirely through the import template", () => {
  it("loads different programs, per-credit-hour fees, and scholarships, then sets branding", async () => {
    const programsLoaded = await uploadAndAcceptAll("programs", "csv",
      "name,code,degree_level\nBS Software Engineering,BSSE,bachelor\nBS Artificial Intelligence,BSAI,bachelor");
    assert.equal(programsLoaded, 2);

    // Structurally different from the flagship tenant: per-credit-hour, not per-semester.
    const feesLoaded = await uploadAndAcceptAll("fee-items", "json", JSON.stringify([
      { program_code: "BSSE", academic_year: "2026-27", student_type: "local", item_type: "tuition", amount: 11000, currency: "PKR", per: "credit_hour" },
      { program_code: "BSAI", academic_year: "2026-27", student_type: "local", item_type: "tuition", amount: 13500, currency: "PKR", per: "credit_hour" },
    ]));
    assert.equal(feesLoaded, 2);

    const scholarshipsLoaded = await uploadAndAcceptAll("scholarships", "json", JSON.stringify([
      { name: "Founders Merit Award", criteria: "Top 5% in entry test", coverage: "up to 75%", conditions: "Renewed each semester" },
    ]));
    assert.equal(scholarshipsLoaded, 1);

    const brandingRes = await patch("/api/v1/settings/branding", { branding: { primary: "#1B4D3E", accent: "#E0A93C", tagline: "Begin something new." } });
    assert.equal(brandingRes.status, 204);

    // Prove it end to end by reading the real tables back, exactly as the Knowledge Base Editor would.
    const programs = await asOwner(A, "SELECT name, code, status FROM programs WHERE code IN ('BSSE','BSAI') ORDER BY code");
    assert.deepEqual(programs.map((p) => p.code), ["BSAI", "BSSE"]);
    assert.ok(programs.every((p) => p.status === "draft")); // imported records still need normal KB approval

    const fees = await asOwner(A, "SELECT amount::int AS amount, per FROM fee_items WHERE per = 'credit_hour' ORDER BY amount");
    assert.deepEqual(fees, [{ amount: 11000, per: "credit_hour" }, { amount: 13500, per: "credit_hour" }]);

    const scholarships = await asOwner(A, "SELECT name FROM scholarships WHERE name = 'Founders Merit Award'");
    assert.equal(scholarships.length, 1);

    const branding = await asOwner(A, "SELECT branding FROM tenants");
    assert.equal(branding[0]!.branding.tagline, "Begin something new.");
  });
});
