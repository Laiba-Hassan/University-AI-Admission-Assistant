import { Router } from "express";
import { z } from "zod";
import { assignConversationToSelf, escalateConversation, getConversationDetail, listConversations, sendStaffReply, setConversationStatus } from "../conversations.js";
import { staffCors } from "../cors.js";
import { withTenant } from "../db.js";
import { searchKnowledge } from "../knowledge.js";
import { approveKbRow, KB_TABLES, listChangeHistory } from "../kb.js";
import { leadsToCsv, listLeads, updateLead } from "../leads.js";
import { getOverview, type Period } from "../overview.js";
import { getBranding, getChannels, getMessages, getRetention, getTeam, getUsageSummary, inviteStaff, setMessage, setRetention, updateBranding } from "../settings.js";
import { randomBytes, createHash } from "node:crypto";
import { draftFaqFromCluster, ignoreCluster, linkClusterToFaq } from "../unanswered.js";
import { requireRole, resolveStaffTenant, tenantOf } from "../tenancy.js";

const PERIODS = new Set<Period>(["7d", "30d", "90d"]);

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

staffRouter.get("/me", async (req, res, next) => {
  try {
    const name = await withTenant(tenantOf(req), async (tx) => (await tx.query("SELECT name FROM tenants")).rows[0]?.name as string | undefined);
    res.json({ tenantId: req.tenant!.id, role: req.tenant!.role, tenantName: name });
  } catch (err) { next(err); }
});

staffRouter.get("/overview", async (req, res, next) => {
  const period = (typeof req.query.period === "string" && PERIODS.has(req.query.period as Period) ? req.query.period : "30d") as Period;
  try {
    res.json(await withTenant(tenantOf(req), (tx) => getOverview(tx, period)));
  } catch (err) { next(err); }
});

// A joined, filterable view of conversations (channel, status, language, has-lead, thumbs-down, search), richer
// than the generic /:resource route below can express -- registered before it so this exact path wins.
staffRouter.get("/conversations", async (req, res, next) => {
  const q = req.query;
  try {
    const data = await withTenant(tenantOf(req), (tx) => listConversations(tx, {
      channel: q.channel === "web" || q.channel === "whatsapp" ? q.channel : undefined,
      status: typeof q.status === "string" && ["open", "needs_human", "human", "closed"].includes(q.status) ? q.status as never : undefined,
      language: typeof q.language === "string" ? q.language : undefined,
      hasLead: q.has_lead === "true",
      thumbsDown: q.thumbs_down === "true",
      search: typeof q.search === "string" ? q.search.slice(0, 200) : undefined,
      limit: Math.min(Math.max(Number(q.limit) || 100, 1), 500),
    }));
    res.json({ data });
  } catch (err) { next(err); }
});

staffRouter.get("/conversations/:id/messages", async (req, res, next) => {
  if (!UUID.test(req.params.id!)) return res.status(404).json({ error: "not_found" });
  try {
    const detail = await withTenant(tenantOf(req), (tx) => getConversationDetail(tx, req.params.id!));
    if (!detail) return res.status(404).json({ error: "not_found" });
    res.json(detail);
  } catch (err) { next(err); }
});

const Escalate = z.object({ reason: z.string().trim().min(1).max(500).optional() });
staffRouter.post("/conversations/:id/escalate", requireRole("admin", "editor"), async (req, res, next) => {
  if (!UUID.test(req.params.id!)) return res.status(404).json({ error: "not_found" });
  const body = Escalate.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "invalid_request" });
  try {
    const result = await withTenant(tenantOf(req), (tx) => escalateConversation(tx, req.params.id!, body.data.reason ?? "escalated by staff"));
    res.json(result);
  } catch (err) { next(err); }
});

staffRouter.post("/conversations/:id/assign", requireRole("admin", "editor"), async (req, res, next) => {
  if (!UUID.test(req.params.id!)) return res.status(404).json({ error: "not_found" });
  try {
    res.json(await withTenant(tenantOf(req), (tx) => assignConversationToSelf(tx, req.params.id!, req.tenant!.authUserId!)));
  } catch (err) { next(err); }
});

const Reply = z.object({ text: z.string().trim().min(1).max(4000) });
staffRouter.post("/conversations/:id/reply", requireRole("admin", "editor"), async (req, res, next) => {
  if (!UUID.test(req.params.id!)) return res.status(404).json({ error: "not_found" });
  const body = Reply.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "invalid_request" });
  try {
    const msg = await withTenant(tenantOf(req), (tx) => sendStaffReply(tx, req.params.id!, body.data.text));
    if (!msg) return res.status(404).json({ error: "not_found" });
    res.status(201).json(msg);
  } catch (err) { next(err); }
});

