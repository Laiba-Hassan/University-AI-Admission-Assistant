import { createClient } from "@supabase/supabase-js";

// The project ref (puhcssmfsmklyabpswmr) matches the staging Postgres connection string in .env.staging.example;
// defaulting the URL from it means only the anon key -- safe to publish, unlike the JWT secret -- needs setting.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://puhcssmfsmklyabpswmr.supabase.co";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Left undefined (not thrown) when the anon key isn't set yet, so the rest of the app -- and typecheck/build --
// still work; sign-in/sign-up pages check for this and show a clear "auth not configured" state instead of a
// crash, since this dashboard is developed against a real Supabase project that not every environment has yet.
export const supabase = anonKey ? createClient(url, anonKey) : null;
