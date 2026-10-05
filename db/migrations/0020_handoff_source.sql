-- The Resolution chart counted every handoff as one "Escalated" slice, so a university could not tell how many
-- conversations the AI gave up on from how many students asked for a person outright -- two very different
-- signals (the first says the knowledge base has a gap, the second is just students preferring a human).
-- handoff_reason already existed but is only ever written by a staff member escalating from the dashboard, so it
-- cannot distinguish the other two paths. This records which of the three writers caused the transition.
ALTER TABLE conversations ADD COLUMN handoff_source text
  CHECK (handoff_source IN ('ai', 'student', 'staff'));

-- Backfill what is actually knowable: before this column existed, only escalateConversation() wrote
-- handoff_reason, so an escalated conversation that has one came from a staff member. The rest are genuinely
-- ambiguous (AI or student) and stay NULL rather than being guessed at -- the chart labels those "Unrecorded".
UPDATE conversations SET handoff_source = 'staff'
 WHERE handoff_source IS NULL AND handoff_reason IS NOT NULL AND status IN ('needs_human', 'human');
