/**
 * The one way the agent talks to Plane's `/api/v1/` REST API. Every Plane tool and admin route goes through `planeRequest`, so
 * the credential headers (from the account's Plane version), the redirect refusal, the host check and the rate-limit wait are
 * never written twice. The behaviour noted below is Plane v1.3.1's.
 */
import { assertHostAllowed, isListedHost } from "@pachiware/db";
import { parseRelease, type PlaneVersion } from "./versions.js";

/** Plane's cloud API. A Plane account with no base URL uses it. */
export const PLANE_CLOUD_URL = "https://api.plane.so";
const CLOUD_HOSTS = new Set(["api.plane.so", "app.plane.so", "plane.so"]);
/** A 429 is waited out once when Plane's window resets within this many seconds; otherwise the wait is reported. */
const MAX_RATE_LIMIT_WAIT_S = 10;
const TIMEOUT_MS = 15_000;

/** What a request needs: never shown to the model, which names an account instead. */
export type PlaneConn = { baseUrl: string | null; workspaceSlug: string; apiKey: string; version: PlaneVersion };

/** Plane refused a request, or could not be reached; `status` is 0 when no answer came. The message is safe to show. */
export class PlaneError extends Error {
  constructor(message: string, readonly status: number) { super(message); this.name = "PlaneError"; }
}

/** Plane's rate limit is still closed after the one wait the helper allows. */
export class PlaneRateLimited extends PlaneError {
  constructor(readonly retryAfterSeconds: number) {
    super(`Plane's rate limit was reached. Try again in about ${retryAfterSeconds} seconds.`, 429);
    this.name = "PlaneRateLimited";
  }
}

/**
 * Cleans a base URL entered for a Plane account and checks it: null (or Plane's cloud) means Plane's cloud; a self-hosted
 * Plane needs https unless its host is on Allowed hosts, and must be on Allowed hosts when that list is set.
 */
export function planeBaseUrl(input: string | null | undefined): string | null {
  const raw = (input ?? "").trim();
  if (!raw) return null;
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error("baseUrl must be a full URL, such as https://plane.example.com"); }
  if (url.username || url.password || url.search || url.hash) throw new Error("baseUrl must not carry credentials, a query or a fragment");
  if (CLOUD_HOSTS.has(url.host.toLowerCase())) return null;
  const clean = `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, "").replace(/\/api\/v1$/, "")}`;
  assertPlaneUrl(clean);
  return clean;
}

/** Checked again before every request, because Allowed hosts may have changed since the account was saved. */
export function assertPlaneUrl(baseUrl: string | null): void {
  if (!baseUrl) return;
  const { protocol } = new URL(baseUrl);
  if (protocol !== "https:" && protocol !== "http:") throw new Error("baseUrl must start with https://");
  if (protocol === "http:" && !isListedHost(baseUrl)) throw new Error("A self-hosted Plane must use https://, unless its host is on Allowed hosts");
  assertHostAllowed(baseUrl);
}

/** A path inside the account's Plane workspace, e.g. inWorkspace(conn, "projects/") for `workspaces/<slug>/projects/`. */
export const inWorkspace = (conn: PlaneConn, path: string) => `workspaces/${encodeURIComponent(conn.workspaceSlug)}/${path.replace(/^\/+/, "")}`;

/** Plane's cloud web app, where a cloud work item opens in the browser. */
const PLANE_CLOUD_WEB = "https://app.plane.so";

/**
 * A work item's page in Plane's web app, such as `https://app.plane.so/acme/browse/ENG-42/`. The route and trailing slash are
 * Plane v1.3.1's own (`generateWorkItemLink` in packages/utils/src/work-item/base.ts). A self-hosted Plane serves its web app at
 * the root of the base URL, beside `/api/`.
 */
export const workItemWebUrl = (conn: PlaneConn, key: string) =>
  `${conn.baseUrl ?? PLANE_CLOUD_WEB}/${encodeURIComponent(conn.workspaceSlug)}/browse/${encodeURIComponent(key)}/`;

/** A Plane answer, read field by field. */
export type Obj = Record<string, any>;
type Query = Record<string, string | number | boolean | undefined | null>;
export type PlaneRequest = { method?: string; query?: Query; body?: unknown };

/**
 * Sends one request to `<baseUrl>/api/v1/<path>` with the headers of the account's Plane version, and returns the parsed JSON
 * (null for an empty answer). A redirect is refused, since the key header would follow it to another host. On 429 it waits
 * once when the reset is near.
 */
