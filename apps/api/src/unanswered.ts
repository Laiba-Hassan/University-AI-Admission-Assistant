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

export async function ignoreCluster(tx: Tx, id: string) {
  const updated = await tx.query(`UPDATE unanswered_questions SET status = 'ignored' WHERE id = $1 RETURNING id`, [id]);
  return !!updated.rowCount;
}
