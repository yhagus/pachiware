import { expect } from "bun:test";
import { readFileSync } from "node:fs";
import { discordScenario, type Scenario } from "./support/discordScenario";

const FIXTURE_TEXT = readFileSync(new URL("../../../packages/skills/test/fixtures/contract-diff/create-user.json", import.meta.url), "utf8");
const GENERAL = "guilds/guild-1/channels/channel-1", DIREKSI = "guilds/guild-1/channels/channel-3";
const CHANGELOG = "channel/files/changelogs/acme-api/2026-10-22_9f8e7d6..a1b2c3d.json";
const results = (turn: any) => JSON.stringify(turn.toolResults.map((r: any) => r.error ?? r));
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

async function ask(s: Scenario, tool: string, args: Record<string, unknown>, options: { channel?: string } = {}) {
  s.model.script({ tool, args }, results);
  await s.discord.send(`${s.discord.mention} munculin preview changelog`, options);
  return JSON.parse(s.discord.botMessages.at(-1)!.content)[0];
}
/** The agent's own server, as a visitor reaches it. */
async function visit(path: string, headers: Record<string, string> = {}) {
  const { createServer } = await import("../src/server.ts");
  return createServer().request(path, { headers });
}

discordScenario("a published changelog becomes an API preview whose page, document and view stay as they were when published", async (s) => {
  await s.guildSettings({ language: "en", useThreads: false });
  process.env.PUBLIC_URL = "https://pachi.example.com/";
  await s.workspace.write(`${GENERAL}/${CHANGELOG.slice("channel/".length)}`, FIXTURE_TEXT);

  const published = await ask(s, "publishOpenApi", { path: CHANGELOG });
  expect(published).toEqual({
    url: expect.stringMatching(new RegExp(`^https://pachi\\.example\\.com/open-api/${UUID}$`)), title: "Users API changes",
    note: "Anyone with the link can open it. It shows the file as it is now; publishing again makes a new link, and the console revokes one.",
  });
  const id = published.url.split("/").pop();

  const page = await visit(`/open-api/${id}`);
  expect(page.status).toBe(200);
  expect(Object.fromEntries(["content-security-policy", "x-robots-tag", "referrer-policy", "cache-control", "x-content-type-options"].map((h) => [h, page.headers.get(h)]))).toEqual({
    "content-security-policy": "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    "x-robots-tag": "noindex, nofollow", "referrer-policy": "no-referrer", "cache-control": "no-store", "x-content-type-options": "nosniff",
  });
  const html = await page.text();
  expect(html).toContain("<title>Users API changes · OpenAPI Schema Viewer</title>");
  expect(html).toContain(`<div id="app" data-url="./${id}/view.json"></div>`);
  expect(html).not.toMatch(/https?:\/\//);
  for (const script of [...html.matchAll(/<script src="\.\/([^"]+)"><\/script>/g)].map((m) => m[1])) {
    const served = await visit(`/open-api/${script}`);
    expect([script, served.status, served.headers.get("content-type")]).toEqual([script, 200, "text/javascript; charset=utf-8"]);
  }

  expect(await (await visit(`/open-api/${id}/openapi.json`)).text()).toBe(FIXTURE_TEXT);
  const view = await (await visit(`/open-api/${id}/view.json`)).json();
  expect(view.paths["/api/v2/users"].post["x-badges"]).toEqual([{ name: "Breaking", color: "#cf222e", position: "before" }, { name: "Changed", color: "#0969da", position: "before" }]);
  expect(view.info.description).toStartWith("**Changelog** of 2026-10-22: from `main` (`9f8e7d6`) to `feature/user-phone` (`a1b2c3d`).");
  expect(view.info.description).toContain(`[Download the OpenAPI JSON](./${id}/openapi.json)`);

  // The file changes and goes; the preview does not.
  await s.workspace.write(`${GENERAL}/${CHANGELOG.slice("channel/".length)}`, '{"openapi": "3.1.2", "info": {"title": "Changed", "version": "2"}, "paths": {}}');
  await s.workspace.remove(`${GENERAL}/${CHANGELOG.slice("channel/".length)}`);
  expect(await (await visit(`/open-api/${id}/openapi.json`)).text()).toBe(FIXTURE_TEXT);
  expect(await (await visit(`/open-api/${id}`)).text()).toBe(html);

  const listed = await ask(s, "listOpenApiPreviews", {});
  expect(listed).toEqual({ previews: [{ title: "Users API changes", url: published.url, source: CHANGELOG, by: "Alice", at: expect.any(String) }] });
});

discordScenario("a non-quotable channel's file, a file that is no OpenAPI document and a draft are not published, and a local address is warned of", async (s) => {
  await s.guildSettings({ language: "en", useThreads: false });
  delete process.env.PUBLIC_URL;
  s.discord.channel("channel-3").name = "direksi";
  s.discord.hide("channel-3");
  await s.workspace.write(`${DIREKSI}/files/api.json`, FIXTURE_TEXT);
  await s.workspace.write(`${GENERAL}/files/data.json`, '{"rows": [1, 2]}');
  await s.workspace.write(`${GENERAL}/files/changelogs/acme-api/2026-10-22_9f8e7d6..a1b2c3d.draft.json`, FIXTURE_TEXT);
  await s.workspace.write(`${GENERAL}/files/api.json`, FIXTURE_TEXT);

  expect(await ask(s, "publishOpenApi", { path: "#direksi/files/api.json" })).toBe("Files from there cannot be shown in this channel. Do not say what or where they are; suggest asking in a DM instead.");
  expect(await ask(s, "publishOpenApi", { path: "channel/files/data.json" })).toBe('"channel/files/data.json" is not an OpenAPI 3 JSON document: it needs "openapi": "3.x.y" and "paths".');
  expect(await ask(s, "publishOpenApi", { path: "channel/files/changelogs/acme-api/2026-10-22_9f8e7d6..a1b2c3d.draft.json" })).toBe("That is an unfinished changelog draft. Finish it with finishChangelog, then publish the .json it writes.");
  const { repositories } = await import("@pachiware/db");
  expect(await repositories().apiPreviews.list(s.tenant.id)).toEqual([]);

  const local = await ask(s, "publishOpenApi", { path: "channel/files/api.json", title: "Users API" });
  expect(local).toMatchObject({ url: expect.stringMatching(new RegExp(`^http://localhost:3001/open-api/${UUID}$`)), title: "Users API", warning: "PUBLIC_URL is not an address others can reach, so this link opens only on the server's own machine. Tell the person; the platform admin sets PUBLIC_URL." });
});

discordScenario("an unknown or malformed id is a plain 404, and one address gets 60 requests a minute", async (s) => {
  const missing = await visit("/open-api/0f1e2d3c-4b5a-4968-8776-655443322110");
  expect([missing.status, await missing.text()]).toEqual([404, "Not found"]);
  expect((await visit("/open-api/not-an-id/openapi.json")).status).toBe(404);

  const from = (address: string) => visit("/open-api/0f1e2d3c-4b5a-4968-8776-655443322110", { "X-Forwarded-For": `${address}, 10.0.0.1` });
  const statuses: number[] = [];
  for (let i = 0; i < 61; i++) statuses.push((await from("203.0.113.9")).status);
  expect(statuses.slice(0, 60).every((st) => st === 404)).toBe(true);
  const limited = await from("203.0.113.9");
  expect([limited.status, Number(limited.headers.get("retry-after")) > 0]).toEqual([429, true]);
  expect((await from("198.51.100.4")).status).toBe(404);
});
