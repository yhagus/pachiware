import type { Connection } from "../connection.js";
import { createMongoTenantRepository } from "./tenants/mongo.js";
import { createSqlTenantRepository } from "./tenants/sql.js";
import type { TenantRepository } from "./tenants/types.js";
import { createSqlScheduleRepository } from "./schedules/sql.js";
import { createMongoScheduleRepository } from "./schedules/mongo.js";
import type { ScheduleRepository } from "./schedules/types.js";
import { createSqlTaskRowRepository } from "./task-rows/sql.js";
import { createMongoTaskRowRepository } from "./task-rows/mongo.js";
import type { TaskRowRepository } from "./task-rows/types.js";
import { createSqlProfileRepository } from "./profiles/sql.js";
import { createMongoProfileRepository } from "./profiles/mongo.js";
import type { ProfileRepository } from "./profiles/types.js";
import { createSqlAgentConfigRepository } from "./agent-config/sql.js";
import { createMongoAgentConfigRepository } from "./agent-config/mongo.js";
import type { AgentConfigRepository } from "./agent-config/types.js";
import { createSqlUsageRepository } from "./usage/sql.js";
import { createMongoUsageRepository } from "./usage/mongo.js";
import type { UsageRepository } from "./usage/types.js";
import { createSqlStatsRepository } from "./stats/sql.js";
import { createMongoStatsRepository } from "./stats/mongo.js";
import type { StatsRepository } from "./stats/types.js";
import { createSqlBotRepository } from "./bots/sql.js";
import { createMongoBotRepository } from "./bots/mongo.js";
import type { BotRepository } from "./bots/types.js";
import { createSqlSkillRepository } from "./skills/sql.js";
import { createMongoSkillRepository } from "./skills/mongo.js";
import type { SkillRepository } from "./skills/types.js";
import { createSqlAvailabilityRuleRepository } from "./availability/sql.js";
import { createMongoAvailabilityRuleRepository } from "./availability/mongo.js";
import type { AvailabilityRuleRepository } from "./availability/types.js";
import { createSqlConversationRepository } from "./conversations/sql.js";
import { createMongoConversationRepository } from "./conversations/mongo.js";
import type { ConversationRepository } from "./conversations/types.js";
import { createSqlGitRepository } from "./git/sql.js";
import { createMongoGitRepository } from "./git/mongo.js";
import type { GitRepository } from "./git/types.js";
import { createSqlPlaneRepository } from "./plane/sql.js";
import { createMongoPlaneRepository } from "./plane/mongo.js";
import type { PlaneRepository } from "./plane/types.js";
import { createSqlApiPreviewRepository } from "./api-previews/sql.js";
import { createMongoApiPreviewRepository } from "./api-previews/mongo.js";
import type { ApiPreviewRepository } from "./api-previews/types.js";

// One folder per kind of record: `types.ts` (domain types, interface), `sql.ts` (SQLite, PostgreSQL) and `mongo.ts`.
// Its contract suite, packages/db/test/contract/<name>.contract.test.ts, runs on every engine.
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
export type * from "./plane/types.js";
export type * from "./api-previews/types.js";

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
  plane: PlaneRepository;
  apiPreviews: ApiPreviewRepository;
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
        plane: createSqlPlaneRepository(connection),
        apiPreviews: createSqlApiPreviewRepository(connection),
      };
    case "mongodb":
      return {
        tenants: createMongoTenantRepository(connection),
        profiles: createMongoProfileRepository(connection),
        agentConfig: createMongoAgentConfigRepository(connection),
        usage: createMongoUsageRepository(connection),
        stats: createMongoStatsRepository(connection),
        schedules: createMongoScheduleRepository(connection),
        taskRows: createMongoTaskRowRepository(connection),
        bots: createMongoBotRepository(connection),
        skills: createMongoSkillRepository(connection),
        availability: createMongoAvailabilityRuleRepository(connection),
        conversations: createMongoConversationRepository(connection),
        git: createMongoGitRepository(connection),
        plane: createMongoPlaneRepository(connection),
        apiPreviews: createMongoApiPreviewRepository(connection),
      };
  }
}
