import { createMiddleware } from "hono/factory";
import { safeEqual } from "@pachiware/db";
import { config } from "../config.js";

export const platformAdminMiddleware = createMiddleware(async (c, next) => {
  const key = c.req.header("X-Platform-Key");
  if (!key || !safeEqual(key, config.platformAdminKey)) return c.json({ success: false, error: "Invalid platform admin key" }, 401);
  await next();
});
