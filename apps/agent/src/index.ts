import { createServer } from "./server.js";
import { config } from "./config.js";
import { redis } from "./cache/redis.js";
import { discordBotService } from "./discord/client.js";
import { runMigrations } from "@pachiware/db";

async function main() {
  console.log("=========================================");
  console.log("   🚀 Launching Pachiware Agent Engine    ");
  console.log("=========================================");

  // 1. Ensure DB Migrations
  try {
    await runMigrations();
  } catch (_err: any) {
    console.log("ℹ Database not yet initialized. Agent started in Setup Mode (Configure via Web GUI).");
  }

  // 2. Connect Redis (Optional - falls back to native in-memory store)
  try {
    await redis.connect().catch(() => {});
  } catch (_err: any) {
    // In-memory fallback is active
  }

  // 3. Start Discord Bot Service in background
  discordBotService.start().catch((err) => {
    console.warn("Notice during Discord bot startup:", err.message);
  });

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
