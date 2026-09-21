import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTenant, deleteTenants, withOwner, type Fixture } from "./fixtures.js";

let A: Fixture, B: Fixture;
let db: typeof import("../src/db.js");
let lookupFacts: typeof import("../src/agent/facts.js").lookupFacts;
let tools: typeof import("../src/agent/tools.js");
const TODAY = "2026-09-20";

const facts = (tenant: Fixture, args: Parameters<typeof lookupFacts>[1]) => db.withTenant(tenant.id, (tx) => lookupFacts(tx, args, TODAY));
const asOwner = (t: Fixture, sql: string, params: unknown[] = []) => withOwner(async (c) => {
  await c.query("BEGIN");
  await c.query("SELECT set_config('app.tenant_id', $1, true)", [t.id]);
  const r = await c.query(sql, params);
  await c.query("COMMIT");
  return r.rows;
});

before(async () => {
  db = await import("../src/db.js");
  ({ lookupFacts } = await import("../src/agent/facts.js"));
  tools = await import("../src/agent/tools.js");
  [A, B] = await withOwner(async (c) => [await createTenant(c, "Alpha", 100_000), await createTenant(c, "Beta", 250_000)]);
  // Alpha: two campuses, BSCS fee differs by campus and student type; a per-credit-hour program; a draft fee; a program with no fees.
  const [lhr] = await asOwner(A, "INSERT INTO campuses (tenant_id, name, city, status) VALUES (current_tenant_id(), 'Lahore Main Campus', 'Lahore', 'approved') RETURNING id");
  const [isb] = await asOwner(A, "INSERT INTO campuses (tenant_id, name, city, status) VALUES (current_tenant_id(), 'Islamabad Campus', 'Islamabad', 'approved') RETURNING id");
  for (const c of [lhr, isb]) await asOwner(A, "INSERT INTO program_campuses (tenant_id, program_id, campus_id) VALUES (current_tenant_id(), $1, $2)", [A.programId, c.id]);
  await asOwner(A, "DELETE FROM fee_items");
  for (const [campus, type, amount] of [[lhr.id, "local", 185000], [isb.id, "local", 205000], [lhr.id, "international", 2400]] as const)
    await asOwner(A, `INSERT INTO fee_items (tenant_id, program_id, campus_id, academic_year, student_type, item_type, amount, currency, per, last_verified_at, status)
      VALUES (current_tenant_id(), $1, $2, '2026-27', $3, 'tuition', $4, 'PKR', 'semester', '2026-08-20', 'approved')`, [A.programId, campus, type, amount]);
  await asOwner(A, `INSERT INTO fee_items (tenant_id, program_id, campus_id, academic_year, student_type, item_type, amount, currency, per, status)
    VALUES (current_tenant_id(), $1, $2, '2026-27', 'local', 'hostel', 99999, 'PKR', 'semester', 'draft')`, [null, lhr.id]);
  await asOwner(A, "UPDATE programs SET total_credit_hours = 133 WHERE id = $1", [A.programId]);
  await asOwner(A, "INSERT INTO programs (tenant_id, name, code, degree_level, status) VALUES (current_tenant_id(), 'BS Data Science', 'BSDS', 'bachelor', 'approved')");
  await asOwner(A, `INSERT INTO intakes (tenant_id, intake_name, application_deadline, test_date, last_verified_at, status)
    VALUES (current_tenant_id(), 'Spring 2027', '2026-12-15', '2027-01-09', '2026-08-20', 'approved')`);
  await asOwner(A, `INSERT INTO intakes (tenant_id, intake_name, application_deadline, status) VALUES (current_tenant_id(), 'Fall 2026', '2026-08-15', 'approved')`);
});
after(async () => { await deleteTenants([A.id, B.id]); await db.pool.end(); });

describe("dates are calendar dates, in every timezone", () => {
  // Regression: the driver's Date + toISOString() made 2026-12-15 come back as 2026-12-14 east of UTC.
  for (const tz of ["Asia/Karachi", "UTC", "America/Los_Angeles", "Pacific/Auckland"]) {
    it(`returns exact ISO dates with TZ=${tz}`, async () => {
      process.env.TZ = tz;
      const r = (await facts(A, { topic: "intakes" })) as unknown as { intakes: { intake: string; application_deadline: string; test_date: string | null; last_verified_at: string | null }[] };
      const spring = r.intakes.find((i) => i.intake === "Spring 2027")!;
      assert.equal(spring.application_deadline, "2026-12-15");
      assert.equal(spring.test_date, "2027-01-09");
      assert.equal(spring.last_verified_at, "2026-08-20");
    });
  }
  it("computes days remaining and deadline_passed in code", async () => {
    const r = (await facts(A, { topic: "intakes" })) as unknown as { intakes: Record<string, unknown>[] };
    const spring = r.intakes.find((i) => i.intake === "Spring 2027")!, fall = r.intakes.find((i) => i.intake === "Fall 2026")!;
    assert.equal(spring.days_until_deadline, 86);
    assert.equal(spring.deadline_passed, false);
    assert.equal(fall.deadline_passed, true);
    assert.equal(fall.days_until_deadline, null);
  });
});

