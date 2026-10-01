import React, { useState, useEffect } from "react";
import { Sidebar, type NavTab } from "./components/Sidebar.js";
import { Header } from "./components/Header.js";
import { DashboardOverview } from "./pages/DashboardOverview.js";
import { AgentPersonality } from "./pages/AgentPersonality.js";
import { SkillsManager } from "./pages/SkillsManager.js";
import { TaskManager } from "./pages/TaskManager.js";
import { LLMRouterConfig } from "./pages/LLMRouterConfig.js";
import { DiscordConfig } from "./pages/DiscordConfig.js";
import { InfrastructureConfig } from "./pages/InfrastructureConfig.js";
import { AgentPlayground } from "./pages/AgentPlayground.js";
import {
  api,
  type HealthResponse,
  type AgentConfigData,
  type SkillItem,
  type TaskItem,
} from "./lib/api.js";

export function App() {
  const [currentTab, setCurrentTab] = useState<NavTab>("overview");
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [config, setConfig] = useState<AgentConfigData | null>(null);
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [taskCounts, setTaskCounts] = useState({
    total: 0,
    pending: 0,
    in_progress: 0,
    completed: 0,
  });
  const [isRefreshing, setIsRefreshing] = useState(false);

  const fetchAllData = async () => {
    setIsRefreshing(true);
    try {
      const [healthRes, configRes, skillsRes, tasksRes] = await Promise.all([
        api.getHealth().catch(() => null),
        api.getAgentConfig().catch(() => null),
        api.getSkills().catch(() => null),
        api.getTasks().catch(() => null),
      ]);

      if (healthRes) setHealth(healthRes);
      if (configRes?.config) setConfig(configRes.config);
      if (skillsRes?.skills) setSkills(skillsRes.skills);
      if (tasksRes) {
        setTasks(tasksRes.tasks);
        setTaskCounts(tasksRes.counts);
      }
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    fetchAllData();
    const interval = setInterval(fetchAllData, 15000);
    return () => clearInterval(interval);
  }, []);

  const getHeaderInfo = () => {
    switch (currentTab) {
      case "personality":
        return {
          title: "Agent Personality & System Prompts",
          subtitle: "Define persona, instructions, temperature, and inference limits",
        };
      case "skills":
        return {
          title: "Skills & Tool Harnesses",
          subtitle: "Live toggle skills and test execution tools",
        };
      case "tasks":
        return {
          title: "Task Management Kanban",
          subtitle: "PostgreSQL 18 task workflow synchronized with Discord & Web",
        };
      case "llm":
        return {
          title: "LLM Router & Providers",
          subtitle: "Configure 9router, OpenAI, Anthropic endpoints and credentials dynamically in DB",
        };
      case "discord":
        return {
          title: "Discord Bot & Gateway",
          subtitle: "Manage Discord bot tokens, guild binding, and hot-reload Gateway connection",
        };
      case "infrastructure":
        return {
          title: "Infrastructure & Data Stores",
          subtitle: "PostgreSQL 18 & Redis configuration via persistent runtime store (read-only .env)",
        };
      case "playground":
        return {
          title: "Autonomous ReAct Playground",
          subtitle: "Test conversational reasoning, tool calls, and observations live",
        };
      case "overview":
      default:
        return {
          title: "System Overview",
          subtitle: "Live infrastructure metrics, agent health, and task analytics",
        };
    }
  };

  const headerInfo = getHeaderInfo();

  return (
    <div className="flex min-h-screen bg-[#0B0F19] text-slate-100">
      <Sidebar
        currentTab={currentTab}
        onTabChange={setCurrentTab}
        healthStatus={health?.status}
      />

      <div className="flex-1 flex flex-col min-w-0">
        <Header
          title={headerInfo.title}
          subtitle={headerInfo.subtitle}
          onRefresh={fetchAllData}
          isRefreshing={isRefreshing}
        />

        <main className="flex-1 p-8 overflow-y-auto">
          {currentTab === "overview" && (
            <DashboardOverview
              health={health}
              config={config}
              tasks={tasks}
              taskCounts={taskCounts}
              skills={skills}
              onNavigate={setCurrentTab}
            />
          )}

          {currentTab === "personality" && (
            <AgentPersonality
              initialConfig={config}
              onConfigSaved={(newCfg) => setConfig(newCfg)}
            />
          )}

          {currentTab === "skills" && (
            <SkillsManager
              skills={skills}
              onSkillsUpdated={fetchAllData}
            />
          )}

          {currentTab === "tasks" && (
            <TaskManager
              tasks={tasks}
              onTasksUpdated={fetchAllData}
            />
          )}

          {currentTab === "llm" && (
            <LLMRouterConfig
              initialConfig={config}
              onConfigSaved={(newCfg) => setConfig(newCfg)}
            />
          )}

          {currentTab === "discord" && (
            <DiscordConfig
              initialConfig={config}
              health={health}
              onConfigSaved={(newCfg) => setConfig(newCfg)}
              onRefreshHealth={fetchAllData}
            />
          )}

          {currentTab === "infrastructure" && (
            <InfrastructureConfig
              health={health}
              onRefreshHealth={fetchAllData}
            />
          )}

          {currentTab === "playground" && <AgentPlayground />}
        </main>
      </div>
    </div>
  );
}

export default App;

