/**
 * One scripted dry run per brief the Rapor added (spec #226, #239), as in eval-assistant-dry-run.test.ts: the script makes the tool calls a
 * good answer needs, the run goes through the real bot against the fake clock, and the output passes every code check. With EVAL_RECORD=1
 * each run is written to apps/agent/eval/recorded/assistant/, where eval-assistant-checks.test.ts re-checks it.
 */
import { expect } from "bun:test";
import { discordScenario, type Scenario } from "./support/discordScenario";

const EVAL = () => process.cwd() + "/apps/agent/eval";
type Turn = { messages: { role: string; content: unknown }[]; toolResults: any[] };
const contextLines = (turn: Turn, pattern: RegExp) => String(turn.messages.findLast((m) => m.role === "user")?.content).match(pattern) ?? [];
const numberOf = (turn: Turn, phrase: string) => Number(contextLines(turn, /^\[\d+\] .*$/gm).find((l) => l.includes(phrase))?.match(/^\[(\d+)\]/)?.[1]);
/** The id of the task whose line in the turn context ends with `title`. */
const taskId = (turn: Turn, title: string) => contextLines(turn, new RegExp(`^\\S+ \\| .* \\| ${title}$`, "gm"))[0]!.split(" | ")[3]!;

async function dryRun(s: Scenario, name: string) {
  const { runAssistantFixture, gradeAssistantRun } = await import(`${EVAL()}/assistantRun.ts`);
  const { loadAssistantFixtures } = await import(`${EVAL()}/assistantFixtures.ts`);
  const fixture = loadAssistantFixtures().find((f: any) => f.name === name)!;
  const output = await runAssistantFixture(s, fixture);
  if (process.env.EVAL_RECORD === "1") {
    const { writeFileSync, mkdirSync } = await import("node:fs");
    mkdirSync(`${EVAL()}/recorded/assistant`, { recursive: true });
    writeFileSync(`${EVAL()}/recorded/assistant/${name}.json`, `${JSON.stringify({ profile: { provider: "scripted", model: "dry run" }, ...output }, null, 2)}\n`);
  }
  const graded = gradeAssistantRun(output, fixture);
  expect(graded.failures).toEqual([]);
  expect(graded.passed).toBe(true);
  return output;
}

discordScenario("dry run: pdf-ditanya-kemudian files the contract PDF with its text, then answers its value and end date from it", async (s) => {
  s.model.script(
    "Tersimpan sebagai kontrak-sablon-jaya.pdf di files/, beserta teksnya.",
    { tool: "readFile", args: { path: "channel/files/kontrak-sablon-jaya.md" } },
    (turn) => {
      const text: string = turn.toolResults[0].content;
      return `Nilai kontraknya ${text.match(/Rp [\d.]+/)![0]}, berlaku sampai ${text.match(/sampai (\d+ \w+ \d{4})/)![1]} (kontrak-sablon-jaya).`;
    },
  );
  const output = await dryRun(s, "pdf-ditanya-kemudian");
  expect(output.turns[1].replies).toEqual(["Nilai kontraknya Rp 12.500.000, berlaku sampai 31 Oktober 2027 (kontrak-sablon-jaya)."]);
});

discordScenario("dry run: notulen-pemilik-tenggat keeps both action items with their owners and when, the decision and the open question", async (s) => {
  s.model.script((turn) => JSON.stringify({
    title: "Sprint planning",
    decided: [{ text: "Sprint depan fokus ke fitur ekspor PDF", ref: numberOf(turn, "fokus ke fitur") }],
    open: [{ text: "Batas ukuran file ekspor belum ditentukan", ref: numberOf(turn, "Batas ukuran") }],
    actions: [
      { owner: "Bob", task: "Mengerjakan API ekspor", due: "Kamis", ref: numberOf(turn, "API ekspornya") },
      { owner: "Dewi", task: "Menyiapkan desain tombol ekspor", due: "besok", ref: numberOf(turn, "desain tombol") },
    ],
  }));
  const output = await dryRun(s, "notulen-pemilik-tenggat");
  const [minutes] = output.turns[0].state.kept;
  expect(minutes.path).toBe("minutes/2026-10-14-sprint-planning.md");
  expect(minutes.text).toContain("**Bob**: Mengerjakan API ekspor");
  expect(minutes.text).toContain("**Dewi**: Menyiapkan desain tombol ekspor");
});

