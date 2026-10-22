/** What the console groups skills and playbooks by, in display order. A skill declares its own; a playbook names one in its frontmatter (`category:`). */
export const SKILL_CATEGORIES = ["Tasks & reminders", "Records & meetings", "Git, code & APIs", "Plane", "Discord", "Making playbooks", "Matt Pocock's Skills"] as const;
export type SkillCategory = (typeof SKILL_CATEGORIES)[number];
/** A tenant's own playbook that names no category. */
export const TENANT_PLAYBOOKS_CATEGORY = "This tenant's playbooks";
/** A skill or built-in playbook that names none. */
export const OTHER_CATEGORY = "Other";

/** The categories `used` holds, in display order: the known ones, then any a tenant's playbook named, then the tenant's own and Other last. */
export function categoryOrder(used: Iterable<string>): string[] {
  const set = new Set(used), last = [TENANT_PLAYBOOKS_CATEGORY, OTHER_CATEGORY];
  const known: string[] = SKILL_CATEGORIES.filter((c) => set.has(c));
  const named = [...set].filter((c) => !known.includes(c) && !last.includes(c)).sort((a, b) => a.localeCompare(b));
  return [...known, ...named, ...last.filter((c) => set.has(c))];
}
