import type { Connection } from "../connection.js";
import { createMongoTenantRepository } from "./tenants/mongo.js";
import { createSqlTenantRepository } from "./tenants/sql.js";
import type { TenantRepository } from "./tenants/types.js";
import { createSqlScheduleRepository } from "./schedules/sql.js";
import type { ScheduleRepository } from "./schedules/types.js";
import { createSqlTaskRowRepository } from "./task-rows/sql.js";
import type { TaskRowRepository } from "./task-rows/types.js";
import { createSqlProfileRepository } from "./profiles/sql.js";
import type { ProfileRepository } from "./profiles/types.js";
import { createSqlAgentConfigRepository } from "./agent-config/sql.js";
import type { AgentConfigRepository } from "./agent-config/types.js";
import { createSqlUsageRepository } from "./usage/sql.js";
import type { UsageRepository } from "./usage/types.js";
import { createSqlStatsRepository } from "./stats/sql.js";
import type { StatsRepository } from "./stats/types.js";
import { createSqlBotRepository } from "./bots/sql.js";
import type { BotRepository } from "./bots/types.js";
import { createSqlSkillRepository } from "./skills/sql.js";
import type { SkillRepository } from "./skills/types.js";
import { createSqlAvailabilityRuleRepository } from "./availability/sql.js";
import type { AvailabilityRuleRepository } from "./availability/types.js";
import { createSqlConversationRepository } from "./conversations/sql.js";
import type { ConversationRepository } from "./conversations/types.js";
import { createSqlGitRepository } from "./git/sql.js";
import type { GitRepository } from "./git/types.js";

// One folder per kind of record: `types.ts` holds its domain types and interface, `sql.ts` serves SQLite
// and PostgreSQL, and `mongo.ts` serves MongoDB. Its contract suite lives in
// packages/db/test/contract/<name>.contract.test.ts and runs on every engine through `contract()`.
export type * from "./tenants/types.js";
export type * from "./schedules/types.js";
export type * from "./task-rows/types.js";
export type * from "./profiles/types.js";
export type * from "./agent-config/types.js";
export type * from "./usage/types.js";
export type * from "./stats/types.js";
export type * from "./bots/types.js";
export type * from "./skills/types.js";
export type * from "./availability/types.js";
export type * from "./conversations/types.js";
export type * from "./git/types.js";

/** Every repository, one per kind of record. Code outside the database package reads and writes records only through these. */
export type Repositories = {
  tenants: TenantRepository;
  schedules: ScheduleRepository;
  taskRows: TaskRowRepository;
  profiles: ProfileRepository;
  agentConfig: AgentConfigRepository;
  usage: UsageRepository;
  stats: StatsRepository;
  bots: BotRepository;
  skills: SkillRepository;
  availability: AvailabilityRuleRepository;
  conversations: ConversationRepository;
  git: GitRepository;
};

/** The repositories of one open database, implemented for its engine. */
export function createRepositories(connection: Connection): Repositories {
  switch (connection.engine) {
    case "sqlite":
    case "postgres":
      return {
        tenants: createSqlTenantRepository(connection),
        schedules: createSqlScheduleRepository(connection),
        taskRows: createSqlTaskRowRepository(connection),
        profiles: createSqlProfileRepository(connection),
        agentConfig: createSqlAgentConfigRepository(connection),
        usage: createSqlUsageRepository(connection),
        stats: createSqlStatsRepository(connection),
        bots: createSqlBotRepository(connection),
        skills: createSqlSkillRepository(connection),
        availability: createSqlAvailabilityRuleRepository(connection),
        conversations: createSqlConversationRepository(connection),
        git: createSqlGitRepository(connection),
      };
    case "mongodb":
      return {
        tenants: createMongoTenantRepository(connection),
        profiles: notOnMongoYet("Profiles"),
        agentConfig: notOnMongoYet("Agent configuration"),
        usage: notOnMongoYet("Usage"),
        stats: notOnMongoYet("Stats"),
        schedules: notOnMongoYet("Schedules"),
        taskRows: notOnMongoYet("Task rows"),
        bots: notOnMongoYet("Bots"),
        skills: notOnMongoYet("Skills"),
        availability: notOnMongoYet("Availability rules"),
        conversations: notOnMongoYet("Conversations"),
        git: notOnMongoYet("Git"),
      };
  }
}

/**
 * Stands in for a repository not built for MongoDB yet (#169–#171) so the entry point stays complete:
 * every call rejects, naming the repository. Replace it with the `mongo.ts` implementation.
 */
function notOnMongoYet<T extends object>(name: string): T {
  return new Proxy({} as T, {
    get: (_, method) => (method === "then" ? undefined : async () => {
      throw new Error(`The ${name} repository is not available on MongoDB yet (${String(method)}).`);
    }),
  });
}
