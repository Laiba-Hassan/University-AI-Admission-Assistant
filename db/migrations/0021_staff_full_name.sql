-- The Team page only ever had email to show (tenant_users carried no name at all), even though Google sign-in
-- already hands Supabase a real display name in the auth user's own metadata. Giving tenant_users its own column
-- means the name survives independent of what's in the token on any given request, and lets a staff member
-- override it later from Account Settings.
ALTER TABLE tenant_users ADD COLUMN full_name text;