const StatusChange = z.object({ status: z.enum(["open", "closed"]) });
staffRouter.post("/conversations/:id/status", requireRole("admin", "editor"), async (req, res, next) => {
  if (!UUID.test(req.params.id!)) return res.status(404).json({ error: "not_found" });
  const body = StatusChange.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "invalid_request" });
  try {
    const result = await withTenant(tenantOf(req), (tx) => setConversationStatus(tx, req.params.id!, body.data.status));
    if (!result.updated) return res.status(404).json({ error: "not_found" });
    res.json(result);
  } catch (err) { next(err); }
});

staffRouter.get("/leads", async (req, res, next) => {
  const q = req.query;
  try {
    const data = await withTenant(tenantOf(req), (tx) => listLeads(tx, {
      status: typeof q.status === "string" && ["new", "contacted", "enrolled"].includes(q.status) ? q.status as never : undefined,
      search: typeof q.search === "string" ? q.search.slice(0, 200) : undefined,
      limit: Math.min(Math.max(Number(q.limit) || 200, 1), 1000),
    }));
    res.json({ data });
  } catch (err) { next(err); }
});

staffRouter.get("/leads/export.csv", async (req, res, next) => {
  try {
    const data = await withTenant(tenantOf(req), (tx) => listLeads(tx, { limit: 5000 }));
    res.setHeader("content-type", "text/csv; charset=utf-8");
    res.setHeader("content-disposition", "attachment; filename=leads.csv");
    res.send(leadsToCsv(data as never));
  } catch (err) { next(err); }
});

const LeadPatch = z.object({ status: z.enum(["new", "contacted", "enrolled"]).optional(), notes: z.string().max(2000).optional(), assign_to_me: z.boolean().optional() });
staffRouter.patch("/leads/:id", requireRole("admin", "editor"), async (req, res, next) => {
  if (!UUID.test(req.params.id!)) return res.status(404).json({ error: "not_found" });
  const body = LeadPatch.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "invalid_request" });
  try {
    const ok = await withTenant(tenantOf(req), (tx) => updateLead(tx, req.params.id!, {
      status: body.data.status, notes: body.data.notes, assignToSelf: body.data.assign_to_me ? req.tenant!.authUserId : undefined,
    }));
    if (!ok) return res.status(404).json({ error: "not_found" });
    res.status(204).end();
  } catch (err) { next(err); }
});

const DraftFaq = z.object({ answer: z.string().trim().min(1).max(4000) });
staffRouter.post("/unanswered-questions/:id/draft-faq", requireRole("admin", "editor"), async (req, res, next) => {
  if (!UUID.test(req.params.id!)) return res.status(404).json({ error: "not_found" });
  const body = DraftFaq.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "invalid_request" });
  try {
    const result = await withTenant(tenantOf(req), (tx) => draftFaqFromCluster(tx, req.params.id!, body.data.answer));
    if (!result) return res.status(404).json({ error: "not_found" });
    res.status(201).json(result);
  } catch (err) { next(err); }
});

const LinkFaq = z.object({ faq_id: z.string().uuid() });
staffRouter.post("/unanswered-questions/:id/link", requireRole("admin", "editor"), async (req, res, next) => {
  if (!UUID.test(req.params.id!)) return res.status(404).json({ error: "not_found" });
  const body = LinkFaq.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "invalid_request" });
  try {
    const ok = await withTenant(tenantOf(req), (tx) => linkClusterToFaq(tx, req.params.id!, body.data.faq_id));
    if (!ok) return res.status(404).json({ error: "not_found" });
    res.status(204).end();
  } catch (err) { next(err); }
});

staffRouter.post("/unanswered-questions/:id/ignore", requireRole("admin", "editor"), async (req, res, next) => {
  if (!UUID.test(req.params.id!)) return res.status(404).json({ error: "not_found" });
  try {
    const ok = await withTenant(tenantOf(req), (tx) => ignoreCluster(tx, req.params.id!));
    if (!ok) return res.status(404).json({ error: "not_found" });
    res.status(204).end();
  } catch (err) { next(err); }
});

