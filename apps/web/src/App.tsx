import React, { useState, useEffect, useRef } from "react";
import { Sidebar, type NavTab } from "./components/Sidebar.js";
import { Header } from "./components/Header.js";
import { DashboardOverview } from "./pages/DashboardOverview.js";
import { AgentPersonality } from "./pages/AgentPersonality.js";
import { SkillsManager } from "./pages/SkillsManager.js";
import { TaskManager } from "./pages/TaskManager.js";
import { LLMRouterConfig } from "./pages/LLMRouterConfig.js";
import { BotsManager } from "./pages/BotsManager.js";
import { OperatorCredentials } from "./components/OperatorCredentials.js";
import { InfrastructureConfig } from "./pages/InfrastructureConfig.js";
import { AgentPlayground } from "./pages/AgentPlayground.js";
import { SetupWizard } from "./components/SetupWizard.js";
import {
  api,
  getApiKey,
  connectLocalConsole,
  type HealthResponse,
  type AgentConfigData,
  type SkillItem,
  type TaskItem,
} from "./lib/api.js";

export function App() {
  const [isConnecting, setIsConnecting] = useState(true);
  const activeApiKey = getApiKey();
  const [credentialVersion, setCredentialVersion] = useState(0);
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

  const requestVersion = useRef(0);
  const [dataError, setDataError] = useState("");
  const fetchAllData = async () => {
    const version = ++requestVersion.current;
    setIsRefreshing(true);
    try {
      const [healthRes, configRes, skillsRes, tasksRes] = await Promise.all([
        api.getHealth().catch(() => null),
        api.getAgentConfig().catch((err) => { if (version === requestVersion.current) setDataError(err.message); return null; }),
        api.getSkills().catch(() => null),
        api.getTasks().catch(() => null),
      ]);

      if (version !== requestVersion.current) return;
      if (configRes) setDataError("");
      setConfig(configRes?.config || null);
      setSkills(skillsRes?.skills || []);
      setTasks(tasksRes?.tasks || []);
      if (!tasksRes) setTaskCounts({ total: 0, pending: 0, in_progress: 0, completed: 0 });
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
    let mounted = true;
    void connectLocalConsole().then(async () => {
      if (!mounted) return;
      await fetchAllData();
      if (mounted) setIsConnecting(false);
    });
    const interval = setInterval(() => { if (mounted) void fetchAllData(); }, 15000);
    const changed = () => { setCredentialVersion((version) => version + 1); setConfig(null); setSkills([]); setTasks([]); void fetchAllData(); };
    window.addEventListener("pachiware:credentials", changed);
    return () => { mounted = false; clearInterval(interval); window.removeEventListener("pachiware:credentials", changed); };
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
          subtitle: "Tenant task workflow synchronized with Discord & Web",
        };
      case "llm":
        return {
          title: "LLM Router & Providers",
          subtitle: "Configure 9router, OpenAI, Anthropic endpoints and credentials dynamically in DB",
        };
      case "discord":
        return {
          title: "Tenant Discord Bots",
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

  // If health check shows database is not healthy or setup is required, show dedicated Setup Wizard
  const isDbSetupRequired =
    health !== null &&
    (health.setupRequired === true ||
      (health.services?.database !== undefined &&
        health.services.database !== "healthy" &&
        !health.services.database.startsWith("healthy")));

  if (isConnecting) return <div className="min-h-screen bg-[#0B0F19] text-slate-300 flex items-center justify-center">Connecting to your console...</div>;
  if (isDbSetupRequired) {
    return <SetupWizard onConnected={fetchAllData} />;
  }

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

        <OperatorCredentials />
        {dataError && <p role="alert" className="px-6 py-3 text-sm text-amber-300">{dataError}</p>}
        <main key={credentialVersion} className="flex-1 p-4 sm:p-8 overflow-y-auto">
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
              onConfigSaved={(newCfg) => { if (getApiKey() === activeApiKey) setConfig(newCfg); }}
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
              onConfigSaved={(newCfg) => { if (getApiKey() === activeApiKey) setConfig(newCfg); }}
            />
          )}

          {currentTab === "discord" && (
            <BotsManager />
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
