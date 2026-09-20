import { z } from "zod";

// Shared zod schemas for the seed-data files in /data/<tenant>/. The API, dashboard and importers
// reuse these later (CSV/JSON import in Phase 5 validates rows against the same shapes).

const status = z.enum(["draft", "approved"]);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
const script = z.enum(["urdu", "roman_urdu", "english"]);

export const TenantFile = z.object({
  name: z.string().min(1),
  subdomain: z.string().regex(/^[a-z0-9-]+$/),
  status: z.enum(["active", "suspended"]),
  plan_label: z.string(),
  demo_label: z.string().optional(),
  branding: z.record(z.unknown()),
  welcome_message: z.string(),
  working_hours: z.record(z.unknown()),
  default_reply_script: script,
  retention_days: z.number().int().positive(),
  fee_stale_after_days: z.number().int().positive(),
  limits: z.object({
    monthly_conversation_limit: z.number().int().positive(),
    monthly_message_limit: z.number().int().positive(),
    web_enabled: z.boolean(),
    whatsapp_enabled: z.boolean(),
  }),
  localized_messages: z.record(z.enum(["welcome", "fallback", "handoff", "after_hours"]), z.record(script, z.string().min(1))),
});

export const Faculty = z.object({ key: z.string(), name: z.string(), status });
export const Campus = z.object({ key: z.string(), name: z.string(), city: z.string(), status });
export const Program = z.object({
  key: z.string(), faculty: z.string(), name: z.string(), code: z.string(),
  degree_level: z.enum(["diploma", "bachelor", "master", "doctorate"]),
  total_credit_hours: z.number().int().positive(),
  campuses: z.array(z.string()).min(1), status,
});
export const FeeItem = z.object({
  key: z.string(), program: z.string().nullable(), campus: z.string().nullable(),
  academic_year: z.string(), student_type: z.enum(["local", "international"]),
  item_type: z.enum(["tuition", "admission", "hostel", "other"]),
  amount: z.number().nonnegative(), currency: z.string().length(3),
  per: z.enum(["semester", "year", "one-time", "credit_hour"]),
  effective_from: isoDate, last_verified_at: isoDate, status, note: z.string().optional(),
});
export const Intake = z.object({
  key: z.string(), intake_name: z.string(), programs: z.literal("all").or(z.array(z.string())),
  applications_open: isoDate, application_deadline: isoDate, test_date: isoDate, classes_start: isoDate,
  last_verified_at: isoDate, status, note: z.string().optional(),
});
export const Requirement = z.object({ program: z.string(), eligibility: z.string(), required_documents: z.string(), status });
export const Scholarship = z.object({
  key: z.string(), name: z.string(), criteria: z.string(), coverage: z.string(), conditions: z.string(),
  deadline: isoDate.nullable(), status,
});
export const Faq = z.object({ question: z.string().min(5), answer: z.string().min(5), approved: z.boolean() });
