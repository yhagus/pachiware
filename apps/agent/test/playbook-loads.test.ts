import { expect } from "bun:test";
import { discordScenario } from "./support/discordScenario";

const playbook = (name: string, fields: string, body: string) => `---\nname: ${name}\n${fields}\n---\n${body}\n`;
const count = (text: string, part: string) => text.split(part).length - 1;

discordScenario("a started playbook's prompt carries the bodies of the playbooks it loads, each once, after its own", async (s) => {
  await s.workspace.write("shared/playbooks/grilling/PLAYBOOK.md", playbook("grilling", 'trigger: "grill"', "Ask one question at a time."));
  await s.workspace.write("shared/playbooks/grill-with-docs/PLAYBOOK.md", playbook("grill-with-docs", 'trigger: "docs"\nloads: ["grilling"]', "Keep the glossary current."));
  await s.workspace.write("shared/playbooks/wayfinder/PLAYBOOK.md", playbook("wayfinder", 'trigger: "wayfinder"\nloads: ["grill-with-docs", "grilling"]', "Map the work into tickets."));
  await s.restart();

  s.model.script("Mapping.", "Still mapping.");
  const start = await s.discord.send(`${s.discord.mention} wayfinder: plan the billing rewrite`);
  expect(start.thread).toBeDefined();
  const prompt = String(s.model.calls[0]![0]!.content);
  for (const body of ["Map the work into tickets.", "Keep the glossary current.", "Ask one question at a time."]) expect(count(prompt, body)).toBe(1);
  expect(prompt.indexOf("Map the work into tickets.")).toBeLessThan(prompt.indexOf("Keep the glossary current."));
  expect(prompt.indexOf("Keep the glossary current.")).toBeLessThan(prompt.indexOf("Ask one question at a time."));

  await s.discord.send("start with invoices", { channel: start.thread });
  expect(count(String(s.model.calls[1]![0]!.content), "Ask one question at a time.")).toBe(1);
});

discordScenario("tools a loaded playbook closes are not offered, and a skill it requires is needed for the start", async (s) => {
  await s.workspace.write("shared/playbooks/grilling/PLAYBOOK.md", playbook("grilling", 'trigger: "grill"\nrequires: ["reminders"]\ncloses: ["searchFiles"]', "Ask one question at a time."));
  await s.workspace.write("shared/playbooks/wayfinder/PLAYBOOK.md", playbook("wayfinder", 'trigger: "wayfinder"\nrequires: ["workspace"]\nloads: ["grilling"]', "Map the work into tickets."));
  await s.restart();

  s.model.script("Mapping.");
  const start = await s.discord.send(`${s.discord.mention} wayfinder: plan the billing rewrite`);
  expect(start.thread).toBeDefined();
  expect(s.model.tools[0]).toContain("readFile");
  expect(s.model.tools[0]).not.toContain("searchFiles");

  await s.availability({ level: "channel", channelId: "channel-2" }, { kind: "skill", name: "reminders", value: "off" });
  const refused = await s.discord.send(`${s.discord.mention} wayfinder: plan the export rewrite`, { channel: "channel-2" });
  expect(refused.thread).toBeUndefined();
  expect(s.discord.botMessages.at(-1)!.content).toMatch(/wayfinder playbook needs the Reminders skill, which is off here/);
  expect(s.model.calls).toHaveLength(1);
});

discordScenario("a loaded playbook off in a channel refuses the start there with that cause, and turning it off ends an active thread with a note", async (s) => {
  await s.workspace.write("shared/playbooks/grilling/PLAYBOOK.md", playbook("grilling", 'trigger: "grill"', "Ask one question at a time."));
  await s.workspace.write("shared/playbooks/wayfinder/PLAYBOOK.md", playbook("wayfinder", 'trigger: "wayfinder"\nloads: ["grilling"]', "Map the work into tickets."));
  await s.restart();
  await s.availability({ level: "channel", channelId: "channel-2" }, { kind: "playbook", name: "grilling", value: "off" });

  const refused = await s.discord.send(`${s.discord.mention} wayfinder: plan the export rewrite`, { channel: "channel-2" });
  expect(refused.thread).toBeUndefined();
  expect(s.discord.botMessages.map((m) => m.content)).toEqual([expect.stringMatching(/wayfinder playbook loads grilling, which is off here/)]);
  expect(s.model.calls).toEqual([]);

  s.model.script("Mapping.");
  const start = await s.discord.send(`${s.discord.mention} wayfinder: plan the billing rewrite`);
  expect(start.thread).toBeDefined();
  await s.availability({ level: "channel", channelId: "channel-1" }, { kind: "playbook", name: "grilling", value: "off" });
  await s.discord.send("any news?", { channel: start.thread });
  expect(s.discord.botMessages.at(-1)!.content).toMatch(/wayfinder playbook is no longer available here/);
  expect(s.model.calls).toHaveLength(1);
});

