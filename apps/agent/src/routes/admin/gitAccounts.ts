import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { db, gitAccounts, bots, botGitAccounts, botsUsingGitAccount, getTenantById, encryptSecret, decryptSecret, assertGitHostAllowed, eq } from "@pachiware/db";
import { and, desc, ne } from "drizzle-orm";
import { object, string } from "../validation.js";
import { fetchGitUsername, isDefaultGitHost, findOAuthApp, buildAuthorizeUrl, getGitToken, browseRepos, browseMembers, browseIssues, browseMergeRequests, browseBranches, GIT_PROVIDERS, type GitConn, type GitProvider, type GitState } from "@pachiware/skills";
import { redirectUri } from "./gitOAuthApps.js";

export const gitAccountAdminRoutes = new Hono();

const publicAccount = ({ tokenEncrypted, refreshTokenEncrypted, ...a }: any) => ({ ...a, hasToken: Boolean(tokenEncrypted) });

function baseUrlOf(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  const url = string(value, "baseUrl")!;
  if (!/^https:\/\//i.test(url)) throw new HTTPException(400, { message: "baseUrl must start with https://" });
  const clean = url.replace(/\/+$/, "");
  if (isDefaultGitHost(clean)) return null;
  try { assertGitHostAllowed(clean); } catch (e) { throw new HTTPException(400, { message: (e as Error).message }); }
  return clean;
}
async function verify(provider: GitProvider, baseUrl: string | null, token: string) {
  try { return await fetchGitUsername(provider, baseUrl, token); }
  catch (e) { throw new HTTPException(400, { message: `Could not verify the token with ${provider}: ${(e as Error).message}` }); }
}

gitAccountAdminRoutes.get("/tenants/:id/git-accounts", async (c) => {
  if (!await getTenantById(c.req.param("id"))) return c.json({ error: "Tenant not found" }, 404);
  const rows = await db.select().from(gitAccounts).where(eq(gitAccounts.tenantId, c.req.param("id"))).orderBy(desc(gitAccounts.createdAt)).limit(200);
  const used = await db.select({ id: bots.id, name: bots.name, gitAccountId: botGitAccounts.gitAccountId }).from(botGitAccounts).innerJoin(bots, eq(bots.id, botGitAccounts.botId))
    .where(and(eq(botGitAccounts.tenantId, c.req.param("id")), ne(bots.connectionStatus, "deleted")));
  return c.json({ success: true, gitAccounts: rows.map((r: any) => ({ ...publicAccount(r), bots: used.filter((b: any) => b.gitAccountId === r.id).map((b: any) => ({ id: b.id, name: b.name })) })) });
});
gitAccountAdminRoutes.post("/tenants/:id/git-accounts", async (c) => {
  if (!await getTenantById(c.req.param("id"))) return c.json({ error: "Tenant not found" }, 404);
  const body = object(await c.req.json(), "body");
  const provider = string(body.provider, "provider") as GitProvider;
  if (!GIT_PROVIDERS.includes(provider)) throw new HTTPException(400, { message: "provider must be github or gitlab" });
  const baseUrl = baseUrlOf(body.baseUrl), token = string(body.token, "token")!;
  const username = await verify(provider, baseUrl, token);
  try {
    const [row] = await db.insert(gitAccounts).values({ tenantId: c.req.param("id"), name: string(body.name, "name")!, provider, baseUrl, username, tokenEncrypted: encryptSecret(token) }).returning();
    return c.json({ success: true, gitAccount: publicAccount(row) }, 201);
  } catch { return c.json({ error: "A git account with this name already exists" }, 409); }
});
gitAccountAdminRoutes.post("/tenants/:id/git-accounts/oauth/start", async (c) => {
  const id = c.req.param("id");
  if (!await getTenantById(id)) return c.json({ error: "Tenant not found" }, 404);
  const body = object(await c.req.json(), "body");
  const provider = string(body.provider, "provider") as GitProvider;
  if (!GIT_PROVIDERS.includes(provider)) throw new HTTPException(400, { message: "provider must be github or gitlab" });
  const baseUrl = baseUrlOf(body.baseUrl);
  const app = await findOAuthApp(provider, baseUrl);
  if (!app) return c.json({ error: `No OAuth app is set up for ${baseUrl ?? provider}. Add one in Settings > Git first.` }, 404);
  return c.json({ success: true, authorizeUrl: buildAuthorizeUrl(app, { tenantId: id, provider, baseUrl }, redirectUri()) });
});
gitAccountAdminRoutes.patch("/git-accounts/:accountId", async (c) => {
  const [current] = await db.select().from(gitAccounts).where(eq(gitAccounts.id, c.req.param("accountId")!)).limit(1);
  if (!current) return c.json({ error: "Git account not found" }, 404);
  const body = object(await c.req.json(), "body");
  // Provider is fixed: switching GitHub <-> GitLab is a different account, not an edit.
  if (body.provider !== undefined && body.provider !== current.provider) throw new HTTPException(400, { message: "provider cannot be changed; create a new account" });
  const values: Record<string, any> = {};
  if (body.name !== undefined) values.name = string(body.name, "name");
  const baseUrl = body.baseUrl !== undefined ? baseUrlOf(body.baseUrl) : current.baseUrl;
  const token = typeof body.token === "string" && body.token.trim() && !body.token.includes("••••") ? body.token.trim() : null;
  // The saved token must never be sent to a host it was not issued for.
  if (baseUrl !== current.baseUrl && !token) throw new HTTPException(400, { message: "Changing the host requires entering the access token again" });
  if (body.baseUrl !== undefined) values.baseUrl = baseUrl;
  if (token) {
    values.username = await verify(current.provider as GitProvider, baseUrl, token);
    values.tokenEncrypted = encryptSecret(token);
    Object.assign(values, { authType: "token", refreshTokenEncrypted: null, tokenExpiresAt: null });
  }
  try {
    const [row] = await db.update(gitAccounts).set({ ...values, updatedAt: new Date() }).where(eq(gitAccounts.id, current.id)).returning();
    return c.json({ success: true, gitAccount: publicAccount(row) });
  } catch { return c.json({ error: "A git account with this name already exists" }, 409); }
});
gitAccountAdminRoutes.delete("/git-accounts/:accountId", async (c) => {
  const id = c.req.param("accountId")!;
  const [acc] = await db.select({ tenantId: gitAccounts.tenantId }).from(gitAccounts).where(eq(gitAccounts.id, id)).limit(1);
  if (!acc) return c.json({ error: "Git account not found" }, 404);
  const using = await botsUsingGitAccount(acc.tenantId, id);
  if (using.length) return c.json({ error: "Git account is still used by bots; unbind them first", bots: using }, 409);
  const [row] = await db.delete(gitAccounts).where(eq(gitAccounts.id, id)).returning();
  return row ? c.json({ success: true }) : c.json({ error: "Git account not found" }, 404);
});

// Read-only browsing of an account's repositories, using the stored (and, for OAuth, refreshed) token.
async function connOf(accountId: string): Promise<GitConn> {
  const [acc] = await db.select().from(gitAccounts).where(eq(gitAccounts.id, accountId)).limit(1);
  if (!acc) throw new HTTPException(404, { message: "Git account not found" });
  try { assertGitHostAllowed(acc.baseUrl); } catch (e) { throw new HTTPException(400, { message: (e as Error).message }); }
  return { provider: acc.provider as GitProvider, baseUrl: acc.baseUrl, token: await getGitToken(acc), oauth: acc.authType === "oauth" };
}
const browse = (run: (g: GitConn, q: (k: string) => string | undefined) => Promise<unknown>) => async (c: any) => {
  try { return c.json({ success: true, ...(await run(await connOf(c.req.param("accountId")), (k) => c.req.query(k))) as object }); }
  catch (e) { if (e instanceof HTTPException) throw e; return c.json({ error: (e as Error).message }, 502); }
};
const STATES = ["open", "closed", "all"];
gitAccountAdminRoutes.get("/git-accounts/:accountId/repos", browse((g, q) => browseRepos(g, Number(q("page")), q("q"))));
gitAccountAdminRoutes.get("/git-accounts/:accountId/repo/:tab", async (c, next) => {
  const tab = c.req.param("tab"), repo = c.req.query("repo") ?? "", page = Number(c.req.query("page")), state = (c.req.query("state") ?? "open") as GitState;
  if (!STATES.includes(state)) throw new HTTPException(400, { message: "state must be open, closed or all" });
  const runs: Record<string, (g: GitConn) => Promise<unknown>> = {
    members: (g) => browseMembers(g, repo, page), issues: (g) => browseIssues(g, repo, page, state),
    "merge-requests": (g) => browseMergeRequests(g, repo, page, state), branches: (g) => browseBranches(g, repo, page),
  };
  if (!runs[tab]) return c.json({ error: "Unknown tab" }, 404);
  return browse((g) => runs[tab]!(g))(c);
});
