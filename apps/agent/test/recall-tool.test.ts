import { expect } from "bun:test";
import { discordScenario, type Scenario } from "./support/discordScenario";
import { fakePlane } from "./support/fakePlane";

// One recall call answers "was it discussed, decided, done?" (#211): Kept material, Tasks, git and Plane, each within what the
// existing tools reach from the same place.

const GENERAL = "guilds/guild-1/channels/channel-1", AUDIO = "guilds/guild-1/channels/channel-2", DIREKSI = "guilds/guild-1/channels/channel-3";
const ENG = "11111111-1111-4111-8111-111111111111", SEC = "33333333-3333-4333-8333-333333333333";
const task = (n: number, title: string, status: string) =>
  `---\nid: "0000000${n}-0000-4000-8000-00000000000${n}"\ntitle: ${JSON.stringify(title)}\nstatus: "${status}"\npriority: "medium"\nassignedTo: null\ndueAt: null\ncreatedBy: "user-bob"\ncreatedByName: "Bob"\ncreatedAt: "2026-10-0${n}T00:00:00.000Z"\nupdatedAt: "2026-10-0${n}T00:00:00.000Z"\n---\n`;
const MINUTES = `---\ntitle: "Loudness"\nguildId: "guild-1"\nchannelId: "channel-2"\npostedIn: "channel-2"\nmessageId: "5100"\nrequesterId: "user-alice"\n---\n# Loudness\n\n## Decided\n1. Audio normalization targets -14 LUFS [↗](https://discord.com/channels/guild-1/channel-2/5001)\n`;

/** #general (channel-1) where people ask, #audio (channel-2) a Public channel, #direksi (channel-3) a channel @everyone cannot view. */
async function channels(s: Scenario) {
  await s.guildSettings({ language: "en", useThreads: false });
  s.discord.channel("channel-1").name = "general";
  s.discord.channel("channel-2").name = "audio";
  s.discord.channel("channel-3").name = "direksi";
  s.discord.hide("channel-3");
}
/** acme/api is open here; secret/vault belongs to the account but lies outside the Git scope. */
async function github(s: Scenario) {
  await s.git({ provider: "github", repos: ["acme/*"] });
  s.http.on("GET api.github.com/user/repos", () => [
    { full_name: "acme/api", owner: { login: "acme" }, private: true, default_branch: "main", updated_at: "2026-10-10T00:00:00Z", html_url: "https://github.com/acme/api" },
    { full_name: "secret/vault", owner: { login: "secret" }, private: true, default_branch: "main", updated_at: "2026-10-10T00:00:00Z", html_url: "https://github.com/secret/vault" },
  ]);
  s.http.on("GET api.github.com/search/issues", (req) => (new URL(req.url).searchParams.get("q") === "audio normalization repo:acme/api" ? { total_count: 1, items: [
    { number: 88, title: "Normalize audio loudness to -14 LUFS", state: "closed", html_url: "https://github.com/acme/api/pull/88", updated_at: "2026-10-12T09:00:00Z", closed_at: "2026-10-12T09:00:00Z",
      pull_request: { merged_at: "2026-10-12T09:00:00Z", html_url: "https://github.com/acme/api/pull/88" } },
  ] } : { total_count: 0, items: [] }));
  s.http.on("GET api.github.com/repos/acme/api/commits", () => []);
  s.http.on("GET api.github.com/search/commits", () => ({ total_count: 0, items: [] }));
}
async function plane(s: Scenario) {
  await s.plane({ projects: [ENG] });
  const p = fakePlane(s);
  p.user({ id: "u-bot", first_name: "Plane", last_name: "Bot", display_name: "pachibot", email: "bot@acme.test" });
  p.project({ id: ENG, name: "Engineering", identifier: "ENG" }, ["u-bot"]);
  p.project({ id: SEC, name: "Secret", identifier: "SEC" });
  const done = p.state({ project: ENG, name: "Done", group: "completed" });
  p.item({ project: ENG, sequence_id: 3, name: "Normalisasi audio podcast", state: done.id, updated_at: "2026-10-12T08:00:00.000000Z" });
  p.item({ project: SEC, sequence_id: 1, name: "Audio normalization contract", updated_at: "2026-10-16T08:00:00.000000Z" });
}
async function recall(s: Scenario, calls: Record<string, unknown>[], options: { channel?: string } = {}) {
  let results: any[] = [];
  s.model.script(calls.map((args) => ({ tool: "recall", args })), (turn) => { results = turn.toolResults; return "done"; });
  await s.discord.send(`${s.discord.mention} is audio normalization done?`, options);
  return results;
}
const QUERIES = { queries: ["normalisasi audio", "audio normalization"] };

