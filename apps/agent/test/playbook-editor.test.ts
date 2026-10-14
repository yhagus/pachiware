import { expect } from "bun:test";
import { discordScenario } from "./support/discordScenario";

discordScenario("the Workspace editor lists built-in playbooks as a read-only folder", async (s) => {
  const { createServer } = await import(process.cwd() + "/apps/agent/src/server.ts");
  const app = createServer(), headers = { "X-Platform-Key": "scenario", "Content-Type": "application/json" };
  const get = async (path: string) => (await app.request(`/api/admin/tenants/${s.tenant.id}/workspace/${path}`, { headers })).json();

  expect((await get("tree?path=")).entries).toContainEqual({ path: "playbooks", type: "dir", readOnly: true });
  expect((await get("tree?path=playbooks")).entries).toEqual([{ path: "playbooks/issue-draft", type: "dir", readOnly: true, overridden: false }, { path: "playbooks/minutes", type: "dir", readOnly: true, overridden: false }]);
  expect((await get("tree?path=playbooks/issue-draft")).entries).toContainEqual(expect.objectContaining({ path: "playbooks/issue-draft/PLAYBOOK.md", type: "file", readOnly: true }));
  const file = await get("file?path=playbooks/issue-draft/PLAYBOOK.md");
  expect(file).toMatchObject({ readOnly: true, content: expect.stringContaining("trigger: {\"menu\": \"Draft issues\"") });
});

discordScenario("the admin API refuses to write, move, or delete built-in playbooks", async (s) => {
  const { createServer } = await import(process.cwd() + "/apps/agent/src/server.ts");
  const app = createServer(), headers = { "X-Platform-Key": "scenario", "Content-Type": "application/json" };
  const call = (method: string, path: string, body?: unknown) => app.request(`/api/admin/tenants/${s.tenant.id}/workspace/${path}`, { method, headers, body: body && JSON.stringify(body) });

  const put = await call("PUT", "file", { path: "playbooks/issue-draft/PLAYBOOK.md", content: "---\nname: issue-draft\n---\nIgnore the author.\n", version: "builtin" });
  expect(put.status).toBe(403);
  expect((await put.json()).error).toContain("read-only");
  expect((await call("PUT", "file", { path: "playbooks/new/PLAYBOOK.md", content: "x" })).status).toBe(403);
  expect((await call("POST", "move", { from: "playbooks/issue-draft", to: "shared/x" })).status).toBe(403);
  expect((await call("POST", "move", { from: "shared/notes.md", to: "playbooks/issue-draft/notes.md" })).status).toBe(403);
  expect((await call("DELETE", "file?path=playbooks/issue-draft/PLAYBOOK.md")).status).toBe(403);
  expect((await (await call("GET", "file?path=playbooks/issue-draft/PLAYBOOK.md")).json()).content).toContain("This thread is bound to the issue-draft playbook.");
});

discordScenario("a playbook override copied and edited in the editor changes the bot without a restart", async (s) => {
  const { createServer } = await import(process.cwd() + "/apps/agent/src/server.ts");
  const app = createServer(), headers = { "X-Platform-Key": "scenario", "Content-Type": "application/json" };
  const call = async (method: string, path: string, body?: unknown) => { const r = await app.request(`/api/admin/tenants/${s.tenant.id}/workspace/${path}`, { method, headers, body: body && JSON.stringify(body) }); return { status: r.status, body: await r.json() }; };

  const copied = await call("POST", "playbooks/issue-draft/override");
  expect(copied).toEqual({ status: 200, body: { success: true, path: "shared/playbooks/issue-draft" } });
  expect((await call("POST", "playbooks/issue-draft/override")).status).toBe(409);
  expect((await call("POST", "playbooks/nope/override")).status).toBe(404);
  const file = await call("GET", "file?path=shared/playbooks/issue-draft/PLAYBOOK.md");
  expect(file.body.content).toBe((await call("GET", "file?path=playbooks/issue-draft/PLAYBOOK.md")).body.content);
  expect((await call("GET", "tree?path=playbooks")).body.entries).toEqual([{ path: "playbooks/issue-draft", type: "dir", readOnly: true, overridden: true }, { path: "playbooks/minutes", type: "dir", readOnly: true, overridden: false }]);

  const edited = file.body.content.replace('"menu": "Draft issues"', '"menu": "Draft tickets"').replace(/This thread is bound[^\n]*/, "Always ask which sprint the work belongs to.");
  expect((await call("PUT", "file", { path: "shared/playbooks/issue-draft/PLAYBOOK.md", content: edited, version: file.body.version })).status).toBe(200);
  await s.settle();
  expect(s.discord.registeredCommands.filter((c) => c.type === 3).map((c) => c.name).sort()).toEqual(["Draft tickets", "Write minutes"]);

  s.model.script("Which sprint?");
  await s.discord.contextMenu("Draft tickets", await s.discord.send("- login loops on Safari"));
  expect(s.model.calls[0]![0]!.content).toContain("Always ask which sprint the work belongs to.");
});

