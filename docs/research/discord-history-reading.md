# Reading Discord channel and thread history on demand

Research for issue #19 (child of map #16). Question: what does discord.js need to read a channel's or thread's message history on demand, for requests like "write minutes of this thread" or "summarise the last 2 hours", including messages the bot never took part in?

Researched 2026-10-11 against:

- Discord developer docs (now served from `docs.discord.com/developers/...`; the old `discord.com/developers/docs/...` URLs 301 there).
- discord.js source as locked in this repo: `apps/agent/package.json` asks for `^14.18.0`, `bun.lock` resolves **14.27.0**, with `@discordjs/rest` 2.6.3 and `@sapphire/snowflake` 3.5.5.
- discord.js 14.25.1 API docs via Context7, which match the 14.27.0 source for everything below.

Claims marked **(inferred)** are my reading of the sources, not something a source states outright.

## Current bot setup

`apps/agent/src/discord/client.ts` creates each client with:

```ts
intents: [Guilds, GuildMessages, MessageContent, DirectMessages]
partials: [Partials.Channel, Partials.Message]
```

The bot already reads history in a small way: `msg.channel.messages.fetch({ limit: 1, before: msg.id })` checks whether the previous message came from the bot, and `msg.fetchReference()` resolves replies. Reading a whole thread on demand uses the same calls, just with more pages.

## 1. Intents: nothing new is needed

