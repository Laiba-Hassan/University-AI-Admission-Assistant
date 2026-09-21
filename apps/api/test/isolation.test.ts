// PRD Section 3 "Mandatory Security Acceptance Test", at the API layer:
// create Tenant A and Tenant B with their own data, authenticate as A, expect only A's records, probe B's records
// by id and expect them to be invisible, for every tenant-owned resource, plus widget/session tenant resolution.
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { createTenant, deleteTenants, staffToken, vec, withOwner, type Fixture } from "./fixtures.js";

let A: Fixture, B: Fixture, server: Server, base: string;
let db: typeof import("../src/db.js");
let searchByVector: typeof import("../src/knowledge.js").searchByVector;

const get = (path: string, headers: Record<string, string> = {}) => fetch(`${base}${path}`, { headers });
const as = async (f: Fixture, extra: Record<string, string> = {}) => ({ authorization: `Bearer ${await staffToken(f.authUserId)}`, ...extra });

before(async () => {
  db = await import("../src/db.js");
  ({ searchByVector } = await import("../src/knowledge.js"));
  const { createApp } = await import("../src/app.js");
  [A, B] = await withOwner(async (c) => [await createTenant(c, "Alpha", 100_000), await createTenant(c, "Beta", 250_000)]);
  server = createApp(async () => null).listen(0);
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

after(async () => {
  server.close();
  await deleteTenants([A.id, B.id]);
  await db.pool.end();
});

describe("database role", () => {
  it("connects as a role that cannot bypass RLS", async () => { await db.assertRestrictedRole(); });
});

const RESOURCES = ["programs", "fee-items", "contacts", "conversations", "messages", "leads", "usage-events", "channel-connections", "knowledge-documents", "knowledge-chunks"];

describe("staff session: Tenant A sees only Tenant A", () => {
  for (const resource of RESOURCES) {
    it(`${resource}: list contains only A's rows`, async () => {
      const res = await get(`/api/v1/${resource}`, await as(A));
      assert.equal(res.status, 200);
      const { data } = (await res.json()) as { data: { id: string | number; tenant_id: string }[] };
      assert.ok(data.length >= 1, "A's own row is visible");
      assert.ok(data.every((r) => r.tenant_id === A.id), "no foreign rows");
      assert.ok(!data.some((r) => String(r.id) === B.ids[resource]));
    });
    it(`${resource}: B's record by id is invisible to A`, async () => {
      assert.equal((await get(`/api/v1/${resource}/${B.ids[resource]}`, await as(A))).status, 404);
      assert.equal((await get(`/api/v1/${resource}/${A.ids[resource]}`, await as(A))).status, 200);
    });
  }

  it("A never sees B's fee or conversation text", async () => {
    const body = JSON.stringify(await (await get("/api/v1/fee-items", await as(A))).json()) + JSON.stringify(await (await get("/api/v1/messages", await as(A))).json());
    assert.ok(!body.includes("250000") && !body.includes("secret question of Beta"));
    assert.ok(body.includes("100000"));
  });

  it("never returns raw embeddings or channel token references", async () => {
    const chunks = JSON.stringify(await (await get("/api/v1/knowledge-chunks", await as(A))).json());
    const chans = JSON.stringify(await (await get("/api/v1/channel-connections", await as(A))).json());
    assert.ok(!chunks.includes("embedding") && !chans.includes("token_secret_ref") && !chans.includes("vault://"));
  });
});

describe("staff authentication", () => {
  it("rejects a missing token", async () => assert.equal((await get("/api/v1/programs")).status, 401));
  it("rejects a token signed with the wrong secret", async () => {
    const bad = await staffToken(A.authUserId, { secret: "another-secret-another-secret-another" });
    assert.equal((await get("/api/v1/programs", { authorization: `Bearer ${bad}` })).status, 401);
  });
  it("rejects an expired token", async () => {
    const old = await staffToken(A.authUserId, { expiresIn: "-1m" });
    assert.equal((await get("/api/v1/programs", { authorization: `Bearer ${old}` })).status, 401);
  });
  it("gives a valid user with no tenant membership nothing", async () => {
    const stranger = await staffToken("00000000-0000-4000-8000-000000000001");
    assert.equal((await get("/api/v1/programs", { authorization: `Bearer ${stranger}` })).status, 403);
  });
  it("X-Tenant-Id cannot select a tenant the user does not belong to", async () => {
    assert.equal((await get("/api/v1/programs", await as(A, { "x-tenant-id": B.id }))).status, 403);
  });
  it("a client-supplied tenant id in the query string is ignored", async () => {
    const { data } = (await (await get(`/api/v1/programs?tenant_id=${B.id}`, await as(A))).json()) as { data: { tenant_id: string }[] };
    assert.ok(data.every((r) => r.tenant_id === A.id));
  });
});

describe("widget key + origin resolution", () => {
  it("resolves each tenant from its own key and origin", async () => {
    const a = await (await get("/api/widget/config", { "x-widget-key": A.widgetKey, origin: A.origin })).json() as { name: string };
    const b = await (await get("/api/widget/config", { "x-widget-key": B.widgetKey, origin: B.origin })).json() as { name: string };
    assert.equal(a.name, A.name);
    assert.equal(b.name, B.name);
  });
  it("rejects a valid key from another tenant's origin", async () => {
    assert.equal((await get("/api/widget/config", { "x-widget-key": A.widgetKey, origin: B.origin })).status, 403);
  });
  it("rejects missing origin, missing key and unknown key with the same response", async () => {
    const responses = await Promise.all([
      get("/api/widget/config", { "x-widget-key": A.widgetKey }),
      get("/api/widget/config", { origin: A.origin }),
      get("/api/widget/config", { "x-widget-key": "wk_nope", origin: A.origin }),
    ]);
    for (const r of responses) { assert.equal(r.status, 403); assert.deepEqual(await r.json(), { error: "forbidden" }); }
  });
  it("rejects a revoked key", async () => {
    await withOwner(async (c) => {
      await c.query("BEGIN");
      await c.query("SELECT set_config('app.tenant_id', $1, true)", [B.id]);
      await c.query("UPDATE widget_keys SET status = 'revoked' WHERE public_key = $1", [B.widgetKey]);
      await c.query("COMMIT");
    });
    assert.equal((await get("/api/widget/config", { "x-widget-key": B.widgetKey, origin: B.origin })).status, 403);
  });
});

describe("RLS guarantees at the data layer", () => {
  it("tenant context does not leak to the next user of a pooled connection", async () => {
    await db.withTenant(A.id, (tx) => tx.query("SELECT count(*) FROM programs"));
    const { rows } = await db.pool.query("SELECT count(*)::int AS n FROM programs");
    assert.equal(rows[0].n, 0);
    const setting = await db.pool.query("SELECT current_setting('app.tenant_id', true) AS v");
    assert.ok(!setting.rows[0].v);
  });
  it("A cannot write a row labelled for B", async () => {
    await assert.rejects(db.withTenant(A.id, (tx) => tx.query("INSERT INTO leads (tenant_id, name) VALUES ($1, 'planted')", [B.id])), /row-level security/);
  });
  it("A cannot update or delete B's rows", async () => {
    const r = await db.withTenant(A.id, async (tx) => ({
      u: (await tx.query("UPDATE programs SET name = 'HACKED' WHERE id = $1", [B.programId])).rowCount,
      d: (await tx.query("DELETE FROM leads WHERE id = $1", [B.ids["leads"]])).rowCount,
    }));
    assert.deepEqual(r, { u: 0, d: 0 });
  });
  it("vector search returns only the caller's chunk even when every tenant has an identical embedding", async () => {
    const hitsA = await db.withTenant(A.id, (tx) => searchByVector(tx, vec(0), 10));
    const hitsB = await db.withTenant(B.id, (tx) => searchByVector(tx, vec(0), 10));
    assert.deepEqual(hitsA.map((h) => h.content), ["Chunk Alpha"]);
    assert.deepEqual(hitsB.map((h) => h.content), ["Chunk Beta"]);
  });
  it("search is metered per tenant in usage_events", async () => {
    const n = (id: string) => db.withTenant(id, async (tx) => (await tx.query("SELECT count(*)::int AS n FROM usage_events WHERE event_type = 'knowledge_search'")).rows[0].n as number);
    assert.equal(await n(A.id), 1);
    assert.equal(await n(B.id), 1);
  });
});
