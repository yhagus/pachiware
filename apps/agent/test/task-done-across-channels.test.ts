import { expect } from "bun:test";
import { discordScenario, type Scenario } from "./support/discordScenario";

const id = (n: number) => `${String(n).padStart(8, "0")}-0000-4000-8000-${String(n).padStart(12, "0")}`;
interface Seed { n: number; title: string; channel: string; status: string }
const taskFile = (f: Seed) =>
  `---\nid: "${id(f.n)}"\ntitle: ${JSON.stringify(f.title)}\nstatus: "${f.status}"\npriority: "medium"\nassignedTo: null\ndueAt: null\ncreatedBy: "user-bob"\ncreatedByName: "Bob"\ncreatedAt: "2026-10-0${f.n}T00:00:00.000Z"\nupdatedAt: "2026-10-0${f.n}T00:00:00.000Z"\n---\n`;
async function seed(s: Scenario, tasks: Seed[]) {
  for (const t of tasks) await s.workspace.write(`guilds/guild-1/channels/${t.channel}/tasks/task-${t.n}.md`, taskFile(t));
}
/** Every tool result of the turn as the model read it. */
const results = (turn: any) => JSON.stringify(turn.toolResults.map((r: any) => r.error ?? r));
const SUGGEST_EN = (n: number) => `${n} more matching ${n === 1 ? "task" : "tasks"} you can see cannot be shown in this channel. Do not say what or where they are; suggest asking in a DM instead.`;

/**
 * #general (channel-1) where people ask; #audio (channel-2), a Public channel; #direksi (channel-3), a channel @everyone cannot view;
 * #board (channel-4), which Alice cannot view at all. Each holds a Task about audio normalization.
 */
async function fourChannels(s: Scenario) {
  await s.guildSettings({ language: "en", useThreads: false });
  s.discord.channel("channel-1").name = "general";
  s.discord.channel("channel-2").name = "audio";
  s.discord.channel("channel-3").name = "direksi";
  s.discord.channel("channel-4").name = "board";
  s.discord.hide("channel-3");
  s.discord.deny("channel-4", s.discord.alice.id, ["ViewChannel"]);
  await seed(s, [
    { n: 1, title: "Normalize the audio loudness", channel: "channel-2", status: "completed" },
    { n: 2, title: "Budget for audio normalization gear", channel: "channel-3", status: "pending" },
    { n: 3, title: "Audio normalization contract", channel: "channel-4", status: "completed" },
    { n: 4, title: "Order new chairs", channel: "channel-2", status: "pending" },
  ]);
}
async function ask(s: Scenario, args: Record<string, unknown>, options: { author?: Scenario["discord"]["alice"]; channel?: string } = {}) {
  s.model.script({ tool: "listTasks", args }, results);
  await s.discord.send(`${s.discord.mention} is audio normalization done?`, options);
  return s.discord.botMessages.at(-1)!.content;
}
const line = (status: string, n: number, title: string) => `${status} | no due date | unassigned | ${id(n).slice(0, 8)} | ${title}`;
const titles = (said: string) => JSON.parse(said)[0].groups.map((g: any) => `${g.group}: ${g.tasks.map((t: any) => t.line).join("; ")}`);

discordScenario("asked in #general whether audio normalization is done, a completed Task in the Public channel #audio is quoted", async (s) => {
  await fourChannels(s);
  const said = await ask(s, { scope: "anywhere", query: "audio" });
  expect(said).not.toMatch(/direksi|board|gear|contract|channel-3|channel-4/i);
  const [r] = JSON.parse(said);
  expect(titles(said)).toEqual([`#audio: ${line("completed", 1, "Normalize the audio loudness")}`]);
  expect(r).toMatchObject({ scope: "anywhere", total: 1, shown: 1, notShownHere: 1, suggestion: SUGGEST_EN(1) });
});

discordScenario("a Task in a channel that is not a Public channel is quoted in its own channel and in a DM to a member who can view it", async (s) => {
  await fourChannels(s);
  const inDireksi = await ask(s, { scope: "anywhere", query: "audio normalization" }, { channel: "channel-3" });
  expect(titles(inDireksi)).toEqual([`#direksi: ${line("pending", 2, "Budget for audio normalization gear")}`]);
  expect(JSON.parse(inDireksi)[0].notShownHere).toBeUndefined();

  s.model.script({ tool: "listTasks", args: { scope: "anywhere", query: "audio" } }, results);
  await s.discord.send("is audio normalization done?", { channel: s.discord.channel(`dm-${s.discord.alice.id}`, { dm: true }) });
  const inDm = s.discord.botMessages.at(-1)!.content;
  expect(titles(inDm)).toEqual([
    `#audio (Acme): ${line("completed", 1, "Normalize the audio loudness")}`,
    `#direksi (Acme): ${line("pending", 2, "Budget for audio normalization gear")}`,
  ]);
  expect(inDm).not.toMatch(/contract/i);
});

discordScenario("a channel the asker cannot view is neither quoted nor counted", async (s) => {
  await fourChannels(s);
  const said = await ask(s, { scope: "anywhere", query: "contract" });
  expect(JSON.parse(said)).toEqual([{ scope: "anywhere", total: 0, shown: 0, groups: [] }]);
  const bob = await ask(s, { scope: "anywhere", query: "contract" }, { author: s.discord.bob });
  expect(titles(bob)).toEqual([`#board: ${line("completed", 3, "Audio normalization contract")}`]);
});

discordScenario("a cancelled Task is listed as cancelled, not as done, and several wordings of the question are searched at once", async (s) => {
  await fourChannels(s);
  await seed(s, [{ n: 5, title: "Normalisasi audio podcast", channel: "channel-1", status: "cancelled" }]);
  const said = await ask(s, { scope: "anywhere", queries: ["normalisasi audio", "audio loudness"] });
  expect(titles(said)).toEqual([
    `#audio: ${line("completed", 1, "Normalize the audio loudness")}`,
    `#general: ${line("cancelled", 5, "Normalisasi audio podcast")}`,
  ]);
});
