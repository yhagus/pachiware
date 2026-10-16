import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const preload = join(import.meta.dir, "preload.ts");
const crypto = join(import.meta.dir, "../src/crypto.ts");

// Runs in an empty directory, so Bun finds no .env to load: what the process sees comes from the preload alone.
function runPreloaded(script: string, env: Record<string, string | undefined>) {
  const { PLATFORM_ENCRYPTION_KEY: _key, AGENT_SECRET_KEY: _secret, ...inherited } = process.env;
  const result = Bun.spawnSync({
    cmd: ["bun", "--preload", preload, "--eval", script],
    cwd: mkdtempSync(join(tmpdir(), "pachiware-preload-")),
    env: { ...inherited, NODE_ENV: "test", ...env },
  });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  return result.stdout.toString().trim();
}

test("a test process with no .env can encrypt secrets", () => {
  const output = runPreloaded(`import { encryptSecret, decryptSecret } from ${JSON.stringify(crypto)}; console.log(decryptSecret(encryptSecret("token")));`, {});
  expect(output).toBe("token");
});

test("a platform key the developer set is left as it is", () => {
  const developerKey = Buffer.alloc(32, 200).toString("base64");
  expect(runPreloaded("console.log(process.env.PLATFORM_ENCRYPTION_KEY)", { PLATFORM_ENCRYPTION_KEY: developerKey })).toBe(developerKey);
});
