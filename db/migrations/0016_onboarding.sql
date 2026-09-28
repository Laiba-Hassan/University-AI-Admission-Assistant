-- Phase 7: "Onboarding wizard (knowledge -> branding -> channels -> test -> go live)". Completion is tracked
-- per tenant so the Overview page's "Finish tenant setup" link can actually reflect real state instead of
-- always showing, and so the wizard itself knows whether to show a completed "Go live" step or the live form.
ALTER TABLE tenants ADD COLUMN onboarding_completed_at timestamptz;