discordScenario("one recall call returns the Minutes, the completed Task, the merged pull request and the Work item about a topic, each with a ref, a label and a link", async (s) => {
  await channels(s);
  await github(s);
  await plane(s);
  await s.workspace.write(`${AUDIO}/minutes/2026-09-01-loudness.md`, MINUTES);
  await s.workspace.write(`${AUDIO}/tasks/task-1.md`, task(1, "Normalize the audio loudness", "completed"));
  const [result] = await recall(s, [QUERIES]);
  expect(result).toEqual({
    kept: [{ ref: "K1", label: "#audio · Minutes 2026-09-01", url: "https://discord.com/channels/guild-1/channel-2/5100", path: "#audio/minutes/2026-09-01-loudness.md",
      lines: [{ line: 12, text: "1. Audio normalization targets -14 LUFS [↗](https://discord.com/channels/guild-1/channel-2/5001)" }] }],
    tasks: [{ ref: "T1", label: "#audio · Task \"Normalize the audio loudness\" (completed)", line: "completed | no due date | unassigned | 00000001 | Normalize the audio loudness" }],
    work: [{ ref: "G1", label: "acme/api · pull request #88 \"Normalize audio loudness to -14 LUFS\" (merged 2026-10-12)", url: "https://github.com/acme/api/pull/88", date: "2026-10-12T09:00:00Z" }],
    workItems: [{ ref: "P1", label: "ENG-3 \"Normalisasi audio podcast\" (Done)", url: "https://app.plane.so/acme/browse/ENG-3/" }],
  });
  expect(JSON.stringify(result)).not.toMatch(/secret|vault|SEC-|contract/i);
  expect(s.http.requests.some((r) => r.url.includes("vault") || r.url.includes(`/projects/${SEC}/`))).toBe(false);
});

discordScenario("a Task named in other words is found and marked partial, after a Task in another channel that holds a whole wording (#258)", async (s) => {
  await channels(s);
  await s.workspace.write(`${AUDIO}/tasks/task-1.md`, task(1, "Waveform trim and cut", "completed"));
  await s.workspace.write(`${GENERAL}/tasks/task-2.md`, task(2, "Trim tool release notes", "pending"));
  await s.workspace.write(`${AUDIO}/tasks/task-3.md`, task(3, "Order new chairs", "pending"));
  const [result] = await recall(s, [{ queries: ["trim tool rilis", "trim tool released"] }]);
  expect(result.tasks).toEqual([
    { ref: "T1", label: "#general · Task \"Trim tool release notes\" (pending)", line: "pending | no due date | unassigned | 00000002 | Trim tool release notes" },
    { ref: "T2", label: "#audio · Task \"Waveform trim and cut\" (completed)", line: "completed | no due date | unassigned | 00000001 | Waveform trim and cut", partial: true },
  ]);
});

discordScenario("a Daily log match is cited by the message link on its matching line; a Decision has a label and no link", async (s) => {
  await channels(s);
  await s.workspace.write(`${GENERAL}/daily-logs/2026-10-05.md`, "# Daily log #general, 2026-10-05\n\n## Topics\n1. Audio normalization: loudness [↗](https://discord.com/channels/guild-1/channel-1/7001)\n");
  await s.workspace.write(`${GENERAL}/decisions/2026-10-06-loudness.md`, "Audio normalization goes to -16 LUFS.\n");
  const [result] = await recall(s, [QUERIES]);
  expect(result.kept.map((k: any) => [k.ref, k.label, k.url])).toEqual([
    ["K1", "#general · Decision 2026-10-06", undefined],
    ["K2", "#general · Daily log 2026-10-05", "https://discord.com/channels/guild-1/channel-1/7001"],
  ]);
});

const dl = (id: number) => `[↗](https://discord.com/channels/guild-1/channel-1/${id})`;

