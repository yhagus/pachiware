import { expect } from "bun:test";
import { discordScenario } from "./support/discordScenario";

// The turn's own lines come just before the context block that closes the request.
const turnOf = (call: any[]) => call.at(-2).content as string, contextOf = (call: any[]) => call.at(-1).content as string;
const report = (turn: any) => (turn.toolResults[0].error ? `refused: ${turn.toolResults[0].error}` : "Pinned.");

discordScenario("Alice and Bob posting together each get their own turn, run as themselves", async (s) => {
  await s.guildSettings({ useThreads: false });
  s.discord.grant(s.discord.bob, ["ManageMessages"]);
  const [decision] = s.discord.history([{ content: "Decision: ship on Friday", author: s.discord.bob }]);
  s.model.script({ tool: "pinMessage", args: { messageId: decision!.id } }, report, "The plan is to ship on Friday.");
  await s.discord.burst([
    { content: `${s.discord.mention} pin that decision`, author: s.discord.alice },
    { content: `${s.discord.mention} what is the plan?`, author: s.discord.bob },
  ]);

  // Two answers, Alice's burst first since it closed first.
  expect(s.discord.botMessages.map((m) => m.content)).toEqual([expect.stringMatching(/^refused: .*ManageMessages/), "The plan is to ship on Friday."]);
  expect(decision!.pinned).toBe(false);
  const [alice, , bob] = s.model.calls;
  expect(turnOf(alice!)).toBe("Alice: pin that decision");
  expect(contextOf(alice!)).toContain("User: Alice (ID: user-alice)");
  expect(turnOf(bob!)).toBe("Bob: what is the plan?");
  expect(contextOf(bob!)).toContain("User: Bob (ID: user-bob)");
  // Alice's turn and its answer are already in the history before Bob's turn: the two never interleave.
  const history = bob!.map((m: any) => (typeof m.content === "string" ? m.content : ""));
  const asked = history.indexOf("Alice: pin that decision"), answered = history.findIndex((c) => /^refused: /.test(c)), next = history.lastIndexOf("Bob: what is the plan?");
  expect(asked).toBeGreaterThan(-1);
  expect(answered).toBeGreaterThan(asked);
  expect(next).toBeGreaterThan(answered);
});

discordScenario("a write Alice asks for in a mixed burst is confirmed by Alice only", async (s) => {
  await s.guildSettings({ useThreads: false });
  await s.git({ repos: ["acme/*"] });
  s.http.on("POST api.github.com/repos/acme/api/issues/3/comments", () => ({ html_url: "https://github.com/acme/api/issues/3#c1" }));
  s.model.script({ tool: "repoComment", args: { repo: "acme/api", number: 3, kind: "issue", body: "Fixed in main" } }, "Queued the comment for your confirmation.", "Morning, Bob.");
  await s.discord.burst([
    { content: `${s.discord.mention} comment "Fixed in main" on acme/api#3`, author: s.discord.alice },
    { content: `${s.discord.mention} good morning`, author: s.discord.bob },
  ]);
  const confirmation = s.discord.botMessages.find((m) => m.components?.length)!;

  const stranger = await s.discord.click(confirmation, "Confirm", { user: s.discord.bob });
  expect(stranger.responses).toMatchObject([{ kind: "reply", payload: { content: "Only the person who asked for this can confirm or cancel it.", ephemeral: true } }]);
  expect(s.http.requests.filter((r) => r.method === "POST")).toEqual([]);

  await s.discord.click(confirmation, "Confirm");
  expect(s.http.requests.filter((r) => r.method === "POST").map((r) => r.body)).toEqual([{ body: "Fixed in main" }]);
});
