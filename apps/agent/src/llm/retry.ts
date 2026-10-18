/** Timing of a provider call. Tests replace `sleep` and shorten `timeoutMs` so a retry scenario takes milliseconds. */
export const retryPolicy = {
  timeoutMs: 60_000,
  retries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30_000,
  sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
};

const RETRYABLE = new Set([408, 409, 429]);
export const retryable = (status: number) => RETRYABLE.has(status) || status >= 500;

/** `Retry-After` is seconds or an HTTP date; anything else means "no hint". */
export function retryAfterMs(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(header);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : null;
}

const backoff = (attempt: number) => Math.min(retryPolicy.maxDelayMs, retryPolicy.baseDelayMs * 2 ** attempt) * (0.5 + Math.random());

/**
 * One provider request with a timeout per attempt. 408, 409, 429, 5xx, and thrown fetch errors (network, timeout) are retried
 * with exponential backoff and jitter; any other status, 400 included, comes back as is so the caller can read it.
 */
export async function providerRequest(url: string, init: RequestInit, deadline?: number): Promise<Response> {
  // A turn's deadline shortens the last attempt and stops any retry that would start, or wait, past it.
  const left = () => (deadline === undefined ? Infinity : deadline - Date.now());
  for (let attempt = 0; ; attempt++) {
    if (left() <= 0) throw new Error("The turn's deadline passed");
    let last = attempt === retryPolicy.retries;
    let response: Response;
    try {
      response = await fetch(url, { ...init, signal: AbortSignal.timeout(Math.min(retryPolicy.timeoutMs, left())) });
    } catch (err) {
      const wait = backoff(attempt);
      if (last || wait >= left()) throw err;
      await retryPolicy.sleep(wait);
      continue;
    }
    const wait = retryAfterMs(response.headers.get("retry-after")) ?? backoff(attempt);
    if (wait >= left()) last = true;
    if (response.ok || !retryable(response.status) || last) return response;
    await retryPolicy.sleep(wait);
  }
}
