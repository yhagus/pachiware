import type { Connection } from "./connection.js";
import { createRepositories, type SkillDefinition } from "./repositories/index.js";

/** Registers the built-in skills and tenant defaults in the configured database. */
export async function runSeed() {
  const { connection } = await import("./internal.js");
  await seedDatabase(connection);
}

/** Registers the built-in skills in one open database, then gives every tenant the defaults it lacks. */
export async function seedDatabase(connection: Connection) {
  const repos = createRepositories(connection);
  for (const skill of builtInSkills()) console.log(`  ${await repos.skills.register(skill) ? "[+] Registered" : "[*] Updated"} skill: ${skill.name}`);
  await repos.tenants.seedDefaults();
  console.log("Platform skills and tenant defaults seeded.");
}

/**
 * The skills the platform ships with, as the seed registers them. Their tools live only in the skill modules
 * (packages/skills/src/builtin), which the registry serves, so no skill stores a copy here (#134). The APIs show the
 * modules' names and descriptions too; the ones here only label the stored rows.
 */
export function builtInSkills(): SkillDefinition[] {
  const taskManagementSkill = {
    id: "task_management",
    name: "Task Management",
    description: "Create, view, update status, assign, and set due dates of tasks kept as Markdown files in the Workspace.",
    defaultEnabled: true,
    handlerType: "builtin",
    toolDefinitions: [],
    config: {},
  };

  const discordManagementSkill = {
    id: "discord_management",
    name: "Discord Management",
    description: "Manage Discord guild channels, topics, archiving, and permissions.",
    defaultEnabled: true,
    handlerType: "builtin",
    toolDefinitions: [],
    config: {},
  };

  // Off by default: it only does something once a git account is bound to a bot.
  const gitRepositorySkill = {
    id: "git_repositories",
    name: "Git Repositories",
    description: "Browse and change repositories on the git accounts enabled for this server and channel (GitHub, GitLab, self-hosted GitLab).",
    defaultEnabled: false,
    handlerType: "builtin",
    toolDefinitions: [],
    config: {},
  };

  const workspaceSkill = {
    id: "workspace",
    name: "Workspace",
    description: "Keep notes and memory as Markdown files in this tenant's Workspace.",
    defaultEnabled: true,
    handlerType: "builtin",
    toolDefinitions: [],
    config: {},
  };

  const remindersSkill = {
    id: "reminders",
    name: "Reminders",
    description: "Post a message at a time a person chose, once or repeating, where they asked, pinging them.",
    defaultEnabled: true,
    handlerType: "builtin",
    toolDefinitions: [],
    config: {},
  };

  // Off by default: it switches on when a Plane account is first attached to a bot.
  const planeSkill = {
    id: "plane",
    name: "Plane",
    description: "Read and change work items in the Plane projects enabled for this server and channel.",
    defaultEnabled: false,
    handlerType: "builtin",
    toolDefinitions: [],
    config: {},
  };

  // On by default: its changelog tools follow the contract-diff playbook, which needs git, and publishing needs nothing else.
  const openapiSkill = {
    id: "openapi",
    name: "OpenAPI",
    description: "Write API changelogs of a repository as OpenAPI documents, and publish OpenAPI documents as public preview pages.",
    defaultEnabled: true,
    handlerType: "builtin",
    toolDefinitions: [],
    config: {},
  };

  return [taskManagementSkill, discordManagementSkill, gitRepositorySkill, workspaceSkill, remindersSkill, planeSkill, openapiSkill];
}

if (import.meta.main) runSeed().then(() => process.exit(0)).catch(() => { console.error("Seed failed."); process.exit(1); });
