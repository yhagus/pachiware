import React, { useState, useRef, useEffect } from "react";
import {
  Bot,
  User,
  Send,
  Sparkles,
  Code2,
  CheckCircle2,
  AlertCircle,
  Clock,
  Layers,
  Terminal,
} from "lucide-react";
import { api, type ChatResponse } from "../lib/api.js";

interface MessageItem {
  id: string;
  sender: "user" | "agent";
  text: string;
  steps?: { type: "thought" | "tool_call" | "tool_result"; payload: any }[];
  toolsExecuted?: { call: any; result: any }[];
  iterations?: number;
  timestamp: string;
}

export const AgentPlayground: React.FC = () => {
  const [messages, setMessages] = useState<MessageItem[]>([
    {
      id: "initial",
      sender: "agent",
      text: "Hello! I am Pachiware Agent. You can test my autonomous reasoning and tool execution directly from this playground. Try asking me to create a task or provision a Discord channel!",
      timestamp: new Date().toLocaleTimeString(),
    },
  ]);
  const [input, setInput] = useState("");
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [isLoading, setIsLoading] = useState(false);
  const [selectedStepData, setSelectedStepData] = useState<any | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);

  const handleSendMessage = async (textToSend?: string) => {
    const message = textToSend || input;
    if (!message.trim() || isLoading) return;

    const userMsg: MessageItem = {
      id: `msg-${Date.now()}`,
      sender: "user",
      text: message.trim(),
      timestamp: new Date().toLocaleTimeString(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsLoading(true);

    try {
      const res = await api.sendChat(message.trim(), conversationId);
      setConversationId(res.conversationId);

      const agentMsg: MessageItem = {
        id: `agent-${Date.now()}`,
        sender: "agent",
        text: res.reply,
        steps: res.steps,
        toolsExecuted: res.toolsExecuted,
        iterations: res.iterations,
        timestamp: new Date().toLocaleTimeString(),
      };

      setMessages((prev) => [...prev, agentMsg]);
    } catch (err: any) {
      const errorMsg: MessageItem = {
        id: `err-${Date.now()}`,
        sender: "agent",
        text: `⚠️ Execution error: ${err.message}`,
        timestamp: new Date().toLocaleTimeString(),
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setIsLoading(false);
    }
  };

  const samplePrompts = [
    'Create task "Audit Kubernetes Node Metrics" with priority urgent',
    "List all tasks currently in progress",
    "Create Discord channel #dev-alerts type text",
    "List existing Discord channels",
  ];

  return (
    <div className="h-[calc(100vh-8.5rem)] flex flex-col lg:flex-row gap-6">
      {/* Chat Area */}
      <div className="flex-1 flex flex-col bg-slate-900/60 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
        {/* Chat Header */}
        <div className="p-4 border-b border-slate-800 bg-slate-950/40 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-xs font-bold text-white uppercase tracking-wider">
              Autonomous ReAct Session
            </span>
          </div>
          {conversationId && (
            <span className="text-[10px] font-mono text-slate-500">
              Conv: {conversationId.slice(0, 8)}...
            </span>
          )}
        </div>

        {/* Message Stream */}
        <div className="flex-1 p-5 overflow-y-auto space-y-5">
          {messages.map((m) => (
            <div
              key={m.id}
              className={`flex gap-3 ${
                m.sender === "user" ? "flex-row-reverse" : "flex-row"
              }`}
            >
              <div
                className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${
                  m.sender === "user"
                    ? "bg-indigo-600 text-white"
                    : "bg-purple-600/30 text-purple-300 border border-purple-500/30"
                }`}
              >
                {m.sender === "user" ? (
                  <User className="w-4 h-4" />
                ) : (
                  <Bot className="w-4 h-4" />
                )}
              </div>

              <div
                className={`max-w-[80%] space-y-2 ${
                  m.sender === "user" ? "text-right" : "text-left"
                }`}
              >
                <div
                  className={`p-4 rounded-2xl text-xs leading-relaxed ${
                    m.sender === "user"
                      ? "bg-indigo-600 text-white rounded-tr-none shadow-md shadow-indigo-600/20"
                      : "bg-slate-800/80 text-slate-200 border border-slate-700/60 rounded-tl-none"
                  }`}
                >
                  <p className="whitespace-pre-wrap">{m.text}</p>
                </div>

                {/* ReAct Step Badges (if any tool actions occurred) */}
                {m.steps && m.steps.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {m.steps.map((step, idx) => (
                      <button
                        key={idx}
                        onClick={() => setSelectedStepData(step)}
                        className={`text-[10px] px-2 py-0.5 rounded-full font-mono flex items-center gap-1 border transition-all ${
                          step.type === "tool_call"
                            ? "bg-indigo-500/10 text-indigo-300 border-indigo-500/30 hover:bg-indigo-500/20"
                            : step.type === "tool_result"
                            ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/20"
                            : "bg-slate-800 text-slate-400 border-slate-700 hover:text-slate-200"
                        }`}
                      >
                        {step.type === "tool_call" && <Code2 className="w-3 h-3" />}
                        {step.type === "tool_result" && <CheckCircle2 className="w-3 h-3" />}
                        {step.type === "thought" && <Sparkles className="w-3 h-3 text-amber-400" />}
                        <span>
                          {step.type === "tool_call"
                            ? step.payload.name
                            : step.type === "tool_result"
                            ? `Result: ${step.payload.name}`
                            : "Thought"}
                        </span>
                      </button>
                    ))}
                  </div>
                )}

                <div className="text-[10px] text-slate-500 px-1">{m.timestamp}</div>
              </div>
            </div>
          ))}

          {isLoading && (
            <div className="flex gap-3 items-center text-xs text-indigo-400 animate-pulse">
              <div className="w-8 h-8 rounded-xl bg-purple-600/20 border border-purple-500/30 flex items-center justify-center">
                <Bot className="w-4 h-4 animate-spin text-indigo-400" />
              </div>
              <div className="p-3 rounded-xl bg-slate-800/40 border border-slate-800 flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce" />
                <span>Executing ReAct reasoning cycle...</span>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Quick Suggestion Chips */}
        <div className="px-4 py-2 border-t border-slate-800/80 bg-slate-950/40 flex items-center gap-2 overflow-x-auto no-scrollbar">
          <span className="text-[10px] uppercase font-bold text-slate-400 flex items-center gap-1 flex-shrink-0">
            <Sparkles className="w-3 h-3 text-amber-400" />
            Quick Prompts:
          </span>
          {samplePrompts.map((prompt, i) => (
            <button
              key={i}
              onClick={() => handleSendMessage(prompt)}
              className="text-[11px] px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white whitespace-nowrap transition-colors border border-slate-700/60"
            >
              {prompt}
            </button>
          ))}
        </div>

        {/* Input Bar */}
        <div className="p-4 border-t border-slate-800 bg-slate-900/90">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSendMessage();
            }}
            className="flex gap-2"
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask Pachiware Agent to do something or manage tasks..."
              className="flex-1 px-4 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
              disabled={isLoading}
            />
            <button
              type="submit"
              disabled={isLoading || !input.trim()}
              className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-medium text-xs shadow-md shadow-indigo-600/30 flex items-center gap-1.5"
            >
              <Send className="w-3.5 h-3.5" />
              <span>Send</span>
            </button>
          </form>
        </div>
      </div>

      {/* ReAct Step Deep Inspector Sidebar */}
      <div className="w-full lg:w-80 bg-slate-900/60 border border-slate-800 rounded-2xl p-4 flex flex-col justify-between shadow-xl">
        <div>
          <div className="flex items-center gap-2 pb-3 border-b border-slate-800 mb-3">
            <Terminal className="w-4 h-4 text-indigo-400" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">
              ReAct Step Inspector
            </h3>
          </div>

          {selectedStepData ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-slate-300 capitalize">
                  Step: {selectedStepData.type}
                </span>
                <button
                  onClick={() => setSelectedStepData(null)}
                  className="text-[10px] text-slate-500 hover:text-slate-300"
                >
                  Clear
                </button>
              </div>
              <pre className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-[11px] font-mono text-indigo-300 overflow-x-auto max-h-96">
                {JSON.stringify(selectedStepData.payload, null, 2)}
              </pre>
            </div>
          ) : (
            <div className="text-center py-16 text-slate-500 space-y-2">
              <Code2 className="w-8 h-8 mx-auto text-slate-600" />
              <p className="text-xs">
                Click on any step or tool badge in the chat to inspect its raw JSON payload, arguments, and execution observation.
              </p>
            </div>
          )}
        </div>

        <div className="pt-3 border-t border-slate-800/80 text-[11px] text-slate-500 space-y-1">
          <div className="flex justify-between">
            <span>Loop Architecture:</span>
            <span className="font-semibold text-slate-400">Explicit ReAct</span>
          </div>
          <div className="flex justify-between">
            <span>Tool Dispatch:</span>
            <span className="font-semibold text-slate-400">SkillRegistry</span>
          </div>
        </div>
      </div>
    </div>
  );
};
