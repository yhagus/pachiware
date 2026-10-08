import { Hono } from "hono";
import { completeOAuth, takeState } from "@pachiware/skills";
import { redirectUri } from "./admin/gitOAuthApps.js";

// Browser redirect from the git provider: no admin key here, trust comes from the single-use state.
export const oauthRoutes = new Hono();

oauthRoutes.get("/git/callback", async (c) => {
  const state = c.req.query("state") ?? "", code = c.req.query("code");
  const pending = takeState(state);
  if (!pending) return c.text("This login link is invalid or expired. Close this tab and try again from the console.", 400);
  const back = (q: string) => c.redirect(`${(process.env.CONSOLE_URL || "http://localhost:3000").replace(/\/+$/, "")}/tenants/${pending.tenantId}/git-accounts?${q}`);
  if (!code) return back(`git_error=${encodeURIComponent(c.req.query("error_description") || c.req.query("error") || "Authorization was cancelled")}`);
  try { return back(`git=${encodeURIComponent(await completeOAuth(pending, code, redirectUri()))}`); }
  catch (e) { return back(`git_error=${encodeURIComponent((e as Error).message)}`); }
});
