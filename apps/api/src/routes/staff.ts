import { Router } from "express";
import { z } from "zod";
import { pollAlerts } from "../alerts.js";
import { choosePlan, createSetupIntent, getBillingStatus, startDemo, type Plan } from "../billing.js";
import { config } from "../config.js";
import { sendEmail } from "../email.js";
import { deletePushSubscription, savePushSubscription } from "../push.js";
import { handleMessage } from "../agent/conversation.js";
import { deliverStaffReplyOverWhatsApp } from "../whatsapp/staff-reply.js";
import { disconnectWhatsApp, saveWhatsAppConnection } from "../whatsapp/connection.js";
import { assignConversationToSelf, escalateConversation, getConversationDetail, listConversations, sendStaffReply, setConversationStatus } from "../conversations.js";
import { staffCors } from "../cors.js";
import { withTenant } from "../db.js";
import { searchKnowledge } from "../knowledge.js";
import { approveKbRow, KB_TABLES, listChangeHistory, setFaqFeatured } from "../kb.js";
import { listKbEntity, type KbEntity } from "../kb-entities.js";
import { leadsToCsv, listLeads, updateLead } from "../leads.js";
import { getOverview, type Period } from "../overview.js";
import { defaultAiExtractProvider } from "../ai-import.js";
import { getAutomationSettings, sendTestAutomationEvent, setAutomationSettings } from "../automations.js";
import { completeOnboarding, getOnboardingStatus } from "../onboarding.js";
import { approvePasswordChange, consumePasswordChangeApproval, ensureWidgetKey, getBranding, getChannels, getMessages, getRetention, getTeam, getUsageSummary, inviteStaff, removeTeamMember, requestPasswordChange, rotateWidgetKey, setMessage, setRetention, setWidgetOrigins, updateBranding } from "../settings.js";
import { createImportBatch, listImportDrafts, parseCsv, reviewImportDraft, validateRows, type ImportTarget } from "../import.js";
import { randomBytes, createHash } from "node:crypto";
import { draftFaqFromCluster, ignoreCluster, linkClusterToFaq, logConversationAsUnanswered } from "../unanswered.js";
import { requireRole, resolveStaffTenant, tenantOf } from "../tenancy.js";

const PERIODS = new Set<Period>(["7d", "30d", "90d", "custom"]);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

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
    const tenant = await withTenant(tenantOf(req), async (tx) =>
      (await tx.query(
        `SELECT t.name, t.plan_label, t.demo_expires_at, t.branding->>'logo' AS logo, b.payment_failed_at
           FROM tenants t LEFT JOIN tenant_billing b ON b.tenant_id = t.id`)).rows[0] as
        { name: string; plan_label: string; demo_expires_at: string | null; logo: string | null; payment_failed_at: string | null } | undefined);
    const self = await withTenant(tenantOf(req), async (tx) =>
      // Google/other OAuth sign-ins already carry a real name in the verified token (tokenName) -- the first time
      // this is seen for an account with no full_name on file yet, it's saved so the Team page (which has no
      // access to anyone else's token) can show it too. A name set later in Account Settings always wins, via
      // COALESCE(full_name, ...): this never overwrites one a staff member chose themselves.
      (await tx.query(
        `UPDATE tenant_users SET full_name = COALESCE(full_name, $2) WHERE auth_user_id = $1
         RETURNING full_name, avatar_url, password_change_requested_at, password_change_approved_at`,
        [req.tenant!.authUserId, req.tenant!.tokenName ?? null])).rows[0] as
        { full_name: string | null; avatar_url: string | null; password_change_requested_at: string | null; password_change_approved_at: string | null } | undefined);
    // Everyone goes through the same request/approve dance now -- an Editor/Viewer's request is approved by a
    // tenant Admin (settings.ts's approvePasswordChange with requireAdminTarget=false), an Admin's own request
    // can only be approved by the platform (Super Admin) team, via POST /api/platform/.../approve-password-change
    // (requireAdminTarget=true) -- never by a fellow tenant Admin. Same three states either way.
    const passwordChangeStatus = self?.password_change_approved_at ? "approved"
      : self?.password_change_requested_at ? "pending" : "none";
    res.json({
      tenantId: req.tenant!.id, role: req.tenant!.role, tenantName: tenant?.name, planLabel: tenant?.plan_label, tenantLogo: tenant?.logo ?? null,
      demoExpiresAt: tenant?.demo_expires_at ?? null, paymentFailedAt: tenant?.payment_failed_at ?? null,
      fullName: self?.full_name ?? null, avatarUrl: self?.avatar_url ?? null, passwordChangeStatus,
    });
  } catch (err) { next(err); }
});
staffRouter.post("/me/password-change-request", async (req, res, next) => {
  try {
    await withTenant(tenantOf(req), (tx) => requestPasswordChange(tx, req.tenant!.authUserId!));
    res.status(204).end();
  } catch (err) { next(err); }
});
// Called by the client right after supabase.auth.updateUser({password}) actually succeeds -- our backend has no
// visibility into that call (it goes straight to Supabase, not through this API), so it can't detect "they just
// changed it" on its own. This is what makes an approval single-use instead of a standing bypass.
staffRouter.post("/me/password-change-consumed", async (req, res, next) => {
  try {
    await withTenant(tenantOf(req), (tx) => consumePasswordChangeApproval(tx, req.tenant!.authUserId!));
    res.status(204).end();
  } catch (err) { next(err); }
});
const MePatch = z.object({ avatar_url: z.string().max(400_000).nullable().optional(), full_name: z.string().trim().min(1).max(200).optional() });
staffRouter.patch("/me", async (req, res, next) => {
  const body = MePatch.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "invalid_request" });
  try {
    await withTenant(tenantOf(req), async (tx) => {
      if ("avatar_url" in body.data) await tx.query(`UPDATE tenant_users SET avatar_url = $1 WHERE auth_user_id = $2`, [body.data.avatar_url, req.tenant!.authUserId]);
      if (body.data.full_name !== undefined) await tx.query(`UPDATE tenant_users SET full_name = $1 WHERE auth_user_id = $2`, [body.data.full_name, req.tenant!.authUserId]);
    });
    res.status(204).end();
  } catch (err) { next(err); }
});

