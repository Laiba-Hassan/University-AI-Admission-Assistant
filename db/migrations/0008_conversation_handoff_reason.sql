-- The Inbox list shows a short reason chip per waiting conversation ("Complaint", "Visa question", "Asked for a
-- person", ...). escalateConversation() already takes a free-text reason but only ever wrote it into the
-- event_outbox payload (a one-shot notification), not onto the conversation itself, so it couldn't be read back
-- for the list. Stored here instead, alongside the outbox event, so both the badge and Reassign banner have
-- something real to show.
ALTER TABLE conversations ADD COLUMN handoff_reason text;
