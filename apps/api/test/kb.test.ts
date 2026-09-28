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

describe("POST /api/v1/kb/test-chat", () => {
  const postJson = async (path: string, body: unknown) =>
    fetch(`${base}${path}`, { method: "POST", headers: { ...(await auth()), "content-type": "application/json" }, body: JSON.stringify(body) });

  // A single real LLM call (kept to one, deliberately: this suite already spends real Gemini quota elsewhere,
  // and Gemini rate-limits (HTTP 429) are a real, expected condition here, not a bug -- llm.ts's own bounded
  // retry/backoff (max ~6 attempts, capped at 60s each) means a sustained 429 surfaces as a 503
  // "assistant_unavailable" after roughly two minutes, which this test treats as a legitimate outcome, not a
  // failure. What actually matters for THIS test is the conversation status reset (see the fix below), which is
  // verified at the DB level regardless of whether the model itself was reachable.
  //
  // Found via manual QA: once this scratch conversation's status was ever pushed to 'needs_human'/'human' (e.g.
  // by a past test escalating it, or a staff member clicking handoff on it from the Inbox), handleMessage()
  // correctly stays silent forever after -- right for a real student conversation someone took over, wrong for
  // a scratch conversation that only exists to be re-tested. The route must reset it before every call.
  it("recovers from a stuck 'human' status instead of staying silent forever", async () => {
    const externalId = `staff-test-${A.authUserId}`;
    await asOwner(A, `UPDATE conversations SET status = 'human' WHERE contact_id = (SELECT id FROM contacts WHERE external_id = $1 AND channel = 'web')`, [externalId]);

    const res = await postJson("/api/v1/kb/test-chat", { message: "What programs do you offer?" });
    if (res.status === 200) {
      const body = (await res.json()) as { reply: string };
      assert.ok(body.reply.length > 0, "expected a real reply, not the silent empty string a stuck 'human' status produces");
    } else {
      assert.equal(res.status, 503, "the only other acceptable outcome is a real upstream failure (e.g. rate-limited), not silent success");
    }

    // The fix under test: regardless of whether the model call itself succeeded, the route must have reset the
    // stuck status before attempting it, so the NEXT message (whenever it's sent) won't be silently swallowed.
    const row = await asOwner(A, `SELECT status FROM conversations WHERE contact_id = (SELECT id FROM contacts WHERE external_id = $1 AND channel = 'web')`, [externalId]);
    assert.equal(row[0]!.status, "open");
  });
});