discordScenario("dry run: holdout-parafrasa-volume finds the mastering Minutes asked about in other words, and cites them", async (s) => {
  s.model.script(
    { tool: "recall", args: { queries: ["menyamakan volume antar episode podcast", "podcast volume normalization", "loudness episode"] } },
    (turn) => {
      const [minutes] = turn.toolResults[0].kept;
      return `Pernah dibahas [${minutes.ref}]: ${minutes.lines[0].text.replace(/^\d+\. /, "").replace(/ \[↗\].*$/, "")}.`;
    },
  );
  const output = await dryRun(s, "holdout-parafrasa-volume");
  expect(output.turns[0].replies).toEqual(["Pernah dibahas [#channel-1 · Notulen 2026-09-22](<https://discord.com/channels/guild-1/channel-1/6200>): Semua episode di-master ke -16 LUFS supaya volumenya rata dari episode ke episode."]);
});

discordScenario("dry run: sudah-diimplementasi-pr-ditutup answers done from the merged pull request and names the one closed without merging", async (s) => {
  s.model.script(
    { tool: "recall", args: { queries: ["ekspor CSV laporan penjualan", "export sales report CSV"] } },
    (turn) => {
      const work: any[] = turn.toolResults[0].work, merged = work.find((w) => w.label.includes("#57")), closed = work.find((w) => w.label.includes("#51"));
      return `Sudah diimplementasi [${merged.ref}]. Yang ini ditutup tanpa di-merge, jadi bukan itu yang menyelesaikannya: [${closed.ref}].`;
    },
  );
  const output = await dryRun(s, "sudah-diimplementasi-pr-ditutup");
  expect(output.turns[0].replies[0]).toContain("(<https://github.com/acme/dashboard/pull/57>)");
  expect(output.turns[0].replies[0]).toContain("(<https://github.com/acme/dashboard/pull/51>)");
});

discordScenario("dry run: keputusan-bertentangan gives the newer release-day Decision and names the older one as replaced", async (s) => {
  s.model.script(
    { tool: "recall", args: { queries: ["hari rilis versi baru", "release day"] } },
    (turn) => {
      const [newer, older] = [...turn.toolResults[0].kept].sort((a: any, b: any) => b.label.localeCompare(a.label));
      return `Versi baru dirilis Senin pagi [${newer.ref}]. Itu menggantikan rilis Jumat sore [${older.ref}].`;
    },
  );
  const output = await dryRun(s, "keputusan-bertentangan");
  expect(output.turns[0].replies).toEqual(["Versi baru dirilis Senin pagi #channel-1 · Keputusan 2026-10-06. Itu menggantikan rilis Jumat sore #channel-1 · Keputusan 2026-09-15."]);
});

discordScenario("dry run: channel-tanpa-daily-log searches twice, finds nothing, and says the channel keeps no Daily logs and who can turn them on", async (s) => {
  s.model.script(
    { tool: "recall", args: { queries: ["ganti vendor hosting", "hosting provider change"] } },
    { tool: "recall", args: { queries: ["pindah hosting", "hosting migration"] } },
    (turn) => `Saya tidak menemukan apa pun soal ganti vendor hosting. ${turn.toolResults.at(-1).notLogged.join(", ")} belum punya Daily log, jadi obrolan yang tidak diminta disimpan tidak bisa dicari setelah sehari; admin bisa menyalakan Daily log di console.`,
  );
  const output = await dryRun(s, "channel-tanpa-daily-log");
  expect(output.turns[0].replies[0]).toContain("#channel-1 belum punya Daily log");
});

