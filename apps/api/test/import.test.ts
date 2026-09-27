// Phase 5: CSV/JSON bulk import with row-level validation, preview and draft staging. Nothing reaches a real
// table until reviewImportDraft (or its API route) explicitly accepts a draft.
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { createTenant, deleteTenants, staffToken, withOwner, type Fixture } from "./fixtures.js";
import { parseCsv } from "../src/import.js";

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

before(async () => {
  db = await import("../src/db.js");
  const { createApp } = await import("../src/app.js");
  A = await withOwner((c) => createTenant(c, "Import", 100_000));
  server = createApp(async () => null).listen(0);
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  await asOwner(A, "UPDATE tenant_users SET role = 'editor' WHERE tenant_id = current_tenant_id()");
});
after(async () => { server.close(); await deleteTenants([A.id]); await db.pool.end(); });

describe("parseCsv", () => {
  it("handles quoted fields, escaped quotes and commas inside quotes", () => {
    const rows = parseCsv('name,note\n"BS, Data Science","says ""hello"""\nBSCS,plain');
    assert.deepEqual(rows, [{ name: "BS, Data Science", note: 'says "hello"' }, { name: "BSCS", note: "plain" }]);
  });
});

describe("POST /api/v1/import/upload", () => {
  it("stages valid rows as drafts and reports invalid ones back without staging them", async () => {
    const csv = "name,code,degree_level\nBS Data Science,BSDS,bachelor\n,BAD,bachelor\nBS Physics,BSPHY,not-a-real-level";
    const res = await post("/api/v1/import/upload", { target: "programs", format: "csv", content: csv });
    assert.equal(res.status, 201);
    const body = (await res.json()) as { batch_id: string; staged: number; rejected: { row: number; errors: string[] }[] };
    assert.equal(body.staged, 1);
    assert.equal(body.rejected.length, 2);
    assert.equal(body.rejected[0]!.row, 2);
    assert.equal(body.rejected[1]!.row, 3);

    const drafts = (await (await get(`/api/v1/import/drafts?batch_id=${body.batch_id}`)).json()) as { data: { payload: { name: string }; review_status: string }[] };
    assert.equal(drafts.data.length, 1);
    assert.equal(drafts.data[0]!.payload.name, "BS Data Science");
    assert.equal(drafts.data[0]!.review_status, "pending");

    // Nothing landed in the real table until accepted.
    const real = await asOwner(A, "SELECT count(*)::int AS n FROM programs WHERE name = 'BS Data Science'");
    assert.equal(real[0]!.n, 0);
  });

  it("only a JSON array is accepted for format=json", async () => {
    const res = await post("/api/v1/import/upload", { target: "faqs", format: "json", content: '{"question":"x","answer":"y"}' });
    assert.equal(res.status, 400);
  });

  it("a viewer cannot upload (read-only role)", async () => {
    await asOwner(A, "UPDATE tenant_users SET role = 'viewer' WHERE tenant_id = current_tenant_id()");
    assert.equal((await post("/api/v1/import/upload", { target: "faqs", format: "csv", content: "question,answer\nx,y" })).status, 403);
    await asOwner(A, "UPDATE tenant_users SET role = 'editor' WHERE tenant_id = current_tenant_id()");
  });
});

describe("POST /api/v1/import/drafts/:id/review", () => {
  it("accepting a draft writes it to the real table as a draft-status row", async () => {
    const upload = await post("/api/v1/import/upload", { target: "faqs", format: "json", content: JSON.stringify([{ question: "Do you offer online classes?", answer: "No." }]) });
    const { batch_id } = (await upload.json()) as { batch_id: string };
    const drafts = (await (await get(`/api/v1/import/drafts?batch_id=${batch_id}`)).json()) as { data: { id: string }[] };
    const draftId = drafts.data[0]!.id;

    const res = await post(`/api/v1/import/drafts/${draftId}/review`, { action: "accept" });
    assert.equal(res.status, 204);
    const faq = await asOwner(A, "SELECT question, approved FROM faqs WHERE question = 'Do you offer online classes?'");
    assert.equal(faq.length, 1);
    assert.equal(faq[0]!.approved, false); // imported records still need the normal approval step

    // Reviewing the same draft twice is rejected -- it is no longer pending.
    assert.equal((await post(`/api/v1/import/drafts/${draftId}/review`, { action: "accept" })).status, 404);
  });

  it("rejecting a draft never writes it to the real table", async () => {
    const upload = await post("/api/v1/import/upload", { target: "faqs", format: "json", content: JSON.stringify([{ question: "Rejected question?", answer: "n/a" }]) });
    const { batch_id } = (await upload.json()) as { batch_id: string };
    const drafts = (await (await get(`/api/v1/import/drafts?batch_id=${batch_id}`)).json()) as { data: { id: string }[] };
    await post(`/api/v1/import/drafts/${drafts.data[0]!.id}/review`, { action: "reject" });
    const faq = await asOwner(A, "SELECT count(*)::int AS n FROM faqs WHERE question = 'Rejected question?'");
    assert.equal(faq[0]!.n, 0);
  });

  it("an edited payload is re-validated before it's accepted", async () => {
    const upload = await post("/api/v1/import/upload", { target: "faqs", format: "json", content: JSON.stringify([{ question: "Edit me?", answer: "original" }]) });
    const { batch_id } = (await upload.json()) as { batch_id: string };
    const drafts = (await (await get(`/api/v1/import/drafts?batch_id=${batch_id}`)).json()) as { data: { id: string }[] };
    const id = drafts.data[0]!.id;

    const bad = await post(`/api/v1/import/drafts/${id}/review`, { action: "accept", payload: { question: "", answer: "still bad" } });
    assert.equal(bad.status, 400);

    const ok = await post(`/api/v1/import/drafts/${id}/review`, { action: "accept", payload: { question: "Edit me?", answer: "corrected" } });
    assert.equal(ok.status, 204);
    const faq = await asOwner(A, "SELECT answer FROM faqs WHERE question = 'Edit me?'");
    assert.equal(faq[0]!.answer, "corrected");
  });

  it("fee-items linked to a program that doesn't exist yet fails cleanly, not silently", async () => {
    const upload = await post("/api/v1/import/upload", {
      target: "fee-items", format: "json",
      content: JSON.stringify([{ program_code: "NOPE", academic_year: "2026-27", student_type: "local", item_type: "tuition", amount: 100000, currency: "PKR", per: "semester" }]),
    });
    const { batch_id } = (await upload.json()) as { batch_id: string };
    const drafts = (await (await get(`/api/v1/import/drafts?batch_id=${batch_id}`)).json()) as { data: { id: string }[] };
    const res = await post(`/api/v1/import/drafts/${drafts.data[0]!.id}/review`, { action: "accept" });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error: string };
    assert.equal(body.error, "insert_failed");
  });
});
