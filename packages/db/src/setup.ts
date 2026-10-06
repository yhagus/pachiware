import { chmodSync, existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { runMigrations, runSeed, getTenantBySlug, createTenant } from "./index.js";
import { encryptSecret } from "./crypto.js";

export async function completeOperatorSetup(workspaceRoot = process.cwd()) {
  if (!process.env.PLATFORM_ADMIN_KEY && !process.env.AGENT_SECRET_KEY) throw new Error("Configure PLATFORM_ADMIN_KEY or AGENT_SECRET_KEY first.");
  encryptSecret("");
  await runMigrations();
  await runSeed();
  let tenant = await getTenantBySlug("default");
  if (!tenant) tenant = await createTenant({ name: "Default Tenant", slug: "default", metadata: { operatorSetup: true } });
  if (tenant.status !== "active") throw new Error("Default tenant is suspended; enable it through the Admin API before completing setup.");

  persistAccess(resolve(workspaceRoot, "operator-access.json"), tenant.id);
  return tenant;
}

function persistAccess(file: string, tenantId: string) {
  const platformKey = process.env.PLATFORM_ADMIN_KEY || process.env.AGENT_SECRET_KEY;
  if (!platformKey) throw new Error("Configure PLATFORM_ADMIN_KEY or AGENT_SECRET_KEY first.");
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify({ tenantId, platformKeyEncrypted: encryptSecret(platformKey) }, null, 2) + "\n", { mode: 0o600 });
  chmodSync(temporary, 0o600);
  renameSync(temporary, file);
  chmodSync(file, 0o600);
}

if (import.meta.main) {
  completeOperatorSetup().then((tenant) => {
    console.log(`Operator setup complete for ${tenant.name}. Open http://localhost:3000 after starting Pachiware.`);
    process.exit(0);
  }).catch((err) => {
    console.error(`Operator setup failed: ${err.message}`);
    process.exit(1);
  });
}
