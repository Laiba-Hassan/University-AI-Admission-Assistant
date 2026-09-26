import { Router } from "express";
import { staffCors } from "../cors.js";
import { withTenant } from "../db.js";
import { searchKnowledge } from "../knowledge.js";
import { requireRole, resolveStaffTenant, tenantOf } from "../tenancy.js";

// Staff dashboard read API. Deliberately no `WHERE tenant_id = ...` here: isolation comes from RLS under the
// per-transaction tenant context, so the API tests exercise the database guarantee itself, not app-side filtering.
const RESOURCES: Record<string, { table: string; columns: string; order: string }> = {
  programs: { table: "programs", columns: "*", order: "name" },
  faculties: { table: "faculties", columns: "*", order: "name" },
  campuses: { table: "campuses", columns: "*", order: "name" },
  "fee-items": { table: "fee_items", columns: "*", order: "id" },
  intakes: { table: "intakes", columns: "*", order: "id" },
  requirements: { table: "requirements", columns: "*", order: "id" },
  scholarships: { table: "scholarships", columns: "*", order: "name" },
  faqs: { table: "faqs", columns: "*", order: "question" },
  "knowledge-documents": { table: "knowledge_documents", columns: "*", order: "title" },
  "knowledge-chunks": { table: "knowledge_chunks", columns: "id, tenant_id, document_id, content, metadata", order: "id" }, // never the raw vector
  contacts: { table: "contacts", columns: "*", order: "id" },
  conversations: { table: "conversations", columns: "*", order: "last_message_at DESC" },
  messages: { table: "messages", columns: "*", order: '"timestamp" DESC' },
  leads: { table: "leads", columns: "*", order: "created_at DESC" },
  "unanswered-questions": { table: "unanswered_questions", columns: "id, tenant_id, question_text, cluster_id, count, first_seen, last_seen, status, linked_faq_id", order: "last_seen DESC" }, // never the raw embedding
  "usage-events": { table: "usage_events", columns: "*", order: "id DESC" },
  "channel-connections": { table: "channel_connections", columns: "id, tenant_id, channel, phone_number_id, waba_id, display_number, template_status, status, connected_at", order: "id" }, // never token_secret_ref
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BIGINT = /^[0-9]{1,18}$/; // usage_events uses a bigint identity id

export const staffRouter = Router();
staffRouter.use(staffCors, resolveStaffTenant, requireRole("admin", "editor", "viewer"));

staffRouter.get("/me", (req, res) => res.json({ tenantId: req.tenant!.id, role: req.tenant!.role }));

staffRouter.get("/knowledge/search", async (req, res, next) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (!q || q.length > 500) return res.status(400).json({ error: "invalid_query" });
  try {
    res.json({ results: await withTenant(tenantOf(req), (tx) => searchKnowledge(tx, q, 5)) });
  } catch (err) { next(err); }
});

staffRouter.get("/:resource", async (req, res, next) => {
  const r = RESOURCES[req.params.resource!];
  if (!r) return res.status(404).json({ error: "not_found" });
  const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
  try {
    const rows = await withTenant(tenantOf(req), async (tx) => (await tx.query(`SELECT ${r.columns} FROM ${r.table} ORDER BY ${r.order} LIMIT $1`, [limit])).rows);
    res.json({ data: rows });
  } catch (err) { next(err); }
});

staffRouter.get("/:resource/:id", async (req, res, next) => {
  const r = RESOURCES[req.params.resource!];
  if (!r || !(UUID.test(req.params.id!) || BIGINT.test(req.params.id!))) return res.status(404).json({ error: "not_found" });
  try {
    const rows = await withTenant(tenantOf(req), async (tx) => (await tx.query(`SELECT ${r.columns} FROM ${r.table} WHERE id = $1`, [req.params.id])).rows);
    if (!rows[0]) return res.status(404).json({ error: "not_found" }); // another tenant's row is indistinguishable from a missing one
    res.json({ data: rows[0] });
  } catch (err) { next(err); }
});
