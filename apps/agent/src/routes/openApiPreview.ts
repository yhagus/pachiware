import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Hono, type Context } from "hono";
import { getConnInfo } from "hono/bun";
import { repositories } from "@pachiware/db";
import { forViewer, typesForViewer } from "@pachiware/skills";
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
<title>${escapeHtml(title)} · OpenAPI Schema Viewer</title>
</head>
<body>
<div id="app" data-url="./${id}/view.json" data-types="./${id}/types.json"></div>
<noscript>The OpenAPI Schema Viewer needs JavaScript. The document itself: <a href="./${id}/openapi.json">openapi.json</a></noscript>
<script src="./${scalarPath}"></script>
<script src="./${startPath}"></script>
<script src="./${typesPath}"></script>
</body>
</html>
`;

/**
 * Starts the viewer on the page's own document, with every call to another site switched off. Every tag opens from the start, so the
 * sidebar carries the whole endpoint tree rather than trailing off into empty space, and the custom CSS cuts the viewer's 90px section
 * padding and tightens line heights, so operations sit close together and a screen holds several instead of one.
 */
const DENSE_CSS =
  ".references-layout .section{padding-top:24px!important;padding-bottom:24px!important;gap:20px!important}" +
  ".references-layout .introduction-section{padding-top:28px!important;padding-bottom:24px!important;gap:24px!important}" +
  ":root{--scalar-line-height-1:28px;--scalar-line-height-2:22px;--scalar-line-height-3:18px}";
const START = `(function () {
  var app = document.getElementById("app");
  Scalar.createApiReference(app, {
    url: app.dataset.url,
    defaultOpenAllTags: true,
    withDefaultFonts: false, telemetry: false, hideClientButton: true, hideTestRequestButton: true,
    showDeveloperTools: "never", agent: { disabled: true }, mcp: { disabled: true }, documentDownloadType: "none",
    customCss: ${JSON.stringify(DENSE_CSS)},
  });
})();
`;

/**
 * Adds a "TS" copy button beside each request body and each response, which copies that schema as TypeScript (the shapes come from
 * `types.json` beside the page). It reads the operation's method and path from the viewer's own section ids and watches for the parts
 * of the page the viewer renders lazily, so a button appears wherever a body or response is shown. No request leaves this agent.
 */
const TYPES_SCRIPT = `(function () {
  var app = document.getElementById("app");
  var typesUrl = app && app.dataset.types;
  if (!typesUrl) return;
  var MAP = null;
  var METHODS = "GET POST PUT PATCH DELETE HEAD OPTIONS TRACE QUERY".split(" ");

  var style = document.createElement("style");
  style.textContent =
    ".ts-copy{display:inline-flex;align-items:center;gap:4px;font:600 11px/1 var(--scalar-font,ui-sans-serif,sans-serif);"
    + "letter-spacing:.02em;color:var(--scalar-color-2);background:var(--scalar-background-2);"
    + "border:var(--scalar-border-width,1px) solid var(--scalar-border-color);border-radius:var(--scalar-radius,3px);"
    + "padding:3px 7px;cursor:pointer;white-space:nowrap}"
    + ".ts-copy:hover{color:var(--scalar-color-1);border-color:var(--scalar-color-3)}"
    + ".ts-copy--done{color:var(--scalar-color-green,#069061);border-color:currentColor}"
    + ".ts-copy--resp{position:absolute;top:5px;z-index:2}";
  document.head.appendChild(style);

  // An operation's section id is "api-1/tag/<tag>/<METHOD>/<path>", or "api-1/<METHOD>/<path>" when it has no tag.
  function parseSection(id) {
    var parts = id.split("/"), i = parts[1] === "tag" ? 3 : 1;
    var method = (parts[i] || "").toUpperCase();
    return METHODS.indexOf(method) >= 0 ? { method: method, path: "/" + parts.slice(i + 1).join("/") } : null;
  }

  function fallbackCopy(text) {
    var ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.focus(); ta.select();
    try { document.execCommand("copy"); } catch (e) {}
    document.body.removeChild(ta);
  }
  function copy(text, btn) {
    var label = btn.querySelector(".ts-copy-text");
    var done = function () {
      btn.classList.add("ts-copy--done");
      var prev = label.textContent; label.textContent = "Copied";
      setTimeout(function () { btn.classList.remove("ts-copy--done"); label.textContent = prev; }, 1400);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text); done(); });
    else { fallbackCopy(text); done(); }
  }
  function button(cls, ts) {
    var b = document.createElement("button");
    b.type = "button"; b.className = "ts-copy " + cls;
    b.setAttribute("aria-label", "Copy TypeScript");
    b.title = "Copy as TypeScript";
    b.innerHTML = '<span class="ts-copy-text">TS</span>';
    b.addEventListener("click", function (ev) { ev.preventDefault(); ev.stopPropagation(); copy(ts, b); });
    return b;
  }

  function decorate() {
    if (!MAP) return;
    var sections = document.querySelectorAll("section.section[id]");
    for (var s = 0; s < sections.length; s++) {
      var sec = sections[s];
      var info = parseSection(sec.id); if (!info) continue;
      var op = MAP.operations[info.method + " " + info.path]; if (!op) continue;

      if (op.request) {
        var header = sec.querySelector(".request-body-header");
        if (header && !header.querySelector(".ts-copy")) (header.querySelector(".flex.items-center") || header).appendChild(button("ts-copy--body", op.request));
      }

      var rows = sec.querySelectorAll("ul.responses-list--tree > li");
      for (var r = 0; r < rows.length; r++) {
        var li = rows[r];
        var nameEl = li.querySelector(":scope > button .parameter-item-name") || li.querySelector(".parameter-item-name");
        var status = nameEl ? nameEl.textContent.trim() : "";
        if (!/^[1-5]\\d\\d$/.test(status)) continue;
        var ts = op.responses[status]; if (!ts) continue;
        var b = li.querySelector(":scope > .ts-copy");
        if (!b) {
          if (getComputedStyle(li).position === "static") li.style.position = "relative";
          b = button("ts-copy--resp", ts);
          li.appendChild(b);
        }
        // A media-type badge fades in on hover at the row's right edge; the viewer owns it, so the button sits at a fixed offset that
        // clears it — the same offset on every row, for one tidy column — widening only for an unusually long media type. The badge
        // stays laid out while transparent, so its width is readable whether or not it is showing.
        var badge = null, kids = li.children;
        for (var k = 0; k < kids.length; k++) if (kids[k].matches && kids[k].matches("div.absolute") && kids[k].querySelector(".selected-content-type")) { badge = kids[k]; break; }
        b.style.right = Math.max(124, badge ? Math.ceil(badge.getBoundingClientRect().width) + 20 : 0) + "px";
      }
    }
  }

  fetch(typesUrl).then(function (r) { return r.ok ? r.json() : null; }).then(function (json) {
    if (!json || !json.operations) return;
    MAP = json; decorate();
    var pending = false;
    new MutationObserver(function () {
      if (pending) return; pending = true;
      requestAnimationFrame(function () { pending = false; decorate(); });
    }).observe(app, { childList: true, subtree: true });
  }).catch(function () {});
})();
`;

/** Each script is named by what it holds, so a browser may keep it forever and an upgrade is never served stale. */
const startPath = `_/start-${createHash("sha256").update(START).digest("hex").slice(0, 12)}.js`;
const typesPath = `_/types-${createHash("sha256").update(TYPES_SCRIPT).digest("hex").slice(0, 12)}.js`;
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
  app.get(`/${typesPath}`, (c) => { c.header("Cache-Control", "public, max-age=31536000, immutable"); return c.body(TYPES_SCRIPT, 200, { "Content-Type": "text/javascript; charset=utf-8" }); });

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
  app.get("/:id/types.json", async (c) => {
    const found = await preview(c);
    return found ? c.json(typesForViewer(JSON.parse(found.document))) : notFound(c);
  });
  return app;
}
