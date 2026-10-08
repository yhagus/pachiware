import { describe, expect, test } from "bun:test";
import { chmodSync, copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const workspace = process.cwd();
const cli = join(workspace, "packages/cli/src/index.ts");
const dbSource = join(workspace, "packages/db/src");

function text(data: Uint8Array | undefined) {
  return new TextDecoder().decode(data).trim();
}

describe("pachiware init", () => {
  test("install script rejects an incompatible Bun before cloning or installing dependencies", () => {
    const directory = mkdtempSync(join(tmpdir(), "pachiware-installer-version-"));
    const bin = join(directory, "bin");
    const marker = join(directory, "unexpected-command");
    try {
      mkdirSync(bin, { recursive: true });
      writeFileSync(join(bin, "bun"), "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then echo 1.3.0; exit 0; fi\necho bun >> \"$PACHIWARE_TEST_MARKER\"\nexit 99\n");
      writeFileSync(join(bin, "git"), "#!/bin/sh\necho git >> \"$PACHIWARE_TEST_MARKER\"\nexit 99\n");
      chmodSync(join(bin, "bun"), 0o755);
      chmodSync(join(bin, "git"), 0o755);
      const result = Bun.spawnSync({
        cmd: ["bash", join(workspace, "install.sh")],
        cwd: directory,
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          PACHIWARE_DIR: join(directory, "installation"),
          PACHIWARE_TEST_MARKER: marker,
        },
      });
      expect(result.exitCode).toBe(1);
      expect(text(result.stdout)).toContain("Bun 1.3.0 cannot read this repository lockfile. Bun 1.4.0+ is required.");
      expect(text(result.stdout)).toContain("Upgrade with bun upgrade");
      expect(existsSync(marker)).toBe(false);
      expect(existsSync(join(directory, "installation"))).toBe(false);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("performs the complete SQLite operator setup in an isolated target workspace", () => {
    const directory = mkdtempSync(join(tmpdir(), "pachiware-cli-init-"));
    const target = join(directory, "installation");
    const unrelatedWorkspace = join(directory, "unrelated-workspace");
    try {
      mkdirSync(target, { recursive: true });
      // Keep import.meta.dir in the fixture itself, while sharing only installed
      // dependencies with this checkout.
      cpSync(dbSource, join(target, "packages/db/src"), { recursive: true });
      symlinkSync(join(workspace, "node_modules"), join(target, "node_modules"));
      symlinkSync(join(workspace, "packages/db/node_modules"), join(target, "packages/db/node_modules"));
      copyFileSync(join(workspace, ".env.example"), join(target, ".env.example"));

      // The setup child must use the init target even if the invoking CLI has
      // a stale workspace variable from a shell or global installation.
      const env: Record<string, string | undefined> = { ...process.env, PACHIWARE_DIR: unrelatedWorkspace };
      delete env.DATABASE_URL;
      delete env.PLATFORM_ENCRYPTION_KEY;
      delete env.PLATFORM_ADMIN_KEY;
      delete env.AGENT_SECRET_KEY;
      const result = Bun.spawnSync({
        cmd: ["bun", cli, "init", target, "--database", "sqlite"],
        cwd: workspace,
        env,
      });

      expect(result.exitCode, text(result.stderr)).toBe(0);
      const envFile = readFileSync(join(target, ".env"), "utf8");
      const access = JSON.parse(readFileSync(join(target, "operator-access.json"), "utf8"));
      expect(text(result.stdout)).toContain("Setup complete.");
      expect(envFile).toContain('DATABASE_URL="sqlite:./data/pachiware.db"');
      expect(envFile).toMatch(/^PLATFORM_ADMIN_KEY="[a-f0-9]{64}"$/m);
      expect(envFile).toMatch(/^PLATFORM_ENCRYPTION_KEY="[A-Za-z0-9+/]{43}="$/m);
      expect(access).toMatchObject({ tenantId: expect.any(String) });
      expect(access.keyId).toBeUndefined();
      expect(access.apiKeyEncrypted).toBeUndefined();
      expect(access.platformKeyEncrypted).toMatch(/^v1:/);
      expect(lstatSync(join(target, "operator-access.json")).mode & 0o777).toBe(0o600);
      expect(existsSync(join(target, "data/pachiware.db"))).toBe(true);
      expect(existsSync(join(unrelatedWorkspace, "data/pachiware.db"))).toBe(false);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
