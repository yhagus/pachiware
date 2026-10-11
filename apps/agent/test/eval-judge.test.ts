import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadFixtures } from "../eval/fixtures";
import { assertJudgeOutside, gradeWithJudge, judgeFromEnv, judgeOverHttp, parseVerdict, RUBRIC_VERSION, type Ask } from "../eval/judge";
import { EVAL_DIR, pinnedRepo } from "../eval/repository";
import { gradeRun } from "../eval/run";

const pin = pinnedRepo();
const fixture = loadFixtures().find((f) => f.name === "thread-replies-debounced")!;
const recorded = JSON.parse(readFileSync(join(EVAL_DIR, "recorded", "thread-replies-debounced.json"), "utf8"));
const verdict = (v: string, why = "Checked against the reference.") => `${why}\n{"reasoning": ${JSON.stringify(why)}, "verdict": "${v}"}`;

/** A judge that answers from a table keyed by a phrase of the prompt, and records every prompt it saw. */
function scriptedJudge(answers: [RegExp, string][]) {
  const prompts: { system: string; user: string }[] = [];
  const ask: Ask = async (system, user) => {
    prompts.push({ system, user });
    return answers.find(([match]) => match.test(user))?.[1] ?? verdict("yes");
  };
  return { ask, prompts };
}

describe("parseVerdict", () => {
  test("reads the closing JSON line, reasoning first", () => {
    expect(parseVerdict(verdict("no", "The draft never says which messages are joined."))).toEqual({ reasoning: "The draft never says which messages are joined.", verdict: "no" });
    expect(parseVerdict("```json\n{\"reasoning\": \"Covered in the summary.\", \"verdict\": \"yes\"}\n```")).toEqual({ reasoning: "Covered in the summary.", verdict: "yes" });
  });

  test("a reply without a valid verdict counts as unknown and keeps the reply", () => {
    expect(parseVerdict("I think so.")).toEqual({ reasoning: "The judge gave no verdict: I think so.", verdict: "unknown" });
    expect(parseVerdict('{"reasoning": "x", "verdict": "maybe"}').verdict).toBe("unknown");
  });
});

describe("the judge stays outside the compared profiles", () => {
  test("refuses when the judge's model is a compared profile's model", () => {
    const judge = { provider: "anthropic", model: "claude-opus-5-5" };
    expect(() => assertJudgeOutside(judge, [{ name: "cheap", model: "gpt-5-mini" }, { name: "claude", model: "claude-opus-5-5" }]))
      .toThrow("The judge model claude-opus-5-5 is also the model of profile claude; pick a judge outside the compared profiles.");
    expect(() => assertJudgeOutside(judge, [{ name: "proxy", model: "anthropic/Claude-Opus-5-5" }])).toThrow("profile proxy");
    expect(() => assertJudgeOutside(judge, [{ name: "cheap", model: "gpt-5-mini" }])).not.toThrow();
  });

  test("bun run eval refuses to start when the judge's model is a compared profile's", () => {
    const run = Bun.spawnSync({
      cmd: ["bun", "test", "./apps/agent/eval/drafts.eval.ts"], cwd: join(import.meta.dir, "../../.."),
      env: { PATH: process.env.PATH, HOME: process.env.HOME, EVAL_LIVE: "1", EVAL_MODEL: "gpt-5-mini", EVAL_API_KEY: "k", EVAL_JUDGE_MODEL: "gpt-5-mini", EVAL_JUDGE_API_KEY: "j" },
    });
    const output = new TextDecoder().decode(run.stderr) + new TextDecoder().decode(run.stdout);
    expect(run.exitCode).not.toBe(0);
    expect(output).toContain("The judge model gpt-5-mini is also the model of profile gpt-5-mini; pick a judge outside the compared profiles.");
    expect(output).not.toContain("trial 1");
  });

  test("reads EVAL_JUDGE_* and names what is missing", () => {
    expect(judgeFromEnv({ EVAL_JUDGE_MODEL: "claude-opus-5-5", EVAL_JUDGE_PROVIDER: "anthropic", EVAL_JUDGE_API_KEY: "k" })).toEqual({ provider: "anthropic", model: "claude-opus-5-5", baseUrl: null, apiKey: "k" });
    expect(() => judgeFromEnv({})).toThrow("Set EVAL_JUDGE_MODEL and EVAL_JUDGE_API_KEY");
    expect(() => judgeFromEnv({ EVAL_JUDGE_MODEL: "m", EVAL_JUDGE_API_KEY: "k", EVAL_JUDGE_PROVIDER: "custom" })).toThrow("EVAL_JUDGE_BASE_URL");
  });
});

