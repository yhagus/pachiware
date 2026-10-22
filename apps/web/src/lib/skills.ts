import type { AvailabilityKind, SkillTool, TenantSkill, ToolEffect } from "@/lib/api";

/** The one wording of each effect in the web app. */
export const EFFECTS: Record<ToolEffect, { label: string; variant: "outline" | "secondary" | "destructive"; means: string }> = {
  read: { label: "Read", variant: "outline", means: "Looks things up and changes nothing." },
  write: { label: "Write", variant: "secondary", means: "Creates or changes things that can be changed back." },
  danger: { label: "Danger", variant: "destructive", means: "Cannot be undone, or changes access, security, or settings." },
};

/** How a page keys one availability target, e.g. "tool:createTask". */
export const targetKey = (kind: AvailabilityKind, name: string) => `${kind}:${name}`;

/** Grouped skills (Git) list one section per group; the rest are one flat list. Playbook tools always come last, in their own section. */
export function sections(s: TenantSkill): { title?: string; tools: SkillTool[] }[] {
  const general = s.tools.filter((t: SkillTool) => !t.playbook), playbook = s.tools.filter((t: SkillTool) => t.playbook);
  const main = s.groups.length ? s.groups.map((g: string) => ({ title: g, tools: general.filter((t: SkillTool) => t.group === g) })) : [{ tools: general }];
  return [...main, { title: "Playbook tools", tools: playbook }].filter((x) => x.tools.length);
}

/** The words of a search, lowercased; empty when there is nothing to search for. */
export const searchWords = (query: string) => query.toLowerCase().split(/\s+/).filter(Boolean);

/** Whether every word appears somewhere in the texts, in any case. */
export const hasAll = (words: string[], ...texts: (string | undefined)[]) => {
  const text = texts.join("\n").toLowerCase();
  return words.every((w) => text.includes(w));
};

export const effectCounts = (tools: SkillTool[]) =>
  (Object.keys(EFFECTS) as ToolEffect[]).map((e) => [e, tools.filter((t) => t.effect === e).length] as const).filter(([, n]) => n).map(([e, n]) => `${n} ${e}`).join(" · ");
