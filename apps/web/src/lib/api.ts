const BASE_URL = import.meta.env.VITE_API_URL || "";

export function getPlatformKey(): string { return sessionStorage.getItem("pachiware.platformKey") || ""; }
export function setPlatformKey(key: string) {
  sessionStorage.setItem("pachiware.platformKey", key.trim());
  window.dispatchEvent(new Event("pachiware:credentials"));
}
export function clearPlatformKey() { setPlatformKey(""); }

/** On localhost the Vite dev plugin hands out the platform key automatically. */
export async function connectLocalConsole(): Promise<void> {
  if (getPlatformKey() || !["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname)) return;
  try {
    for (let attempt = 0; attempt < 10; attempt++) {
      const response = await fetch("/api/console/session", { credentials: "same-origin", cache: "no-store" });
      if (response.status === 503) { await new Promise((r) => setTimeout(r, 500)); continue; }
      if (!response.ok) return;
      const session = await response.json();
      if (typeof session.platformKey === "string") setPlatformKey(session.platformKey);
      return;
    }
  } catch {
    // Manual key entry remains available.
  }
}

async function fetchJSON<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const headers = new Headers(options?.headers);
  headers.set("Content-Type", "application/json");
  if (endpoint.startsWith("/api/admin/")) headers.set("X-Platform-Key", getPlatformKey());
  const response = await fetch(`${BASE_URL}${endpoint}`, { ...options, headers });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || data.message || `HTTP ${response.status}`);
  }
  return response.json();
}
const json = (method: string, body?: unknown): RequestInit => ({ method, body: body === undefined ? undefined : JSON.stringify(body) });

export interface HealthResponse {
  status: string;
  setupRequired?: boolean;
  hasTenants?: boolean;
  hasEncryptionKey?: boolean;
  uptimeSeconds: number;
  memory?: { rss: number; heapUsed: number };
  services: {
    database: string;
    databaseEngine?: string;
    redis: string;
    discord: { connected: boolean; botTag: string | null; botId: string; tenantId: string; guildCount: number }[];
  };
}
export interface Stats {
  tenants: number; bots: number;
  storage: { dbBytes: number | null; cacheBytes: number | null };
  system: {
    cpu: { percent: number; cores: number };
    memory: { used: number; total: number };
    disk: { used: number; total: number };
    diskIo: { readBps: number; writeBps: number } | null;
  };
}
export interface InfrastructureData {
  /** The engine is fixed at setup; the host never carries credentials and is null for SQLite. */
  databaseEngine: string; databaseHost: string | null; redisUrl: string; rawRedisUrl?: string; isFromRuntimeStore?: boolean; updatedAt?: string;
}
export interface ApiKey { id: string; name: string; keyPrefix: string; tenantCount: number; lastUsedAt: string | null; revokedAt: string | null; createdAt: string; }
export interface Tenant { id: string; name: string; slug: string; status: string; apiKeyId: string | null; createdAt?: string; }
export interface Bot { id: string; tenantId: string; name: string; platform: string; clientId: string | null; guildIds: string[]; profileId: string | null; gitAccountIds: string[]; planeAccountIds: string[]; isEnabled: boolean; hasToken: boolean; connectionStatus: string; lastError: string | null; lastConnectedAt: string | null; }
export interface GuildChannel { id: string; name: string; type: "text" | "voice" | "announcement" | "stage" | "forum"; category: string | null; }
export interface Guild { id: string; name: string; icon: string | null; memberCount: number; allowed: boolean; channels: GuildChannel[]; }
export type Language = "id" | "en";
export const LANGUAGES: { id: Language; name: string }[] = [{ id: "id", name: "Indonesian" }, { id: "en", name: "English" }];
/** The tenant's defaults; a guild overrides them with its own, null meaning "the tenant's". */
export interface TenantSettings { timezone: string; language: Language; conversationIdleHours: number; }
/** A channel opted in to the daily Digest and the hour (0 to 23, in the server's zone) it posts at. */
export interface DigestChannel { channelId: string; hour: number; }
/** A channel this bot writes a Daily log of every night; `backfill` asks for the last 30 days when it is turned on. */
export interface DailyLogChannel { channelId: string; backfill: boolean; }
/** A repository whose matching text files (`paths` such as README.md or docs/**) the bot mirrors into a channel's files; `account` names the git account, else any the channel allows. */
export interface DocSource { channelId: string; repo: string; account?: string; paths: string[]; }
export interface GuildConfig { systemPrompt: string; useThreads: boolean; alwaysChannelIds: string[]; timezone: string | null; language: Language | null; digestChannels: DigestChannel[]; dailyLogChannels: DailyLogChannel[]; docSources: DocSource[]; }
export interface GitRule { gitAccountId: string; repoPatterns: string[]; }
export interface GuildGit { accounts: { id: string; name: string; provider: "github" | "gitlab"; username: string }[]; server: GitRule[]; channels: Record<string, GitRule[]>; }
/** A Plane scope rule for one Plane workspace of an account: Plane project ids, or ["*"] for every Plane project in it. */
export interface PlaneRule { planeAccountId: string; workspaceSlug: string; projectIds: string[]; }
/** A Plane workspace an account lists by slug; integrations may use it only while it is switched on. */
export interface PlaneWorkspace { slug: string; enabled: boolean; }
export interface GuildPlane { accounts: { id: string; name: string; baseUrl: string | null; workspaces: PlaneWorkspace[]; planeUserName: string }[]; guild: PlaneRule[]; channels: Record<string, PlaneRule[]>; }
export const ALL_PLANE_PROJECTS = "*";
/**
 * The key is never returned: `hasApiKey` says one is saved. `planeUserName` is the Plane user the key acts as; `planeVersion` a
 * PlaneVersion id. `planeServerVersion` is the release the Plane server reported at the last save, and `versionNote` a warning
 * when it is outside `planeVersion`.
 */
