import { z } from "zod";

// Defaults are the docker-compose development credentials. Production must set every URL explicitly.
const dev = process.env.NODE_ENV !== "production";
const url = (fallback: string) => (dev ? z.string().url().default(fallback) : z.string().url());
const optional = z.string().optional().transform((v) => v || undefined);

const Env = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().default(3001),
  DATABASE_URL: url("postgres://app_user:app_dev@localhost:5433/admission"),
  DATABASE_URL_MIGRATOR: url("postgres://app_migrator:migrator_dev@localhost:5433/admission"),
  DATABASE_URL_QUEUE: url("postgres://app_queue:queue_dev@localhost:5433/admission"),
  GEMINI_API_KEY: optional,
  // Chat model. Chosen by the Phase 3 bake-off on the eval set; overridable per environment.
  LLM_MODEL: z.string().default("gemini-3.6-flash"),
  // Gemini 3 "thinking" depth: minimal | low | medium | high ("" = model default). Lower is faster and cheaper.
  LLM_THINKING_LEVEL: z.string().default("low"),
  // Minimum cosine similarity for a retrieved chunk to count as an answer (below it = "unanswered").
  RETRIEVAL_MIN_SCORE: z.coerce.number().default(0.6),
  SUPABASE_JWKS_URL: optional,
  SUPABASE_JWT_SECRET: optional,
  WHATSAPP_APP_SECRET: optional,
  WHATSAPP_VERIFY_TOKEN: optional,
});

export const config = Env.parse(process.env);
