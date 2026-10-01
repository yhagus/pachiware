import { Hono } from "hono";
import { db, skills as skillsTable } from "@pachiware/db";
import { eq } from "drizzle-orm";
import { skillRegistry } from "@pachiware/skills";
import { CacheService } from "../cache/redis.js";

export const skillRoutes = new Hono();

// List all skills with their tools and enabled state
skillRoutes.get("/", async (c) => {
  const dbSkills = await db.select().from(skillsTable);
  const memorySkills = skillRegistry.getAllSkills();

  const combined = dbSkills.map((s) => {
    const memory = memorySkills.find((m) => m.id === s.id);
    return {
      id: s.id,
      name: s.name,
      description: s.description,
      isEnabled: s.isEnabled,
      handlerType: s.handlerType,
      toolCount: Array.isArray(s.toolDefinitions) ? s.toolDefinitions.length : 0,
      tools: s.toolDefinitions,
      config: s.config,
      updatedAt: s.updatedAt,
    };
  });

  return c.json({ success: true, skills: combined });
});

// Toggle a skill's enabled state
skillRoutes.patch("/:id/toggle", async (c) => {
  const skillId = c.req.param("id");
  const existing = await db
    .select()
    .from(skillsTable)
    .where(eq(skillsTable.id, skillId))
    .limit(1);

  if (existing.length === 0) {
    return c.json({ success: false, error: `Skill "${skillId}" not found.` }, 404);
  }

  const newState = !existing[0].isEnabled;

  const [updated] = await db
    .update(skillsTable)
    .set({
      isEnabled: newState,
      updatedAt: new Date(),
    })
    .where(eq(skillsTable.id, skillId))
    .returning();

  // Clear cache
  await CacheService.del("skills:active");

  return c.json({
    success: true,
    message: `Skill "${updated.name}" is now ${newState ? "enabled" : "disabled"}.`,
    skill: updated,
  });
});

// Test executing a tool directly from the dashboard playground
skillRoutes.post("/test", async (c) => {
  const body = await c.req.json();
  const { toolName, arguments: args } = body;

  if (!toolName) {
    return c.json({ success: false, error: "Field 'toolName' is required." }, 400);
  }

  const result = await skillRegistry.executeTool(
    {
      id: `test-${Date.now()}`,
      name: toolName,
      arguments: args || {},
    },
    { db }
  );

  return c.json({ success: true, result });
});
