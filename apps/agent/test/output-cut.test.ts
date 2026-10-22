import { expect } from "bun:test";
import { discordScenario, type Scenario } from "./support/discordScenario";

// A reply or tool call cut off at the model's output limit is continued or refused, never taken as complete (#216).

const cuts = async (s: Scenario) => {
  const { repositories } = await import("@pachiware/db");
  return (await repositories().usage.list({ tenantId: s.tenant.id, type: "guardrail_denied" })).map((e: any) => e.metadata).filter((m: any) => m.reason === "output_cut");
};
const text = (m: { content: unknown }) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content));

discordScenario("a cut answer is continued once and the person sees one joined reply, stored once", async (s) => {
  await s.guildSettings({ language: "en", useThreads: false });
  s.model.script({ cut: "Release 2.4 moves to" }, " 14 October, after the audio fix lands.");
  await s.discord.send(`${s.discord.mention} when is release 2.4?`);

  expect(s.discord.botMessages.at(-1)!.content).toBe("Release 2.4 moves to 14 October, after the audio fix lands.");
  const continuation = s.model.calls[1]!;
  expect(continuation.at(-2)).toMatchObject({ role: "assistant", content: "Release 2.4 moves to" });
  expect(continuation.at(-1)).toMatchObject({ role: "user", content: expect.stringContaining("Continue exactly where you stopped") });
  expect(await cuts(s)).toEqual([expect.objectContaining({ kind: "limit", reason: "output_cut", part: "text" })]);

  s.model.script("Noted.");
  await s.discord.send(`${s.discord.mention} thanks`);
  const assistants = s.model.calls[2]!.filter((m) => m.role === "assistant").map(text);
  expect(assistants).toEqual(["Release 2.4 moves to 14 October, after the audio fix lands."]);
  expect(s.model.calls[2]!.some((m) => text(m).includes("Continue exactly where you stopped"))).toBe(false);
});

discordScenario("a continuation cut off too goes out with a note in the place's language that it was cut", async (s) => {
  await s.guildSettings({ language: "id", useThreads: false });
  s.model.script({ cut: "Rilis 2.4 mundur ke" }, { cut: " 14 Oktober karena" });
  await s.discord.send(`${s.discord.mention} kapan rilis 2.4?`);

  expect(s.discord.botMessages.at(-1)!.content).toBe("Rilis 2.4 mundur ke 14 Oktober karena\n\n-# Jawabannya terpotong karena terlalu panjang. Minta lanjutannya kalau perlu.");
  expect(s.model.calls).toHaveLength(2);
  expect(await cuts(s)).toEqual([
    expect.objectContaining({ kind: "limit", reason: "output_cut", part: "text" }),
    expect.objectContaining({ kind: "limit", reason: "output_cut", part: "text" }),
  ]);
});

discordScenario("a cut tool call never runs and the model is told to make it smaller", async (s) => {
  await s.guildSettings({ language: "en", useThreads: false });
  s.model.script(
    { cut: { tool: "writeFile", args: { path: "channel/notes/plan.md", content: "# Plan\n- ship" } } },
    (turn) => `told: ${turn.toolResults[0].error}`,
  );
  await s.discord.send(`${s.discord.mention} keep the plan as a note`);

  expect(await s.workspace.read("guilds/guild-1/channels/channel-1/notes/plan.md")).toBeNull();
  expect(s.discord.botMessages.at(-1)!.content).toBe("told: This tool call was cut off at the output limit and was not run. Make it smaller, for example by splitting the content over several calls.");
  expect(await cuts(s)).toEqual([expect.objectContaining({ kind: "limit", reason: "output_cut", part: "tool_call", tool: "writeFile" })]);
});
