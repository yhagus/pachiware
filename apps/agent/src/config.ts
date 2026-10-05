import * as dotenv from "dotenv";
import { resolve } from "path";
import { getInfraConfig } from "@pachiware/db";

dotenv.config({ path: resolve(process.cwd(), "../../.env") });
dotenv.config({ path: resolve(process.cwd(), ".env") });

const infra = getInfraConfig();

export const config = {
  port: parseInt(process.env.AGENT_PORT || "3001", 10),
  host: process.env.AGENT_HOST || "0.0.0.0",
  secretKey: process.env.AGENT_SECRET_KEY || "pachiware-super-secret-key-change-me",
  databaseUrl: infra.databaseUrl,
  redisUrl: infra.redisUrl,

  platformAdminKey: process.env.PLATFORM_ADMIN_KEY || process.env.AGENT_SECRET_KEY || "pachiware-super-secret-key-change-me",
  hasEncryptionKey: Boolean(process.env.PLATFORM_ENCRYPTION_KEY),
};
