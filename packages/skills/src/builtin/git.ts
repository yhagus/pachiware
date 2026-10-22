import type { SkillModule, SkillContext, ToolDefinition } from "../types.js";
import { browseRepos, browseMembers, browseIssues, browseMergeRequests, browseBranches, browseCommits, browseTree, fileDiff, getMergeRequest, readFilePage, findDefinition, writeFile, openPullRequest, commentOn, createIssue, linkIssues, subIssue, mergeMergeRequest, closeItem, browsePipelines, pipelineJobs, jobLog, retryPipeline, createBranch, browseTags, browseReleases, getCommit, compareRefs, getIssue, itemComments, searchCode, searchWork, rankWork, type WorkHit, updateMergeRequest, reopenItem, reviewMergeRequest, requestReviewers, mergeRequestDiff, repoChecks, rebaseMergeRequest, updateIssue, assignItem, listLabels, setLabels, lockItem, editComment, deleteComment, createRepo, updateRepoSettings, renameRepo, archiveRepo, deleteRepo, forkRepo, transferRepo, deleteBranch, protectBranch, getBranchProtection, createTag, deleteTag, createRelease, deleteRelease, deleteFile, moveFile, commitFiles, commitToDefaultBranch, runPipeline, cancelPipeline, listArtifacts, downloadArtifact, schedules, variables, secrets, runners, member, invitations, deployKeys, webhooks, securityAlerts, orgList, orgMembers, orgTeams, createGroup, manageTeam, wiki, snippets, packages, notifications, stats, type GitState, type GitConn, type ItemKind } from "../git.js";
import { GIT_NOT_ENABLED, loadGitAccess, pickAccess, connectionOf, repoAllowed, type GitAccess } from "../gitScope.js";
import { acct, repoP, pageP, stateP, numberP, kindP, CONFIRM, useRepo, page, state, num, str, kindOf, clip, confirmable, guard, labelsP, labelsOf } from "./gitShared.js";
import { briefGroundingTools, briefGroundingHandlers } from "./briefGrounding.js";
import { briefIssuesTools, briefIssuesHandlers } from "./briefIssues.js";
import { playbookRepositoryTools, playbookRepositoryHandlers } from "./playbookRepository.js";
import { playbookDocumentTools, playbookDocumentHandlers } from "./playbookDocuments.js";
import { issueBatchTools, issueBatchHandlers } from "./issueBatch.js";
import { gitToolPolicy, GIT_GROUPS } from "./gitPolicy.js";
import { wordingsOf } from "../workspace/search.js";
import { queriesTerms } from "../workspace/terms.js";

