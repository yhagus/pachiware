import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { repositories, encryptSecret, assertGitHostAllowed } from "@pachiware/db";
import { object, string } from "../validation.js";
import { GIT_PROVIDERS, isDefaultGitHost, type GitProvider } from "@pachiware/skills";

export const gitOAuthAppAdminRoutes = new Hono();

export const redirectUri = () => `${(process.env.PUBLIC_URL || "http://localhost:3001").replace(/\/+$/, "")}/api/oauth/git/callback`;
const publicApp = ({ clientSecretEncrypted, ...a }: any) => ({ ...a, hasSecret: Boolean(clientSecretEncrypted) });

function host(value: unknown): string {
  if (value === undefined || value === null || value === "") return "";
  const url = string(value, "baseUrl")!.replace(/\/+$/, "");
  if (!/^https:\/\//i.test(url)) throw new HTTPException(400, { message: "baseUrl must start with https://" });
  if (isDefaultGitHost(url)) return "";
  try { assertGitHostAllowed(url); } catch (e) { throw new HTTPException(400, { message: (e as Error).message }); }
  return url;
}

gitOAuthAppAdminRoutes.get("/git-oauth-apps", async (c) => {
  const rows = await repositories().git.listOAuthApps();
  return c.json({ success: true, redirectUri: redirectUri(), apps: rows.map(publicApp) });
});
gitOAuthAppAdminRoutes.post("/git-oauth-apps", async (c) => {
  const body = object(await c.req.json(), "body");
  const provider = string(body.provider, "provider") as GitProvider;
  if (!GIT_PROVIDERS.includes(provider)) throw new HTTPException(400, { message: "provider must be github or gitlab" });
  const values = { provider, baseUrl: host(body.baseUrl), clientId: string(body.clientId, "clientId")!, clientSecretEncrypted: encryptSecret(string(body.clientSecret, "clientSecret")!) };
  try { return c.json({ success: true, app: publicApp(await repositories().git.createOAuthApp(values)) }, 201); }
  catch { return c.json({ error: "An OAuth app for this host already exists" }, 409); }
});
gitOAuthAppAdminRoutes.delete("/git-oauth-apps/:id", async (c) => {
  return await repositories().git.deleteOAuthApp(c.req.param("id")!) ? c.json({ success: true }) : c.json({ error: "OAuth app not found" }, 404);
});
