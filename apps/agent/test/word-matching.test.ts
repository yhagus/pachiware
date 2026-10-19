import { expect } from "bun:test";
import { discordScenario, type Scenario } from "./support/discordScenario";
import { fakePlane } from "./support/fakePlane";

// Shared word matching (#209): whole words after a light stem, filler words dropped, name and keyword header weighing more than the body.

const CHANNEL = "guilds/guild-1/channels/channel-1";
const paths = (turn: any) => JSON.stringify((turn.toolResults[0].matches ?? []).map((m: any) => m.path));
async function search(s: Scenario, args: Record<string, unknown>): Promise<string[]> {
  s.model.script({ tool: "searchFiles", args: { path: "channel/", ...args } }, paths);
  await s.discord.send(`${s.discord.mention} search`);
  return JSON.parse(s.discord.botMessages.at(-1)!.content);
}

discordScenario("\"normalisasi audio\" finds Minutes that only say \"audio normalization\", with no keyword header, above a file that only says \"audio\"", async (s) => {
  await s.workspace.write(`${CHANNEL}/minutes/2026-09-01-sync.md`, "# Sync\n\n## Decided\n1. Audio normalization targets -14 LUFS.\n");
  await s.workspace.write(`${CHANNEL}/notes/2026-10-01-gear.md`, "We bought a new audio interface.\n");
  expect(await search(s, { query: "normalisasi audio" })).toEqual(["channel/minutes/2026-09-01-sync.md", "channel/notes/2026-10-01-gear.md"]);
});

discordScenario("a word matches whole words only: \"log\" misses \"blog\" and \"catalog\", while \"rilisnya\" and \"releases\" find \"rilis\" and \"release\"", async (s) => {
  await s.workspace.write(`${CHANNEL}/notes/2026-10-01-blog.md`, "The blog has a new catalog page.\n");
  await s.workspace.write(`${CHANNEL}/notes/2026-10-02-logs.md`, "Server log rotation is on.\n");
  await s.workspace.write(`${CHANNEL}/notes/2026-10-03-rilis.md`, "Jadwal rilis versi 2.4 mundur.\n");
  await s.workspace.write(`${CHANNEL}/notes/2026-10-04-release.md`, "The release checklist is ready.\n");
  expect(await search(s, { query: "log" })).toEqual(["channel/notes/2026-10-02-logs.md"]);
  expect(await search(s, { queries: ["rilisnya", "releases"] })).toEqual(["channel/notes/2026-10-04-release.md", "channel/notes/2026-10-03-rilis.md"]);
});

discordScenario("a question asked as a full sentence of filler words finds the same file first as its key words alone", async (s) => {
  await s.workspace.write(`${CHANNEL}/minutes/2026-09-01-loudness.md`, "# Loudness\n\nAudio normalization was implemented in the export pipeline.\n");
  await s.workspace.write(`${CHANNEL}/notes/2026-10-05-faq.md`, "Apakah sudah ada yang pernah tanya? Siapa yang mau dan kapan? Apa saja yang dibahas sudah dicatat.\n");
  await s.workspace.write(`${CHANNEL}/notes/2026-10-06-audio.md`, "Ada efek audio baru di aplikasi, sudah dibahas dan sudah pernah dicoba.\n");
  const sentence = await search(s, { query: "apakah fitur normalisasi audio sudah pernah dibahas dan diimplementasi?" });
  const keywords = await search(s, { query: "normalisasi audio" });
  expect(sentence[0]).toBe("channel/minutes/2026-09-01-loudness.md");
  expect(keywords[0]).toBe("channel/minutes/2026-09-01-loudness.md");
  expect(sentence).not.toContain("channel/notes/2026-10-05-faq.md");
});

/** About 300 words of a busy day, mentioning audio normalization once among other topics. */
const busyDay = [
  "# Daily log #channel-1, 2026-10-10", "",
  ...Array.from({ length: 30 }, (_, i) => `${i + 1}. Tim membahas jadwal rapat, desain ikon, pengujian aplikasi di HP lama, dan rencana kampanye bulan depan.`),
  "31. Audio normalization disebut sekilas saat makan siang.",
].join("\n");

