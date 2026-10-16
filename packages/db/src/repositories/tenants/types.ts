/** Domain types and the repository interface for Tenants and API keys. Every engine implements it. */

export type TenantStatus = "active" | "suspended" | "deleted";

const STATUSES: TenantStatus[] = ["active", "suspended", "deleted"];

/** The status, once it is one a tenant can have. */
export function tenantStatus(status: string): TenantStatus {
  if (!STATUSES.includes(status as TenantStatus)) throw new Error("Invalid tenant status");
  return status as TenantStatus;
}

export type Tenant = {
  id: string;
  name: string;
  slug: string;
  /** The API key the tenant was created under; only that key reaches it. */
  apiKeyId: string | null;
  status: TenantStatus;
  platformMetadata: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
};

export type NewTenant = { name: string; slug?: string; apiKeyId?: string; metadata?: Record<string, any> };
export type TenantUpdate = { name?: string; status?: string; metadata?: Record<string, any> };

/** A stored API key. The raw key is never kept, only its hash. */
export type ApiKey = {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
};

export type ApiKeyListing = ApiKey & { tenantCount: number };

/** A key just issued: `raw` is shown once and cannot be read back. */
export type IssuedApiKey = { raw: string; keyPrefix: string; keyId: string };

export interface TenantRepository {
  /** Creates an active tenant with its default agent configuration and skills, all or nothing. A taken slug rejects. */
  create(input: NewTenant): Promise<Tenant>;
  /** Reads a tenant that is not deleted. */
  get(id: string): Promise<Tenant | null>;
  getBySlug(slug: string): Promise<Tenant | null>;
  /** Tenants that are not deleted, oldest first, at most 1000. */
  list(): Promise<Tenant[]>;
  /** How many tenants are not deleted. */
  count(): Promise<number>;
  /** Changes a tenant that is not deleted; null when there is none. An unknown status throws. */
  update(id: string, input: TenantUpdate): Promise<Tenant | null>;
  /** Marks the tenant deleted: it disappears from every read, but its records and slug are kept. */
  remove(id: string): Promise<Tenant | null>;
  /** Deletes the tenant and everything it owns, all or nothing. False when there was no such tenant. */
  purge(id: string): Promise<boolean>;
  /** Gives every tenant the default agent configuration and skills it lacks. */
  seedDefaults(): Promise<void>;

  issueApiKey(name?: string, scopes?: string[]): Promise<IssuedApiKey>;
  /** Reads a key by id, revoked or not. */
  getApiKey(id: string): Promise<ApiKey | null>;
  /** The key a raw value belongs to, unless it was revoked. */
  resolveApiKey(raw: string): Promise<ApiKey | null>;
  touchApiKey(id: string): Promise<void>;
  revokeApiKey(id: string): Promise<void>;
  /** Every key, oldest first, with how many tenants that are not deleted belong to it. */
  listApiKeys(): Promise<ApiKeyListing[]>;
  /** Hands a tenant to a key, or to none with null. */
  linkApiKey(tenantId: string, apiKeyId: string | null): Promise<Tenant | null>;
  /** A tenant of this key, by id or slug. */
  getForApiKey(apiKeyId: string, ref: string): Promise<Tenant | null>;
  listForApiKey(apiKeyId: string): Promise<Tenant[]>;
}
