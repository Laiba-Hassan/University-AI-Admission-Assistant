// Staff dashboard: Unanswered Questions -- draft an FAQ, link to an existing one, or ignore (Phase 5).
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { createTenant, deleteTenants, staffToken, withOwner, type Fixture } from "./fixtures.js";

let A: Fixture, server: Server, base: string;
let db: typeof import("../src/db.js");
let clusterId: string, clusterId2: string, existingFaqId: string;

const asOwner = (t: Fixture, sql: string, params: unknown[] = []) => withOwner(async (c) => {
  await c.query("BEGIN"); await c.query("SELECT set_config('app.tenant_id', $1, true)", [t.id]);
  const r = await c.query(sql, params); await c.query("COMMIT"); return r.rows;
});
const post = async (path: string, body: unknown) =>
  fetch(`${base}${path}`, { method: "POST", headers: { authorization: `Bearer ${await staffToken(A.authUserId)}`, "content-type": "application/json" }, body: JSON.stringify(body) });

before(async () => {
  db = await import("../src/db.js");
  const { createApp } = await import("../src/app.js");
  A = await withOwner((c) => createTenant(c, "Unanswered", 100_000));
  server = createApp(async () => null).listen(0);
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  await asOwner(A, "UPDATE tenant_users SET role = 'editor' WHERE tenant_id = current_tenant_id()");
  clusterId = (await asOwner(A, "INSERT INTO unanswered_questions (tenant_id, question_text, count) VALUES (current_tenant_id(), 'refund policy?', 5) RETURNING id"))[0]!.id;
  clusterId2 = (await asOwner(A, "INSERT INTO unanswered_questions (tenant_id, question_text, count) VALUES (current_tenant_id(), 'transfer credits?', 2) RETURNING id"))[0]!.id;
  existingFaqId = (await asOwner(A, "INSERT INTO faqs (tenant_id, question, answer, approved) VALUES (current_tenant_id(), 'Can I transfer credits?', 'Yes, case by case.', true) RETURNING id"))[0]!.id;
});
after(async () => { server.close(); await deleteTenants([A.id]); await db.pool.end(); });

describe("POST /api/v1/unanswered-questions/:id/draft-faq", () => {
  it("creates an unapproved FAQ from the cluster and closes it out", async () => {
    const res = await post(`/api/v1/unanswered-questions/${clusterId}/draft-faq`, { answer: "Refunds are processed within 14 days." });
    assert.equal(res.status, 201);
    const { faqId } = (await res.json()) as { faqId: string };
    const faq = await asOwner(A, "SELECT question, answer, approved FROM faqs WHERE id = $1", [faqId]);
    assert.equal(faq[0]!.question, "refund policy?");
    assert.equal(faq[0]!.approved, false);
    const cluster = await asOwner(A, "SELECT status, linked_faq_id FROM unanswered_questions WHERE id = $1", [clusterId]);
    assert.equal(cluster[0]!.status, "answered");
    assert.equal(cluster[0]!.linked_faq_id, faqId);
  });
});

describe("POST /api/v1/unanswered-questions/:id/link", () => {
  it("links the cluster to an existing FAQ", async () => {
    const res = await post(`/api/v1/unanswered-questions/${clusterId2}/link`, { faq_id: existingFaqId });
    assert.equal(res.status, 204);
    const cluster = await asOwner(A, "SELECT status, linked_faq_id FROM unanswered_questions WHERE id = $1", [clusterId2]);
    assert.equal(cluster[0]!.status, "answered");
    assert.equal(cluster[0]!.linked_faq_id, existingFaqId);
  });
  it("404s linking to another tenant's FAQ", async () => {
    const [B] = await withOwner(async (c) => [await createTenant(c, "UnansweredOther", 50_000)]);
    const res = await post(`/api/v1/unanswered-questions/${clusterId2}/link`, { faq_id: B.ids["faqs"] ?? "00000000-0000-0000-0000-000000000000" });
    assert.equal(res.status, 404);
    await deleteTenants([B.id]);
  });
});

describe("POST /api/v1/unanswered-questions/:id/ignore", () => {
  it("marks the cluster ignored", async () => {
    const cid = (await asOwner(A, "INSERT INTO unanswered_questions (tenant_id, question_text) VALUES (current_tenant_id(), 'what is the weather') RETURNING id"))[0]!.id;
    const res = await post(`/api/v1/unanswered-questions/${cid}/ignore`, {});
    assert.equal(res.status, 204);
    const row = await asOwner(A, "SELECT status FROM unanswered_questions WHERE id = $1", [cid]);
    assert.equal(row[0]!.status, "ignored");
  });
});
