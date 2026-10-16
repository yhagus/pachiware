import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Tests and the processes they spawn keep runtime-config.json out of the checkout, so a run never
// records a Database engine for the developer's own installation, or trips over the one it has.
process.env.PACHIWARE_RUNTIME_CONFIG ||= join(mkdtempSync(join(tmpdir(), "pachiware-test-runtime-")), "runtime-config.json");

// Secrets are encrypted at rest, so every test run needs a platform key. A fresh worktree or CI
// checkout has no .env, so tests get a fixed one; a key the developer set is kept.
process.env.PLATFORM_ENCRYPTION_KEY ||= Buffer.alloc(32, 4).toString("base64");
