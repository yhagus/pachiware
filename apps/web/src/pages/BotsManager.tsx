import React, { useEffect, useState } from "react";
import { Bot as BotIcon, RefreshCw, Trash2, Zap } from "lucide-react";
import { api, type Bot } from "../lib/api.js";
export function BotsManager() {
  const [bots, setBots] = useState<Bot[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [token, setToken] = useState("");
  const [clientId, setClientId] = useState("");
  const [guilds, setGuilds] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const load = async () => { try { setBots((await api.getBots()).bots); } catch (err: any) { setNotice(err.message); } };
  useEffect(() => { void load(); const timer = setInterval(load, 10000); return () => clearInterval(timer); }, []);
  const reset = () => { setEditing(null); setName(""); setToken(""); setClientId(""); setGuilds(""); setEnabled(true); };
  const action = async (operation: () => Promise<any>) => {
    setBusy(true); setNotice("");
    try { const result = await operation(); if (result.success === false) setNotice(result.error || result.message || "Operation failed"); else setNotice(result.message || (result.botTag ? `Authenticated as ${result.botTag}` : "Saved.")); await load(); }
    catch (err: any) { setNotice(err.message); }
    finally { setBusy(false); }
  };
  const field = "w-full rounded-xl bg-slate-950 border border-slate-700 px-3 py-2 text-sm";
  return <div className="max-w-4xl space-y-6">
    <h2 className="text-xl font-bold flex gap-2 items-center"><BotIcon className="text-indigo-400" />Tenant Discord bots</h2>
    {notice && <p role="status" className="rounded-xl border border-slate-700 bg-slate-900 p-3 text-sm">{notice}</p>}
    <div className="space-y-3">{bots.length === 0 && <p className="text-sm text-slate-400">Add a bot to connect this tenant to Discord.</p>}{bots.map((bot) => <div key={bot.id} className="rounded-xl bg-slate-900 border border-slate-800 p-4 flex flex-wrap items-center gap-3">
      <div className="flex-1 min-w-40"><h3 className="font-semibold">{bot.name}</h3><p className="text-xs text-slate-400 mt-1">{bot.connectionStatus} · {bot.isEnabled ? "Enabled" : "Disabled"} · {bot.guildIds.join(", ") || "All joined guilds"}</p>{bot.lastError && <p className="text-xs text-amber-300 mt-1">{bot.lastError}</p>}</div>
      <button disabled={busy} onClick={() => { setEditing(bot.id); setName(bot.name); setClientId(bot.clientId || ""); setGuilds(bot.guildIds.join(", ")); setToken(""); setEnabled(bot.isEnabled); }} className="text-xs text-indigo-300">Edit</button>
      <button aria-label={`Test ${bot.name}`} disabled={busy} onClick={() => action(() => api.testBot(bot.id))}><Zap size={16} /></button>
      <button aria-label={`Restart ${bot.name}`} disabled={busy} onClick={() => action(() => api.restartBot(bot.id))}><RefreshCw size={16} /></button>
      <button aria-label={`Delete ${bot.name}`} disabled={busy} onClick={() => { if (window.confirm(`Delete ${bot.name}?`)) void action(() => api.deleteBot(bot.id)); }}><Trash2 size={16} /></button>
    </div>)}</div>
    <form className="rounded-2xl bg-slate-900/60 border border-slate-800 p-5 space-y-4" onSubmit={(event) => { event.preventDefault(); void action(async () => { const data = { name: name.trim() || "Discord Bot", ...(token.trim() ? { token: token.trim() } : {}), ...(clientId.trim() ? { clientId: clientId.trim() } : {}), guildIds: guilds.split(",").map((id) => id.trim()).filter(Boolean), isEnabled: enabled }; const result = editing ? await api.updateBot(editing, data) : await api.createBot({ ...data, token }); reset(); return result; }); }}>
      <h3 className="font-semibold">{editing ? "Edit bot" : "Add bot"}</h3>
      <label className="block text-xs text-slate-300">Name<input className={field} value={name} onChange={(event) => setName(event.target.value)} /></label>
      <label className="block text-xs text-slate-300">Bot token<input required={!editing} type="password" className={field} value={token} onChange={(event) => setToken(event.target.value)} placeholder={editing ? "Leave empty to keep current token" : "Discord bot token"} /></label>
      <div className="grid sm:grid-cols-2 gap-4"><label className="block text-xs text-slate-300">Application ID<input className={field} value={clientId} onChange={(event) => setClientId(event.target.value)} /></label><label className="block text-xs text-slate-300">Guild IDs (comma separated)<input className={field} value={guilds} onChange={(event) => setGuilds(event.target.value)} /></label></div>
      <label className="text-sm flex gap-2"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />Enabled</label>
      <div className="flex gap-3"><button disabled={busy} className="rounded-xl bg-indigo-600 px-4 py-2 text-sm">{busy ? "Saving..." : "Save bot"}</button>{editing && <button type="button" onClick={reset} className="text-sm">Cancel</button>}</div>
    </form>
  </div>;
}
