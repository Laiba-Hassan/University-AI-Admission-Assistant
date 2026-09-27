-- Two small, additive columns the Knowledge Base Editor's reference design surfaces per entity, and that are
-- genuinely useful admissions data (not just cosmetic): how many seats an intake has, and a campus's street
-- address. Nullable, no backfill required, nothing existing depends on their absence.
ALTER TABLE intakes ADD COLUMN seats integer CHECK (seats IS NULL OR seats > 0);
ALTER TABLE campuses ADD COLUMN address text;