discordScenario("dry run: notulen-jadi-tugas writes the Minutes, then reads them and files each action item as a Task with its owner and due date", async (s) => {
  s.model.script(
    (turn) => JSON.stringify({
      title: "Rapat gathering",
      decided: [{ text: "Gathering tanggal 24 Oktober", ref: numberOf(turn, "sudah fix") }],
      open: [],
      actions: [
        { owner: "Bob", task: "Booking venue", due: "Kamis", ref: numberOf(turn, "booking venue") },
        { owner: "Dewi", task: "Urus konsumsi", due: "Jumat", ref: numberOf(turn, "urus konsumsi") },
      ],
    }),
    { tool: "searchFiles", args: { query: "rapat gathering", path: "channel/minutes" } },
    (turn) => ({ tool: "readFile", args: { path: turn.toolResults[0].matches[0].path } }),
    [
      { tool: "createTask", args: { title: "Booking venue gathering", assignedTo: "Bob", dueAt: "2026-10-15" } },
      { tool: "createTask", args: { title: "Urus konsumsi gathering", assignedTo: "Dewi", dueAt: "2026-10-16" } },
    ],
    "Dicatat: booking venue gathering untuk Bob, jatuh tempo Kamis 15 Oktober, dan urus konsumsi gathering untuk Dewi, jatuh tempo Jumat 16 Oktober.",
  );
  const output = await dryRun(s, "notulen-jadi-tugas");
  expect(output.turns[1].state.tasks.map((t: any) => [t.title, t.assignedTo, t.dueAt])).toEqual([["Booking venue gathering", "Bob", "2026-10-15"], ["Urus konsumsi gathering", "Dewi", "2026-10-16"]]);
});

discordScenario("dry run: telat-per-orang lists the late tasks under each person and leaves out the done one and the one not yet due", async (s) => {
  s.model.script(
    { tool: "listTasks", args: { late: true } },
    (turn) => {
      const tasks: any[] = turn.toolResults[0].tasks, people = [...new Set(tasks.map((t) => t.assignedTo?.name ?? "Belum ada"))].sort();
      return people.map((p) => [`${p}:`, ...tasks.filter((t) => (t.assignedTo?.name ?? "Belum ada") === p).map((t) => t.line)].join("\n")).join("\n");
    },
  );
  const output = await dryRun(s, "telat-per-orang");
  expect(output.turns[0].replies[0].split("\n").filter((l: string) => l.endsWith(":"))).toEqual(["Bob:", "Dewi:"]);
});

discordScenario("dry run: pengingat-berulang sets a weekly Monday 09:00 Reminder, and the tick posts the first one with a ping", async (s) => {
  s.model.script(
    { tool: "createReminder", args: { text: "kirim laporan mingguan ke klien", recurrence: "weekly", weekdays: ["monday"], time: "09:00" } },
    "Siap: tiap Senin jam 09:00, mulai Senin 19 Oktober.",
  );
  const output = await dryRun(s, "pengingat-berulang");
  expect(output.posts).toEqual([{ text: `<@${s.discord.alice.id}> Pengingat: kirim laporan mingguan ke klien`, pings: [s.discord.alice.id] }]);
});

discordScenario("dry run: colek-h-1 sets a Reminder pinging Bob the day before, then moves it with the due date", async (s) => {
  const text = "Bob, besok tenggat Kirim desain final ke percetakan";
  s.model.script(
    { tool: "createReminder", args: { text, at: "2026-10-15T09:00", mentions: ["<@user-bob>"] } },
    "Siap, Bob saya colek Kamis 15 Oktober jam 09:00, sehari sebelum tenggat.",
    (turn) => [{ tool: "setTaskDueDate", args: { taskId: taskId(turn, "Kirim desain final ke percetakan"), dueAt: "2026-10-19" } }, { tool: "listReminders", args: {} }],
    (turn) => [{ tool: "cancelReminder", args: { id: turn.toolResults[1].reminders[0].id } }, { tool: "createReminder", args: { text, at: "2026-10-18T09:00", mentions: ["<@user-bob>"] } }],
    "Tenggat jadi Senin 19 Oktober; colekan untuk Bob pindah ke Minggu 18 Oktober jam 09:00.",
  );
  const output = await dryRun(s, "colek-h-1");
  expect(output.posts.map((p: any) => p.text)).toEqual([`<@${s.discord.alice.id}> <@user-bob> Pengingat: ${text}`]);
});

discordScenario("dry run: dua-orang-bersamaan answers Bob's question and files Alice's task as hers, from one burst", async (s) => {
  s.model.script(
    { tool: "createTask", args: { title: "Siapkan rundown acara ulang tahun kantor", dueAt: "2026-10-16" } },
    "Dicatat: siapkan rundown acara ulang tahun kantor, jatuh tempo Jumat 16 Oktober.",
    // Alice's line mentions the bot, so her turn is ready first; Bob's waits on a look at whether the bot spoke last.
    { tool: "createTask", args: { title: "Booking tempat", assignedTo: "Bob" } },
    "Dicatat untuk Bob: booking tempat.",
    "Tenggat rundown Jumat 16 Oktober 2026.",
  );
  const output = await dryRun(s, "dua-orang-bersamaan");
  expect(output.turns[1].authors).toEqual(["Bob", "Alice"]);
  expect(output.turns[1].replies).toEqual(["Dicatat untuk Bob: booking tempat.", "Tenggat rundown Jumat 16 Oktober 2026."]);
});

