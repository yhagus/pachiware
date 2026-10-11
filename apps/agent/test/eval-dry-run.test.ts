import { expect } from "bun:test";
import { discordScenario } from "./support/discordScenario";

discordScenario("dry run: a scripted model takes a brief through the playbook against the offline repository, and the drafts pass the code checks", async (s) => {
  const { runFixture, gradeRun } = await import(process.cwd() + "/apps/agent/eval/run.ts");
  const { loadFixtures } = await import(process.cwd() + "/apps/agent/eval/fixtures.ts");
  const { pinnedRepo } = await import(process.cwd() + "/apps/agent/eval/repository.ts");
  const { writeReport } = await import(process.cwd() + "/apps/agent/eval/report.ts");
  const { mkdtempSync, readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const pin = pinnedRepo(), fixture = loadFixtures().find((f: any) => f.name === "thread-replies-debounced")!;
  const read = (args: Record<string, unknown>) => ({ tool: "briefRead", args: { repo: pin.repo, ...args } });
  s.model.script(
    { tool: "briefRepositories" },
    read({ step: "repository" }),
    [read({ step: "duplicates", point: 1, query: "thread debounced" }), read({ step: "issue", point: 1, number: 29 }), read({ step: "code", point: 1, query: "BURST_MS" }), read({ step: "files", point: 1, paths: ["apps/agent/src/discord/client.ts"] })],
    (turn) => {
      expect(turn.toolResults.at(-1).files[0].content).toContain("const BURST_MS = 2500;");
      return { tool: "postBriefRound", args: {
        points: ["In an existing thread, quick messages are merged into one reply"],
        drafts: [{ point: 1, title: "Answer each message in an existing thread", summary: "Messages in a thread the bot already answers get one reply each." }],
        questions: [{ point: 1, question: "This looks like #29 *Thread messages are debounced, contrary to Phase 15.2*. Skip it, or create it anyway?", recommendation: "Create it anyway and link #29.", options: ["Skip it", "Create anyway"] }],
      } };
    },
    "ok",
    [{ tool: "recordBriefAnswers", args: { round: 1, answers: [{ q: 1, answer: "Create it anyway and mention #29." }] } }, { tool: "writeIssueDraft", args: {
      n: 1, category: "bug", labels: ["bug"],
      summary: "Messages in a thread the bot already answers are joined into one turn by the burst window. Each one should get its own reply, as #29 also reports.",
      current: "Quick messages in an existing thread wait out the burst window and are answered once, as `Name: text` lines.",
      desired: "Every message in an existing thread gets its own reply. Channel messages outside threads are still joined within the burst window.",
      acceptance: ["Two quick messages in an existing thread get two replies", "Two quick messages in a channel still get one reply", "Direct messages keep one reply per message *(added)*"],
      outOfScope: ["Changing the burst window length"],
    } }],
    "ok",
  );

  const output = await runFixture(s, fixture, pin);
  expect(output.transcript.filter((t: any) => t.from === "author").map((t: any) => t.text)).toEqual([fixture.answers]);
  expect(output.transcript[0]).toMatchObject({ from: "bot" });
  expect(output.drafts).toHaveLength(1);
  expect(output.drafts[0]).toMatchObject({ n: 1, title: "Answer each message in an existing thread", repo: pin.repo, labels: ["bug"] });
  expect(output.drafts[0].body).toContain(`**Context used** (yhagus/pachiware at \`74a06a0\`):\n- [README.md](https://github.com/yhagus/pachiware/blob/${pin.commit}/README.md)`);
  expect(s.http.requests.every((r) => r.url.startsWith("https://api.github.com/"))).toBe(true);

  const result = gradeRun(output, fixture, pin);
  expect(result.failures).toEqual([]);
  expect(result.passed).toBe(true);

  const dir = mkdtempSync(join(tmpdir(), "eval-report-"));
  writeReport(dir, { profile: { provider: "scripted", model: "dry run" }, repo: pin.repo, commit: pin.commit, startedAt: "2026-10-11T00:00:00.000Z" }, [result]);
  expect(JSON.parse(readFileSync(join(dir, "report.json"), "utf8")).results[0].fixture).toBe("thread-replies-debounced");
  expect(readFileSync(join(dir, "report.md"), "utf8")).toContain("| thread-replies-debounced | 1 | pass |");
});

discordScenario("dry run: when the answers bring no drafts, the harness says draft now, and open questions land in the drafts", async (s) => {
  const { runFixture, gradeRun } = await import(process.cwd() + "/apps/agent/eval/run.ts");
  const { loadFixtures } = await import(process.cwd() + "/apps/agent/eval/fixtures.ts");
  const { pinnedRepo } = await import(process.cwd() + "/apps/agent/eval/repository.ts");
  const pin = pinnedRepo(), fixture = loadFixtures().find((f: any) => f.name === "reply-language-mixed")!;
  const draft = (n: number, extra: Record<string, unknown>) => ({ tool: "writeIssueDraft", args: { n, category: "feature", outOfScope: ["Menerjemahkan pesan lama"], ...extra } });
  s.model.script(
    { tool: "briefRepositories" },
    { tool: "briefRead", args: { repo: pin.repo, step: "repository" } },
    { tool: "postBriefRound", args: {
      points: ["Bot menjawab dalam bahasa Inggris untuk pertanyaan berbahasa Indonesia", "Jawaban ditutup dengan \"semoga membantu\""],
      drafts: [{ point: 1, title: "Bot menjawab dalam bahasa pesan yang dijawab", summary: "Bahasa jawaban mengikuti bahasa pesan." }, { point: 2, title: "Buang kalimat pembuka dan penutup basa-basi", summary: "Kode membuang filler di awal dan akhir jawaban." }],
      questions: [{ point: 1, question: "Kalau pesan mencampur dua bahasa, bot memakai bahasa yang mana?", recommendation: "Bahasa yang paling banyak dipakai di pesan itu." }, { point: 2, question: "Apakah instruksi server boleh mematikan aturan ini?", recommendation: "Tidak, instruksi server hanya boleh mengubah gaya." }],
    } },
    "ok",
    { tool: "recordBriefAnswers", args: { round: 1, answers: [{ q: 1, answer: "Pakai bahasa yang paling dominan." }] } },
    "Terima kasih, saya catat.",
    [{ tool: "recordBriefAnswers", args: { round: 1, draftNow: true } },
      draft(1, { summary: "Bot kadang menjawab dalam bahasa Inggris walaupun pertanyaan ditulis dalam bahasa Indonesia.", desired: "Bot selalu menjawab dalam bahasa pesan yang dijawab. Kalau pesan mencampur dua bahasa, bot memakai bahasa yang paling banyak dipakai.", acceptance: ["Pertanyaan dalam bahasa Indonesia dijawab dalam bahasa Indonesia", "Pesan campuran dijawab dalam bahasa yang dominan"], labels: ["enhancement"] }),
      draft(2, { summary: "Jawaban bot sering ditutup dengan kalimat basa-basi seperti salam penutup yang tidak perlu.", desired: "Kode membuang kalimat pembuka dan penutup basa-basi, dalam bahasa Indonesia dan Inggris, sebelum jawaban dikirim.", acceptance: ["Kalimat penutup basa-basi tidak pernah sampai ke Discord", "Isi jawaban yang lain tetap utuh"] })],
    "ok",
  );

  const output = await runFixture(s, fixture, pin);
  expect(output.transcript.filter((t: any) => t.from === "author").map((t: any) => t.text)).toEqual([fixture.answers, "draft now"]);
  expect(output.drafts.map((d: any) => d.n)).toEqual([1, 2]);
  expect(output.drafts[1].body).toContain("**Still need from @Alice:**\n- Apakah instruksi server boleh mematikan aturan ini? ➡️ Tidak, instruksi server hanya boleh mengubah gaya.");
  expect(gradeRun(output, fixture, pin).failures).toEqual([]);
});
