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
  test("creates a protected encrypted handoff, reuses it, and reissues a revoked key", () => {
    const directory = mkdtempSync(join(tmpdir(), "pachiware-operator-setup-"));
    try {
      const result = runSetup(directory, `
        import { statSync, readFileSync } from "node:fs";
        import { completeOperatorSetup } from ${JSON.stringify(join(source, "setup.ts"))};
        import { decryptSecret } from ${JSON.stringify(join(source, "crypto.ts"))};
        import { getTenantBySlug, getTenantByApiKey, revokeApiKey } from ${JSON.stringify(join(source, "tenancy.ts"))};
        const first = await completeOperatorSetup(${JSON.stringify(directory)});
        const initial = JSON.parse(readFileSync(${JSON.stringify(join(directory, "operator-access.json"))}, "utf8"));
        const firstRaw = decryptSecret(initial.apiKeyEncrypted);
        await completeOperatorSetup(${JSON.stringify(directory)});
        const reused = JSON.parse(readFileSync(${JSON.stringify(join(directory, "operator-access.json"))}, "utf8"));
        await revokeApiKey(reused.keyId);
        await completeOperatorSetup(${JSON.stringify(directory)});
        const reissued = JSON.parse(readFileSync(${JSON.stringify(join(directory, "operator-access.json"))}, "utf8"));
        const current = await getTenantByApiKey(decryptSecret(reissued.apiKeyEncrypted));
        console.log(JSON.stringify({
          slug: first.slug,
          mode: statSync(${JSON.stringify(join(directory, "operator-access.json"))}).mode & 0o777,
          hasRawSecret: JSON.stringify(reissued).includes(firstRaw),
          reusedKey: initial.keyId === reused.keyId,
          reissuedKey: reused.keyId !== reissued.keyId,
          tenant: current?.tenant.slug,
          defaultTenant: (await getTenantBySlug("default"))?.id === first.id,
        }));
      `);
      expect(result.exitCode, stderr(result)).toBe(0);
      expect(JSON.parse(stdout(result).split("\n").at(-1)!)).toEqual({
        slug: "default",
        mode: 0o600,
        hasRawSecret: false,
        reusedKey: true,
        reissuedKey: true,
        tenant: "default",
        defaultTenant: true,
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("refuses to issue console access for a suspended default tenant", () => {
    const directory = mkdtempSync(join(tmpdir(), "pachiware-operator-suspended-"));
    try {
      const result = runSetup(directory, `
        import { completeOperatorSetup } from ${JSON.stringify(join(source, "setup.ts"))};
        import { getTenantBySlug, updateTenant } from ${JSON.stringify(join(source, "tenancy.ts"))};
        await completeOperatorSetup(${JSON.stringify(directory)});
        const tenant = await getTenantBySlug("default");
        await updateTenant(tenant.id, { status: "suspended" });
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