describe("judge calls over HTTP", () => {
  test("an OpenAI-compatible judge gets the rubric as the system message and answers from the first choice", async () => {
    const calls: any[] = [];
    const ask = judgeOverHttp({ provider: "custom", model: "judge-x", baseUrl: "https://llm.example.test/v1/", apiKey: "jk" }, async (url, init) => {
      calls.push({ url: String(url), headers: init!.headers, body: JSON.parse(String(init!.body)) });
      return Response.json({ choices: [{ message: { content: verdict("yes") } }] });
    });
    expect(await ask("rubric", "item")).toBe(verdict("yes"));
    expect(calls[0].url).toBe("https://llm.example.test/v1/chat/completions");
    expect(calls[0].headers.Authorization).toBe("Bearer jk");
    expect(calls[0].body).toEqual({ model: "judge-x", messages: [{ role: "system", content: "rubric" }, { role: "user", content: "item" }] });
  });

  test("an Anthropic judge goes through the Messages API with the system prompt apart", async () => {
    const calls: any[] = [];
    const ask = judgeOverHttp({ provider: "anthropic", model: "claude-opus-5-5", baseUrl: null, apiKey: "ak" }, async (url, init) => {
      calls.push({ url: String(url), headers: init!.headers, body: JSON.parse(String(init!.body)) });
      return Response.json({ content: [{ type: "text", text: verdict("no") }] });
    });
    expect(await ask("rubric", "item")).toBe(verdict("no"));
    expect(calls[0].url).toBe("https://api.anthropic.com/v1/messages");
    expect(calls[0].headers["x-api-key"]).toBe("ak");
    expect(calls[0].body).toEqual({ model: "claude-opus-5-5", max_tokens: 2048, system: "rubric", messages: [{ role: "user", content: "item" }] });
  });

  test("a provider error throws with its status", async () => {
    const ask = judgeOverHttp({ provider: "openai", model: "m", baseUrl: null, apiKey: "k" }, async () => new Response("rate limited", { status: 429 }));
    await expect(ask("r", "i")).rejects.toThrow("The judge's provider answered 429: rate limited");
  });
});

describe("grading a run with the judge", () => {
  test("asks one isolated question per must-cover fact, per question, and per draft, with the reference facts in the prompt", async () => {
    const { ask, prompts } = scriptedJudge([]);
    const graded = await gradeWithJudge(gradeRun(recorded, fixture, pin), fixture, ask);
    expect(prompts).toHaveLength(fixture.facts.mustCover.length + recorded.questions.length + recorded.drafts.length);
    for (const p of prompts) {
      expect(p.system).toContain(`Rubric ${RUBRIC_VERSION}`);
      expect(p.user).toContain(fixture.brief);
      expect(p.user).toContain(fixture.answers);
    }
    const factPrompt = prompts.find((p) => p.user.includes(`must cover this fact:\n${fixture.facts.mustCover[0]}`))!;
    expect(factPrompt.user).toContain("1. Answer each message in an existing thread");
    const questionPrompt = prompts.find((p) => p.user.includes(recorded.questions[0].text))!;
    for (const gap of fixture.facts.knownGaps) expect(questionPrompt.user).toContain(gap);
    const draftPrompt = prompts.find((p) => p.user.includes("Is every statement this draft makes about the repository"))!;
    for (const fact of fixture.facts.repoFacts) expect(draftPrompt.user).toContain(fact);

    expect(graded.coverage).toBe(1);
    expect(graded.questionRate).toBe(1);
    expect(graded.passed).toBe(true);
    expect(graded.verdicts).toEqual([{ n: 1, passed: true, reasons: [] }]);
  });

  test("a draft fails with a reason per failure: code checks, coverage under 80%, and an invented repository fact", async () => {
    const { ask } = scriptedJudge([
      [new RegExp(fixture.facts.mustCover[1]!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), verdict("no", "Direct messages are not mentioned.")],
      [/Is every statement this draft makes about the repository/, verdict("no", "It says the window is 5 seconds; the facts say 2500 ms.")],
      [/Does the question probe/, verdict("no", "The answer is already in the brief.")],
    ]);
    const broken = { ...recorded, drafts: [{ ...recorded.drafts[0], labels: ["performance"] }] };
    const graded = await gradeWithJudge(gradeRun(broken, fixture, pin), fixture, ask);
    expect(graded.coverage).toBeCloseTo(2 / 3);
    expect(graded.questionRate).toBe(0);
    expect(graded.passed).toBe(false);
    expect(graded.verdicts).toEqual([{ n: 1, passed: false, reasons: [
      "labels: performance is not a label of yhagus/pachiware.",
      "coverage: 2 of 3 must-cover facts covered, under 80%. Missing: Direct messages and a thread opened on the same turn are already answered per message (Direct messages are not mentioned.)",
      "invented: It says the window is 5 seconds; the facts say 2500 ms.",
    ] }]);
  });

  test("unknown is not coverage, but an unknown repository verdict does not fail a draft", async () => {
    const { ask } = scriptedJudge([[/Is every statement this draft makes about the repository/, verdict("unknown")], [/must cover/, verdict("unknown")]]);
    const graded = await gradeWithJudge(gradeRun(recorded, fixture, pin), fixture, ask);
    expect(graded.coverage).toBe(0);
    expect(graded.verdicts[0]!.reasons.map((r) => r.split(":")[0])).toEqual(["coverage"]);
  });

  test("a judge call that throws is recorded as unknown with the error", async () => {
    const graded = await gradeWithJudge(gradeRun(recorded, fixture, pin), fixture, async () => { throw new Error("socket hang up"); });
    expect(graded.judged.facts[0]).toMatchObject({ verdict: "unknown", reasoning: "The judge call failed: socket hang up" });
  });

  test("a run with no drafts fails as a whole", async () => {
    const graded = await gradeWithJudge(gradeRun({ ...recorded, drafts: [] }, fixture, pin), fixture, scriptedJudge([]).ask);
    expect(graded.passed).toBe(false);
    expect(graded.verdicts).toEqual([]);
    expect(graded.coverage).toBe(0);
  });
});
