// Runs db/tests/*.sql as the restricted app_user role (the same role the API will use).
import { readdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let failed = false;
for (const f of readdirSync(join(root, "db/tests")).filter((f) => f.endsWith(".sql")).sort()) {
  const r = spawnSync("docker", ["compose", "exec", "-T", "db", "psql", "-v", "ON_ERROR_STOP=1", "-t", "-A", "-U", "app_user", "-d", "admission"],
    { cwd: root, input: readFileSync(join(root, "db/tests", f), "utf-8"), encoding: "utf-8" });
  const ok = r.status === 0;
  console.log(`${ok ? "PASS" : "FAIL"} ${f}`);
  if (!ok) { console.error(r.stderr || r.stdout); failed = true; }
}
process.exit(failed ? 1 : 0);
