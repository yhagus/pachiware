import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_SYSTEM_PROMPT, OLD_DEFAULT_PROMPTS } from "../src/persona.ts";

const source = join(process.cwd(), "packages/db/src");
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

// The sha256 of every default a tenant's prompt could hold from before the current persona, taken from each one as it shipped.
// A changed byte in a frozen copy in persona.ts would leave the tenants who kept that default on it.
const SHIPPED_DEFAULTS = [
  "a8c1c5924db09f82ce06ba5af5272d3107d95f1c5b65c6ae8cb9e824c8fab8be", // the SQLite DDL default: "You are Pachiware Agent, a helpful and precise assistant."
  "42aa10bbadf6e89385868a9a20850b1931c6ce23c66863bd79384514e6e84467", // the Drizzle default
  "69acb08a6178bdcbf4c43653dd57cc3051209724ca8163b48418f7f4c9186acd", // the agent's fallback
  "151076697748913eef35fd7eb383ee972958d77bb9bf87dcf28be045d30d26bf", // the first persona (#85)
  "63895b902078e3a855121dbd57063d623949047d4a7c6d322a4440a9a1a83d88", // with Decisions and Notes, before #121
  "e658b12c3d05c79ffa4a097c513c336ccc4568d2854370a057171e60fda60156", // assignees (#121), before #132
  "498eafbed52db1f8f75602026ae0f18b61dd503a19b8d61906799a43ee59d37e", // project work (#132), before #137
  "05bcf4788de6f33fadcaace771fc74888359dc4c0463ee30f6796e791a17897d", // bulk task changes (#137), before #143
  "8b34ba1452141b0c3e1679b5971f5e1561be496b770729ffeba8a15fed2092cb", // long text to keepAsNote (#143), before #154
  "4e6d1fe978dacc83e46de614e09684e6bbf27a961da717e7c8825d36c78d6b6b", // kept material across channels (#154), before #197
  "a1ae52c75293b390b2875e54a02e936369208a6aa5ed7fe4949893cbb35f6bbc", // query variants (#197)
  "fec9dcde426223ad713a5a2ad374a300e9930c90df61179c13b99c1ff2fe91bf", // Tasks across channels (#200)
  "6459e7b7b2bcdbb706529d1db96f1d520ec4fe59bbf0801c0104f40991f15c93", // Daily logs (#202)
  "e4c3f8aaf75fa4686049a2d67657faf619df0a455ae68ffbb246b39dbb1eba95", // git and Plane (#201), before #206
  "af1bb2205ffb9392b8783d3d2e646ab585c19c8aae8c5622cb83c1913d70468a", // readMessage (#206)
  "9e8fbab800ffe18b71f1ab97374159d9a84782a0f2b6129b1f7f2a7b7f122c27", // the recall tool
  "48b4f53ca91471e0dd4bcaa935f584d8dda5f79a9e2d0bb9126ca5c14a4f7910", // citations rendered by the server (#212)
  "3c3e1f2c6499545934532c656befe40b62604652261f11457e9877962417970c", // notLogged (#233)
  "ed803632d73c971046fca7711b605142799ff2faf0b219eb4a0dc93e55d671af", // Phase 43 (#241–#245)
  "3a45bb708448732525de20416134a4d70290abb1c4b77dd178c523cc829368f9", // Phase 44 (#246–#256)
  "5bc6ff44f873928686c86f0cd773255423d80383f3daed7edca42950bb66c021", // Phase 45 (#257–#260)
  "b471e9ee84234b89c9771acc2adb686d7e25494fdb115a0e63dd43ce5ce785e9", // readFile through the bot's model (#266)
];

test("the old defaults the migration replaces are the shipped defaults byte for byte, and the current default is not one of them", () => {
  expect(OLD_DEFAULT_PROMPTS.map(sha256)).toEqual(SHIPPED_DEFAULTS);
  expect(OLD_DEFAULT_PROMPTS[0]).toBe("You are Pachiware Agent, a helpful and precise assistant.");
  expect(SHIPPED_DEFAULTS).not.toContain(sha256(DEFAULT_SYSTEM_PROMPT));
});

test("migration replaces only prompts byte-equal to an old default, the first persona included; an edited prompt survives", () => {
  const firstPersona = OLD_DEFAULT_PROMPTS[3]!;
  const edited = ["You are Pachiware Agent, a helpful and precise assistant. Answer in Javanese.", "custom persona", `${firstPersona}\nAnswer in Javanese.`];
  const directory = mkdtempSync(join(tmpdir(), "pachiware-persona-"));
  try {
    // A file, not `bun --eval`: every old default in one argument is over Linux's argument size limit (E2BIG).
    const script = join(directory, "migrate-prompts.ts");
    writeFileSync(script, `
      import { runMigrations } from ${JSON.stringify(join(source, "migrate.ts"))};
      import { queryClient } from ${JSON.stringify(join(source, "internal.ts"))};
      import { repositories } from ${JSON.stringify(join(source, "index.ts"))};
      await runMigrations();
      const prompts = ${JSON.stringify([...OLD_DEFAULT_PROMPTS, ...edited])};
      const ids = [];
      for (const prompt of prompts) {
        const t = await repositories().tenants.create({ name: "t" + ids.length });
        queryClient.query("UPDATE agents_config SET system_prompt = ? WHERE tenant_id = ?").run(prompt, t.id);
        ids.push(t.id);
      }
      const fresh = await repositories().tenants.create({ name: "fresh" });
      await runMigrations();
      const read = (id) => queryClient.query("SELECT system_prompt AS p FROM agents_config WHERE tenant_id = ?").get(id).p;
      console.log(JSON.stringify({ fresh: read(fresh.id), migrated: ids.map(read) }));
    `);
    const result = Bun.spawnSync({
      cmd: ["bun", script],
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: `sqlite:${join(directory, "p.db")}`, NODE_ENV: "test", PLATFORM_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64"), OPENAI_API_KEY: undefined, ANTHROPIC_API_KEY: undefined, CUSTOM_LLM_API_KEY: undefined, DISCORD_BOT_TOKEN: undefined },
    });
    expect(result.exitCode, new TextDecoder().decode(result.stderr)).toBe(0);
    const { fresh, migrated } = JSON.parse(new TextDecoder().decode(result.stdout).trim().split("\n").at(-1)!);
    expect(fresh).toBe(DEFAULT_SYSTEM_PROMPT);
    expect(migrated).toEqual([...Array(SHIPPED_DEFAULTS.length).fill(DEFAULT_SYSTEM_PROMPT), ...edited]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
