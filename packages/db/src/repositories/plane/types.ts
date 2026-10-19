/** Domain types and the repository interface for Plane accounts, their links to bots, and Plane scopes. Every engine implements it. */
import type { BotRef } from "../git/types.js";

/** A tenant's credentials for one Plane workspace. The API key is stored encrypted; the repository never sees it in clear. */
export type PlaneAccount = {
  id: string;
  tenantId: string;
  name: string;
  /** A self-hosted Plane, or null for Plane's cloud. */
  baseUrl: string | null;
  workspaceSlug: string;
  apiKeyEncrypted: string;
  /** The Plane user the key acts as, recorded when the account was last checked against Plane. */
  planeUserId: string;
  planeUserName: string;
  /** The Plane version the account's server runs, as an admin chose it: an id from the Plane skill's list of Plane versions. */
  planeVersion: string;
  /** The release the Plane server reported when the account was last saved, such as "v1.3.1"; null when it could not be read. */
  planeServerVersion: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type NewPlaneAccount = {
  tenantId: string;
  name: string;
  baseUrl?: string | null;
  workspaceSlug: string;
  apiKeyEncrypted: string;
  planeUserId: string;
  planeUserName: string;
  planeVersion: string;
  planeServerVersion?: string | null;
};

export type PlaneAccountUpdate = Partial<Pick<PlaneAccount, "name" | "baseUrl" | "workspaceSlug" | "apiKeyEncrypted" | "planeUserId" | "planeUserName" | "planeVersion" | "planeServerVersion">>;

/** Which Plane projects one account may reach in one scope: Plane project ids, or ["*"] for all of them (ALL_PLANE_PROJECTS). */
export type PlaneScopeRule = { planeAccountId: string; projectIds: string[] };

export type PlaneScope = PlaneScopeRule & {
  id: string;
  tenantId: string;
  botId: string;
  guildId: string;
  /** "" for the guild level. */
  channelId: string;
  updatedAt: Date;
};

export interface PlaneRepository {
  /** A name already taken in the tenant rejects. */
  createAccount(input: NewPlaneAccount): Promise<PlaneAccount>;
  getAccount(id: string): Promise<PlaneAccount | null>;
  /** A tenant's accounts, newest first, at most 200. */
  listAccounts(tenantId: string): Promise<PlaneAccount[]>;
  /** Changes only the fields given; null when there is no such account. A name already taken in the tenant rejects. */
  updateAccount(id: string, input: PlaneAccountUpdate): Promise<PlaneAccount | null>;
  /** Removes the account with its bot links and Plane scopes. False when there was no such account. */
  deleteAccount(id: string): Promise<boolean>;
  /** True when every id names an account of this tenant. */
  ownsAccounts(tenantId: string, ids: string[]): Promise<boolean>;

  /**
   * Replaces the Plane accounts a bot holds, all or nothing. The bot and every account must belong to the tenant ("Bot not found", "Plane account not found").
   * Unlinking an account removes its Plane scopes on that bot; linking one switches the plane skill on for the tenant.
   */
  setBotAccounts(tenantId: string, botId: string, accountIds: string[]): Promise<void>;
  /** The accounts a bot holds, oldest first. */
  listBotAccounts(botId: string): Promise<PlaneAccount[]>;
  /** The ids of the accounts each of these bots holds, keyed by bot id; a bot without any is left out. */
  botAccountIds(botIds: string[]): Promise<Record<string, string[]>>;
  /** For each account of the tenant, the bots that are not deleted and hold it, keyed by account id; an unused account is left out. */
  botsByAccount(tenantId: string): Promise<Record<string, BotRef[]>>;

  /** The Plane scopes of a bot in one guild: its guild rules (channelId "") and every channel rule. */
  listScopes(botId: string, guildId: string): Promise<PlaneScope[]>;
  /**
   * Replaces the rules of one scope (channelId "" is the guild level); each names a different account the bot holds.
   * A channel rule may only narrow its account's guild rule, and replacing guild rules narrows or removes the channel rules beneath.
   */
  replaceScopes(tenantId: string, botId: string, guildId: string, channelId: string, rules: PlaneScopeRule[]): Promise<void>;
}