export async function planeRequest<T = any>(conn: PlaneConn, path: string, req: PlaneRequest = {}): Promise<T> {
  assertPlaneUrl(conn.baseUrl);
  const url = new URL(`${conn.baseUrl ?? PLANE_CLOUD_URL}/api/v1/${path.replace(/^\/+/, "")}`);
  for (const [k, v] of Object.entries(req.query ?? {})) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  const send = () => sendOnce(conn, url, req);
  let res = await send();
  if (res.status === 429) {
    const wait = retryAfter(res);
    if (wait > MAX_RATE_LIMIT_WAIT_S) throw new PlaneRateLimited(wait);
    await new Promise((r) => setTimeout(r, wait * 1000));
    res = await send();
    if (res.status === 429) throw new PlaneRateLimited(Math.max(1, retryAfter(res)));
  }
  if (res.status >= 300 && res.status < 400) throw redirected(url);
  const text = await res.text();
  if (!res.ok) throw new PlaneError(refusal(res.status, text), res.status);
  if (!text) return null as T;
  try { return JSON.parse(text) as T; } catch { throw new PlaneError("Plane answered with something other than JSON; check the base URL", res.status); }
}

async function sendOnce(conn: PlaneConn, url: URL, req: PlaneRequest): Promise<Response> {
  const headers: Record<string, string> = { ...conn.version.headers(conn.apiKey), Accept: "application/json" };
  if (req.body !== undefined) headers["Content-Type"] = "application/json";
  try {
    return await fetch(url, { method: req.method ?? "GET", headers, redirect: "error", signal: AbortSignal.timeout(TIMEOUT_MS), ...(req.body !== undefined ? { body: JSON.stringify(req.body) } : {}) });
  } catch (e) {
    if (/redirect/i.test(String((e as Error)?.message))) throw redirected(url);
    throw new PlaneError(`Could not reach Plane at ${url.host}: ${(e as Error)?.message ?? e}`, 0);
  }
}

const redirected = (url: URL) => new PlaneError(`Plane at ${url.host} answered with a redirect, which is refused so the API key cannot follow it. Enter the address Plane's API is served from.`, 0);

/** Seconds until Plane's window reopens: a 429 carries `Retry-After` (seconds); `X-RateLimit-Reset` (UTC epoch seconds) is read only if present. */
function retryAfter(res: Response): number {
  const after = Number(res.headers.get("retry-after") ?? NaN);
  if (Number.isFinite(after) && after >= 0) return Math.ceil(after);
  const reset = Number(res.headers.get("x-ratelimit-reset") ?? NaN);
  if (Number.isFinite(reset) && reset > 0) return Math.max(0, Math.ceil(reset - Date.now() / 1000));
  return 60;
}

/** Plane v1.3.1 refuses a bad, expired or inactive key with 403 "Given API token is not valid", and a missing one with 401. */
export const isKeyRefusal = (e: unknown) => e instanceof PlaneError && (e.status === 401 || (e.status === 403 && /token is not valid/i.test(e.message)));

function refusal(status: number, text: string): string {
  if (/^\s*</.test(text)) return `Plane answered ${status} with a web page instead of its API; check the base URL`;
  let detail = text.slice(0, 300);
  try { const j = JSON.parse(text); detail = j?.detail ?? j?.error ?? j?.error_message ?? JSON.stringify(j).slice(0, 300); } catch {}
  return `Plane answered ${status}: ${detail}`;
}

/** One page of a paginated v1 list: Plane wraps results with cursors; a few endpoints answer with a plain array. */
type Page<T> = { results?: T[]; next_cursor?: string; next_page_results?: boolean } | T[];

/**
 * Reads a paginated v1 list, following `next_cursor` for at most `maxPages` pages of `perPage` (Plane allows up to 1000).
 * `more` is true when Plane had pages left after the last one read.
 */
export async function planeList<T = any>(conn: PlaneConn, path: string, opts: { query?: Query; perPage?: number; maxPages?: number } = {}): Promise<{ items: T[]; more: boolean }> {
  const items: T[] = [];
  let cursor: string | undefined;
  for (let n = 0; n < (opts.maxPages ?? 5); n++) {
    const page = await planeRequest<Page<T>>(conn, path, { query: { ...opts.query, per_page: opts.perPage ?? 100, ...(cursor ? { cursor } : {}) } });
    if (Array.isArray(page)) return { items: page, more: false };
    items.push(...(page?.results ?? []));
    if (!page?.next_page_results || !page.next_cursor) return { items, more: false };
    cursor = page.next_cursor;
  }
  return { items, more: true };
}

/** The presigned POST Plane answers an attachment request with (`upload_data`). */
export type PlaneUploadData = { url: string; fields: Record<string, string> };

/**
 * Sends a file to Plane's file storage through a presigned POST: every field, then the file last. The API key is not sent,
 * since the storage host is S3 or MinIO, not Plane's API. A redirect is refused here too.
 */