staffRouter.post("/kb/:entity/:id/approve", requireRole("admin", "editor"), async (req, res, next) => {
  if (!KB_TABLES[req.params.entity!] || !UUID.test(req.params.id!)) return res.status(404).json({ error: "not_found" });
  try {
    const result = await withTenant(tenantOf(req), async (tx) => {
      const staffRow = (await tx.query(`SELECT id FROM tenant_users WHERE auth_user_id = $1`, [req.tenant!.authUserId])).rows[0] as { id: string } | undefined;
      return approveKbRow(tx, req.params.entity!, req.params.id!, staffRow?.id ?? null);
    });
    if (!result?.approved) return res.status(404).json({ error: "not_found" });
    res.status(204).end();
  } catch (err) { next(err); }
});

staffRouter.get("/change-history", async (req, res, next) => {
  try {
    res.json({ data: await withTenant(tenantOf(req), (tx) => listChangeHistory(tx, Math.min(Math.max(Number(req.query.limit) || 100, 1), 500))) });
  } catch (err) { next(err); }
});

staffRouter.get("/settings/usage", async (req, res, next) => {
  try { res.json(await withTenant(tenantOf(req), getUsageSummary)); } catch (err) { next(err); }
});
staffRouter.get("/settings/channels", async (req, res, next) => {
  try { res.json(await withTenant(tenantOf(req), getChannels)); } catch (err) { next(err); }
});
staffRouter.get("/settings/branding", async (req, res, next) => {
  try { res.json(await withTenant(tenantOf(req), getBranding)); } catch (err) { next(err); }
});
const BrandingPatch = z.object({
  branding: z.object({ primary: z.string().optional(), accent: z.string().optional(), tagline: z.string().optional() }).partial().optional(),
  working_hours: z.object({ tz: z.string(), mon_fri: z.string().nullable(), sat: z.string().nullable(), sun: z.string().nullable() }).optional(),
});
staffRouter.patch("/settings/branding", requireRole("admin", "editor"), async (req, res, next) => {
  const body = BrandingPatch.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "invalid_request" });
  try {
    await withTenant(tenantOf(req), (tx) => updateBranding(tx, body.data));
    res.status(204).end();
  } catch (err) { next(err); }
});
staffRouter.get("/settings/team", async (req, res, next) => {
  try { res.json({ data: await withTenant(tenantOf(req), getTeam) }); } catch (err) { next(err); }
});
const InviteStaff = z.object({ email: z.string().email(), role: z.enum(["admin", "editor", "viewer"]) });
staffRouter.post("/settings/team/invite", requireRole("admin"), async (req, res, next) => {
  const body = InviteStaff.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "invalid_request" });
  try {
    const token = randomBytes(24).toString("hex");
    await withTenant(tenantOf(req), (tx) => inviteStaff(tx, body.data.email, body.data.role, createHash("sha256").update(token).digest("hex"), req.tenant!.authUserId!));
    // The raw token is returned once, here, exactly like a password-reset link -- it is never stored or logged,
    // only its hash is (staff_invites.token_hash), so accepting an invite later can be verified without keeping
    // a copy of the secret itself. Emailing this link is a separate delivery concern (n8n, Phase 7).
    res.status(201).json({ invite_token: token });
  } catch (err) { next(err); }
});
staffRouter.get("/settings/messages", async (req, res, next) => {
  try { res.json({ data: await withTenant(tenantOf(req), getMessages) }); } catch (err) { next(err); }
});
const MessagePatch = z.object({ key: z.enum(["welcome", "fallback", "handoff", "after_hours"]), language: z.enum(["english", "roman_urdu", "urdu"]), text: z.string().trim().min(1).max(1000) });
staffRouter.patch("/settings/messages", requireRole("admin", "editor"), async (req, res, next) => {
  const body = MessagePatch.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "invalid_request" });
  try {
    await withTenant(tenantOf(req), (tx) => setMessage(tx, body.data.key, body.data.language, body.data.text));
    res.status(204).end();
  } catch (err) { next(err); }
});

staffRouter.get("/settings/retention", async (req, res, next) => {
  try { res.json(await withTenant(tenantOf(req), getRetention)); } catch (err) { next(err); }
});
const RetentionPatch = z.object({ retention_days: z.number().int().min(1).max(3650) });
staffRouter.patch("/settings/retention", requireRole("admin"), async (req, res, next) => {
  const body = RetentionPatch.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "invalid_request" });
  try {
    await withTenant(tenantOf(req), (tx) => setRetention(tx, body.data.retention_days));
    res.status(204).end();
  } catch (err) { next(err); }
});

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
