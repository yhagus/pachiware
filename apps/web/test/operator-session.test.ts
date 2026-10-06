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
        import { operatorSessionMiddleware } from ${JSON.stringify(sessionSource)};
        await completeOperatorSetup(${JSON.stringify(directory)});
        const middleware = operatorSessionMiddleware(${JSON.stringify(directory)});
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
        console.log(JSON.stringify({
          local: { status: local.status, cache: local.cache, platformKey: local.platformKey, hasApiKey: "apiKey" in local },
          hostile: { status: hostile.status, error: hostile.error, leaked: JSON.stringify(hostile).includes("operator-platform-key") },
          crossSite: { status: crossSite.status, error: crossSite.error },
          hostileReferer: { status: hostileReferer.status, error: hostileReferer.error },
          lan: { status: lan.status, error: lan.error },
        }));
      `);
      expect(result.exitCode, stderr(result)).toBe(0);
      const value = JSON.parse(stdout(result).split("\n").at(-1)!);
      expect(value.local).toMatchObject({ status: 200, cache: "no-store", platformKey: "operator-platform-key" });
      expect(value.local.hasApiKey).toBe(false);
      expect(value.hostile).toEqual({
        status: 403,
        error: "Automatic console access is available only from localhost.",
        leaked: false,
      });
      for (const blocked of [value.crossSite, value.hostileReferer, value.lan]) {
        expect(blocked).toEqual({ status: 403, error: "Automatic console access is available only from localhost." });
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("returns a secret-free 404 when the access file is missing or unreadable", () => {
    const directory = mkdtempSync(join(tmpdir(), "pachiware-operator-missing-session-"));
    try {
      const result = run(directory, `
        import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
        import { completeOperatorSetup } from ${JSON.stringify(join(dbSource, "setup.ts"))};
        import { operatorSessionMiddleware } from ${JSON.stringify(sessionSource)};
        const file = ${JSON.stringify(join(directory, "operator-access.json"))};
        await completeOperatorSetup(${JSON.stringify(directory)});
        const saved = JSON.parse(readFileSync(file, "utf8"));
        const middleware = operatorSessionMiddleware(${JSON.stringify(directory)});
        const invoke = async () => {
          const response = { statusCode: 200, setHeader() {}, end: (body) => response.body = body };
          await middleware({ url: "/api/console/session", method: "GET", headers: { host: "127.0.0.1:3000" }, socket: { remoteAddress: "127.0.0.1" } }, response, () => response.end(""));
          return { status: response.statusCode, ...JSON.parse(response.body) };
        };
        writeFileSync(file, JSON.stringify({ ...saved, platformKeyEncrypted: "v1:not-base64:not-base64:not-base64" }));
        const malformed = await invoke();
        unlinkSync(file);
        const missing = await invoke();
        console.log(JSON.stringify({
          malformed: { status: malformed.status, error: malformed.error, leaked: JSON.stringify(malformed).includes("operator-platform-key") },
          missing: { status: missing.status, error: missing.error, leaked: JSON.stringify(missing).includes("operator-platform-key") },
        }));
      `);
      expect(result.exitCode, stderr(result)).toBe(0);
      expect(JSON.parse(stdout(result).split("\n").at(-1)!)).toEqual({
        malformed: { status: 404, error: "CLI setup has not completed.", leaked: false },
        missing: { status: 404, error: "CLI setup has not completed.", leaked: false },
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
