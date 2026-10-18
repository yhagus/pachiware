import { expect } from "bun:test";
import { discordScenario, type Scenario } from "./support/discordScenario";

const text = (m: { content: any }) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content));
// 16,000 tokens at four characters each.
const BUDGET_CHARS = 64_000;
const paste = (marker: string) => `${marker}\n${"A long pasted report line, kept whole by the person. ".repeat(760)}`.slice(0, 40_000);
const stored = (call: { role: string; content: any }[]) => call.slice(1, -2);

async function talk(s: Scenario, messages: string[]) {
  s.discord.unlimited(s.discord.alice);
  const first = await s.discord.send(`${s.discord.mention} ${messages[0]}`);
  for (const message of messages.slice(1)) await s.discord.send(message, { channel: first.thread });
}

discordScenario("three 40,000-character pastes keep the request under the history budget, with the newest turns still in it", async (s) => {
  s.model.script("got the first", "got the second", "got the third", "sure");
  await talk(s, [paste("PASTE-ONE"), paste("PASTE-TWO"), paste("PASTE-THREE"), "which of these is newest?"]);

  const request = s.model.calls.at(-1)!;
  expect(JSON.stringify(request).length).toBeLessThan(BUDGET_CHARS);
  const all = request.map(text).join("\n");
  expect(all).toContain("PASTE-THREE");
  expect(all).toContain("got the third");
  expect(all).toContain("which of these is newest?");
  expect(all).not.toContain("PASTE-ONE");
});

discordScenario("a single stored message bigger than the whole budget is shown clipped with a note, not dropped", async (s) => {
  const huge = `HUGE-START\n${"x".repeat(80_000)}\nHUGE-END`;
  s.model.script("noted", "sure");
  await talk(s, [huge, "and now?"]);

  const history = stored(s.model.calls.at(-1)!);
  const clipped = history.find((m) => text(m).includes("HUGE-START"));
  expect(clipped).toBeDefined();
  expect(text(clipped!)).not.toContain("HUGE-END");
  expect(text(clipped!)).toMatch(/full text is in the conversation's earlier message/);
  expect(history.map(text).join("\n").length).toBeLessThan(BUDGET_CHARS);
  expect(history.map(text)).toContain("noted");
});

discordScenario("over the budget, two consecutive turns within one step send the same history prefix", async (s) => {
  // Seven pastes of 12,000 characters overflow the budget, so the window steps forward; the turns after it add rows without moving it.
  const pastes = Array.from({ length: 7 }, (_, i) => `PASTE-${i + 1}\n${"Pasted notes for the record. ".repeat(420)}`.slice(0, 12_000));
  s.model.script(...pastes.map((_, i) => `reply ${i + 1}`), "reply 8", "reply 9");
  await talk(s, [...pastes, "short one", "short two"]);

  const [before, after] = s.model.calls.slice(-2).map(stored);
  expect(before!.map(text).join("\n").length).toBeLessThan(BUDGET_CHARS);
  expect(before!.map(text).join("\n")).not.toContain("PASTE-1\n");
  expect(after!.slice(0, before!.length)).toEqual(before!);
  expect(after!.length).toBe(before!.length + 2);
});

discordScenario("when the budget cuts the window, no request starts its history with a tool result whose call was cut away", async (s) => {
  await s.guildSettings({ useThreads: false });
  s.discord.unlimited(s.discord.alice);
  for (let i = 1; i <= 4; i++) await s.workspace.write(`guilds/guild-1/channels/channel-1/notes/part-${i}.md`, `# Part ${i}\n${"A section. ".repeat(50)}`);
  const reads = Array.from({ length: 4 }, (_, i) => ({ tool: "readFile", args: { path: `channel/notes/part-${i + 1}.md` } }));
  const big = (n: number) => `BIG-${n}\n${"Pasted notes for the record. ".repeat(210)}`.slice(0, 6_000);
  // Three padded turns first put the read turn's tool results where the first step of the window cuts; the tenth paste overflows the budget.
  s.model.script("hi 1", "hi 2", "hi 3", reads, "read them", ...Array.from({ length: 11 }, (_, i) => `reply ${i + 1}`));
  for (let i = 1; i <= 3; i++) await s.discord.send(`${s.discord.mention} hello ${i} ${"padding ".repeat(250)}`);
  await s.discord.send(`${s.discord.mention} read the four parts`);
  for (let i = 1; i <= 11; i++) await s.discord.send(`${s.discord.mention} ${big(i)}`);

  const cut = s.model.calls.at(-1)!.map(text).join("\n");
  expect(cut).not.toContain("hello 1");
  expect(cut).toContain("BIG-11");
  for (const call of s.model.calls) {
    const history = call.slice(1).filter((m) => !/^\[Conversation summary\b/.test(text(m)));
    expect(history[0]!.role).not.toBe("tool");
  }
  expect(stored(s.model.calls.at(-1)!).map(text).join("\n").length).toBeLessThan(BUDGET_CHARS);
  expect(text(stored(s.model.calls.at(-1)!).at(-1)!)).toBe("reply 10");
});
