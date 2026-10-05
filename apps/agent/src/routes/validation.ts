import { HTTPException } from "hono/http-exception";

export function string(value: unknown, name: string, optional = false): string | undefined {
  if (optional && value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim()) throw new HTTPException(400, { message: `${name} must be a non-empty string` });
  return value.trim();
}
export function object(value: unknown, name: string): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HTTPException(400, { message: `${name} must be an object` });
  return value as Record<string, any>;
}
export function stringArray(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string" || !v.trim())) throw new HTTPException(400, { message: `${name} must be an array of strings` });
  return value;
}
export function maskConfig(row: any) {
  if (!row) return null;
  const safe = { ...row };
  for (const field of ["openaiApiKeyEncrypted", "anthropicApiKeyEncrypted", "customApiKeyEncrypted"]) safe[field] = row[field] ? "••••••••" : null;
  return safe;
}
export function publicBot(row: any) {
  const { tokenEncrypted, ...safe } = row;
  return { ...safe, hasToken: Boolean(tokenEncrypted) };
}
