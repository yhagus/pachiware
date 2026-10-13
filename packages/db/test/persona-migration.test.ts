import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const source = join(process.cwd(), "packages/db/src");

// The three strings a tenant's prompt could hold before the persona existed: the SQLite DDL default, the Drizzle default, and the agent's fallback.
const OLD_DEFAULTS = [
  "You are Pachiware Agent, a helpful and precise assistant.",
  "You are Pachiware Agent, an intelligent autonomous system capable of channel management, task tracking, and problem solving. You execute actions via your available tools and communicate clearly and concisely.",
  "You are Pachiware Agent, an intelligent autonomous system capable of channel management, task tracking, and problem solving.",
];

test("migration replaces only prompts byte-equal to an old default; an edited prompt survives", () => {
  const directory = mkdtempSync(join(tmpdir(), "pachiware-persona-"));
  try {
    const result = Bun.spawnSync({
      cmd: ["bun", "--eval", `
        import { runMigrations } from ${JSON.stringify(join(source, "migrate.ts"))};
        import { queryClient } from ${JSON.stringify(join(source, "index.ts"))};
        import { createTenant } from ${JSON.stringify(join(source, "tenancy.ts"))};
        await runMigrations();
        const prompts = ${JSON.stringify([...OLD_DEFAULTS, "You are Pachiware Agent, a helpful and precise assistant. Answer in Javanese.", "custom persona"])};
        const ids = [];
        for (const prompt of prompts) {
          const t = await createTenant({ name: "t" + ids.length });
          queryClient.query("UPDATE agents_config SET system_prompt = ? WHERE tenant_id = ?").run(prompt, t.id);
          ids.push(t.id);
        }
        const fresh = await createTenant({ name: "fresh" });
        await runMigrations();
        const read = (id) => queryClient.query("SELECT system_prompt AS p FROM agents_config WHERE tenant_id = ?").get(id).p;
        console.log(JSON.stringify({ fresh: read(fresh.id), migrated: ids.map(read) }));
      `],
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: `sqlite:${join(directory, "p.db")}`, NODE_ENV: "test", PLATFORM_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64"), OPENAI_API_KEY: undefined, ANTHROPIC_API_KEY: undefined, CUSTOM_LLM_API_KEY: undefined, DISCORD_BOT_TOKEN: undefined },
    });
    expect(result.exitCode, new TextDecoder().decode(result.stderr)).toBe(0);
    const { fresh, migrated } = JSON.parse(new TextDecoder().decode(result.stdout).trim().split("\n").at(-1)!);
    expect(fresh).toMatch(/administrative assistant/i);
    expect(migrated.slice(0, 3)).toEqual([fresh, fresh, fresh]);
    expect(migrated[3]).toBe("You are Pachiware Agent, a helpful and precise assistant. Answer in Javanese.");
    expect(migrated[4]).toBe("custom persona");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
