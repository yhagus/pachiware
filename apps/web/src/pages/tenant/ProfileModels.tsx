import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { GripVertical, RefreshCw, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ComboboxInput } from "@/components/ComboboxInput";
import { IconButton } from "@/components/IconButton";
import { cn } from "@/lib/utils";

// Mirrors MAX_PROFILE_MODELS in apps/agent/src/llm/providers.ts.
export const MAX_MODELS = 3;

const moved = (list: string[], from: number, to: number) => {
  const next = [...list];
  next.splice(to, 0, ...next.splice(from, 1));
  return next;
};

/**
 * A Profile's models in the order they are asked: the first answers, and each next one when the one before fails.
 * A model is added by typing it or picking a fetched one, and moved by dragging its handle or with the arrow keys on it.
 */
export function ProfileModels({ id, models, onChange, draft, onDraftChange, options, placeholder, fetching, canFetch, onFetch }: {
  id: string; models: string[]; onChange: (models: string[]) => void; draft: string; onDraftChange: (draft: string) => void;
  options: string[]; placeholder?: string; fetching: boolean; canFetch: boolean; onFetch: () => void;
}) {
  const list = useRef<HTMLOListElement>(null);
  // A drag reads the list as it is after each move, not as it was when the drag began.
  const latest = useRef(models);
  latest.current = models;
  const [dragging, setDragging] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const [said, setSaid] = useState("");
  const full = models.length >= MAX_MODELS;

  // A row moved with the keyboard is put back in the DOM, which drops focus from its handle; this returns it.
  useEffect(() => {
    if (focus) list.current?.querySelector<HTMLElement>(`[data-model="${CSS.escape(focus)}"]`)?.focus();
  }, [focus, models]);

  const add = (model: string) => {
    const m = model.trim();
    if (m && !models.includes(m) && !full) onChange([...models, m]);
    onDraftChange("");
  };
  const move = (from: number, to: number) => {
    if (to < 0 || to >= models.length) return;
    onChange(moved(models, from, to));
    setSaid(`${models[from]} moved to ${to + 1} of ${models.length}`);
  };
  const drag = (model: string) => (e: PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    setDragging(model);
    const over = (ev: globalThis.PointerEvent) => {
      const rows = [...list.current!.children];
      const to = rows.findIndex((row) => { const r = row.getBoundingClientRect(); return ev.clientY >= r.top && ev.clientY < r.bottom; });
      const from = latest.current.indexOf(model);
      if (to >= 0 && to !== from) onChange(moved(latest.current, from, to));
    };
    const end = () => {
      setDragging(null);
      window.removeEventListener("pointermove", over);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
    window.addEventListener("pointermove", over);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  };
  const keys = (i: number) => (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    setFocus(models[i]);
    move(i, e.key === "ArrowUp" ? i - 1 : i + 1);
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <ComboboxInput id={id} className="flex-1" options={options.filter((o) => !models.includes(o))} value={draft} disabled={full}
          placeholder={full ? `Up to ${MAX_MODELS} models` : models.length ? "Add a fallback model" : placeholder} required={!models.length}
          onValueChange={onDraftChange} onPick={add} onKeyDown={(e) => { if (e.key === "Enter" && !e.defaultPrevented) { e.preventDefault(); add(draft); } }} />
        <IconButton label="Fetch models" variant="outline" type="button" disabled={fetching || !canFetch} onClick={onFetch}><RefreshCw className={fetching ? "animate-spin" : ""} /></IconButton>
      </div>
      {models.length > 0 && (
        <ol ref={list} aria-label="Models, in the order they are asked" className={cn("divide-y rounded-md border", dragging && "select-none")}>
          {models.map((m, i) => (
            <li key={m} className={cn("flex items-center gap-2 py-1 pr-1 pl-1.5 text-sm transition-colors", dragging === m && "bg-accent")}>
              <button type="button" data-model={m} aria-label={`Move ${m}, ${i + 1} of ${models.length}`} aria-describedby={`${id}-move`}
                onPointerDown={drag(m)} onKeyDown={keys(i)} onBlur={() => setFocus(null)}
                className="grid size-7 shrink-0 cursor-grab touch-none place-items-center rounded text-muted-foreground outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 active:cursor-grabbing">
                <GripVertical className="size-4" />
              </button>
              <span className="w-4 shrink-0 text-center text-xs text-muted-foreground tabular-nums">{i + 1}</span>
              <code className="min-w-0 flex-1 font-mono text-xs wrap-anywhere">{m}</code>
              {i === 0 ? <Badge variant="secondary">Primary</Badge> : <Badge variant="outline">Fallback</Badge>}
              <IconButton label={`Remove ${m}`} type="button" className="size-7" onClick={() => onChange(models.filter((x) => x !== m))}><X /></IconButton>
            </li>
          ))}
        </ol>
      )}
      <p id={`${id}-move`} className="sr-only">Arrow up and down move it.</p>
      <p aria-live="polite" className="sr-only">{said}</p>
    </div>
  );
}
