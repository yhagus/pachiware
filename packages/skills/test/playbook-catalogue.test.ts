import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { skillRegistry } from "../src/registry.ts";
import { BUILTIN_PLAYBOOKS_DIR, builtinPlaybooks, builtinPlaybookFiles, playbookChain } from "../src/playbooks.ts";
import { REPOSITORY_TOOLS } from "../src/openapi/changelog.ts";
import { MAX_DESCRIPTION, MAX_PLAYBOOK_BODY } from "../src/builtin/guildPlaybooks.ts";

// Ours; every other built-in is copied from mattpocock/skills and must say so.
const OWN = ["contract-diff", "daily-log", "issue-draft", "making-playbooks", "minutes"];
const folders = readdirSync(BUILTIN_PLAYBOOKS_DIR).filter((n) => statSync(join(BUILTIN_PLAYBOOKS_DIR, n)).isDirectory()).sort();
const playbooks = builtinPlaybooks();
const imported = playbooks.filter((p) => !OWN.includes(p.name));
const tools = new Set(skillRegistry.catalogue().flatMap((s) => s.tools.map((t) => t.name)));
const skills = new Set(skillRegistry.getAllSkills().map((s) => s.id));
const files = (name: string) => builtinPlaybookFiles(name);
const text = (name: string) => files(name).filter((f) => f.endsWith(".md") && f !== "LICENSE.md").map((f) => readFileSync(join(BUILTIN_PLAYBOOKS_DIR, name, f), "utf8")).join("\n");
const named = (name: string) => playbooks.find((p) => p.name === name);

