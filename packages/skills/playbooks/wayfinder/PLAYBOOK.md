---
description: Plans a large piece of work as a map issue with decision tickets in the thread's repository, then resolves the tickets one thread at a time until the way is clear.
default: off
loads: ["grilling", "domain-modeling"]
requires: ["git_repositories"]
optional: ["workspace", "discord_management"]
repository: required
license: MIT, adapted from mattpocock/skills; the notice is in LICENSE.md
---
A loose idea has arrived, too big for one thread, and wrapped in fog: the way from here to the **destination** is not visible yet. Wayfinding is about finding that way, not charging at the destination. This playbook charts the way as a **shared map** in this thread's repository, then works its **decision tickets** (questions whose resolution is a decision, not slices of a build to execute) one at a time until the route is clear.

The destination varies per effort, and naming it is the first act of charting: it shapes every ticket. It might be a spec to hand off and iterate on, a decision to lock before planning starts, or a change made in place like a data migration. The map is domain-agnostic: engineering work, course content, whatever fits the shape.

Only the person who started this thread decides. Others give input.

## Plan, don't do

Wayfinding is **planning** by default: each ticket resolves a decision, and the map is done when the way is clear, with nothing left to decide before someone goes and does the thing. The pull to just do the work is usually the signal that you have reached the edge of the map and it is time to hand off. An effort can override this in its **Notes**, carrying execution into the map itself, but absent that, produce decisions, not deliverables.

## Refer by name