export const gitTools: ToolDefinition[] = [
  { name: "gitAccounts", description: "Lists the git accounts you may use in this channel, with the repository patterns each is limited to. Call it first when unsure which account to use.",
    parameters: { type: "object", properties: {} } },
  { name: "repoList", description: "Lists repositories of an account (30 per page), optionally filtered by a name fragment. Only repositories enabled for this channel are shown, so a page can hold fewer than 30 items.",
    parameters: { type: "object", properties: { account: acct, query: { type: "string", description: "Part of the repository name" }, page: pageP } } },
  { name: "repoMergeRequests", description: "Lists pull requests (merge requests on GitLab) of a repository.",
    parameters: { type: "object", properties: { account: acct, repo: repoP, state: stateP, page: pageP }, required: ["repo"] } },
  { name: "repoMergeRequest", description: "Shows one pull/merge request: description, branches and changed files.",
    parameters: { type: "object", properties: { account: acct, repo: repoP, number: { type: "number", description: "PR number (GitLab: MR iid)" } }, required: ["repo", "number"] } },
  { name: "repoIssues", description: "Lists issues of a repository, optionally only those carrying every label in `labels`.",
    parameters: { type: "object", properties: { account: acct, repo: repoP, state: stateP, labels: labelsP, page: pageP }, required: ["repo"] } },
  { name: "repoBranches", description: "Lists branches of a repository.",
    parameters: { type: "object", properties: { account: acct, repo: repoP, page: pageP }, required: ["repo"] } },
  { name: "repoCommits", description: "Lists recent commits of a repository, newest first. since and until keep the commits made in that window.",
    parameters: { type: "object", properties: { account: acct, repo: repoP, branch: { type: "string", description: "Default: the default branch" }, since: { type: "string", description: "ISO 8601 date-time with its offset, e.g. 2026-10-01T00:00:00+07:00" }, until: { type: "string", description: "ISO 8601 date-time with its offset" }, page: pageP }, required: ["repo"] } },
  { name: "repoMembers", description: "Lists members or collaborators of a repository.",
    parameters: { type: "object", properties: { account: acct, repo: repoP, page: pageP }, required: ["repo"] } },
  { name: "repoReadFile", description: "Reads a file (or lists a directory) in a repository, about 9,000 characters of lines at a time: the result has fromLine, toLine and totalLines, and nextFromLine when there is more. Pass fromLine (and toLine) to read another part, such as a function repoSearchCode found at a line.",
    parameters: { type: "object", properties: { account: acct, repo: repoP, path: { type: "string", description: "File or directory path" }, ref: { type: "string", description: "Branch, tag or commit (default: default branch)" },
      fromLine: { type: "number", description: "First line to read, 1-based (default 1)" }, toLine: { type: "number", description: "Last line to read (default: as far as the page goes)" } }, required: ["repo", "path"] } },
  { name: "repoWriteFile", description: "Commits a file to a non-default branch (created from the default branch if missing). Cannot write to the default branch; follow with repoOpenPullRequest." + CONFIRM,
    parameters: { type: "object", properties: { account: acct, repo: repoP, path: { type: "string" }, content: { type: "string", description: "Full new file content" }, message: { type: "string", description: "Commit message" }, branch: { type: "string", description: "Target branch, not the default branch" } }, required: ["repo", "path", "content", "message", "branch"] } },
  { name: "repoOpenPullRequest", description: "Opens a pull request (merge request on GitLab) from a branch into the default branch." + CONFIRM,
    parameters: { type: "object", properties: { account: acct, repo: repoP, branch: { type: "string" }, title: { type: "string" }, body: { type: "string" } }, required: ["repo", "branch", "title"] } },
  { name: "repoComment", description: "Posts a comment on an issue or pull/merge request." + CONFIRM,
    parameters: { type: "object", properties: { account: acct, repo: repoP, number: numberP, kind: kindP, body: { type: "string", description: "Comment text (markdown)" } }, required: ["repo", "number", "kind", "body"] } },
  { name: "repoCreateIssue", description: "Creates an issue, optionally with labels." + CONFIRM,
    parameters: { type: "object", properties: { account: acct, repo: repoP, title: { type: "string" }, body: { type: "string", description: "Description (markdown)" }, labels: labelsP }, required: ["repo", "title"] } },
  { name: "repoLinkIssues", description: "Records that issue `issue` is blocked by issue `blockedBy` in the same repository (GitHub issue dependency; GitLab \"blocks\" link, a Premium feature)." + CONFIRM,
    parameters: { type: "object", properties: { account: acct, repo: repoP, issue: { type: "number", description: "The issue that waits" }, blockedBy: { type: "number", description: "The issue it waits on" } }, required: ["repo", "issue", "blockedBy"] } },
  { name: "repoSubIssue", description: "Attaches issue `child` under issue `parent` as a sub-issue, or detaches it. GitHub uses native sub-issues; GitLab gets a related link plus a task list line in the parent's description." + CONFIRM,
    parameters: { type: "object", properties: { account: acct, repo: repoP, parent: { type: "number", description: "The parent issue" }, child: { type: "number", description: "The sub-issue" }, action: { type: "string", enum: ["attach", "detach"] } }, required: ["repo", "parent", "child", "action"] } },
  { name: "repoMergeMergeRequest", description: "Merges a pull/merge request into its target branch." + CONFIRM,
    parameters: { type: "object", properties: { account: acct, repo: repoP, number: { type: "number", description: "PR number (GitLab: MR iid)" } }, required: ["repo", "number"] } },
  { name: "repoCloseItem", description: "Closes an issue or pull/merge request without merging." + CONFIRM,
    parameters: { type: "object", properties: { account: acct, repo: repoP, number: numberP, kind: kindP }, required: ["repo", "number", "kind"] } },
  { name: "repoUpdateMergeRequest", description: "Edits a pull/merge request title, description, target branch, or draft state." + CONFIRM, parameters: { type: "object", properties: { account: acct, repo: repoP, number: numberP, title: { type: "string" }, body: { type: "string" }, target: { type: "string" }, draft: { type: "boolean" } }, required: ["repo", "number"] } },
  { name: "repoReopenItem", description: "Reopens an issue or pull/merge request." + CONFIRM, parameters: { type: "object", properties: { account: acct, repo: repoP, number: numberP, kind: kindP }, required: ["repo", "number", "kind"] } },
  { name: "repoReviewMergeRequest", description: "Approves, requests changes on, or comments on a pull/merge request." + CONFIRM, parameters: { type: "object", properties: { account: acct, repo: repoP, number: numberP, event: { type: "string", enum: ["approve", "request_changes", "comment"] }, body: { type: "string" } }, required: ["repo", "number", "event"] } },
  { name: "repoRequestReviewers", description: "Requests reviewers for a pull/merge request." + CONFIRM, parameters: { type: "object", properties: { account: acct, repo: repoP, number: numberP, reviewers: { type: "array", items: { type: "string" } } }, required: ["repo", "number", "reviewers"] } },
  { name: "repoMergeRequestDiff", description: "Reads the changed files and available patches of a pull/merge request.", parameters: { type: "object", properties: { account: acct, repo: repoP, number: numberP }, required: ["repo", "number"] } },
  { name: "repoChecks", description: "Reads commit checks and statuses for a repository ref.", parameters: { type: "object", properties: { account: acct, repo: repoP, ref: { type: "string" } }, required: ["repo", "ref"] } },
  { name: "repoRebaseMergeRequest", description: "Rebases a GitLab merge request source branch." + CONFIRM, parameters: { type: "object", properties: { account: acct, repo: repoP, number: numberP }, required: ["repo", "number"] } },
  { name: "repoUpdateIssue", description: "Edits an issue title or description." + CONFIRM, parameters: { type: "object", properties: { account: acct, repo: repoP, number: numberP, title: { type: "string" }, body: { type: "string" } }, required: ["repo", "number"] } },
  { name: "repoAssign", description: "Sets issue or pull/merge request assignees." + CONFIRM, parameters: { type: "object", properties: { account: acct, repo: repoP, number: numberP, kind: kindP, assignees: { type: "array", items: { type: "string" } } }, required: ["repo", "number", "kind", "assignees"] } },
  { name: "repoLabels", description: "Lists repository labels.", parameters: { type: "object", properties: { account: acct, repo: repoP, page: pageP }, required: ["repo"] } },
  { name: "repoSetLabels", description: "Replaces labels on an issue or pull/merge request." + CONFIRM, parameters: { type: "object", properties: { account: acct, repo: repoP, number: numberP, kind: kindP, labels: { type: "array", items: { type: "string" } } }, required: ["repo", "number", "kind", "labels"] } },
  { name: "repoLockItem", description: "Locks or unlocks issue or pull/merge request discussion." + CONFIRM, parameters: { type: "object", properties: { account: acct, repo: repoP, number: numberP, kind: kindP, locked: { type: "boolean" } }, required: ["repo", "number", "kind", "locked"] } },
  { name: "repoEditComment", description: "Edits an issue or pull/merge request comment." + CONFIRM, parameters: { type: "object", properties: { account: acct, repo: repoP, id: { type: "number" }, kind: kindP, body: { type: "string" } }, required: ["repo", "id", "kind", "body"] } },
  { name: "repoDeleteComment", description: "Deletes an issue or pull/merge request comment. Danger action, for Trusted members only." + CONFIRM, parameters: { type: "object", properties: { account: acct, repo: repoP, id: { type: "number" }, kind: kindP }, required: ["repo", "id", "kind"] } },
  { name: "repoCreate", description: "Creates a repository." + CONFIRM, parameters: { type: "object", properties: { account: acct, name: { type: "string" }, description: { type: "string" }, visibility: { type: "string", enum: ["public", "private", "internal"] }, path: { type: "string" }, namespaceId: { type: "number" }, autoInit: { type: "boolean" } }, required: ["name"] } },
  { name: "repoUpdateSettings", description: "Updates repository description, visibility, default branch, or features." + CONFIRM, parameters: { type: "object", properties: { account: acct, repo: repoP, description: { type: "string" }, visibility: { type: "string" }, defaultBranch: { type: "string" }, features: { type: "object" } }, required: ["repo"] } },
  { name: "repoRename", description: "Renames a repository." + CONFIRM, parameters: { type: "object", properties: { account: acct, repo: repoP, name: { type: "string" } }, required: ["repo", "name"] } },
  { name: "repoArchive", description: "Archives or unarchives a repository." + CONFIRM, parameters: { type: "object", properties: { account: acct, repo: repoP, archived: { type: "boolean" } }, required: ["repo", "archived"] } },
  { name: "repoDelete", description: "Deletes a repository. Danger action, for Trusted members only." + CONFIRM, parameters: { type: "object", properties: { account: acct, repo: repoP }, required: ["repo"] } },
  { name: "repoFork", description: "Forks a repository." + CONFIRM, parameters: { type: "object", properties: { account: acct, repo: repoP, organization: { type: "string" }, namespace: { type: "string" }, name: { type: "string" } }, required: ["repo"] } },
  { name: "repoTransfer", description: "Transfers repository ownership. Danger action, for Trusted members only." + CONFIRM, parameters: { type: "object", properties: { account: acct, repo: repoP, target: { type: "string" } }, required: ["repo", "target"] } },
  { name: "repoDeleteBranch", description: "Deletes a branch. Danger action, for Trusted members only." + CONFIRM, parameters: { type: "object", properties: { account: acct, repo: repoP, branch: { type: "string" } }, required: ["repo", "branch"] } },
  { name: "repoProtectBranch", description: "Creates or updates branch protection." + CONFIRM, parameters: { type: "object", properties: { account: acct, repo: repoP, branch: { type: "string" }, requiredStatusChecks: { type: "boolean" }, strict: { type: "boolean" }, contexts: { type: "array", items: { type: "string" } }, enforceAdmins: { type: "boolean" }, requireReviews: { type: "boolean" }, approvals: { type: "number" } }, required: ["repo", "branch"] } },
  { name: "repoGetProtection", description: "Reads branch protection.", parameters: { type: "object", properties: { account: acct, repo: repoP, branch: { type: "string" } }, required: ["repo", "branch"] } },
  { name: "repoCreateTag", description: "Creates a tag." + CONFIRM, parameters: { type: "object", properties: { account: acct, repo: repoP, tag: { type: "string" }, ref: { type: "string" } }, required: ["repo", "tag"] } },
  { name: "repoDeleteTag", description: "Deletes a tag. Danger action, for Trusted members only." + CONFIRM, parameters: { type: "object", properties: { account: acct, repo: repoP, tag: { type: "string" } }, required: ["repo", "tag"] } },
  { name: "repoCreateRelease", description: "Creates a release." + CONFIRM, parameters: { type: "object", properties: { account: acct, repo: repoP, tag: { type: "string" }, name: { type: "string" }, body: { type: "string" }, ref: { type: "string" }, draft: { type: "boolean" }, prerelease: { type: "boolean" } }, required: ["repo", "tag"] } },
  { name: "repoDeleteRelease", description: "Deletes a release. Danger action, for Trusted members only." + CONFIRM, parameters: { type: "object", properties: { account: acct, repo: repoP, release: { type: "string" } }, required: ["repo", "release"] } },
  { name: "repoDeleteFile", description: "Deletes a file from a branch. Never the default branch (that is repoWriteDefaultBranch)." + CONFIRM, parameters: { type: "object", properties: { account: acct, repo: repoP, path: { type: "string" }, message: { type: "string" }, branch: { type: "string" } }, required: ["repo", "path", "message", "branch"] } },
  { name: "repoMoveFile", description: "Moves or renames a file in a branch. Never the default branch (that is repoWriteDefaultBranch)." + CONFIRM, parameters: { type: "object", properties: { account: acct, repo: repoP, from: { type: "string" }, to: { type: "string" }, message: { type: "string" }, branch: { type: "string" } }, required: ["repo", "from", "to", "message", "branch"] } },
  { name: "repoCommitFiles", description: "Commits multiple file changes together to an existing branch. Never the default branch (that is repoWriteDefaultBranch)." + CONFIRM, parameters: { type: "object", properties: { account: acct, repo: repoP, files: { type: "array", items: { type: "object" } }, message: { type: "string" }, branch: { type: "string" } }, required: ["repo", "files", "message", "branch"] } },
  { name: "repoWriteDefaultBranch", description: "Writes directly to the default branch. Danger action, for Trusted members only." + CONFIRM, parameters: { type: "object", properties: { account: acct, repo: repoP, files: { type: "array", items: { type: "object" } }, message: { type: "string" } }, required: ["repo", "files", "message"] } },
  { name: "repoPipelines", description: "Lists CI/CD pipelines (GitHub: workflow runs) of a repository, newest first, optionally for one branch.",
    parameters: { type: "object", properties: { account: acct, repo: repoP, branch: { type: "string", description: "Only this branch" }, page: pageP }, required: ["repo"] } },
  { name: "repoPipelineJobs", description: "Lists the jobs of one pipeline (GitHub: workflow run) with their status. Use it to find the failed job, then repoJobLog.",
    parameters: { type: "object", properties: { account: acct, repo: repoP, id: { type: "number", description: "Pipeline id from repoPipelines" } }, required: ["repo", "id"] } },
  { name: "repoJobLog", description: "Reads the end of a CI job's log, where failures show up.",
    parameters: { type: "object", properties: { account: acct, repo: repoP, jobId: { type: "number", description: "Job id from repoPipelineJobs" } }, required: ["repo", "jobId"] } },
  { name: "repoTags", description: "Lists tags of a repository.",
    parameters: { type: "object", properties: { account: acct, repo: repoP, page: pageP }, required: ["repo"] } },
  { name: "repoReleases", description: "Lists releases of a repository with their notes.",
    parameters: { type: "object", properties: { account: acct, repo: repoP, page: pageP }, required: ["repo"] } },
  { name: "repoCommit", description: "Shows one commit: full message and changed files.",
    parameters: { type: "object", properties: { account: acct, repo: repoP, sha: { type: "string", description: "Commit sha, branch or tag" } }, required: ["repo", "sha"] } },
  { name: "repoCompare", description: "Compares two refs (branches, tags or commits): commits and changed files going from `from` to `to`. The changed files come 50 a page, with totalFiles and nextPage; the commits (at most 30) come on the first page.",
    parameters: { type: "object", properties: { account: acct, repo: repoP, from: { type: "string" }, to: { type: "string" }, page: pageP }, required: ["repo", "from", "to"] } },
  { name: "repoFileDiff", description: "Shows one file's patch between two refs, going from `from` to `to`, with its old path when it moved; name the file by its path at either ref. A patch over 10,000 characters is cut: then read the file at each ref with repoReadFile.",
    parameters: { type: "object", properties: { account: acct, repo: repoP, from: { type: "string" }, to: { type: "string" }, path: { type: "string", description: "File path" } }, required: ["repo", "from", "to", "path"] } },
  { name: "repoTree", description: "Lists every file path at a ref (branch, tag or commit), at any depth, sorted, 200 a page with totalFiles and nextPage; path keeps the files under one folder. repoReadFile lists only one folder level.",
    parameters: { type: "object", properties: { account: acct, repo: repoP, ref: { type: "string", description: "Branch, tag or commit" }, path: { type: "string", description: "Folder, e.g. src/routes" }, page: pageP }, required: ["repo", "ref"] } },
  { name: "repoIssue", description: "Shows one issue: description, labels and assignees. Use repoComments for the discussion.",
    parameters: { type: "object", properties: { account: acct, repo: repoP, number: { type: "number" } }, required: ["repo", "number"] } },
  { name: "repoComments", description: "Lists comments on an issue or pull/merge request, oldest first.",
    parameters: { type: "object", properties: { account: acct, repo: repoP, number: numberP, kind: kindP, page: pageP }, required: ["repo", "number", "kind"] } },
  { name: "repoSearchWork", description: "Finds issues, pull/merge requests (merged, open or closed) and commits about a piece of work, best match first (newest first among equals), in one repository or, without repo, in every repository open here. Use it for \"is it done?\": a merged pull request or a matching commit means it was done in code.",
    parameters: { type: "object", properties: { account: acct, repo: { ...repoP, description: "Search only this repository; omit for every repository open here" },
      queries: { type: "array", items: { type: "string" }, description: "Several wordings of the work (up to 5), such as Indonesian and English variants" }, query: { type: "string", description: "One wording, when there is only one" } } } },
  { name: "repoSearchCode", description: "Searches file contents in a repository.",
    parameters: { type: "object", properties: { account: acct, repo: repoP, query: { type: "string" }, page: pageP }, required: ["repo", "query"] } },
  { name: "repoFindDefinition", description: "Shows where a function, method, class, interface, type, enum or constant is defined at a ref (branch, tag or commit), with its whole body and the decorators and comments just above it: one call instead of repoSearchCode then repoReadFile. Pass path when you know the file; otherwise the provider's code search finds the candidates (on GitHub it reads the default branch), and they are read at ref.",
    parameters: { type: "object", properties: { account: acct, repo: repoP, ref: { type: "string", description: "Branch, tag or commit" }, name: { type: "string", description: "One identifier, e.g. normalizeRequest" }, path: { type: "string", description: "The file it is in, when known" } }, required: ["repo", "ref", "name"] } },
  { name: "repoCreateBranch", description: "Creates a branch from the default branch (or from `from`)." + CONFIRM,
    parameters: { type: "object", properties: { account: acct, repo: repoP, branch: { type: "string" }, from: { type: "string", description: "Source branch (default: the default branch)" } }, required: ["repo", "branch"] } },
  { name: "repoRetryPipeline", description: "Re-runs the failed jobs of a pipeline (GitHub: workflow run)." + CONFIRM,
    parameters: { type: "object", properties: { account: acct, repo: repoP, id: { type: "number", description: "Pipeline id from repoPipelines" } }, required: ["repo", "id"] } },
  { name: "repoRunPipeline", description: "Runs a workflow or pipeline." + CONFIRM, parameters: { type: "object", properties: { account: acct, repo: repoP, ref: { type: "string" } }, required: ["repo"] } },
  { name: "repoCancelPipeline", description: "Cancels a pipeline." + CONFIRM, parameters: { type: "object", properties: { account: acct, repo: repoP, id: { type: "number" } }, required: ["repo", "id"] } },
  { name: "repoArtifacts", description: "Lists and downloads CI artifacts.", parameters: { type: "object", properties: { account: acct, repo: repoP, page: pageP, id: { type: "number" } }, required: ["repo"] } },
  { name: "repoSchedules", description: "Reads or changes pipeline schedules." + CONFIRM, parameters: { type: "object", properties: { account: acct, repo: repoP, action: { type: "string", enum: ["list", "create", "update", "delete"] }, id: { type: "number" }, description: { type: "string" }, ref: { type: "string" }, cron: { type: "string" }, active: { type: "boolean" } }, required: ["repo", "action"] } },
  { name: "repoVariables", description: "Lists, sets, and deletes CI variables. Values are returned only when explicitly supplied by the caller." + CONFIRM, parameters: { type: "object", properties: { account: acct, repo: repoP, action: { type: "string", enum: ["list", "set", "delete"] }, name: { type: "string" }, value: { type: "string" } }, required: ["repo", "action"] } },
  { name: "repoSecrets", description: "Lists secret names, sets, or deletes secrets; secret values are never read." + CONFIRM, parameters: { type: "object", properties: { account: acct, repo: repoP, action: { type: "string", enum: ["list", "set", "delete"] }, name: { type: "string" }, value: { type: "string" }, protected: { type: "boolean" } }, required: ["repo", "action"] } },
  { name: "repoRunners", description: "Lists or manages CI runners." + CONFIRM, parameters: { type: "object", properties: { account: acct, repo: repoP, action: { type: "string", enum: ["list", "update", "delete"] }, id: { type: "number" } }, required: ["repo", "action"] } },
  { name: "repoAddMember", description: "Adds a repository member." + CONFIRM, parameters: { type: "object", properties: { account: acct, repo: repoP, user: { type: "string" }, role: { type: "string" } }, required: ["repo", "user"] } },
  { name: "repoSetRole", description: "Changes a repository member role." + CONFIRM, parameters: { type: "object", properties: { account: acct, repo: repoP, user: { type: "string" }, role: { type: "string" } }, required: ["repo", "user", "role"] } },
  { name: "repoRemoveMember", description: "Removes a repository member. Danger action, for Trusted members only." + CONFIRM, parameters: { type: "object", properties: { account: acct, repo: repoP, user: { type: "string" } }, required: ["repo", "user"] } },
  { name: "repoInvitations", description: "Lists or cancels repository invitations." + CONFIRM, parameters: { type: "object", properties: { account: acct, repo: repoP, action: { type: "string", enum: ["list", "cancel"] }, id: { type: "number" } }, required: ["repo", "action"] } },
  { name: "repoDeployKeys", description: "Lists, creates, or deletes deploy keys." + CONFIRM, parameters: { type: "object", properties: { account: acct, repo: repoP, action: { type: "string", enum: ["list", "create", "delete"] }, id: { type: "number" }, title: { type: "string" }, key: { type: "string" }, readOnly: { type: "boolean" }, canPush: { type: "boolean" } }, required: ["repo", "action"] } },
  { name: "repoWebhooks", description: "Lists, creates, or deletes repository webhooks." + CONFIRM, parameters: { type: "object", properties: { account: acct, repo: repoP, action: { type: "string", enum: ["list", "create", "delete"] }, id: { type: "number" }, url: { type: "string" }, secret: { type: "string" }, events: { type: "array", items: { type: "string" } } }, required: ["repo", "action"] } },
  { name: "repoSecurityAlerts", description: "Reads dependency, secret-scanning, and code-scanning alerts.", parameters: { type: "object", properties: { account: acct, repo: repoP }, required: ["repo"] } },
  { name: "orgList", description: "Lists organizations or groups.", parameters: { type: "object", properties: { account: acct, page: pageP } } },
  { name: "orgMembers", description: "Lists organization or group members.", parameters: { type: "object", properties: { account: acct, org: { type: "string" }, page: pageP }, required: ["org"] } },
  { name: "orgTeams", description: "Lists teams or GitLab subgroups.", parameters: { type: "object", properties: { account: acct, org: { type: "string" }, page: pageP }, required: ["org"] } },
  { name: "orgCreateGroup", description: "Creates a GitLab group." + CONFIRM, parameters: { type: "object", properties: { account: acct, name: { type: "string" }, path: { type: "string" }, parentId: { type: "number" }, visibility: { type: "string" } }, required: ["name"] } },
  { name: "orgManageTeam", description: "Creates or manages organization teams/group members." + CONFIRM, parameters: { type: "object", properties: { account: acct, org: { type: "string" }, action: { type: "string", enum: ["create", "add", "update", "remove"] }, team: { type: "string" }, user: { type: "string" }, name: { type: "string" }, role: { type: "string" }, description: { type: "string" } }, required: ["org", "action"] } },
  { name: "repoWiki", description: "Reads or writes GitLab wiki pages." + CONFIRM, parameters: { type: "object", properties: { account: acct, repo: repoP, action: { type: "string", enum: ["list", "create", "update", "delete"] }, slug: { type: "string" }, title: { type: "string" }, content: { type: "string" } }, required: ["repo", "action"] } },
  { name: "repoSnippets", description: "Lists, creates, or deletes gists/snippets." + CONFIRM, parameters: { type: "object", properties: { account: acct, action: { type: "string", enum: ["list", "create", "delete"] }, id: { type: "string" }, title: { type: "string" }, description: { type: "string" }, files: { type: "object" }, public: { type: "boolean" } }, required: ["action"] } },
  { name: "repoPackages", description: "Lists or deletes package registry entries." + CONFIRM, parameters: { type: "object", properties: { account: acct, repo: repoP, action: { type: "string", enum: ["list", "delete"] }, type: { type: "string" }, name: { type: "string" }, versionId: { type: "number" }, id: { type: "number" } }, required: ["action"] } },
  { name: "repoNotifications", description: "Reads provider notifications or GitLab to-dos.", parameters: { type: "object", properties: { account: acct, page: pageP } } },
  { name: "repoStats", description: "Reads contributors, languages, or traffic statistics.", parameters: { type: "object", properties: { account: acct, repo: repoP, kind: { type: "string", enum: ["contributors", "languages", "traffic"] } }, required: ["repo", "kind"] } },
];

