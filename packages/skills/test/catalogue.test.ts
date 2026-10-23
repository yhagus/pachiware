import { describe, expect, test } from "bun:test";
import { skillRegistry } from "../src/registry.ts";
import { policyOf } from "../src/guardrails.ts";

const catalogue = skillRegistry.catalogue();
const skill = (id: string) => catalogue.find((s) => s.id === id)!;
const tool = (name: string) => catalogue.flatMap((s) => s.tools).find((t) => t.name === name)!;

describe("tool catalogue", () => {
  test("every built-in tool declares an effect", () => {
    const undeclared = catalogue.flatMap((s) => s.tools).filter((t) => !["read", "write", "danger"].includes(t.effect as string));
    expect(undeclared.map((t) => t.name)).toEqual([]);
  });

  test("every git tool sits in exactly one of git's groups; the other skills declare none", () => {
    const git = skill("git_repositories");
    expect(git.groups).toEqual(["Browse", "Issues & PRs", "Code", "CI", "Repo admin", "Org"]);
    expect(git.tools.filter((t) => !git.groups.includes(t.group as string)).map((t) => t.name)).toEqual([]);
    for (const id of ["task_management", "discord_management", "workspace"]) {
      expect(skill(id).groups).toEqual([]);
      expect(skill(id).tools.filter((t) => t.group).map((t) => t.name)).toEqual([]);
    }
  });

  test("danger covers irreversible tools and tools that change access, security or settings, multi-action tools included", () => {
    for (const name of ["archiveChannel", "deleteFile", "repoSecrets", "repoAddMember", "repoSetRole", "repoDelete", "repoTransfer", "repoWebhooks", "repoVariables", "repoSnippets", "orgManageTeam"]) expect([name, tool(name).effect]).toEqual([name, "danger"]);
    for (const name of ["repoCreateIssue", "repoWriteFile", "createTask", "writeFile", "keepAsNote", "setChannelTopic", "createBriefIssues"]) expect([name, tool(name).effect]).toEqual([name, "write"]);
    for (const name of ["repoList", "listTasks", "listChannels", "readFile", "briefRead", "gitAccounts"]) expect([name, tool(name).effect]).toEqual([name, "read"]);
  });

  test("the issue tools for trackers are writes in Issues & PRs", () => {
    for (const name of ["repoCreateIssue", "repoLinkIssues", "repoSubIssue", "repoCreateIssues", "repoUpdateIssues"]) expect([name, tool(name).effect, tool(name).group]).toEqual([name, "write", "Issues & PRs"]);
  });

  test("the brief tools belong to the issue-draft playbook, the changelog drafting tools to contract-diff, and no other tool belongs to one", () => {
    const brief = ["postBriefRound", "recordBriefAnswers", "writeIssueDraft", "describeBriefImages", "briefRepositories", "briefRead", "createBriefIssues"];
    const changelog = ["startChangelog", "putChangelogOperation", "putChangelogComponents", "putChangelogNotes", "finishChangelog", "stopChangelog", "askChangelogAsker"];
    expect(catalogue.flatMap((s) => s.tools).filter((t) => t.playbook).map((t) => [t.name, t.playbook]).sort()).toEqual([...brief.map((n) => [n, "issue-draft"]), ...changelog.map((n) => [n, "contract-diff"])].sort());
  });

  test("tools keep their descriptions, and every tool has a handler and a policy entry that name nothing else", () => {
    for (const s of skillRegistry.getAllSkills()) {
      const names = s.tools.map((t) => t.name).sort();
      expect([s.id, Object.keys(s.handlers).sort()]).toEqual([s.id, names]);
      expect([s.id, Object.keys(s.toolPolicy ?? {}).sort()]).toEqual([s.id, names]);
    }
    const all = catalogue.flatMap((s) => s.tools.map((t) => t.name));
    expect(all.filter((n, i) => all.indexOf(n) !== i)).toEqual([]);
    expect(tool("repoList").description).toMatch(/^Lists repositories/);
  });

  test("every write tool the registry confirms for says whether it asks for Confirm", () => {
    // policyOf gives a write without requiresConfirmation a Confirm button; git, Plane and savePlaybook confirm their writes themselves.
    const unstated = skillRegistry.getAllSkills()
      .flatMap((s) => s.tools.filter((t) => !policyOf(s, t.name).confirmsInternally && policyOf(s, t.name).effect === "write" && s.toolPolicy?.[t.name]?.requiresConfirmation === undefined).map((t) => t.name));
    expect(unstated).toEqual([]);
  });
});

test("on at the tenant is allowed for an administration tool that starts off, and refused for a tool that is on anyway", async () => {
  const { ruleProblem } = await import("../src/availability.js");
  const { skillRegistry } = await import("../src/registry.js");
  const skills = skillRegistry.getAllSkills(), tenant = { tenantId: "t", level: "tenant" as const };
  expect(ruleProblem(tenant, { kind: "tool", name: "repoSecrets", value: "on" }, skills)).toBeNull();
  expect(ruleProblem(tenant, { kind: "tool", name: "workspaceInvite", value: "on" }, skills)).toBeNull();
  expect(ruleProblem(tenant, { kind: "tool", name: "repoList", value: "on" }, skills)).toBe("on at the tenant is only for a playbook or a tool that starts off (default: off); everything else is on unless a rule turns it off");
});
