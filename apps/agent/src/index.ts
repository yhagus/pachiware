import { createServer } from "./server.js";
import { config } from "./config.js";
import { redis } from "./cache/redis.js";
import { discordBotManager } from "./discord/client.js";
import { startScheduler } from "./scheduler.js";
import { runMigrations, runSeed, ReplicaSetRequiredError } from "@pachiware/db";

async function main() {
  console.log("=========================================");
  console.log("   🚀 Launching Pachiware Agent Engine    ");
  console.log("=========================================");

  // 1. Ensure DB Migrations
  try {
    await runMigrations();
    await runSeed();
  } catch (err: any) {
    // A server that answers but cannot hold the records is not a setup problem the GUI can fix.
    if (err instanceof ReplicaSetRequiredError) throw err;
    console.log(`ℹ Database not ready (${err?.message ?? err}). Agent started in setup mode; check DATABASE_URL on the server, then restart.`);
  }

  // 2. Connect Redis (Optional - falls back to native in-memory store)
  try {
    await redis.connect().catch(() => {});
  } catch (_err: any) {
    // In-memory fallback is active
  }

  // 3. Start Discord Bot Service in background
  discordBotManager.startAll().catch((err) => {
    console.warn("Notice during Discord bot startup:", err.message);
  });
  startScheduler(discordBotManager);

  // 4. Start Hono Web Server via Bun.serve
  const app = createServer();

  console.log(`🌐 Agent REST API starting on http://${config.host}:${config.port}`);

  return Bun.serve({
    fetch: app.fetch,
    port: config.port,
    hostname: config.host,
  });
}

main().catch((err) => {
  console.error("Fatal startup error in Pachiware Agent:", err);
  process.exit(1);
});
