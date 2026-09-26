// The self-serve "Create account" signup flow's backend: an unauthenticated request that stages a new
// university into the access_requests table for a platform admin to approve or reject (Phase 5).
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { withOwner } from "./fixtures.js";

let server: Server, base: string;
let db: typeof import("../src/db.js");

const post = (body: unknown) =>
  fetch(`${base}/api/public/access-requests`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

before(async () => {
  db = await import("../src/db.js");
  const { createApp } = await import("../src/app.js");
  server = createApp(async () => null).listen(0);
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
after(async () => {
  server.close();
  // app_user is deliberately not granted DELETE on access_requests (students never delete their own signup
  // request); clean up through the owner role instead, the same way the other fixtures do.
  await withOwner((c) => c.query("DELETE FROM access_requests WHERE email IN ($1, $2)", ["sana@fairview.edu", "bilal@askari.edu"]));
  await db.pool.end();
});

describe("POST /api/public/access-requests", () => {
  it("stages a pending access request and needs no auth or tenant", async () => {
    const res = await post({ university_name: "Fairview College", contact_name: "Sana Malik", email: "sana@fairview.edu" });
    assert.equal(res.status, 201);
    assert.deepEqual(await res.json(), { status: "pending" });
    const row = await db.withoutTenant((tx) =>
      tx.query("SELECT university_name, contact_name, email, phone, status FROM access_requests WHERE email = $1", ["sana@fairview.edu"]));
    assert.equal(row.rows.length, 1);
    assert.equal(row.rows[0].university_name, "Fairview College");
    assert.equal(row.rows[0].status, "pending");
    assert.equal(row.rows[0].phone, null);
  });

  it("accepts an optional phone number", async () => {
    const res = await post({ university_name: "Askari College", contact_name: "Bilal Aslam", email: "bilal@askari.edu", phone: "+92 300 1234567" });
    assert.equal(res.status, 201);
    const row = await db.withoutTenant((tx) => tx.query("SELECT phone FROM access_requests WHERE email = $1", ["bilal@askari.edu"]));
    assert.equal(row.rows[0].phone, "+92 300 1234567");
  });

  it("rejects a missing or malformed field", async () => {
    assert.equal((await post({ university_name: "", contact_name: "Sana", email: "sana@fairview.edu" })).status, 400);
    assert.equal((await post({ university_name: "Fairview", contact_name: "Sana", email: "not-an-email" })).status, 400);
    assert.equal((await post({ contact_name: "Sana", email: "sana@fairview.edu" })).status, 400);
  });

  it("reflects Origin for CORS, since the dashboard app is always cross-origin from the API", async () => {
    const res = await fetch(`${base}/api/public/access-requests`, {
      method: "OPTIONS",
      headers: { origin: "http://localhost:3002", "access-control-request-method": "POST" },
    });
    assert.equal(res.status, 204);
    assert.equal(res.headers.get("access-control-allow-origin"), "http://localhost:3002");
  });
});
