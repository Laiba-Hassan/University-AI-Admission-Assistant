-- A student who gives both a phone number and an email had no way to keep both: capture_lead's `contact` is a
-- single free-text field, so the model had to pick just one. alt_contact holds whichever second value (phone or
-- email) the student also gave, so staff can reach them either way.
ALTER TABLE leads ADD COLUMN alt_contact text;
