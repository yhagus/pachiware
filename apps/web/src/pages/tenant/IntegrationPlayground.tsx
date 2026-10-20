import { useEffect, useRef, useState } from "react";
import { CopyIcon, FlaskConical, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Conversation, ConversationContent, ConversationEmptyState, ConversationScrollButton } from "@/components/ai-elements/conversation";
import { Message, MessageAction, MessageActions, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import { PromptInput, PromptInputFooter, PromptInputSubmit, PromptInputTextarea, type PromptInputMessage } from "@/components/ai-elements/prompt-input";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { Suggestion, Suggestions } from "@/components/ai-elements/suggestion";
import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput } from "@/components/ai-elements/tool";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { api, type Guild, type PlaygroundRow, type PlaygroundTurn } from "@/lib/api";
import { useIntegration } from "./IntegrationDetail";

// The conversation lives in this page only: nothing is stored on the server or in the browser, so leaving the page clears it.
/** A tool call as the page shows it; `ok` is unset while it runs. */
type ToolView = { id: string; tool: string; args: unknown; ok?: boolean; result?: string };
type Turn = { id: number; text: string; tools: ToolView[]; answer?: Pick<PlaygroundTurn, "messages" | "reaction" | "ms">; error?: string };
type Status = "ready" | "submitted" | "streaming";

const textChannels = (g?: Guild) => g?.channels.filter((c) => c.type === "text" || c.type === "announcement") ?? [];
/** A failed call's result is `{"error": …}`; its message reads better than the JSON. */
const errorOf = (result?: string) => { try { return JSON.parse(result ?? "").error ?? result; } catch { return result; } };

function ToolCall({ call }: { call: ToolView }) {
  const state = call.ok === undefined ? "input-available" : call.ok ? "output-available" : "output-error";
  return (
    <Tool className="mb-0">
      <ToolHeader type={`tool-${call.tool}`} state={state} />
      <ToolContent>
        <ToolInput input={call.args} />
        <ToolOutput output={call.ok ? call.result : undefined} errorText={call.ok === false ? errorOf(call.result) : undefined} />
      </ToolContent>
    </Tool>
  );
}

