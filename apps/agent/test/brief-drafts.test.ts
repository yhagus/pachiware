import { expect } from "bun:test";
import { discordScenario } from "./support/discordScenario";

discordScenario("the author's yes to round 1 posts one embed per draft in the anatomy, plus drafts.md without git", async (s) => {
  const { startBrief, briefFields, embedsIn, draft } = await import(process.cwd() + "/apps/agent/test/support/briefs.ts");
  const { checkDraft } = await import(process.cwd() + "/packages/skills/src/draftChecker.ts");
  const { thread, brief, record } = await startBrief(s);
  const before = s.discord.botMessages.length;

  s.model.script([{ tool: "recordBriefAnswers", args: { round: 1, acceptRest: true } }, { tool: "writeIssueDraft", args: draft(1) }, { tool: "writeIssueDraft", args: draft(2) }], "Both drafts are up.");
  await s.discord.send("yes", { channel: thread });

  const posted = s.discord.botMessages.slice(before);
  expect(posted.map((m) => m.content).join("\n")).not.toContain("Both drafts are up.");
  const embeds = embedsIn(s, thread.id).map((m: any) => m.embeds[0]);
  expect(embeds.map((e: any) => e.title)).toEqual(["1. Stop the Safari login loop", "2. Stream CSV exports"]);
  for (const e of embeds as any[]) {
    expect(checkDraft({ title: e.title.replace(/^\d+\. /, ""), body: e.description })).toEqual([]);
    expect(e.description).toContain(`[Drafted by Pachiware from a brief by Alice](https://discord.com/channels/guild-1/channel-1/${brief.id}) without repository context.`);
    expect(e.fields.map((f: any) => [f.name, f.value])).toContainEqual(["Repository", "None"]);
  }
  expect(embeds[0].fields).toContainEqual(expect.objectContaining({ name: "Category", value: "bug" }));
  expect(embeds[0].description).toContain("## Current behaviour");
  expect(embeds[1].description).not.toContain("## Current behaviour");
  expect(embeds[1].description).toContain("## Blocked by\n- Draft 1: Stop the Safari login loop");
  expect(embeds[1].description).toContain("- [ ] An empty table exports a header-only file *(added)*");

  const file = posted.at(-1)!;
  expect(file.files.map((f: any) => f.name)).toEqual(["drafts.md"]);
  const markdown = String(file.files[0].attachment);
  expect(markdown).toContain("# 1. Stop the Safari login loop");
  expect(markdown).toContain(embeds[1].description);

  const fields = await briefFields(s, record);
  expect(fields.questions.map((q: any) => [q.n, q.status, q.answer])).toEqual([[1, "answered", "No, Safari 17 and up."], [2, "answered", "Yes, export what the table shows."]]);
  expect(fields.drafts).toMatchObject([
    { n: 1, category: "bug", messageId: embedsIn(s, thread.id)[0]!.id, acceptance: draft(1).acceptance },
    { n: 2, category: "feature", messageId: embedsIn(s, thread.id)[1]!.id, blockedBy: [1] },
  ]);
  expect(fields.draftsFileMessageId).toBe(file.id);
});

