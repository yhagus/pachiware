import { expect } from "bun:test";
import { discordScenario } from "./support/discordScenario";
import { openAIReply, useProfile } from "./support/images";

discordScenario("every model call's usage event records how long the provider took to answer", async (s) => {
  await useProfile(s, { provider: "openai", model: "gpt-slow", acceptsImages: false });
  s.http.on("POST api.openai.com/v1/chat/completions", async () => { await Bun.sleep(120); return openAIReply("Here."); });
  await s.discord.send(`${s.discord.mention} hello`);
  const { usageEvents } = await import(process.cwd() + "/packages/db/src/index.ts") as any;
  const rows: any[] = (await s.db.select().from(usageEvents)).filter((r: any) => r.type === "llm_tokens");
  expect(rows).toHaveLength(1);
  expect(rows[0].model).toBe("gpt-slow");
  expect(rows[0].metadata.latencyMs).toBeGreaterThanOrEqual(120);
  expect(rows[0].metadata.latencyMs).toBeLessThan(5000);
});
