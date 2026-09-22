// Applies db/migrations/*.sql in order as app_migrator, over a normal connection URL, so the same command works
// against local Docker, CI and Supabase. Applied files are recorded in schema_migrations and skipped next time.
//
//   pnpm db:migrate            apply pending migrations
//   pnpm db:migrate -- --reset drop and recreate the public schema first (LOCAL databases only)
//
// Env (defaults are the docker-compose development credentials):
//   DATABASE_URL_MIGRATOR  app_migrator, runs the migrations
//   DATABASE_URL_ADMIN     postgres/admin role, used only for the two privileged steps below
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATOR_URL = process.env.DATABASE_URL_MIGRATOR ?? "postgres://app_migrator:migrator_dev@localhost:5433/admission";
const ADMIN_URL = process.env.DATABASE_URL_ADMIN ?? "postgres://postgres:postgres@localhost:5433/admission";
const reset = process.argv.includes("--reset");

const run = async (url, fn) => {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
};
const fail = (msg) => { console.error(msg); process.exit(1); };

// --staging: run against the hosted database described in .env.staging. Every URL must be set explicitly so a missing
// one can never silently fall back to the local Docker defaults.
if (process.argv.includes("--staging")) {
  for (const v of ["DATABASE_URL", "DATABASE_URL_MIGRATOR", "DATABASE_URL_QUEUE", "DATABASE_URL_ADMIN"])
    if (!process.env[v]) fail(`--staging needs ${v} in .env.staging`);
}
console.log(`target: ${new URL(ADMIN_URL).hostname}${process.argv.includes("--staging") ? " (staging)" : ""}`);

if (reset && !["localhost", "127.0.0.1", "::1"].includes(new URL(ADMIN_URL).hostname))
  fail("--reset drops the whole public schema and is only allowed against a local database.");

try {
  // 1. Privileged step (admin role): optional reset, and let app_resolver own the SECURITY DEFINER functions.
  //    That role needs CREATE on the schema only while the migrations run, so it is granted here and revoked after.
  await run(ADMIN_URL, async (a) => {
    if (reset) {
      await a.query("DROP SCHEMA IF EXISTS pgboss CASCADE");
      await a.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO app_migrator; GRANT USAGE ON SCHEMA public TO app_user, app_resolver; CREATE EXTENSION IF NOT EXISTS vector; CREATE EXTENSION IF NOT EXISTS pgcrypto;");
      console.log("schema reset");
    }
    await a.query("GRANT CREATE ON SCHEMA public TO app_resolver");
  });

  // 2. Migrations, as app_migrator.
  await run(MIGRATOR_URL, async (m) => {
    await m.query("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
    const done = new Set((await m.query("SELECT name FROM schema_migrations")).rows.map((r) => r.name));
    const files = readdirSync(join(root, "db/migrations")).filter((f) => f.endsWith(".sql")).sort();
    if (!done.size && (await m.query("SELECT to_regclass('public.tenants') AS t")).rows[0].t)
      fail("The schema exists but schema_migrations is empty (database created before migration tracking). Run `pnpm db:migrate -- --reset` on a local database.");
    for (const f of files) {
      if (done.has(f)) continue;
      await m.query("BEGIN");
      try {
        await m.query(readFileSync(join(root, "db/migrations", f), "utf-8"));
        await m.query("INSERT INTO schema_migrations (name) VALUES ($1)", [f]);
        await m.query("COMMIT");
      } catch (e) { await m.query("ROLLBACK"); throw e; }
      console.log("applied", f);
    }
    if (files.every((f) => done.has(f))) console.log("up to date");
  });
} finally {
  await run(ADMIN_URL, (a) => a.query("REVOKE CREATE ON SCHEMA public FROM app_resolver")).catch(() => {});
}
