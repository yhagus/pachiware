/**
 * The profiles a live eval compares. EVAL_PROFILES names a YAML file (see profiles.example.yaml); without it, one
 * profile comes from EVAL_PROVIDER, EVAL_MODEL, EVAL_API_KEY, EVAL_BASE_URL and EVAL_ACCEPTS_IMAGES=1.
 * Keys never sit in the file: each profile names the env variable that holds its key.
 */
import { readFileSync } from "node:fs";
import type { Price } from "./compare";

export interface EvalProfile {
  name: string; provider: "openai" | "anthropic" | "custom"; model: string; baseUrl: string | null; apiKey: string; acceptsImages: boolean;
  price?: Price;
}

const PROVIDERS = ["openai", "anthropic", "custom"];

function checked(p: Omit<EvalProfile, "apiKey"> & { apiKey?: string }, keyFrom: string): EvalProfile {
  if (!p.name || !p.model) throw new Error("Every profile needs a name and a model.");
  if (!PROVIDERS.includes(p.provider)) throw new Error(`Profile ${p.name}: provider is openai, anthropic or custom, not ${p.provider}.`);
  if (p.provider === "custom" && !p.baseUrl) throw new Error(`Profile ${p.name}: a custom provider needs a base URL.`);
  if (!p.apiKey) throw new Error(`Profile ${p.name} reads its key from ${keyFrom}, which is not set.`);
  return p as EvalProfile;
}

export function profilesFromEnv(env: Record<string, string | undefined> = process.env): EvalProfile[] {
  if (!env.EVAL_PROFILES) {
    if (!env.EVAL_MODEL) throw new Error("Set EVAL_PROFILES to a profiles file, or EVAL_MODEL and EVAL_API_KEY for one profile.");
    return [checked({ name: env.EVAL_MODEL, provider: (env.EVAL_PROVIDER || "openai") as EvalProfile["provider"], model: env.EVAL_MODEL, baseUrl: env.EVAL_BASE_URL || null, apiKey: env.EVAL_API_KEY, acceptsImages: env.EVAL_ACCEPTS_IMAGES === "1" }, "EVAL_API_KEY")];
  }
  const raw = Bun.YAML.parse(readFileSync(env.EVAL_PROFILES, "utf8")) as any;
  if (!Array.isArray(raw?.profiles) || !raw.profiles.length) throw new Error(`${env.EVAL_PROFILES} lists no profiles.`);
  const profiles = raw.profiles.map((p: any) => checked({
    name: String(p.name ?? ""), provider: p.provider, model: String(p.model ?? ""), baseUrl: p.baseUrl || null, apiKey: env[p.apiKeyEnv], acceptsImages: p.acceptsImages === true,
    ...(p.price ? { price: { input: Number(p.price.input), output: Number(p.price.output) } } : {}),
  }, p.apiKeyEnv));
  const names = profiles.map((p: EvalProfile) => p.name), twice = names.find((n: string, i: number) => names.indexOf(n) !== i);
  if (twice) throw new Error(`Two profiles are named ${twice}.`);
  return profiles;
}
