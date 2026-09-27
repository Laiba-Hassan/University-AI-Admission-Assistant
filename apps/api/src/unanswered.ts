import type { Tx } from "./db.js";

/** Drafts a new FAQ from an unanswered-question cluster and links it, closing the cluster out. The FAQ starts
 * unapproved: an editor/admin still has to review and approve the drafted answer before students see it. */
export async function draftFaqFromCluster(tx: Tx, id: string, answer: string) {
  const cluster = (await tx.query(`SELECT question_text FROM unanswered_questions WHERE id = $1`, [id])).rows[0] as { question_text: string } | undefined;
  if (!cluster) return null;
  const faq = (await tx.query(`INSERT INTO faqs (tenant_id, question, answer, approved) VALUES (current_tenant_id(), $1, $2, false) RETURNING id`, [cluster.question_text, answer])).rows[0] as { id: string };
  await tx.query(`UPDATE unanswered_questions SET status = 'answered', linked_faq_id = $1 WHERE id = $2`, [faq.id, id]);
  return { faqId: faq.id };
}

export async function linkClusterToFaq(tx: Tx, id: string, faqId: string) {
  const faq = await tx.query(`SELECT id FROM faqs WHERE id = $1`, [faqId]);
  if (!faq.rowCount) return false;
  const updated = await tx.query(`UPDATE unanswered_questions SET status = 'answered', linked_faq_id = $1 WHERE id = $2 RETURNING id`, [faqId, id]);
  return !!updated.rowCount;
}

/** "Add to Unanswered log" (Conversations detail footer): a staff member manually flags the student's last
 * message as something the assistant should have had a better answer for, even though the assistant itself
 * didn't flag it. Reuses the same open-cluster-by-exact-text matching the agent's own auto-logging does; no
 * embedding is computed here (best-effort only in the agent path too), so this can cluster later once one exists. */
export async function logConversationAsUnanswered(tx: Tx, conversationId: string) {
  const lastUser = (await tx.query(
    `SELECT content FROM messages WHERE conversation_id = $1 AND role = 'user' ORDER BY "timestamp" DESC LIMIT 1`, [conversationId]
  )).rows[0] as { content: string } | undefined;
  if (!lastUser) return null;
  const hit = await tx.query(
    `UPDATE unanswered_questions SET count = count + 1, last_seen = now() WHERE lower(question_text) = lower($1) AND status = 'open' RETURNING id`,
    [lastUser.content]);
  if (hit.rowCount) return { id: hit.rows[0]!.id as string, created: false };
  const inserted = (await tx.query(
    `INSERT INTO unanswered_questions (tenant_id, question_text) VALUES (current_tenant_id(), $1) RETURNING id`, [lastUser.content]
  )).rows[0] as { id: string };
  return { id: inserted.id, created: true };
}

export async function ignoreCluster(tx: Tx, id: string) {
  const updated = await tx.query(`UPDATE unanswered_questions SET status = 'ignored' WHERE id = $1 RETURNING id`, [id]);
  return !!updated.rowCount;
}
