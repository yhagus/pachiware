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
};

export type ProfileUpdate = Partial<NewProfile>;

export interface ProfileRepository {
  /** A tenant's profiles, newest first, at most 500. */
  listForTenant(tenantId: string): Promise<Profile[]>;
  create(tenantId: string, input: NewProfile): Promise<Profile>;
  /** Reads a profile of any tenant. */
  get(id: string): Promise<Profile | null>;
  /** Reads a profile only when it belongs to this tenant. */
  getForTenant(tenantId: string, id: string): Promise<Profile | null>;
  /** The profile a bot of this tenant answers with; null when the bot has none, or names one of another tenant. */
  getForBot(tenantId: string, botId: string): Promise<Profile | null>;
  /** Changes a profile; null when there is none. */
  update(id: string, input: ProfileUpdate): Promise<Profile | null>;
  /** Deletes a profile. Bots that pointed at it fall back to the tenant default. False when there was none. */
  remove(id: string): Promise<boolean>;
}
