import { createHash } from "node:crypto";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";

export const EMBEDDING_MODEL = "gemini-embedding-001";
export const EMBEDDING_DIMENSIONS = 768; // must match vector(768) in db/migrations/0001_schema.sql
export type TaskType = "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY";

const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:batchEmbedContents`;
const BATCH = 50;

// On-disk cache so re-seeding and the test suite don't re-bill identical text. Local only (gitignored).
const CACHE_FILE = join(dirname(fileURLToPath(import.meta.url)), "../../../.cache/embeddings.json");
let cache: Record<string, number[]> | undefined;
const loadCache = () => (cache ??= existsSync(CACHE_FILE) ? JSON.parse(readFileSync(CACHE_FILE, "utf-8")) : {});
const saveCache = () => {
  mkdirSync(dirname(CACHE_FILE), { recursive: true });
  writeFileSync(CACHE_FILE, JSON.stringify(cache));
};
const cacheKey = (text: string, task: TaskType) =>
  createHash("sha256").update(`${EMBEDDING_MODEL}|${EMBEDDING_DIMENSIONS}|${task}|${text}`).digest("hex");

// gemini-embedding-001 only returns unit-length vectors at its native 3072 dims; truncated ones must be normalised.
function normalise(v: number[]): number[] {
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / norm);
}

async function callBatch(texts: string[], task: TaskType): Promise<number[][]> {
  if (!config.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not set");
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": config.GEMINI_API_KEY },
      body: JSON.stringify({
        requests: texts.map((text) => ({
          model: `models/${EMBEDDING_MODEL}`,
          content: { parts: [{ text }] },
          taskType: task,
          outputDimensionality: EMBEDDING_DIMENSIONS,
        })),
      }),
    });
    if (res.ok) {
      const json = (await res.json()) as { embeddings: { values: number[] }[] };
      return json.embeddings.map((e) => normalise(e.values));
    }
    if ((res.status === 429 || res.status >= 500) && attempt < 6) {
      await new Promise((r) => setTimeout(r, Math.min(60_000, 2_000 * 2 ** attempt)));
      continue;
    }
    // Never echo the response body verbatim into logs that could reach users; status is enough here.
    throw new Error(`Gemini embedding request failed (HTTP ${res.status})`);
  }
}

export async function embed(texts: string[], task: TaskType): Promise<number[][]> {
  const store = loadCache();
  const out: (number[] | undefined)[] = texts.map((t) => store[cacheKey(t, task)]);
  const missing = out.flatMap((v, i) => (v ? [] : [i]));
  for (let i = 0; i < missing.length; i += BATCH) {
    const idx = missing.slice(i, i + BATCH);
    const vectors = await callBatch(idx.map((j) => texts[j]!), task);
    idx.forEach((j, k) => {
      out[j] = vectors[k];
      store[cacheKey(texts[j]!, task)] = vectors[k]!;
    });
    saveCache();
  }
  return out as number[][];
}

/** pgvector text literal. */
export const toVector = (v: number[]) => `[${v.join(",")}]`;
