import React from "react";
import {
  Database,
  Layers,
  Radio,
  CheckCircle2,
  Clock,
  AlertCircle,
  Cpu,
  ArrowRight,
  TrendingUp,
  ShieldCheck,
} from "lucide-react";
import type { HealthResponse, AgentConfigData, TaskItem, SkillItem } from "../lib/api.js";

interface DashboardOverviewProps {
  health: HealthResponse | null;
  config: AgentConfigData | null;
  tasks: TaskItem[];
  taskCounts: { total: number; pending: number; in_progress: number; completed: number };
  skills: SkillItem[];
  onNavigate: (tab: any) => void;
}

export const DashboardOverview: React.FC<DashboardOverviewProps> = ({
  health,
  config,
  tasks,
  taskCounts,
  skills,
  onNavigate,
}) => {
  const activeSkillsCount = skills.filter((s) => s.isEnabled).length;
  const completionRate =
    taskCounts.total > 0
      ? Math.round((taskCounts.completed / taskCounts.total) * 100)
      : 0;

  return (
    <div className="space-y-8">
      {/* Hero Agent Status Banner */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-indigo-900/40 via-purple-900/20 to-slate-900/60 p-6 border border-indigo-500/20 shadow-xl">
        <div className="absolute top-0 right-0 -mt-8 -mr-8 w-64 h-64 rounded-full bg-indigo-500/10 blur-3xl pointer-events-none" />
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
          <div className="space-y-2">
            <div className="inline-flex items-center space-x-2 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span>Agent System Active</span>
            </div>
            <h1 className="text-2xl font-bold text-white tracking-tight">
              {config?.name || "Pachiware Agent"}
            </h1>
            <p className="text-sm text-slate-300 max-w-2xl leading-relaxed">
              {config?.systemPrompt.slice(0, 140)}...
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => onNavigate("playground")}
              className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-sm transition-all shadow-lg shadow-indigo-600/30 flex items-center gap-2"
            >
              <span>Test in Playground</span>
              <ArrowRight className="w-4 h-4" />
            </button>
            <button
              onClick={() => onNavigate("personality")}
              className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium text-sm transition-all border border-slate-700"
            >
              Edit Persona
            </button>
          </div>
        </div>
      </div>

      {/* Infrastructure Health Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* PostgreSQL 18 */}
        <div className="p-5 rounded-xl bg-slate-900/60 border border-slate-800 hover:border-slate-700 transition-all">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Database
            </span>
            <div className="w-8 h-8 rounded-lg bg-blue-500/10 text-blue-400 flex items-center justify-center">
              <Database className="w-4 h-4" />
            </div>
          </div>
          <div className="text-xl font-bold text-white">PostgreSQL 18</div>
          <div className="mt-2 flex items-center gap-1.5 text-xs">
            <span
              className={`w-2 h-2 rounded-full ${
                health?.services.database.includes("healthy")
                  ? "bg-emerald-400"
                  : "bg-amber-400"
              }`}
            />
            <span className="text-slate-300 capitalize">
              {health?.services.database || "Connecting..."}
            </span>
          </div>
        </div>

        {/* Redis Cache */}
        <div className="p-5 rounded-xl bg-slate-900/60 border border-slate-800 hover:border-slate-700 transition-all">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Session Cache
            </span>
            <div className="w-8 h-8 rounded-lg bg-red-500/10 text-red-400 flex items-center justify-center">
              <Layers className="w-4 h-4" />
            </div>
          </div>
          <div className="text-xl font-bold text-white">Redis 7.0</div>
          <div className="mt-2 flex items-center gap-1.5 text-xs">
            <span
              className={`w-2 h-2 rounded-full ${
                health?.services.redis === "healthy" ? "bg-emerald-400" : "bg-amber-400"
              }`}
            />
            <span className="text-slate-300 capitalize">
              {health?.services.redis || "Connecting..."} (Port 6380)
            </span>
          </div>
        </div>

        {/* Discord Gateway */}
        <div className="p-5 rounded-xl bg-slate-900/60 border border-slate-800 hover:border-slate-700 transition-all">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Discord Gateway
            </span>
            <div className="w-8 h-8 rounded-lg bg-indigo-500/10 text-indigo-400 flex items-center justify-center">
              <Radio className="w-4 h-4" />
            </div>
          </div>
          <div className="text-xl font-bold text-white">
            {health?.services.discord.connected ? "Connected" : "Standby Mode"}
          </div>
          <div className="mt-2 flex items-center gap-1.5 text-xs text-slate-400">
            <span>
              {health?.services.discord.connected
                ? `${health.services.discord.botTag}`
                : "Simulation fallback active"}
            </span>
          </div>
        </div>

        {/* Active LLM Model */}
        <div className="p-5 rounded-xl bg-slate-900/60 border border-slate-800 hover:border-slate-700 transition-all">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              LLM Provider
            </span>
            <div className="w-8 h-8 rounded-lg bg-purple-500/10 text-purple-400 flex items-center justify-center">
              <Cpu className="w-4 h-4" />
            </div>
          </div>
          <div className="text-xl font-bold text-white truncate">
            {config?.defaultModel || "gpt-4o"}
          </div>
          <div className="mt-2 flex items-center gap-1.5 text-xs text-slate-400 uppercase font-mono">
            <span>Provider: {config?.defaultProvider || "OpenAI"}</span>
          </div>
        </div>
      </div>

      {/* Task Metrics & Progress */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 p-6 rounded-2xl bg-slate-900/60 border border-slate-800">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-base font-bold text-white">Task Execution Pipeline</h2>
              <p className="text-xs text-slate-400">
                Tasks created via Discord mentions, ReAct tool executions, or Web Console
              </p>
            </div>
            <button
              onClick={() => onNavigate("tasks")}
              className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1 font-medium"
            >
              <span>View Kanban</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="p-4 rounded-xl bg-slate-800/40 border border-slate-700/40">
              <div className="flex items-center space-x-2 text-xs text-slate-400 mb-1">
                <Clock className="w-3.5 h-3.5 text-amber-400" />
                <span>Pending</span>
              </div>
              <div className="text-2xl font-bold text-white">{taskCounts.pending}</div>
            </div>

            <div className="p-4 rounded-xl bg-slate-800/40 border border-slate-700/40">
              <div className="flex items-center space-x-2 text-xs text-slate-400 mb-1">
                <TrendingUp className="w-3.5 h-3.5 text-blue-400" />
                <span>In Progress</span>
              </div>
              <div className="text-2xl font-bold text-white">{taskCounts.in_progress}</div>
            </div>

            <div className="p-4 rounded-xl bg-slate-800/40 border border-slate-700/40">
              <div className="flex items-center space-x-2 text-xs text-slate-400 mb-1">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                <span>Completed</span>
              </div>
              <div className="text-2xl font-bold text-white">{taskCounts.completed}</div>
            </div>
          </div>

          {/* Progress bar */}
          <div className="space-y-2">
            <div className="flex justify-between text-xs text-slate-400">
              <span>Overall Completion Rate</span>
              <span className="font-semibold text-slate-200">{completionRate}%</span>
            </div>
            <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-indigo-500 to-emerald-400 rounded-full transition-all duration-500"
                style={{ width: `${completionRate}%` }}
              />
            </div>
          </div>
        </div>

        {/* Quick Skills Summary Card */}
        <div className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-bold text-white">Active Skills</h2>
              <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 font-mono">
                {activeSkillsCount} of {skills.length} Enabled
              </span>
            </div>
            <div className="space-y-3">
              {skills.map((skill) => (
                <div
                  key={skill.id}
                  className="p-3 rounded-xl bg-slate-800/40 border border-slate-700/40 flex items-center justify-between"
                >
                  <div>
                    <div className="text-xs font-semibold text-white">{skill.name}</div>
                    <div className="text-[11px] text-slate-400">{skill.toolCount} tool(s) registered</div>
                  </div>
                  <span
                    className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full ${
                      skill.isEnabled
                        ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                        : "bg-slate-700 text-slate-400"
                    }`}
                  >
                    {skill.isEnabled ? "Active" : "Disabled"}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <button
            onClick={() => onNavigate("skills")}
            className="w-full mt-6 py-2 rounded-xl bg-slate-800 hover:bg-slate-750 text-xs font-medium text-slate-300 hover:text-white border border-slate-700 transition-colors"
          >
            Manage Skills & Tools
          </button>
        </div>
      </div>
    </div>
  );
};
