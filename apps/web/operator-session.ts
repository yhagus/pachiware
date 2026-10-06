import { readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { resolve } from "node:path";
import type { Plugin } from "vite";
import { decryptSecret } from "../../packages/db/src/crypto.js";

const loopbackAddresses = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const localHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function operatorSessionMiddleware(workspaceRoot: string) {
  return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (req.url?.split("?")[0] !== "/api/console/session") return next();
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "application/json");
    res.setHeader("X-Content-Type-Options", "nosniff");
    try {
      const origin = new URL(`http://${req.headers.host || "invalid"}`);
      const requestOrigin = req.headers.origin;
      const site = req.headers["sec-fetch-site"];
      const referer = req.headers.referer;
      if (req.method !== "GET" || !loopbackAddresses.has(req.socket.remoteAddress || "") || !localHosts.has(origin.hostname)
        || (requestOrigin && new URL(requestOrigin).host !== origin.host)
        || (referer && new URL(referer).host !== origin.host)
        || (site && site !== "same-origin")) {
        res.statusCode = 403;
        return res.end(JSON.stringify({ error: "Automatic console access is available only from localhost." }));
      }
      const saved = JSON.parse(readFileSync(resolve(workspaceRoot, "operator-access.json"), "utf8"));
      res.end(JSON.stringify({ platformKey: decryptSecret(saved.platformKeyEncrypted) }));
    } catch {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: "CLI setup has not completed." }));
    }
  };
}

export function operatorSessionPlugin(workspaceRoot: string): Plugin {
  const middleware = operatorSessionMiddleware(workspaceRoot);
  return {
    name: "local-operator-session",
    configureServer(server) { server.middlewares.use(middleware); },
    configurePreviewServer(server) { server.middlewares.use(middleware); },
  };
}
