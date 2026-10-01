import React, { useState } from "react";
import {
  KanbanSquare,
  Plus,
  Search,
  Clock,
  ArrowRight,
  ArrowLeft,
  Trash2,
  User,
  Hash,
  AlertTriangle,
} from "lucide-react";
import { api, type TaskItem } from "../lib/api.js";

interface TaskManagerProps {
  tasks: TaskItem[];
  onTasksUpdated: () => void;
}

export const TaskManager: React.FC<TaskManagerProps> = ({
  tasks,
  onTasksUpdated,
}) => {
  const [search, setSearch] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // New task form state
  const [newTitle, setNewTitle] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newPriority, setNewPriority] = useState<"low" | "medium" | "high" | "urgent">("medium");
  const [newAssignee, setNewAssignee] = useState("");
  const [newChannelId, setNewChannelId] = useState("");

  const handleStatusChange = async (
    taskId: string,
    newStatus: "pending" | "in_progress" | "completed"
  ) => {
    try {
      await api.updateTask(taskId, { status: newStatus });
      onTasksUpdated();
    } catch (err: any) {
      alert(`Failed to update status: ${err.message}`);
    }
  };

  const handleDeleteTask = async (taskId: string) => {
    if (!confirm("Are you sure you want to delete this task?")) return;
    try {
      await api.deleteTask(taskId);
      onTasksUpdated();
    } catch (err: any) {
      alert(`Failed to delete task: ${err.message}`);
    }
  };

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;

    setIsSubmitting(true);
    try {
      await api.createTask({
        title: newTitle.trim(),
        description: newDescription.trim() || undefined,
        priority: newPriority,
        assignedTo: newAssignee.trim() || undefined,
        discordChannelId: newChannelId.trim() || undefined,
      });

      setNewTitle("");
      setNewDescription("");
      setNewAssignee("");
      setNewChannelId("");
      setIsModalOpen(false);
      onTasksUpdated();
    } catch (err: any) {
      alert(`Failed to create task: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Filter tasks
  const filteredTasks = tasks.filter((t) => {
    const matchesSearch =
      t.title.toLowerCase().includes(search.toLowerCase()) ||
      (t.description && t.description.toLowerCase().includes(search.toLowerCase())) ||
      (t.assignedTo && t.assignedTo.toLowerCase().includes(search.toLowerCase()));

    const matchesPriority =
      priorityFilter === "all" || t.priority === priorityFilter;

    return matchesSearch && matchesPriority;
  });

  const pendingTasks = filteredTasks.filter((t) => t.status === "pending");
  const inProgressTasks = filteredTasks.filter((t) => t.status === "in_progress");
  const completedTasks = filteredTasks.filter((t) => t.status === "completed");

  const getPriorityBadge = (priority: string) => {
    switch (priority) {
      case "urgent":
        return "bg-rose-500/20 text-rose-300 border-rose-500/30";
      case "high":
        return "bg-amber-500/20 text-amber-300 border-amber-500/30";
      case "low":
        return "bg-slate-700/50 text-slate-400 border-slate-600";
      case "medium":
      default:
        return "bg-indigo-500/20 text-indigo-300 border-indigo-500/30";
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header & Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
            <KanbanSquare className="w-5 h-5 text-indigo-400" />
            Task Management Kanban
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Tasks stored in PostgreSQL 18. Synchronized with Discord commands and agent tool actions.
          </p>
        </div>

        <button
          onClick={() => setIsModalOpen(true)}
          className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs transition-all shadow-lg shadow-indigo-600/30 flex items-center gap-2 self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" />
          <span>New Task</span>
        </button>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tasks by title, description, or assignee..."
            className="w-full pl-10 pr-4 py-2 rounded-xl bg-slate-900/60 border border-slate-800 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
          />
        </div>

        <select
          value={priorityFilter}
          onChange={(e) => setPriorityFilter(e.target.value)}
          className="px-3 py-2 rounded-xl bg-slate-900/60 border border-slate-800 text-xs text-slate-300 focus:outline-none focus:border-indigo-500"
        >
          <option value="all">All Priorities</option>
          <option value="urgent">Urgent</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
      </div>

      {/* Kanban Columns */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* PENDING COLUMN */}
        <div className="flex flex-col rounded-2xl bg-slate-900/40 border border-slate-800/80 p-4 min-h-[500px]">
          <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-800/60">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">
                Pending
              </h3>
            </div>
            <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-slate-800 text-slate-400">
              {pendingTasks.length}
            </span>
          </div>

          <div className="space-y-3 flex-1 overflow-y-auto">
            {pendingTasks.map((t) => (
              <div
                key={t.id}
                className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 hover:border-slate-700 transition-all space-y-3 group shadow-sm"
              >
                <div className="flex items-start justify-between gap-2">
                  <h4 className="text-xs font-bold text-white leading-snug">{t.title}</h4>
                  <span
                    className={`text-[9px] uppercase font-bold px-2 py-0.5 rounded-full border ${getPriorityBadge(
                      t.priority
                    )}`}
                  >
                    {t.priority}
                  </span>
                </div>

                {t.description && (
                  <p className="text-[11px] text-slate-400 line-clamp-2 leading-relaxed">
                    {t.description}
                  </p>
                )}

                <div className="flex items-center justify-between pt-2 border-t border-slate-800/60 text-[10px] text-slate-500">
                  <div className="flex items-center gap-2">
                    {t.assignedTo && (
                      <span className="flex items-center gap-1 text-slate-400">
                        <User className="w-3 h-3 text-indigo-400" />
                        @{t.assignedTo}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleDeleteTask(t.id)}
                      className="p-1 text-slate-500 hover:text-red-400 transition-colors"
                      title="Delete Task"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleStatusChange(t.id, "in_progress")}
                      className="px-2 py-1 rounded bg-indigo-600/20 hover:bg-indigo-600/40 text-indigo-300 text-[10px] flex items-center gap-1 font-medium transition-colors"
                    >
                      <span>Start</span>
                      <ArrowRight className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* IN PROGRESS COLUMN */}
        <div className="flex flex-col rounded-2xl bg-slate-900/40 border border-slate-800/80 p-4 min-h-[500px]">
          <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-800/60">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-blue-400 animate-pulse" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">
                In Progress
              </h3>
            </div>
            <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-slate-800 text-slate-400">
              {inProgressTasks.length}
            </span>
          </div>

          <div className="space-y-3 flex-1 overflow-y-auto">
            {inProgressTasks.map((t) => (
              <div
                key={t.id}
                className="p-4 rounded-xl bg-slate-900/90 border border-indigo-500/20 hover:border-indigo-500/40 transition-all space-y-3 shadow-sm"
              >
                <div className="flex items-start justify-between gap-2">
                  <h4 className="text-xs font-bold text-white leading-snug">{t.title}</h4>
                  <span
                    className={`text-[9px] uppercase font-bold px-2 py-0.5 rounded-full border ${getPriorityBadge(
                      t.priority
                    )}`}
                  >
                    {t.priority}
                  </span>
                </div>

                {t.description && (
                  <p className="text-[11px] text-slate-400 line-clamp-2 leading-relaxed">
                    {t.description}
                  </p>
                )}

                <div className="flex items-center justify-between pt-2 border-t border-slate-800/60 text-[10px] text-slate-500">
                  <div className="flex items-center gap-2">
                    {t.assignedTo && (
                      <span className="flex items-center gap-1 text-slate-400">
                        <User className="w-3 h-3 text-indigo-400" />
                        @{t.assignedTo}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => handleStatusChange(t.id, "pending")}
                      className="p-1 text-slate-500 hover:text-slate-300 transition-colors"
                      title="Move back to Pending"
                    >
                      <ArrowLeft className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleStatusChange(t.id, "completed")}
                      className="px-2 py-1 rounded bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-300 text-[10px] flex items-center gap-1 font-medium transition-colors"
                    >
                      <span>Complete</span>
                      <ArrowRight className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* COMPLETED COLUMN */}
        <div className="flex flex-col rounded-2xl bg-slate-900/40 border border-slate-800/80 p-4 min-h-[500px]">
          <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-800/60">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">
                Completed
              </h3>
            </div>
            <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-slate-800 text-slate-400">
              {completedTasks.length}
            </span>
          </div>

          <div className="space-y-3 flex-1 overflow-y-auto">
            {completedTasks.map((t) => (
              <div
                key={t.id}
                className="p-4 rounded-xl bg-slate-900/50 border border-slate-800/60 space-y-3 opacity-80 hover:opacity-100 transition-all"
              >
                <div className="flex items-start justify-between gap-2">
                  <h4 className="text-xs font-bold text-slate-300 line-through leading-snug">
                    {t.title}
                  </h4>
                  <span
                    className={`text-[9px] uppercase font-bold px-2 py-0.5 rounded-full border ${getPriorityBadge(
                      t.priority
                    )}`}
                  >
                    {t.priority}
                  </span>
                </div>

                {t.description && (
                  <p className="text-[11px] text-slate-500 line-clamp-2">
                    {t.description}
                  </p>
                )}

                <div className="flex items-center justify-between pt-2 border-t border-slate-800/40 text-[10px] text-slate-500">
                  <span>@{t.assignedTo || "unassigned"}</span>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => handleStatusChange(t.id, "in_progress")}
                      className="p-1 text-slate-500 hover:text-slate-300 transition-colors"
                      title="Reopen Task"
                    >
                      <ArrowLeft className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleDeleteTask(t.id)}
                      className="p-1 text-slate-500 hover:text-red-400 transition-colors"
                      title="Delete"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* New Task Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-6 space-y-5">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Plus className="w-4 h-4 text-indigo-400" />
                Create New Task
              </h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-slate-400 hover:text-white text-xs"
              >
                Close
              </button>
            </div>

            <form onSubmit={handleCreateTask} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Task Title *
                </label>
                <input
                  type="text"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="e.g. Audit server permissions"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-xs text-white focus:outline-none focus:border-indigo-500"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Description
                </label>
                <textarea
                  rows={3}
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  placeholder="Task details and expectations..."
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-xs text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Priority
                  </label>
                  <select
                    value={newPriority}
                    onChange={(e) => setNewPriority(e.target.value as any)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-xs text-white focus:outline-none focus:border-indigo-500"
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Assignee
                  </label>
                  <input
                    type="text"
                    value={newAssignee}
                    onChange={(e) => setNewAssignee(e.target.value)}
                    placeholder="e.g. john-doe"
                    className="w-full px-3.5 py-2 rounded-xl bg-slate-800 border border-slate-700 text-xs text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <div className="flex justify-end space-x-3 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs text-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-xs text-white font-medium shadow-md shadow-indigo-600/30"
                >
                  {isSubmitting ? "Creating..." : "Create Task"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
