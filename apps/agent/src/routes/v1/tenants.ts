import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { repositories } from "@pachiware/db";
import type { TenantEnv } from "../../middleware/tenant.js";
import { object, string } from "../validation.js";

// Key-level routes: no X-Tenant-Id; tenants created here belong to the calling key.
export const tenantRoutes = new Hono<TenantEnv>();
tenantRoutes.get("/", async (c) => c.json({ success: true, tenants: await repositories().tenants.listForApiKey(c.get("apiKey").id) }));
tenantRoutes.post("/", async (c) => {
  const body = object(await c.req.json(), "body");
  const name = string(body.name, "name")!;
  const slug = string(body.slug, "slug", true);
  if (slug && !/^[a-z0-9][a-z0-9_-]*$/.test(slug)) throw new HTTPException(400, { message: "Invalid slug" });
  const { tenants } = repositories();
  if (slug && await tenants.getBySlug(slug)) return c.json({ error: "Slug is already taken" }, 409);
  return c.json({ success: true, tenant: await tenants.create({ name, slug, apiKeyId: c.get("apiKey").id }) }, 201);
});
