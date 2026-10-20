import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const w = process.cwd();

// Runs `body` against the admin API with a fresh SQLite database and Plane faked at fetch, in the shapes Plane v1.3.1 answers with.
function adminScenario(name: string, body: string) {
  test(name, () => {
    const dir = mkdtempSync(join(tmpdir(), "pachiware-plane-"));
    try {
      const r = Bun.spawnSync({
        cmd: ["bun", "--eval", `
          const assert = (c, m) => { if (!c) throw new Error(m); };
          const imp = (p) => import(${JSON.stringify(w + "/")} + p);
          await (await imp("packages/db/src/migrate.ts")).runMigrations();
          await (await imp("packages/db/src/seed.ts")).runSeed();
          const { repositories } = await imp("packages/db/src/index.ts");
          const app = (await imp("apps/agent/src/server.ts")).createServer();
          const admin = { "X-Platform-Key": "k", "Content-Type": "application/json" };
          const P1 = "11111111-1111-4111-8111-111111111111", P2 = "22222222-2222-4222-8222-222222222222";
          const seen = [];
          // The release each host reports at /api/instances/; a host left out answers 404, null is an instance not set up yet.
          const releases = {};
          const page = (results) => ({ grouped_by: null, sub_grouped_by: null, total_count: results.length, next_cursor: "100:1:0", prev_cursor: "100:-1:1", next_page_results: false, prev_page_results: false, count: results.length, total_pages: 1, total_results: results.length, extra_stats: null, results });
          globalThis.fetch = async (url, init = {}) => {
            const u = new URL(String(url)), key = new Headers(init.headers).get("x-api-key");
            seen.push({ url: String(url), redirect: init.redirect, key });
            if (u.pathname === "/api/instances/") {
              if (!(u.host in releases)) return Response.json({ detail: "Not found." }, { status: 404 });
              if (releases[u.host] === null) return Response.json({ is_activated: false, is_setup_done: false });
              return Response.json({ config: { posthog_api_key: "phc-secret", is_self_managed: true }, instance: { id: "i-1", instance_name: "Acme", current_version: releases[u.host], latest_version: "v1.4.0" } });
            }
            if (u.host === "moved.example") {
              if (init.redirect === "error") throw new TypeError("fetch failed: unexpected redirect");
              return new Response(null, { status: 301, headers: { Location: "https://elsewhere.example/" } });
            }
            // Plane v1.3.1 refuses a bad key with 403, not 401, and a wrong slug with 403 too.
            if (key !== "good-key") return Response.json({ detail: "Given API token is not valid" }, { status: 403 });
            if (u.pathname === "/api/v1/users/me/") return Response.json({ id: "u-bot", first_name: "Pachi", last_name: "Bot", email: "bot@acme.test", avatar: "", avatar_url: null, display_name: "pachibot" });
            if (u.pathname === "/api/v1/workspaces/acme/projects/") return Response.json(page([{ id: P1, name: "Engineering", identifier: "ENG" }, { id: P2, name: "Design", identifier: "DES" }]));
            return Response.json({ detail: "You do not have permission to perform this action." }, { status: 403 });
          };
          const bodies = [];
          const call = async (method, path, payload) => {
            const res = await app.request("/api/admin" + path, { method, headers: admin, ...(payload ? { body: JSON.stringify(payload) } : {}) });
            const text = await res.text();
            bodies.push(text);
            return { status: res.status, json: text ? JSON.parse(text) : null };
          };
          const tenant = async (slug) => (await call("POST", "/tenants", { name: slug, slug })).json.tenant;
          ${body}
          assert(bodies.length > 0 && bodies.every((b) => !b.includes("good-key")), "an API response returned the key");
          console.log("ok");
        `],
        cwd: w,
        env: { ...process.env, DATABASE_URL: `sqlite:${join(dir, "p.db")}`, PLATFORM_ENCRYPTION_KEY: Buffer.alloc(32, 5).toString("base64"), PLATFORM_ADMIN_KEY: "k", NODE_ENV: "test" },
      });
      expect(new TextDecoder().decode(r.stderr).trim()).toBe("");
      expect(new TextDecoder().decode(r.stdout).trim().split("\n").at(-1)).toBe("ok");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 30000);
}

adminScenario("saving a Plane account checks it with Plane, records its Plane user, and keeps the key encrypted and masked", `
  const a = await tenant("a");
  const created = await call("POST", "/tenants/" + a.id + "/plane-accounts", { name: "main", workspaceSlug: "acme", apiKey: "good-key" });
  assert(created.status === 201, "create failed: " + JSON.stringify(created.json));
  const acc = created.json.planeAccount;
  assert(acc.planeUserName.includes("pachibot") && acc.planeUserName.includes("bot@acme.test"), "Plane user not shown: " + acc.planeUserName);
  assert(acc.baseUrl === null && acc.workspaceSlug === "acme" && acc.hasApiKey === true && !("apiKeyEncrypted" in acc), "public shape wrong: " + JSON.stringify(acc));
  const cloud = seen.find((s) => s.url.startsWith("https://api.plane.so/api/v1/users/me/"));
  assert(cloud && cloud.redirect === "error", "users/me not called on Plane's cloud with redirect: error");
  assert(seen.some((s) => s.url.startsWith("https://api.plane.so/api/v1/workspaces/acme/projects/")), "projects not listed");
  const row = await repositories().plane.getAccount(acc.id);
  assert(row.apiKeyEncrypted && row.apiKeyEncrypted !== "good-key", "key not encrypted");
  const listed = await call("GET", "/tenants/" + a.id + "/plane-accounts");
  assert(listed.json.planeAccounts.length === 1 && listed.json.planeAccounts[0].planeUserName === acc.planeUserName, "list wrong");
  const projects = await call("GET", "/plane-accounts/" + acc.id + "/projects");
  assert(JSON.stringify(projects.json.projects) === JSON.stringify([{ id: P1, name: "Engineering", identifier: "ENG" }, { id: P2, name: "Design", identifier: "DES" }]), "projects wrong: " + JSON.stringify(projects.json));
  assert((await call("POST", "/tenants/" + a.id + "/plane-accounts", { name: "main", workspaceSlug: "acme", apiKey: "good-key" })).status === 409, "duplicate name accepted");
`);

adminScenario("a wrong key, a wrong slug, a redirect or a host outside Allowed hosts is refused with a message that says which", `
  const a = await tenant("a");
  const post = (b) => call("POST", "/tenants/" + a.id + "/plane-accounts", { name: "x", workspaceSlug: "acme", apiKey: "good-key", ...b });
  const refused = async (b, words, label) => { const r = await post(b); assert(r.status === 400 && words.test(r.json.error), label + ": " + r.status + " " + JSON.stringify(r.json)); };
  await refused({ apiKey: "bad-key" }, /API key/i, "wrong key");
  await refused({ workspaceSlug: "nope" }, /workspace.*nope/i, "wrong slug");
  await refused({ baseUrl: "https://moved.example" }, /redirect/i, "redirect");
  await refused({ baseUrl: "http://plane.lan" }, /https/i, "plain http on an unlisted host");
  await refused({ workspaceSlug: "" }, /workspaceSlug/i, "missing slug");
  assert((await call("PUT", "/infrastructure/allowed-hosts", { hosts: ["plane.corp.example", "plane.lan"] })).status === 200, "hosts not saved");
  await refused({ baseUrl: "https://evil.example" }, /Allowed hosts/i, "unlisted host");
  assert((await post({ name: "corp", baseUrl: "https://plane.corp.example/" })).status === 201, "listed host refused");
  assert((await post({ name: "lan", baseUrl: "http://plane.lan" })).status === 201, "http on a listed host refused");
  assert((await call("GET", "/infrastructure/git-hosts")).json.hosts.join() === "plane.corp.example,plane.lan", "the older path does not read the same list");
  assert(!seen.some((s) => s.url.includes("evil.example")), "an unlisted host was called");
  assert(seen.every((s) => s.redirect === "error"), "a request was sent without redirect: error");
`);

adminScenario("editing an account re-checks it, and a new host needs the key again", `
  const a = await tenant("a");
  await call("PUT", "/infrastructure/allowed-hosts", { hosts: ["plane.corp.example", "other.corp.example"] });
  const acc = (await call("POST", "/tenants/" + a.id + "/plane-accounts", { name: "main", baseUrl: "https://plane.corp.example", workspaceSlug: "acme", apiKey: "good-key" })).json.planeAccount;
  const patch = (b) => call("PATCH", "/plane-accounts/" + acc.id, b);
  assert((await patch({ name: "renamed" })).json.planeAccount.name === "renamed", "rename failed");
  assert((await patch({ workspaceSlug: "nope" })).status === 400, "a wrong slug was saved");
  assert((await patch({ baseUrl: "https://other.corp.example" })).status === 400, "host changed without the key");
  const moved = await patch({ baseUrl: "https://other.corp.example", apiKey: "good-key" });
  assert(moved.status === 200 && moved.json.planeAccount.baseUrl === "https://other.corp.example", "host change with key refused");
  assert((await patch({ apiKey: "bad-key" })).status === 400, "a wrong key was saved");
  assert((await patch({ apiKey: "••••••••" })).status === 200, "the mask was taken for a new key");
`);

adminScenario("Plane accounts attach to bots, are tenant-bound, cannot be deleted while used, and detaching removes their scopes", `
  const [a, b] = [await tenant("a"), await tenant("b")];
  const make = async (t, name) => (await call("POST", "/tenants/" + t.id + "/plane-accounts", { name, workspaceSlug: "acme", apiKey: "good-key" })).json.planeAccount;
  const [main, alt, foreign] = [await make(a, "main"), await make(a, "alt"), await make(b, "foreign")];
  const skill = async (t) => (await repositories().skills.getForTenant(t.id, "plane"))?.isEnabled;
  assert(await skill(a) === false, "plane skill on before any attach");
  const bot = (await call("POST", "/tenants/" + a.id + "/bots", { token: "t", isEnabled: false, name: "b1", planeAccountIds: [main.id, alt.id] })).json.bot;
  assert(bot.planeAccountIds.length === 2, "accounts not attached: " + JSON.stringify(bot));
  assert(await skill(a) === true && await skill(b) === false, "plane skill not switched on for the attaching tenant only");
  assert((await call("POST", "/tenants/" + a.id + "/bots", { token: "t", isEnabled: false, planeAccountIds: [foreign.id] })).status === 400, "cross-tenant account attached");
  assert((await call("DELETE", "/plane-accounts/" + main.id)).status === 409, "deleted while used");
  const put = (path, rules) => call("PUT", "/bots/" + bot.id + "/guilds/g1" + path + "/plane", { rules });
  assert((await put("", [{ planeAccountId: foreign.id, projectIds: ["*"] }])).status === 400, "unattached account scoped");
  assert((await put("/channels/c1", [{ planeAccountId: main.id, projectIds: [P1] }])).status === 400, "channel rule without a guild rule");
  assert((await put("", [{ planeAccountId: main.id, projectIds: [P1] }, { planeAccountId: alt.id, projectIds: ["*"] }])).status === 200, "guild rule refused");
  assert((await put("/channels/c1", [{ planeAccountId: main.id, projectIds: [P1] }])).status === 200, "narrower channel rule refused");
  const wider = await put("/channels/c2", [{ planeAccountId: main.id, projectIds: [P2] }]);
  assert(wider.status === 400 && /guild rule/.test(wider.json.error), "wider channel rule accepted");
  const got = (await call("GET", "/bots/" + bot.id + "/guilds/g1/plane")).json;
  assert(got.guild.length === 2 && got.channels.c1.length === 1 && got.accounts.length === 2, "scopes not listed: " + JSON.stringify(got));
  assert(got.accounts.every((x) => !("apiKeyEncrypted" in x)), "scope listing leaks the encrypted key");
  await call("PATCH", "/bots/" + bot.id, { planeAccountIds: [alt.id] });
  const after = (await call("GET", "/bots/" + bot.id + "/guilds/g1/plane")).json;
  assert(after.guild.map((r) => r.planeAccountId).join() === alt.id && !after.channels.c1, "detaching kept scopes: " + JSON.stringify(after));
  assert((await call("DELETE", "/plane-accounts/" + main.id)).status === 200, "delete after detaching failed");
`);

adminScenario("a Plane account is set to a Plane version from the list: the newest unless chosen, and a change is checked with Plane again", `
  const a = await tenant("a");
  const versions = await call("GET", "/plane-versions");
  assert(JSON.stringify(versions.json.planeVersions) === JSON.stringify([{ id: "1.3.1", label: "Plane 1.3.1", checkedAgainst: "v1.3.1", auth: "api-key" }]), "versions wrong: " + JSON.stringify(versions.json));
  const post = (b) => call("POST", "/tenants/" + a.id + "/plane-accounts", { name: "main", workspaceSlug: "acme", apiKey: "good-key", ...b });
  const unknown = await post({ planeVersion: "0.9" });
  assert(unknown.status === 400 && unknown.json.error === "planeVersion must be one of: 1.3.1", "an unknown version was accepted: " + JSON.stringify(unknown.json));
  const created = await post({});
  assert(created.status === 201 && created.json.planeAccount.planeVersion === "1.3.1", "not on the newest version: " + JSON.stringify(created.json));
  const acc = created.json.planeAccount;
  assert((await call("GET", "/tenants/" + a.id + "/plane-accounts")).json.planeAccounts[0].planeVersion === "1.3.1", "the list leaves the version out");
  // An account left on a version this server does not know, as after going back to an older release.
  await repositories().plane.updateAccount(acc.id, { planeVersion: "0.9" });
  const rename = await call("PATCH", "/plane-accounts/" + acc.id, { name: "renamed" });
  assert(rename.status === 400 && /does not know/.test(rename.json.error), "edited without choosing a known version: " + JSON.stringify(rename.json));
  const checks = seen.filter((s) => s.url.endsWith("/users/me/")).length;
  const fixed = await call("PATCH", "/plane-accounts/" + acc.id, { planeVersion: "1.3.1" });
  assert(fixed.status === 200 && fixed.json.planeAccount.planeVersion === "1.3.1", "version not changed: " + JSON.stringify(fixed.json));
  assert(seen.filter((s) => s.url.endsWith("/users/me/")).length === checks + 1, "a version change was not checked with Plane");
  assert(seen.filter((s) => s.url.includes("/api/v1/")).every((s) => s.key === "good-key"), "a request went without the saved key in X-Api-Key");
  assert((await call("PATCH", "/plane-accounts/" + acc.id, { planeVersion: "0.9" })).status === 400, "an unknown version was saved");
`);

adminScenario("the release a Plane server reports suggests its Plane version, is recorded, and a release outside the account's version gives a note", `
  const a = await tenant("a");
  await call("PUT", "/infrastructure/allowed-hosts", { hosts: ["plane.corp.example", "plane.new.example", "plane.blank.example"] });
  releases["plane.corp.example"] = "1.3.1";
  releases["plane.new.example"] = "v1.4.0";
  releases["plane.blank.example"] = null;
  const suggest = async (baseUrl) => (await call("GET", "/plane-versions?baseUrl=" + encodeURIComponent(baseUrl))).json;
  const corp = await suggest("https://plane.corp.example");
  assert(JSON.stringify(corp.server) === JSON.stringify({ release: "1.3.1", suggested: "1.3.1" }), "suggestion wrong: " + JSON.stringify(corp));
  assert(JSON.stringify((await suggest("https://plane.new.example")).server) === JSON.stringify({ release: "v1.4.0", suggested: null }), "a release no version covers was suggested");
  assert((await suggest("")).server === null, "Plane's cloud answering 404 still gave a release");
  assert(!("server" in (await call("GET", "/plane-versions")).json), "the list alone asked a Plane server");
  assert((await call("GET", "/plane-versions?baseUrl=" + encodeURIComponent("https://evil.example"))).status === 400, "a host outside Allowed hosts was asked");

  const post = (b) => call("POST", "/tenants/" + a.id + "/plane-accounts", { workspaceSlug: "acme", apiKey: "good-key", ...b });
  const onCorp = (await post({ name: "corp", baseUrl: "https://plane.corp.example" })).json.planeAccount;
  assert(onCorp.planeVersion === "1.3.1" && onCorp.planeServerVersion === "1.3.1" && onCorp.versionNote === null, "covered release wrong: " + JSON.stringify(onCorp));
  const onNew = await post({ name: "new", baseUrl: "https://plane.new.example" });
  assert(onNew.status === 201, "a release outside every version blocked the save: " + JSON.stringify(onNew.json));
  assert(onNew.json.planeAccount.planeServerVersion === "v1.4.0" && onNew.json.planeAccount.planeVersion === "1.3.1", "release not recorded: " + JSON.stringify(onNew.json));
  assert(onNew.json.planeAccount.versionNote === "Plane at plane.new.example reports v1.4.0; this account is set to Plane 1.3.1 (checked against v1.3.1). Some tools may fail.", "note wrong: " + onNew.json.planeAccount.versionNote);
  const listed = (await call("GET", "/tenants/" + a.id + "/plane-accounts")).json.planeAccounts.find((x) => x.name === "new");
  assert(listed.versionNote === onNew.json.planeAccount.versionNote, "the list leaves the note out");
  const blank = (await post({ name: "blank", baseUrl: "https://plane.blank.example" })).json.planeAccount;
  assert(blank.planeServerVersion === null && blank.versionNote === null, "an instance not set up gave a release: " + JSON.stringify(blank));
  const cloud = (await post({ name: "cloud" })).json.planeAccount;
  assert(cloud.planeServerVersion === null && cloud.versionNote === null, "a 404 gave a release");

  // After the server is downgraded to 1.3.1, saving the account unchanged reads the release again and the note goes.
  releases["plane.new.example"] = "v1.3.1";
  const saved = (await call("PATCH", "/plane-accounts/" + onNew.json.planeAccount.id, {})).json.planeAccount;
  assert(saved.planeServerVersion === "v1.3.1" && saved.versionNote === null, "the release was not read again: " + JSON.stringify(saved));

  const instances = seen.filter((s) => s.url.includes("/api/instances/"));
  assert(instances.length > 0 && instances.every((s) => s.key === null && s.redirect === "error"), "the release was asked with a key or without redirect: error");
  assert(!seen.some((s) => s.url.includes("evil.example")), "an unlisted host was called");
  assert(bodies.every((b) => !b.includes("phc-secret") && !b.includes("Acme")), "more than the release was kept from Plane's answer");
`);
