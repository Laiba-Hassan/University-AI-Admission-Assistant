// Applies db/migrations/*.sql in order as app_migrator, via the dockerised Postgres (no local psql needed).
// Usage: pnpm db:migrate            (add --reset to drop and recreate the public schema first)
import { readdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const psql = (user, sql, input) => {
  const r = spawnSync("docker", ["compose", "exec", "-T", "db", "psql", "-v", "ON_ERROR_STOP=1", "-q", "-U", user, "-d", "admission", ...(sql ? ["-c", sql] : [])],
    { cwd: root, input, encoding: "utf-8" });
  if (r.status !== 0) { console.error(r.stdout + r.stderr); process.exit(1); }
  return r.stdout;
};

if (process.argv.includes("--reset")) {
  psql("postgres", "DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO app_migrator; GRANT USAGE ON SCHEMA public TO app_user, app_resolver; CREATE EXTENSION IF NOT EXISTS vector; CREATE EXTENSION IF NOT EXISTS pgcrypto;");
  console.log("schema reset");
}
// ALTER FUNCTION ... OWNER TO app_resolver needs CREATE on the schema for the new owner; grant it only for the run.
psql("postgres", "GRANT CREATE ON SCHEMA public TO app_resolver");
for (const f of readdirSync(join(root, "db/migrations")).filter((f) => f.endsWith(".sql")).sort()) {
  psql("app_migrator", null, readFileSync(join(root, "db/migrations", f), "utf-8"));
  console.log("applied", f);
}
psql("postgres", "REVOKE CREATE ON SCHEMA public FROM app_resolver");