const MAX_WORK_QUERIES = 5, MAX_WORK_REPOS = 10, REPO_PAGES = 3;
const patternsOf = (a: GitAccess) => a.sets.length > 1 ? a.sets.map((s) => s.join(", ")).join(" AND ") : a.sets[0]!.join(", ");

const gitSkillTools = [...gitTools, ...issueBatchTools, ...playbookRepositoryTools, ...playbookDocumentTools, ...briefGroundingTools, ...briefIssuesTools];
const WITHOUT_ACCOUNT = new Set(["gitAccounts", ...playbookDocumentTools.map((t) => t.name)]);

export const gitRepositorySkill: SkillModule = {
  id: "git_repositories",
  name: "Git Repositories",
  category: "Git, code & APIs",
  description: "Browse and change repositories on the git accounts enabled for this server and channel (GitHub, GitLab, self-hosted GitLab).",
  tools: gitSkillTools,
  capabilities: ["git"],
  // Where no Git scope opens an account (a DM, web chat, or a channel without a rule) the tools that need one could only refuse, so they are not offered.
  // gitAccounts says none is enabled; writePlaybookDocument keeps a playbook's documents in the Workspace without a repository (ADR 0007).
  hiddenTools: async (ctx) => ((await loadGitAccess(ctx).catch(() => [])).length ? [] : gitSkillTools.map((t) => t.name).filter((name) => !WITHOUT_ACCOUNT.has(name))),
  hiddenReason: async () => GIT_NOT_ENABLED,
  // Git queues, scopes and confirms every write itself (gitShared.guard), per account and repository pattern.
  confirmsInternally: true,
  toolPolicy: gitToolPolicy,
  groups: GIT_GROUPS,
  handlers: {
    ...issueBatchHandlers,
    ...playbookRepositoryHandlers,
    ...playbookDocumentHandlers,
    ...briefGroundingHandlers,
    ...briefIssuesHandlers,
    gitAccounts: async (_a, ctx) => ({ accounts: (await loadGitAccess(ctx)).map((a) => ({ name: a.account.name, provider: a.account.provider, host: a.account.baseUrl ?? a.account.provider, repositories: patternsOf(a) })) }),
    repoList: async (a, ctx) => {
      const access = pickAccess(await loadGitAccess(ctx), a?.account);
      const res = await browseRepos(await connectionOf(access), page(a?.page), a?.query);
      return { account: access.account.name, ...res, items: (res.items as any[]).filter((r) => repoAllowed(access, r.repo)) };
    },
    repoMergeRequests: async (a, ctx) => { const { conn, repo } = await useRepo(a, ctx); return browseMergeRequests(conn, repo, page(a.page), state(a.state)); },
    repoMergeRequest: async (a, ctx) => { const { conn, repo } = await useRepo(a, ctx); return getMergeRequest(conn, repo, Number(a.number)); },
    repoIssues: async (a, ctx) => { const { conn, repo } = await useRepo(a, ctx); return browseIssues(conn, repo, page(a.page), state(a.state), labelsOf(a.labels)); },
    repoBranches: async (a, ctx) => { const { conn, repo } = await useRepo(a, ctx); return browseBranches(conn, repo, page(a.page)); },
    repoCommits: async (a, ctx) => {
      const { conn, repo } = await useRepo(a, ctx), when = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
      return browseCommits(conn, repo, page(a.page), typeof a.branch === "string" ? a.branch : undefined, { since: when(a.since), until: when(a.until) });
    },
    repoMembers: async (a, ctx) => { const { conn, repo } = await useRepo(a, ctx); return browseMembers(conn, repo, page(a.page)); },
    repoReadFile: async (a, ctx) => { const { conn, repo } = await useRepo(a, ctx), line = (v: unknown) => (typeof v === "number" ? v : undefined); return readFilePage(conn, repo, str(a.path, "path"), a.ref, line(a.fromLine), line(a.toLine)); },
    repoFindDefinition: async (a, ctx) => { const { conn, repo } = await useRepo(a, ctx); return findDefinition(conn, repo, str(a.ref, "ref"), str(a.name, "name"), typeof a.path === "string" && a.path.trim() ? a.path : undefined); },
    repoPipelines: async (a, ctx) => { const { conn, repo } = await useRepo(a, ctx); return browsePipelines(conn, repo, page(a.page), typeof a.branch === "string" ? a.branch : undefined); },
    repoPipelineJobs: async (a, ctx) => { const { conn, repo } = await useRepo(a, ctx); return pipelineJobs(conn, repo, num(a.id)); },
    repoJobLog: async (a, ctx) => { const { conn, repo } = await useRepo(a, ctx); return jobLog(conn, repo, num(a.jobId)); },
    repoTags: async (a, ctx) => { const { conn, repo } = await useRepo(a, ctx); return browseTags(conn, repo, page(a.page)); },
    repoReleases: async (a, ctx) => { const { conn, repo } = await useRepo(a, ctx); return browseReleases(conn, repo, page(a.page)); },
    repoCommit: async (a, ctx) => { const { conn, repo } = await useRepo(a, ctx); return getCommit(conn, repo, str(a.sha, "sha")); },
    repoCompare: async (a, ctx) => { const { conn, repo } = await useRepo(a, ctx); return compareRefs(conn, repo, str(a.from, "from"), str(a.to, "to"), page(a.page)); },
    repoFileDiff: async (a, ctx) => { const { conn, repo } = await useRepo(a, ctx); return fileDiff(conn, repo, str(a.from, "from"), str(a.to, "to"), str(a.path, "path")); },
    repoTree: async (a, ctx) => { const { conn, repo } = await useRepo(a, ctx); return browseTree(conn, repo, str(a.ref, "ref"), typeof a.path === "string" ? a.path : undefined, page(a.page)); },
    repoIssue: async (a, ctx) => { const { conn, repo } = await useRepo(a, ctx); return getIssue(conn, repo, num(a.number)); },
    repoComments: async (a, ctx) => { const { conn, repo } = await useRepo(a, ctx); return itemComments(conn, repo, num(a.number), kindOf(a.kind), page(a.page)); },
    repoSearchWork: async (a, ctx) => {
      const queries = wordingsOf(a?.query, a?.queries).map((q) => q.trim()).filter(Boolean).slice(0, MAX_WORK_QUERIES);
      if (!queries.length) throw new Error(`Pass "queries": wordings of the work, such as ["normalisasi audio", "audio normalization"]`);
      if (typeof a?.repo === "string" && a.repo.trim()) {
        const { conn, repo } = await useRepo(a, ctx);
        return { searched: [repo], items: await searchWork(conn, repo, queries) };
      }
      const all = await loadGitAccess(ctx);
      const accesses = a?.account || !all.length ? [pickAccess(all, a?.account)] : all;
      // The repositories repoList shows: the account's own, kept only where the Git scope opens them.
      const targets: { conn: GitConn; repo: string }[] = [];
      let open = 0;
      for (const access of accesses) {
        const conn = await connectionOf(access);
        for (let p = 1; p <= REPO_PAGES; p++) {
          const res = await browseRepos(conn, p);
          for (const r of res.items as any[]) {
            if (!repoAllowed(access, r.repo) || targets.some((t) => t.repo === r.repo)) continue;
            open++;
            if (targets.length < MAX_WORK_REPOS) targets.push({ conn, repo: r.repo });
          }
          if (!res.hasMore) break;
        }
      }
      const items: WorkHit[] = [];
      for (const t of targets) items.push(...await searchWork(t.conn, t.repo, queries));
      // Across repositories as within one: best match first, the date breaking ties (#247).
      const ranked = rankWork(items, queriesTerms(queries));
      items.splice(0, items.length, ...ranked);
      const left = open - targets.length;
      return { searched: targets.map((t) => t.repo), items, ...(left > 0 ? { notSearched: `${left} more repositories open here were not searched; pass repo to search one of them.` } : {}) };
    },
    repoSearchCode: async (a, ctx) => { const { conn, repo } = await useRepo(a, ctx); return searchCode(conn, repo, str(a.query, "query"), page(a.page)); },
    repoCreateBranch: (a, ctx) => confirmable("repoCreateBranch", a, ctx, (repo, account) => {
      const branch = str(a.branch, "branch"), from = typeof a.from === "string" && a.from.trim() ? a.from.trim() : undefined;
      return { summary: `Create branch ${branch} in ${repo} from ${from ?? "the default branch"} [account ${account}]`, run: (c) => createBranch(c, repo, branch, from) };
    }),
    repoRetryPipeline: (a, ctx) => confirmable("repoRetryPipeline", a, ctx, (repo, account) => {
      const id = num(a.id);
      return { summary: `Re-run failed jobs of pipeline ${id} in ${repo} [account ${account}]`, run: (c) => retryPipeline(c, repo, id) };
    }),
    repoWriteFile: (a, ctx) => confirmable("repoWriteFile", a, ctx, (repo, account) => {
      if (typeof a.content !== "string") throw new Error("content is required");
      const path = str(a.path, "path"), message = str(a.message, "message"), branch = str(a.branch, "branch");
      return { summary: `Commit "${clip(message, 80)}" to ${repo} on branch ${branch}: write ${path} (${a.content.length} characters) [account ${account}]`, run: (c) => writeFile(c, repo, path, a.content, message, branch) };
    }),
    repoOpenPullRequest: (a, ctx) => confirmable("repoOpenPullRequest", a, ctx, (repo, account) => {
      const branch = str(a.branch, "branch"), title = str(a.title, "title");
      return { summary: `Open a pull/merge request "${clip(title, 80)}" in ${repo} from ${branch} into the default branch [account ${account}]`, run: (c) => openPullRequest(c, repo, branch, title, a.body) };
    }),
    repoComment: (a, ctx) => confirmable("repoComment", a, ctx, (repo, account) => {
      const n = num(a.number), kind = kindOf(a.kind), body = str(a.body, "body");
      return { summary: `Comment on ${repo}#${n} (${kind.replace("_", " ")}) [account ${account}]: ${clip(body)}`, run: (c) => commentOn(c, repo, n, kind, body) };
    }),
    repoCreateIssue: (a, ctx) => confirmable("repoCreateIssue", a, ctx, (repo, account) => {
      const title = str(a.title, "title"), labels = labelsOf(a.labels);
      return { summary: `Create issue "${clip(title, 100)}" in ${repo}${labels.length ? ` with labels ${labels.join(", ")}` : ""} [account ${account}]`, run: (c) => createIssue(c, repo, title, typeof a.body === "string" ? a.body : undefined, labels) };
    }),
    repoLinkIssues: (a, ctx) => confirmable("repoLinkIssues", a, ctx, (repo, account) => {
      const issue = num(a.issue), blockedBy = num(a.blockedBy);
      if (issue === blockedBy) throw new Error("An issue cannot block itself");
      return { summary: `Mark ${repo}#${issue} as blocked by #${blockedBy} [account ${account}]`, run: (c) => linkIssues(c, repo, issue, blockedBy) };
    }),
    repoSubIssue: (a, ctx) => confirmable("repoSubIssue", a, ctx, (repo, account) => {
      const parent = num(a.parent), child = num(a.child), action = a.action;
      if (action !== "attach" && action !== "detach") throw new Error("action must be attach or detach");
      if (parent === child) throw new Error("An issue cannot be its own sub-issue");
      return { summary: `${action === "attach" ? "Attach" : "Detach"} ${repo}#${child} ${action === "attach" ? "under" : "from"} #${parent} [account ${account}]`, run: (c) => subIssue(c, repo, parent, child, action) };
    }),
    repoMergeMergeRequest: (a, ctx) => confirmable("repoMergeMergeRequest", a, ctx, (repo, account) => {
      const n = num(a.number);
      return { summary: `MERGE ${repo}#${n} into its target branch [account ${account}]`, run: (c) => mergeMergeRequest(c, repo, n) };
    }),
    repoCloseItem: (a, ctx) => confirmable("repoCloseItem", a, ctx, (repo, account) => {
      const n = num(a.number), kind = kindOf(a.kind);
      return { summary: `Close ${repo}#${n} (${kind.replace("_", " ")}) without merging [account ${account}]`, run: (c) => closeItem(c, repo, n, kind) };
    }),
    repoUpdateMergeRequest: (a, ctx) => confirmable("repoUpdateMergeRequest", a, ctx, (repo, account) => {
      const n = num(a.number), patch = { ...(typeof a.title === "string" ? { title: a.title } : {}), ...(typeof a.body === "string" ? { body: a.body } : {}), ...(typeof a.target === "string" ? { target: a.target } : {}), ...(typeof a.draft === "boolean" ? { draft: a.draft } : {}) };
      if (!Object.keys(patch).length) throw new Error("at least one field is required");
      return { summary: `Update pull/merge request ${repo}#${n} [account ${account}]`, run: (c) => updateMergeRequest(c, repo, n, patch) };
    }),
    repoReopenItem: (a, ctx) => confirmable("repoReopenItem", a, ctx, (repo, account) => { const n = num(a.number), k = kindOf(a.kind); return { summary: `Reopen ${repo}#${n} (${k}) [account ${account}]`, run: (c) => reopenItem(c, repo, n, k) }; }),
    repoReviewMergeRequest: (a, ctx) => confirmable("repoReviewMergeRequest", a, ctx, (repo, account) => { const n = num(a.number), event = a.event; if (!["approve", "request_changes", "comment"].includes(event)) throw new Error("event must be approve, request_changes or comment"); return { summary: `Review ${repo}#${n}: ${event} [account ${account}]`, run: (c) => reviewMergeRequest(c, repo, n, event, typeof a.body === "string" ? a.body : undefined) }; }),
    repoRequestReviewers: (a, ctx) => confirmable("repoRequestReviewers", a, ctx, (repo, account) => { const n = num(a.number), reviewers = Array.isArray(a.reviewers) ? a.reviewers.map((x: any) => str(x, "reviewer")) : []; return { summary: `Request reviewers for ${repo}#${n}: ${reviewers.join(", ")} [account ${account}]`, run: (c) => requestReviewers(c, repo, n, reviewers) }; }),
    repoMergeRequestDiff: async (a, ctx) => { const { conn, repo } = await useRepo(a, ctx); return mergeRequestDiff(conn, repo, num(a.number)); },
    repoChecks: async (a, ctx) => { const { conn, repo } = await useRepo(a, ctx); return repoChecks(conn, repo, str(a.ref, "ref")); },
    repoRebaseMergeRequest: (a, ctx) => confirmable("repoRebaseMergeRequest", a, ctx, (repo, account) => { const n = num(a.number); return { summary: `Rebase merge request ${repo}#${n} [account ${account}]`, run: (c) => rebaseMergeRequest(c, repo, n) }; }),
    repoUpdateIssue: (a, ctx) => confirmable("repoUpdateIssue", a, ctx, (repo, account) => { const n = num(a.number), patch = { ...(typeof a.title === "string" ? { title: a.title } : {}), ...(typeof a.body === "string" ? { body: a.body } : {}) }; if (!Object.keys(patch).length) throw new Error("at least one field is required"); return { summary: `Update issue ${repo}#${n} [account ${account}]`, run: (c) => updateIssue(c, repo, n, patch) }; }),
    repoAssign: (a, ctx) => confirmable("repoAssign", a, ctx, (repo, account) => { const n = num(a.number), k = kindOf(a.kind), assignees = Array.isArray(a.assignees) ? a.assignees.map((x: any) => str(x, "assignee")) : []; return { summary: `Set assignees on ${repo}#${n}: ${assignees.join(", ")} [account ${account}]`, run: (c) => assignItem(c, repo, n, k, assignees) }; }),
    repoLabels: async (a, ctx) => { const { conn, repo } = await useRepo(a, ctx); return listLabels(conn, repo, page(a.page)); },
    repoSetLabels: (a, ctx) => confirmable("repoSetLabels", a, ctx, (repo, account) => { const n = num(a.number), k = kindOf(a.kind), labels = Array.isArray(a.labels) ? a.labels.map((x: any) => str(x, "label")) : []; return { summary: `Set labels on ${repo}#${n}: ${labels.join(", ")} [account ${account}]`, run: (c) => setLabels(c, repo, n, k, labels) }; }),
    repoLockItem: (a, ctx) => confirmable("repoLockItem", a, ctx, (repo, account) => { const n = num(a.number), k = kindOf(a.kind); if (typeof a.locked !== "boolean") throw new Error("locked is required"); return { summary: `${a.locked ? "Lock" : "Unlock"} ${repo}#${n} discussion [account ${account}]`, run: (c) => lockItem(c, repo, n, k, a.locked) }; }),
    repoEditComment: (a, ctx) => confirmable("repoEditComment", a, ctx, (repo, account) => { const id = num(a.id), k = kindOf(a.kind), body = str(a.body, "body"); return { summary: `Edit comment ${id} in ${repo} [account ${account}]`, run: (c) => editComment(c, repo, id, k, body) }; }),
    repoDeleteComment: (a, ctx) => guard("repoDeleteComment", a, ctx, "trusted", "repo", (repo, account) => { const id = num(a.id), k = kindOf(a.kind); return { summary: `DELETE comment ${id} in ${repo}`, run: (c) => deleteComment(c, repo, id, k) }; }),
    repoCreate: (a, ctx) => guard("repoCreate", a, ctx, "write", "account", (_target, account) => { const name = str(a.name, "name"); return { summary: `Create repository ${name}`, run: (c) => createRepo(c, name, a) }; }),
    repoUpdateSettings: (a, ctx) => guard("repoUpdateSettings", a, ctx, "trusted", "repo", (repo) => ({ summary: `Update settings for ${repo}`, run: (c) => updateRepoSettings(c, repo, a) })),
    repoRename: (a, ctx) => confirmable("repoRename", a, ctx, (repo) => { const name = str(a.name, "name"); return { summary: `Rename ${repo} to ${name}`, run: (c) => renameRepo(c, repo, name) }; }),
    repoArchive: (a, ctx) => guard("repoArchive", a, ctx, "trusted", "repo", (repo) => { if (typeof a.archived !== "boolean") throw new Error("archived is required"); return { summary: `${a.archived ? "Archive" : "Unarchive"} ${repo}`, run: (c) => archiveRepo(c, repo, a.archived) }; }),
    repoDelete: (a, ctx) => guard("repoDelete", a, ctx, "trusted", "repo", (repo) => ({ summary: `DELETE repository ${repo}`, run: (c) => deleteRepo(c, repo) })),
    repoFork: (a, ctx) => confirmable("repoFork", a, ctx, (repo) => ({ summary: `Fork ${repo}`, run: (c) => forkRepo(c, repo, a) })),
    repoTransfer: (a, ctx) => guard("repoTransfer", a, ctx, "trusted", "repo", (repo) => ({ summary: `TRANSFER ${repo} to ${str(a.target, "target")}`, run: (c) => transferRepo(c, repo, a.target) })),
    repoDeleteBranch: (a, ctx) => guard("repoDeleteBranch", a, ctx, "trusted", "repo", (repo) => { const branch = str(a.branch, "branch"); return { summary: `DELETE branch ${branch} in ${repo}`, run: (c) => deleteBranch(c, repo, branch) }; }),
    repoProtectBranch: (a, ctx) => guard("repoProtectBranch", a, ctx, "trusted", "repo", (repo) => { const branch = str(a.branch, "branch"); return { summary: `Protect branch ${branch} in ${repo}`, run: (c) => protectBranch(c, repo, branch, a) }; }),
    repoGetProtection: async (a, ctx) => { const { conn, repo } = await useRepo(a, ctx); return getBranchProtection(conn, repo, str(a.branch, "branch")); },
    repoCreateTag: (a, ctx) => confirmable("repoCreateTag", a, ctx, (repo) => { const tag = str(a.tag, "tag"); return { summary: `Create tag ${tag} in ${repo}`, run: (c) => createTag(c, repo, tag, a.ref) }; }),
    repoDeleteTag: (a, ctx) => guard("repoDeleteTag", a, ctx, "trusted", "repo", (repo) => { const tag = str(a.tag, "tag"); return { summary: `DELETE tag ${tag} in ${repo}`, run: (c) => deleteTag(c, repo, tag) }; }),
    repoCreateRelease: (a, ctx) => confirmable("repoCreateRelease", a, ctx, (repo) => { const tag = str(a.tag, "tag"); return { summary: `Create release ${tag} in ${repo}`, run: (c) => createRelease(c, repo, { ...a, tag }) }; }),
    repoDeleteRelease: (a, ctx) => guard("repoDeleteRelease", a, ctx, "trusted", "repo", (repo) => { const release = str(a.release, "release"); return { summary: `DELETE release ${release} in ${repo}`, run: (c) => deleteRelease(c, repo, release) }; }),
    repoDeleteFile: (a, ctx) => confirmable("repoDeleteFile", a, ctx, (repo) => { const path = str(a.path, "path"), message = str(a.message, "message"), branch = str(a.branch, "branch"); return { summary: `Delete ${path} in ${repo} on branch ${branch}`, run: (c) => deleteFile(c, repo, path, message, branch) }; }),
    repoMoveFile: (a, ctx) => confirmable("repoMoveFile", a, ctx, (repo) => { const from = str(a.from, "from"), to = str(a.to, "to"), message = str(a.message, "message"), branch = str(a.branch, "branch"); return { summary: `Move ${from} to ${to} in ${repo} on branch ${branch}`, run: (c) => moveFile(c, repo, from, to, message, branch) }; }),
    repoCommitFiles: (a, ctx) => confirmable("repoCommitFiles", a, ctx, (repo) => { const message = str(a.message, "message"), branch = str(a.branch, "branch"); if (!Array.isArray(a.files)) throw new Error("files is required"); return { summary: `Commit ${a.files.length} files in ${repo} on branch ${branch}`, run: (c) => commitFiles(c, repo, a.files, message, branch) }; }),
    repoWriteDefaultBranch: (a, ctx) => guard("repoWriteDefaultBranch", a, ctx, "trusted", "repo", (repo) => { if (!Array.isArray(a.files)) throw new Error("files is required"); return { summary: `⚠️ WRITE DEFAULT BRANCH ${repo}`, run: (c) => commitToDefaultBranch(c, repo, a.files, str(a.message, "message")) }; }),
    repoRunPipeline: (a, ctx) => confirmable("repoRunPipeline", a, ctx, (repo) => ({ summary: `Run pipeline for ${repo}`, run: (c) => runPipeline(c, repo, a.ref) })),
    repoCancelPipeline: (a, ctx) => confirmable("repoCancelPipeline", a, ctx, (repo) => { const id = num(a.id); return { summary: `Cancel pipeline ${id} in ${repo}`, run: (c) => cancelPipeline(c, repo, id) }; }),
    repoArtifacts: async (a, ctx) => { const { conn, repo } = await useRepo(a, ctx); return a.id ? downloadArtifact(conn, repo, num(a.id)) : listArtifacts(conn, repo, page(a.page)); },
    repoSchedules: (a, ctx) => a.action === "list" ? (async () => { const { conn, repo } = await useRepo(a, ctx); return schedules(conn, repo, a); })() : confirmable("repoSchedules", a, ctx, (repo) => ({ summary: `Change pipeline schedule in ${repo}`, run: (c) => schedules(c, repo, a) })),
    repoVariables: (a, ctx) => a.action === "list" ? (async () => { const { conn, repo } = await useRepo(a, ctx); return variables(conn, repo, a); })() : confirmable("repoVariables", a, ctx, (repo) => ({ summary: `${a.action} CI variable ${a.name ?? ""} in ${repo}`, run: (c) => variables(c, repo, a) })),
    repoSecrets: (a, ctx) => a.action === "list" ? (async () => { const { conn, repo } = await useRepo(a, ctx); return secrets(conn, repo, a); })() : guard("repoSecrets", a, ctx, "trusted", "repo", (repo) => ({ summary: `${a.action} secret ${a.name ?? ""} in ${repo}`, run: (c) => secrets(c, repo, a) })),
    repoRunners: (a, ctx) => a.action === "list" ? (async () => { const { conn, repo } = await useRepo(a, ctx); return runners(conn, repo, a); })() : guard("repoRunners", a, ctx, "trusted", "repo", (repo) => ({ summary: `${a.action} runner ${a.id ?? ""} in ${repo}`, run: (c) => runners(c, repo, a) })),
    repoAddMember: (a, ctx) => confirmable("repoAddMember", a, ctx, (repo) => ({ summary: `Add member ${a.user} to ${repo}`, run: (c) => member(c, repo, { ...a, action: "add" }) })),
    repoSetRole: (a, ctx) => confirmable("repoSetRole", a, ctx, (repo) => ({ summary: `Set role for ${a.user} in ${repo}`, run: (c) => member(c, repo, { ...a, action: "set" }) })),
    repoRemoveMember: (a, ctx) => guard("repoRemoveMember", a, ctx, "trusted", "repo", (repo) => ({ summary: `REMOVE member ${a.user} from ${repo}`, run: (c) => member(c, repo, { ...a, action: "remove" }) })),
    repoInvitations: (a, ctx) => a.action === "list" ? (async () => { const { conn, repo } = await useRepo(a, ctx); return invitations(conn, repo, a); })() : guard("repoInvitations", a, ctx, "trusted", "repo", (repo) => ({ summary: `Cancel invitation ${a.id} in ${repo}`, run: (c) => invitations(c, repo, a) })),
    repoDeployKeys: (a, ctx) => a.action === "list" ? (async () => { const { conn, repo } = await useRepo(a, ctx); return deployKeys(conn, repo, a); })() : guard("repoDeployKeys", a, ctx, "trusted", "repo", (repo) => ({ summary: `${a.action} deploy key in ${repo}`, run: (c) => deployKeys(c, repo, a) })),
    repoWebhooks: (a, ctx) => a.action === "list" ? (async () => { const { conn, repo } = await useRepo(a, ctx); return webhooks(conn, repo, a); })() : guard("repoWebhooks", a, ctx, "trusted", "repo", (repo) => ({ summary: `${a.action} webhook in ${repo}`, run: (c) => webhooks(c, repo, a) })),
    repoSecurityAlerts: async (a, ctx) => { const { conn, repo } = await useRepo(a, ctx); return securityAlerts(conn, repo); },
    orgList: async (a, ctx) => { const access = pickAccess(await loadGitAccess(ctx), a?.account); return orgList(await connectionOf(access), page(a?.page)); },
    orgMembers: async (a, ctx) => { const access = pickAccess(await loadGitAccess(ctx), a?.account); return orgMembers(await connectionOf(access), str(a.org, "org"), page(a.page)); },
    orgTeams: async (a, ctx) => { const access = pickAccess(await loadGitAccess(ctx), a?.account); return orgTeams(await connectionOf(access), str(a.org, "org"), page(a.page)); },
    orgCreateGroup: (a, ctx) => guard("orgCreateGroup", a, ctx, "trusted", "account", () => ({ summary: `Create group ${str(a.name, "name")}`, run: (c) => createGroup(c, a) })),
    orgManageTeam: (a, ctx) => guard("orgManageTeam", a, ctx, "trusted", "org", (org) => ({ summary: `${a.action} team/member in ${org}`, run: (c) => manageTeam(c, org, a) })),
    repoWiki: (a, ctx) => a.action === "list" ? (async () => { const { conn, repo } = await useRepo(a, ctx); return wiki(conn, repo, a); })() : confirmable("repoWiki", a, ctx, (repo) => ({ summary: `${a.action} wiki page in ${repo}`, run: (c) => wiki(c, repo, a) })),
    repoSnippets: (a, ctx) => a.action === "list" ? (async () => { const access = pickAccess(await loadGitAccess(ctx), a?.account); return snippets(await connectionOf(access), a); })() : guard("repoSnippets", a, ctx, "write", "account", (_target, account) => ({ summary: `${a.action} snippet [account ${account}]`, run: (c) => snippets(c, a) })),
    repoPackages: (a, ctx) => a.action === "list" ? (async () => { const { conn, repo } = await useRepo(a, ctx); return packages(conn, repo, a); })() : guard("repoPackages", a, ctx, "trusted", "repo", (repo) => ({ summary: `DELETE package ${a.name ?? a.id} in ${repo}`, run: (c) => packages(c, repo, a) })),
    repoNotifications: async (a, ctx) => { const access = pickAccess(await loadGitAccess(ctx), a?.account); return notifications(await connectionOf(access), page(a?.page)); },
    repoStats: async (a, ctx) => { const { conn, repo } = await useRepo(a, ctx); return stats(conn, repo, a); },
  },
};
