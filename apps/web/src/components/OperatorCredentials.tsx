import React, { useState } from "react";
import { getApiKey, getPlatformKey, setCredentials } from "../lib/api.js";
export function OperatorCredentials({ onSaved }: { onSaved?: () => void }) {
  const [apiKey, setApiKey] = useState(getApiKey);
  const [platformKey, setPlatformKey] = useState(getPlatformKey);
  return <form onSubmit={(event) => { event.preventDefault(); setCredentials(apiKey, platformKey); onSaved?.(); }} className="flex flex-wrap items-end gap-3 p-4 bg-slate-900/60 border-b border-slate-800">
    <label className="flex-1 min-w-48 text-xs text-slate-300">Tenant API key<input aria-label="Tenant API key" type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="pk_live_..." className="block mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2" /></label>
    <label className="flex-1 min-w-48 text-xs text-slate-300">Platform key (setup & infrastructure)<input aria-label="Platform key" type="password" value={platformKey} onChange={(event) => setPlatformKey(event.target.value)} placeholder="Platform admin key" className="block mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2" /></label>
    <button className="rounded-lg bg-indigo-600 px-4 py-2 text-xs text-white">Connect</button>
  </form>;
}
