import React, { useState } from "react";
import {
  Wrench,
  ToggleLeft,
  ToggleRight,
  Code2,
  Play,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  ExternalLink,
} from "lucide-react";
import { api, type SkillItem } from "../lib/api.js";

interface SkillsManagerProps {
  skills: SkillItem[];
  onSkillsUpdated: () => void;
}

export const SkillsManager: React.FC<SkillsManagerProps> = ({
  skills,
  onSkillsUpdated,
}) => {
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [selectedTool, setSelectedTool] = useState<{
    skillName: string;
    tool: any;
  } | null>(null);
  const [testArgs, setTestArgs] = useState<string>("{}");
  const [testResult, setTestResult] = useState<any>(null);
  const [isTesting, setIsTesting] = useState(false);

  const handleToggle = async (skillId: string) => {
    setTogglingId(skillId);
    try {
      await api.toggleSkill(skillId);
      onSkillsUpdated();
    } catch (err: any) {
      alert(`Failed to toggle skill: ${err.message}`);
    } finally {
      setTogglingId(null);
    }
  };

  const openToolInspector = (skillName: string, tool: any) => {
    setSelectedTool({ skillName, tool });
    // Generate sample arguments from properties
    const sample: Record<string, any> = {};
    if (tool.parameters?.properties) {
      for (const [key, prop] of Object.entries<any>(tool.parameters.properties)) {
        if (prop.type === "string") {
          sample[key] = prop.enum ? prop.enum[0] : `sample_${key}`;
        } else if (prop.type === "number") {
          sample[key] = 10;
        } else if (prop.type === "boolean") {
          sample[key] = true;
        }
      }
    }
    setTestArgs(JSON.stringify(sample, null, 2));
    setTestResult(null);
  };

  const handleRunTest = async () => {
    if (!selectedTool) return;
    setIsTesting(true);
    setTestResult(null);

    try {
      const parsed = JSON.parse(testArgs);
      const res = await api.testTool(selectedTool.tool.name, parsed);
      setTestResult(res.result);
    } catch (err: any) {
      setTestResult({ success: false, error: err.message });
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
          <Wrench className="w-5 h-5 text-indigo-400" />
          Skills & Tool Harnesses Manager
        </h2>
        <p className="text-xs text-slate-400 mt-1">
          Dynamically enable or disable skills live without restarting the agent engine. Test parameters directly against the PostgreSQL or Discord harness.
        </p>
      </div>

      {/* Skills Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {skills.map((skill) => (
          <div
            key={skill.id}
            className={`p-6 rounded-2xl border transition-all ${
              skill.isEnabled
                ? "bg-slate-900/60 border-slate-800 hover:border-slate-700"
                : "bg-slate-900/20 border-slate-800/40 opacity-70"
            }`}
          >
            <div className="flex items-start justify-between mb-4">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-bold text-white">{skill.name}</h3>
                  <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                    {skill.handlerType}
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
                  {skill.description}
                </p>
              </div>

              {/* Toggle Switch */}
              <button
                onClick={() => handleToggle(skill.id)}
                disabled={togglingId === skill.id}
                className="text-slate-400 hover:text-white transition-colors"
                title={skill.isEnabled ? "Disable Skill" : "Enable Skill"}
              >
                {skill.isEnabled ? (
                  <ToggleRight className="w-8 h-8 text-emerald-400 cursor-pointer" />
                ) : (
                  <ToggleLeft className="w-8 h-8 text-slate-600 cursor-pointer" />
                )}
              </button>
            </div>

            {/* Registered Tools List */}
            <div className="mt-5 pt-4 border-t border-slate-800/60 space-y-2">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Registered Tools ({Array.isArray(skill.tools) ? skill.tools.length : 0})
              </div>
              <div className="flex flex-wrap gap-2">
                {Array.isArray(skill.tools) &&
                  skill.tools.map((tool: any) => (
                    <button
                      key={tool.name}
                      onClick={() => openToolInspector(skill.name, tool)}
                      className="px-2.5 py-1 rounded-lg bg-slate-800/80 hover:bg-indigo-600/20 text-slate-300 hover:text-indigo-300 border border-slate-700/60 hover:border-indigo-500/30 text-xs font-mono transition-all flex items-center gap-1.5"
                    >
                      <Code2 className="w-3 h-3 text-indigo-400" />
                      <span>{tool.name}</span>
                    </button>
                  ))}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Tool Inspector & Tester Modal */}
      {selectedTool && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="p-5 border-b border-slate-800 flex items-center justify-between">
              <div>
                <span className="text-[10px] uppercase font-bold text-indigo-400 tracking-wider">
                  {selectedTool.skillName}
                </span>
                <h3 className="text-base font-bold text-white flex items-center gap-2 mt-0.5">
                  <Code2 className="w-4 h-4 text-indigo-400" />
                  {selectedTool.tool.name}
                </h3>
              </div>
              <button
                onClick={() => setSelectedTool(null)}
                className="text-slate-400 hover:text-white text-xs px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700"
              >
                Close
              </button>
            </div>

            <div className="p-6 space-y-5 overflow-y-auto flex-1">
              <div>
                <h4 className="text-xs font-semibold text-slate-300 mb-1">Description</h4>
                <p className="text-xs text-slate-400 leading-relaxed">
                  {selectedTool.tool.description}
                </p>
              </div>

              {/* JSON Schema */}
              <div>
                <h4 className="text-xs font-semibold text-slate-300 mb-1.5">
                  Parameters Schema (OpenAI/Anthropic compatible)
                </h4>
                <pre className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-[11px] font-mono text-slate-300 overflow-x-auto max-h-40">
                  {JSON.stringify(selectedTool.tool.parameters, null, 2)}
                </pre>
              </div>

              {/* Parameter Playground */}
              <div>
                <div className="flex justify-between items-center mb-1.5">
                  <h4 className="text-xs font-semibold text-slate-300">
                    Test Execution Arguments (JSON)
                  </h4>
                  <span className="text-[10px] text-slate-400">Editable test payload</span>
                </div>
                <textarea
                  rows={4}
                  value={testArgs}
                  onChange={(e) => setTestArgs(e.target.value)}
                  className="w-full p-3 rounded-xl bg-slate-950 border border-slate-800 font-mono text-xs text-indigo-300 focus:outline-none focus:border-indigo-500"
                />
              </div>

              {/* Test Result Display */}
              {testResult && (
                <div className="space-y-1.5">
                  <div className="flex items-center gap-1.5 text-xs font-semibold">
                    {testResult.success ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    ) : (
                      <AlertCircle className="w-4 h-4 text-red-400" />
                    )}
                    <span className={testResult.success ? "text-emerald-400" : "text-red-400"}>
                      {testResult.success ? "Execution Succeeded" : "Execution Error"}
                    </span>
                  </div>
                  <pre className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-[11px] font-mono text-slate-300 overflow-x-auto max-h-48">
                    {JSON.stringify(testResult, null, 2)}
                  </pre>
                </div>
              )}
            </div>

            {/* Modal Actions */}
            <div className="p-4 border-t border-slate-800 bg-slate-950/50 flex justify-end space-x-3">
              <button
                type="button"
                onClick={() => setSelectedTool(null)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-300"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleRunTest}
                disabled={isTesting}
                className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-xs font-medium text-white flex items-center gap-1.5 shadow-md shadow-indigo-600/30"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>{isTesting ? "Executing..." : "Execute Test"}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
