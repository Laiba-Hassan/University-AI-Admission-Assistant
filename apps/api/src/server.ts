import { createApp } from "./app.js";
import { config } from "./config.js";
import { assertRestrictedRole, pool } from "./db.js";
import { startQueue } from "./queue.js";

await assertRestrictedRole();
const queue = await startQueue();
const server = createApp(queue.enqueue).listen(config.PORT, () => console.log(`API listening on :${config.PORT}`));

const shutdown = async () => {
  server.close();
  await queue.stop();
  await pool.end();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