export interface PlaneAccount { id: string; tenantId: string; name: string; baseUrl: string | null; workspaces: PlaneWorkspace[]; planeUserId: string; planeUserName: string; planeVersion: string; planeServerVersion: string | null; versionNote: string | null; hasApiKey: boolean; bots: { id: string; name: string }[]; createdAt: string; }
export interface PlaneAccountInput { name?: string; baseUrl?: string | null; workspaces?: PlaneWorkspace[]; apiKey?: string; planeVersion?: string; }
/** A Plane release line the server has tool code for, oldest first. */
export interface PlaneVersion { id: string; label: string; checkedAgainst: string; auth: "api-key"; }
/** One step of a Plane account's Test, in the same statuses as a profile's. */
export interface PlaneCheck { status: CheckStatus; message: string; }
/** A listed Plane workspace's Test step; `projectCount` is set when Plane opened it. */
export interface PlaneWorkspaceCheck extends PlaneCheck { slug: string; enabled: boolean; projectCount?: number; }
export interface PlaneChecks { url: PlaneCheck; version: PlaneCheck; key: PlaneCheck; workspaces: PlaneWorkspaceCheck[]; }
/** The release a Plane server reports, and the PlaneVersion id covering it (null when none does). */
export interface PlaneServer { release: string; suggested: string | null; }
export interface PlaneProject { id: string; name: string; identifier: string; }
export interface Conversation { id: string; channelId: string | null; userId: string | null; createdAt: string; lastMessageAt: string | null; messageCount: number; endedAt: string | null; }
export interface ChatMessage { id: string; role: "user" | "assistant"; content: string; createdAt: string; }
/** A row of a Playground conversation as the server gave it back; the console sends every row so far with the next turn. */
export interface PlaygroundRow { role: string; content: string | null; toolCalls?: { id: string; name: string; arguments: Record<string, unknown> }[] | null; toolCallId?: string | null; }
/** One tool call of a Playground turn: its arguments and its result, clipped. */
export interface PlaygroundStep { id: string; tool: string; args: unknown; ok: boolean; result: string; }
export interface PlaygroundTurn { messages: string[]; reaction: string | null; steps: PlaygroundStep[]; history: PlaygroundRow[]; offered: string[]; ms: number; }
/** What a streamed Playground turn shows while it runs: a tool call as it starts, then its step once it answers. */
export type PlaygroundProgress = { type: "tool"; id: string; tool: string; args: unknown } | ({ type: "result" } & PlaygroundStep);

