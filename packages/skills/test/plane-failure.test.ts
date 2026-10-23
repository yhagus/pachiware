import { expect, test } from "bun:test";
import { planeRequest } from "../src/plane/client.js";
import { PLANE_VERSIONS } from "../src/plane/versions.js";

const conn = { baseUrl: null, apiKey: "k", version: PLANE_VERSIONS[0]! };

/** What a request to Plane's cloud throws when Plane gives each answer in turn: `failed` says how it failed for good, if it did. */
async function thrownBy(...answers: (() => Response)[]) {
  const real = globalThis.fetch;
  globalThis.fetch = (async () => answers.shift()!()) as any;
  try { return await planeRequest(conn, "users/me/").then(() => null, (e) => ({ message: e.message, failed: e.failed })); } finally { globalThis.fetch = real; }
}
const answer = (status: number, body = "") => () => new Response(body, { status, headers: { "retry-after": "0" } });

test("Plane refusing the key, answering 5xx, or not answering fails for good, naming Plane and its host; anything else stays the caller's error (#359)", async () => {
  expect(await thrownBy(answer(401, '{"detail":"Authentication credentials were not provided."}'))).toEqual({
    message: "Plane answered 401: Authentication credentials were not provided.",
    failed: { kind: "refused", service: "Plane", host: "api.plane.so", status: 401, error: "Plane answered 401: Authentication credentials were not provided." },
  });
  expect((await thrownBy(answer(403, '{"error":"Given API token is not valid"}')))?.failed).toMatchObject({ kind: "refused", status: 403 });
  expect((await thrownBy(answer(502, '{"error":"Bad Gateway"}')))?.failed).toMatchObject({ kind: "unavailable", service: "Plane", host: "api.plane.so", status: 502 });
  expect(await thrownBy(() => { throw new TypeError("Unable to connect"); })).toEqual({
    message: "Could not reach Plane at api.plane.so: Unable to connect",
    failed: { kind: "unavailable", service: "Plane", host: "api.plane.so", error: "Could not reach Plane at api.plane.so: Unable to connect" },
  });
  // Plane holds nothing a Changelog draft covers, so nothing it does not find is gone; a rate limit still closed after the wait heals.
  expect(await thrownBy(answer(404, '{"error":"Not found"}'))).toEqual({ message: "Plane answered 404: Not found", failed: undefined });
  expect((await thrownBy(answer(429), answer(429)))?.failed).toBeUndefined();
});