discordScenario("Minutes about a topic rank above a newer, long Daily log that mentions it once", async (s) => {
  await s.workspace.write(`${CHANNEL}/daily-logs/2026-10-10.md`, busyDay);
  await s.workspace.write(`${CHANNEL}/minutes/2026-09-01-loudness.md`,
    "# Loudness\n\n## Decided\n1. Audio normalization follows EBU R128.\n2. Audio normalization runs on every export.\n\n## Action items\n3. **Rina**: Ship audio normalization.\n");
  expect(await search(s, { query: "audio normalization" })).toEqual(["channel/minutes/2026-09-01-loudness.md", "channel/daily-logs/2026-10-10.md"]);
});

discordScenario("a file whose name or keyword header holds the words ranks above a newer one holding them only in its body", async (s) => {
  await s.workspace.write(`${CHANNEL}/notes/2026-09-01-kickoff.md`, `---\ntopics: ["Podcast target"]\nkeywords: ["loudness","LUFS"]\n---\nRina set the target for podcasts.\n`);
  await s.workspace.write(`${CHANNEL}/notes/2026-09-02-loudness.md`, "Rina set the target for podcasts.\n");
  await s.workspace.write(`${CHANNEL}/notes/2026-10-01-misc.md`, "We talked about loudness in passing.\n");
  expect(await search(s, { query: "loudness" })).toEqual([
    "channel/notes/2026-09-02-loudness.md", "channel/notes/2026-09-01-kickoff.md", "channel/notes/2026-10-01-misc.md",
  ]);
});

const taskId = "00000001-0000-4000-8000-000000000001";
discordScenario("a Task titled \"Normalisasi audio\" is found by listTasks with \"audio normalization\"; one that holds only \"audio\" comes after it, marked partial (#258)", async (s) => {
  const task = (id: string, title: string) => `---\nid: "${id}"\ntitle: ${JSON.stringify(title)}\nstatus: "pending"\npriority: "medium"\nassignedTo: null\ndueAt: null\ncreatedBy: "user-bob"\ncreatedByName: "Bob"\ncreatedAt: "2026-10-01T00:00:00.000Z"\nupdatedAt: "2026-10-01T00:00:00.000Z"\n---\n`;
  await s.workspace.write(`${CHANNEL}/tasks/task-1.md`, task(taskId, "Normalisasi audio"));
  await s.workspace.write(`${CHANNEL}/tasks/task-2.md`, task("00000002-0000-4000-8000-000000000002", "Beli audio interface"));
  s.model.script({ tool: "listTasks", args: { query: "audio normalization" } }, (turn) => JSON.stringify(turn.toolResults[0].tasks.map((t: any) => [t.title, t.partial ?? false])));
  await s.discord.send(`${s.discord.mention} is audio normalization a task?`);
  expect(JSON.parse(s.discord.botMessages.at(-1)!.content)).toEqual([["Normalisasi audio", false], ["Beli audio interface", true]]);
});