/**
 * One Playground turn, streamed: `onProgress` gets each tool call as it starts and as it answers, and the whole turn is returned.
 * The key goes in a header, so the stream is read with fetch rather than EventSource. Aborting stops the reading; the turn runs on.
 */
async function tryBot(id: string, data: { guildId: string; channelId: string; sessionId: string; message: string; history: PlaygroundRow[] }, onProgress: (p: PlaygroundProgress) => void, signal?: AbortSignal): Promise<PlaygroundTurn> {
  const response = await fetch(`${BASE_URL}/api/admin/bots/${id}/playground`, {
    method: "POST", body: JSON.stringify(data), signal,
    headers: { "Content-Type": "application/json", Accept: "text/event-stream", "X-Platform-Key": getPlatformKey() },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || body.message || `HTTP ${response.status}`);
  }
  const reader = response.body!.getReader(), decoder = new TextDecoder();
  let buffer = "";
  for (let read = await reader.read(); !read.done; read = await reader.read()) {
    buffer += decoder.decode(read.value, { stream: true });
    for (let at = buffer.indexOf("\n\n"); at >= 0; at = buffer.indexOf("\n\n")) {
      const block = buffer.slice(0, at);
      buffer = buffer.slice(at + 2);
      const event = /^event: (.+)$/m.exec(block)?.[1], raw = /^data: (.*)$/m.exec(block)?.[1];
      if (!event || raw === undefined) continue;
      const payload = JSON.parse(raw);
      if (event === "done") return payload;
      if (event === "failed") throw new Error(payload.error);
      onProgress(payload);
    }
  }
  throw new Error("The connection closed before the bot answered.");
}
export type ProfileProvider = "openai" | "anthropic" | "deepseek" | "custom";
export interface Profile { id: string; tenantId: string; name: string; provider: ProfileProvider; model: string; fallbackModels: string[]; baseUrl: string | null; hasApiKey: boolean; acceptsImages: boolean; apiFormat: ApiFormat; createdAt: string; }
export type ApiFormat = "chat_completions" | "responses" | "messages";
export interface ProfileInput { name?: string; provider?: ProfileProvider; model?: string; fallbackModels?: string[]; baseUrl?: string | null; apiKey?: string | null; acceptsImages?: boolean; apiFormat?: ApiFormat; }
export type CheckStatus = "ok" | "warning" | "failed" | "skipped";
export interface ProfileCheck { status: CheckStatus; message: string; reply?: string; }
export interface ProfileChecks { url: ProfileCheck; key: ProfileCheck; model: ProfileCheck; text: ProfileCheck; image: ProfileCheck; }
export type PlaygroundResult =
  | { success: true; reply: string; finishReason: string | null; usage: { input: number; output: number } | null; ms: number }
  | { success: false; status?: number; error: string; ms: number };
