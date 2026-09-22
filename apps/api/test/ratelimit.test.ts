// Unit tests for the rate-limit primitives and the challenge-pass tokens, independent of HTTP or config, so they
// can use tiny explicit limits without risking collisions with any other test file's traffic on shared dimensions
// (an IP bucket in particular is process-wide by design).
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createHmac } from "node:crypto";
import { checkLimit, checkLimits, pruneOldBuckets } from "../src/ratelimit.js";
import { issueChallengePass, verifyChallengePass } from "../src/challenge.js";
import { publicRateLimit } from "../src/routes/rate-limit-middleware.js";
import { config } from "../src/config.js";
import { pool } from "../src/db.js";

after(async () => { await pool.end(); });

describe("checkLimit", () => {
  it("allows up to max, then blocks within the same window", async () => {
    const key = `t:${randomUUID()}`;
    for (let i = 0; i < 3; i++) assert.equal(await checkLimit({ key, windowSeconds: 60, max: 3 }), true, `request ${i}`);
    assert.equal(await checkLimit({ key, windowSeconds: 60, max: 3 }), false);
    assert.equal(await checkLimit({ key, windowSeconds: 60, max: 3 }), false); // stays blocked, doesn't "use up" further
  });
  it("counts different keys independently", async () => {
    const a = `t:${randomUUID()}`, b = `t:${randomUUID()}`;
    assert.equal(await checkLimit({ key: a, windowSeconds: 60, max: 1 }), true);
    assert.equal(await checkLimit({ key: a, windowSeconds: 60, max: 1 }), false);
    assert.equal(await checkLimit({ key: b, windowSeconds: 60, max: 1 }), true, "b is unaffected by a's count");
  });
  it("is atomic under concurrent callers (no race lets more than max through)", async () => {
    const key = `t:${randomUUID()}`;
    const results = await Promise.all(Array.from({ length: 20 }, () => checkLimit({ key, windowSeconds: 60, max: 5 })));
    assert.equal(results.filter(Boolean).length, 5);
  });
  it("a short window resets the count once it rolls over", async () => {
    const key = `t:${randomUUID()}`;
    assert.equal(await checkLimit({ key, windowSeconds: 1, max: 1 }), true);
    assert.equal(await checkLimit({ key, windowSeconds: 1, max: 1 }), false);
    await new Promise((r) => setTimeout(r, 1100));
    assert.equal(await checkLimit({ key, windowSeconds: 1, max: 1 }), true);
  });
  it("pruneOldBuckets removes only windows older than the cutoff", async () => {
    const key = `t:${randomUUID()}`;
    await checkLimit({ key, windowSeconds: 1, max: 100 });
    await new Promise((r) => setTimeout(r, 1100));
    const removed = await pruneOldBuckets(0);
    assert.ok(removed >= 1);
  });
});

describe("checkLimits", () => {
  it("reports which specific dimension(s) failed", async () => {
    const ipKey = `ip:${randomUUID()}`, sessionKey = `s:${randomUUID()}`;
    await checkLimit({ key: ipKey, windowSeconds: 60, max: 1 }); // consume the IP bucket's only slot
    const { ok, failed } = await checkLimits([{ key: ipKey, windowSeconds: 60, max: 1 }, { key: sessionKey, windowSeconds: 60, max: 1 }]);
    assert.equal(ok, false);
    assert.deepEqual(failed, [ipKey]);
  });
});

describe("publicRateLimit middleware", () => {
  const call = async (req: Record<string, unknown>) => {
    let status: number | undefined, body: unknown, nextErr: unknown, nextCalled = false;
    const res = { status(c: number) { status = c; return this; }, json(b: unknown) { body = b; return this; } };
    const next = (err?: unknown) => { nextCalled = true; nextErr = err; };
    await (publicRateLimit as (req: unknown, res: unknown, next: unknown) => Promise<void>)(req, res, next);
    return { status, body, nextCalled, nextErr };
  };

  it("rejects with 403 forbidden if req.tenant is missing (should never happen after resolveWidgetTenant, but fail closed)", async () => {
    const r = await call({ ip: randomUUID(), body: {} });
    assert.equal(r.status, 403);
    assert.equal(r.nextCalled, false);
  });
  it("calls next() when under every configured limit", async () => {
    const r = await call({ ip: randomUUID(), tenant: { id: randomUUID() }, body: { session_id: randomUUID() } });
    assert.equal(r.nextCalled, true);
    assert.equal(r.status, undefined);
  });
  it("works without a session_id (per-IP and per-tenant dimensions still apply)", async () => {
    const r = await call({ ip: randomUUID(), tenant: { id: randomUUID() }, body: {}, query: {} });
    assert.equal(r.nextCalled, true);
  });
  it("returns 429 once the per-session dimension is exhausted, holding IP and tenant constant", async () => {
    const ip = randomUUID(), tenantId = randomUUID(), session = randomUUID();
    const req = { ip, tenant: { id: tenantId }, body: { session_id: session } };
    let last;
    for (let i = 0; i < 12; i++) last = await call(req); // default per-session max is 10/minute
    assert.equal(last!.status, 429);
    assert.deepEqual(last!.body, { error: "rate_limited" });
    assert.equal(last!.nextCalled, false);
  });
});

describe("challenge pass", () => {
  it("issues a pass that verifies for the same tenant + session", () => {
    const tenantId = randomUUID(), session = randomUUID();
    const pass = issueChallengePass(tenantId, session);
    assert.equal(verifyChallengePass(pass, tenantId, session), true);
  });
  it("rejects a pass for a different tenant or a different session (cannot reuse across sessions)", () => {
    const pass = issueChallengePass("tenant-a", "session-1");
    assert.equal(verifyChallengePass(pass, "tenant-b", "session-1"), false);
    assert.equal(verifyChallengePass(pass, "tenant-a", "session-2"), false);
  });
  it("rejects a tampered signature and a missing pass", () => {
    const pass = issueChallengePass("t", "s");
    assert.equal(verifyChallengePass(pass.slice(0, -2) + "xx", "t", "s"), false);
    assert.equal(verifyChallengePass(undefined, "t", "s"), false);
  });
  it("rejects an expired pass even with a validly-computed signature (not just a signature check)", () => {
    const exp = Math.floor(Date.now() / 1000) - 10;
    const sig = createHmac("sha256", config.CHALLENGE_SIGNING_SECRET).update(`t.s.${exp}`).digest("base64url");
    assert.equal(verifyChallengePass(`${exp}.${sig}`, "t", "s"), false);
  });
});
