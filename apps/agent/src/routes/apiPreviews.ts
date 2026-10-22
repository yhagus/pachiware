import { Hono, type Context } from "hono";
import { repositories, type ApiPreviewSummary } from "@pachiware/db";
import { previewUrl } from "@pachiware/skills";

const previewOut = (p: ApiPreviewSummary, botName: string | null) => ({
  id: p.id, url: previewUrl(p.id), botId: p.botId, botName, guildId: p.guildId, channelId: p.channelId, sourcePath: p.sourcePath, title: p.title,
  version: p.version, createdById: p.createdById, createdByName: p.createdByName, createdAt: p.createdAt,
});

/**
 * A tenant's API previews (ADR 0022): GET lists them newest first, one bot's with `?botId=`, each with its page's address and its bot's name;
 * DELETE `/:previewId` revokes one, and its link stops at once. Nothing creates one here: publishOpenApi does, from chat.
 * `tenantOf` names the tenant; an unknown tenant or another tenant's preview is a 404.
 */
export function apiPreviewRoutes(base: string, tenantOf: (c: Context<any>) => string) {
  const app = new Hono<any>();
  app.get(base, async (c) => {
    const tenantId = tenantOf(c);
    if (!await repositories().tenants.get(tenantId)) return c.json({ error: "Tenant not found" }, 404);
    const rows = await repositories().apiPreviews.list(tenantId, { botId: c.req.query("botId") || undefined });
    const names = new Map(await Promise.all([...new Set(rows.map((r) => r.botId))].map(async (id) => [id, (await repositories().bots.get(id, tenantId))?.name ?? null] as const)));
    return c.json({ success: true, previews: rows.map((r) => previewOut(r, names.get(r.botId) ?? null)) });
  });
  app.delete(`${base}/:previewId`, async (c) => {
    if (!await repositories().apiPreviews.remove(tenantOf(c), c.req.param("previewId")!)) return c.json({ error: "API preview not found" }, 404);
    return c.json({ success: true });
  });
  return app;
}
