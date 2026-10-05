import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { TenantEnv } from "../../middleware/tenant.js";
import { agentReActLoop } from "../../loop/react.js";
import { object, string } from "../validation.js";
export const chatRoutes = new Hono<TenantEnv>();
chatRoutes.post("/", async (c) => {
  const body = object(await c.req.json(), "body");
  const message = string(body.message, "message")!;
  const steps: any[] = [];
  try {
    const output = await agentReActLoop.run({ tenantId: c.get("tenantId"), message, conversationId: string(body.conversationId, "conversationId", true), context: { tenantId: c.get("tenantId"), platform: "web", userName: "Operator", userId: "web-operator" }, onStep: (step) => steps.push(step) });
    return c.json({ success: true, reply: output.reply, conversationId: output.conversationId, iterations: output.iterations, toolsExecuted: output.toolCallsExecuted, steps });
  } catch (err: any) {
    if (err.message === "Conversation not found") throw new HTTPException(404, { message: err.message });
    throw err;
  }
});