discordScenario("a question left unanswered twice is carried once, then appears in the draft as a marked assumption", async (s) => {
  const { startBrief, briefFields, embedsIn, draft } = await import(process.cwd() + "/apps/agent/test/support/briefs.ts");
  const { thread, record } = await startBrief(s);

  s.model.script([{ tool: "recordBriefAnswers", args: { round: 1, answers: [{ q: 2, answer: "Yes, keep the filters." }] } }, { tool: "postBriefRound", args: { questions: [] } }], "ok");
  await s.discord.send("Q2 yes", { channel: thread });
  const round2 = s.discord.botMessages.at(-1)!.content;
  expect(round2).toContain("**Round 2**");
  expect(round2).toMatch(/❓ \*\*Q1\*\* Should Safari 16 be supported\?\n➡️ No, Safari 17 and up\.\n-# Asked again from round 1/);

  s.model.script([{ tool: "recordBriefAnswers", args: { round: 2 } }, { tool: "writeIssueDraft", args: draft(1) }, { tool: "writeIssueDraft", args: draft(2) }], "ok");
  await s.discord.send("go ahead and draft", { channel: thread });
  const [first, second] = embedsIn(s, thread.id).map((m: any) => m.embeds[0].description as string);
  expect(first).toContain("## Open questions\n**Established so far:**\n- Should Safari 16 be supported? ➡️ No, Safari 17 and up. *(assumed)*");
  expect(first).not.toContain("Still need from");
  expect(second).not.toContain("## Open questions");

  const fields = await briefFields(s, record);
  expect(fields.questions.map((q: any) => [q.round, q.n, q.status])).toEqual([[1, 1, "carried"], [1, 2, "answered"], [2, 1, "assumed"]]);
});

discordScenario("draft now puts every open question into the drafts in the needs-info shape with its recommendation", async (s) => {
  const { startBrief, embedsIn, draft } = await import(process.cwd() + "/apps/agent/test/support/briefs.ts");
  const { checkDraft } = await import(process.cwd() + "/packages/skills/src/draftChecker.ts");
  const { thread } = await startBrief(s);

  s.model.script(
    { tool: "writeIssueDraft", args: draft(1) },
    (turn) => { if (!JSON.stringify(turn.toolResults).includes("no answer yet")) throw new Error(JSON.stringify(turn.toolResults)); return [{ tool: "recordBriefAnswers", args: { round: 1, draftNow: true } }, { tool: "writeIssueDraft", args: draft(1) }, { tool: "writeIssueDraft", args: draft(2) }]; },
    "ok",
  );
  await s.discord.send("draft now", { channel: thread });
  const embeds = embedsIn(s, thread.id).map((m: any) => m.embeds[0]);
  expect(embeds).toHaveLength(2);
  expect(embeds[0].description).toContain("## Open questions\n**Still need from @Alice:**\n- Should Safari 16 be supported? ➡️ No, Safari 17 and up.");
  expect(embeds[1].description).toContain("**Still need from @Alice:**\n- Should exports keep the table's filters? ➡️ Yes, export what the table shows.");
  for (const e of embeds as any[]) expect(checkDraft({ title: e.title.replace(/^\d+\. /, ""), body: e.description })).toEqual([]);
});

discordScenario("a draft over the budget is refused before posting and the model splits it", async (s) => {
  const { startBrief, embedsIn, draft } = await import(process.cwd() + "/apps/agent/test/support/briefs.ts");
  const { thread } = await startBrief(s);
  const nine = Array.from({ length: 9 }, (_, i) => `Criterion ${i + 1} holds`);

  s.model.script(
    [{ tool: "recordBriefAnswers", args: { round: 1, acceptRest: true } }, { tool: "writeIssueDraft", args: draft(1, { acceptance: nine }) }],
    (turn) => {
      const said = JSON.stringify(turn.toolResults);
      if (!said.includes("at most 7") || !said.includes("draft 3")) throw new Error(said);
      return [{ tool: "writeIssueDraft", args: draft(1, { acceptance: nine.slice(0, 5) }) }, { tool: "writeIssueDraft", args: draft(1, { n: 3, point: 1, title: "Keep Safari sessions across tabs", acceptance: nine.slice(5), blockedBy: [1] }) }, { tool: "writeIssueDraft", args: draft(2) }];
    },
    "ok",
  );
  await s.discord.send("yes", { channel: thread });
  const embeds = embedsIn(s, thread.id).map((m: any) => m.embeds[0]);
  expect(embeds.map((e: any) => e.title)).toEqual(["1. Stop the Safari login loop", "3. Keep Safari sessions across tabs", "2. Stream CSV exports"]);
  for (const e of embeds as any[]) expect((e.description.match(/^- \[ \] /gm) ?? []).length).toBeLessThanOrEqual(7);
  expect(embeds[1].description).toContain("## Blocked by\n- Draft 1: Stop the Safari login loop");
});

discordScenario("after a restart, a revision edits only the named embed in place and posts a one-line note", async (s) => {
  const { startBrief, briefFields, embedsIn, draft } = await import(process.cwd() + "/apps/agent/test/support/briefs.ts");
  const { thread, record } = await startBrief(s);
  s.model.script([{ tool: "recordBriefAnswers", args: { round: 1, acceptRest: true } }, { tool: "writeIssueDraft", args: draft(1) }, { tool: "writeIssueDraft", args: draft(2) }], "ok");
  await s.discord.send("yes", { channel: thread });
  const [one, two] = embedsIn(s, thread.id);
  const file = s.discord.botMessages.at(-1)!;
  const before = s.discord.botMessages.length;

  await s.restart();
  s.model.script({ tool: "writeIssueDraft", args: { n: 2, acceptance: [...draft(2).acceptance as string[], "A user over 10 exports a minute gets a 429 with Retry-After"], note: "Added a rate limit on exports." } }, "Updated draft 2.");
  await s.discord.send("draft 2: add rate limiting", { channel: thread });

  expect(one!.edits).toEqual([]);
  expect(two!.edits).toHaveLength(1);
  expect(two!.embeds[0].description).toContain("- [ ] A user over 10 exports a minute gets a 429 with Retry-After");
  const added = s.discord.botMessages.slice(before);
  expect(added).toHaveLength(1);
  expect(added[0]!.content).toBe(`[Draft 2](https://discord.com/channels/guild-1/${thread.id}/${two!.id}) updated: Added a rate limit on exports.`);
  expect(added[0]!.content).toContain("Added a rate limit on exports.");
  expect(added[0]!.content.split("\n")).toHaveLength(1);
  expect(String(file.files[0].attachment)).toContain("429 with Retry-After");

  const fields = await briefFields(s, record);
  expect(fields.drafts[1]).toMatchObject({ n: 2, messageId: two!.id, revisions: 1 });
  expect(fields.drafts[1].acceptance).toHaveLength(4);
});
