import { expect } from "bun:test";
import { discordScenario } from "./support/discordScenario";

discordScenario("dry run: a scripted model takes a brief through the playbook against the offline repository, and the drafts pass the code checks", async (s) => {
  const { runFixture, gradeRun } = await import(process.cwd() + "/apps/agent/eval/run.ts");
  const { loadFixtures } = await import(process.cwd() + "/apps/agent/eval/fixtures.ts");
  const { pinnedRepo } = await import(process.cwd() + "/apps/agent/eval/repository.ts");
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
  expect(output.questions).toEqual([{ source: "round 1", point: "In an existing thread, quick messages are merged into one reply", text: "This looks like #29 *Thread messages are debounced, contrary to Phase 15.2*. Skip it, or create it anyway?" }]);
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

discordScenario("dry run: an ambiguous-repository brief sees both repositories, a judge over HTTP grades the trial, and the report compares two profiles", async (s) => {
  const { runTrial } = await import(process.cwd() + "/apps/agent/eval/run.ts");
  const { loadFixtures } = await import(process.cwd() + "/apps/agent/eval/fixtures.ts");
  const { pinnedRepo } = await import(process.cwd() + "/apps/agent/eval/repository.ts");
  const { judgeOverHttp, RUBRIC_VERSION } = await import(process.cwd() + "/apps/agent/eval/judge.ts");
  const { writeReport } = await import(process.cwd() + "/apps/agent/eval/report.ts");
  const { mkdtempSync, readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const pin = pinnedRepo(), fixture = loadFixtures().find((f: any) => f.name === "playbook-editor-ambiguous-repo")!;
  const read = (repo: string) => ({ tool: "briefRead", args: { repo, step: "repository" } });
  s.model.script(
    { tool: "briefRepositories" },
    (turn) => {
      expect(turn.toolResults[0].repositories.map((r: any) => r.repo)).toEqual(["yhagus/pachiware", "yhagus/pachiware-docs"]);
      return [read("yhagus/pachiware"), read("yhagus/pachiware-docs")];
    },
    (turn) => {
      expect(turn.toolResults.at(-1).readme).toContain("User guides for Pachiware");
      return { tool: "postBriefRound", args: {
        points: ["Tenants see the built-in playbooks and change their own copy"],
        drafts: [{ point: 1, title: "Edit playbook overrides in the Workspace editor", summary: "Built-ins show read-only; a tenant copy overrides them.", repo: "yhagus/pachiware" }],
        questions: [{ point: 1, question: "Is this the admin portal's Workspace editor in yhagus/pachiware, or a guide in yhagus/pachiware-docs?", recommendation: "The admin portal in yhagus/pachiware.", options: ["yhagus/pachiware", "yhagus/pachiware-docs"] }],
      } };
    },
    "ok",
    [{ tool: "recordBriefAnswers", args: { round: 1, answers: [{ q: 1, answer: "The admin portal in yhagus/pachiware." }] } }, { tool: "writeIssueDraft", args: {
      n: 1, category: "feature", labels: ["enhancement"],
      summary: "Tenants cannot see or change the playbooks the bot follows.",
      desired: "The Workspace editor lists built-in playbooks read-only. Copying one creates the tenant's override, and deleting the override brings the built-in back.",
      acceptance: ["Built-in playbooks are listed and marked read-only", "Copying a built-in creates the tenant's override", "Deleting the override makes the built-in effective again", "The admin API refuses writes to built-in playbooks"],
      outOfScope: ["Guides in yhagus/pachiware-docs"],
    } }],
    "ok",
  );
  const judged: any[] = [];
  s.http.on("POST judge.example.test/v1/chat/completions", (req) => {
    judged.push(req.body);
    return { choices: [{ message: { content: 'Covered by the acceptance criteria.\n{"reasoning": "Covered by the acceptance criteria.", "verdict": "yes"}' } }] };
  });
  const ask = judgeOverHttp({ provider: "custom", model: "judge-model", baseUrl: "https://judge.example.test/v1", apiKey: "jk" });

  const trial = await runTrial(s, fixture, pin, ask);
  expect(trial.result.drafts).toMatchObject([{ n: 1, repo: "yhagus/pachiware", labels: ["enhancement"] }]);
  expect(trial.result.questions).toEqual([{ source: "round 1", point: "Tenants see the built-in playbooks and change their own copy", text: "Is this the admin portal's Workspace editor in yhagus/pachiware, or a guide in yhagus/pachiware-docs?" }]);
  expect(judged).toHaveLength(fixture.facts.mustCover.length + 1 + 1);
  expect(judged.every((b) => b.model === "judge-model")).toBe(true);
  expect(trial.result.failures).toEqual([]);
  expect(trial.result).toMatchObject({ coverage: 1, questionRate: 1, passed: true, verdicts: [{ n: 1, passed: true, reasons: [] }] });
  expect(trial.usage).toMatchObject({ calls: 0, prompt: 0 });

  const weaker = { ...trial.result, coverage: 0.5, passed: false, verdicts: [{ n: 1, passed: false, reasons: ["coverage: 2 of 4 must-cover facts covered, under 80%."] }] };
  const trials = [1, 2, 3].flatMap((n) => [{ profile: "a", trial: n, ...trial }, { profile: "b", trial: n, result: weaker, usage: trial.usage }]);
  const dir = mkdtempSync(join(tmpdir(), "eval-report-"));
  writeReport(dir, { judge: { provider: "custom", model: "judge-model" }, rubricVersion: RUBRIC_VERSION, trials: 3, repo: pin.repo, commit: pin.commit, startedAt: "2026-10-11T00:00:00.000Z", profiles: [{ name: "a", provider: "openai", model: "m-a" }, { name: "b", provider: "openai", model: "m-b" }] }, trials);
  const md = readFileSync(join(dir, "report.md"), "utf8");
  expect(md).toContain(`Judge: custom / judge-model. Rubric ${RUBRIC_VERSION}. 3 trials per brief.`);
  expect(md).toContain("| b vs a | 1 | −1.00 |  |");
  expect(md).toContain("- Trial 1, draft 1: fail. coverage: 2 of 4 must-cover facts covered, under 80%.");
});

discordScenario("dry run: a screenshot brief posts its committed image, and an image-capable profile sees it on the first turn", async (s) => {
  const { runFixture, gradeRun } = await import(process.cwd() + "/apps/agent/eval/run.ts");
  const { loadFixtures } = await import(process.cwd() + "/apps/agent/eval/fixtures.ts");
  const { pinnedRepo } = await import(process.cwd() + "/apps/agent/eval/repository.ts");
  const { useProfile } = await import(process.cwd() + "/apps/agent/test/support/images.ts");
  const pin = pinnedRepo(), fixture = loadFixtures().find((f: any) => f.name === "usage-latency-screenshot")!;
  await useProfile(s, { provider: "openai", model: "vision", acceptsImages: true }, { scripted: true });
  const seen = "Terminal output of GET /api/admin/usage: events, prompt and completion tokens per provider and model, no latency.";
  s.model.script(
    (turn) => {
      const parts = turn.messages.filter((m) => Array.isArray(m.content)).flatMap((m: any) => m.content);
      expect(parts.filter((p: any) => p.type === "image")).toHaveLength(1);
      return { tool: "briefRepositories" };
    },
    { tool: "briefRead", args: { repo: pin.repo, step: "repository" } },
    [{ tool: "postBriefRound", args: { points: ["Show how long each model takes to answer"], drafts: [{ point: 1, title: "Record model latency in usage events", summary: "Each model call records its latency, and the usage report averages it per model." }], questions: [] } },
      { tool: "describeBriefImages", args: { images: [{ name: "usage.png", point: 1, description: seen }] } }],
    "ok",
    (turn) => {
      expect(turn.messages.some((m) => Array.isArray(m.content))).toBe(false);
      return [{ tool: "recordBriefAnswers", args: { round: 1, draftNow: true } }, { tool: "writeIssueDraft", args: {
        n: 1, category: "feature", labels: ["enhancement"],
        summary: "The admin usage report shows tokens per model but not how long each model takes to answer.",
        desired: "Every model call records its latency, and the usage report shows the average latency per provider and model next to the token counts.",
        acceptance: ["A model call's usage event records its latency", "The usage report shows the average latency per provider and model"],
        outOfScope: ["Showing latency in the Web GUI"],
      } }];
    },
    "ok",
  );
  const output = await runFixture(s, fixture, pin);
  expect(output.drafts[0].body).toContain(`Screenshot [usage.png](`);
  expect(output.drafts[0].body).toContain(seen);
  expect(gradeRun(output, fixture, pin).failures).toEqual([]);
});
