/** Domain types and the repository interface for API previews: public snapshots of OpenAPI documents a bot published from chat. Every engine implements it. */

/** One API preview: an OpenAPI document as it was when published, served at /open-api/<id> to anyone with the link until it is revoked. */
export type ApiPreview = {
  /** The only key to its public page. */
  id: string;
  tenantId: string;
  botId: string;
  /** The guild it was published from; null in a DM. */
  guildId: string | null;
  channelId: string;
  /** The Workspace path it was published from, as the bot named it. */
  sourcePath: string;
  title: string;
  /** The document's `info.version`. */
  version: string | null;
  /** The document's JSON text, exactly as published. */
  document: string;
  createdById: string | null;
  createdByName: string | null;
  createdAt: Date;
};

/** A preview as a list shows it: everything but its document. */
export type ApiPreviewSummary = Omit<ApiPreview, "document">;

export type NewApiPreview = {
  tenantId: string;
  /** Must be a bot of the same tenant. */
  botId: string;
  guildId?: string | null;
  channelId: string;
  sourcePath: string;
  title: string;
  version?: string | null;
  document: string;
  createdById?: string | null;
  createdByName?: string | null;
};

export interface ApiPreviewRepository {
  /** A preview whose bot belongs to another tenant rejects. */
  create(input: NewApiPreview): Promise<ApiPreview>;
  /** Of any tenant: the public page finds a preview by its id alone. Null when there is none. */
  get(id: string): Promise<ApiPreview | null>;
  /** A tenant's previews without their documents, newest first, then by id; only one bot's with `botId`, only one place's with `channelId`. */
  list(tenantId: string, filter?: { botId?: string; channelId?: string }): Promise<ApiPreviewSummary[]>;
  /** False when the tenant has no such preview. */
  remove(tenantId: string, id: string): Promise<boolean>;
}
