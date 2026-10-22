import type { Effect, ToolPolicy } from "../types.js";
import { ISSUE_DRAFT_PLAYBOOK } from "../grounding.js";

export const GIT_GROUPS = ["Browse", "Issues & PRs", "Code", "CI", "Repo admin", "Org"];

const R: Effect = "read", W: Effect = "write", D: Effect = "danger";
// [effect, group] per tool. The effect describes the tool for the admin and availability rules; who may ask and Confirm stay in gitShared.guard.
const declared: Record<string, [Effect, string]> = {
  gitAccounts: [R, "Browse"], playbookRepositories: [R, "Browse"], repoList: [R, "Browse"], repoBranches: [R, "Browse"], repoCommits: [R, "Browse"], repoCommit: [R, "Browse"], repoCompare: [R, "Browse"], repoFileDiff: [R, "Browse"], repoTree: [R, "Browse"],
  repoReadFile: [R, "Browse"], repoSearchCode: [R, "Browse"], repoTags: [R, "Browse"], repoReleases: [R, "Browse"], repoStats: [R, "Browse"], repoNotifications: [R, "Browse"],

  repoIssues: [R, "Issues & PRs"], repoIssue: [R, "Issues & PRs"], repoComments: [R, "Issues & PRs"], repoLabels: [R, "Issues & PRs"],
  repoMergeRequests: [R, "Issues & PRs"], repoSearchWork: [R, "Issues & PRs"], repoMergeRequest: [R, "Issues & PRs"], repoMergeRequestDiff: [R, "Issues & PRs"],
  repoCreateIssue: [W, "Issues & PRs"], repoLinkIssues: [W, "Issues & PRs"], repoSubIssue: [W, "Issues & PRs"], repoCreateIssues: [W, "Issues & PRs"], repoUpdateIssues: [W, "Issues & PRs"], repoUpdateIssue: [W, "Issues & PRs"], repoComment: [W, "Issues & PRs"], repoEditComment: [W, "Issues & PRs"],
  repoCloseItem: [W, "Issues & PRs"], repoReopenItem: [W, "Issues & PRs"], repoAssign: [W, "Issues & PRs"], repoSetLabels: [W, "Issues & PRs"], repoLockItem: [W, "Issues & PRs"],
  repoOpenPullRequest: [W, "Issues & PRs"], repoUpdateMergeRequest: [W, "Issues & PRs"], repoReviewMergeRequest: [W, "Issues & PRs"], repoRequestReviewers: [W, "Issues & PRs"],
  repoRebaseMergeRequest: [W, "Issues & PRs"], repoMergeMergeRequest: [W, "Issues & PRs"], repoDeleteComment: [D, "Issues & PRs"],

  repoWriteFile: [W, "Code"], writePlaybookDocument: [W, "Code"], repoCommitFiles: [W, "Code"], repoMoveFile: [W, "Code"], repoDeleteFile: [W, "Code"], repoCreateBranch: [W, "Code"], repoCreateTag: [W, "Code"],
  repoCreateRelease: [W, "Code"], repoWiki: [W, "Code"], repoWriteDefaultBranch: [D, "Code"], repoDeleteBranch: [D, "Code"], repoDeleteTag: [D, "Code"],
  repoDeleteRelease: [D, "Code"], repoSnippets: [D, "Code"],

  repoChecks: [R, "CI"], repoPipelines: [R, "CI"], repoPipelineJobs: [R, "CI"], repoJobLog: [R, "CI"], repoArtifacts: [R, "CI"],
  repoRetryPipeline: [W, "CI"], repoRunPipeline: [W, "CI"], repoCancelPipeline: [W, "CI"], repoSchedules: [W, "CI"],
  repoVariables: [D, "CI"], repoSecrets: [D, "CI"], repoRunners: [D, "CI"], repoPackages: [D, "CI"],

  repoMembers: [R, "Repo admin"], repoGetProtection: [R, "Repo admin"], repoSecurityAlerts: [R, "Repo admin"],
  repoCreate: [W, "Repo admin"], repoFork: [W, "Repo admin"], repoRename: [W, "Repo admin"],
  repoUpdateSettings: [D, "Repo admin"], repoArchive: [D, "Repo admin"], repoDelete: [D, "Repo admin"], repoTransfer: [D, "Repo admin"], repoProtectBranch: [D, "Repo admin"],
  repoAddMember: [D, "Repo admin"], repoSetRole: [D, "Repo admin"], repoRemoveMember: [D, "Repo admin"], repoInvitations: [D, "Repo admin"], repoDeployKeys: [D, "Repo admin"], repoWebhooks: [D, "Repo admin"],

  orgList: [R, "Org"], orgMembers: [R, "Org"], orgTeams: [R, "Org"], orgCreateGroup: [D, "Org"], orgManageTeam: [D, "Org"],
};

/** Administration an admin assistant rarely needs: off for the tenant until it is switched on (#251). */
const ADMIN_GROUPS = new Set(["Repo admin", "Org"]);
const ADMIN_TOOLS = new Set(["repoVariables", "repoSecrets", "repoRunners", "repoPackages", "repoSchedules", "repoSnippets", "repoWriteDefaultBranch"]);

export const gitToolPolicy: Record<string, ToolPolicy> = {
  ...Object.fromEntries(Object.entries(declared).map(([tool, [effect, group]]) => [tool, { effect, group, ...(ADMIN_GROUPS.has(group) || ADMIN_TOOLS.has(tool) ? { defaultOff: true as const } : {}) }])),
  briefRepositories: { effect: R, group: "Browse", playbook: ISSUE_DRAFT_PLAYBOOK },
  briefRead: { effect: R, group: "Browse", playbook: ISSUE_DRAFT_PLAYBOOK, metered: true },
  createBriefIssues: { effect: W, group: "Issues & PRs", playbook: ISSUE_DRAFT_PLAYBOOK },
};