staffRouter.get("/overview", async (req, res, next) => {
  const period = (typeof req.query.period === "string" && PERIODS.has(req.query.period as Period) ? req.query.period : "30d") as Period;
  let custom: { from: Date; to: Date } | undefined;
  if (period === "custom") {
    const start = req.query.start, end = req.query.end;
    if (typeof start !== "string" || typeof end !== "string" || !DATE.test(start) || !DATE.test(end)) return res.status(400).json({ error: "invalid_request" });
    const from = new Date(`${start}T00:00:00.000Z`), to = new Date(`${end}T23:59:59.999Z`);
    if (!(from < to)) return res.status(400).json({ error: "invalid_request" });
    custom = { from, to };
  }
  try {
    res.json(await withTenant(tenantOf(req), (tx) => getOverview(tx, period, custom)));
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
    const result = await withTenant(tenantOf(req), async (tx) => {
      const staffRow = (await tx.query(`SELECT id FROM tenant_users WHERE auth_user_id = $1`, [req.tenant!.authUserId])).rows[0] as { id: string } | undefined;
      if (!staffRow) return { ok: false as const, error: "not_found" as const };
      const sent = await sendStaffReply(tx, req.params.id!, body.data.text, staffRow.id);
      if (!sent.ok) return sent;
      // WhatsApp two-way handoff (PRD 6A/6.3): a web conversation, or one with no WhatsApp connection, makes
      // this a no-op -- the reply already exists for the dashboard either way.
      const delivery = await deliverStaffReplyOverWhatsApp(tx, req.params.id!, body.data.text);
      return { ok: true as const, msg: sent.message, delivery };
    });
    if (!result.ok) return res.status(404).json({ error: "not_found" });
    res.status(201).json({ ...result.msg, delivery: result.delivery });
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

staffRouter.post("/conversations/:id/log-unanswered", requireRole("admin", "editor"), async (req, res, next) => {
  if (!UUID.test(req.params.id!)) return res.status(404).json({ error: "not_found" });
  try {
    const result = await withTenant(tenantOf(req), (tx) => logConversationAsUnanswered(tx, req.params.id!));
    if (!result) return res.status(404).json({ error: "not_found" });
    res.status(201).json(result);
  } catch (err) { next(err); }
});

staffRouter.get("/leads", async (req, res, next) => {
  const q = req.query;
  if ((typeof q.from === "string" && q.from && !DATE.test(q.from)) || (typeof q.to === "string" && q.to && !DATE.test(q.to))) {
    return res.status(400).json({ error: "invalid_request" });
  }
  try {
    const data = await withTenant(tenantOf(req), (tx) => listLeads(tx, {
      status: typeof q.status === "string" && ["new", "contacted", "enrolled"].includes(q.status) ? q.status as never : undefined,
      search: typeof q.search === "string" ? q.search.slice(0, 200) : undefined,
      from: typeof q.from === "string" && q.from ? new Date(`${q.from}T00:00:00.000Z`) : undefined,
      to: typeof q.to === "string" && q.to ? new Date(`${q.to}T23:59:59.999Z`) : undefined,
      limit: Math.min(Math.max(Number(q.limit) || 200, 1), 1000),
    }));
    res.json({ data });
  } catch (err) { next(err); }
});

// RBAC audit finding: bulk-exporting every lead's PII as a CSV is a materially different action than viewing
// leads one at a time in the UI (GET /leads, any staff role) -- restricted the same as editing a lead.
staffRouter.get("/leads/export.csv", requireRole("admin", "editor"), async (req, res, next) => {
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

// The Knowledge Base Editor's per-entity table: joined display fields (faculty/campus names, program counts)
// plus one real validation warning, richer than the generic /:resource route below can express -- registered
// before it so this exact path wins.
staffRouter.get("/kb-entities/:entity", async (req, res, next) => {
  if (!KB_TABLES[req.params.entity!]) return res.status(404).json({ error: "not_found" });
  try {
    const result = await withTenant(tenantOf(req), (tx) => listKbEntity(tx, req.params.entity as KbEntity));
    res.json({ data: result.rows, warning: result.warning });
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
const FaqFeature = z.object({ featured: z.boolean() });
staffRouter.post("/kb/faqs/:id/feature", requireRole("admin", "editor"), async (req, res, next) => {
  if (!UUID.test(req.params.id!)) return res.status(404).json({ error: "not_found" });
  const body = FaqFeature.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "invalid_request" });
  try {
    const ok = await withTenant(tenantOf(req), (tx) => setFaqFeatured(tx, req.params.id!, body.data.featured));
    if (!ok) return res.status(404).json({ error: "not_found" });
    res.status(204).end();
  } catch (err) { next(err); }
});

const IMPORT_TARGETS = new Set<ImportTarget>(["programs", "fee-items", "faqs", "scholarships", "intakes", "requirements", "faculties", "campuses"]);
const Upload = z.object({ target: z.enum(["programs", "fee-items", "faqs", "scholarships", "intakes", "requirements", "faculties", "campuses"]), format: z.enum(["csv", "json"]), content: z.string().min(1).max(2_000_000) });

staffRouter.post("/import/upload", requireRole("admin", "editor"), async (req, res, next) => {
  const body = Upload.safeParse(req.body);
  if (!body.success || !IMPORT_TARGETS.has(body.data.target)) return res.status(400).json({ error: "invalid_request" });
  let rows: Record<string, string>[];
  try {
    rows = body.data.format === "csv" ? parseCsv(body.data.content) : JSON.parse(body.data.content);
    if (!Array.isArray(rows)) throw new Error("not an array");
  } catch {
    return res.status(400).json({ error: "unparseable_content" });
  }
  if (rows.length === 0) return res.status(400).json({ error: "no_rows" });
  if (rows.length > 2000) return res.status(400).json({ error: "too_many_rows" });
  const staged = validateRows(body.data.target, rows);
  try {
    const batchId = await withTenant(tenantOf(req), async (tx) => {
      const staffRow = (await tx.query(`SELECT id FROM tenant_users WHERE auth_user_id = $1`, [req.tenant!.authUserId])).rows[0] as { id: string } | undefined;
      return createImportBatch(tx, body.data.format, body.data.target, staged, staffRow?.id ?? null);
    });
    res.status(201).json({ batch_id: batchId, staged: staged.filter((s) => s.ok).length, rejected: staged.filter((s) => !s.ok) });
  } catch (err) { next(err); }
});

// PRD 7: "AI-assisted import with mandatory staged human review". Extraction only -- everything from here on
// (validateRows, createImportBatch, the accept/reject/edit review flow) is the exact same pipeline
// /import/upload already uses, so a row an AI extracted gets exactly as much scrutiny as a row from a hand-built
// CSV, never less.
const AiExtract = z.object({ target: z.enum(["programs", "fee-items", "faqs", "scholarships", "intakes", "requirements", "faculties", "campuses"]), text: z.string().trim().min(1).max(50_000) });
staffRouter.post("/import/ai-extract", requireRole("admin", "editor"), async (req, res, next) => {
  const body = AiExtract.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "invalid_request" });
  let rows: Record<string, string>[];
  try {
    rows = await defaultAiExtractProvider.extract(body.data.target, body.data.text);
  } catch (err) {
    console.error("ai-import extraction failed:", err instanceof Error ? err.message : err);
    return res.status(503).json({ error: "extraction_unavailable" });
  }
  if (rows.length === 0) return res.status(422).json({ error: "nothing_extracted" });
  if (rows.length > 500) rows = rows.slice(0, 500); // a runaway extraction still lands as a reviewable, bounded batch
  const staged = validateRows(body.data.target, rows);
  try {
    const batchId = await withTenant(tenantOf(req), async (tx) => {
      const staffRow = (await tx.query(`SELECT id FROM tenant_users WHERE auth_user_id = $1`, [req.tenant!.authUserId])).rows[0] as { id: string } | undefined;
      return createImportBatch(tx, "json", body.data.target, staged, staffRow?.id ?? null);
    });
    res.status(201).json({ batch_id: batchId, staged: staged.filter((s) => s.ok).length, rejected: staged.filter((s) => !s.ok) });
  } catch (err) { next(err); }
});

staffRouter.get("/import/drafts", async (req, res, next) => {
  try {
    res.json({ data: await withTenant(tenantOf(req), (tx) => listImportDrafts(tx, typeof req.query.batch_id === "string" ? req.query.batch_id : undefined)) });
  } catch (err) { next(err); }
});

const Review = z.object({ action: z.enum(["accept", "reject"]), payload: z.record(z.unknown()).optional() });
staffRouter.post("/import/drafts/:id/review", requireRole("admin", "editor"), async (req, res, next) => {
  if (!UUID.test(req.params.id!)) return res.status(404).json({ error: "not_found" });
  const body = Review.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "invalid_request" });
  try {
    const result = await withTenant(tenantOf(req), async (tx) => {
      const staffRow = (await tx.query(`SELECT id FROM tenant_users WHERE auth_user_id = $1`, [req.tenant!.authUserId])).rows[0] as { id: string } | undefined;
      return reviewImportDraft(tx, req.params.id!, body.data.action, staffRow?.id ?? null, body.data.payload);
    });
    if (!result.ok) return res.status(result.error === "not_found" ? 404 : 400).json(result);
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
// Guided manual WhatsApp connection (PRD 6.2's fallback to Meta Embedded Signup, which needs Tech Provider
// approval this project doesn't have): an admin pastes in credentials from their own Meta Business/App dashboard.
const ConnectWhatsApp = z.object({
  phone_number_id: z.string().trim().min(1), waba_id: z.string().trim().min(1).optional(),
  display_number: z.string().trim().min(1).optional(), access_token: z.string().trim().min(1),
  template_name: z.string().trim().min(1).optional(),
});
staffRouter.post("/settings/channels/whatsapp", requireRole("admin"), async (req, res, next) => {
  const body = ConnectWhatsApp.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "invalid_request" });
  try {
    const result = await withTenant(tenantOf(req), async (tx) => {
      // The real gate: Channels already hides the connect form behind this same flag, but the plan is only
      // actually enforced here -- a direct API call must refuse exactly like the UI implies it would.
      const whatsappEnabled = (await tx.query(`SELECT whatsapp_enabled FROM tenant_limits`)).rows[0]?.whatsapp_enabled as boolean ?? false;
      if (!whatsappEnabled) return { blocked: true as const };
      return { blocked: false as const, saved: await saveWhatsAppConnection(tx, {
        phoneNumberId: body.data.phone_number_id, wabaId: body.data.waba_id, displayNumber: body.data.display_number,
        accessToken: body.data.access_token, templateName: body.data.template_name,
      }) };
    });
    if (result.blocked) return res.status(403).json({ error: "plan_upgrade_required" });
    res.status(201).json(result.saved);
  } catch (err) { next(err); }
});
staffRouter.post("/settings/channels/whatsapp/disconnect", requireRole("admin"), async (req, res, next) => {
  try { await withTenant(tenantOf(req), disconnectWhatsApp); res.status(204).end(); } catch (err) { next(err); }
});

// Web widget: a tenant has no way to get a public_key at all until this exists -- ensureWidgetKey creates one
// the first time an admin sets up the web channel (onboarding's Channels step, or this settings page directly).
const WidgetOrigins = z.object({ allowed_origins: z.array(z.string().trim().url()).max(20) });
staffRouter.post("/settings/channels/widget", requireRole("admin"), async (req, res, next) => {
  const body = WidgetOrigins.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "invalid_request" });
  try { res.status(201).json(await withTenant(tenantOf(req), (tx) => ensureWidgetKey(tx, body.data.allowed_origins))); } catch (err) { next(err); }
});
staffRouter.patch("/settings/channels/widget", requireRole("admin"), async (req, res, next) => {
  const body = WidgetOrigins.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "invalid_request" });
  try { await withTenant(tenantOf(req), (tx) => setWidgetOrigins(tx, body.data.allowed_origins)); res.status(204).end(); } catch (err) { next(err); }
});
staffRouter.post("/settings/channels/widget/rotate", requireRole("admin"), async (req, res, next) => {
  try { res.json({ public_key: await withTenant(tenantOf(req), rotateWidgetKey) }); } catch (err) { next(err); }
});
staffRouter.get("/settings/branding", async (req, res, next) => {
  try { res.json(await withTenant(tenantOf(req), getBranding)); } catch (err) { next(err); }
});
const BrandingPatch = z.object({
  branding: z.object({ primary: z.string().optional(), accent: z.string().optional(), tagline: z.string().optional(), logo: z.string().max(400_000).nullable().optional() }).partial().optional(),
  working_hours: z.object({ tz: z.string(), mon_fri: z.string().nullable(), sat: z.string().nullable(), sun: z.string().nullable() }).optional(),
  welcome_message: z.string().trim().min(1).max(1000).optional(),
});
staffRouter.patch("/settings/branding", requireRole("admin", "editor"), async (req, res, next) => {
  const body = BrandingPatch.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "invalid_request" });
  try {
    await withTenant(tenantOf(req), (tx) => updateBranding(tx, body.data));
    res.status(204).end();
  } catch (err) { next(err); }
});
staffRouter.get("/settings/automations", async (req, res, next) => {
  try { res.json(await withTenant(tenantOf(req), getAutomationSettings)); } catch (err) { next(err); }
});
const AutomationsPatch = z.object({ webhook_url: z.string().trim().url().max(2000).nullable().optional(), enabled: z.boolean().optional() });
staffRouter.patch("/settings/automations", requireRole("admin"), async (req, res, next) => {
  const body = AutomationsPatch.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "invalid_request" });
  try {
    await withTenant(tenantOf(req), (tx) => setAutomationSettings(tx, body.data));
    res.status(204).end();
  } catch (err) { next(err); }
});
staffRouter.post("/settings/automations/test", requireRole("admin"), async (req, res, next) => {
  try {
    const result = await withTenant(tenantOf(req), (tx) => sendTestAutomationEvent(tx));
    res.status(result.ok ? 200 : 502).json(result);
  } catch (err) { next(err); }
});
staffRouter.get("/onboarding/status", async (req, res, next) => {
  try { res.json(await withTenant(tenantOf(req), getOnboardingStatus)); } catch (err) { next(err); }
});
staffRouter.post("/onboarding/complete", requireRole("admin"), async (req, res, next) => {
  try { await withTenant(tenantOf(req), completeOnboarding); res.status(204).end(); } catch (err) { next(err); }
});

