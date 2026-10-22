import { elapsed, stageIndex, stageLine, stepLine, stepOf, textIn, type Language, type StepKind } from "@pachiware/skills";

/** When a turn's progress message appears, and how often it may change at most (Discord limits edits); tests shorten both. */
export const progressTiming = { showAfterMs: 10_000, everyMs: 3_000 };
/** How many step lines the message shows: the latest ones. */
const SHOWN_STEPS = 5;

type Posted = { edit(content: string): Promise<unknown>; delete?(): Promise<unknown> };
type Line = { kind: StepKind; subjects: (string | undefined)[]; running: number };

/**
 * One message that shows how far a long turn has come (#345): posted once the turn has run for `showAfterMs`, edited as its steps go,
 * and shrunk to one line when the turn ends, so the answer that follows is a message of its own. A turn that ends sooner posts nothing.
 */
export class TurnProgress {
  private readonly started = Date.now();
  private readonly lines: Line[] = [];
  private readonly open = new Map<string, Line>();
  private readonly recorded = new Set<string>();
  private stage = -1;
  private message: Posted | null = null;
  private posting: Promise<void> | null = null;
  private shown = "";
  private ended = false;
  private readonly first: ReturnType<typeof setTimeout>;
  private ticks?: ReturnType<typeof setInterval>;

  constructor(private readonly post: (content: string) => Promise<Posted>, private readonly language: Language | undefined, private readonly playbook?: string) {
    this.first = setTimeout(() => this.show(), progressTiming.showAfterMs);
  }

  /** The loop's onStep: a call opens its step, its result closes it; a call a person need not see moves only the stage. */
  readonly step = ({ type, payload }: { type: string; payload: any }) => {
    if (type === "tool_call") {
      this.stage = stageIndex(this.playbook, payload.name, this.stage);
      const step = stepOf(payload.name, payload.arguments);
      if (!step) return;
      const last = this.lines.at(-1);
      const line = last && last.kind === step.kind ? last : (this.lines.push({ kind: step.kind, subjects: [], running: 0 }), this.lines.at(-1)!);
      line.subjects.push(step.subject);
      line.running++;
      this.open.set(payload.id, line);
    } else if (type === "tool_result") {
      const line = this.open.get(payload.toolCallId);
      if (line) { line.running--; this.open.delete(payload.toolCallId); }
      if (payload.name === "putChangelogOperation" && payload.success && typeof payload.data?.saved === "string") this.recorded.add(payload.data.saved);
    }
  };

  private render(): string {
    const t = textIn(this.language).progress, ms = Date.now() - this.started;
    // Whole minutes only, so the time alone changes the message at most once a minute.
    const head = ms >= 60_000 ? `${t.working} · ${elapsed(ms, this.language)}` : t.working;
    const stage = stageLine(this.playbook, this.stage, this.recorded.size, this.language);
    const steps = this.lines.slice(-SHOWN_STEPS).map((l) => `-# ${l.running > 0 ? "›" : "✓"} ${stepLine(l.kind, l.subjects, this.language)}`);
    return [head, ...(stage ? [stage] : []), ...steps].join("\n");
  }

  private show() {
    if (this.ended) return;
    const text = this.render();
    this.posting = this.post(text).then((m) => { this.message = m; this.shown = text; }, () => {});
    this.ticks = setInterval(() => {
      if (!this.message || this.ended) return;
      const next = this.render();
      if (next !== this.shown) { this.shown = next; void this.message.edit(next).catch(() => {}); }
    }, progressTiming.everyMs);
  }

  /** Ends it: the message shrinks to how long the work took, or goes when nothing was answered after it. */
  async finish(answered: boolean) {
    if (this.ended) return;
    this.ended = true;
    clearTimeout(this.first);
    clearInterval(this.ticks);
    await this.posting;
    if (!this.message) return;
    if (!answered && this.message.delete) await this.message.delete().catch(() => {});
    else await this.message.edit(`-# ${textIn(this.language).progress.workedFor(elapsed(Date.now() - this.started, this.language))}`).catch(() => {});
  }
}