Every map and ticket is an issue, so it has a **name**: its title. In everything people read (your messages, the map's Decisions so far, ticket bodies), refer to it by that name, never by a bare number. A wall of `#42, #43, #44` is illegible; names read at a glance. The link does not vanish: wrap it in the name, as `[Pick the queue](https://...)`, once the issue exists.

## The repository

Call `playbookRepositories` first, unless the prompt already names this thread's repository. With several allowed, ask the person who started the thread which one, in one line, and wait. The map and its tickets live there.

Call `repoLabels` once. A map carries the label `wayfinder:map`, and each ticket one of `wayfinder:research`, `wayfinder:prototype`, `wayfinder:grilling`, `wayfinder:task`. When the repository lacks one, say in your preview that the first issue using it adds it.

## The map

The map is a single issue labelled `wayfinder:map`, the canonical artifact. Its tickets are its sub-issues.

The map is an **index**, not a store. It lists the decisions made and points at the tickets that hold their detail; a decision lives in exactly one place, its ticket, so the map never restates it, only gists it and links.

### The map body

The whole map at low resolution, read once per thread. Open tickets are **not** listed: they are open sub-issues, found by query.

```markdown
## Destination

<what reaching the end of this map looks like: the spec, decision, or change this effort is finding its way to. One or two lines; every thread orients to it before choosing a ticket.>

## Notes

<domain; playbooks every thread should follow; standing preferences for this effort>

## Decisions so far

<!-- the index: one line per closed ticket, enough to judge relevance, then follow the link for the detail the ticket holds -->

- [<closed ticket title>](link): <one-line gist of the answer>

## Not yet specified

<!-- see "Fog of war": in-scope fog you cannot ticket yet; graduates as the frontier advances -->

## Out of scope

<!-- see "Out of scope": work ruled beyond the destination; closed, never graduates -->
```

### Tickets

Each ticket is a **sub-issue** of the map; its issue number is its identity. Its body is the question, sized to one thread:

```markdown
Map: <the map's title>
Blocked by: <the titles of the tickets that block this one, or "nothing">

## Question

<the decision or investigation this ticket resolves>
```

The `Map:` and `Blocked by:` lines name issues by title, because no tool lists a map's sub-issues or an issue's blockers: they are how a later thread finds the map's tickets and the frontier. The native links the batch records show the same thing in the tracker's own UI.

Each ticket carries one `wayfinder:<type>` label (see Ticket types). `wayfinder:` labels are the only labels a map and its tickets carry, never a triage label like `ready-for-agent`: they are decisions, not implementation work.

A thread **claims** a ticket by assigning it to the person driving the map, **first**, before any work, so other threads skip it. That assignee _is_ the claim: an open, unassigned ticket is unclaimed.

Blocking uses the tracker's **native** blocking link, which the batch records. A ticket is **unblocked** when every ticket blocking it is closed; the **frontier** is the open, unblocked, unclaimed tickets, the edge of the known.

The answer is not part of the body; it is recorded on resolution (see Work through the map). Things made while resolving a ticket are linked from the issue, not pasted in.

## Ticket types

Every ticket is either **HITL** (human in the loop: worked _with_ a person who speaks for themselves) or **AFK** (driven by you alone). A HITL ticket only resolves through that live exchange; you never stand in for the person's side of it (an interview that answers its own questions has broken this).

- **Research** (AFK): reading code, issues, documents in the Workspace, or other repositories git scope allows, to surface a fact a decision waits on. Resolved in its own thread with the read tools. There is no web fetch, so a fact that only lives on the web becomes a task ticket for a person.
- **Prototype** (HITL): raise the fidelity of the discussion with a cheap, rough, concrete thing to react to: an outline, a rough take, a stub. You cannot run code, so a runnable prototype is a person's job; link it as an asset. Use when "how should it look" or "how should it behave" is the key question.
- **Grilling** (HITL): conversation. The default case. Follow the loaded `grilling` and `domain-modeling` playbooks.
- **Task** (HITL or AFK): manual work that must happen before a _decision_ can be made: nothing to decide, prototype, or research, but the discussion is blocked until it is done. Signing up for a service so its API can be judged, provisioning access, moving data so its shape can be seen. This is the one type that _does_ rather than decides, and it earns its place by unblocking a decision, not by delivering the destination. Do it yourself where your tools can; otherwise hand the person a precise checklist. Resolved when the work is done; the answer records what was done and any resulting facts (where credentials live, new URLs, row counts) that later tickets depend on.

## Fog of war

The map is _deliberately_ incomplete: do not chart what you cannot yet see. Beyond the live tickets lies the **fog of war**: the dim view of decisions and investigations you can tell are coming but cannot yet pin down, because they hang on questions still open. Resolving a ticket clears the fog ahead of it, graduating whatever is now specifiable into fresh tickets, until the way to the destination is clear and no tickets remain.

The map's **Not yet specified** section is where that dim view is written down: the suspected question, the area to revisit later. Everything there is in scope, just not sharp enough to ticket.

**Fog or ticket?** The test is whether you can state the question precisely now, _not_ whether you can answer it now.

- **Ticket when** the question is already sharp, even if it is blocked and you cannot act on it yet.
- **Not yet specified when** you cannot yet phrase it that sharply. Do not pre-slice the fog into ticket-sized pieces: one patch may graduate into several tickets, or none, once the frontier reaches it.

**Not yet specified** excludes what is already decided (Decisions so far), what is already a live ticket, and what is out of scope.

## Out of scope

Fog only gathers _toward_ the destination. Work beyond it is **out of scope**: it gets its own **Out of scope** section on the map, work consciously ruled out of _this_ effort. It never graduates; it returns only if the destination is redrawn, and then as a fresh effort.

When a ticket that already exists turns out to sit past the destination, **close it** and leave one line in **Out of scope**: the gist plus why, linking the closed ticket. It stays out of **Decisions so far**, which records the route actually walked.

## Writes and confirmation

Every write waits for the person who asked to press Confirm, and after Confirm you get no further turn: the result shows on the confirmation message. So make at most one write per reply, say what it does, and wait for the person to come back before the next. Put every issue you create at once in one `repoCreateIssues` call and every label, state, or assignee change at once in one `repoUpdateIssues` call, so a set of changes is one Confirm. A batch holds at most 25 issues.

## Start: chart the map

The person starts this playbook with a loose idea. When they give a map instead (a link or `#` and a number), go to Work through the map.

1. **Name the destination.** Follow the loaded `grilling` and `domain-modeling` playbooks to pin down what this map is finding its way to: the spec, decision, or change. The destination fixes the scope, so it is settled first.
2. **Map the frontier.** Grill again, **breadth-first** this time: fan out across the whole space rather than deep on any one thread of it, surfacing the open decisions and the first steps takeable now. **If this surfaces no fog** (the way is already clear, the whole journey small enough for one thread), you do not need a map: stop and ask the person how they would like to go on.
3. **Preview the map.** Post the map's title and Destination, then the tickets you can specify now as a numbered list: title, type, and what blocks it. Keep it under 1,800 characters. Ask the person to confirm; iterate until they do.
4. **Create the map and its first tickets in one batch** with `repoCreateIssues`: the map as one item (ref `map`, label `wayfinder:map`, the body with Destination and Notes filled in, Decisions so far empty, the fog sketched into Not yet specified), and each ticket as an item with `parent: "map"`, its `wayfinder:<type>` label, and **blockedBy** naming the refs of the tickets that block it. The batch creates the map and the blockers first and links everything, behind one Confirm. Never write a guessed `#` number into a body: a placeholder links to an unrelated issue.
5. Stop: charting is one thread's work. Tell the person that each ticket on the frontier is worked in its own thread by starting this playbook with the map's link, and that research tickets can go first because they need no one.

## Work through the map

The person starts this playbook with a map (a link or `#` and a number), and optionally a ticket. Without one, you pick the next decision, not the person. **Never resolve more than one ticket per thread.**

1. Read the **map** with `repoIssue`: the low-resolution view, not every ticket body.
2. Find the tickets: `repoIssues` with each `wayfinder:` ticket label, open, then `repoIssue` on the ones whose `Map:` line names this map, for their blockers and assignees. Choose the ticket: the one the person named, or else the first frontier ticket in order. **Claim it**: ask for the person's username on the git provider, and assign them with `repoAssign` before any work.
3. Resolve it as the type its `wayfinder:` label names (see Ticket types). Read the label, not just the body: the body never states the type. Read any related or closed ticket with `repoIssue` and `repoComments` as needed, and follow whatever the map's Notes name. If in doubt, follow the loaded `grilling` and `domain-modeling` playbooks.
4. Record the resolution, one write per reply: post the answer as a **resolution comment** with `repoComment`; then change the map's body with `repoUpdateIssue`, adding a line to Decisions so far; then close the ticket with `repoUpdateIssues`, together with any ticket you rule out of scope.
5. Add the tickets this answer surfaced in one `repoCreateIssues` batch, each with `parent: "#<the map's number>"` and **blockedBy** naming refs of the batch or `"#<number>"` of existing tickets; graduate any fog the answer made specifiable, clearing each graduated patch from Not yet specified so it lives only as its new ticket. If the answer reveals that a ticket sits beyond the destination, rule it out of scope rather than resolving it on the route. If the decision invalidates other parts of the map, update or close those tickets.

Other threads may be working other tickets of the same map at the same time, so read an issue again before you change it.
