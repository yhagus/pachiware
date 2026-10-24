/**
 * The facts text the model reads leaves out: a string must appear as written, a pattern must match. Instructions, tool answers and
 * briefs are checked by what they must carry (ids, counts, paths, the next step, the limits they set), so rewording them breaks no test.
 */
export const missingFacts = (text: string, ...facts: (string | RegExp)[]) =>
  facts.filter((fact) => (typeof fact === "string" ? !text.includes(fact) : !fact.test(text)));
