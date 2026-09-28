import type { Tx } from "./db.js";

// PRD 7: "Onboarding wizard (knowledge -> branding -> channels -> test -> go live)". Each step's "done" state
// is derived from real data (never a separately-tracked checklist that could drift from what's actually true),
// except the final step, which is the one genuinely stateful bit: a tenant explicitly says "we're live".
export async function getOnboardingStatus(tx: Tx) {
  const knowledge = (await tx.query(
    `SELECT (SELECT count(*) FROM programs WHERE status = 'approved') AS programs,
            (SELECT count(*) FROM fee_items WHERE status = 'approved') AS fees`)).rows[0];
  const branding = (await tx.query(`SELECT branding, welcome_message, onboarding_completed_at FROM tenants`)).rows[0] as
    { branding: Record<string, unknown>; welcome_message: string | null; onboarding_completed_at: string | null };
  const widget = (await tx.query(`SELECT public_key FROM widget_keys ORDER BY id LIMIT 1`)).rows[0] as { public_key: string } | undefined;

  return {
    knowledge_done: Number(knowledge.programs) > 0 && Number(knowledge.fees) > 0,
    branding_done: Boolean(branding.branding?.primary) && Boolean(branding.welcome_message),
    channels_done: Boolean(widget),
    widget_key: widget?.public_key ?? null,
    completed: Boolean(branding.onboarding_completed_at),
    completed_at: branding.onboarding_completed_at,
  };
}

export async function completeOnboarding(tx: Tx) {
  await tx.query(`UPDATE tenants SET onboarding_completed_at = now() WHERE onboarding_completed_at IS NULL`);
}
