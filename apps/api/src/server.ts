import { createApp } from "./app.js";
import { config } from "./config.js";
import { assertRestrictedRole, pool } from "./db.js";
import { processPendingPushEvents, vapidConfigured } from "./push.js";
import { startQueue } from "./queue.js";

await assertRestrictedRole();
const queue = await startQueue();
const server = createApp(queue.enqueue).listen(config.PORT, () => console.log(`API listening on :${config.PORT}`));

// PRD 6A: "a queue worker that sends a minimal alert ... on each new handoff and lead". Same 5s-poll spirit as
// the dashboard's own alerts (a real push queue would need its own worker process; a plain interval is the
// pragmatic version for this scale). A silent no-op when VAPID keys aren't configured (local dev by default).
const pushInterval = vapidConfigured
  ? setInterval(() => { processPendingPushEvents().catch((err) => console.error("push processing failed:", err instanceof Error ? err.message : err)); }, 5000)
  : null;

const shutdown = async () => {
  server.close();
  if (pushInterval) clearInterval(pushInterval);
  await queue.stop();
  await pool.end();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
