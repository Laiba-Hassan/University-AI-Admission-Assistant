import { randomUUID } from "node:crypto";
import pg from "pg";
import { SignJWT } from "jose";

// Must be set before src/config.ts is first imported (tests import the app dynamically).
export const JWT_SECRET = "test-only-secret-at-least-32-characters-long";
export const WA_SECRET = "test-only-whatsapp-app-secret";
process.env.SUPABASE_JWT_SECRET = JWT_SECRET;
process.env.WHATSAPP_APP_SECRET = WA_SECRET;

export interface Fixture {
  id: string; name: string; programId: string; feeAmount: number; widgetKey: string; origin: string;
  phoneNumberId: string; authUserId: string; email: string; ids: Record<string, string>;
}

const url = process.env.DATABASE_URL_MIGRATOR ?? "postgres://app_migrator:migrator_dev@localhost:5433/admission";
const unit = (seed: number) => Array.from({ length: 768 }, (_, i) => (i === seed ? 1 : 0)); // one-hot vectors: cosine-comparable without an API call
export const vec = unit;

/** Creates a fully populated tenant through the table owner, still bound by FORCE RLS (context set per tenant). */
export async function createTenant(client: pg.Client, label: string, feeAmount: number): Promise<Fixture> {
  const id = randomUUID();
  const f: Fixture = {
    id, name: `Test ${label} ${id.slice(0, 8)}`, programId: "", feeAmount, widgetKey: `wk_${id}`, origin: `https://${label.toLowerCase()}-${id.slice(0, 8)}.test`,
    phoneNumberId: `pn_${id}`, authUserId: randomUUID(), email: `staff-${id.slice(0, 8)}@${label.toLowerCase()}.test`, ids: {},
  };
  await client.query("BEGIN");
  await client.query("SELECT set_config('app.tenant_id', $1, true)", [id]);
  const one = async (sql: string, params: unknown[]) => (await client.query(sql, params)).rows[0].id as string;
  await client.query("INSERT INTO tenants (id, name, subdomain) VALUES ($1,$2,$3)", [id, f.name, `t-${id}`]);
  await client.query("INSERT INTO tenant_limits (tenant_id) VALUES ($1)", [id]);
  await client.query("INSERT INTO tenant_users (tenant_id, auth_user_id, email, role) VALUES ($1,$2,$3,'viewer')", [id, f.authUserId, f.email]);
  f.programId = await one("INSERT INTO programs (tenant_id, name, code, degree_level, status) VALUES ($1,'BS Computer Science','BSCS','bachelor','approved') RETURNING id", [id]);
  f.ids["programs"] = f.programId;
  f.ids["fee-items"] = await one(
    `INSERT INTO fee_items (tenant_id, program_id, academic_year, student_type, item_type, amount, currency, per, status)
     VALUES ($1,$2,'2026-27','local','tuition',$3,'PKR','semester','approved') RETURNING id`, [id, f.programId, feeAmount]);
  const contact = await one("INSERT INTO contacts (tenant_id, channel, external_id) VALUES ($1,'web','s1') RETURNING id", [id]);
  f.ids["contacts"] = contact;
  const conv = await one("INSERT INTO conversations (tenant_id, contact_id, channel) VALUES ($1,$2,'web') RETURNING id", [id, contact]);
  f.ids["conversations"] = conv;
  f.ids["messages"] = await one("INSERT INTO messages (tenant_id, conversation_id, role, content) VALUES ($1,$2,'user',$3) RETURNING id", [id, conv, `secret question of ${label}`]);
  f.ids["leads"] = await one("INSERT INTO leads (tenant_id, contact_id, name) VALUES ($1,$2,$3) RETURNING id", [id, contact, `Lead ${label}`]);
  f.ids["usage-events"] = String((await client.query("INSERT INTO usage_events (tenant_id, event_type) VALUES ($1,'message') RETURNING id", [id])).rows[0].id);
  f.ids["channel-connections"] = await one("INSERT INTO channel_connections (tenant_id, channel, phone_number_id, token_secret_ref) VALUES ($1,'whatsapp',$2,'vault://secret') RETURNING id", [id, f.phoneNumberId]);
  await client.query("INSERT INTO widget_keys (tenant_id, public_key, allowed_origins) VALUES ($1,$2,$3)", [id, f.widgetKey, [f.origin]]);
  // A generic message in every (key, language) pair so any code path that reads localized_messages (fallback,
  // welcome, handoff, after_hours) has real text to return, instead of silently falling back to "".
  for (const key of ["welcome", "fallback", "handoff", "after_hours"])
    for (const language of ["english", "roman_urdu", "urdu"])
      await client.query("INSERT INTO localized_messages (tenant_id, key, language, text) VALUES ($1,$2,$3,$4)", [id, key, language, `${label} ${key} (${language})`]);
  const doc = await one("INSERT INTO knowledge_documents (tenant_id, title, source_type, approved) VALUES ($1,$2,'policy',true) RETURNING id", [id, `Doc ${label}`]);
  f.ids["knowledge-documents"] = doc;
  // Identical embeddings in every tenant: a query must still only ever return its own tenant's chunk.
  f.ids["knowledge-chunks"] = await one("INSERT INTO knowledge_chunks (tenant_id, document_id, content, embedding) VALUES ($1,$2,$3,$4::vector) RETURNING id", [id, doc, `Chunk ${label}`, JSON.stringify(vec(0))]);
  await client.query("COMMIT");
  return f;
}

export async function withOwner<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}

export async function deleteTenants(ids: string[]) {
  await withOwner(async (c) => {
    for (const id of ids) {
      await c.query("BEGIN");
      await c.query("SELECT set_config('app.tenant_id', $1, true)", [id]);
      await c.query("DELETE FROM tenants WHERE id = $1", [id]);
      await c.query("COMMIT");
    }
  });
}

export const staffToken = (sub: string, opts: { secret?: string; expiresIn?: string } = {}) =>
  new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setSubject(sub).setAudience("authenticated").setIssuedAt()
    .setExpirationTime(opts.expiresIn ?? "5m").sign(new TextEncoder().encode(opts.secret ?? JWT_SECRET));
