import { createHash, randomBytes } from "node:crypto";
import { db, gitAccounts, gitOauthApps, encryptSecret, decryptSecret, eq, and } from "@pachiware/db";
import { fetchGitUsername, type GitProvider } from "./git.js";

const SCOPES: Record<GitProvider, string> = { github: "repo", gitlab: "api" };
const web = (provider: GitProvider, baseUrl: string | null) => baseUrl?.replace(/\/+$/, "") ?? (provider === "github" ? "https://github.com" : "https://gitlab.com");
const tokenUrl = (provider: GitProvider, baseUrl: string | null) => web(provider, baseUrl) + (provider === "github" ? "/login/oauth/access_token" : "/oauth/token");

export async function findOAuthApp(provider: GitProvider, baseUrl: string | null) {
  const [app] = await db.select().from(gitOauthApps).where(and(eq(gitOauthApps.provider, provider), eq(gitOauthApps.baseUrl, baseUrl ?? ""))).limit(1);
  return app ?? null;
}

// ponytail: in-memory, single agent process; move to a table if the agent ever runs as several instances.
interface Pending { tenantId: string; provider: GitProvider; baseUrl: string | null; verifier: string; expires: number }
const pending = new Map<string, Pending>();
const b64url = (b: Buffer) => b.toString("base64url");

export function buildAuthorizeUrl(app: { clientId: string }, p: { tenantId: string; provider: GitProvider; baseUrl: string | null }, redirectUri: string): string {
  const now = Date.now();
  for (const [k, v] of pending) if (v.expires < now) pending.delete(k);
  const state = b64url(randomBytes(24)), verifier = b64url(randomBytes(32));
  pending.set(state, { ...p, verifier, expires: now + 10 * 60_000 });
  const q = new URLSearchParams({
    client_id: app.clientId, redirect_uri: redirectUri, state, scope: SCOPES[p.provider],
    code_challenge: b64url(createHash("sha256").update(verifier).digest()), code_challenge_method: "S256",
    ...(p.provider === "gitlab" ? { response_type: "code" } : {}),
  });
  return `${web(p.provider, p.baseUrl)}/${p.provider === "github" ? "login/oauth/authorize" : "oauth/authorize"}?${q}`;
}
/** Single-use: a state works once, within 10 minutes. */
export function takeState(state: string): Pending | null {
  const p = pending.get(state); pending.delete(state);
  return p && p.expires > Date.now() ? p : null;
}

interface Tokens { access: string; refresh: string | null; expiresAt: Date | null }
async function tokenRequest(provider: GitProvider, baseUrl: string | null, body: Record<string, string>): Promise<Tokens> {
  const res = await fetch(tokenUrl(provider, baseUrl), { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body: new URLSearchParams(body), signal: AbortSignal.timeout(10000) });
  const j: any = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) throw new Error(j.error_description || j.error || `Token endpoint returned ${res.status}`);
  return { access: j.access_token, refresh: j.refresh_token ?? null, expiresAt: j.expires_in ? new Date(Date.now() + j.expires_in * 1000) : null };
}

/** Exchanges the callback code and stores the account for the tenant. Returns the account name. */
export async function completeOAuth(p: Pending, code: string, redirectUri: string): Promise<string> {
  const app = await findOAuthApp(p.provider, p.baseUrl);
  if (!app) throw new Error("OAuth app was removed");
  const t = await tokenRequest(p.provider, p.baseUrl, { client_id: app.clientId, client_secret: decryptSecret(app.clientSecretEncrypted), code, redirect_uri: redirectUri, code_verifier: p.verifier, ...(p.provider === "gitlab" ? { grant_type: "authorization_code" } : {}) });
  const username = await fetchGitUsername(p.provider, p.baseUrl, t.access, true);
  const values = { tenantId: p.tenantId, provider: p.provider, baseUrl: p.baseUrl, username, authType: "oauth", tokenEncrypted: encryptSecret(t.access), refreshTokenEncrypted: t.refresh ? encryptSecret(t.refresh) : null, tokenExpiresAt: t.expiresAt };
  for (let i = 0; i < 20; i++) {
    const name = i === 0 ? username : `${username}-${i + 1}`;
    try { await db.insert(gitAccounts).values({ ...values, name }); return name; } catch { /* name taken in this tenant: try the next suffix */ }
  }
  throw new Error("Could not pick a unique account name");
}

/** Returns a usable access token, refreshing an expiring OAuth token first. */
export async function getGitToken(acc: any): Promise<string> {
  const token = decryptSecret(acc.tokenEncrypted);
  if (acc.authType !== "oauth" || !acc.tokenExpiresAt || new Date(acc.tokenExpiresAt).getTime() - Date.now() > 60_000) return token;
  if (!acc.refreshTokenEncrypted) throw new Error("Git login expired; reconnect the account");
  const app = await findOAuthApp(acc.provider, acc.baseUrl);
  if (!app) throw new Error("OAuth app for this git host was removed; reconnect the account");
  const t = await tokenRequest(acc.provider, acc.baseUrl, { client_id: app.clientId, client_secret: decryptSecret(app.clientSecretEncrypted), grant_type: "refresh_token", refresh_token: decryptSecret(acc.refreshTokenEncrypted) });
  await db.update(gitAccounts).set({ tokenEncrypted: encryptSecret(t.access), refreshTokenEncrypted: t.refresh ? encryptSecret(t.refresh) : acc.refreshTokenEncrypted, tokenExpiresAt: t.expiresAt, updatedAt: new Date() }).where(eq(gitAccounts.id, acc.id));
  return t.access;
}