discordScenario("dry run: balasan-untuk-orang-lain stays quiet when Bob asks Dewi, then keeps Dewi's report on her task", async (s) => {
  s.model.script(
    { tool: "createTask", args: { title: "Cek stok merchandise di gudang", assignedTo: "Dewi", dueAt: "2026-10-15" } },
    "Dicatat untuk Dewi: cek stok merchandise di gudang, jatuh tempo Kamis 15 Oktober.",
    (turn) => ({ tool: "addProgressNote", args: { taskId: taskId(turn, "Cek stok merchandise di gudang"), text: "Stok tinggal 40 kaos" } }),
    "Dicatat di tugas cek stok merchandise: stok tinggal 40 kaos.",
  );
  const output = await dryRun(s, "balasan-untuk-orang-lain");
  expect(output.turns[1].replies).toEqual([]);
  expect(s.model.calls).toHaveLength(4);
});

discordScenario("dry run: makasih-reaksi answers the due date, then acknowledges the thanks with a reaction alone", async (s) => {
  const { reactionMarker } = await import("../src/discord/replyStyle");
  s.model.script("Tenggat sewa sound system Sabtu 17 Oktober 2026.", reactionMarker("👍"));
  const output = await dryRun(s, "makasih-reaksi");
  expect(output.turns[1]).toMatchObject({ replies: [], reactions: ["👍"] });
});

discordScenario("dry run: tiga-alat-sekaligus files the Task, sets the Reminder and keeps the Memory line in one turn", async (s) => {
  s.model.script(
    [
      { tool: "createTask", args: { title: "Siapkan proposal sponsor", assignedTo: "Bob", dueAt: "2026-10-16" } },
      { tool: "createReminder", args: { text: "cek proposal sponsor", at: "2026-10-15T16:00" } },
      { tool: "remember", args: { level: "channel", text: "Sponsor utama kita Kopi Senja" } },
    ],
    "Dicatat: siapkan proposal sponsor untuk Bob, jatuh tempo Jumat 16 Oktober. Pengingat Kamis 15 Oktober jam 16:00 untuk cek proposalnya.",
  );
  const output = await dryRun(s, "tiga-alat-sekaligus");
  expect(output.turns[0].state.memory.channel.some((l: string) => l.includes("Kopi Senja"))).toBe(true);
});

discordScenario("dry run: tanpa-link-karangan says no git account is open here and links nothing", async (s) => {
  s.model.script(
    { tool: "recall", args: { queries: ["normalisasi audio pull request", "audio normalization PR"] } },
    (turn) => (turn.toolResults[0].unavailable?.git?.startsWith("No git account is enabled") ? "Tidak ada akun git yang aktif di channel ini, jadi saya tidak bisa mencari pull request-nya; admin bisa mengaktifkannya di console." : `git: ${JSON.stringify(turn.toolResults[0].unavailable)}`),
  );
  const output = await dryRun(s, "tanpa-link-karangan");
  expect(output.turns[0].replies[0]).toStartWith("Tidak ada akun git");
});

discordScenario("dry run: tempel-teks-panjang keeps the pasted transcript as a Note word for word with keepAsNote", async (s) => {
  s.model.script(
    (turn) => ({ tool: "keepAsNote", args: { messageIds: [turn.messages.filter((m) => m.role === "user").map((m) => String(m.content)).join("\n").match(/message (\d+)\)/)![1]], path: "channel/notes/2026-10-14-evaluasi-event-oktober.md" } }),
    "Disimpan sebagai catatan notes/2026-10-14-evaluasi-event-oktober.md.",
  );
  const output = await dryRun(s, "tempel-teks-panjang");
  const [note] = output.turns[0].state.kept;
  expect(note.path).toBe("notes/2026-10-14-evaluasi-event-oktober.md");
  expect(note.text).toContain("40. Alice menutup rapat dan berterima kasih kepada semua divisi.");
});
