import { createApp } from "./app.js";
import { config } from "./config.js";
import { assertRestrictedRole, pool } from "./db.js";
import { generateDailyUsageReports, processPendingAutomationEvents } from "./automations.js";
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

// Phase 7: n8n-style automation webhooks. Independent of VAPID/push -- a tenant with no webhook configured just
// has processPendingAutomationEvents() claim-and-skip its events, which is cheap and keeps the outbox from growing.
const automationInterval = setInterval(
  () => { processPendingAutomationEvents().catch((err) => console.error("automation processing failed:", err instanceof Error ? err.message : err)); }, 10_000);
// Not a real cron -- generateDailyUsageReports() dedups itself (one report per tenant per calendar day), so
// checking hourly is harmless and simple, matching the "plain interval" pragmatism already used for push/automations.
const dailyReportInterval = setInterval(
  () => { generateDailyUsageReports().catch((err) => console.error("daily usage report generation failed:", err instanceof Error ? err.message : err)); }, 3_600_000);

const shutdown = async () => {
  server.close();
  if (pushInterval) clearInterval(pushInterval);
  clearInterval(automationInterval);
  clearInterval(dailyReportInterval);
  await queue.stop();
  await pool.end();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
