import { expect } from "bun:test";
import { discordScenario, type Scenario } from "./support/discordScenario";

const replies = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => `reply ${from + i}`);
const text = (m: { content: any }) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content));
const summaryOf = (call: { role: string; content: any }[]) => call.filter((m) => /^\[Conversation summary\b/.test(text(m)));

/** One mention opens the thread; every later turn is posted there. Two stored messages per turn. */
async function talk(s: Scenario, turns: number, opener = `${s.discord.mention} turn 1`) {
  s.discord.unlimited(s.discord.alice);
  const first = await s.discord.send(opener);
  for (let i = 2; i <= turns; i++) await s.discord.send(`turn ${i}`, { channel: first.thread });
  return first;
}

discordScenario("after 40 stored messages the next model call carries the summary, absent before and identical until the window steps again", async (s) => {
  s.model.script(
    ...replies(1, 20),
    (turn) => {
      const request = turn.messages.map(text).join("\n");
      expect(turn.messages[0]!.role).toBe("system");
      expect(request).toContain("turn 5");
      expect(request).toContain("reply 5");
      expect(request).not.toContain("turn 6");
      return "Agreed: the export goes out Friday. Open: who reviews it.";
    },
    ...replies(21, 25),
    (turn) => {
      const request = turn.messages.map(text).join("\n");
      expect(request).toContain("Agreed: the export goes out Friday. Open: who reviews it.");
      expect(request).toContain("turn 10");
      expect(request).not.toContain("turn 5");
      expect(request).not.toContain("turn 11");
      return "Agreed: the export goes out Friday; Bob reviews it.";
    },
    "reply 26",
  );
  const first = await talk(s, 20);
  expect(s.model.calls).toHaveLength(21);
  expect(s.model.tools[20]).toEqual([]);
  for (let i = 0; i < 20; i++) expect(summaryOf(s.model.calls[i]!)).toEqual([]);

  const { conversations } = await import(process.cwd() + "/packages/db/src/index.ts") as any;
  const stored = (await s.db.select().from(conversations)).find((c: any) => c.channelId === first.thread!.id);
  expect(stored.metadata.summary).toEqual({ text: "Agreed: the export goes out Friday. Open: who reviews it.", coversMessages: 10, updatedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) });

  for (let i = 21; i <= 25; i++) await s.discord.send(`turn ${i}`, { channel: first.thread });
  const withSummary = s.model.calls.slice(21, 26);
  expect(withSummary).toHaveLength(5);
  for (const call of withSummary) {
    expect(call[0]!.role).toBe("system");
    expect(text(call[1]!)).toContain("Agreed: the export goes out Friday. Open: who reviews it.");
    expect(text(call[1]!)).toBe(text(withSummary[0]![1]!));
    expect(summaryOf(call)).toHaveLength(1);
    expect(text(call[2]!)).toBe(text(withSummary[0]![2]!));
  }
  expect(s.model.calls).toHaveLength(27);

  await s.discord.send("turn 26", { channel: first.thread });
  expect(text(s.model.calls[27]![1]!)).toContain("Agreed: the export goes out Friday; Bob reviews it.");
  expect(text(s.model.calls[27]![1]!)).not.toContain("Open: who reviews it.");
});

discordScenario("a failed summary call keeps the previous summary until the window steps again", async (s) => {
  s.model.script(...replies(1, 20), "Agreed: the export goes out Friday.", ...replies(21, 25), { error: "Provider request failed" }, ...replies(26, 30), "Agreed: Bob reviews the export.", "reply 31");
  const first = await talk(s, 25);
  expect(s.model.calls).toHaveLength(27);

  for (let i = 26; i <= 30; i++) await s.discord.send(`turn ${i}`, { channel: first.thread });
  for (const call of s.model.calls.slice(27, 32)) expect(text(call[1]!)).toContain("Agreed: the export goes out Friday.");
  expect(s.model.calls).toHaveLength(33);
  const request = s.model.calls[32]!.map(text).join("\n");
  expect(request).toContain("turn 10");
  expect(request).toContain("turn 15");

  await s.discord.send("turn 31", { channel: first.thread });
  expect(text(s.model.calls[33]![1]!)).toContain("Agreed: Bob reviews the export.");
  expect(s.discord.botMessages.map((m) => m.content)).not.toContain("Provider request failed");
});

discordScenario("writing the summary keeps a metadata change made while the summary call was in flight", async (s) => {
  const { conversations, eq } = await import(process.cwd() + "/packages/db/src/index.ts") as any;
  const cancel = (n: number) => ({ tool: "updateTaskStatus", args: { taskId: String(n).repeat(8), status: "cancelled" } });
  s.model.script(
    ...replies(1, 19),
    [1, 2, 3, 4].map(cancel), "These four would be cancelled. Go ahead?",
    // The next turn clears the remembered bulk while this summary is still being written.
    async () => {
      const [held] = (await s.db.select().from(conversations)).filter((c: any) => c.metadata?.bulkApproval);
      expect(held).toBeDefined();
      const { bulkApproval: _cleared, ...rest } = held.metadata;
      await s.db.update(conversations).set({ metadata: rest }).where(eq(conversations.id, held.id));
      return "Agreed: four tasks wait for a yes.";
    },
  );
  const first = await talk(s, 20);
  expect(s.model.calls).toHaveLength(22);

  const stored = (await s.db.select().from(conversations)).find((c: any) => c.channelId === first.thread!.id);
  expect(stored.metadata.summary.text).toBe("Agreed: four tasks wait for a yes.");
  expect(stored.metadata.bulkApproval).toBeUndefined();
});

discordScenario("a thread bound to a playbook never requests a summary", async (s) => {
  s.model.script(...replies(1, 21));
  const brief = await talk(s, 21, `${s.discord.mention} issue: export CSV is slow`);
  expect(brief.thread).toBeDefined();
  expect(s.model.calls).toHaveLength(21);
  expect(s.model.calls[20]![0]!.content).toContain("### Playbook: issue-draft");
  for (const call of s.model.calls) expect(summaryOf(call)).toEqual([]);
});