discordScenario("a commit message and a Work item title in Indonesian are found by \"audio normalization\"", async (s) => {
  await s.git({ provider: "github", repos: ["acme/*"] });
  s.http.on("GET api.github.com/user/repos", () => [{ full_name: "acme/api", owner: { login: "acme" }, private: true, default_branch: "main", updated_at: "2026-10-10T00:00:00Z", html_url: "https://github.com/acme/api" }]);
  s.http.on("GET api.github.com/search/issues", () => ({ total_count: 0, items: [] }));
  const COMMITS_ID = [
    { sha: "abc1234567890", commit: { message: "Tambah normalisasi audio di pipeline ekspor", author: { name: "Bob", date: "2026-10-11T08:00:00Z" } }, html_url: "https://github.com/acme/api/commit/abc1234567890" },
    { sha: "def1234567890", commit: { message: "Perbaiki audio interface driver", author: { name: "Bob", date: "2026-10-11T07:00:00Z" } }, html_url: "https://github.com/acme/api/commit/def1234567890" },
  ];
  s.http.on("GET api.github.com/repos/acme/api/commits", () => COMMITS_ID);
  // GitHub's commit search: a commit whose message holds the query's words.
  s.http.on("GET api.github.com/search/commits", (req) => { const words = (new URL(req.url).searchParams.get("q") ?? "").toLowerCase().split(/\s+/).filter((w) => w && !w.includes(":")); return { total_count: 0, items: COMMITS_ID.filter((c) => words.every((w) => c.commit.message.toLowerCase().includes(w))) }; });
  const ENG = "11111111-1111-4111-8111-111111111111";
  await s.plane({ projects: [ENG] });
  const plane = fakePlane(s);
  plane.user({ id: "u-bot", first_name: "Plane", last_name: "Bot", display_name: "pachibot", email: "bot@acme.test" });
  plane.project({ id: ENG, name: "Engineering", identifier: "ENG" }, ["u-bot"]);
  const done = plane.state({ project: ENG, name: "Done", group: "completed" });
  plane.item({ project: ENG, sequence_id: 5, name: "Normalisasi audio podcast", state: done.id, updated_at: "2026-10-14T08:00:00.000000Z" });
  plane.item({ project: ENG, sequence_id: 6, name: "Audio interface baru", state: done.id, updated_at: "2026-10-15T08:00:00.000000Z" });

  s.model.script([{ tool: "repoSearchWork", args: { queries: ["audio normalization"] } }, { tool: "workItemList", args: { queries: ["audio normalization"] } }],
    (turn) => JSON.stringify([turn.toolResults[0].items.map((i: any) => i.title), turn.toolResults[1].items.map((i: any) => i.name)]));
  await s.discord.send(`${s.discord.mention} is audio normalization done?`);
  expect(JSON.parse(s.discord.botMessages.at(-1)!.content)).toEqual([["Tambah normalisasi audio di pipeline ekspor"], ["Normalisasi audio podcast"]]);
});

// Indonesian prefixes, the bilingual work vocabulary and stem collisions (#223, ADR 0015).

discordScenario("\"fitur yang diimplementasikan\" finds Minutes saying \"implementasi\" above a note about another feature", async (s) => {
  await s.workspace.write(`${CHANNEL}/minutes/2026-09-01-sync.md`, "# Sync\n\n## Decided\n1. Implementasi fitur template ekspor selesai minggu ini.\n");
  await s.workspace.write(`${CHANNEL}/notes/2026-10-01-ideas.md`, "Ide fitur baru: mode gelap.\n");
  expect(await search(s, { query: "fitur yang diimplementasikan" })).toEqual(["channel/minutes/2026-09-01-sync.md", "channel/notes/2026-10-01-ideas.md"]);
});

discordScenario("\"kapan rilis 2.4?\" finds \"release 2.4 moves to 14 October\" above a newer note that only says 2.4", async (s) => {
  await s.workspace.write(`${CHANNEL}/decisions/2026-09-01-release.md`, "Release 2.4 moves to 14 October.\n");
  await s.workspace.write(`${CHANNEL}/notes/2026-10-01-features.md`, "Versi 2.4 mendukung ekspor MP3.\n");
  expect(await search(s, { query: "kapan rilis 2.4?" })).toEqual(["channel/decisions/2026-09-01-release.md", "channel/notes/2026-10-01-features.md"]);
});

discordScenario("\"normalisasi audio\" puts the audio-normalization Minutes above a newer Daily log saying \"server keadaan normal\"", async (s) => {
  await s.workspace.write(`${CHANNEL}/minutes/2026-09-01-loudness.md`, "# Loudness\n\n## Decided\n1. Audio normalization targets -14 LUFS for every episode we publish from now on.\n");
  await s.workspace.write(`${CHANNEL}/daily-logs/2026-10-10.md`, "# Daily log #channel-1, 2026-10-10\n\n1. Server keadaan normal lagi.\n2. Audio episode 12 diunggah.\n");
  expect(await search(s, { query: "normalisasi audio" })).toEqual(["channel/minutes/2026-09-01-loudness.md", "channel/daily-logs/2026-10-10.md"]);
});
