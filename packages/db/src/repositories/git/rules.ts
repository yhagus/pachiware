import type { GitScope, GitScopeRule } from "./types.js";

/** True when every repo matched by `sub` is also matched by `sup`. "*" is the only wildcard; a `*` inside `sub` only fits a wildcard of `sup`. */
export function patternCovers(sup: string, sub: string): boolean {
  if (sup === "*" || sup === sub) return true;
  const re = new RegExp("^" + sup.split("*").map((x) => x.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$");
  return re.test(sub);
}

function cleanPatterns(p: string[]) {
  const out = [...new Set((p || []).map((x) => x.trim().toLowerCase()).filter(Boolean))];
  if (!out.length) throw new Error("repoPatterns must not be empty");
  if (out.some((x) => !/^[a-z0-9_.*\/-]+$/.test(x))) throw new Error("Invalid repo pattern");
  return out;
}

/**
 * Checks the rules of one scope against the accounts the bot holds and, for a channel, the server rules; returns them cleaned.
 * Shared by every engine, so the same rules reject everywhere.
 */
export function checkScopeRules(rules: GitScopeRule[], linked: Set<string>, channelId: string, current: GitScope[]): GitScopeRule[] {
  const seen = new Set<string>();
  const clean = rules.map((r) => {
    if (!linked.has(r.gitAccountId)) throw new Error("Git account is not attached to this bot");
    if (seen.has(r.gitAccountId)) throw new Error("Duplicate git account in rules");
    seen.add(r.gitAccountId);
    return { gitAccountId: r.gitAccountId, repoPatterns: cleanPatterns(r.repoPatterns) };
  });
  if (channelId) {
    const server = new Map(current.filter((r) => r.channelId === "").map((r) => [r.gitAccountId, r.repoPatterns]));
    for (const r of clean) {
      const parent = server.get(r.gitAccountId);
      if (!parent) throw new Error("Channel rule needs the account enabled on the server first");
      // Every channel pattern must be covered by a server pattern ("*" or identical, or "org/*" covering "org/x").
      for (const pat of r.repoPatterns) if (!parent.some((sp) => patternCovers(sp, pat))) throw new Error(`Pattern "${pat}" is wider than the server rule`);
    }
  }
  return clean;
}

/** After the server rules change, what each channel rule becomes: its patterns that still fit, or null when it must go. */
export function narrowChannelRule(server: GitScopeRule[], channel: GitScope): string[] | null {
  const parent = server.find((r) => r.gitAccountId === channel.gitAccountId)?.repoPatterns;
  if (!parent) return null;
  const narrowed = channel.repoPatterns.filter((pat) => parent.some((sp) => patternCovers(sp, pat)));
  return narrowed.length ? narrowed : null;
}
