/**
 * Write tools that set up Plane projects (group "Project admin"): creating a Plane project, and creating or changing its
 * states and labels. `projectCreate` reaches the whole Plane workspace, so it is a workspace-level tool (see
 * `WORKSPACE_LEVEL_TOOLS`): offered only where the Plane scope is "all Plane projects", and the Plane project it creates
 * joins no narrower scope.
 */
import type { ToolDefinition, ToolPolicy } from "../types.js";
import { planeRequest, inWorkspace } from "./client.js";
import { resolvePlaneProject, planeTargetOf, PROJECT_ARGS, type PlaneTarget, type PlaneProjectTarget } from "./projectRef.js";
import { projectNames, projectStates, projectLabels, projectMembers, pickByName, planeUserAliases, planeUserName, ME } from "./resolve.js";
import { pickWorkspaceAccess } from "./workspace.js";
import { text, title } from "./args.js";
import { planeWrite, DANGER, DANGER_NOTE, type PlaneRefusals } from "./write.js";

type Obj = Record<string, any>;

const CONFIRM = " Waits for the asker's Confirm in Discord before anything changes.";
export const STATE_GROUPS = ["backlog", "unstarted", "started", "completed", "cancelled"];
/** Plane needs a color for a state; these follow Plane's own defaults per group. */
const GROUP_COLORS: Record<string, string> = { backlog: "#A3A3A3", unstarted: "#3A3A3A", started: "#F59E0B", completed: "#16A34A", cancelled: "#EF4444" };
/** Plane refuses these characters in a Plane project's name and identifier alike. */
const SPECIAL = /[&+,:;$^}{*=?@#|'<>.()%!-]/;
const IDENTIFIER = /^[A-Za-z0-9]{1,12}$/;
const COLOR = { type: "string", description: "A hex color such as #F59E0B." };
/** Plane's role numbers, the same in a Plane project and the Plane workspace. */
export const MEMBER_ROLES: Record<string, number> = { admin: 20, member: 15, guest: 5 };
export function memberRole(v: unknown): [string, number] {
  const r = text(v)?.toLowerCase() ?? "member";
  if (!(r in MEMBER_ROLES)) throw new Error(`role must be one of ${Object.keys(MEMBER_ROLES).join(", ")}`);
  return [`${r[0]!.toUpperCase()}${r.slice(1)}`, MEMBER_ROLES[r]!];
}
const MEMBER_ROLE = (t: PlaneProjectTarget) =>`a Member or Admin of the Plane project ${t.project.identifier}`;

export const projectAdminTools: ToolDefinition[] = [
  { name: "projectCreate", description: `Creates a Plane project in the Plane workspace, with cycles and modules switched on unless asked otherwise. Plane refuses a hyphen, dot, parentheses and other punctuation in the name and the identifier.${CONFIRM}`,
    parameters: { type: "object", properties: {
      account: PROJECT_ARGS.account!,
      name: { type: "string", description: "The Plane project's name: letters, digits, spaces and underscores." },
      identifier: { type: "string", description: "Its key prefix, 1 to 12 letters or digits, such as MOB; work item keys become MOB-1." },
      description: { type: "string", description: "Plain text." },
      cycles: { type: "boolean", description: "Switch cycles on (default true)." },
      modules: { type: "boolean", description: "Switch modules on (default true)." },
      intake: { type: "boolean", description: "Switch the intake on (default false)." },
    }, required: ["name", "identifier"] } },
  { name: "stateCreate", description: `Adds a state to a Plane project open here, in one of the state groups.${CONFIRM}`,
    parameters: { type: "object", properties: {
      ...PROJECT_ARGS,
      name: { type: "string" }, group: { type: "string", enum: STATE_GROUPS, description: "Default backlog." }, color: COLOR,
      description: { type: "string" },
    }, required: ["project", "name"] } },
  { name: "stateUpdate", description: `Renames a state of a Plane project open here, or changes its group, color or description. Pass only what changes.${CONFIRM}`,
    parameters: { type: "object", properties: {
      ...PROJECT_ARGS,
      state: { type: "string", description: "The state's current name, as planeStates lists it." },
      name: { type: "string", description: "New name." }, group: { type: "string", enum: STATE_GROUPS }, color: COLOR, description: { type: "string" },
    }, required: ["project", "state"] } },
  { name: "labelCreate", description: `Adds a label to a Plane project open here.${CONFIRM}`,
    parameters: { type: "object", properties: { ...PROJECT_ARGS, name: { type: "string" }, color: COLOR, description: { type: "string" } }, required: ["project", "name"] } },
  { name: "labelUpdate", description: `Renames a label of a Plane project open here, or changes its color or description. Pass only what changes.${CONFIRM}`,
    parameters: { type: "object", properties: {
      ...PROJECT_ARGS,
      label: { type: "string", description: "The label's current name, as planeLabels lists it." },
      name: { type: "string", description: "New name." }, color: COLOR, description: { type: "string" },
    }, required: ["project", "label"] } },
  { name: "projectUpdate", description: `Renames a Plane project open here, changes its identifier or description, or switches its cycles, modules or intake on or off. Pass only what changes. Plane allows it only when the bot's Plane user is an Admin of the Plane project.${DANGER_NOTE}`,
    parameters: { type: "object", properties: {
      ...PROJECT_ARGS,
      name: { type: "string", description: "New name: letters, digits, spaces and underscores." },
      identifier: { type: "string", description: "New key prefix, 1 to 12 letters or digits; every work item key changes with it." },
      description: { type: "string", description: "New description, plain text." },
      cycles: { type: "boolean", description: "Switch cycles on or off." },
      modules: { type: "boolean", description: "Switch modules on or off." },
      intake: { type: "boolean", description: "Switch the intake on or off." },
    }, required: ["project"] } },
  { name: "projectArchive", description: `Archives a Plane project open here: it leaves Plane's lists, and its work items cannot be changed until it is brought back.${DANGER_NOTE}`,
    parameters: { type: "object", properties: { ...PROJECT_ARGS }, required: ["project"] } },
  { name: "projectUnarchive", description: `Brings back an archived Plane project open here. Plane allows it only when the bot's Plane user is an Admin of the Plane project.${DANGER_NOTE}`,
    parameters: { type: "object", properties: { ...PROJECT_ARGS }, required: ["project"] } },
  { name: "projectDelete", description: `Deletes a Plane project open here for good, with all its work items, cycles, modules and intake. Plane allows it only when the bot's Plane user is an Admin of the Plane project.${DANGER_NOTE}`,
    parameters: { type: "object", properties: { ...PROJECT_ARGS }, required: ["project"] } },
  { name: "projectMemberAdd", description: `Adds a member of the Plane workspace to a Plane project open here, as Admin, Member or Guest. Plane's API cannot add back someone who was removed from the Plane project, nor change a member's role or remove one; those are done in Plane itself. Plane allows it only when the bot's Plane user is an Admin of the Plane project.${DANGER_NOTE}`,
    parameters: { type: "object", properties: {
      ...PROJECT_ARGS,
      member: { type: "string", description: "The person, named as workspaceMembers lists them." },
      role: { type: "string", enum: Object.keys(MEMBER_ROLES), description: "Default member." },
    }, required: ["project", "member"] } },
  { name: "stateDelete", description: `Deletes a state of a Plane project open here. Plane refuses the default state and a state that still holds work items, archived and draft ones included.${DANGER_NOTE}`,
    parameters: { type: "object", properties: { ...PROJECT_ARGS, state: { type: "string", description: "The state's name, as planeStates lists it." } }, required: ["project", "state"] } },
  { name: "labelDelete", description: `Deletes a label of a Plane project open here; work items that carry it lose it.${DANGER_NOTE}`,
    parameters: { type: "object", properties: { ...PROJECT_ARGS, label: { type: "string", description: "The label's name, as planeLabels lists it." } }, required: ["project", "label"] } },
];

export const projectAdminToolPolicy: Record<string, ToolPolicy> = {
  projectCreate: { effect: "write", group: "Project admin" },
  stateCreate: { effect: "write", group: "Project admin" },
  stateUpdate: { effect: "write", group: "Project admin" },
  labelCreate: { effect: "write", group: "Project admin" },
  labelUpdate: { effect: "write", group: "Project admin" },
  projectUpdate: { effect: "danger", group: "Project admin" },
  projectArchive: { effect: "danger", group: "Project admin" },
  projectUnarchive: { effect: "danger", group: "Project admin" },
  projectDelete: { effect: "danger", group: "Project admin" },
  projectMemberAdd: { effect: "danger", group: "Project admin" },
  stateDelete: { effect: "danger", group: "Project admin" },
  labelDelete: { effect: "danger", group: "Project admin" },
};

function color(v: unknown): string | undefined {
  const c = text(v);
  if (!c) return undefined;
  if (!/^#[0-9a-f]{6}$/i.test(c)) throw new Error("color must be a hex color written #RRGGBB, such as #F59E0B.");
  return c.toUpperCase();
}

function group(v: unknown): string | undefined {
  const g = text(v)?.toLowerCase();
  if (!g) return undefined;
  if (!STATE_GROUPS.includes(g)) throw new Error(`group must be one of ${STATE_GROUPS.join(", ")}`);
  return g;
}

/** Name, color and description changes shared by states and labels; `taken` lists the names already in use. */
function edits(a: Obj, what: string, t: PlaneProjectTarget, taken: Obj[]) {
  const body: Obj = {}, said: string[] = [];
  const name = title(a.name);
  if (name) {
    const clash = taken.find((x) => String(x.name).toLowerCase() === name.toLowerCase());
    if (clash) throw new Error(`${t.project.identifier} already has a ${what} named "${clash.name}".`);
    body.name = name; said.push(`name "${name}"`);
  }
  const c = color(a.color);
  if (c) { body.color = c; said.push(`color ${c}`); }
  if (typeof a.description === "string") { body.description = a.description.trim(); said.push("new description"); }
  return { body, said, name };
}

/**
 * Refuses a Plane project name or identifier Plane would refuse: forbidden punctuation, an identifier other than 1 to 12
 * letters or digits, or one another Plane project already has. Either may be null when it does not change.
 */
async function freeProjectName(t: PlaneTarget, name: string | null, identifier: string | null, self?: string) {
  if ((name && SPECIAL.test(name)) || (identifier && SPECIAL.test(identifier))) throw new Error(`Plane does not allow a hyphen, dot, parentheses or the characters & + , : ; $ ^ { } * = ? @ # | ' < > % ! in a Plane project's name or identifier. Ask for a name without them.`);
  if (identifier !== null && !IDENTIFIER.test(identifier)) throw new Error("identifier must be 1 to 12 letters or digits, such as MOB.");
  const others = (await t.projects()).filter((p) => String(p.id) !== self);
  const sameId = identifier && others.find((p) => String(p.identifier).toUpperCase() === identifier);
  if (sameId) throw new Error(`The identifier ${identifier} is taken by the Plane project ${sameId.name}.`);
  const sameName = name && others.find((p) => String(p.name).toLowerCase() === name.toLowerCase());
  if (sameName) throw new Error(`The name ${name} is taken by the Plane project ${sameName.identifier}.`);
}

const projectNameRefusals = (name: string | null, identifier: string | null): PlaneRefusals => [
  [/project name is already taken/, `The name ${name} is taken in the Plane workspace.`],
  [/identifier is already taken/, `The identifier ${identifier} is taken in the Plane workspace.`],
  [/special characters/, `Plane refused the name or identifier for its punctuation.`],
];

const ADMIN_ROLE = (t: PlaneProjectTarget) => `an Admin of the Plane project ${t.project.identifier}`;
const projectPath = (t: PlaneProjectTarget, sub = "") => inWorkspace(t.conn, `projects/${t.project.id}/${sub}`);

const taken = (t: PlaneProjectTarget, what: string, name: string | null) => [
  [/same name already exists|payload is not valid/, `${t.project.identifier} already has a ${what} named "${name}".`],
] as [RegExp, string][];

export const projectAdminHandlers = {
  projectCreate: planeWrite("projectCreate", async (a, ctx) => {
    const t = planeTargetOf(await pickWorkspaceAccess(ctx, a.account));
    const name = title(a.name);
    const identifier = text(a.identifier)?.toUpperCase() ?? "";
    if (!name) throw new Error(`Pass "name", the Plane project's name.`);
    await freeProjectName(t, name, identifier);
    const description = text(a.description);
    const on = { cycles: a.cycles !== false, modules: a.modules !== false, intake: a.intake === true };
    const features = Object.entries(on).filter(([, v]) => v).map(([k]) => k);
    return {
      t, role: "a Member or Admin of the Plane workspace", refusals: projectNameRefusals(name, identifier),
      summary: `Create the Plane project "${name}" (${identifier}) in the Plane workspace, with ${features.length ? features.join(", ") : "no cycles, modules or intake"} on`,
      run: async () => {
        // Plane switches cycles and modules off for a Plane project created through its API unless they are sent.
        const p = await planeRequest<Obj>(t.conn, inWorkspace(t.conn, "projects/"), {
          method: "POST", body: { name, identifier, ...(description ? { description } : {}), cycle_view: on.cycles, module_view: on.modules },
        });
        // Plane creates the intake only when a PATCH switches it on; switched on at create, it would answer intake writes with a 500.
        let intake = false;
        if (on.intake) {
          try { await planeRequest(t.conn, inWorkspace(t.conn, `projects/${p.id}/`), { method: "PATCH", body: { intake_view: true } }); intake = true; } catch {}
        }
        return {
          project: { id: p.id, identifier: p.identifier, name: p.name }, cycles: on.cycles, modules: on.modules, intake,
          ...(on.intake && !intake ? { warning: "The Plane project was created, but Plane did not switch its intake on." } : {}),
          note: "Channels limited to specific Plane projects do not see it until an admin adds it to their Plane scope.",
        };
      },
    };
  }),
  stateCreate: planeWrite("stateCreate", async (a, ctx) => {
    const t = await resolvePlaneProject(ctx, a);
    const states = await projectStates(t, t.project);
    const name = title(a.name);
    if (!name) throw new Error(`Pass "name", the state's name.`);
    const g = group(a.group) ?? "backlog";
    const { body } = edits(a, "state", t, states);
    const c = body.color ?? GROUP_COLORS[g];
    return {
      t, role: MEMBER_ROLE(t), refusals: taken(t, "state", name),
      summary: `Add the state "${name}" (group ${g}, color ${c}) to ${t.project.identifier}`,
      run: async () => {
        const s = await planeRequest<Obj>(t.conn, inWorkspace(t.conn, `projects/${t.project.id}/states/`), { method: "POST", body: { ...body, name, group: g, color: c } });
        return { state: { id: s.id, name: s.name, group: s.group } };
      },
    };
  }),
  stateUpdate: planeWrite("stateUpdate", async (a, ctx) => {
    const t = await resolvePlaneProject(ctx, a);
    const state = await projectNames(t, t.project).state(a.state);
    const others = (await projectStates(t, t.project)).filter((s) => s.id !== state.id);
    const { body, said, name } = edits(a, "state", t, others);
    const g = group(a.group);
    if (g) { body.group = g; said.push(`group ${g}`); }
    if (!said.length) throw new Error("Nothing to change: pass name, group, color or description.");
    return {
      t, role: MEMBER_ROLE(t), refusals: taken(t, "state", name),
      summary: `Update the state ${state.name} in ${t.project.identifier}: ${said.join(", ")}`,
      run: async () => {
        await planeRequest(t.conn, inWorkspace(t.conn, `projects/${t.project.id}/states/${state.id}/`), { method: "PATCH", body });
        return { state: { id: state.id, name: body.name ?? state.name }, changed: said };
      },
    };
  }),
  labelCreate: planeWrite("labelCreate", async (a, ctx) => {
    const t = await resolvePlaneProject(ctx, a);
    const name = title(a.name);
    if (!name) throw new Error(`Pass "name", the label's name.`);
    const { body } = edits(a, "label", t, await projectLabels(t, t.project));
    return {
      t, role: MEMBER_ROLE(t), refusals: taken(t, "label", name),
      summary: `Add the label "${name}"${body.color ? ` (${body.color})` : ""} to ${t.project.identifier}`,
      run: async () => {
        const l = await planeRequest<Obj>(t.conn, inWorkspace(t.conn, `projects/${t.project.id}/labels/`), { method: "POST", body: { ...body, name } });
        return { label: { id: l.id, name: l.name } };
      },
    };
  }),
  labelUpdate: planeWrite("labelUpdate", async (a, ctx) => {
    const t = await resolvePlaneProject(ctx, a);
    const label = await projectNames(t, t.project).label(a.label);
    const others = (await projectLabels(t, t.project)).filter((l) => l.id !== label.id);
    const { body, said, name } = edits(a, "label", t, others);
    if (!said.length) throw new Error("Nothing to change: pass name, color or description.");
    return {
      t, role: MEMBER_ROLE(t), refusals: taken(t, "label", name),
      summary: `Update the label ${label.name} in ${t.project.identifier}: ${said.join(", ")}`,
      run: async () => {
        await planeRequest(t.conn, inWorkspace(t.conn, `projects/${t.project.id}/labels/${label.id}/`), { method: "PATCH", body });
        return { label: { id: label.id, name: body.name ?? label.name }, changed: said };
      },
    };
  }),
  projectUpdate: planeWrite("projectUpdate", async (a, ctx) => {
    const t = await resolvePlaneProject(ctx, a);
    if (t.project.archived_at) throw new Error(`${t.project.identifier} is archived, and Plane does not change an archived Plane project. Bring it back first (projectUnarchive).`);
    const name = title(a.name);
    const identifier = text(a.identifier)?.toUpperCase() ?? null;
    await freeProjectName(t, name, identifier, String(t.project.id));
    const body: Obj = {}, said: string[] = [];
    if (name) { body.name = name; said.push(`name "${name}"`); }
    if (identifier) { body.identifier = identifier; said.push(`identifier ${identifier} (work item keys become ${identifier}-…)`); }
    if (typeof a.description === "string") { body.description = a.description.trim(); said.push("new description"); }
    for (const [arg, field] of [["cycles", "cycle_view"], ["modules", "module_view"], ["intake", "intake_view"]] as const) {
      if (typeof a[arg] === "boolean") { body[field] = a[arg]; said.push(`${arg} ${a[arg] ? "on" : "off"}`); }
    }
    if (!said.length) throw new Error("Nothing to change: pass name, identifier, description, cycles, modules or intake.");
    return {
      t, role: ADMIN_ROLE(t),
      refusals: [...projectNameRefusals(name, identifier), [/Archived project cannot be updated/, `${t.project.identifier} is archived, so Plane did not change it.`]],
      summary: `Update the Plane project ${t.project.identifier}: ${said.join(", ")}`,
      run: async () => {
        const p = await planeRequest<Obj>(t.conn, projectPath(t), { method: "PATCH", body });
        return { project: { id: t.project.id, identifier: p?.identifier ?? identifier ?? t.project.identifier, name: p?.name ?? name ?? t.project.name }, changed: said };
      },
    };
  }, DANGER),
  projectArchive: planeWrite("projectArchive", async (a, ctx) => {
    const t = await resolvePlaneProject(ctx, a);
    if (t.project.archived_at) throw new Error(`${t.project.identifier} is already archived.`);
    return {
      t, role: "a Member or Admin of the Plane workspace",
      summary: `Archive the Plane project ${t.project.identifier} (${t.project.name}); its work items cannot be changed until it is brought back`,
      run: async () => {
        await planeRequest(t.conn, projectPath(t, "archive/"), { method: "POST" });
        return { project: { id: t.project.id, identifier: t.project.identifier }, archived: true };
      },
    };
  }, DANGER),
  projectUnarchive: planeWrite("projectUnarchive", async (a, ctx) => {
    const t = await resolvePlaneProject(ctx, a);
    if (!t.project.archived_at) throw new Error(`${t.project.identifier} is not archived.`);
    return {
      t, role: ADMIN_ROLE(t),
      summary: `Bring back the archived Plane project ${t.project.identifier} (${t.project.name})`,
      run: async () => {
        await planeRequest(t.conn, projectPath(t, "archive/"), { method: "DELETE" });
        return { project: { id: t.project.id, identifier: t.project.identifier }, archived: false };
      },
    };
  }, DANGER),
  projectDelete: planeWrite("projectDelete", async (a, ctx) => {
    const t = await resolvePlaneProject(ctx, a);
    return {
      t, role: ADMIN_ROLE(t),
      summary: `Delete the Plane project ${t.project.identifier} (${t.project.name}) for good, with all its work items, cycles, modules and intake`,
      run: async () => {
        await planeRequest(t.conn, projectPath(t), { method: "DELETE" });
        return { project: { id: t.project.id, identifier: t.project.identifier }, deleted: true };
      },
    };
  }, DANGER),
  projectMemberAdd: planeWrite("projectMemberAdd", async (a, ctx) => {
    const t = await resolvePlaneProject(ctx, a);
    const [roleName, role] = memberRole(a.role);
    if (typeof a.member === "string" && ME.test(a.member.trim())) throw new Error(`Plane does not know who "${a.member.trim()}" is. Ask the person for their name as workspaceMembers lists it.`);
    const everyone = (await planeRequest<Obj[]>(t.conn, inWorkspace(t.conn, "members/"))) ?? [];
    const user = pickByName(everyone, a.member, planeUserAliases, "Plane workspace member", planeUserName);
    const who = planeUserName(user);
    // Plane's list of a Plane project's members keeps people who were removed, and its API cannot add them back.
    const notAgain = `${who} is already listed among the members of ${t.project.identifier}. Plane lists removed members there too, and its API cannot add a removed member back or change a member's role; that has to be done in Plane itself.`;
    if ((await projectMembers(t, t.project)).some((m) => String(m.id) === String(user.id))) throw new Error(notAgain);
    return {
      t, role: ADMIN_ROLE(t),
      refusals: [[/payload is not valid/, notAgain], [/Member not found in workspace/, `${who} is not a member of the Plane workspace.`]],
      summary: `Add ${who} to the Plane project ${t.project.identifier} as a ${roleName}`,
      run: async () => {
        // Plane answers with the membership's own id, which nothing else in its API shows.
        const m = await planeRequest<Obj>(t.conn, projectPath(t, "members/"), { method: "POST", body: { member: user.id, role } });
        return { project: t.project.identifier, member: who, role: roleName, membershipId: m?.id ?? null };
      },
    };
  }, DANGER),
  stateDelete: planeWrite("stateDelete", async (a, ctx) => {
    const t = await resolvePlaneProject(ctx, a);
    const state = await projectNames(t, t.project).state(a.state);
    if (state.default) throw new Error(`${state.name} is the default state of ${t.project.identifier}, which Plane does not let anyone delete. Make another state the default in Plane first.`);
    return {
      t, role: MEMBER_ROLE(t),
      refusals: [
        [/state is not empty/, `The state ${state.name} still holds work items (archived and draft ones count too), so Plane kept it. Move them to another state first.`],
        [/Default state cannot be deleted/, `${state.name} is the default state of ${t.project.identifier}, so Plane kept it.`],
      ],
      summary: `Delete the state ${state.name} (group ${state.group}) from ${t.project.identifier}`,
      run: async () => {
        await planeRequest(t.conn, inWorkspace(t.conn, `projects/${t.project.id}/states/${state.id}/`), { method: "DELETE" });
        return { state: { id: state.id, name: state.name }, deleted: true };
      },
    };
  }, DANGER),
  labelDelete: planeWrite("labelDelete", async (a, ctx) => {
    const t = await resolvePlaneProject(ctx, a);
    const label = await projectNames(t, t.project).label(a.label);
    return {
      t, role: MEMBER_ROLE(t),
      summary: `Delete the label ${label.name} from ${t.project.identifier}; work items that carry it lose it`,
      run: async () => {
        await planeRequest(t.conn, inWorkspace(t.conn, `projects/${t.project.id}/labels/${label.id}/`), { method: "DELETE" });
        return { label: { id: label.id, name: label.name }, deleted: true };
      },
    };
  }, DANGER),
};
