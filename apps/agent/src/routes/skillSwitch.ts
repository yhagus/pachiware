import { repositories } from "@pachiware/db";
import { availabilityChanged } from "@pachiware/skills";
import { CacheService, tenantKey } from "../cache/redis.js";

/** Switches one of a tenant's skills on or off and tells the bots, so their commands follow; null when the tenant has no such skill. */
export async function switchTenantSkill(tenantId: string, skillId: string, isEnabled: boolean) {
  const state = await repositories().skills.setEnabled(tenantId, skillId, isEnabled);
  if (!state) return null;
  await CacheService.del(tenantKey(tenantId, "skills:active"));
  availabilityChanged(tenantId);
  return state;
}
