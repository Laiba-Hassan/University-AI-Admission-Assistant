-- Staff profile photo (Account settings -> Change photo). Stored the same way as tenant branding.logo: a small
-- base64 data URL in the row itself, not a real object-storage bucket -- there is no file storage anywhere in
-- this project, and a per-staff-member photo doesn't justify adding one.
ALTER TABLE tenant_users ADD COLUMN avatar_url text;