export interface GitAccount { id: string; tenantId: string; name: string; provider: "github" | "gitlab"; baseUrl: string | null; username: string; authType: "token" | "oauth"; hasToken: boolean; bots: { id: string; name: string }[]; createdAt: string; }
export interface GitRepoItem { repo: string; owner: string; private: boolean; archived: boolean; fork: boolean; description: string | null; updatedAt: string | null; url: string; defaultBranch: string | null; }
export interface GitPage<T> { items: T[]; hasMore: boolean; contributorsOnly?: boolean; }
export type GitTab = "members" | "issues" | "merge-requests" | "branches";
export interface GitOAuthApp { id: string; provider: "github" | "gitlab"; baseUrl: string; clientId: string; hasSecret: boolean; }
/** `readOnly` marks built-in playbook entries; `overridden` is set on a built-in playbook the tenant has its own copy of. */
export interface WorkspaceEntry { path: string; type: "file" | "dir"; size?: number; readOnly?: boolean; overridden?: boolean }
/** A playbook a server made in chat; `hidden` when a tenant or built-in playbook of its name replaces it. */
export interface ServerPlaybook { name: string; description: string; words: string[]; requires: string[]; start: boolean; createdBy?: { id: string; name: string }; createdAt?: string; hidden: boolean }
export type ToolEffect = "read" | "write" | "danger";
/** `group` is one of the skill's `groups`; `playbook` marks a tool that only serves that playbook. */
export interface SkillTool { name: string; description: string; effect: ToolEffect; group?: string; playbook?: string; defaultOff?: boolean; }
export interface TenantSkill { id: string; name: string; description: string; category: string; groups: string[]; tools: SkillTool[]; toolCount: number; isEnabled: boolean; }
export type AvailabilityKind = "playbook" | "skill" | "tool" | "effect";
export type AvailabilityValue = "off" | "opt_in" | "on";
export interface AvailabilityRule { kind: AvailabilityKind; name: string; value: AvailabilityValue; }
export type AvailabilityLevelName = "tenant" | "bot" | "guild" | "channel";
/** What the levels above leave a target: `off` is the highest level that turns it off, `optIn` the lowest that made it opt-in. Unlisted targets are available from above. */
export interface InheritedAvailability { kind: AvailabilityKind; name: string; available: boolean; off?: AvailabilityLevelName; optIn?: AvailabilityLevelName; }
/** Whether a playbook has a slash command in a server, and if not, why. */
export type SlashStatus = { playbook: string } & ({ status: "registered" } | { status: "not_registered"; reason: "reference" } | { status: "not_registered"; reason: "limit" } | { status: "not_registered"; reason: "off"; level: AvailabilityLevelName } | { status: "name_unusable" });
/** `slash` comes with a server's view only: commands are registered per server. `guildPlaybooks`, with a server's or a channel's view: the playbooks that server made. */
export interface LevelAvailability { rules: AvailabilityRule[]; inherited: InheritedAvailability[]; slash?: SlashStatus[]; guildPlaybooks?: ServerPlaybook[]; }
/** Why a playbook cannot start for the tenant, as the agent resolved it when the list loaded. */
export type PlaybookCause = { off: "playbook" } | { off: "loads"; playbook: string } | { off: "chain"; problem: string } | { off: "skills"; skills: string[] };
/**
 * `defaultOff`: the playbook is off for the tenant until a tenant rule says on.
 * `loads` are the playbooks it names, `chain` every playbook a start brings in; `start` is false for a reference only other playbooks load.
 */
export interface PlaybookSummary { name: string; description: string; category: string; requires: string[]; defaultOff: boolean; loads: string[]; chain: string[]; start: boolean; cause: PlaybookCause | null; }
/** One level of availability rules: the tenant, a bot, a guild of that bot, or a channel of that guild. */
export type AvailabilityLevel = { tenantId: string } | { botId: string; guildId?: string; channelId?: string };
const availabilityPath = (l: AvailabilityLevel) => "tenantId" in l
  ? `/api/admin/tenants/${l.tenantId}/availability`
  : `/api/admin/bots/${l.botId}${l.guildId ? `/guilds/${l.guildId}` : ""}${l.guildId && l.channelId ? `/channels/${l.channelId}` : ""}/availability`;
/**
 * An active Reminder or Routine of a bot, set from chat: a Reminder posts `text`, a Routine runs it as an instruction and posts what it found.
 * `weekdays` (0 = Sunday) and `dayOfMonth` belong to weekly and monthly repeats; times are ISO instants, `timeOfDay` is wall time in `timezone`.
 * `error` says why the last post or run failed.
 */
