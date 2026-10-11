import { afterAll, beforeAll, expect, test } from "bun:test";
import { checkoutAt, offlineGitHub, pinnedRepo } from "../eval/repository";
import { getCommit, getIssue, listLabels, readFile, searchCode, searchIssues, defaultBranch, createIssue, type GitConn } from "../../../packages/skills/src/git";

const pin = pinnedRepo();
const conn: GitConn = { provider: "github", baseUrl: null, token: "none" };
const realFetch = globalThis.fetch;
const urls: string[] = [];
const git = (...args: string[]) => new TextDecoder().decode(Bun.spawnSync({ cmd: ["git", ...args] }).stdout);

beforeAll(() => {
  const serve = offlineGitHub(pin, checkoutAt(pin.commit));
  globalThis.fetch = (async (input: any, init?: RequestInit) => {
    const url = String(input), method = init?.method ?? "GET";
    urls.push(`${method} ${url}`);
    const out = serve({ method, url, body: init?.body ?? null });
    if (out === undefined) return new Response("not served offline", { status: 599 as any });
    return out instanceof Response ? out : Response.json(out);
  }) as typeof fetch;
});
afterAll(() => { globalThis.fetch = realFetch; });

test("the pinned repository is pachiware at a commit this clone has", () => {
  expect(pin.repo).toBe("yhagus/pachiware");
  expect(git("cat-file", "-t", pin.commit).trim()).toBe("commit");
});

test("files and folders are read at the pinned commit, and the default branch's HEAD is that commit", async () => {
  expect(await defaultBranch(conn, pin.repo)).toBe("main");
  expect((await getCommit(conn, pin.repo, "main")).sha).toBe(pin.commit);
  const glossary: any = await readFile(conn, pin.repo, "GLOSSARY.md", pin.commit);
  expect(glossary.content).toBe(git("show", `${pin.commit}:GLOSSARY.md`));
  expect(await readFile(conn, pin.repo, "docs/adr", pin.commit)).toEqual({ type: "dir", entries: [
    { name: "0001-git-account-is-tenant-data-bot-points-to-one.md", type: "file" },
    { name: "0002-bot-has-many-git-accounts-scoped-per-guild-and-channel.md", type: "file" },
    { name: "0003-agent-data-lives-in-workspace-files-not-the-database.md", type: "file" },
  ] });
  // replyStyle.ts was added after the pinned commit.
  await expect(readFile(conn, pin.repo, "apps/agent/src/discord/replyStyle.ts", pin.commit)).rejects.toThrow("not found");
  await expect(readFile(conn, pin.repo, "GLOSSARY.md", "0000000000000000000000000000000000000000")).rejects.toThrow("not found");
});

test("labels and open issues come from the pinned snapshot", async () => {
  expect((await listLabels(conn, pin.repo, 1)).items.map((l: any) => l.name)).toContain("needs-triage");
  expect((await searchIssues(conn, pin.repo, "thread debounced", 1)).items).toEqual([{ number: 29, title: "Thread messages are debounced, contrary to Phase 15.2", state: "open", url: "https://github.com/yhagus/pachiware/issues/29" }]);
  expect((await searchIssues(conn, pin.repo, "safari login", 1)).items).toEqual([]);
  expect((await getIssue(conn, pin.repo, 29)).description).toContain("BURST_MS");
});

test("code search finds files holding every term, linked at the pinned commit", async () => {
  const found = (await searchCode(conn, pin.repo, "BURST_MS", 1)).items as { path: string; url: string }[];
  expect(found).toContainEqual({ path: "apps/agent/src/discord/client.ts", url: `https://github.com/yhagus/pachiware/blob/${pin.commit}/apps/agent/src/discord/client.ts` });
  expect((await searchCode(conn, pin.repo, "BURST_MS nonexistentterm", 1)).items).toEqual([]);
});

test("a stub repository opened beside the pinned one serves only its README, so a brief can be ambiguous between them", async () => {
  const site = { repo: "yhagus/pachiware-site", readme: "# pachiware-site\n\nThe public landing page and docs site for Pachiware." };
  const serve = offlineGitHub(pin, checkoutAt(pin.commit), [site]);
  const get = (path: string) => serve({ method: "GET", url: `https://api.github.com${path}` }) as any;
  expect(get("/repos/yhagus/pachiware-site")).toMatchObject({ full_name: "yhagus/pachiware-site", default_branch: "main" });
  const sha = get("/repos/yhagus/pachiware-site/commits/main").sha;
  expect(sha).toMatch(/^[0-9a-f]{40}$/);
  expect(sha).not.toBe(pin.commit);
  expect(Buffer.from(get(`/repos/yhagus/pachiware-site/contents/README.md?ref=${sha}`).content, "base64").toString()).toBe(site.readme);
  expect(get(`/repos/yhagus/pachiware-site/contents/GLOSSARY.md?ref=${sha}`).status).toBe(404);
  expect(get("/repos/yhagus/pachiware-site/labels")).toEqual([]);
  expect(get(`/search/code?q=${encodeURIComponent("BURST_MS repo:yhagus/pachiware-site")}`).items).toEqual([]);
  expect(get(`/search/issues?q=${encodeURIComponent("thread debounced repo:yhagus/pachiware-site is:issue is:open")}`).items).toEqual([]);
  expect(get(`/search/issues?q=${encodeURIComponent("thread debounced repo:yhagus/pachiware is:issue is:open")}`).items).toHaveLength(1);
});

test("nothing is written and nothing leaves the machine", async () => {
  await expect(createIssue(conn, pin.repo, "x")).rejects.toThrow("403");
  expect(urls.every((u) => u.includes("https://api.github.com/"))).toBe(true);
});
