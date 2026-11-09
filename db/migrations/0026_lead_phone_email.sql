-- Replaces the generic contact/alt_contact free-text pair (0025, display-time-guessed as phone or email) with
-- real typed columns: the AI tool now decides phone vs email itself when it calls capture_lead, instead of the
-- dashboard pattern-matching a string after the fact. No existing lead rows to backfill (table is empty).
ALTER TABLE leads DROP COLUMN contact;
ALTER TABLE leads DROP COLUMN alt_contact;
ALTER TABLE leads ADD COLUMN phone text;
ALTER TABLE leads ADD COLUMN email text;
-- At least one contact method is always required (enforced in the capture_lead tool, mirrored here).
ALTER TABLE leads ADD CONSTRAINT leads_has_contact CHECK (phone IS NOT NULL OR email IS NOT NULL);
