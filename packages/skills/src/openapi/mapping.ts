/**
 * Mapping an API changelog's changed files in workers (ADR 0026): the files not yet mapped are split into groups by path, and each group
 * goes to a worker of its own, which reads every patch, follows each change outward to the routes it reaches, and records how each file
 * ends in the draft itself, so the main loop's context never holds the patches.
 */

/** The most patch characters and the most files one mapping worker is given (ADR 0026). */
export const GROUP_CHARS = 40_000, GROUP_FILES = 20;

/** A changed file as grouping weighs it: its patch's length when the comparison gave a patch (`patchChars`). */
type Weighed = { path: string; status: string; patchChars?: number };

/**
 * How much of a group a file takes: its patch's length. A file the comparison gave no patch for is too large or binary, so it is over the
 * bound, unless it was only moved, which leaves no patch to read.
 */
const weightOf = (f: Weighed) => f.patchChars ?? (f.status === "renamed" ? 0 : Infinity);

/**
 * Splits changed files into the groups mapping workers are given: sorted by path, each group at most GROUP_CHARS patch characters and
 * GROUP_FILES files, a file never split; a file over the bound is a group of its own.
 */
export function mappingGroups<T extends Weighed>(files: T[]): T[][] {
  const groups: T[][] = [];
  let chars = 0;
  for (const f of [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) {
    const weight = weightOf(f), last = groups.at(-1);
    if (last && last.length < GROUP_FILES && chars + weight <= GROUP_CHARS) { last.push(f); chars += weight; }
    else { groups.push([f]); chars = weight; }
  }
  return groups;
}
