import * as dotenv from "dotenv";
import { resolve } from "path";

dotenv.config({ path: resolve(process.cwd(), "../../.env") });
dotenv.config({ path: resolve(process.cwd(), ".env") });

export const config = {
  port: parseInt(process.env.AGENT_PORT || "3001", 10),
  host: process.env.AGENT_HOST || "0.0.0.0",
  secretKey: process.env.AGENT_SECRET_KEY || "pachiware-super-secret-key-change-me",
  databaseUrl:
    process.env.DATABASE_URL || "postgresql://pachiware:pachiware_secret@localhost:5432/pachiware_agent",
  redisUrl: process.env.REDIS_URL || "redis://localhost:6380",

  discord: {
    token: process.env.DISCORD_BOT_TOKEN || "",
    clientId: process.env.DISCORD_CLIENT_ID || "",
    guildId: process.env.DISCORD_GUILD_ID || "",
  },

  llm: {
    defaultProvider: (process.env.DEFAULT_LLM_PROVIDER || "openai") as "openai" | "anthropic" | "custom",
    defaultModel: process.env.DEFAULT_MODEL || "gpt-4o",
    openai: {
      apiKey: process.env.OPENAI_API_KEY || "",
      baseUrl: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
    },
    anthropic: {
      apiKey: process.env.ANTHROPIC_API_KEY || "",
      baseUrl: "https://api.anthropic.com/v1",
    },
    custom: {
      apiKey: process.env.CUSTOM_LLM_API_KEY || "",
      baseUrl: process.env.CUSTOM_LLM_BASE_URL || "https://api.9router.com/v1",
      model: process.env.CUSTOM_LLM_MODEL || "gpt-4o",
    },
  },
};
