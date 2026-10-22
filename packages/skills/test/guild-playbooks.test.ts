import { expect, test } from "bun:test";
import { skillRegistry } from "../src/registry.ts";
import { bodyChanges, PLAYBOOK_SKILLS } from "../src/builtin/guildPlaybooks.ts";

test("bodyChanges keeps only the lines between the shared first and last lines, as - and + lines", () => {
  expect(bodyChanges("1. Ask.\n2. Note.\n3. Close.", "1. Ask.\n2. Note who spoke.\n3. Close.")).toBe("- 2. Note.\n+ 2. Note who spoke.");
  // A renumbered line counts as changed: only lines equal word for word are shared.
  expect(bodyChanges("1. Ask.\n2. Close.", "1. Ask.\n2. Thank them.\n3. Close.")).toBe("- 2. Close.\n+ 2. Thank them.\n+ 3. Close.");
  expect(bodyChanges("1. Ask.\n2. Close.", "1. Ask.\n2. Close.\n3. Wave.")).toBe("+ 3. Wave.");
  expect(bodyChanges("1. Ask.\n2. Wave.", "1. Ask.")).toBe("- 2. Wave.");
  expect(bodyChanges("old", "new", 6)).toBe("- old\n…");
});

test("the skills a playbook made in chat may require are the registry's skills, by the names it gives them", () => {
  expect(PLAYBOOK_SKILLS).toEqual(Object.fromEntries(skillRegistry.getAllSkills().map((s) => [s.id, s.name])));
});
