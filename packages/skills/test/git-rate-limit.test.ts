import { expect, test } from "bun:test";
import { call } from "../src/git.js";

const github = { provider: "github" as const, baseUrl: null, token: "t" };

/** Answers each request with the next response, and counts them. */
async function withResponses(responses: (() => Response)[], run: (asked: () => number) => Promise<void>) {
  const real = globalThis.fetch;
  let n = 0;
  globalThis.fetch = (async () => responses[Math.min(n++, responses.length - 1)]!()) as any;
  try { await run(() => n); } finally { globalThis.fetch = real; }
}
const limited = (headers: Record<string, string>, status = 429) => () => new Response("slow down", { status, headers });
const ok = () => Response.json({ default_branch: "main" });

test("a rate limit is waited out once and the request made again (#350)", async () => {
  await withResponses([limited({ "retry-after": "0" }), ok], async (asked) => {
    expect(await call(github, "/repos/acme/api")).toEqual({ default_branch: "main" });
    expect(asked()).toBe(2);
  });
  // GitHub's primary limit is a 403 with no requests left and the time it resets.
  await withResponses([limited({ "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(Math.floor(Date.now() / 1000)) }, 403), ok], async (asked) => {
    expect(await call(github, "/repos/acme/api")).toEqual({ default_branch: "main" });
    expect(asked()).toBe(2);
  });
});

test("a second rate limit, a long wait, or a wait past the call's deadline returns the error as before", async () => {
  await withResponses([limited({ "retry-after": "0" })], async (asked) => {
    await expect(call(github, "/repos/acme/api")).rejects.toThrow("github returned 429: slow down");
    expect(asked()).toBe(2);
  });
  await withResponses([limited({ "retry-after": "120" }), ok], async (asked) => {
    await expect(call(github, "/repos/acme/api")).rejects.toThrow("github returned 429");
    expect(asked()).toBe(1);
  });
  await withResponses([limited({ "retry-after": "1" }), ok], async (asked) => {
    await expect(call({ ...github, deadline: () => Date.now() + 5_000 }, "/repos/acme/api")).rejects.toThrow("github returned 429");
    expect(asked()).toBe(1);
  });
  // A refusal that is no rate limit is not retried.
  await withResponses([limited({}, 403), ok], async (asked) => {
    await expect(call(github, "/repos/acme/api")).rejects.toThrow("github returned 403");
    expect(asked()).toBe(1);
  });
});