export async function planeUpload(conn: PlaneConn, upload: PlaneUploadData, file: { name: string; type: string; bytes: Uint8Array }): Promise<void> {
  const target = uploadTarget(conn, upload.url);
  const form = new FormData();
  for (const [k, v] of Object.entries(upload.fields ?? {})) form.append(k, String(v));
  form.append("file", new Blob([file.bytes as BlobPart], { type: file.type }), file.name);
  let res: Response;
  try { res = await fetch(target, { method: "POST", body: form, redirect: "error", signal: AbortSignal.timeout(TIMEOUT_MS) }); }
  catch (e) { throw new PlaneError(`Could not reach Plane's file storage at ${target.host}: ${(e as Error)?.message ?? e}`, 0); }
  if (res.status >= 300 && res.status < 400) throw new PlaneError(`Plane's file storage at ${target.host} answered with a redirect, which is refused.`, 0);
  if (!res.ok) {
    const code = /<Code>([^<]+)<\/Code>/.exec(await res.text())?.[1];
    throw new PlaneError(`Plane's file storage refused the upload (${res.status}${code ? ` ${code}` : ""}).`, res.status);
  }
}

/**
 * Where the upload goes. A self-hosted Plane with its own MinIO names its own host, and behind a TLS proxy it says http://,
 * so its own host takes the base URL's scheme. Any other http:// storage must be on Allowed hosts.
 */
function uploadTarget(conn: PlaneConn, raw: string): URL {
  const base = new URL(conn.baseUrl ?? PLANE_CLOUD_URL);
  let url: URL;
  try { url = new URL(raw, base); } catch { throw new PlaneError("Plane answered with an upload address that is not a URL.", 0); }
  if (url.host === base.host) url.protocol = base.protocol;
  else if (url.protocol !== "https:" && !(url.protocol === "http:" && isListedHost(url.href))) throw new PlaneError(`Plane's file storage at ${url.host} is not served over https, so the file was not sent. An admin can add its host to Allowed hosts.`, 0);
  return url;
}

/** How long saving an account waits for the Plane server's release; it is only a hint. */
const RELEASE_TIMEOUT_MS = 5_000;

/**
 * The release a Plane server reports, such as `v1.3.1`, or null when it cannot be read. Plane v1.3.1 answers `GET /api/instances/`
 * to anyone (`AllowAny`) with `{ config, instance }`, the release in `instance.current_version`; an instance not set up yet has no
 * `instance`. No key is sent, a redirect is refused, and only the version string is kept: the rest of the answer is dropped.
 */
export async function planeServerRelease(baseUrl: string | null): Promise<string | null> {
  try {
    assertPlaneUrl(baseUrl);
    const res = await fetch(`${baseUrl ?? PLANE_CLOUD_URL}/api/instances/`, { headers: { Accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(RELEASE_TIMEOUT_MS) });
    if (!res.ok) return null;
    const release = (await res.json())?.instance?.current_version;
    return typeof release === "string" && parseRelease(release) ? release.trim().slice(0, 40) : null;
  } catch {
    return null;
  }
}

export type PlaneProject = { id: string; name: string; identifier: string };
export type PlaneUser = { id: string; name: string };

/** The Plane projects of the account's Plane workspace that its Plane user can see, oldest first as Plane lists them. */
export async function listPlaneProjects(conn: PlaneConn): Promise<PlaneProject[]> {
  const { items } = await planeList<any>(conn, inWorkspace(conn, "projects/"), { maxPages: 10 });
  return items.map((p) => ({ id: String(p.id), name: String(p.name ?? ""), identifier: String(p.identifier ?? "") }));
}

/**
 * Checks an account before it is saved: the key against `users/me/`, then the workspace slug against its projects.
 * Returns the Plane user the key acts as, labelled with its display name and email, so a personal key is noticed.
 */
export async function verifyPlaneAccount(conn: PlaneConn): Promise<{ user: PlaneUser; projects: PlaneProject[] }> {
  let me: any;
  try { me = await planeRequest(conn, "users/me/"); }
  catch (e) {
    if (isKeyRefusal(e)) throw new Error("Plane refused the API key. Check that it was copied whole, has not expired, and is still active.");
    throw e;
  }
  if (!me?.id) throw new Error("Plane did not say which user the API key belongs to; check the base URL");
  let projects: PlaneProject[];
  try { projects = await listPlaneProjects(conn); }
  catch (e) {
    // A wrong slug, or a user who is not a member of the Plane workspace, is a 403; the key itself passed users/me/.
    if (e instanceof PlaneError && (e.status === 403 || e.status === 404)) throw new Error(`Plane refused the Plane workspace "${conn.workspaceSlug}". Check the slug in the Plane workspace's URL, and that the key's user is a member of it.`);
    throw e;
  }
  const display = me.display_name || [me.first_name, me.last_name].filter(Boolean).join(" ") || "Plane user";
  return { user: { id: String(me.id), name: me.email ? `${display} (${me.email})` : display }, projects };
}
