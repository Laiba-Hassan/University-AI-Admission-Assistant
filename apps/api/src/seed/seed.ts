// Seeds the demo tenants from /data into Postgres and embeds their knowledge into pgvector.
// Runs as app_migrator (the table owner), which is still bound by FORCE RLS: each tenant is written under its
// own tenant context, exactly like the app. Re-running replaces the demo tenants (development/staging only).
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { z } from "zod";
import { TenantFile, Faculty, Campus, Program, FeeItem, Intake, Requirement, Scholarship, Faq } from "@uaa/shared";
import { config } from "../config.js";
import { embed, toVector, EMBEDDING_MODEL, EMBEDDING_DIMENSIONS } from "../embeddings.js";
import { chunkDocument, parseDocument } from "../chunking.js";

const DATA = join(dirname(fileURLToPath(import.meta.url)), "../../../../data");
const DEV_ORIGINS = ["http://localhost:3000", "http://localhost:3002", "http://localhost:5173"];

// Stable ids so re-seeding, tests and docs can refer to a tenant without a lookup that RLS would block.
export const tenantIdFor = (subdomain: string) => {
  const h = createHash("sha1").update(`uaa-tenant:${subdomain}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
export const devWidgetKey = (subdomain: string) => `wk_dev_${subdomain.replace(/-/g, "_")}`;
export const devPhoneNumberId = (subdomain: string) => `test-phone-${subdomain}`;

const read = <T extends z.ZodTypeAny>(tenant: string, file: string, schema: T): z.infer<T> =>
  schema.parse(JSON.parse(readFileSync(join(DATA, tenant, file), "utf-8")));

interface ChunkRow { docKey: string; title: string; sourceType: string; approved: boolean; content: string; metadata: Record<string, unknown> }

export async function seedTenant(client: pg.Client, dir: string) {
  const t = read(dir, "tenant.json", TenantFile);
  const faculties = read(dir, "faculties.json", z.array(Faculty));
  const campuses = read(dir, "campuses.json", z.array(Campus));
  const programs = read(dir, "programs.json", z.array(Program));
  const fees = read(dir, "fee_items.json", z.array(FeeItem));
  const intakes = read(dir, "intakes.json", z.array(Intake));
  const reqs = read(dir, "requirements.json", z.array(Requirement));
  const scholarships = read(dir, "scholarships.json", z.array(Scholarship));
  const faqs = read(dir, "faqs.json", z.array(Faq));

  // Knowledge chunks: every markdown document, plus each FAQ as its own retrievable chunk.
  const docDir = join(DATA, dir, "documents");
  const chunks: ChunkRow[] = [];
  for (const f of readdirSync(docDir).filter((f) => f.endsWith(".md")).sort()) {
    const doc = parseDocument(readFileSync(join(docDir, f), "utf-8"));
    for (const c of chunkDocument(doc))
      chunks.push({ docKey: f, title: doc.title, sourceType: doc.sourceType, approved: doc.approved, content: c.content, metadata: { section: c.heading, file: f } });
  }
  faqs.forEach((q, i) =>
    chunks.push({ docKey: `faq-${i}`, title: q.question, sourceType: "faq", approved: q.approved, content: `Q: ${q.question}\nA: ${q.answer}`, metadata: { faq_question: q.question } }));
  const vectors = await embed(chunks.map((c) => c.content), "RETRIEVAL_DOCUMENT");

  const id = tenantIdFor(t.subdomain);
  await client.query("BEGIN");
  try {
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [id]);
    await client.query("DELETE FROM tenants WHERE id = $1", [id]); // cascades to everything the tenant owns
    await client.query(
      `INSERT INTO tenants (id, name, subdomain, status, plan_label, branding, welcome_message, working_hours,
                            default_reply_script, retention_days, fee_stale_after_days)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [id, t.name, t.subdomain, t.status, t.plan_label, t.branding, t.welcome_message, t.working_hours, t.default_reply_script, t.retention_days, t.fee_stale_after_days],
    );
    await client.query(
      `INSERT INTO tenant_limits (tenant_id, monthly_conversation_limit, monthly_message_limit, web_enabled, whatsapp_enabled) VALUES ($1,$2,$3,$4,$5)`,
      [id, t.limits.monthly_conversation_limit, t.limits.monthly_message_limit, t.limits.web_enabled, t.limits.whatsapp_enabled],
    );
    for (const [key, byLang] of Object.entries(t.localized_messages))
      for (const [language, text] of Object.entries(byLang!))
        await client.query(`INSERT INTO localized_messages (tenant_id, key, language, text) VALUES ($1,$2,$3,$4)`, [id, key, language, text]);

    const ids = { faculty: new Map<string, string>(), campus: new Map<string, string>(), program: new Map<string, string>() };
    for (const f of faculties) {
      const r = await client.query(`INSERT INTO faculties (tenant_id, name, status) VALUES ($1,$2,$3) RETURNING id`, [id, f.name, f.status]);
      ids.faculty.set(f.key, r.rows[0].id);
    }
    for (const c of campuses) {
      const r = await client.query(`INSERT INTO campuses (tenant_id, name, city, status) VALUES ($1,$2,$3,$4) RETURNING id`, [id, c.name, c.city, c.status]);
      ids.campus.set(c.key, r.rows[0].id);
    }
    for (const p of programs) {
      const r = await client.query(
        `INSERT INTO programs (tenant_id, faculty_id, name, code, degree_level, total_credit_hours, status) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [id, ids.faculty.get(p.faculty), p.name, p.code, p.degree_level, p.total_credit_hours, p.status],
      );
      ids.program.set(p.key, r.rows[0].id);
      for (const c of p.campuses)
        await client.query(`INSERT INTO program_campuses (tenant_id, program_id, campus_id) VALUES ($1,$2,$3)`, [id, r.rows[0].id, ids.campus.get(c)]);
    }
    for (const f of fees)
      await client.query(
        `INSERT INTO fee_items (tenant_id, program_id, campus_id, academic_year, student_type, item_type, amount, currency, per, effective_from, last_verified_at, status, note)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [id, f.program ? ids.program.get(f.program) : null, f.campus ? ids.campus.get(f.campus) : null, f.academic_year, f.student_type, f.item_type,
         f.amount, f.currency, f.per, f.effective_from, f.last_verified_at, f.status, f.note ?? null],
      );
    for (const i of intakes)
      for (const program of i.programs === "all" ? [null] : i.programs)
        await client.query(
          `INSERT INTO intakes (tenant_id, program_id, intake_name, applications_open, application_deadline, test_date, classes_start, last_verified_at, status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [id, program ? ids.program.get(program) : null, i.intake_name, i.applications_open, i.application_deadline, i.test_date, i.classes_start, i.last_verified_at, i.status],
        );
    for (const r of reqs)
      await client.query(`INSERT INTO requirements (tenant_id, program_id, eligibility, required_documents, status) VALUES ($1,$2,$3,$4,$5)`,
        [id, ids.program.get(r.program), r.eligibility, r.required_documents, r.status]);
    for (const s of scholarships)
      await client.query(`INSERT INTO scholarships (tenant_id, name, criteria, coverage, conditions, deadline, status) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [id, s.name, s.criteria, s.coverage, s.conditions, s.deadline, s.status]);
    for (const q of faqs)
      await client.query(`INSERT INTO faqs (tenant_id, question, answer, approved) VALUES ($1,$2,$3,$4)`, [id, q.question, q.answer, q.approved]);

    const docIds = new Map<string, string>();
    for (const [n, c] of chunks.entries()) {
      if (!docIds.has(c.docKey)) {
        const r = await client.query(`INSERT INTO knowledge_documents (tenant_id, title, source_type, approved) VALUES ($1,$2,$3,$4) RETURNING id`,
          [id, c.title, c.sourceType, c.approved]);
        docIds.set(c.docKey, r.rows[0].id);
      }
      await client.query(`INSERT INTO knowledge_chunks (tenant_id, document_id, content, embedding, metadata) VALUES ($1,$2,$3,$4::vector,$5)`,
        [id, docIds.get(c.docKey), c.content, toVector(vectors[n]!), c.metadata]);
    }

    await client.query(`INSERT INTO widget_keys (tenant_id, public_key, allowed_origins) VALUES ($1,$2,$3)`, [id, devWidgetKey(t.subdomain), DEV_ORIGINS]);
    await client.query(`INSERT INTO channel_connections (tenant_id, channel, status) VALUES ($1,'web','active')`, [id]);
    // Placeholder WhatsApp id so tenant routing is testable now; Phase 6A replaces it with the Meta test number's id.
    await client.query(`INSERT INTO channel_connections (tenant_id, channel, phone_number_id, status) VALUES ($1,'whatsapp',$2,'pending')`, [id, devPhoneNumberId(t.subdomain)]);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  }
  return { id, subdomain: t.subdomain, chunks: chunks.length };
}

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to seed demo data in production");
  const staging = process.argv.includes("--staging");
  const host = new URL(config.DATABASE_URL_MIGRATOR).hostname;
  // --staging: run against the hosted database in .env.staging (a demo/browse copy, per docs/staging-setup.md).
  // Guard against the opposite mistakes: forgetting --staging while .env.staging is loaded, and passing --staging
  // while nothing overrode the local default (DATABASE_URL_MIGRATOR then silently falls back to Docker).
  if (staging && ["localhost", "127.0.0.1", "::1"].includes(host)) throw new Error("--staging but DATABASE_URL_MIGRATOR points at localhost; check .env.staging is loaded");
  if (!staging && !["localhost", "127.0.0.1", "::1"].includes(host)) throw new Error(`DATABASE_URL_MIGRATOR points at ${host}, not localhost; pass --staging if this is intentional`);
  console.log(`target: ${host}${staging ? " (staging)" : ""}`);

  const client = new pg.Client({ connectionString: config.DATABASE_URL_MIGRATOR });
  await client.connect();
  try {
    for (const dir of readdirSync(DATA).filter((d) => !d.startsWith(".") && d !== "bakeoff")) {
      const r = await seedTenant(client, dir);
      console.log(`seeded ${r.subdomain} (${r.id}): ${r.chunks} chunks embedded with ${EMBEDDING_MODEL}@${EMBEDDING_DIMENSIONS}`);
    }
  } finally {
    await client.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
