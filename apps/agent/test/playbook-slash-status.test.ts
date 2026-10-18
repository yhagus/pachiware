import { expect } from "bun:test";
import { discordScenario } from "./support/discordScenario";

const LONG_NAME = "retrospective-for-the-whole-team-q3"; // 35 characters

async function admin(s: { tenant: { id: string } }) {
  const { createServer } = await import(process.cwd() + "/apps/agent/src/server.ts");
  const app = createServer(), headers = { "X-Platform-Key": "scenario", "Content-Type": "application/json" };
  return async (method: string, path: string, body?: unknown) => {
    const r = await app.request(`/api/admin${path}`, { method, headers, body: body && JSON.stringify(body) });
    return { status: r.status, body: await r.json() };
  };
}

discordScenario("a playbook whose name Discord cannot use is saved with a warning, gets no slash command, and still starts by mention", async (s) => {
  const call = await admin(s);
  const saved = await call("PUT", `/tenants/${s.tenant.id}/workspace/file`, {
    path: `shared/playbooks/${LONG_NAME}/PLAYBOOK.md`,
    content: `---\nname: ${LONG_NAME}\ndescription: Collects a retrospective\ntrigger: {"word": "retro", "menu": "Run retro"}\nrequires: workspace\n---\nGroup the points into went well, went badly, and try next.\n`,
  });
  expect(saved.status).toBe(200);
  expect(saved.body.success).toBe(true);
  expect(saved.body.warning).toMatch(new RegExp(`${LONG_NAME}.*no slash command`));
  expect(saved.body.warning).toContain(`by mention with "retro:" and from the message menu "Run retro"`);

  // A usable name saves without a warning.
  const plain = await call("PUT", `/tenants/${s.tenant.id}/workspace/file`, { path: "shared/playbooks/standup/PLAYBOOK.md", content: `---\nname: standup\ndescription: Runs the standup\n---\nAsk each person.\n` });
  expect(plain.status).toBe(200);
  expect(plain.body.warning).toBeUndefined();

  await s.settle();
  expect(s.discord.registeredCommands.filter((c) => c.type === 1).map((c) => c.name)).toEqual(["issue-draft", "minutes", "standup"]);
  expect(s.discord.registeredCommands.filter((c) => c.type === 3).map((c) => c.name)).toContain("Run retro");

  s.model.script("Grouping.");
  const started = await s.discord.send(`${s.discord.mention} retro: standups ran long`);
  expect(started.thread).toBeDefined();
  expect(s.model.calls[0]![0]!.content).toContain("Group the points into went well, went badly, and try next.");
});

discordScenario("each guild's availability view reports every playbook's slash status there, with the reason one is not registered", async (s) => {
  await s.workspace.write(`shared/playbooks/${LONG_NAME}/PLAYBOOK.md`, `---\nname: ${LONG_NAME}\ndescription: Collects a retrospective\ntrigger: {"word": "retro"}\n---\nGroup the points.\n`);
  await s.workspace.write("shared/playbooks/house-style/PLAYBOOK.md", `---\nname: house-style\ndescription: How we write\nstart: false\n---\nShort sentences.\n`);
  await s.workspace.write("shared/playbooks/retro/PLAYBOOK.md", `---\nname: retro\ndescription: Group the points\ndefault: off\n---\nGroup the points.\n`);
  await s.workspace.write("shared/playbooks/standup/PLAYBOOK.md", `---\nname: standup\ndescription: Runs the standup\n---\nAsk each person.\n`);
  await s.restart();
  await s.discord.joinGuild("guild-2");
  await s.availability({ level: "bot" }, { kind: "playbook", name: "standup", value: "off" });
  await s.availability({ level: "guild", guildId: "guild-2" }, { kind: "playbook", name: "minutes", value: "off" });
  await s.availability({ level: "guild", guildId: "guild-2" }, { kind: "playbook", name: "issue-draft", value: "opt_in" });

  const call = await admin(s);
  const view = async (guildId: string) => {
    const got = await call("GET", `/bots/${s.bot.id}/guilds/${guildId}/availability`);
    expect(got.status).toBe(200);
    return got.body.slash;
  };
  // Imported built-ins are off until the tenant turns them on; this view is about the tenant's own playbooks.
  const imported = (await import(process.cwd() + "/packages/skills/src/playbooks.ts")).builtinPlaybooks().filter((p: any) => p.defaultOff).map((p: any) => p.name);
  expect((await view("guild-1")).filter((p: any) => !imported.includes(p.playbook))).toEqual([
    { playbook: "daily-log", status: "not_registered", reason: "reference" },
    { playbook: "house-style", status: "not_registered", reason: "reference" },
    { playbook: "issue-draft", status: "registered" },
    { playbook: "minutes", status: "registered" },
    { playbook: "retro", status: "not_registered", reason: "off", level: "tenant" },
    { playbook: LONG_NAME, status: "name_unusable" },
    { playbook: "standup", status: "not_registered", reason: "off", level: "bot" },
  ]);
  expect((await view("guild-2")).filter((p: any) => ["issue-draft", "minutes"].includes(p.playbook))).toEqual([
    { playbook: "issue-draft", status: "registered" },
    { playbook: "minutes", status: "not_registered", reason: "off", level: "guild" },
  ]);

  // The view agrees with what was sent to Discord.
  for (const guildId of ["guild-1", "guild-2"]) {
    const registered = (await view(guildId)).filter((p: any) => p.status === "registered").map((p: any) => p.playbook);
    expect(s.discord.commandsIn(guildId)!.filter((c) => c.type === 1).map((c) => c.name).sort()).toEqual(registered.sort());
  }

  // Bot and channel views carry no slash status: registration is per guild.
  expect((await call("GET", `/bots/${s.bot.id}/availability`)).body.slash).toBeUndefined();
  expect((await call("GET", `/bots/${s.bot.id}/guilds/guild-1/channels/channel-1/availability`)).body.slash).toBeUndefined();
});
