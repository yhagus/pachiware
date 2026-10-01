import React from "react";
import {
  LayoutDashboard,
  Brain,
  Wrench,
  KanbanSquare,
  Cpu,
  Bot,
  Terminal,
  Activity,
  Layers,
} from "lucide-react";

export type NavTab = "overview" | "personality" | "skills" | "tasks" | "llm" | "playground";

interface SidebarProps {
  currentTab: NavTab;
  onTabChange: (tab: NavTab) => void;
  healthStatus?: string;
}

export const Sidebar: React.FC<SidebarProps> = ({ currentTab, onTabChange, healthStatus }) => {
  const navItems = [
    {
      id: "overview" as NavTab,
      label: "Overview",
      description: "Health & Quick Metrics",
      icon: LayoutDashboard,
    },
    {
      id: "personality" as NavTab,
      label: "Personality & Prompts",
      description: "System Prompt & Tuning",
      icon: Brain,
    },
    {
      id: "skills" as NavTab,
      label: "Skills & Harnesses",
      description: "Toggle & Test Tools",
      icon: Wrench,
    },
    {
      id: "tasks" as NavTab,
      label: "Task Kanban",
      description: "Task Workflow Board",
      icon: KanbanSquare,
    },
    {
      id: "llm" as NavTab,
      label: "LLM Router",
      description: "9router & Provider Keys",
      icon: Cpu,
    },
    {
      id: "playground" as NavTab,
      label: "Agent Playground",
      description: "Live ReAct Chat & Tools",
      icon: Bot,
    },
  ];

  return (
    <aside className="w-64 flex-shrink-0 bg-[#0B0F19]/90 border-r border-slate-800/80 flex flex-col justify-between h-screen sticky top-0">
      <div>
        {/* Logo and Brand */}
        <div className="p-6 pb-5 border-b border-slate-800/60">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 via-indigo-500 to-purple-500 flex items-center justify-center shadow-lg shadow-indigo-500/25 ring-1 ring-white/20">
              <Bot className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="font-bold text-base tracking-tight text-white flex items-center gap-1.5">
                Pachiware
                <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-400 border border-indigo-500/30">
                  Agent
                </span>
              </h1>
              <p className="text-xs text-slate-400">Autonomous Core Platform</p>
            </div>
          </div>
        </div>

        {/* Navigation Items */}
        <div className="p-3 space-y-1">
          <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Control Console
          </div>
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onTabChange(item.id)}
                className={`w-full flex items-center space-x-3 px-3.5 py-2.5 rounded-xl text-left transition-all duration-200 ${
                  isActive
                    ? "bg-indigo-600/15 text-indigo-300 border border-indigo-500/30 shadow-sm"
                    : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50 border border-transparent"
                }`}
              >
                <Icon
                  className={`w-4 h-4 transition-colors ${
                    isActive ? "text-indigo-400" : "text-slate-400 group-hover:text-slate-300"
                  }`}
                />
                <div className="flex-1 truncate">
                  <div className={`text-sm font-medium leading-none ${isActive ? "text-white" : ""}`}>
                    {item.label}
                  </div>
                  <div className="text-[11px] text-slate-400 mt-1 truncate">
                    {item.description}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Footer System Status */}
      <div className="p-4 m-3 rounded-xl bg-slate-900/60 border border-slate-800/80">
        <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
          <span className="flex items-center gap-1.5">
            <span
              className={`w-2 h-2 rounded-full ${
                healthStatus === "ok" ? "bg-emerald-500 animate-pulse" : "bg-amber-500"
              }`}
            />
            Status
          </span>
          <span className="font-mono text-slate-300 text-[11px]">
            {healthStatus === "ok" ? "Operational" : "Degraded"}
          </span>
        </div>
        <div className="grid grid-cols-3 gap-1 text-[10px] text-center font-mono">
          <div className="p-1 rounded bg-slate-800/60 text-slate-300 border border-slate-700/40">
            PG 18
          </div>
          <div className="p-1 rounded bg-slate-800/60 text-slate-300 border border-slate-700/40">
            Redis
          </div>
          <div className="p-1 rounded bg-slate-800/60 text-slate-300 border border-slate-700/40">
            ReAct
          </div>
        </div>
      </div>
    </aside>
  );
};
