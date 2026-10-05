-- Staff replies carried no record of WHICH staff member sent them -- every reply just said "Staff", so once more
-- than one person worked a conversation there was no way to tell who actually answered a given message. Combined
-- with assignment enforcement (now required to send a reply at all, see conversations.ts's sendStaffReply), this
-- is what makes "who replied" an actual fact instead of a guess.
ALTER TABLE messages ADD COLUMN sent_by uuid REFERENCES tenant_users(id);
