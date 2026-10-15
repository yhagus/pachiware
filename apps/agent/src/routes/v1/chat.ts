import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { db } from "@pachiware/db";
import { GuardrailService, MAX_WEB_INPUT, audit, isEnforced } from "@pachiware/skills";
import type { TenantEnv } from "../../middleware/tenant.js";
import { agentReActLoop } from "../../loop/react.js";
import { object, string } from "../validation.js";
export const chatRoutes = new Hono<TenantEnv>();
chatRoutes.post("/", async (c) => {
  const body = object(await c.req.json(), "body");
  const message = string(body.message, "message")!;
  const conversationId = string(body.conversationId, "conversationId", true);
  // No Workspace place here to keep a long text as a Document, so text over the limit is refused, in the language it was written in.
  const length = GuardrailService.limitLength(message, MAX_WEB_INPUT);
  if (!length.allow) {
    const enforced = isEnforced(length.kind);
    await audit({ db, tenantId: c.get("tenantId") }, "guardrail_denied", { kind: length.kind, source: "user_message", platform: "web", ...(enforced ? {} : { observed: true }) });
    if (enforced) return c.json({ success: true, reply: length.message, conversationId: conversationId ?? null, iterations: 0, toolsExecuted: [], steps: [] });
  }
  const steps: any[] = [];
  try {
    const output = await agentReActLoop.run({ tenantId: c.get("tenantId"), message, conversationId, context: { tenantId: c.get("tenantId"), platform: "web", userName: "Operator", userId: "web-operator" }, onStep: (step) => steps.push(step) });
    return c.json({ success: true, reply: output.reply, conversationId: output.conversationId, iterations: output.iterations, toolsExecuted: output.toolCallsExecuted, steps });
  } catch (err: any) {
    if (err.message === "Conversation not found") throw new HTTPException(404, { message: err.message });
    throw err;
  }
});
