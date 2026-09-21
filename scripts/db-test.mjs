// Runs db/tests/*.sql as the restricted app_user role (the same role the API uses), over DATABASE_URL.
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const url = process.env.DATABASE_URL ?? "postgres://app_user:app_dev@localhost:5433/admission";
let failed = false;
for (const f of readdirSync(join(root, "db/tests")).filter((f) => f.endsWith(".sql")).sort()) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    await c.query(readFileSync(join(root, "db/tests", f), "utf-8")); // the test raises an exception on the first violation
    console.log(`PASS ${f}`);
  } catch (e) {
    console.log(`FAIL ${f}`);
    console.error(e.message);
    failed = true;
    await c.query("ROLLBACK").catch(() => {});
  } finally { await c.end(); }
}
process.exit(failed ? 1 : 0);
