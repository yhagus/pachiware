import { expect, test } from "bun:test";
import { contract } from "./engines.ts";

contract("Conversations and messages", (use) => {
  const tenant = (slug: string) => use().repos.tenants.create({ name: slug, slug });

  test("a conversation is created for a tenant and only that tenant reads it back", async () => {
    const { conversations } = use().repos;
    const [acme, other] = [await tenant("acme"), await tenant("other")];
    const created = await conversations.create({ tenantId: acme.id, platform: "web", channelId: "c1", userId: "u1", metadata: { parentChannelId: "p1" } });
    expect(created).toMatchObject({ tenantId: acme.id, botId: null, platform: "web", channelId: "c1", userId: "u1", metadata: { parentChannelId: "p1" } });
    expect(created.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(created.createdAt).toBeInstanceOf(Date);
    expect(await conversations.get(acme.id, created.id)).toEqual(created);
    expect(await conversations.get(other.id, created.id)).toBeNull();
    expect(await conversations.get(acme.id, "missing")).toBeNull();
  });

  test("messages are kept oldest first, counted, and paged from an offset", async () => {
    const { conversations } = use().repos;
    const acme = await tenant("acme");
    const chat = await conversations.create({ tenantId: acme.id, platform: "discord" });
    const user = await conversations.addMessage({ tenantId: acme.id, conversationId: chat.id, role: "user", content: "hello" });
    expect(user).toMatchObject({ tenantId: acme.id, conversationId: chat.id, role: "user", content: "hello", toolCalls: null, toolCallId: null, tokensUsed: null });
    expect(user.createdAt).toBeInstanceOf(Date);
    await Bun.sleep(2);
    const calls = [{ id: "call-1", name: "list_tasks", arguments: { status: "open" } }];
    await conversations.addMessage({ tenantId: acme.id, conversationId: chat.id, role: "assistant", content: null, toolCalls: calls, tokensUsed: 42 });
    await Bun.sleep(2);
    await conversations.addMessage({ tenantId: acme.id, conversationId: chat.id, role: "tool", content: "{}", toolCallId: "call-1" });

    expect(await conversations.countMessages(acme.id, chat.id)).toBe(3);
    const all = await conversations.listMessages(acme.id, chat.id, { offset: 0, limit: 10 });
    expect(all.map((m) => m.role)).toEqual(["user", "assistant", "tool"]);
    expect(all[0]).toEqual(user);
    expect(all[1]).toMatchObject({ content: null, toolCalls: calls, tokensUsed: 42 });
    expect(all[2]).toMatchObject({ toolCallId: "call-1" });
    expect((await conversations.listMessages(acme.id, chat.id, { offset: 1, limit: 1 })).map((m) => m.role)).toEqual(["assistant"]);
  });

  test("a message joins only a conversation of its own tenant, and only that tenant reads it", async () => {
    const { conversations } = use().repos;
    const [acme, other] = [await tenant("acme"), await tenant("other")];
    const chat = await conversations.create({ tenantId: acme.id, platform: "web" });
    await conversations.addMessage({ tenantId: acme.id, conversationId: chat.id, role: "user", content: "mine" });
    await expect(conversations.addMessage({ tenantId: other.id, conversationId: chat.id, role: "user", content: "intruder" })).rejects.toThrow();
    await expect(conversations.addMessage({ tenantId: acme.id, conversationId: "missing", role: "user", content: "lost" })).rejects.toThrow();
    expect(await conversations.countMessages(acme.id, chat.id)).toBe(1);
    expect(await conversations.countMessages(other.id, chat.id)).toBe(0);
    expect(await conversations.listMessages(other.id, chat.id, { offset: 0, limit: 10 })).toEqual([]);
  });

  test("setting metadata replaces it, for that tenant only", async () => {
    const { conversations } = use().repos;
    const [acme, other] = [await tenant("acme"), await tenant("other")];
    const chat = await conversations.create({ tenantId: acme.id, platform: "web", metadata: { parentChannelId: "p1", bulkApproval: { userId: "u1", items: [] } } });
    const summary = { text: "agreed on Friday", coversMessages: 10, updatedAt: "2026-10-16T00:00:00.000Z" };
    await conversations.setMetadata(acme.id, chat.id, { parentChannelId: "p1", summary });
    expect((await conversations.get(acme.id, chat.id))?.metadata).toEqual({ parentChannelId: "p1", summary });
    await conversations.setMetadata(other.id, chat.id, {});
    expect((await conversations.get(acme.id, chat.id))?.metadata).toEqual({ parentChannelId: "p1", summary });
  });

  test("a conversation names only a bot of its own tenant", async () => {
    const { conversations } = use().repos;
    const [acme, other] = [await tenant("acme"), await tenant("other")];
    const bot = await use().addBot(acme.id);
    expect((await conversations.create({ tenantId: acme.id, botId: bot, platform: "discord" })).botId).toBe(bot);
    await expect(conversations.create({ tenantId: other.id, botId: bot, platform: "discord" })).rejects.toThrow();
    expect(await conversations.listForTenant(other.id)).toEqual([]);
  });

  test("a tenant lists its own conversations newest first", async () => {
    const { conversations } = use().repos;
    const [acme, other] = [await tenant("acme"), await tenant("other")];
    const first = await conversations.create({ tenantId: acme.id, platform: "web" });
    await Bun.sleep(2);
    const second = await conversations.create({ tenantId: acme.id, platform: "web" });
    await conversations.create({ tenantId: other.id, platform: "web" });
    expect((await conversations.listForTenant(acme.id)).map((c) => c.id)).toEqual([second.id, first.id]);
  });

  test("the newest conversation of a bot in a channel is the one a turn continues", async () => {
    const { conversations } = use().repos;
    const [acme, other] = [await tenant("acme"), await tenant("other")];
    const [bot, sibling] = [await use().addBot(acme.id), await use().addBot(acme.id)];
    await conversations.create({ tenantId: acme.id, botId: bot, platform: "discord", channelId: "c1" });
    await Bun.sleep(2);
    const newest = await conversations.create({ tenantId: acme.id, botId: bot, platform: "discord", channelId: "c1" });
    await Bun.sleep(2);
    await conversations.create({ tenantId: acme.id, botId: sibling, platform: "discord", channelId: "c1" });
    await conversations.create({ tenantId: acme.id, botId: bot, platform: "discord", channelId: "c2" });
    expect(await conversations.latestInChannel(acme.id, bot, "c1")).toEqual(newest);
    expect(await conversations.latestInChannel(other.id, bot, "c1")).toBeNull();
    expect(await conversations.latestInChannel(acme.id, bot, "c3")).toBeNull();
  });

  test("a bot lists the conversations it handled, newest first, with message counts, and filters by channel or parent channel", async () => {
    const { conversations } = use().repos;
    const acme = await tenant("acme");
    const [bot, sibling] = [await use().addBot(acme.id), await use().addBot(acme.id)];
    const channel = await conversations.create({ tenantId: acme.id, botId: bot, platform: "discord", channelId: "c1", userId: "u1", metadata: { parentChannelId: "c1" } });
    await Bun.sleep(2);
    const thread = await conversations.create({ tenantId: acme.id, botId: bot, platform: "discord", channelId: "t1", metadata: { parentChannelId: "c1" } });
    await Bun.sleep(2);
    const elsewhere = await conversations.create({ tenantId: acme.id, botId: bot, platform: "discord", channelId: "c2", metadata: { parentChannelId: "c2" } });
    await conversations.create({ tenantId: acme.id, botId: sibling, platform: "discord", channelId: "c1" });
    await conversations.addMessage({ tenantId: acme.id, conversationId: channel.id, role: "user", content: "one" });
    await Bun.sleep(2);
    const last = await conversations.addMessage({ tenantId: acme.id, conversationId: channel.id, role: "assistant", content: "two" });

    const listed = await conversations.listForBot(bot, { limit: 50 });
    expect(listed.map((c) => c.id)).toEqual([elsewhere.id, thread.id, channel.id]);
    expect(listed[2]).toEqual({ id: channel.id, channelId: "c1", userId: "u1", createdAt: channel.createdAt, messageCount: 2, lastMessageAt: last.createdAt });
    expect(listed[1]).toMatchObject({ messageCount: 0, lastMessageAt: null });
    expect((await conversations.listForBot(bot, { channelId: "c1", limit: 50 })).map((c) => c.id)).toEqual([thread.id, channel.id]);
    expect((await conversations.listForBot(bot, { limit: 1 })).map((c) => c.id)).toEqual([elsewhere.id]);

    expect(await conversations.getForBot(bot, channel.id)).toEqual(channel);
    expect(await conversations.getForBot(sibling, channel.id)).toBeNull();
  });

  test("the latest messages come back oldest first, and chat-only leaves out tool steps and empty messages", async () => {
    const { conversations } = use().repos;
    const acme = await tenant("acme");
    const chat = await conversations.create({ tenantId: acme.id, platform: "web" });
    const add = async (role: string, content: string | null) => { await conversations.addMessage({ tenantId: acme.id, conversationId: chat.id, role, content }); await Bun.sleep(2); };
    await add("user", "first");
    await add("assistant", null);
    await add("tool", "{}");
    await add("assistant", "second");
    await add("user", "third");
    expect((await conversations.latestMessages(acme.id, chat.id, { limit: 3 })).map((m) => m.content)).toEqual(["{}", "second", "third"]);
    expect((await conversations.latestMessages(acme.id, chat.id, { limit: 10, chatOnly: true })).map((m) => m.content)).toEqual(["first", "second", "third"]);
    expect((await conversations.latestMessages(acme.id, chat.id, { limit: 2, chatOnly: true })).map((m) => m.content)).toEqual(["second", "third"]);
  });
});
