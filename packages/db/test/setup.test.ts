import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const workspace = process.cwd();
const source = join(workspace, "packages/db/src");
const encryptionKey = Buffer.alloc(32, 17).toString("base64");

function runSetup(directory: string, script: string) {
  return Bun.spawnSync({
    cmd: ["bun", "--eval", script],
    cwd: workspace,
    env: {
      ...process.env,
      DATABASE_URL: `sqlite:${join(directory, "pachiware.db")}`,
      PLATFORM_ENCRYPTION_KEY: encryptionKey,
      PLATFORM_ADMIN_KEY: "test-platform-key",
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

describe("completeOperatorSetup", () => {
  test("creates a protected encrypted handoff for the default tenant and is idempotent", () => {
    const directory = mkdtempSync(join(tmpdir(), "pachiware-operator-setup-"));
    try {
      const result = runSetup(directory, `
        import { statSync, readFileSync } from "node:fs";
        import { completeOperatorSetup } from ${JSON.stringify(join(source, "setup.ts"))};
        import { repositories } from ${JSON.stringify(join(source, "index.ts"))};
        const file = ${JSON.stringify(join(directory, "operator-access.json"))};
        const first = await completeOperatorSetup(${JSON.stringify(directory)});
        const saved = readFileSync(file, "utf8");
        const again = await completeOperatorSetup(${JSON.stringify(directory)});
        const parsed = JSON.parse(readFileSync(file, "utf8"));
        console.log(JSON.stringify({
          slug: first.slug,
          mode: statSync(file).mode & 0o777,
          sameTenant: again.id === first.id && parsed.tenantId === first.id,
          noTenantKey: !("apiKeyEncrypted" in parsed) && !("keyId" in parsed),
          plaintextPlatformKey: saved.includes(process.env.PLATFORM_ADMIN_KEY),
          defaultTenant: (await repositories().tenants.getBySlug("default"))?.id === first.id,
        }));
      `);
      expect(result.exitCode, stderr(result)).toBe(0);
      expect(JSON.parse(stdout(result).split("\n").at(-1)!)).toEqual({ slug: "default", mode: 0o600, sameTenant: true, noTenantKey: true, plaintextPlatformKey: false, defaultTenant: true });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("refuses to issue console access for a suspended default tenant", () => {
    const directory = mkdtempSync(join(tmpdir(), "pachiware-operator-suspended-"));
    try {
      const result = runSetup(directory, `
        import { completeOperatorSetup } from ${JSON.stringify(join(source, "setup.ts"))};
        import { repositories } from ${JSON.stringify(join(source, "index.ts"))};
        await completeOperatorSetup(${JSON.stringify(directory)});
        const tenant = await repositories().tenants.getBySlug("default");
        await repositories().tenants.update(tenant.id, { status: "suspended" });
        try {
          await completeOperatorSetup(${JSON.stringify(directory)});
          console.log("unexpected success");
        } catch (error) {
          console.log(error instanceof Error ? error.message : String(error));
        }
      `);
      expect(result.exitCode, stderr(result)).toBe(0);
      expect(stdout(result)).toEndWith("Default tenant is suspended; enable it through the Admin API before completing setup.");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
