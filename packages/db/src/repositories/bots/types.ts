/** Domain types and the repository interface for Bots and their guild configuration. Every engine implements it. */

import type { DigestChannel } from "../../schema/types.js";

/** A bot as the platform shows it. Its token is kept encrypted and only read back through `getWithToken`. */
export type Bot = {
  id: string;
  tenantId: string;
  name: string;
  platform: string;
  clientId: string | null;
  guildIds: string[];
  isEnabled: boolean;
  /** `deleted` marks a tombstone, which every read leaves out. */
  connectionStatus: string;
  profileId: string | null;
  hasToken: boolean;
  lastConnectedAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type NewBot = { tenantId: string; token: string; name?: string; platform?: string; clientId?: string | null; guildIds?: string[]; profileId?: string | null; isEnabled?: boolean };
export type BotUpdate = { name?: string; token?: string; clientId?: string | null; guildIds?: string[]; profileId?: string | null; isEnabled?: boolean; connectionStatus?: string; lastError?: string | null; lastConnectedAt?: Date };

/** A bot with its decrypted token, for connecting it. */
export type BotWithToken = { bot: Bot; token: string };

export type BotSearch = { q?: string; platform?: string; page: number; pageSize: number };

/** One guild's settings for one bot; null fields fall back to the tenant's. */
export type GuildConfig = {
  id: string;
  tenantId: string;
  botId: string;
  guildId: string;
  systemPrompt: string | null;
  useThreads: boolean;
  alwaysChannelIds: string[];
  timezone: string | null;
  language: "id" | "en" | null;
  digestChannels: DigestChannel[];
  updatedAt: Date;
};

export type GuildConfigInput = { systemPrompt?: string | null; useThreads?: boolean; alwaysChannelIds?: string[]; timezone?: string | null; language?: "id" | "en" | null; digestChannels?: DigestChannel[] };

export interface BotRepository {
  /** Creates a bot of a tenant that is not deleted, its token encrypted. A missing tenant or token, or a platform other than Discord, throws. */
  create(input: NewBot): Promise<Bot>;
  /** Reads a bot that is not deleted; with `tenantId`, only one of that tenant. */
  get(id: string, tenantId?: string): Promise<Bot | null>;
  /** A bot that is not deleted, with its token. Throws when the token cannot be decrypted. */
  getWithToken(id: string): Promise<BotWithToken | null>;
  /** A tenant's bots that are not deleted, oldest first. */
  listForTenant(tenantId: string): Promise<Bot[]>;
  /** One page of a tenant's bots, newest first, filtered by platform and by a name fragment ignoring case, with how many match in all. */
  search(tenantId: string, filter: BotSearch): Promise<{ bots: Bot[]; total: number }>;
  /** Enabled bots of active tenants, with their tokens. A bot whose token cannot be decrypted is marked in error and left out. */
  listRunnable(): Promise<BotWithToken[]>;
  /** How many bots are not deleted, across every tenant. */
  count(): Promise<number>;
  /** Changes a bot that is not deleted; null when there is none. An empty token throws. */
  update(id: string, input: BotUpdate): Promise<Bot | null>;
  /** Turns the bot into a tombstone: disabled, its token wiped, gone from every read. Its availability rules are deleted. */
  remove(id: string): Promise<void>;

  getGuildConfig(botId: string, guildId: string): Promise<GuildConfig | null>;
  /** Writes the given fields of one guild's configuration, creating it on first write. */
  saveGuildConfig(tenantId: string, botId: string, guildId: string, input: GuildConfigInput): Promise<GuildConfig>;
  /** Every guild configuration of a tenant. */
  listGuildConfigs(tenantId: string): Promise<GuildConfig[]>;
}