describe("built-in playbooks", () => {
  test("every folder parses as a playbook", () => {
    expect(playbooks.map((p) => p.name)).toEqual(folders);
  });

  test("the imported playbooks are listed as Matt Pocock's Skills, and ours each under a category the console knows", () => {
    for (const p of imported) expect([p.name, p.category]).toEqual([p.name, "Matt Pocock's Skills"]);
    expect(Object.fromEntries(OWN.map((name) => [name, named(name)?.category]))).toEqual({
      "contract-diff": "Git, code & APIs", "daily-log": "Records & meetings", "issue-draft": "Git, code & APIs", "making-playbooks": "Making playbooks", minutes: "Records & meetings",
    });
  });

  test("the conversation playbooks are imported off, wait-what answers in place, and the references cannot be started", () => {
    for (const name of ["grilling", "grill-me", "to-questionnaire", "ask-matt", "wait-what", "codebase-design", "writing-for-agents"]) expect([name, named(name)?.defaultOff]).toEqual([name, true]);
    expect(named("wait-what")).toMatchObject({ run: "in-place", menu: "Explain this", start: true });
    for (const name of ["codebase-design", "writing-for-agents"]) expect([name, named(name)!.start, named(name)!.menu, named(name)!.words]).toEqual([name, false, null, []]);
    expect(named("grill-me")!.loads).toEqual(["grilling"]);
  });

  test("making-playbooks is an own reference that is on, and its limits match what savePlaybook takes", () => {
    expect(named("making-playbooks")).toMatchObject({ start: false, defaultOff: false, menu: null, words: [] });
    expect(named("making-playbooks")!.body).toContain(`under ${MAX_PLAYBOOK_BODY} characters`);
    expect(named("making-playbooks")!.body).toContain(`under ${MAX_DESCRIPTION} characters`);
  });

  test("contract-diff starts off like the other repository playbooks, from changelog:, needs git and the OpenAPI skill and one repository, runs long, and reads its two references; its workers follow mapping.md and tracing.md", () => {
    expect(named("contract-diff")).toMatchObject({ start: true, defaultOff: true, menu: null, words: ["changelog"], requires: ["git_repositories", "openapi"], repository: "required", budget: "long", run: "thread" });
    expect(files("contract-diff").sort()).toEqual(["PLAYBOOK.md", "checklist.md", "extensions.md", "mapping.md", "tracing.md"]);
    for (const tool of ["startChangelog", "mapChangedFiles", "traceEndpoints", "putChangelogOperation", "putChangelogComponents", "putChangelogNotes", "putChangelogMapping", "finishChangelog", "askChangelogAsker", "sendFiles", "publishOpenApi"]) expect([tool, text("contract-diff").includes(`\`${tool}\``)]).toEqual([tool, true]);
  });

  test("contract-diff's frontmatter offers every repository read its draft's work goes on with", () => {
    for (const tool of REPOSITORY_TOOLS) expect([tool, named("contract-diff")!.tools.includes(tool)]).toEqual([tool, true]);
  });

  test("minutes start from the English or the Indonesian word", () => {
    expect(named("minutes")).toMatchObject({ run: "in-place", menu: "Write minutes", words: ["minutes", "notulen"] });
  });

  test("the repository playbooks are imported off; those that act on a repository require the git skill and one repository, the document playbooks only use git, and grill-with-docs loads grilling and domain-modeling", () => {
    for (const name of ["to-spec", "code-review", "pr"]) {
      expect([name, named(name)?.defaultOff, named(name)?.start, named(name)?.requires.includes("git_repositories")]).toEqual([name, true, true, true]);
    }
    for (const name of ["grill-with-docs", "domain-modeling"]) {
      expect([name, named(name)?.defaultOff, named(name)?.start, named(name)?.requires, named(name)?.optional.includes("git_repositories")]).toEqual([name, true, true, [], true]);
    }
    for (const name of ["to-spec", "code-review", "pr"]) expect([name, named(name)!.repository]).toEqual([name, "required"]);
    // Document playbooks fall back to the channel's Workspace folder where no repository is allowed (ADR 0007).
    for (const name of ["grill-with-docs", "domain-modeling"]) expect([name, named(name)!.repository]).toEqual([name, undefined]);
    expect(named("grill-with-docs")!.loads).toEqual(["grilling", "domain-modeling"]);
    expect(files("domain-modeling")).toEqual(expect.arrayContaining(["GLOSSARY-FORMAT.md", "ADR-FORMAT.md"]));
    expect(text("domain-modeling")).toContain("`writePlaybookDocument`");
  });

  test("the tracker playbooks are imported off, need a repository, and write through the batch tools; wayfinder and triage load grilling and domain-modeling", () => {
    for (const name of ["wayfinder", "to-tickets", "triage"]) {
      expect([name, named(name)?.defaultOff, named(name)?.start, named(name)?.requires.includes("git_repositories"), named(name)?.repository]).toEqual([name, true, true, true, "required"]);
    }
    for (const name of ["wayfinder", "triage"]) expect([name, named(name)!.loads]).toEqual([name, ["grilling", "domain-modeling"]]);
    for (const name of ["wayfinder", "to-tickets"]) expect([name, text(name).includes("`repoCreateIssues`")]).toEqual([name, true]);
    expect(text("triage")).toContain("`repoUpdateIssues`");
    expect(files("triage")).toEqual(expect.arrayContaining(["AGENT-BRIEF.md", "OUT-OF-SCOPE.md"]));
  });

  test("pr also carries HumanLayer's MIT notice for its Summary section", () => {
    const notice = readFileSync(join(BUILTIN_PLAYBOOKS_DIR, "pr", "LICENSE.md"), "utf8");
    expect(notice).toContain("Copyright (c) 2026 HumanLayer");
    expect(notice.split("The above copyright notice and this permission notice shall be included").length).toBe(3);
  });

  test("ask-matt points at every playbook a person can start", () => {
    const router = text("ask-matt");
    for (const p of playbooks.filter((x) => x.start && x.name !== "ask-matt")) expect([p.name, router.includes(`\`/${p.name}\``)]).toEqual([p.name, true]);
  });

  test("every imported playbook is off by default and carries the MIT notice of its upstream", () => {
    expect(imported.length).toBeGreaterThan(0);
    for (const p of imported) {
      expect([p.name, p.defaultOff]).toEqual([p.name, true]);
      const notice = readFileSync(join(BUILTIN_PLAYBOOKS_DIR, p.name, "LICENSE.md"), "utf8");
      expect(notice).toContain("Copyright (c) 2026 Matt Pocock");
      expect(notice.replace(/\s+/g, " ")).toContain("The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.");
      expect(readFileSync(join(BUILTIN_PLAYBOOKS_DIR, p.name, "PLAYBOOK.md"), "utf8")).toMatch(/^license: .*LICENSE\.md/m);
    }
  });

  test("playbooks name only skills, tools, playbooks, and files that exist", () => {
    for (const p of playbooks) {
      const all = text(p.name);
      for (const skill of [...p.requires, ...p.optional]) expect([p.name, skill, skills.has(skill)]).toEqual([p.name, skill, true]);
      for (const tool of [...p.closes, ...p.tools]) expect([p.name, tool, tools.has(tool)]).toEqual([p.name, tool, true]);
      expect([p.name, "chain" in playbookChain(p, playbooks)]).toEqual([p.name, true]);
      // A tool is written `toolName`; a playbook "the `name` playbook", or `/name` when a person starts it; a file of a playbook `name/FILE.md`.
      for (const [, tool] of all.matchAll(/`([a-z]+[A-Z][A-Za-z]*)`/g)) expect([p.name, tool, tools.has(tool!)]).toEqual([p.name, tool, true]);
      for (const [, name] of all.matchAll(/`([a-z][a-z0-9-]*)` playbook/g)) expect([p.name, name, !!named(name!)]).toEqual([p.name, name, true]);
      for (const [, name] of all.matchAll(/`\/([a-z][a-z0-9-]*)`/g)) expect([p.name, name, !!named(name!)?.start]).toEqual([p.name, name, true]);
      for (const [, owner, file] of all.matchAll(/`([a-z][a-z0-9-]*)\/([A-Za-z0-9-]+\.md)`/g)) expect([p.name, `${owner}/${file}`, files(owner!).includes(file!)]).toEqual([p.name, `${owner}/${file}`, true]);
    }
  });
});

test("budget: long is read alike from a built-in, a tenant's and a server's own playbook, and any other value is ignored", async () => {
  const { parsePlaybook } = await import("../src/playbooks.ts");
  const text = (budget: string) => `---\ndescription: Traces endpoints\n${budget}---\nTrace them.\n`;
  for (const source of ["builtin", "tenant", "guild"] as const) {
    expect([source, parsePlaybook("trace", text("budget: long\n"), source)?.budget]).toEqual([source, "long"]);
    expect([source, parsePlaybook("trace", text("budget: short\n"), source)?.budget]).toEqual([source, undefined]);
    expect([source, parsePlaybook("trace", text(""), source)?.budget]).toEqual([source, undefined]);
  }
});