export function IntegrationPlayground() {
  const { bot } = useIntegration();
  const [place, setPlace] = useState<{ connected: boolean; guilds: Guild[] } | null>(null);
  const [guildId, setGuildId] = useState("");
  const [channelId, setChannelId] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [history, setHistory] = useState<PlaygroundRow[]>([]);
  const [offered, setOffered] = useState<string[] | null>(null);
  const [text, setText] = useState("");
  const [status, setStatus] = useState<Status>("ready");
  const session = useRef(crypto.randomUUID());
  // A turn that answers after a reset or a stop is dropped.
  const asked = useRef(0);
  const reading = useRef<AbortController | null>(null);
  useEffect(() => { api.getBotGuilds(bot.id).then(setPlace).catch((e) => toast.error(e.message)); }, [bot.id]);

  const reset = () => { asked.current++; reading.current?.abort(); session.current = crypto.randomUUID(); setTurns([]); setHistory([]); setOffered(null); setStatus("ready"); };
  // Another place is another conversation.
  useEffect(reset, [guildId, channelId]);

  const listed = !!place?.connected && place.guilds.length > 0;
  const guild = place?.guilds.find((g) => g.id === guildId);
  const ready = !!guildId.trim() && !!channelId.trim();
  const suggestions = [
    ...(bot.planeAccountIds.length ? ["Which Plane projects can you reach?"] : []),
    ...(bot.gitAccountIds.length ? ["Which repositories can you see?"] : []),
    "What tasks are open in this channel?",
    "What did we decide here recently?",
  ];
  const update = (n: number, change: (turn: Turn) => Turn) => setTurns((list) => list.map((t) => (t.id === n ? change(t) : t)));

  const send = async (message: string) => {
    message = message.trim();
    if (!message || !ready || status !== "ready") return;
    const n = ++asked.current, controller = new AbortController();
    reading.current = controller;
    setTurns((list) => [...list, { id: n, text: message, tools: [] }]);
    setText(""); setStatus("submitted");
    try {
      const { history: added, offered: tools, messages, reaction, ms } = await api.tryBot(bot.id, { guildId: guildId.trim(), channelId: channelId.trim(), sessionId: session.current, message, history }, (p) => {
        if (n !== asked.current) return;
        setStatus("streaming");
        if (p.type === "tool") update(n, (t) => ({ ...t, tools: [...t.tools, { id: p.id, tool: p.tool, args: p.args }] }));
        else update(n, (t) => ({ ...t, tools: t.tools.map((c) => (c.id === p.id ? { ...c, ok: p.ok, result: p.result } : c)) }));
      }, controller.signal);
      if (n !== asked.current) return;
      setHistory((rows) => [...rows, ...added]); setOffered(tools);
      update(n, (t) => ({ ...t, answer: { messages, reaction, ms } }));
    } catch (err: any) {
      if (n !== asked.current && !controller.signal.aborted) return;
      update(n, (t) => ({ ...t, error: controller.signal.aborted ? "Stopped. The bot won't remember this message." : `${err.message} The bot won't remember this message.` }));
    } finally { if (n === asked.current || controller.signal.aborted) setStatus("ready"); }
  };
  // Stopping only stops reading: the turn runs on at the server, and its answer is dropped.
  const stop = () => { asked.current++; reading.current?.abort(); };

  if (!place) return <Skeleton className="h-96" />;
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Read-only test: tools that change something aren't offered, nothing is posted to Discord, and nothing is saved.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {listed ? (
          <>
            <div className="space-y-2"><Label htmlFor="pg-guild">Server</Label>
              <Select value={guildId} onValueChange={(v) => { setGuildId(v); setChannelId(""); }}>
                <SelectTrigger id="pg-guild" className="w-full"><SelectValue placeholder="Choose a server" /></SelectTrigger>
                <SelectContent>{place.guilds.map((g) => <SelectItem key={g.id} value={g.id} disabled={!g.allowed}>{g.name}{!g.allowed && " (ignored)"}</SelectItem>)}</SelectContent>
              </Select></div>
            <div className="space-y-2"><Label htmlFor="pg-channel">Channel</Label>
              <Select value={channelId} onValueChange={setChannelId} disabled={!guild}>
                <SelectTrigger id="pg-channel" className="w-full"><SelectValue placeholder="Choose a channel" /></SelectTrigger>
                <SelectContent>
                  {[...new Set(textChannels(guild).map((c) => c.category ?? ""))].map((category) => (
                    <SelectGroup key={category}>
                      {category && <SelectLabel>{category}</SelectLabel>}
                      {textChannels(guild).filter((c) => (c.category ?? "") === category).map((c) => <SelectItem key={c.id} value={c.id}>#{c.name}</SelectItem>)}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select></div>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground sm:col-span-2">The bot isn't connected, so enter the server and channel IDs. Tools that read Discord itself, such as members or today's talk, won't work.</p>
            <div className="space-y-2"><Label htmlFor="pg-guild-id">Server ID</Label><Input id="pg-guild-id" inputMode="numeric" value={guildId} onChange={(e) => setGuildId(e.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor="pg-channel-id">Channel ID</Label><Input id="pg-channel-id" inputMode="numeric" value={channelId} onChange={(e) => setChannelId(e.target.value)} /></div>
          </>
        )}
      </div>

      <div className="flex h-[min(70vh,40rem)] flex-col rounded-lg border">
        <div className="flex items-center gap-3 border-b px-4 py-2">
          {offered ? (
            <details className="min-w-0 flex-1 text-xs text-muted-foreground">
              <summary className="cursor-pointer">Tools offered here ({offered.length})</summary>
              <p className="mt-1 break-words font-mono">{offered.length ? [...offered].sort().join(", ") : "None"}</p>
            </details>
          ) : <span className="flex-1 text-xs text-muted-foreground">{ready ? "Ask something the bot should look up." : "Choose where the bot is, first."}</span>}
          <Button variant="ghost" size="sm" disabled={!turns.length} onClick={reset}><RotateCcw /> Reset</Button>
        </div>
        <Conversation aria-label="Playground conversation">
          <ConversationContent>
            {!turns.length ? (
              <ConversationEmptyState icon={<FlaskConical className="size-10" />} title={ready ? "Test the bot here" : "Choose a server and channel"}
                description={ready ? "It answers as it would in that channel, reading only. Try one of these:" : "The bot uses that channel's access to Git, Plane and its other integrations."} />
            ) : turns.map((turn) => {
              const working = !turn.answer && !turn.error && turn.id === asked.current;
              return (
                <div key={turn.id} className="flex flex-col gap-4">
                  <Message from="user"><MessageContent className="whitespace-pre-wrap">{turn.text}</MessageContent></Message>
                  <Message from="assistant">
                    <MessageContent className="w-full">
                      {turn.tools.map((call) => <ToolCall key={call.id} call={call} />)}
                      {turn.answer?.messages.map((m, i) => <MessageResponse key={i}>{m}</MessageResponse>)}
                      {turn.answer?.reaction && <span className="w-fit rounded-full border px-2 py-0.5 text-base" title="The bot reacted instead of replying">{turn.answer.reaction}</span>}
                      {working && <Shimmer className="text-sm">{status === "streaming" ? "Using its tools…" : "Bot is working…"}</Shimmer>}
                      {turn.error && <p role="alert" className="text-sm text-destructive">{turn.error}</p>}
                    </MessageContent>
                    {turn.answer && (
                      <MessageActions>
                        <MessageAction tooltip="Copy reply" onClick={() => navigator.clipboard.writeText(turn.answer!.messages.join("\n\n")).then(() => toast.success("Reply copied"))}><CopyIcon className="size-3.5" /></MessageAction>
                        <span className="text-xs text-muted-foreground">{(turn.answer.ms / 1000).toFixed(1)} s · {turn.tools.length} tool call{turn.tools.length === 1 ? "" : "s"}</span>
                      </MessageActions>
                    )}
                  </Message>
                </div>
              );
            })}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>
        <div className="space-y-3 border-t p-3">
          {!turns.length && ready && (
            <Suggestions>{suggestions.map((s) => <Suggestion key={s} suggestion={s} onClick={(q) => void send(q)} />)}</Suggestions>
          )}
          <PromptInput onSubmit={(m: PromptInputMessage) => void send(m.text)}>
            <PromptInputTextarea value={text} onChange={(e) => setText(e.currentTarget.value)} disabled={!ready} placeholder={ready ? "Message the bot" : "Choose a server and channel first"} />
            <PromptInputFooter className="justify-end">
              <PromptInputSubmit status={status} onStop={stop} disabled={status === "ready" && (!ready || !text.trim())} />
            </PromptInputFooter>
          </PromptInput>
        </div>
      </div>
    </div>
  );
}
