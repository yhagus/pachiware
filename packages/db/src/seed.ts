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
 * (packages/skills/src/builtin), which the registry serves, so no skill stores a copy here (#134).
 */
export function builtInSkills(): SkillDefinition[] {
  const taskManagementSkill = {
    id: "task_management",
    name: "Task Management",
    description: "Create, view, update status, and assign tasks stored in the Workspace.",
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
    description: "Read and change repositories on the git account connected to this bot (GitHub, GitLab, self-hosted GitLab).",
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
    description: "Post a message at a time a person chose, where they asked, pinging them.",
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

  return [taskManagementSkill, discordManagementSkill, gitRepositorySkill, workspaceSkill, remindersSkill, planeSkill];
}

if (import.meta.main) runSeed().then(() => process.exit(0)).catch(() => { console.error("Seed failed."); process.exit(1); });