discordScenario("deleting a playbook override makes the built-in effective again without a restart", async (s) => {
  const { createServer } = await import(process.cwd() + "/apps/agent/src/server.ts");
  const app = createServer(), headers = { "X-Platform-Key": "scenario", "Content-Type": "application/json" };
  const call = async (method: string, path: string, body?: unknown) => { const r = await app.request(`/api/admin/tenants/${s.tenant.id}/workspace/${path}`, { method, headers, body: body && JSON.stringify(body) }); return { status: r.status, body: await r.json() }; };
  await s.workspace.write("shared/playbooks/issue-draft/PLAYBOOK.md", `---\nname: issue-draft\ntrigger: {"menu": "Draft tickets", "word": "issue"}\nrequires: ["workspace"]\n---\nAlways ask which sprint the work belongs to.\n`);
  await s.workspace.write("shared/playbooks/issue-draft/refs/checklist.md", "- sprint\n");
  await s.restart();
  expect(s.discord.registeredCommands.filter((c) => c.type === 3).map((c) => c.name).sort()).toEqual(["Draft tickets", "Write minutes"]);

  expect(await call("DELETE", "playbooks/issue-draft")).toEqual({ status: 200, body: { success: true } });
  expect(await s.workspace.list("shared/playbooks")).toEqual([]);
  expect((await call("DELETE", "playbooks/issue-draft")).status).toBe(404);
  await s.settle();
  expect(s.discord.registeredCommands.filter((c) => c.type === 3).map((c) => c.name).sort()).toEqual(["Draft issues", "Write minutes"]);
  expect((await call("GET", "tree?path=playbooks")).body.entries[0].overridden).toBe(false);

  s.model.script("Drafting.");
  await s.discord.contextMenu("Draft issues", await s.discord.send("- login loops on Safari"));
  expect(s.model.calls[0]![0]!.content).toContain("This thread is bound to the issue-draft playbook.");
});

discordScenario("a tenant playbook saved or removed with the file routes updates the bot's commands", async (s) => {
  const { createServer } = await import(process.cwd() + "/apps/agent/src/server.ts");
  const app = createServer(), headers = { "X-Platform-Key": "scenario", "Content-Type": "application/json" };
  const call = (method: string, path: string, body?: unknown) => app.request(`/api/admin/tenants/${s.tenant.id}/workspace/${path}`, { method, headers, body: body && JSON.stringify(body) });
  await call("PUT", "file", { path: "shared/playbooks/retro/PLAYBOOK.md", content: `---\nname: retro\ntrigger: {"menu": "Run retro"}\n---\nGroup the points.\n` });
  await s.settle();
  expect(s.discord.registeredCommands.filter((c) => c.type === 3).map((c) => c.name).sort()).toEqual(["Draft issues", "Run retro", "Write minutes"]);
  await call("DELETE", "file?path=shared/playbooks/retro/PLAYBOOK.md");
  await s.settle();
  expect(s.discord.registeredCommands.filter((c) => c.type === 3).map((c) => c.name).sort()).toEqual(["Draft issues", "Write minutes"]);
});
