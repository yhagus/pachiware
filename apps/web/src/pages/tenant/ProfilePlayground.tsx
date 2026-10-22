import { useEffect, useState } from "react";
import { CircleCheck, CircleMinus, CircleX, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { MessageResponse } from "@/components/ai-elements/lazy-response";
import { api, type CheckStatus, type PlaygroundResult, type Profile, type ProfileChecks } from "@/lib/api";
import { profileLabel } from "./TenantProfiles";

const STEPS = [["url", "Base URL"], ["key", "API key"], ["model", "Model"], ["text", "Text reply"], ["image", "Image input"]] as const;
/** How a check step reads in every Test checklist: its icon, tone, and the word a screen reader hears. */
export const STATUS: Record<CheckStatus, { Icon: typeof CircleCheck; tone: string; word: string }> = {
  ok: { Icon: CircleCheck, tone: "text-emerald-600 dark:text-emerald-500", word: "passed" },
  warning: { Icon: TriangleAlert, tone: "text-amber-600 dark:text-amber-500", word: "warning" },
  failed: { Icon: CircleX, tone: "text-destructive", word: "failed" },
  skipped: { Icon: CircleMinus, tone: "text-muted-foreground", word: "skipped" },
};
const TEXTAREA = "w-full resize-y rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function ProfileChecklist({ checks }: { checks: ProfileChecks }) {
  return (
    <ol role="status" aria-label="Test results" className="divide-y rounded-md border text-sm">
      {STEPS.map(([key, label]) => {
        const check = checks[key];
        const { Icon, tone, word } = STATUS[check.status];
        return (
          <li key={key} className="flex gap-2.5 px-3 py-2">
            <Icon aria-hidden className={`mt-0.5 size-4 shrink-0 ${tone}`} />
            <div className="min-w-0 flex-1">
              <p><span className="font-medium">{label}</span><span className="sr-only"> {word}:</span> <span className={check.status === "failed" ? "text-destructive" : check.status === "skipped" ? "text-muted-foreground" : ""}>{check.message}</span></p>
              {check.reply && <p className="mt-0.5 break-words font-mono text-xs text-muted-foreground">Reply: {check.reply}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

const meta = (r: Extract<PlaygroundResult, { success: true }>) =>
  [`${r.ms} ms`, r.usage && `${r.usage.input} tokens in, ${r.usage.output} out`, r.finishReason && `finish reason: ${r.finishReason}`].filter(Boolean).join(" · ");

/** Runs the Test checklist and single prompts against a saved profile, so a profile can be tried without opening its form. */
export function ProfilePlayground({ profile, onClose }: { profile: Profile | null; onClose: () => void }) {
  const [checks, setChecks] = useState<ProfileChecks | null>(null);
  const [checking, setChecking] = useState(false);
  const [system, setSystem] = useState("");
  const [prompt, setPrompt] = useState("");
  const [result, setResult] = useState<PlaygroundResult | null>(null);
  const [sending, setSending] = useState(false);
  useEffect(() => { setChecks(null); setResult(null); }, [profile?.id]);
  if (!profile) return null;

  const target = { provider: profile.provider, apiFormat: profile.apiFormat, model: profile.model, baseUrl: profile.baseUrl ?? undefined, profileId: profile.id, reasoningEffort: profile.reasoningEffort };
  const runChecks = async () => {
    setChecking(true);
    try { setChecks((await api.testProfile(target)).checks); } catch (e: any) { toast.error(e.message); } finally { setChecking(false); }
  };
  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    setSending(true); setResult(null);
    try { setResult(await api.tryProfile({ ...target, system: system.trim() || undefined, prompt })); } catch (err: any) { toast.error(err.message); } finally { setSending(false); }
  };
  const submitOnShortcut = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Playground: {profile.name}</DialogTitle>
          <DialogDescription>{profileLabel(profile)}, <code className="font-mono">{profile.model}</code>. Runs on the saved settings, so save the profile first to try a change.</DialogDescription>
        </DialogHeader>

        <section aria-labelledby="pg-connection" className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h3 id="pg-connection" className="text-sm font-medium">Connection</h3>
            <Button type="button" variant="outline" disabled={checking} onClick={runChecks}>{checking ? "Checking…" : checks ? "Check again" : "Run checks"}</Button>
          </div>
          {checks
            ? <ProfileChecklist checks={checks} />
            : <p className="text-sm text-muted-foreground">Checks the base URL, the API key, the model, a text reply, and image input, in that order.</p>}
        </section>

        <form onSubmit={send} aria-labelledby="pg-prompt" className="space-y-3 border-t pt-5">
          <h3 id="pg-prompt" className="text-sm font-medium">Prompt</h3>
          <div className="space-y-2"><Label htmlFor="pg-system">System prompt (optional)</Label>
            <textarea id="pg-system" rows={2} value={system} onChange={(e) => setSystem(e.target.value)} onKeyDown={submitOnShortcut} placeholder="Instructions the model follows, such as the language to answer in" className={TEXTAREA} /></div>
          <div className="space-y-2"><Label htmlFor="pg-message">Message</Label>
            <textarea id="pg-message" rows={4} required value={prompt} onChange={(e) => setPrompt(e.target.value)} onKeyDown={submitOnShortcut} placeholder="What you would ask the bot" className={TEXTAREA} /></div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">One message, no history. Ctrl+Enter or ⌘+Enter sends.</p>
            <Button disabled={sending || !prompt.trim()}>{sending ? "Waiting for reply…" : "Send"}</Button>
          </div>
        </form>

        {result && (result.success
          ? <div role="status" className="space-y-1.5">
              <div className="max-h-80 overflow-y-auto break-words rounded-md border bg-muted/40 px-3 py-2 text-sm">{result.reply ? <MessageResponse>{result.reply}</MessageResponse> : <span className="text-muted-foreground">The model sent an empty reply.</span>}</div>
              <p className="text-xs text-muted-foreground">{meta(result)}</p>
            </div>
          : <p role="alert" className="text-sm text-destructive">Failed after {result.ms} ms ({result.error}).</p>)}
      </DialogContent>
    </Dialog>
  );
}
