/**
 * The code checks of the issue-draft eval (#28, point 5): pure functions over a draft as Discord showed it. They grade
 * live runs and the recorded outputs in CI alike.
 */
import { checkDraft } from "../../../packages/skills/src/draftChecker";
import { fillerIn } from "../src/discord/replyStyle";
import type { PinnedRepo } from "./repository";

export type Language = "en" | "id";
export type Check = "anatomy" | "labels" | "context" | "filler" | "language";
export interface DraftOutput { n: number; title: string; body: string; repo: string | null; labels: string[] }
export interface CheckContext { pin: PinnedRepo; /** Every file and folder at the pinned commit. */ paths: Set<string>; language: Language }
export interface CheckFailure { check: Check; message: string }

const LANGUAGE_NAMES: Record<Language | "unknown", string> = { en: "English", id: "Indonesian", unknown: "no clear language" };
const EN = new Set("the a an and or but is are was were be been to of in on at for with from by as it its this that these those when which who not no should must can does do has have will would every each than then so if".split(" "));
const ID = new Set("yang dan atau di ke dari untuk dengan tidak bukan ini itu ada akan pada saat jika kalau bisa dapat harus sudah juga dalam oleh sebagai agar supaya karena masih setiap tetap hanya lebih sama tanpa ketika sehingga perlu sedang belum lalu".split(" "));

/** Everything above the footer, without the fixed English headings and labels, links, and code. */
const proseOf = (body: string) => {
  const rule = body.lastIndexOf("\n---\n");
  return (rule < 0 ? body : body.slice(0, rule))
    .split("\n").filter((l) => !/^##\s/.test(l)).join("\n")
    .replace(/\*\*[^*\n]+\*\*/g, " ").replace(/\[[^\]]*\]\([^)]*\)/g, " ").replace(/https?:\/\/\S+/g, " ").replace(/`[^`\n]*`/g, " ").replace(/\*\((added|assumed)\)\*/g, " ");
};

/** English or Indonesian by function words; "unknown" when neither leads. */
export function languageOf(text: string): Language | "unknown" {
  let en = 0, id = 0;
  for (const word of proseOf(text).toLowerCase().match(/\p{L}+/gu) ?? []) { if (EN.has(word)) en++; if (ID.has(word)) id++; }
  return en + id < 3 || en === id ? "unknown" : en > id ? "en" : "id";
}

const sha7 = (sha: string) => sha.slice(0, 7);

function contextFailures(d: DraftOutput, { pin, paths }: CheckContext): string[] {
  if (d.repo !== pin.repo) return [d.repo ? `The draft targets ${d.repo}, not ${pin.repo}.` : `The draft has no repository, though ${pin.repo} is open to the brief.`];
  const rule = d.body.lastIndexOf("\n---\n"), footer = rule < 0 ? "" : d.body.slice(rule + 5);
  const header = /\*\*Context used\*\* \(([^ ]+) at `([0-9a-f]+)`\):\n((?:- .*(?:\n|$))*)/.exec(footer);
  if (!header) return [];
  const out: string[] = [];
  if (header[1] !== pin.repo || header[2] !== sha7(pin.commit)) out.push(`Context used names ${header[1]} at ${header[2]}, not ${pin.repo} at ${sha7(pin.commit)}.`);
  const web = `https://github.com/${pin.repo}/`;
  for (const [, url] of header[3]!.matchAll(/^- \[[^\]]*\]\((\S+)\)$/gm)) {
    const blob = new RegExp(`^${web}blob/([0-9a-f]{40})/(.+)$`).exec(url!), issue = new RegExp(`^${web}issues/(\\d+)$`).exec(url!);
    if (blob) {
      const path = blob[2]!.split("/").map(decodeURIComponent).join("/");
      if (blob[1] !== pin.commit) out.push(`${path} is linked at ${sha7(blob[1]!)}, not at the pinned commit ${sha7(pin.commit)}.`);
      else if (!paths.has(path)) out.push(`${path} does not exist at ${sha7(pin.commit)}.`);
    } else if (issue) {
      if (!pin.issues.some((i) => i.number === Number(issue[1]))) out.push(`Issue #${issue[1]} is not an open issue of ${pin.repo}.`);
    } else out.push(`${url} is not a file or issue link of ${pin.repo}.`);
  }
  return out;
}

/** Every code check a draft fails; empty when it passes. */
export function checkDraftOutput(d: DraftOutput, ctx: CheckContext): CheckFailure[] {
  const out: CheckFailure[] = [];
  for (const v of checkDraft({ title: d.title, body: d.body })) out.push({ check: "anatomy", message: `${v.rule}: ${v.message}` });
  for (const label of d.labels) if (!ctx.pin.labels.includes(label)) out.push({ check: "labels", message: `${label} is not a label of ${ctx.pin.repo}.` });
  for (const message of contextFailures(d, ctx)) out.push({ check: "context", message });
  for (const line of fillerIn(`${d.title}\n${d.body}`)) out.push({ check: "filler", message: `Filler: "${line}"` });
  const language = languageOf(`${d.title}\n\n${d.body}`);
  if (language !== ctx.language) out.push({ check: "language", message: `The draft reads as ${LANGUAGE_NAMES[language]}; the brief is ${LANGUAGE_NAMES[ctx.language]}.` });
  return out;
}

/** The checks over a whole run of one brief, each failure tagged with its draft number. */
export function checkOutput(output: { fixture: string; drafts: DraftOutput[] }, ctx: CheckContext): ({ draft: number | null; check: Check | "drafts"; message: string })[] {
  if (!output.drafts.length) return [{ draft: null, check: "drafts", message: "No draft was posted." }];
  return output.drafts.flatMap((d) => checkDraftOutput(d, ctx).map((f) => ({ draft: d.n, ...f })));
}