discordScenario("a reference playbook gets no menu or trigger word but is loaded by another playbook", async (s) => {
  await s.workspace.write("shared/playbooks/codebase-design/PLAYBOOK.md", playbook("codebase-design", 'start: false\ntrigger: {"menu": "Design modules", "word": "design"}', "Prefer deep modules."));
  await s.workspace.write("shared/playbooks/review/PLAYBOOK.md", playbook("review", 'trigger: "review"\nloads: ["codebase-design"]', "Review the change."));
  await s.restart();
  expect(s.discord.registeredCommands.map((c) => c.name)).not.toContain("Design modules");

  s.model.script("Plain answer.", "Reviewing.");
  await s.discord.send(`${s.discord.mention} design: the billing module`);
  expect(String(s.model.calls[0]![0]!.content)).not.toContain("Prefer deep modules.");
  expect(await s.workspace.list("guilds/guild-1/channels/channel-1/threads").catch(() => [])).toEqual([]);

  const review = await s.discord.send(`${s.discord.mention} review: the billing change`);
  expect(review.thread).toBeDefined();
  expect(String(s.model.calls[1]![0]!.content)).toContain("Prefer deep modules.");
});

discordScenario("the admin API refuses saving a playbook that closes a load cycle or makes a chain deeper than three, with the reason", async (s) => {
  const { createServer } = await import(process.cwd() + "/apps/agent/src/server.ts");
  const app = createServer(), headers = { "X-Platform-Key": "scenario", "Content-Type": "application/json" };
  const file = async (name: string) => (await app.request(`/api/admin/tenants/${s.tenant.id}/workspace/file?path=shared/playbooks/${name}/PLAYBOOK.md`, { headers })).json();
  const read = async (name: string) => (await file(name)).content;
  const save = async (name: string, fields: string) => {
    const { version } = await file(name);
    const r = await app.request(`/api/admin/tenants/${s.tenant.id}/workspace/file`, { method: "PUT", headers, body: JSON.stringify({ path: `shared/playbooks/${name}/PLAYBOOK.md`, content: playbook(name, fields, `Steps of ${name}.`), version }) });
    return { status: r.status, body: await r.json() };
  };

  expect((await save("a", 'loads: ["b"]')).status).toBe(200);
  expect((await save("b", 'loads: ["c"]')).status).toBe(200);
  expect((await save("c", 'loads: ["d"]')).status).toBe(200);
  expect((await save("d", 'trigger: "d"')).status).toBe(200);

  expect(await save("c", 'loads: ["a"]')).toEqual({ status: 400, body: { error: expect.stringContaining("c loads itself through c -> a -> b -> c") } });
  expect(await read("c")).toContain('loads: ["d"]');
  expect(await save("d", 'loads: ["e"]')).toEqual({ status: 400, body: { error: expect.stringContaining("deeper than 3: a -> b -> c -> d -> e") } });
  expect(await read("d")).toContain('trigger: "d"');
  expect((await save("e", 'loads: ["d"]')).status).toBe(200);
});

discordScenario("the admin API lists what each playbook loads and why it cannot start", async (s) => {
  await s.workspace.write("shared/playbooks/grilling/PLAYBOOK.md", playbook("grilling", 'trigger: "grill"', "Ask one question at a time."));
  await s.workspace.write("shared/playbooks/grill-with-docs/PLAYBOOK.md", playbook("grill-with-docs", 'trigger: "docs"\nloads: ["grilling"]', "Keep the glossary current."));
  await s.workspace.write("shared/playbooks/wayfinder/PLAYBOOK.md", playbook("wayfinder", 'trigger: "wayfinder"\nloads: ["grill-with-docs"]', "Map the work into tickets."));
  await s.workspace.write("shared/playbooks/codebase-design/PLAYBOOK.md", playbook("codebase-design", "start: false", "Prefer deep modules."));
  await s.workspace.write("shared/playbooks/review/PLAYBOOK.md", playbook("review", 'loads: ["codebase-design", "style-guide"]', "Review the change."));
  const { createServer } = await import(process.cwd() + "/apps/agent/src/server.ts");
  const app = createServer(), headers = { "X-Platform-Key": "scenario", "Content-Type": "application/json" };
  const off = await app.request(`/api/admin/tenants/${s.tenant.id}/availability`, { method: "PUT", headers, body: JSON.stringify({ kind: "playbook", name: "grilling", value: "off" }) });
  expect(off.status).toBe(200);

  const { playbooks } = await (await app.request(`/api/admin/tenants/${s.tenant.id}/skills`, { headers })).json();
  const entry = (name: string) => playbooks.find((p: any) => p.name === name);
  expect(entry("wayfinder")).toMatchObject({ loads: ["grill-with-docs"], chain: ["grill-with-docs", "grilling"], start: true, cause: { off: "loads", playbook: "grilling" } });
  expect(entry("grill-with-docs")).toMatchObject({ loads: ["grilling"], cause: { off: "loads", playbook: "grilling" } });
  expect(entry("grilling")).toMatchObject({ loads: [], cause: { off: "playbook" } });
  expect(entry("codebase-design")).toMatchObject({ start: false, cause: null });
  expect(entry("review")).toMatchObject({ loads: ["codebase-design", "style-guide"], cause: { off: "loads", playbook: "style-guide" } });
  expect(entry("issue-draft")).toMatchObject({ loads: [], chain: [], start: true, cause: null });
});