export interface Reminder {
  id: string; kind: "reminder" | "routine"; ownerId: string | null; ownerName: string | null; guildId: string | null; channelId: string; text: string; withTasks: boolean; mentions: string[];
  recurrence: "once" | "daily" | "weekly" | "monthly"; weekdays: number[]; dayOfMonth: number | null; timeOfDay: string | null; timezone: string; until: string | null; nextAt: string; lastFiredAt: string | null; error: string | null; createdAt: string;
}
/**
 * An API preview: an OpenAPI document a bot published from chat, as it was then, at a public `url` anyone with the link can open until
 * it is revoked here. `guildId` is null for one published in a DM; `channelId` is the channel it was asked in (a thread's parent).
 */
export interface ApiPreview {
  id: string; url: string; botId: string; botName: string | null; guildId: string | null; channelId: string; sourcePath: string; title: string; version: string | null;
  createdById: string | null; createdByName: string | null; createdAt: string;
}
export interface GitAccountInput { name?: string; provider?: string; baseUrl?: string | null; token?: string; }
export interface BotInput { profileId?: string | null; gitAccountIds?: string[]; planeAccountIds?: string[]; name?: string; platform?: string; token?: string; clientId?: string; guildIds?: string[]; isEnabled?: boolean; }

export const api = {
  getHealth: () => fetchJSON<HealthResponse>("/api/health"),
  getStats: () => fetchJSON<Stats>("/api/admin/stats"),
  getInfrastructure: () => fetchJSON<{ infrastructure: InfrastructureData }>("/api/admin/infrastructure"),
  getAllowedHosts: () => fetchJSON<{ hosts: string[] }>("/api/admin/infrastructure/allowed-hosts"),
  saveAllowedHosts: (hosts: string[]) => fetchJSON<{ hosts: string[] }>("/api/admin/infrastructure/allowed-hosts", json("PUT", { hosts })),

  listTenants: () => fetchJSON<{ tenants: Tenant[] }>("/api/admin/tenants"),
  getTenant: (id: string) => fetchJSON<{ tenant: Tenant }>(`/api/admin/tenants/${id}`),
  createTenant: (name: string, slug?: string, apiKeyId?: string) => fetchJSON<{ tenant: Tenant }>("/api/admin/tenants", json("POST", { name, slug: slug || undefined, apiKeyId: apiKeyId || undefined })),
  updateTenant: (id: string, data: { name?: string; status?: "active" | "suspended" }) => fetchJSON<{ tenant: Tenant }>(`/api/admin/tenants/${id}`, json("PATCH", data)),
  getTenantSettings: (id: string) => fetchJSON<{ settings: TenantSettings }>(`/api/admin/tenants/${id}/settings`),
  saveTenantSettings: (id: string, data: Partial<TenantSettings>) => fetchJSON<{ settings: TenantSettings }>(`/api/admin/tenants/${id}/settings`, json("PUT", data)),

  listApiKeys: () => fetchJSON<{ apiKeys: ApiKey[] }>("/api/admin/api-keys"),
  createApiKey: (name: string) => fetchJSON<{ raw: string; keyId: string }>("/api/admin/api-keys", json("POST", { name })),
  revokeApiKey: (id: string) => fetchJSON<{ success: boolean }>(`/api/admin/api-keys/${id}`, json("DELETE")),
  listBots: (tenantId: string, p: { page: number; pageSize: number; q?: string; platform?: string }) =>
    fetchJSON<{ bots: Bot[]; total: number; page: number; pageSize: number }>(`/api/admin/tenants/${tenantId}/bots?${new URLSearchParams({ page: String(p.page), pageSize: String(p.pageSize), ...(p.q ? { q: p.q } : {}), ...(p.platform ? { platform: p.platform } : {}) })}`),
  createBot: (tenantId: string, data: BotInput) => fetchJSON<{ bot: Bot }>(`/api/admin/tenants/${tenantId}/bots`, json("POST", data)),
  listProfiles: (tenantId: string) => fetchJSON<{ profiles: Profile[] }>(`/api/admin/tenants/${tenantId}/profiles`),
  createProfile: (tenantId: string, data: ProfileInput) => fetchJSON<{ profile: Profile }>(`/api/admin/tenants/${tenantId}/profiles`, json("POST", data)),
  listProfileModels: (data: { provider: string; apiFormat?: ApiFormat; baseUrl?: string; apiKey?: string; profileId?: string }) => fetchJSON<{ models: string[] }>("/api/admin/profiles/models", json("POST", data)),
  testProfile: (data: { provider: string; apiFormat?: ApiFormat; model: string; baseUrl?: string; apiKey?: string; profileId?: string }) => fetchJSON<{ success: boolean; checks: ProfileChecks }>("/api/admin/profiles/test", json("POST", data)),
  tryProfile: (data: { provider: string; apiFormat?: ApiFormat; model: string; baseUrl?: string; profileId: string; system?: string; prompt: string }) => fetchJSON<PlaygroundResult>("/api/admin/profiles/playground", json("POST", data)),
  updateProfile: (id: string, data: ProfileInput) => fetchJSON<{ profile: Profile }>(`/api/admin/profiles/${id}`, json("PATCH", data)),
  workspaceTree: (tenantId: string, path = "") => fetchJSON<{ entries: WorkspaceEntry[] }>(`/api/admin/tenants/${tenantId}/workspace/tree?path=${encodeURIComponent(path)}`),
  workspaceRead: (tenantId: string, path: string) => fetchJSON<{ content: string; version: string; readOnly?: boolean }>(`/api/admin/tenants/${tenantId}/workspace/file?path=${encodeURIComponent(path)}`),
  workspaceWrite: (tenantId: string, path: string, content: string, version?: string) => fetchJSON<{ version: string; warning?: string }>(`/api/admin/tenants/${tenantId}/workspace/file`, json("PUT", { path, content, version })),
  workspaceMove: (tenantId: string, from: string, to: string) => fetchJSON<{ success: boolean; warning?: string }>(`/api/admin/tenants/${tenantId}/workspace/move`, json("POST", { from, to })),
  workspaceDelete: (tenantId: string, path: string) => fetchJSON<{ success: boolean }>(`/api/admin/tenants/${tenantId}/workspace/file?path=${encodeURIComponent(path)}`, json("DELETE")),
  copyPlaybook: (tenantId: string, name: string) => fetchJSON<{ path: string }>(`/api/admin/tenants/${tenantId}/workspace/playbooks/${encodeURIComponent(name)}/override`, json("POST")),
  deletePlaybook: (tenantId: string, name: string) => fetchJSON<{ success: boolean }>(`/api/admin/tenants/${tenantId}/workspace/playbooks/${encodeURIComponent(name)}`, json("DELETE")),
  serverPlaybooks: (tenantId: string, guildId: string) => fetchJSON<{ playbooks: ServerPlaybook[] }>(`/api/admin/tenants/${tenantId}/workspace/guilds/${encodeURIComponent(guildId)}/playbooks`),
  deleteServerPlaybook: (tenantId: string, guildId: string, name: string) => fetchJSON<{ success: boolean }>(`/api/admin/tenants/${tenantId}/workspace/guilds/${encodeURIComponent(guildId)}/playbooks/${encodeURIComponent(name)}`, json("DELETE")),
  listSkills: (tenantId: string) => fetchJSON<{ skills: TenantSkill[]; playbooks: PlaybookSummary[]; categories: string[] }>(`/api/admin/tenants/${tenantId}/skills`),
  setSkillEnabled: (tenantId: string, skillId: string, isEnabled: boolean) => fetchJSON<{ isEnabled: boolean }>(`/api/admin/tenants/${tenantId}/skills/${skillId}`, json("PATCH", { isEnabled })),
  listAvailability: (level: AvailabilityLevel) => fetchJSON<LevelAvailability>(availabilityPath(level)),
  setAvailability: (level: AvailabilityLevel, rule: AvailabilityRule) => fetchJSON<LevelAvailability>(availabilityPath(level), json("PUT", rule)),
  clearAvailability: (level: AvailabilityLevel, kind: AvailabilityKind, name: string) => fetchJSON<LevelAvailability>(`${availabilityPath(level)}?${new URLSearchParams({ kind, name })}`, json("DELETE")),
  listGitAccounts: (tenantId: string) => fetchJSON<{ gitAccounts: GitAccount[] }>(`/api/admin/tenants/${tenantId}/git-accounts`),
  createGitAccount: (tenantId: string, data: GitAccountInput) => fetchJSON<{ gitAccount: GitAccount }>(`/api/admin/tenants/${tenantId}/git-accounts`, json("POST", data)),
  updateGitAccount: (id: string, data: GitAccountInput) => fetchJSON<{ gitAccount: GitAccount }>(`/api/admin/git-accounts/${id}`, json("PATCH", data)),
  listGitRepos: (accountId: string, page: number, q = "") => fetchJSON<GitPage<GitRepoItem>>(`/api/admin/git-accounts/${accountId}/repos?page=${page}${q ? `&q=${encodeURIComponent(q)}` : ""}`),
  getGitRepoTab: (accountId: string, tab: GitTab, repo: string, page: number, state: string) => fetchJSON<GitPage<any>>(`/api/admin/git-accounts/${accountId}/repo/${tab}?repo=${encodeURIComponent(repo)}&page=${page}&state=${state}`),
  startGitOAuth: (tenantId: string, data: { provider: string; baseUrl?: string | null }) => fetchJSON<{ authorizeUrl: string }>(`/api/admin/tenants/${tenantId}/git-accounts/oauth/start`, json("POST", data)),
  listGitOAuthApps: () => fetchJSON<{ redirectUri: string; apps: GitOAuthApp[] }>("/api/admin/git-oauth-apps"),
  createGitOAuthApp: (data: { provider: string; baseUrl?: string; clientId: string; clientSecret: string }) => fetchJSON<{ app: GitOAuthApp }>("/api/admin/git-oauth-apps", json("POST", data)),
  deleteGitOAuthApp: (id: string) => fetchJSON<{ success: boolean }>(`/api/admin/git-oauth-apps/${id}`, json("DELETE")),
  deleteGitAccount: (id: string) => fetchJSON<{ success: boolean }>(`/api/admin/git-accounts/${id}`, json("DELETE")),
  listPlaneVersions: () => fetchJSON<{ planeVersions: PlaneVersion[] }>("/api/admin/plane-versions"),
  /** `baseUrl` empty means Plane's cloud; `server` is null when the release cannot be read. */
  readPlaneServer: (baseUrl: string) => fetchJSON<{ server: PlaneServer | null }>(`/api/admin/plane-versions?baseUrl=${encodeURIComponent(baseUrl)}`),
  listPlaneAccounts: (tenantId: string) => fetchJSON<{ planeAccounts: PlaneAccount[] }>(`/api/admin/tenants/${tenantId}/plane-accounts`),
  createPlaneAccount: (tenantId: string, data: PlaneAccountInput) => fetchJSON<{ planeAccount: PlaneAccount }>(`/api/admin/tenants/${tenantId}/plane-accounts`, json("POST", data)),
  updatePlaneAccount: (id: string, data: PlaneAccountInput) => fetchJSON<{ planeAccount: PlaneAccount }>(`/api/admin/plane-accounts/${id}`, json("PATCH", data)),
  deletePlaneAccount: (id: string) => fetchJSON<{ success: boolean }>(`/api/admin/plane-accounts/${id}`, json("DELETE")),
  /** Tries settings without saving them; with `accountId` and no `apiKey`, the saved key on its saved host only. */
  testPlaneAccount: (data: { baseUrl: string | null; apiKey?: string; accountId?: string; planeVersion?: string; workspaces: PlaneWorkspace[] }) => fetchJSON<{ success: boolean; checks: PlaneChecks }>("/api/admin/plane-accounts/test", json("POST", data)),
  listPlaneProjects: (accountId: string, workspace: string) => fetchJSON<{ projects: PlaneProject[] }>(`/api/admin/plane-accounts/${accountId}/projects?workspace=${encodeURIComponent(workspace)}`),
  deleteProfile: (id: string) => fetchJSON<{ success: boolean }>(`/api/admin/profiles/${id}`, json("DELETE")),
  getBot: (id: string) => fetchJSON<{ bot: Bot }>(`/api/admin/bots/${id}`),
  getBotGuilds: (id: string) => fetchJSON<{ connected: boolean; guilds: Guild[] }>(`/api/admin/bots/${id}/guilds`),
  getGuildConfig: (id: string, guildId: string) => fetchJSON<{ config: GuildConfig }>(`/api/admin/bots/${id}/guilds/${guildId}/config`),
  saveGuildConfig: (id: string, guildId: string, data: Partial<GuildConfig>) => fetchJSON<{ config: GuildConfig }>(`/api/admin/bots/${id}/guilds/${guildId}/config`, json("PUT", data)),
  getGuildGit: (id: string, guildId: string) => fetchJSON<GuildGit>(`/api/admin/bots/${id}/guilds/${guildId}/git`),
  saveGuildGit: (id: string, guildId: string, rules: GitRule[], channelId = "") =>
    fetchJSON<{ server: GitRule[]; rules: GitRule[] }>(`/api/admin/bots/${id}/guilds/${guildId}${channelId ? `/channels/${channelId}` : ""}/git`, json("PUT", { rules })),
  getGuildPlane: (id: string, guildId: string) => fetchJSON<GuildPlane>(`/api/admin/bots/${id}/guilds/${guildId}/plane`),
  saveGuildPlane: (id: string, guildId: string, rules: PlaneRule[], channelId = "") =>
    fetchJSON<{ guild: PlaneRule[]; rules: PlaneRule[] }>(`/api/admin/bots/${id}/guilds/${guildId}${channelId ? `/channels/${channelId}` : ""}/plane`, json("PUT", { rules })),
  listApiPreviews: (tenantId: string, botId?: string) => fetchJSON<{ previews: ApiPreview[] }>(`/api/admin/tenants/${tenantId}/api-previews${botId ? `?botId=${encodeURIComponent(botId)}` : ""}`),
  revokeApiPreview: (tenantId: string, previewId: string) => fetchJSON<{ success: true }>(`/api/admin/tenants/${tenantId}/api-previews/${previewId}`, json("DELETE")),
  listReminders: (id: string) => fetchJSON<{ reminders: Reminder[] }>(`/api/admin/bots/${id}/reminders`),
  cancelReminder: (id: string, reminderId: string) => fetchJSON<{ reminder: Reminder }>(`/api/admin/bots/${id}/reminders/${reminderId}`, json("DELETE")),
  listBotConversations: (id: string, channelId: string) => fetchJSON<{ conversations: Conversation[] }>(`/api/admin/bots/${id}/conversations?channelId=${encodeURIComponent(channelId)}`),
  getBotConversationMessages: (id: string, conversationId: string) => fetchJSON<{ messages: ChatMessage[] }>(`/api/admin/bots/${id}/conversations/${conversationId}/messages`),
  endBotConversation: (id: string, conversationId: string) => fetchJSON<{ endedAt: string }>(`/api/admin/bots/${id}/conversations/${conversationId}/end`, json("POST")),
  /** One Playground turn: read tools only, nothing posted to Discord, nothing stored; `history` is every row earlier turns gave back. */
  tryBot,
  updateBot: (id: string, data: BotInput) => fetchJSON<{ bot: Bot }>(`/api/admin/bots/${id}`, json("PATCH", data)),
  restartBot: (id: string) => fetchJSON<{ success: boolean; message?: string; error?: string }>(`/api/admin/bots/${id}/restart`, json("POST")),
  deleteBot: (id: string) => fetchJSON<{ success: boolean }>(`/api/admin/bots/${id}`, json("DELETE")),
};
