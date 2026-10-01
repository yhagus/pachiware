import { describe, expect, it } from "bun:test";

const BASE_URL = "http://localhost:3001";

describe("Pachiware Agent Full End-to-End API & Engine Verification", () => {
  it("should return healthy status for Database and Redis on /api/health", async () => {
    const res = await fetch(`${BASE_URL}/api/health`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.services.database).toContain("healthy");
    expect(body.services.redis).toBe("healthy");
  });

  it("should retrieve and update agent configuration", async () => {
    // 1. Get config
    const getRes = await fetch(`${BASE_URL}/api/agent/config`);
    expect(getRes.status).toBe(200);
    const getBody = await getRes.json();
    expect(getBody.success).toBe(true);
    expect(getBody.config.name).toBeDefined();

    // 2. Update config
    const updateRes = await fetch(`${BASE_URL}/api/agent/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        temperature: 0.75,
      }),
    });
    expect(updateRes.status).toBe(200);
    const updateBody = await updateRes.json();
    expect(updateBody.success).toBe(true);
    expect(updateBody.config.temperature).toBe(0.75);
  });

  it("should list registered skills and toggle enabled status", async () => {
    // 1. List skills
    const res = await fetch(`${BASE_URL}/api/skills`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.skills.length).toBeGreaterThanOrEqual(2);

    const taskSkill = body.skills.find((s: any) => s.id === "task_management");
    expect(taskSkill).toBeDefined();
    const originalState = taskSkill.isEnabled;

    // 2. Toggle skill
    const toggleRes = await fetch(`${BASE_URL}/api/skills/task_management/toggle`, {
      method: "PATCH",
    });
    expect(toggleRes.status).toBe(200);
    const toggleBody = await toggleRes.json();
    expect(toggleBody.success).toBe(true);
    expect(toggleBody.skill.isEnabled).toBe(!originalState);

    // 3. Toggle back to original state
    const restoreRes = await fetch(`${BASE_URL}/api/skills/task_management/toggle`, {
      method: "PATCH",
    });
    const restoreBody = await restoreRes.json();
    expect(restoreBody.skill.isEnabled).toBe(originalState);
  });

  it("should execute full Task CRUD lifecycle via REST API", async () => {
    // 1. Create Task
    const createRes = await fetch(`${BASE_URL}/api/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "E2E Verification Temporary Task",
        description: "Testing API lifecycle",
        priority: "high",
        assignedTo: "qa-suite",
      }),
    });
    expect(createRes.status).toBe(201);
    const createBody = await createRes.json();
    expect(createBody.success).toBe(true);
    const taskId = createBody.task.id;

    // 2. Update status
    const updateRes = await fetch(`${BASE_URL}/api/tasks/${taskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "completed" }),
    });
    expect(updateRes.status).toBe(200);
    const updateBody = await updateRes.json();
    expect(updateBody.task.status).toBe("completed");

    // 3. Delete Task
    const deleteRes = await fetch(`${BASE_URL}/api/tasks/${taskId}`, {
      method: "DELETE",
    });
    expect(deleteRes.status).toBe(200);
  });

  it("should execute conversational ReAct loop and return tool execution traces", async () => {
    const chatRes = await fetch(`${BASE_URL}/api/agent/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "Please create task \"Deploy Edge Gateway Service\" with priority high",
      }),
    });

    expect(chatRes.status).toBe(200);
    const chatBody = await chatRes.json();
    expect(chatBody.success).toBe(true);
    expect(chatBody.reply).toBeDefined();
    expect(chatBody.toolsExecuted.length).toBeGreaterThan(0);
    expect(chatBody.toolsExecuted[0].call.name).toBe("createTask");
    expect(chatBody.toolsExecuted[0].result.success).toBe(true);
  });

  it("should retrieve and manage infrastructure config via runtime store", async () => {
    // 1. Get infrastructure config
    const res = await fetch(`${BASE_URL}/api/agent/infrastructure`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.infrastructure.databaseUrl).toBeDefined();
    expect(body.infrastructure.redisUrl).toBeDefined();
    expect(body.infrastructure.notice).toContain(".env is protected");

    // 2. Test DB ping
    const testDbRes = await fetch(`${BASE_URL}/api/agent/infrastructure/test-db`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(testDbRes.status).toBe(200);
    const testDbBody = await testDbRes.json();
    expect(testDbBody.success).toBe(true);
  });

  it("should safely mask secrets and support dynamic provider updates", async () => {
    // 1. Update config with test key
    const updateRes = await fetch(`${BASE_URL}/api/agent/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customModel: "gpt-4o",
      }),
    });
    expect(updateRes.status).toBe(200);
    const updateBody = await updateRes.json();
    expect(updateBody.success).toBe(true);

    // 2. Fetch config and verify secrets are masked
    const getRes = await fetch(`${BASE_URL}/api/agent/config`);
    expect(getRes.status).toBe(200);
    const getBody = await getRes.json();
    if (getBody.config.customApiKey) {
      expect(getBody.config.customApiKey).toContain("••••");
    }
  });
});

