/** Domain types and the repository interface for Profiles. Every engine implements it. */

/** A named choice of provider, model and key that a bot answers with. The key is kept encrypted. */
export type Profile = {
  id: string;
  tenantId: string;
  name: string;
  provider: string;
  model: string;
  baseUrl: string | null;
  apiKeyEncrypted: string | null;
  acceptsImages: boolean;
  /** The API format a `custom` profile's server speaks. */
  apiFormat: string;
  /** The profile of the same tenant that answers when this one fails; it may name its own, so fallbacks chain. */
  fallbackProfileId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type NewProfile = {
  name: string;
  provider: string;
  model: string;
  baseUrl?: string | null;
  apiKeyEncrypted?: string | null;
  acceptsImages?: boolean;
  apiFormat?: string;
  fallbackProfileId?: string | null;
};

export type ProfileUpdate = Partial<NewProfile>;

/** What a new profile holds where its input names nothing, on every engine. */
export const PROFILE_DEFAULTS = { baseUrl: null, apiKeyEncrypted: null, acceptsImages: false, apiFormat: "chat_completions", fallbackProfileId: null };

const FIELDS = ["name", "provider", "model", "baseUrl", "apiKeyEncrypted", "acceptsImages", "apiFormat", "fallbackProfileId"] as const;

/** The profile fields an input gives; an undefined one is left out, so it keeps the stored value. */
export const definedProfileFields = (input: Record<string, any>) => Object.fromEntries(FIELDS.filter((f) => input[f] !== undefined).map((f) => [f, input[f]]));

/**
 * Refuses a fallback that is not one of the tenant's profiles (given as ids and their fallbacks), the profile itself,
 * or one whose chain leads back to the profile. `profileId` is null for a profile not yet created.
 */
export function requireFallback(tenantProfiles: { id: string; fallbackProfileId: string | null }[], profileId: string | null, fallbackId: string | null | undefined) {
  if (!fallbackId) return;
  if (fallbackId === profileId) throw new Error("A profile cannot fall back to itself");
  const next = new Map(tenantProfiles.map((p) => [p.id, p.fallbackProfileId]));
  if (!next.has(fallbackId)) throw new Error("Fallback profile not found");
  const seen = new Set<string>();
  for (let at: string | null | undefined = fallbackId; at && !seen.has(at); at = next.get(at)) {
    if (at === profileId) throw new Error("Fallback chain would loop");
    seen.add(at);
  }
}

export interface ProfileRepository {
  /** A tenant's profiles, newest first, at most 500. */
  listForTenant(tenantId: string): Promise<Profile[]>;
  /** Refuses a fallback that is not one of the tenant's profiles ("Fallback profile not found"). */
  create(tenantId: string, input: NewProfile): Promise<Profile>;
  /** Reads a profile of any tenant. */
  get(id: string): Promise<Profile | null>;
  /** Reads a profile only when it belongs to this tenant. */
  getForTenant(tenantId: string, id: string): Promise<Profile | null>;
  /** The profile a bot of this tenant answers with; null when the bot has none, or names one of another tenant. */
  getForBot(tenantId: string, botId: string): Promise<Profile | null>;
  /**
   * Changes a profile; null when there is none. Refuses a fallback of another tenant ("Fallback profile not found"),
   * the profile itself ("A profile cannot fall back to itself") and a chain that leads back to it ("Fallback chain would loop").
   */
  update(id: string, input: ProfileUpdate): Promise<Profile | null>;
  /** Deletes a profile. Bots that pointed at it fall back to the tenant default, and profiles that fell back to it have none. False when there was none. */
  remove(id: string): Promise<boolean>;
}
