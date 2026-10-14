# Discord slash commands for playbook triggers

Research for issue #52 (map #50). Question: what do Discord application commands allow if each playbook gets its own slash command (`/wayfinder`), with availability narrowed per Tenant → Bot → Guild → Channel?

Checked 2026-10-12 against the Discord developer docs (source: [discord/discord-api-docs](https://github.com/discord/discord-api-docs), `main`) and the discord.js source that Pachiware installs (`discord.js@14.27.0`, from `bun.lock`; `apps/agent/package.json` asks for `^14.18.0`).

Short names for the sources:

- **AC**: Application Commands, https://docs.discord.com/developers/interactions/application-commands ([source](https://github.com/discord/discord-api-docs/blob/main/developers/interactions/application-commands.mdx))
- **RR**: Receiving and Responding, https://docs.discord.com/developers/interactions/receiving-and-responding ([source](https://github.com/discord/discord-api-docs/blob/main/developers/interactions/receiving-and-responding.mdx))
- **TH**: Threads topic, https://docs.discord.com/developers/topics/threads ([source](https://github.com/discord/discord-api-docs/blob/main/developers/topics/threads.mdx))
- **CH**: Channel resource, https://docs.discord.com/developers/resources/channel ([source](https://github.com/discord/discord-api-docs/blob/main/developers/resources/channel.mdx))
- **CL**: Change log, https://docs.discord.com/developers/change-log ([source](https://github.com/discord/discord-api-docs/blob/main/developers/change-log.mdx))
- **DJS**: discord.js 14.27.0 source, https://github.com/discordjs/discord.js/tree/14.27.0/packages/discord.js/src

## 1. Global vs guild registration

- Commands are either global (every guild that added the app, plus DMs with the bot when the user shares a guild with it) or guild-scoped (one guild, never in DMs). AC, [Registering a Command](https://docs.discord.com/developers/interactions/application-commands#registering-a-command).
- Guild commands "update **instantly**"; creating or editing a guild command is "available in the guild immediately". AC, [Making a Guild Command](https://docs.discord.com/developers/interactions/application-commands#making-a-guild-command), [Create Guild Application Command](https://docs.discord.com/developers/interactions/application-commands#create-guild-application-command), [Edit Guild Application Command](https://docs.discord.com/developers/interactions/application-commands#edit-guild-application-command).
- For global commands the current docs give no delay figure. They describe "read-repair": if a user runs a stale global command, Discord rejects it and reloads that command for the user. AC, [Making a Global Command](https://docs.discord.com/developers/interactions/application-commands#making-a-global-command). Older docs warned of up to an hour of propagation; that line is no longer in the page, so treat global changes as eventually visible, not instant.
- Registration is HTTP only. `PUT .../commands` (global) and `PUT .../guilds/{guild.id}/commands` (guild) replace the whole list for that scope, and the replace covers **all** command types (slash, user, message). AC, [Bulk Overwrite Global](https://docs.discord.com/developers/interactions/application-commands#bulk-overwrite-global-application-commands), [Bulk Overwrite Guild](https://docs.discord.com/developers/interactions/application-commands#bulk-overwrite-guild-application-commands).
- `POST` with an existing name is an upsert (200 instead of 201). AC, [Updating and Deleting a Command](https://docs.discord.com/developers/interactions/application-commands#updating-and-deleting-a-command).
- In discord.js, `client.application.commands.set(commands, guildId?)` is that bulk PUT; with a `guildId` it targets the guild scope. DJS, [`managers/ApplicationCommandManager.js` `set()`](https://github.com/discordjs/discord.js/blob/14.27.0/packages/discord.js/src/managers/ApplicationCommandManager.js).
- The `bot` OAuth scope already includes `applications.commands`, which is what lets an app create commands in a guild. AC, [Authorizing Your Application](https://docs.discord.com/developers/interactions/application-commands#authorizing-your-application).

**For Pachiware.** Today `registerCommands` (`apps/agent/src/discord/client.ts:116`) bulk-overwrites the **global** list with message commands only. Per-guild narrowing fits guild-scoped commands: one `commands.set(list, guildId)` per guild the bot is in, and it shows up immediately. Keep the scopes separate: a global and a guild `CHAT_INPUT` command may share a name (AC, [Registering a Command](https://docs.discord.com/developers/interactions/application-commands#registering-a-command)), so a playbook registered in both scopes would show twice. A guild-scope PUT also replaces guild message commands, so put both kinds in that one list if the menus move to guild scope.

## 2. Count and size limits

- Per app: 100 global `CHAT_INPUT`, 15 global `USER`, 15 global `MESSAGE`, 1 global `PRIMARY_ENTRY_POINT`. The same counts apply again **per guild** for guild commands (except entry point). AC, [Registering a Command](https://docs.discord.com/developers/interactions/application-commands#registering-a-command).
- The context-menu limit rose from 5 to 15 per type on 2026-03-03. CL, ["Updates to Context Menu Commands"](https://docs.discord.com/developers/change-log). The code comment and `.slice(0, 5)` in `registerCommands` still assume 5.
- Rate limit: "200 application command creates per day, per guild". Bulk overwrites count only commands that do not already exist. AC, [Registering a Command](https://docs.discord.com/developers/interactions/application-commands#registering-a-command), [Bulk Overwrite Global](https://docs.discord.com/developers/interactions/application-commands#bulk-overwrite-global-application-commands).
- Up to 25 options per command, 25 choices per option, 25 subcommands per group. AC, [Application Command Structure](https://docs.discord.com/developers/interactions/application-commands#application-command-object-application-command-structure), [Option Structure](https://docs.discord.com/developers/interactions/application-commands#application-command-object-application-command-option-structure).
- A slash command's combined name + description + value text, over all its options and choices, may not exceed 8000 characters. AC, [Slash Commands](https://docs.discord.com/developers/interactions/application-commands#slash-commands).

**For Pachiware.** 100 slash commands per guild per bot is plenty for one command per playbook. Re-registering after an availability change is cheap as long as the names stay the same. Turning a playbook off and on again in a guild makes a new command, which counts toward the 200 a day.

## 3. Name rules

- `CHAT_INPUT` names and option names must match `^[-_ʼ\p{L}\p{N}\p{sc=Deva}\p{sc=Thai}]{1,32}$` (Unicode), and must use the lowercase form of any cased letter. No spaces. `USER` and `MESSAGE` names may be mixed case and contain spaces. AC, [Application Command Naming](https://docs.discord.com/developers/interactions/application-commands#application-command-object-application-command-naming).
- Description is required for slash commands, 1-100 characters. AC, [Application Command Structure](https://docs.discord.com/developers/interactions/application-commands#application-command-object-application-command-structure).
- Names are unique per app, per type, per scope. Different apps **may** use the same name. AC, [Registering a Command](https://docs.discord.com/developers/interactions/application-commands#registering-a-command).
- Names and descriptions can be localized (`name_localizations`, same rules). AC, [Application Command Structure](https://docs.discord.com/developers/interactions/application-commands#application-command-object-application-command-structure).

**For Pachiware.** Playbook slugs need validating against that regex: lowercase, at most 32 characters, no spaces or dots. `issue-draft` and `wayfinder` pass.

## 4. Per-channel and per-role command permissions

Three layers decide who sees a command (CL, ["Upcoming Application Command Permission Changes"](https://docs.discord.com/developers/change-log), Nov 2022, "Permissions v2"):

1. `default_member_permissions`, set by the app on the command: a permission bitfield the member must hold. `"0"` hides the command from everyone but admins unless an override exists. No special token needed. AC, [Using Default Permissions](https://docs.discord.com/developers/interactions/application-commands#application-command-permissions-object-using-default-permissions).
2. App-level permissions: the admin's base allow/deny of users, roles, and channels for all of the app's commands.
3. Command-level permissions: per-command overrides of the app level and of `default_member_permissions`.

Overwrites can target a role, a user, or a channel (type 1/2/3), up to 100 per command. Constants: `guild_id` means @everyone and `guild_id - 1` means all channels. Channel overwrites also cover threads in that channel. AC, [Application Command Permissions Object](https://docs.discord.com/developers/interactions/application-commands#application-command-permissions-object), [Permission Type](https://docs.discord.com/developers/interactions/application-commands#application-command-permissions-object-application-command-permission-type).

If a member may not use a command, it does not appear in their picker, but **members with Administrator can use every command**. AC, same section.

**Who can set overwrites:**

- People: admins in Server Settings → Integrations → Manage, at app level or unsynced per command. AC, [Syncing and Unsyncing Permissions](https://docs.discord.com/developers/interactions/application-commands#syncing-and-unsyncing-permissions); [Discord blog, "Permission to Slash, Granted"](https://discord.com/blog/slash-commands-permissions-discord-apps-bots).
- The app: only with an OAuth2 **Bearer** token that carries the `applications.commands.permissions.update` scope, granted by a user who has Manage Guild **and** Manage Roles, can run the command, and can manage the affected roles, users, and channels. "Authenticating with a bot token will result in an error." AC, [Permissions](https://docs.discord.com/developers/interactions/application-commands#permissions); CL, ["Updated Command Permissions"](https://docs.discord.com/developers/change-log) (Apr 2022).
- discord.js enforces this: `ApplicationCommandPermissionsManager.set/add/remove` throw `ApplicationCommandPermissionsTokenMissing` without a `token` and send it as `Authorization: Bearer`. DJS, [`managers/ApplicationCommandPermissionsManager.js`](https://github.com/discordjs/discord.js/blob/14.27.0/packages/discord.js/src/managers/ApplicationCommandPermissionsManager.js).
- The batch permissions endpoint is disabled; overwrites go one command at a time. AC, [Batch Edit Application Command Permissions](https://docs.discord.com/developers/interactions/application-commands#batch-edit-application-command-permissions).
- "Deleting or renaming a command will permanently delete all permissions for the command." AC, [Edit Application Command Permissions](https://docs.discord.com/developers/interactions/application-commands#edit-application-command-permissions).

`contexts` and `integration_types` only control guild vs bot DM vs private channel, and only for global commands. They cannot target a channel. AC, [Contexts](https://docs.discord.com/developers/interactions/application-commands#contexts).

**For Pachiware.** With its bot token, a bot can:

- **hide per guild**: leave the command out of that guild's list.
- **hide per member permission**: `default_member_permissions`.
- **refuse per channel at runtime**: answer the interaction with an ephemeral "not available here".

Hiding per channel or per role needs either an admin to do it in Discord's Integrations UI, or a stored admin OAuth Bearer grant, which is a separate consent flow per guild. The interaction payload carries `channel_id` (the thread's id inside a thread), `member` with its roles, and `app_permissions`, so a runtime check has what it needs. RR, [Interaction Object](https://docs.discord.com/developers/interactions/receiving-and-responding#interaction-object). Admins always see every command, so the runtime check is needed even where hiding is set up.

## 5. String and attachment options

- `STRING` (type 3): `min_length` 0-6000, `max_length` 1-6000, optional `choices` (max 25; values up to 100 characters, and the only values allowed) or `autocomplete` (not both; autocomplete answers are suggestions, not limits). AC, [Option Structure](https://docs.discord.com/developers/interactions/application-commands#application-command-object-application-command-option-structure), [Option Choice Structure](https://docs.discord.com/developers/interactions/application-commands#application-command-object-application-command-option-choice-structure).
- `ATTACHMENT` (type 11): the user uploads a file and the app receives an attachment object in `data.resolved.attachments`. `file_types` filters by extension (`image`, `video`, `audio`, or `.pdf` style, max 10), matched on the extension only. AC, [Option Type](https://docs.discord.com/developers/interactions/application-commands#application-command-object-application-command-option-type); RR, [Resolved Data Structure](https://docs.discord.com/developers/interactions/receiving-and-responding#interaction-object-resolved-data-structure).
- Required options must come before optional ones. AC, [Option Structure](https://docs.discord.com/developers/interactions/application-commands#application-command-object-application-command-option-structure).

**For Pachiware.** `/wayfinder points:<string, optional, max 6000> file:<attachment, optional>` covers today's "@bot word: points" brief. A modal with a paragraph field is another way to collect a long brief. RR, [Interaction Callback Type](https://docs.discord.com/developers/interactions/receiving-and-responding#interaction-response-object-interaction-callback-type) `MODAL`.

## 6. Opening a thread and continuing in it

- A slash command leaves no user message in the channel, so a thread has to start from the bot's own reply or from no message at all.
- **From the reply:** answer with a non-ephemeral message, then call Start Thread from Message on it. The thread id equals the message id, and a message can have only one thread. Works in `GUILD_TEXT` and announcement channels, not forum or media channels. CH, [Start Thread from Message](https://docs.discord.com/developers/resources/channel#start-thread-from-message).
- In discord.js 14.27, `interaction.reply({ ..., withResponse: true })` returns an `InteractionCallbackResponse` whose `resource.message` is a `Message` with `startThread()`. The older `fetchReply` option is deprecated. DJS, [`structures/interfaces/InteractionResponses.js`](https://github.com/discordjs/discord.js/blob/14.27.0/packages/discord.js/src/structures/interfaces/InteractionResponses.js), [`structures/InteractionCallbackResource.js`](https://github.com/discordjs/discord.js/blob/14.27.0/packages/discord.js/src/structures/InteractionCallbackResource.js).
- **Without a message:** `POST /channels/{id}/threads` takes a `type` that defaults to `PRIVATE_THREAD` and has auto-archive values 60/1440/4320/10080. CH, [Start Thread without Message](https://docs.discord.com/developers/resources/channel#start-thread-without-message). The Threads topic says public threads "must be created from an existing message" (TH, [Public & Private Threads](https://docs.discord.com/developers/topics/threads#public--private-threads)), so starting from the reply is the documented path.
- Forum channels: Start Thread in Forum creates the thread and its first message together. CH, [Start Thread in Forum or Media Channel](https://docs.discord.com/developers/resources/channel#start-thread-in-forum-or-media-channel).
- Bot permissions: `CREATE_PUBLIC_THREADS` to open a thread and `SEND_MESSAGES_IN_THREADS` to talk in it (`SEND_MESSAGES` has no effect in threads). TH, [Permissions](https://docs.discord.com/developers/topics/threads#permissions). `interaction.appPermissions` (from `app_permissions`) lets the bot check these before trying. RR, [Interaction Object](https://docs.discord.com/developers/interactions/receiving-and-responding#interaction-object); DJS `BaseInteraction#appPermissions`.
- After the thread exists, the conversation continues as normal messages: the bot posts with `thread.send()` and reads `MessageCreate` events, the same path as today's bound threads (`client.ts:139`). Interaction follow-ups are no good for this: they last only as long as the token (§7), and the follow-up endpoint does not support `thread_id`. RR, [Create Followup Message](https://docs.discord.com/developers/interactions/receiving-and-responding#create-followup-message).
- Members cannot use application commands in archived threads. TH, [Active & Archived Threads](https://docs.discord.com/developers/topics/threads#active--archived-threads).

## 7. Response deadlines

- The first response is due **within 3 seconds** of receiving the interaction, or the token is invalidated. RR, [Interaction Callback](https://docs.discord.com/developers/interactions/receiving-and-responding#interaction-callback).
- `DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE` (type 5, discord.js `deferReply()`) acknowledges the interaction and shows a loading state. The only flag a deferred response may carry is `EPHEMERAL`. RR, [Interaction Callback Type](https://docs.discord.com/developers/interactions/receiving-and-responding#interaction-response-object-interaction-callback-type), [Messages](https://docs.discord.com/developers/interactions/receiving-and-responding#interaction-response-object-messages).
- The token stays valid for **15 minutes** for editing the original response and sending follow-ups. RR, [Followup Messages](https://docs.discord.com/developers/interactions/receiving-and-responding#followup-messages).
- Gateway bots must still answer over HTTP; discord.js does this for you. RR, [Interaction Callback](https://docs.discord.com/developers/interactions/receiving-and-responding#interaction-callback).

**For Pachiware.** Defer first, before tenant, playbook, or skill lookups, then edit the deferred reply and start the thread from it. Today's `handleCommand` (`client.ts:247`) awaits `getTenantById` and `listPlaybooks` before its first `reply`, which risks missing the 3-second deadline under load.

## 8. Several bots in one guild: the `/` picker

- Different apps may register the same command name. AC, [Registering a Command](https://docs.discord.com/developers/interactions/application-commands#registering-a-command).
- The picker lists every command available to the member, with a sidebar of all the apps in the server that have commands. [Discord blog, "Permission to Slash, Granted"](https://discord.com/blog/slash-commands-permissions-discord-apps-bots). Context menus are now grouped by app as well, with a search bar and frequently used commands moved to the top. CL, ["Updates to Context Menu Commands"](https://docs.discord.com/developers/change-log) (2026-03-03).
- So if two Pachiware bots of one tenant both register `/wayfinder` in a guild, the member sees two `/wayfinder` entries told apart by the bot's name and icon, and the bot whose entry was picked receives the interaction. The only ways to show one are to register it on one bot, or for an admin to deny the other app in Integrations.

## Summary for the spec

| Need | Possible with the bot token alone? |
| --- | --- |
| One `/playbook` per playbook | Yes. Guild-scoped, up to 100 per bot per guild, shows instantly |
| Narrow per Tenant / Bot / Guild | Yes. Choose which guilds get which commands; re-register with bulk PUT |
| Hide per channel or role | No. Needs an admin in Integrations or an admin OAuth Bearer grant |
| Refuse per channel or role | Yes. Check `channelId` and member roles, answer ephemerally |
| Long brief and a file | Yes. `STRING` up to 6000 characters, `ATTACHMENT` |
| Open a bound thread | Yes. Reply, then `startThread` on the reply; continue with normal messages |
| Deadlines | 3 s first ack (defer), 15 min token, no limit on thread messages |
