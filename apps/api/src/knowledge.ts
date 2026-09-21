import type { Tx } from "./db.js";
import { embed, toVector } from "./embeddings.js";
import { recordUsage } from "./usage.js";

export interface SearchHit { id: string; content: string; title: string; metadata: Record<string, unknown>; score: number }

/**
 * Vector search over the current tenant's approved knowledge. The tenant filter is written out explicitly AND
 * enforced by RLS; recall is measured after filtering (PRD Section 3). Must run inside withTenant().
 */
export async function searchKnowledge(tx: Tx, query: string, limit = 5, channel: "web" | "whatsapp" | null = null): Promise<SearchHit[]> {
  const [vector] = await embed([query], "RETRIEVAL_QUERY");
  return searchByVector(tx, vector!, limit, channel);
}

export async function searchByVector(tx: Tx, vector: number[], limit: number, channel: "web" | "whatsapp" | null = null): Promise<SearchHit[]> {
  // pgvector >= 0.8: keep scanning the HNSW index until enough rows survive the tenant filter.
  await tx.query("SET LOCAL hnsw.iterative_scan = relaxed_order");
  const { rows } = await tx.query(
    `SELECT c.id, c.content, c.metadata, d.title, 1 - (c.embedding <=> $1::vector) AS score
       FROM knowledge_chunks c
       JOIN knowledge_documents d ON d.tenant_id = c.tenant_id AND d.id = c.document_id
      WHERE c.tenant_id = current_tenant_id() AND d.approved AND c.embedding IS NOT NULL
      ORDER BY c.embedding <=> $1::vector
      LIMIT $2`,
    [toVector(vector), limit],
  );
  await recordUsage(tx, "knowledge_search", channel, { results: rows.length });
  return rows.map((r) => ({ id: r.id, content: r.content, title: r.title, metadata: r.metadata, score: Number(r.score) }));
}
