import type { Scenario } from "./discordScenario";

/** acme/api on GitHub with default branch "main": branches exist once created, files never exist before. */
export function stubDocsRepo(s: Scenario) {
  const api = "api.github.com/repos/acme/api", branches = new Set<string>(["main"]);
  s.http.on(`GET ${api}`, () => ({ full_name: "acme/api", default_branch: "main" }));
  s.http.on(`GET ${api}/branches/`, (req) => (branches.has(decodeURIComponent(req.url.split("/branches/")[1]!)) ? { name: "x" } : new Response("", { status: 404 })));
  s.http.on(`GET ${api}/git/ref/heads/main`, () => ({ object: { sha: "c0ffee" } }));
  s.http.on(`POST ${api}/git/refs`, (req) => { branches.add(req.body.ref.replace("refs/heads/", "")); return {}; });
  s.http.on(`GET ${api}/contents/`, () => new Response("", { status: 404 }));
  s.http.on(`PUT ${api}/contents/`, () => ({}));
  s.http.on(`POST ${api}/pulls`, () => ({ number: 7, html_url: "https://github.com/acme/api/pull/7" }));
}

/** Every request that changed something at the git provider, from request `from` on. */
export const gitWrites = (s: Scenario, from = 0) => s.http.requests.slice(from).filter((r) => r.method !== "GET").map((r) => `${r.method} ${new URL(r.url).pathname}`);
