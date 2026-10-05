import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const workspace = process.cwd();
const dbSource = join(workspace, "packages/db/src");
const sessionSource = join(workspace, "apps/web/operator-session.ts");
const encryptionKey = Buffer.alloc(32, 29).toString("base64");

function run(directory: string, script: string) {
  return Bun.spawnSync({
    cmd: ["bun", "--eval", script],
    cwd: workspace,
    env: {
      ...process.env,
      DATABASE_URL: `sqlite:${join(directory, "pachiware.db")}`,
      PLATFORM_ENCRYPTION_KEY: encryptionKey,
      PLATFORM_ADMIN_KEY: "operator-platform-key",
      NODE_ENV: "test",
    },
  });
}

function stdout(result: ReturnType<typeof Bun.spawnSync>) {
  return new TextDecoder().decode(result.stdout).trim();
}

function stderr(result: ReturnType<typeof Bun.spawnSync>) {
  return new TextDecoder().decode(result.stderr).trim();
}

describe("local operator session endpoint", () => {
  test("only returns the CLI handoff to same-origin loopback requests", () => {
    const directory = mkdtempSync(join(tmpdir(), "pachiware-operator-session-"));
    try {
      const result = run(directory, `
        import { completeOperatorSetup } from ${JSON.stringify(join(dbSource, "setup.ts"))};
        import { getTenantByApiKey } from ${JSON.stringify(join(dbSource, "tenancy.ts"))};
        import { operatorSessionMiddleware } from ${JSON.stringify(sessionSource)};
        await completeOperatorSetup(${JSON.stringify(directory)});
        const middleware = operatorSessionMiddleware(${JSON.stringify(directory)}, async (apiKey, tenantId) => (await getTenantByApiKey(apiKey))?.tenant.id === tenantId);
        const invoke = async (headers = {}, remoteAddress = "127.0.0.1") => {
          const values = {};
          const response = { statusCode: 200, setHeader: (name, value) => values[name] = value, end: (body) => response.body = body };
          await middleware({ url: "/api/console/session", method: "GET", headers: { host: "127.0.0.1:3000", ...headers }, socket: { remoteAddress } }, response, () => { response.statusCode = 404; response.end(""); });
          return { status: response.statusCode, cache: values["Cache-Control"], ...JSON.parse(response.body) };
        };
        const local = await invoke();
        const hostile = await invoke({ origin: "http://evil.example" });
        const crossSite = await invoke({ "sec-fetch-site": "cross-site" });
        const hostileReferer = await invoke({ referer: "http://evil.example/dashboard" });
        const lan = await invoke({}, "192.168.1.10");
        const startingMiddleware = operatorSessionMiddleware(${JSON.stringify(directory)}, async () => { throw new Error("backend unavailable"); });
        const startingResponse = { statusCode: 200, setHeader() {}, end: (body) => startingResponse.body = body };
        await startingMiddleware({ url: "/api/console/session", method: "GET", headers: { host: "127.0.0.1:3000" }, socket: { remoteAddress: "127.0.0.1" } }, startingResponse, () => startingResponse.end(""));
        const starting = { status: startingResponse.statusCode, ...JSON.parse(startingResponse.body) };
        console.log(JSON.stringify({
          local: { status: local.status, cache: local.cache, apiKey: local.apiKey, platformKey: local.platformKey },
          hostile: { status: hostile.status, error: hostile.error, leaked: JSON.stringify(hostile).includes("operator-platform-key") },
          crossSite: { status: crossSite.status, error: crossSite.error },
          hostileReferer: { status: hostileReferer.status, error: hostileReferer.error },
          lan: { status: lan.status, error: lan.error },
          starting,
        }));
      `);
      expect(result.exitCode, stderr(result)).toBe(0);
      const value = JSON.parse(stdout(result).split("\n").at(-1)!);
      expect(value.local).toMatchObject({ status: 200, cache: "no-store", platformKey: "operator-platform-key" });
      expect(value.local.apiKey).toMatch(/^pk_live_/);
      expect(value.hostile).toEqual({
        status: 403,
        error: "Automatic console access is available only from localhost.",
        leaked: false,
      });
      for (const blocked of [value.crossSite, value.hostileReferer, value.lan]) {
        expect(blocked).toEqual({ status: 403, error: "Automatic console access is available only from localhost." });
      }
      expect(value.starting).toEqual({ status: 503, error: "Agent is starting; try again shortly." });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("returns a secret-free 404 when the access file is missing or its API key was revoked", () => {
    const directory = mkdtempSync(join(tmpdir(), "pachiware-operator-missing-session-"));
    try {
      const result = run(directory, `
        import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
        import { completeOperatorSetup } from ${JSON.stringify(join(dbSource, "setup.ts"))};
        import { encryptSecret } from ${JSON.stringify(join(dbSource, "crypto.ts"))};
        import { getTenantByApiKey, revokeApiKey } from ${JSON.stringify(join(dbSource, "tenancy.ts"))};
        import { operatorSessionMiddleware } from ${JSON.stringify(sessionSource)};
        const file = ${JSON.stringify(join(directory, "operator-access.json"))};
        await completeOperatorSetup(${JSON.stringify(directory)});
        const saved = JSON.parse(readFileSync(file, "utf8"));
        await revokeApiKey(saved.keyId);
        // Keep the encrypted payload structurally valid: endpoint must reject a revoked handoff.
        writeFileSync(file, JSON.stringify({ ...saved, apiKeyEncrypted: encryptSecret("pk_live_revoked") }));
        const middleware = operatorSessionMiddleware(${JSON.stringify(directory)}, async (apiKey, tenantId) => (await getTenantByApiKey(apiKey))?.tenant.id === tenantId);
        const invoke = async () => {
          const response = { statusCode: 200, setHeader() {}, end: (body) => response.body = body };
          await middleware({ url: "/api/console/session", method: "GET", headers: { host: "127.0.0.1:3000" }, socket: { remoteAddress: "127.0.0.1" } }, response, () => response.end(""));
          return { status: response.statusCode, ...JSON.parse(response.body) };
        };
        const revoked = await invoke();
        writeFileSync(file, JSON.stringify({ ...saved, apiKeyEncrypted: "v1:not-base64:not-base64:not-base64" }));
        const malformed = await invoke();
        unlinkSync(file);
        const missing = await invoke();
        console.log(JSON.stringify({
          revoked: { status: revoked.status, error: revoked.error, leaked: JSON.stringify(revoked).includes("operator-platform-key") },
          malformed: { status: malformed.status, error: malformed.error, leaked: JSON.stringify(malformed).includes("operator-platform-key") },
          missing: { status: missing.status, error: missing.error, leaked: JSON.stringify(missing).includes("operator-platform-key") },
        }));
      `);
      expect(result.exitCode, stderr(result)).toBe(0);
      expect(JSON.parse(stdout(result).split("\n").at(-1)!)).toEqual({
        revoked: { status: 404, error: "CLI setup has not completed.", leaked: false },
        malformed: { status: 404, error: "CLI setup has not completed.", leaked: false },
        missing: { status: 404, error: "CLI setup has not completed.", leaked: false },
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