discordScenario("a Daily log is cited by the latest message of a matching decision, not by its topic row; a topic row alone by its first message", async (s) => {
  await channels(s);
  // As the Daily log writer renders one (#237's brief): the topic row links every message of its topic, the question first.
  // The head's Topics and Keywords lines and the topic row hold the most query words, so they fill the three lines a match shows.
  await s.workspace.write(`${GENERAL}/daily-logs/2026-10/2026-10-05.md`, `---\nkind: "daily-log"\nlog: {"decided":[{"text":"Audio normalization goes to -14 LUFS.","links":["${dl(7002).slice(4, -1)}"]}]}\ntopics: ["Audio normalization"]\nkeywords: ["audio normalization", "normalisasi audio", "loudness"]\n---\n`
    + "# Daily log #general, 2026-10-05\n\nTopics: Audio normalization\nKeywords: audio normalization, normalisasi audio, loudness\n4 messages from Dewi, Bob, Alice\n\n"
    + `## Topics\n1. Audio normalization: audio normalization, normalisasi audio, loudness ${dl(7001)} ${dl(7002)} ${dl(7003)} ${dl(7004)}\n\n## Decided\n2. Audio normalization goes to -14 LUFS. ${dl(7002)} ${dl(7003)}\n\n`
    + `## Who does what next\n3. **Dewi**: Send the mastering notes. ${dl(7004)}\n`);
  await s.workspace.write(`${GENERAL}/daily-logs/2026-10/2026-10-06.md`, `# Daily log #general, 2026-10-06\n\n## Topics\n1. Audio normalization: plugins ${dl(7101)} ${dl(7102)}\n\n## Decided\n*None*\n`);
  const [result] = await recall(s, [QUERIES]);
  expect(Object.fromEntries(result.kept.map((k: any) => [k.label, k.url]))).toEqual({
    "#general · Daily log 2026-10-05": "https://discord.com/channels/guild-1/channel-1/7003",
    "#general · Daily log 2026-10-06": "https://discord.com/channels/guild-1/channel-1/7101",
  });
});

discordScenario("a pull request or issue closed is labelled with the day it closed in the place's zone; an open one with no day", async (s) => {
  await channels(s);
  await s.git({ provider: "github", repos: ["acme/*"] });
  s.http.on("GET api.github.com/user/repos", () => [{ full_name: "acme/api", owner: { login: "acme" }, private: true, default_branch: "main", updated_at: "2026-10-10T00:00:00Z", html_url: "https://github.com/acme/api" }]);
  s.http.on("GET api.github.com/search/issues", () => ({ total_count: 2, items: [
    { number: 51, title: "Audio normalization, first try", state: "closed", html_url: "https://github.com/acme/api/pull/51", updated_at: "2026-10-03T00:00:00Z", closed_at: "2026-10-01T20:00:00Z",
      pull_request: { merged_at: null, html_url: "https://github.com/acme/api/pull/51" } },
    { number: 60, title: "Audio normalization for podcasts", state: "open", html_url: "https://github.com/acme/api/issues/60", updated_at: "2026-10-13T09:00:00Z" },
  ] }));
  s.http.on("GET api.github.com/repos/acme/api/commits", () => []);
  s.http.on("GET api.github.com/search/commits", () => ({ total_count: 0, items: [] }));
  const [result] = await recall(s, [QUERIES]);
  // 20:00 UTC on 1 October is 03:00 on 2 October in Jakarta.
  expect(result.work.map((w: any) => w.label).sort()).toEqual([
    "acme/api · issue #60 \"Audio normalization for podcasts\" (open)",
    "acme/api · pull request #51 \"Audio normalization, first try\" (closed 2026-10-02)",
  ]);
});

