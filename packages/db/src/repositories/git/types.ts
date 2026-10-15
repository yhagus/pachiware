/** Domain types and the repository interface for Git accounts, their links to bots, Git scopes and git OAuth apps. Every engine implements it. */

/** A tenant's login to GitHub or GitLab. Tokens are stored encrypted; the repository never sees them in clear. */
export type GitAccount = {
  id: string;
  tenantId: string;
  name: string;
  provider: string;
  /** The self-hosted host, or null for github.com / gitlab.com. */
  baseUrl: string | null;
  username: string;
  authType: string;
  tokenEncrypted: string;
  refreshTokenEncrypted: string | null;
  tokenExpiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type NewGitAccount = {
  tenantId: string;
  name: string;
  provider: string;
  baseUrl?: string | null;
  username: string;
  tokenEncrypted: string;
  authType?: string;
  refreshTokenEncrypted?: string | null;
  tokenExpiresAt?: Date | null;
};

export type GitAccountUpdate = Partial<Pick<GitAccount, "name" | "baseUrl" | "username" | "authType" | "tokenEncrypted" | "refreshTokenEncrypted" | "tokenExpiresAt">>;

export interface GitRepository {
  /** A name already taken in the tenant rejects. */
  createAccount(input: NewGitAccount): Promise<GitAccount>;
  getAccount(id: string): Promise<GitAccount | null>;
  /** A tenant's accounts, newest first, at most 200. */
  listAccounts(tenantId: string): Promise<GitAccount[]>;
  /** Changes only the fields given; null when there is no such account. A name already taken in the tenant rejects. */
  updateAccount(id: string, input: GitAccountUpdate): Promise<GitAccount | null>;
  /** False when there was no such account. */
  deleteAccount(id: string): Promise<boolean>;
  /** True when every id names an account of this tenant. */
  ownsAccounts(tenantId: string, ids: string[]): Promise<boolean>;

  /**
   * Replaces the accounts a bot holds. Every account must belong to the tenant, or it rejects with "Git account not found"
   * and nothing changes. Unlinking an account removes its Git scopes on that bot; linking one switches the git skill on for the tenant.
   */
  setBotAccounts(tenantId: string, botId: string, accountIds: string[]): Promise<void>;
  /** The accounts a bot holds, oldest first. */
  listBotAccounts(botId: string): Promise<GitAccount[]>;
  /** The ids of the accounts each of these bots holds, keyed by bot id; a bot without any is left out. */
  botAccountIds(botIds: string[]): Promise<Record<string, string[]>>;
  /** For each account of the tenant, the bots that are not deleted and hold it, keyed by account id; an unused account is left out. */
  botsByAccount(tenantId: string): Promise<Record<string, BotRef[]>>;

  /** The Git scopes of a bot in one server: its server rules (channelId "") and every channel rule. */
  listScopes(botId: string, guildId: string): Promise<GitScope[]>;
  /**
   * Replaces the rules of one scope; channelId "" is the server level. Patterns are stored trimmed, lowercased and deduplicated.
   * Each rule must name a different account the bot holds. A channel rule needs a server rule for its account and may only
   * narrow it; replacing server rules narrows or removes the channel rules beneath them.
   */
  replaceScopes(tenantId: string, botId: string, guildId: string, channelId: string, rules: GitScopeRule[]): Promise<void>;

  /** A second app for the same provider and host rejects. */
  createOAuthApp(input: NewGitOAuthApp): Promise<GitOAuthApp>;
  /** The app for a provider's host; a null host means the public one. */
  findOAuthApp(provider: string, baseUrl: string | null): Promise<GitOAuthApp | null>;
  /** Every app, newest first, at most 200. */
  listOAuthApps(): Promise<GitOAuthApp[]>;
  /** False when there was no such app. */
  deleteOAuthApp(id: string): Promise<boolean>;
}

/** The platform's OAuth client for one git host, through which tenants connect accounts. */
export type GitOAuthApp = {
  id: string;
  provider: string;
  /** "" for github.com / gitlab.com. */
  baseUrl: string;
  clientId: string;
  clientSecretEncrypted: string;
  createdAt: Date;
  updatedAt: Date;
};

export type NewGitOAuthApp = Pick<GitOAuthApp, "provider" | "baseUrl" | "clientId" | "clientSecretEncrypted">;

export type BotRef = { id: string; name: string };

/** Which repositories one account may reach in one scope. */
export type GitScopeRule = { gitAccountId: string; repoPatterns: string[] };

export type GitScope = GitScopeRule & {
  id: string;
  tenantId: string;
  botId: string;
  guildId: string;
  /** "" for the server level. */
  channelId: string;
  updatedAt: Date;
};
