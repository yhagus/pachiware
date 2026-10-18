import { expect } from "bun:test";
import { discordScenario } from "./support/discordScenario";

const set = (s: any, text: string, at: string, options: { author?: any; channel?: any } = {}) => {
  s.model.script({ tool: "createReminder", args: { text, at } }, (turn: any) => turn.toolResults[0].id ?? `error: ${turn.toolResults[0].error}`);
  return s.discord.send(`${s.discord.mention} remind me at ${at}: ${text}`, options).then(() => s.discord.botMessages.at(-1)!.content as string);
};

discordScenario("listReminders shows the asker their own active Reminders, and everyone's to someone with Manage Messages", async (s) => {
  s.clock.set("2026-03-06T09:00:00+07:00");
  const invoice = await set(s, "send the invoice", "2026-03-06T15:00");
  const standup = await set(s, "standup", "2026-03-07T09:30", { channel: "channel-2" });
  const bobs = await set(s, "water the plants", "2026-03-06T18:00", { author: s.discord.bob });
  const list = (author?: any) => {
    s.model.script({ tool: "listReminders", args: {} }, (turn: any) => JSON.stringify(turn.toolResults[0].reminders.map((r: any) => [r.id, r.text, r.channelId, r.nextAt, r.recurrence, r.owner])));
    return s.discord.send(`${s.discord.mention} what reminders do I have?`, { author }).then(() => JSON.parse(s.discord.botMessages.at(-1)!.content));
  };
  expect(await list()).toEqual([
    [invoice, "send the invoice", expect.any(String), "2026-03-06T15:00:00+07:00", "once", { id: s.discord.alice.id, name: "Alice" }],
    [standup, "standup", expect.any(String), "2026-03-07T09:30:00+07:00", "once", { id: s.discord.alice.id, name: "Alice" }],
  ]);
  expect(await list(s.discord.bob)).toEqual([[bobs, "water the plants", expect.any(String), "2026-03-06T18:00:00+07:00", "once", { id: s.discord.bob.id, name: "Bob" }]]);
  s.discord.grant(s.discord.bob, ["ManageMessages"]);
  expect((await list(s.discord.bob)).map((r: any) => r[0])).toEqual([invoice, bobs, standup]);
});

discordScenario("cancelReminder is refused for a stranger, allowed for the owner and for a granted moderator, and a cancelled Reminder never posts", async (s) => {
  s.clock.set("2026-03-06T09:00:00+07:00");
  const first = await set(s, "send the invoice", "2026-03-06T15:00");
  const cancel = (id: string, author?: any) => {
    s.model.script({ tool: "cancelReminder", args: { id } }, (turn: any) => turn.toolResults[0].error ?? `cancelled ${turn.toolResults[0].id}`);
    return s.discord.send(`${s.discord.mention} cancel reminder ${id}`, { author }).then(() => s.discord.botMessages.at(-1)!.content);
  };
  expect(await cancel(first, s.discord.bob)).toBe("Pengingat itu milik orang lain; hanya pemiliknya atau orang dengan Manage Messages yang bisa membatalkannya.");
  expect(await cancel(first)).toBe(`cancelled ${first}`);
  expect(await cancel(first)).toBe("Pengingat aktif dengan id itu tidak ketemu.");

  const second = await set(s, "standup", "2026-03-06T15:00");
  s.discord.grant(s.discord.bob, ["ManageMessages"]);
  expect(await cancel(second, s.discord.bob)).toBe(`cancelled ${second}`);

  const before = s.discord.botMessages.length;
  s.clock.set("2026-03-06T15:00:00+07:00");
  await s.scheduler.tick();
  expect(s.discord.botMessages.length).toBe(before);
  const { repositories } = await import("../../../packages/db/src/index.ts");
  expect((await repositories().schedules.list()).map((r: any) => r.status)).toEqual(["cancelled", "cancelled"]);
});

discordScenario("the 51st active Reminder of a person and the 501st of a tenant are refused in the configured language", async (s) => {
  s.clock.set("2026-03-06T09:00:00+07:00");
  const { schedules } = (await import("../../../packages/db/src/index.ts")).repositories();
  const rows = (n: number, ownerId: string, status: "active" | "cancelled" = "active") => Array.from({ length: n }, (_, i) => ({
    tenantId: s.tenant.id, botId: s.bot.id, kind: "reminder" as const, guildId: s.discord.guildId, channelId: "channel-1", ownerId, ownerName: ownerId,
    text: `r${i}`, timezone: "Asia/Jakarta", nextAt: new Date("2026-03-07T02:00:00Z"), status,
  }));
  const insert = async (list: ReturnType<typeof rows>) => { for (const row of list) await schedules.create(row); };
  await insert(rows(49, s.discord.alice.id));
  await insert(rows(5, s.discord.alice.id, "cancelled"));
  const fiftieth = await set(s, "the fiftieth", "2026-03-06T15:00");
  expect(fiftieth).not.toMatch(/^error/);
  expect(await set(s, "one too many", "2026-03-06T16:00")).toBe("error: Kamu sudah punya 50 pengingat aktif, batas untuk satu orang. Batalkan satu dulu sebelum membuat yang baru.");

  await insert(rows(450, "user-other"));
  expect(await set(s, "tenant full", "2026-03-06T16:00", { author: s.discord.bob })).toBe("error: Pengingat di sini sudah mencapai batas 500 yang aktif. Batalkan satu dulu sebelum membuat yang baru.");
  await s.guildSettings({ language: "en" });
  expect(await set(s, "tenant full", "2026-03-06T16:00", { author: s.discord.bob })).toBe("error: Reminders here are at their limit of 500 active. Cancel one before setting another.");
  expect((await schedules.list()).filter((r: any) => r.status === "active").length).toBe(500);
});

// A Reminder can be snoozed or reworded by its owner (#250).
discordScenario("editReminder snoozes a Reminder to a later time and rewords it; it posts then with the new text, and a stranger cannot change it", async (s) => {
  s.clock.set("2026-03-06T09:00:00+07:00");
  const id = await set(s, "send the invoice", "2026-03-06T15:00");
  const change = (args: Record<string, unknown>, author?: any) => {
    s.model.script({ tool: "editReminder", args: { id, ...args } }, (turn: any) => turn.toolResults[0].error ?? `${turn.toolResults[0].nextAt} ${turn.toolResults[0].text}`);
    return s.discord.send(`${s.discord.mention} change that reminder`, { author }).then(() => s.discord.botMessages.at(-1)!.content);
  };
  expect(await change({ at: "16:30" }, s.discord.bob)).toBe("Pengingat itu milik orang lain; hanya pemiliknya yang bisa mengubahnya.");
  expect(await change({ at: "16:30", text: "send the invoice to Acme" })).toBe("2026-03-06T16:30:00+07:00 send the invoice to Acme");
  expect(await change({ at: "08:00" })).toBe("2026-03-07T08:00:00+07:00 send the invoice to Acme");
  expect(await change({ at: "2026-03-06T10:00" })).toBe("2026-03-06T10:00:00+07:00 send the invoice to Acme");

  s.clock.set("2026-03-06T10:00:30+07:00");
  await s.scheduler.tick();
  expect(s.discord.botMessages.at(-1)!.content).toContain("send the invoice to Acme");
});