describe("lookup_facts fees", () => {
  it("asks before quoting when campus / student type change the amount, and quotes nothing", async () => {
    const r = await facts(A, { topic: "fees", program: "BSCS", item_type: "tuition" });
    assert.equal(r.status, "needs_clarification");
    assert.deepEqual([...(r.ask as string[])].sort(), ["campus", "student_type"]);
    assert.ok(!JSON.stringify(r).includes("185000"));
  });
  it("answers once the student has said which campus and type", async () => {
    const r = (await facts(A, { topic: "fees", program: "BSCS", campus: "Lahore", student_type: "local", item_type: "tuition" })) as unknown as { status: string; fees: { amount: number; last_verified_at: string; is_stale: boolean }[] };
    assert.equal(r.status, "ok");
    assert.deepEqual(r.fees.map((f) => f.amount), [185000]);
    assert.equal(r.fees[0]!.last_verified_at, "2026-08-20");
    assert.equal(r.fees[0]!.is_stale, false);
  });
  it("requires a program for tuition, but not for general fees", async () => {
    assert.equal((await facts(A, { topic: "fees" })).status, "needs_clarification");
  });
  it("hides draft rows: only approved data is ever returned", async () => {
    const r = await facts(A, { topic: "fees", item_type: "hostel" });
    assert.equal(r.status, "no_data");
    assert.ok(!JSON.stringify(r).includes("99999"));
  });
  it("reports no_data for a program with no fee data instead of guessing", async () => {
    assert.equal((await facts(A, { topic: "fees", program: "BSDS", item_type: "tuition" })).status, "no_data");
  });
  it("does not see another tenant's programs or fees", async () => {
    assert.equal((await facts(B, { topic: "fees", program: "BSCS", item_type: "tuition" })).status, "ok");
    const r = JSON.stringify(await facts(B, { topic: "fees", program: "BSCS", item_type: "tuition" }));
    assert.ok(r.includes("250000") && !r.includes("185000"));
  });
  it("computes per-credit-hour totals in code", async () => {
    const [isb] = await asOwner(B, "INSERT INTO campuses (tenant_id, name, city, status) VALUES (current_tenant_id(), 'Main', 'Lahore', 'approved') RETURNING id");
    await asOwner(B, "UPDATE fee_items SET per = 'credit_hour', amount = 12500, campus_id = $1", [isb.id]);
    await asOwner(B, "UPDATE programs SET total_credit_hours = 133");
    const r = (await facts(B, { topic: "fees", program: "BSCS", item_type: "tuition", credit_hours: 15 })) as unknown as { fees: Record<string, unknown>[] };
    assert.equal(r.fees[0]!.computed_total, 187500);
    assert.equal(r.fees[0]!.computed_full_degree_total, 12500 * 133);
  });
});

describe("grounding of model-supplied arguments", () => {
  it("keeps a campus the student actually mentioned, including abbreviations and Urdu script", () => {
    assert.equal(tools.groundedCampus("Lahore Main Campus", ["bscs lhr local fee"]), "Lahore Main Campus");
    assert.equal(tools.groundedCampus("Islamabad Campus", ["اسلام آباد کیمپس میں فیس"]), "Islamabad Campus");
    assert.equal(tools.groundedCampus("Lahore", ["What is the fee for Lahore?"]), "Lahore");
  });
  it("drops a campus the student never mentioned", () => {
    assert.equal(tools.groundedCampus("Lahore Main Campus", ["BSDS ki fee kitni hai?"]), undefined);
  });
  it("keeps a student type only if the student said it", () => {
    assert.equal(tools.groundedStudentType("local", ["fee for local students"]), "local");
    assert.equal(tools.groundedStudentType("international", ["مقامی طالب علم"]), undefined);
    assert.equal(tools.groundedStudentType("local", ["what is the fee?"]), undefined);
    assert.equal(tools.groundedStudentType("international", ["I am an overseas applicant"]), "international");
  });
});
