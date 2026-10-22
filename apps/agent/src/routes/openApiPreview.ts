import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Hono, type Context } from "hono";
import { getConnInfo } from "hono/bun";
import { repositories } from "@pachiware/db";
import { forViewer } from "@pachiware/skills";
import { CacheService } from "../cache/redis.js";

/**
 * API previews (ADR 0022): the one public page the agent serves. Anyone with a preview's link may open it, with no key and no
 * session, so it shows nothing else: no tenant, no bot, no other preview. The viewer is Scalar's standalone bundle at a pinned
 * version, served from here so no other site sees who opens a preview, and every call it could make elsewhere is switched off.
 */

const SCALAR = JSON.parse(readFileSync(Bun.resolveSync("@scalar/api-reference/package.json", import.meta.dir), "utf8")) as { version: string };
const SCALAR_JS = join(dirname(Bun.resolveSync("@scalar/api-reference/package.json", import.meta.dir)), "dist/browser/standalone.js");
const scalarPath = `_/scalar-${SCALAR.version}.js`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Requests a minute from one address. */
const PREVIEW_RATE = 60;

const CSP = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const PRIVATE = /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$|::ffff:(127|10)\.|fc|fd)/i;

/** Who is asking: the connecting address, or, behind a proxy on this machine or network, the first address it forwards (anyone else could forge that header). */
function clientAddress(c: Context) {
  let socket: string | undefined;
  try { socket = getConnInfo(c).remote.address; } catch {}
  const forwarded = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
  return socket && !PRIVATE.test(socket) ? socket : forwarded || socket || "unknown";
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);

/** The page: the viewer and its start script, both from this agent; the document comes from `view.json` beside it. */
const page = (id: string, title: string) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escapeHtml(title)}</title>
</head>
<body>
<div id="app" data-url="./${id}/view.json"></div>
<noscript>This page needs JavaScript. The document itself: <a href="./${id}/openapi.json">openapi.json</a></noscript>
<script src="./${scalarPath}"></script>
<script src="./${startPath}"></script>
</body>
</html>
`;

/** Starts the viewer on the page's own document, with every call to another site switched off. */
const START = `(function () {
  var app = document.getElementById("app");
  Scalar.createApiReference(app, {
    url: app.dataset.url,
    withDefaultFonts: false, telemetry: false, hideClientButton: true, hideTestRequestButton: true,
    showDeveloperTools: "never", agent: { disabled: true }, mcp: { disabled: true }, documentDownloadType: "none",
  });
})();
`;

/** Both scripts are named by what they hold, so a browser may keep them forever and an upgrade is never served stale. */
const startPath = `_/start-${createHash("sha256").update(START).digest("hex").slice(0, 12)}.js`;
const notFound = (c: Context) => c.text("Not found", 404);

export function openApiPreviewRoutes() {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.header("X-Robots-Tag", "noindex, nofollow");
    c.header("Referrer-Policy", "no-referrer");
    c.header("X-Content-Type-Options", "nosniff");
    const rate = await CacheService.checkRateLimit(`openapi:${clientAddress(c)}`, PREVIEW_RATE, 60);
    if (!rate.allowed) { c.header("Retry-After", String(rate.resetIn)); return c.text("Too many requests", 429); }
    await next();
  });

  app.get(`/${scalarPath}`, () => new Response(Bun.file(SCALAR_JS), { headers: { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" } }));
  app.get(`/${startPath}`, (c) => { c.header("Cache-Control", "public, max-age=31536000, immutable"); return c.body(START, 200, { "Content-Type": "text/javascript; charset=utf-8" }); });

  // A revoked preview must stop showing at once, so nothing below is cached.
  const preview = async (c: Context) => {
    const id = c.req.param("id") ?? "";
    c.header("Cache-Control", "no-store");
    return UUID.test(id) ? repositories().apiPreviews.get(id) : null;
  };
  app.get("/:id", async (c) => {
    const found = await preview(c);
    if (!found) return notFound(c);
    c.header("Content-Security-Policy", CSP);
    return c.html(page(found.id, found.title));
  });
  app.get("/:id/openapi.json", async (c) => {
    const found = await preview(c);
    return found ? c.body(found.document, 200, { "Content-Type": "application/json; charset=utf-8" }) : notFound(c);
  });
  app.get("/:id/view.json", async (c) => {
    const found = await preview(c);
    return found ? c.json(forViewer(JSON.parse(found.document), { download: `./${found.id}/openapi.json` })) : notFound(c);
  });
  return app;
}
