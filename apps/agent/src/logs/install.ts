/** Imported first by the agent's entry point, so every line logged after it reaches the agent log. */
import "../config.js"; // loads .env, where LOG_DIR and LOG_RETENTION_DAYS may be set
import { installAgentLog } from "./agentLog.js";

installAgentLog();
