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

  // Phase 4: public widget hardening (PRD Section 11, enforced "from the first public deployment").
  TURNSTILE_SITE_KEY: optional,   // public; handed to the widget via /api/widget/config
  TURNSTILE_SECRET_KEY: optional, // server-side verification; unset = challenge always fails closed
  // Signs the short-lived "challenge passed" token a session presents to start a new conversation.
  // A fixed dev-only default keeps local/test runs working without extra setup; production must override it.
  CHALLENGE_SIGNING_SECRET: dev ? z.string().default("dev-only-challenge-secret-do-not-use-in-prod") : z.string().min(16),
  // Hard cap on tokens (input+output, summed) spent on one conversation, so a single runaway thread can't run up cost.
  MAX_CONVERSATION_TOKENS: z.coerce.number().int().positive().default(20_000),
  // Per-window request caps for the public widget endpoints (PRD: per-IP / per-session / per-tenant).
  RATE_LIMIT_PER_IP_PER_MINUTE: z.coerce.number().int().positive().default(20),
  RATE_LIMIT_PER_SESSION_PER_MINUTE: z.coerce.number().int().positive().default(10),
  RATE_LIMIT_PER_TENANT_PER_MINUTE: z.coerce.number().int().positive().default(300),
});

export const config = Env.parse(process.env);