discordScenario("a Document whose name has no date is labelled with the date its first line gives, otherwise as filed", async (s) => {
  await channels(s);
  await s.workspace.write(`${GENERAL}/files/sinar-printing-call-minutes.md`, "Call with Sinar Printing, 6 October 2026\nPresent: Alice, Bob\n\n- The brochures arrive on 23 October.\n");
  await s.workspace.write(`${GENERAL}/files/notulen-vendor.md`, "# Notulen rapat vendor 2 Oktober 2026\n\n- Brosur dicetak di Sinar Printing.\n");
  await s.workspace.write(`${GENERAL}/files/brochure-prices.md`, "Brochure prices\nUpdated 1 September 2026: 2,000 brochures for 4 million.\n");
  const [result] = await recall(s, [{ queries: ["brochures", "brosur"] }]);
  const labels = result.kept.map((k: any) => k.label).sort();
  expect(labels.slice(0, 2)).toEqual(["#general · Document 2026-10-02", "#general · Document 2026-10-06"]);
  expect(labels[2]).toMatch(/^#general · Document, filed \d{4}-\d{2}-\d{2}$/);
});

discordScenario("without a Git scope or a Plane scope, those parts are named unavailable and nothing is asked of them", async (s) => {
  const { repositories } = await import("@pachiware/db");
  await channels(s);
  await s.git({ provider: "github", repos: ["acme/*"] });
  await repositories().git.replaceScopes(s.tenant.id, s.bot.id, "guild-1", "", []);
  await s.plane({ projects: null });
  const [result] = await recall(s, [QUERIES]);
  expect(result.unavailable).toEqual({
    git: expect.stringContaining("No git account is enabled for this channel"),
    plane: expect.stringContaining("Plane is not enabled here"),
  });
  expect(result.nothingFound).toEqual(["kept", "tasks"]);
  expect(s.http.requests).toEqual([]);
});

discordScenario("an Availability rule turning listTasks or repoSearchWork off in a channel keeps that part from running there", async (s) => {
  await channels(s);
  await github(s);
  await s.workspace.write(`${GENERAL}/tasks/task-1.md`, task(1, "Normalisasi audio", "pending"));
  await s.availability({ level: "channel", channelId: "channel-1" }, { kind: "tool", name: "listTasks", value: "off" });
  await s.availability({ level: "channel", channelId: "channel-1" }, { kind: "tool", name: "repoSearchWork", value: "off" });
  const [result] = await recall(s, [QUERIES]);
  expect(result.tasks).toEqual([]);
  expect(result.work).toEqual([]);
  expect(result.unavailable).toMatchObject({ tasks: "not available here", git: "not available here" });
  expect(s.http.requests.some((r) => r.url.includes("api.github.com"))).toBe(false);
});

discordScenario("asked from #general, a non-public channel's Minutes and Tasks are counted under notShownHere and never named", async (s) => {
  await channels(s);
  await s.workspace.write(`${DIREKSI}/minutes/2026-10-01-board.md`, "# Board\nAudio normalization budget approved.\n");
  await s.workspace.write(`${DIREKSI}/tasks/task-2.md`, task(2, "Audio normalization gear", "pending"));
  const [result] = await recall(s, [QUERIES]);
  expect(result).toMatchObject({ kept: [], tasks: [], notShownHere: 2 });
  expect(JSON.stringify(result)).not.toMatch(/direksi|board|gear|channel-3/i);
});

discordScenario("on a crowded Workspace the result keeps to its budgets and stays under the loop's 12,000-character cut", async (s) => {
  await channels(s);
  const long = "Audio normalization ".repeat(40);
  for (let d = 1; d <= 28; d++) {
    const day = `2026-09-${String(d).padStart(2, "0")}`;
    await s.workspace.write(`${GENERAL}/minutes/${day}-audio-normalization-review-with-a-long-name.md`, `---\ntitle: "Review"\nguildId: "guild-1"\npostedIn: "channel-1"\nmessageId: "${8000 + d}"\n---\n${long}\n${long}\n${long}\n`);
    await s.workspace.write(`${GENERAL}/tasks/task-${d}.md`, task(1, `Audio normalization step ${d} ${"with a very long title ".repeat(4)}`, "pending").replace(/0000000(1)-/, `${String(d).padStart(8, "0")}-`));
  }
  const [result] = await recall(s, [QUERIES]);
  expect(result.kept.length).toBeLessThanOrEqual(10);
  expect(result.tasks.length).toBeLessThanOrEqual(10);
  expect(JSON.stringify(result).length).toBeLessThan(12000);
  expect(s.model.calls.at(-1)!.map((m) => String(m.content)).join("")).not.toContain("[truncated");
});

discordScenario("two recall calls in one turn give refs that do not repeat", async (s) => {
  await channels(s);
  await s.workspace.write(`${GENERAL}/notes/2026-10-01-audio.md`, "Audio normalization is on the roadmap.\n");
  await s.workspace.write(`${GENERAL}/notes/2026-10-02-pricing.md`, "Pricing stays flat.\n");
  const [first, second] = await recall(s, [QUERIES, { queries: ["pricing", "harga"] }]);
  expect(first.kept.map((k: any) => k.ref)).toEqual(["K1"]);
  expect(second.kept.map((k: any) => k.ref)).toEqual(["K2"]);
});

const DAILY_LOG = "# Daily log #audio, 2026-10-05\n\n## Topics\n1. Mixing: stems [↗](https://discord.com/channels/guild-1/channel-2/7001)\n";

discordScenario("recall that finds nothing kept names the quotable channels it searched that keep no Daily logs, never a channel it cannot show here", async (s) => {
  await channels(s);
  await s.workspace.write(`${GENERAL}/notes/2026-10-01-lunch.md`, "Lunch is at noon on Fridays.\n");
  await s.workspace.write(`${AUDIO}/daily-logs/2026-10/2026-10-05.md`, DAILY_LOG);
  await s.workspace.write(`${DIREKSI}/notes/2026-10-02-board.md`, "The board meets quarterly.\n");
  const [result] = await recall(s, [{ queries: ["anggaran kantor", "office budget"] }]);
  expect(result.kept).toEqual([]);
  expect(result.notLogged).toEqual(["#general"]);
});

discordScenario("recall with a strong match, or from channels that all keep Daily logs, names nothing under notLogged", async (s) => {
  await channels(s);
  await s.workspace.write(`${AUDIO}/minutes/2026-09-01-loudness.md`, MINUTES);
  const [strong] = await recall(s, [QUERIES]);
  expect(strong.kept).toHaveLength(1);
  expect(strong.notLogged).toBeUndefined();

  await s.workspace.write(`${GENERAL}/daily-logs/2026-10-04.md`, "# Daily log #general, 2026-10-04\n\n## Topics\n1. Lunch [↗](https://discord.com/channels/guild-1/channel-1/7000)\n");
  await s.workspace.write(`${AUDIO}/daily-logs/2026-10/2026-10-05.md`, DAILY_LOG);
  const [none] = await recall(s, [{ queries: ["anggaran kantor", "office budget"] }]);
  expect(none.kept).toEqual([]);
  expect(none.notLogged).toBeUndefined();
});

// Today's talk (#246): no Daily log holds it yet, so recall reads the place's messages since midnight when kept material answers weakly.
discordScenario("recall finds what was said today, since midnight in the place's zone, with a link, and leaves out yesterday's talk and the question itself", async (s) => {
  await s.guildSettings({ useThreads: false, language: "id" });
  s.clock.set("2026-10-14T05:00:00Z"); // 12:00 in Jakarta
  s.discord.history([
    { content: "normalisasi audio masih rusak di Android", author: s.discord.bob, at: Date.parse("2026-10-13T15:00:00Z") }, // 22:00 yesterday
    { content: "normalisasi audio sudah aku merge tadi, tinggal QA", author: s.discord.bob, at: Date.parse("2026-10-14T02:30:00Z") }, // 09:30 today
    { content: "makan siang di mana?", author: s.discord.alice, at: Date.parse("2026-10-14T03:00:00Z") },
  ]);
  let result: any;
  s.model.script({ tool: "recall", args: { queries: ["normalisasi audio", "audio normalization"] } }, (turn) => { result = turn.toolResults[0]; return "ok"; });
  await s.discord.send(`${s.discord.mention} normalisasi audio udah beres belum?`);
  expect(result.kept).toEqual([]);
  expect(result.talk).toHaveLength(1);
  expect(result.talk[0]).toMatchObject({ ref: "K1", label: expect.stringMatching(/ · obrolan hari ini 09:30, Bob$/), url: expect.stringMatching(/^https:\/\/discord\.com\/channels\/guild-1\/channel-1\/\d+$/) });
  expect(result.talk[0].lines[0].text).toBe("normalisasi audio sudah aku merge tadi, tinggal QA");
});

discordScenario("when a kept file answers well, today's talk is not read", async (s) => {
  await s.guildSettings({ useThreads: false, language: "en" });
  await s.workspace.write("guilds/guild-1/channels/channel-1/minutes/2026-10-01-loudness.md", "# Loudness\nAudio normalization targets -14 LUFS.\n");
  s.discord.history([{ content: "audio normalization is merged", author: s.discord.bob, at: Date.now() - 60_000 * 30 }]);
  let result: any;
  s.model.script({ tool: "recall", args: { queries: ["audio normalization"] } }, (turn) => { result = turn.toolResults[0]; return "ok"; });
  await s.discord.send(`${s.discord.mention} is audio normalization done?`);
  expect(result.kept).toHaveLength(1);
  expect(result.talk).toBeUndefined();
});