- History comes from REST (`GET /channels/{id}/messages`), not from the gateway. Discord: "HTTP API restrictions are independent of Gateway restrictions, and are unaffected by which intents your app passes" in Identify. ([Gateway, intents](https://docs.discord.com/developers/events/gateway))
- `MESSAGE_CONTENT` still applies to REST responses. The intent "permits your app to receive message content data across the APIs". Without it, "An app will receive empty values in the `content`, `embeds`, `attachments`, and `components` fields", and `poll` is omitted. ([Message resource](https://docs.discord.com/developers/resources/message), [Gateway](https://docs.discord.com/developers/events/gateway)) The exceptions are messages the app sent, DMs with the app, messages that mention the app, and the target of a message context-menu command. Minutes of other people's conversation fall under none of these, so **the privileged intent has to stay enabled in the Developer Portal for every bot token**. Passing `GatewayIntentBits.MessageContent` in code does nothing if the portal toggle is off.
- Privileged-intent approval: "Apps with fewer than 10,000 users can access privileged intents by enabling them in the Developer Portal." Verification is required for apps in 100+ guilds, and "Apps that qualify for verification must be approved for the privileged intent(s) before they can use them." ([Gateway, privileged intents](https://docs.discord.com/developers/events/gateway)) Each tenant brings its own bot token, so this is a per-tenant setup step.
- `GuildMessages` only controls live `MESSAGE_CREATE` events in guilds. History reads do not need it. ([Gateway](https://docs.discord.com/developers/events/gateway))

## 2. Permissions: VIEW_CHANNEL and READ_MESSAGE_HISTORY, and a missing one fails silently

- `GET /channels/{channel.id}/messages` "requires the current user to have the `VIEW_CHANNEL` permission" (voice channels also need `CONNECT`). ([Message resource, Get Channel Messages](https://docs.discord.com/developers/resources/message))
- **"If the current user is missing the `READ_MESSAGE_HISTORY` permission in the channel, then no messages will be returned."** (same source). The call succeeds with an empty array instead of returning 403. A playbook that does not check first would write "no messages in this period" when the real cause is a missing permission. Check before reading, e.g. `channel.permissionsFor(client.user)?.has([ViewChannel, ReadMessageHistory])`, and tell the user which permission is missing. **(inferred:** the docs describe the empty result but do not suggest a pre-check.)
- Threads: "Threads generally inherit permissions from the parent channel." For private threads, "You must be invited to the thread to be able to view or participate in it", unless the bot has `MANAGE_THREADS`. ([Threads topic](https://docs.discord.com/developers/topics/threads)) The bot cannot take minutes of a private thread it was never added to.
- Listing archived threads: public needs `READ_MESSAGE_HISTORY`; private needs `READ_MESSAGE_HISTORY` and `MANAGE_THREADS`; "joined private" needs only `READ_MESSAGE_HISTORY`. ([Channel resource](https://docs.discord.com/developers/resources/channel)) discord.js's `ThreadManager#fetchArchived` documents the same `ReadMessageHistory` requirement on the parent.

## 3. Pagination and per-request limits

- Query params: `around`, `before`, `after` (snowflakes) and `limit` "(1-100)", **default 50**. "The `before`, `after`, and `around` parameters are mutually exclusive, only one may be passed at a time." Results come back "from newest to oldest". ([Get Channel Messages](https://docs.discord.com/developers/resources/message))
- discord.js maps this one-to-one: `channel.messages.fetch({ limit, before | after | around, cache })` makes one REST call and returns a `Collection<Snowflake, Message>` (`src/managers/MessageManager.js`, `_fetchMany`). The library never pages for you, so reading N messages takes `ceil(N/100)` calls in a loop you write.
- Message cache: discord.js's default `makeCache` caps `MessageManager` at **200 messages per channel** (`Options.DefaultMakeCacheSettings`), and `fetch` caches results unless you pass `cache: false`. A bulk read for minutes should pass `cache: false` so it does not push live messages out of the cache that `routing.ts`/`fetchReference` rely on. **(inferred)**

## 4. Bounding a read by time or count

Snowflakes encode their creation time, so a time bound can become an id bound. Discord gives the formula `(timestamp_ms - DISCORD_EPOCH) << 22`, with `DISCORD_EPOCH = 1420070400000`, and says such generated ids work as `before`/`after` values. ([Reference, snowflakes](https://docs.discord.com/developers/reference)) discord.js exports this as `SnowflakeUtil` (`= DiscordSnowflake` from `@sapphire/snowflake`): `SnowflakeUtil.generate({ timestamp })` and `SnowflakeUtil.timestampFrom(id)`.

Two loop shapes work. Either way, keep a hard cap on message count as well, so a busy channel cannot turn one request into hundreds of API calls and a prompt too large for the model.

1. **Walk backwards** (simplest): start with no cursor, then `before = oldest id seen`, 100 per page. Stop when a page is empty, when `message.createdTimestamp < cutoff`, or when the cap is reached. Reverse the result for chronological minutes.
2. **Walk forwards from the cutoff**: `after = SnowflakeUtil.generate({ timestamp: cutoff })`, then `after = newest id seen`. Each page still comes back newest-first, so sort it before taking the max id. **(inferred** from the documented ordering.)

"Whole thread" is bounded by the thread itself. A thread's `message_count` is the "number of messages (not including the initial message or deleted messages) in a thread" (inaccurate above 50 for threads created before 2022-07-01). `total_message_sent` never decreases. ([Channel resource](https://docs.discord.com/developers/resources/channel)) Use `message_count` to estimate cost or warn before a large read.

## 5. Rate limits

- Global: "All bots can make up to 50 requests per second to our API." Per-route limits are separate, are reported in the `X-RateLimit-*` headers, and are computed per top-level resource, which includes `channel_id`. So reading two different channels draws on two separate buckets. ([Rate limits](https://docs.discord.com/developers/topics/rate-limits)) The docs do not publish a fixed number for the messages route. Read the headers instead of hardcoding one.
- "IP addresses that make too many invalid HTTP requests are automatically and temporarily restricted": 10,000 invalid (401/403/429) requests per 10 minutes. (same source) The pre-check in section 2 also keeps repeated 403s on channels the bot cannot see from counting toward this.
- discord.js queues per bucket and waits out 429s automatically. `@discordjs/rest` 2.6.3 defaults are `rejectOnRateLimit: null` (queue, don't throw), `globalRequestsPerSecond: 50`, `offset: 50` ms, `retries: 3`, `timeout: 15000` ms (`dist/index.d.ts`). A long read gets slower rather than failing. The cost is that a minutes request can stall the bot's other REST calls on the same channel bucket while it runs. **(inferred)**

## 6. What comes back per message

| Need | Field (API → discord.js) | Notes |
|---|---|---|
| Text | `content` → `message.content` | Empty without `MESSAGE_CONTENT` (section 1). |
| Edits | `edited_timestamp` → `message.editedTimestamp` | Only the current text plus a timestamp. The API exposes no edit history, and deleted messages simply do not appear. ([Message resource](https://docs.discord.com/developers/resources/message)) |
| Replies | `message_reference` (type `DEFAULT`) + `referenced_message` → `message.reference`, `message.fetchReference()` | `referenced_message` is returned only for types 19/21/23. If it is absent, its state is unknown; if it is `null`, the original was deleted. (same) Reply context usually points inside the fetched window, so look it up there before calling `fetchReference()`. |
| Forwards | `message_reference` (type `FORWARD`) + `message_snapshots` → `message.messageSnapshots` | Snapshots are "immutable", a copy taken when the message was forwarded. (same) |
| Attachments | `attachments[]` → `message.attachments` (`url`, `proxy_url`, `filename`, `content_type`, `size`, `description`, `duration_secs`, `waveform`) | CDN attachment URLs "have signed URLs with a preset expiry time" (`ex`, `is`, `hm` params). ([Reference, signed CDN URLs](https://docs.discord.com/developers/reference)) Download anything the minutes need right away; don't store the URL as a lasting link. |
| Embeds | `embeds[]` → `message.embeds` | Link previews and bot embeds. "Embeds are deduplicated by URL." |
| Speaker name | `author` → `message.author` (`username`, `globalName`) | `member` is documented as an *extra field of the gateway MESSAGE_CREATE event*, not part of the message object ([Gateway events](https://docs.discord.com/developers/events/gateway-events)). discord.js's `message.member` getter only resolves from the guild member cache (`src/structures/Message.js`). Without the `GuildMembers` intent, history messages from people not seen live will have `member === null`. The current `speakerOf` (`member?.displayName \|\| author.username`) then falls back to the username, so prefer `author.globalName ?? author.username`, or fetch members in bulk. **(inferred)** |
| System noise | `type` → `message.type`, `message.system` | Thread-created, pin, join and similar messages: filter on `message.system`. |

## 7. Text channels, threads and forum posts

- **Text/announcement channel**: `messages.fetch` on the channel id. Thread replies are not included; each thread is its own channel.
- **Thread started from a message in a text channel**: its first message is type 21 `THREAD_STARTER_MESSAGE`, which "will never have content, embeds, or attachments" and points back to the parent message. The thread and that parent message "share the same id". ([Message resource](https://docs.discord.com/developers/resources/message), [Threads topic](https://docs.discord.com/developers/topics/threads)) Use `thread.fetchStarterMessage()`; discord.js fetches it from the parent channel (`ThreadChannel.js`).
- **Forum / media post**: the channel "can only contain threads" and has no messages of its own. ([Channel resource](https://docs.discord.com/developers/resources/channel)) Each post is a thread whose opening message "has the same ID as the thread" and lives *inside* the thread. ([Threads topic](https://docs.discord.com/developers/topics/threads)) `fetchStarterMessage()` handles both cases: for forum/media parents it fetches from the thread itself, and the promise rejects if the starter was deleted ([discord.js docs](https://discord.js.org/docs/packages/discord.js/14.25.1/ThreadChannel%3AClass)). "Minutes of this forum" therefore means listing posts and reading each one.
- **Archived threads**: "archived threads are not synced up-front via the gateway", so they are not in `client.channels.cache`. ([Threads topic](https://docs.discord.com/developers/topics/threads)) Get one with `client.channels.fetch(id)` (REST `GET /channels/{id}`) or list them with `parent.threads.fetchArchived({ type, before, limit })`, which returns `{ threads, hasMore }` sorted by archive time, newest first. Discord calls archived threads "generally immutable" and says sending a message "will automatically unarchive the thread, unless the thread has been locked". ([Channel resource](https://docs.discord.com/developers/resources/channel)) **No source says outright that reading messages from an archived thread works.** The immutability wording covers sending and reacting, not reading, so I expect `messages.fetch` to work, but it needs a manual check. **(inferred)** Posting the minutes back *into* an archived thread will unarchive it. A locked thread will reject the post.
- **Private threads**: readable only if the bot is a member or has `MANAGE_THREADS` (section 2).

## Implications for the minutes playbook

1. Intents in `client.ts` are already enough. The real requirement is the portal-side `MESSAGE_CONTENT` toggle on each tenant's bot, which onboarding should verify.
2. Check `ViewChannel` and `ReadMessageHistory` before reading. A missing `ReadMessageHistory` returns an empty list, not an error.
3. Read with a backwards `before` loop of 100 per page, using `cache: false`, stopping at a time cutoff (converted with `SnowflakeUtil`) and a hard message cap.
4. Normalise each message to `{ time, speaker (globalName ?? username), text, edited?, replyTo?, attachments: names/types }`, drop `system` messages, and add the starter message via `fetchStarterMessage()`.
5. Treat attachment URLs as short-lived; minutes should name files rather than link to them.
6. Open question for a manual check: reading an archived (and a locked) thread without unarchiving it.
