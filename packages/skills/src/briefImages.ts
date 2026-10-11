/**
 * Screenshots in a brief travel as bytes only in the turn they arrive. What they show is kept as text in the brief's
 * file: described by the model when it saw them, or by the author when the profile cannot see images.
 */
import type { SkillContext, ToolDefinition } from "./types.js";
import type { BindingPlace } from "./playbooks.js";
import { authorsBrief, oneLine as line, updateBrief, type BriefDraft, type BriefImage, type BriefState } from "./brief.js";

const MAX_DESCRIPTION = 500;

/** Adds the author's screenshots of this turn to the brief; `sent` ones were shown to the model. */
export const recordBriefImages = (tenantId: string, place: BindingPlace, shots: { id: string; name: string; link: string; sent: boolean }[]) =>
  updateBrief(tenantId, place, (s) => {
    const images = [...(s.images ?? [])];
    for (const shot of shots) {
      const at = images.findIndex((im) => im.id === shot.id);
      if (at < 0) images.push({ id: shot.id, name: shot.name, link: shot.link, seen: shot.sent });
      else if (shot.sent) images[at] = { ...images[at]!, seen: true };
    }
    return shots.length ? { state: { ...s, images }, value: true } : null;
  });

/** The provider refused the images after all: those still undescribed go to the author in the next round. */
export const unseeBriefImages = (tenantId: string, place: BindingPlace, ids: string[]) =>
  updateBrief(tenantId, place, (s) => (s.images?.some((im) => ids.includes(im.id) && !im.description)
    ? { state: { ...s, images: s.images.map((im) => (ids.includes(im.id) && !im.description ? { ...im, seen: false } : im)) }, value: true } : null));

/** Folds the model's descriptions into the brief. Pure; throws with every problem at once. */
export function applyDescriptions(state: BriefState, args: Record<string, unknown>): BriefState {
  if (!state.points.length) throw new Error("Post round 1 with postBriefRound first, then describe the screenshots by point.");
  const images: BriefImage[] = [...(state.images ?? [])];
  const shown = images.filter((im) => im.seen).map((im) => im.name);
  const raw = Array.isArray(args.images) ? args.images : [];
  const problems: string[] = raw.length ? [] : ["images must list each screenshot with its point and description."];
  const taken = new Set<string>();
  raw.forEach((x: any, i) => {
    const name = line(x?.name), description = line(x?.description), which = `Screenshot ${name ? `"${name}"` : i + 1}`;
    const named = images.filter((im) => im.seen && im.name === name && !taken.has(im.id));
    const im = named.find((m) => !m.description) ?? named[0];
    if (!im) problems.push(`${which}: you were shown no screenshot by that name in this brief${shown.length ? `; you saw ${[...new Set(shown)].join(", ")}` : ""}.`);
    if (!description) problems.push(`${which} needs a description of what it shows.`);
    else if (description.length > MAX_DESCRIPTION) problems.push(`${which}'s description is ${description.length} characters; keep it to ${MAX_DESCRIPTION}.`);
    if (!(Number.isInteger(x?.point) && x.point >= 0 && x.point <= state.points.length)) problems.push(`${which}: point must be 0 (whole brief) or a number from 1 to ${state.points.length}.`);
    if (!im || problems.length) return;
    taken.add(im.id);
    images[images.indexOf(im)] = { ...im, point: x.point, description };
  });
  if (problems.length) throw new Error(problems.join("\n"));
  return { ...state, images };
}

/** The author answered the round question about a screenshot: the answer is its description. */
export const describedByAnswers = (state: BriefState, answers: Map<number, string>): BriefState => {
  const asked = state.questions.filter((q) => q.round === state.round && q.image && answers.has(q.n));
  if (!asked.length) return state;
  return { ...state, images: (state.images ?? []).map((im) => {
    const q = asked.find((a) => a.image === im.id);
    return q ? { ...im, description: answers.get(q.n)!, point: q.point } : im;
  }) };
};

/** Lines a draft shows for the screenshots of its point and of the whole brief. */
export const screenshotLines = (state: BriefState, d: BriefDraft) =>
  (state.images ?? []).filter((im) => !im.point || im.point === d.point)
    .map((im) => `Screenshot [${im.name.replace(/[[\]]/g, "")}](${im.link})${im.description ? `: ${im.description}` : ""}`).join("\n");

export const describeBriefImagesTool: ToolDefinition = {
  name: "describeBriefImages",
  description: "In a thread that follows the issue-draft playbook: saves what each screenshot you were shown in this brief holds, so the drafts keep it as text with a link to its message. Later turns do not resend the image. Call it on the turn a screenshot arrives; in round 1, after postBriefRound. Only works on the brief author's turns.",
  parameters: {
    type: "object",
    properties: {
      images: { type: "array", description: "One entry per screenshot", items: { type: "object", properties: {
        name: { type: "string", description: "The attachment's file name, as in [image: name, W×H]" },
        point: { type: "integer", description: "The point it belongs to (1-based), or 0 for the whole brief" },
        description: { type: "string", description: "What it shows that matters for the drafts, at most 500 characters" },
      }, required: ["name", "point", "description"] } },
    },
    required: ["images"],
  },
};

export async function describeBriefImages(args: Record<string, unknown>, ctx: SkillContext) {
  const { place } = await authorsBrief(ctx, "Only the brief author's screenshots go into the drafts.");
  await updateBrief(ctx.tenantId, place, (s) => ({ state: applyDescriptions(s, args), value: true }));
  return { described: (args.images as any[]).map((x) => line(x?.name)) };
}