// "Skip" beside Go live: starts the time-limited demo (PLAN_WHATSAPP default off) without marking onboarding
// complete -- skipping the plan choice isn't the same as finishing setup, and the admin should still see
// "Finish tenant setup" on Overview as a reminder to come back and do knowledge/branding/channels later.
staffRouter.post("/onboarding/start-demo", requireRole("admin"), async (req, res, next) => {
  try {
    await withTenant(tenantOf(req), (tx) => startDemo(tx));
    res.status(204).end();
  } catch (err) { next(err); }
});

staffRouter.get("/billing/status", async (req, res, next) => {
  try { res.json(await withTenant(tenantOf(req), getBillingStatus)); } catch (err) { next(err); }
});
// Step 1 of Update Plan / Go Live: mints a Stripe SetupIntent the dashboard confirms client-side against
// Stripe's own hosted card field -- see billing.ts for why the raw card never reaches this route at all.
staffRouter.post("/billing/setup-intent", requireRole("admin"), async (req, res, next) => {
  try {
    const intent = await withTenant(tenantOf(req), async (tx) => {
      const tenantName = (await tx.query(`SELECT name FROM tenants`)).rows[0]?.name as string | undefined;
      const email = (await tx.query(`SELECT email FROM tenant_users WHERE auth_user_id = $1`, [req.tenant!.authUserId])).rows[0]?.email as string | undefined;
      return createSetupIntent(tx, tenantName ?? "University", email ?? "");
    });
    if (!intent) return res.status(503).json({ error: "stripe_not_configured" });
    res.json(intent);
  } catch (err) { next(err); }
});
const ChoosePlan = z.object({ plan: z.enum(["starter", "growth"]), payment_method_id: z.string().trim().min(1) });
staffRouter.post("/billing/choose-plan", requireRole("admin"), async (req, res, next) => {
  const body = ChoosePlan.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "invalid_request" });
  try {
    const result = await withTenant(tenantOf(req), (tx) => choosePlan(tx, body.data.plan as Plan, body.data.payment_method_id));
    if (!result.ok) return res.status(result.error === "stripe_not_configured" ? 503 : 400).json({ error: result.error });
    res.status(204).end();
  } catch (err) { next(err); }
});
staffRouter.get("/settings/team", async (req, res, next) => {
  try { res.json({ data: await withTenant(tenantOf(req), getTeam) }); } catch (err) { next(err); }
});
staffRouter.post("/settings/team/:id/approve-password-change", requireRole("admin"), async (req, res, next) => {
  try {
    const ok = await withTenant(tenantOf(req), (tx) => approvePasswordChange(tx, req.params.id));
    if (!ok) return res.status(404).json({ error: "not_found" });
    res.status(204).end();
  } catch (err) { next(err); }
});
staffRouter.delete("/settings/team/:id", requireRole("admin"), async (req, res, next) => {
  try {
    const result = await withTenant(tenantOf(req), (tx) => removeTeamMember(tx, req.params.id, req.tenant!.authUserId!));
    if ("error" in result) {
      const status = result.error === "not_found" ? 404 : 400;
      return res.status(status).json({ error: result.error });
    }
    res.status(204).end();
  } catch (err) { next(err); }
});
const InviteStaff = z.object({ email: z.string().email(), role: z.enum(["admin", "editor", "viewer"]) });
staffRouter.post("/settings/team/invite", requireRole("admin"), async (req, res, next) => {
  const body = InviteStaff.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "invalid_request" });
  try {
    const token = randomBytes(24).toString("hex");
    const tenantName = await withTenant(tenantOf(req), async (tx) => {
      await inviteStaff(tx, body.data.email, body.data.role, createHash("sha256").update(token).digest("hex"), req.tenant!.authUserId!);
      return (await tx.query(`SELECT name FROM tenants`)).rows[0]?.name as string | undefined;
    });
    // The raw token only ever exists here and in the email below, exactly like a password-reset link -- the DB
    // keeps only its hash (staff_invites.token_hash), so accepting an invite later verifies without storing the
    // secret itself. req.header("origin") is the dashboard's own URL, the same one the frontend used to build
    // this link itself before email delivery existed -- not configurable, read straight off the real request.
    const origin = req.header("origin") ?? "";
    const link = `${origin}/accept-invite?token=${token}`;
    const emailed = origin ? await sendEmail(body.data.email, `You're invited to join ${tenantName ?? "Enrollium"}`,
      `<p>You've been invited to join <strong>${tenantName ?? "the team"}</strong> on Enrollium as a <strong>${body.data.role}</strong>.</p>
       <p><a href="${link}">Accept the invite</a> (expires in 7 days).</p>
       <p>If the link doesn't work, copy this into your browser:<br>${link}</p>`) : false;
    res.status(201).json({ invite_token: token, emailed });
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

// Sidebar nav badges (Inbox, Unanswered): a persistent absolute count, not the transient "new since I last
// looked" counter /alerts drives -- deliberately its own lightweight query rather than the full Overview payload,
// since the sidebar renders on every page.
staffRouter.get("/sidebar-counts", async (req, res, next) => {
  try {
    const counts = await withTenant(tenantOf(req), async (tx) => {
      const inbox = (await tx.query(`SELECT count(*)::int AS n FROM conversations WHERE status = 'needs_human'`)).rows[0].n as number;
      const unanswered = (await tx.query(`SELECT count(*)::int AS n FROM unanswered_questions WHERE status = 'open'`)).rows[0].n as number;
      return { inbox, unanswered };
    });
    res.json(counts);
  } catch (err) { next(err); }
});

// Web push (PRD 6A): opt-in in Settings > Notifications. The public key is not secret (it's handed to every
// subscribing browser by design), so this needs no special role, just a real staff session.
staffRouter.get("/push/vapid-public-key", (req, res) => { res.json({ key: config.VAPID_PUBLIC_KEY ?? null }); });

const PushSubscribe = z.object({ endpoint: z.string().url(), keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }) });
staffRouter.post("/push/subscribe", async (req, res, next) => {
  const body = PushSubscribe.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "invalid_request" });
  try {
    await withTenant(tenantOf(req), async (tx) => {
      const staffRow = (await tx.query(`SELECT id FROM tenant_users WHERE auth_user_id = $1`, [req.tenant!.authUserId])).rows[0] as { id: string } | undefined;
      if (staffRow) await savePushSubscription(tx, staffRow.id, body.data);
    });
    res.status(204).end();
  } catch (err) { next(err); }
});
const PushUnsubscribe = z.object({ endpoint: z.string().url() });
staffRouter.post("/push/unsubscribe", async (req, res, next) => {
  const body = PushUnsubscribe.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "invalid_request" });
  try {
    await withTenant(tenantOf(req), (tx) => deletePushSubscription(tx, body.data.endpoint));
    res.status(204).end();
  } catch (err) { next(err); }
});

