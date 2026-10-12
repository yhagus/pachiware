import { Hono } from "hono";
import type { TenantEnv } from "../../middleware/tenant.js";
import { availabilityRoutes } from "../availability.js";

/** Tenant-level availability rules; bot, guild and channel levels live under /api/v1/bots/:id. */
export const availabilityTenantRoutes = new Hono<TenantEnv>();
availabilityRoutes(availabilityTenantRoutes, "/", async (c) => ({ tenantId: c.get("tenantId"), level: "tenant" }));
