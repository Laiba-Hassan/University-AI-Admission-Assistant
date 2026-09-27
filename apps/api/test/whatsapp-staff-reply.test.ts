// Staff two-way WhatsApp handoff (PRD 6A/6.3): a reply from the dashboard Inbox reaches the student directly
// within the 24-hour window, falls back to the tenant's approved template outside it, and never touches the
// network for a web conversation or a tenant with no WhatsApp connection configured.
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTenant, deleteTenants, withOwner, type Fixture } from "./fixtures.js";
import { decideDeliveryMode, deliverStaffReplyOverWhatsApp } from "../src/whatsapp/staff-reply.js";
import type { SendResult, WhatsAppSender } from "../src/whatsapp/send.js";

let A: Fixture;
let db: typeof import("../src/db.js");
let saveConnection: typeof import("../src/whatsapp/connection.js").saveWhatsAppConnection;

class FakeSender implements WhatsAppSender {
  texts: string[] = []; templates: string[] = [];
  async sendText(a: { text: string }): Promise<SendResult> { this.texts.push(a.text); return { ok: true, messageId: "wamid.x" }; }
  async sendTemplate(a: { templateName: string }): Promise<SendResult> { this.templates.push(a.templateName); return { ok: true, messageId: "wamid.y" }; }
}

const ownerQ = (f: Fixture, sql: string, params: unknown[] = []) => withOwner(async (c) => {
  await c.query("BEGIN"); await c.query("SELECT set_config('app.tenant_id', $1, true)", [f.id]);
  const r = await c.query(sql, params); await c.query("COMMIT"); return r.rows;
});

before(async () => {
  db = await import("../src/db.js");
  ({ saveWhatsAppConnection: saveConnection } = await import("../src/whatsapp/connection.js"));
  [A] = await withOwner(async (c) => [await createTenant(c, "StaffReply", 100_000)]);
});
after(async () => { await deleteTenants([A.id]); await db.pool.end(); });

describe("decideDeliveryMode (pure)", () => {
  it("uses free-form text inside the 24-hour window", () => {
    assert.equal(decideDeliveryMode(0.5, true), "free_form");
    assert.equal(decideDeliveryMode(23.99, false), "free_form"); // window alone decides -- a template isn't needed yet
  });
  it("falls back to the template once 24 hours have passed", () => {
    assert.equal(decideDeliveryMode(24, true), "template");
    assert.equal(decideDeliveryMode(72, true), "template");
  });
  it("is blocked outside the window with no approved template", () => {
    assert.equal(decideDeliveryMode(30, false), "blocked");
  });
  it("with no inbound message at all (null), treats it as outside the window", () => {
    assert.equal(decideDeliveryMode(null, true), "template");
    assert.equal(decideDeliveryMode(null, false), "blocked");
  });
});

describe("deliverStaffReplyOverWhatsApp", () => {
  it("is a no-op for a web conversation", async () => {
    const sender = new FakeSender();
    const contact = (await ownerQ(A, "INSERT INTO contacts (tenant_id, channel, external_id) VALUES (current_tenant_id(),'web','w1') RETURNING id"))[0]!.id as string;
    const conv = (await ownerQ(A, "INSERT INTO conversations (tenant_id, contact_id, channel) VALUES (current_tenant_id(),$1,'web') RETURNING id", [contact]))[0]!.id as string;
    const result = await db.withTenant(A.id, (tx) => deliverStaffReplyOverWhatsApp(tx, conv, "hello", sender));
    assert.deepEqual(result, { delivered: false, reason: "not_whatsapp" });
    assert.equal(sender.texts.length, 0);
  });

  it("is a no-op when the tenant has no active WhatsApp connection", async () => {
    const sender = new FakeSender();
    const contact = (await ownerQ(A, "INSERT INTO contacts (tenant_id, channel, external_id) VALUES (current_tenant_id(),'whatsapp','923010000001') RETURNING id"))[0]!.id as string;
    const conv = (await ownerQ(A, "INSERT INTO conversations (tenant_id, contact_id, channel) VALUES (current_tenant_id(),$1,'whatsapp') RETURNING id", [contact]))[0]!.id as string;
    const result = await db.withTenant(A.id, (tx) => deliverStaffReplyOverWhatsApp(tx, conv, "hello", sender));
    assert.deepEqual(result, { delivered: false, reason: "no_connection" });
  });

  it("sends the actual reply text within 24 hours of the student's last message", async () => {
    await db.withTenant(A.id, (tx) => saveConnection(tx, { phoneNumberId: A.phoneNumberId, accessToken: "tok", templateName: "followup" }));
    const sender = new FakeSender();
    const contact = (await ownerQ(A, "INSERT INTO contacts (tenant_id, channel, external_id) VALUES (current_tenant_id(),'whatsapp','923010000002') RETURNING id"))[0]!.id as string;
    const conv = (await ownerQ(A, "INSERT INTO conversations (tenant_id, contact_id, channel) VALUES (current_tenant_id(),$1,'whatsapp') RETURNING id", [contact]))[0]!.id as string;
    await ownerQ(A, "INSERT INTO messages (tenant_id, conversation_id, role, content) VALUES (current_tenant_id(),$1,'user','hi')", [conv]);

    const result = await db.withTenant(A.id, (tx) => deliverStaffReplyOverWhatsApp(tx, conv, "We've refunded you.", sender));
    assert.deepEqual(result, { delivered: true, mode: "free_form" });
    assert.deepEqual(sender.texts, ["We've refunded you."]);
    assert.equal(sender.templates.length, 0);
  });

  it("sends the approved template, not the free text, once the last inbound message is over 24 hours old", async () => {
    const sender = new FakeSender();
    const contact = (await ownerQ(A, "INSERT INTO contacts (tenant_id, channel, external_id) VALUES (current_tenant_id(),'whatsapp','923010000003') RETURNING id"))[0]!.id as string;
    const conv = (await ownerQ(A, "INSERT INTO conversations (tenant_id, contact_id, channel) VALUES (current_tenant_id(),$1,'whatsapp') RETURNING id", [contact]))[0]!.id as string;
    await ownerQ(A, "INSERT INTO messages (tenant_id, conversation_id, role, content, \"timestamp\") VALUES (current_tenant_id(),$1,'user','hi', now() - interval '3 days')", [conv]);

    const result = await db.withTenant(A.id, (tx) => deliverStaffReplyOverWhatsApp(tx, conv, "We've refunded you.", sender));
    assert.deepEqual(result, { delivered: true, mode: "template" });
    assert.equal(sender.texts.length, 0);
    assert.deepEqual(sender.templates, ["followup"]);
  });
});