staffRouter.get("/alerts", async (req, res, next) => {
  const since = typeof req.query.since === "string" && !Number.isNaN(Date.parse(req.query.since)) ? new Date(req.query.since) : new Date(Date.now() - 60_000);
  try {
    res.json({ data: await withTenant(tenantOf(req), (tx) => pollAlerts(tx, since)), server_time: new Date().toISOString() });
  } catch (err) { next(err); }
});

// Knowledge Base Editor's "Test chat" side panel: lets staff confirm a KB edit instantly against the real
// agent, without leaving the editor. Reuses the same handleMessage() core the public widget/WhatsApp channels
// call, scoped to a per-staff session id so it never collides with (or shows up mixed into) real student
// conversations in Conversations/Inbox.
const TestChat = z.object({ message: z.string().trim().min(1).max(1000) });
staffRouter.post("/kb/test-chat", async (req, res, next) => {
  const body = TestChat.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "invalid_request" });
  try {
    const externalId = `staff-test-${req.tenant!.authUserId}`;
    // If an earlier test in this same scratch conversation exercised the handoff tool (or someone escalated it
    // from the Inbox), handleMessage() would otherwise stay silent forever after -- correct for a real student
    // conversation a staff member took over, but wrong for a scratch conversation whose only purpose is to be
    // re-tested. Reset it back to open before every test-chat call.
    await withTenant(tenantOf(req), (tx) =>
      tx.query(`UPDATE conversations SET status = 'open' WHERE contact_id = (SELECT id FROM contacts WHERE external_id = $1 AND channel = 'web') AND status IN ('needs_human', 'human')`, [externalId]));
    const out = await handleMessage({ tenantId: tenantOf(req), channel: "web", externalId, text: body.data.message });
    res.json({ reply: out.reply, cards: out.cards });
  } catch (err) {
    console.error("kb test-chat failed:", err instanceof Error ? err.message : err);
    res.status(503).json({ error: "unavailable" });
  }
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
