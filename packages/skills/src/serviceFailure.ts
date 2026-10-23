/**
 * How a service the bot reads (GitHub, GitLab, Plane) failed in a way that does not heal (#359): it refused the bot's key, what was asked
 * for is gone, or it could not be reached. Any other failure, such as a file that does not exist, is the caller's own error.
 */
export type FailureKind = "refused" | "gone" | "unavailable";

/** A failure of a service, with what the console needs: the service's display name, its host, the HTTP status (none when no answer came) and the error text. */
export type ServiceFailed = { kind: FailureKind; service: string; host: string; status?: number; error: string };

/** An error of a service the bot reads; `failed` says how, when it failed for good. The message is what the model reads, as before. */
export class ServiceError extends Error {
  constructor(message: string, readonly failed?: ServiceFailed) { super(message); this.name = "ServiceError"; }
}

/**
 * How a request failed for good by its HTTP status, `null` when no answer came (a timeout or a network failure): refused for a 401 or a 403
 * that is no rate limit, unavailable for a 5xx or no answer; null for anything else. A rate limit is waited out where the request is made.
 */
export function failureKind(status: number | null, rateLimited = false): FailureKind | null {
  if (status === null || status >= 500) return "unavailable";
  if (status === 401 || (status === 403 && !rateLimited)) return "refused";
  return null;
}

/** The failure of a request to `service` at `host`, when its status says it failed for good. */
export function failedAt(service: string, host: string, status: number | null, error: string, rateLimited = false): ServiceFailed | undefined {
  const kind = failureKind(status, rateLimited);
  return kind ? { kind, service, host, ...(status !== null ? { status } : {}), error } : undefined;
}
