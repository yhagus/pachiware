import { useEffect, useState } from "react";
import { ArrowLeft, MessageSquare } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { CopyId } from "@/components/CopyId";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import { api, type ChatMessage, type Conversation, type GuildChannel } from "@/lib/api";
import { useLastShown } from "@/hooks/use-last-shown";

// Guild turns are stored as "Name: text"; older rows have no prefix.
const speaker = (m: ChatMessage) => (m.role === "user" ? m.content?.match(/^([^:\n]{1,40}): /)?.[1] ?? "User" : "Bot");
const body = (m: ChatMessage) => (m.role === "user" ? m.content?.replace(/^[^:\n]{1,40}: /, "") : m.content);
const time = (s: string | null) => (s ? new Date(s).toLocaleString() : "–");

export function ChannelConversations({ botId, channel, onClose }: { botId: string; channel: GuildChannel | null; onClose: () => void }) {
  const shown = useLastShown(channel);
  const [list, setList] = useState<Conversation[] | null>(null);
  const [open, setOpen] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [ending, setEnding] = useState(false);
  // The list is newest first, so the first conversation of each channel or thread is the one its next message continues.
  const current = (c: Conversation) => !c.endedAt && list?.find((o) => o.channelId === c.channelId)?.id === c.id;

  const end = async (c: Conversation) => {
    setEnding(true);
    try {
      const ended = { ...c, endedAt: (await api.endBotConversation(botId, c.id)).endedAt };
      setList((l) => l && l.map((o) => (o.id === c.id ? ended : o)));
      setOpen(ended);
      toast.success("Conversation ended. The next message there starts a fresh one.");
    } catch (e) { toast.error((e as Error).message); }
    finally { setEnding(false); }
  };

  useEffect(() => {
    if (!channel) return;
    setList(null); setOpen(null);
    let live = true;
    api.listBotConversations(botId, channel.id).then((r) => live && setList(r.conversations)).catch((e) => { toast.error(e.message); live && setList([]); });
    return () => { live = false; };
  }, [botId, channel]);

  useEffect(() => {
    setMessages(null);
    if (!open) return;
    let live = true;
    api.getBotConversationMessages(botId, open.id).then((r) => live && setMessages(r.messages)).catch((e) => { toast.error(e.message); live && setMessages([]); });
    return () => { live = false; };
  }, [botId, open]);

  return (
    <Sheet open={!!channel} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{open ? "Conversation" : `# ${shown?.name ?? ""}`}</SheetTitle>
          <SheetDescription>{open ? `Shared conversation · started ${time(open.createdAt)}${open.endedAt ? ` · ended ${time(open.endedAt)}` : ""}` : "Conversations the bot handled in this channel and its threads. Messages it did not respond to are not stored. After the tenant's quiet hours, or once you end one, the next message starts a fresh conversation."}</SheetDescription>
        </SheetHeader>
        <div className="flex-1 space-y-3 overflow-y-auto px-4 pb-4">
          {open ? (
            <>
              <Button variant="ghost" size="sm" onClick={() => setOpen(null)}><ArrowLeft /> All conversations</Button>
              {current(open) && (
                <div className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
                  <p className="min-w-0 flex-1 text-xs text-muted-foreground">The bot reads this conversation with every message here. End it to start the next one fresh; Memory, tasks and files stay.</p>
                  <Button variant="outline" size="sm" disabled={ending} onClick={() => end(open)}>{ending ? "Ending" : "End conversation"}</Button>
                </div>
              )}
              {!messages ? <Skeleton className="h-24" /> : messages.length === 0 ? <p className="text-sm text-muted-foreground">No messages.</p>
                : messages.map((m) => (
                  <Message key={m.id} from={m.role}>
                    <MessageContent className={m.role === "user" ? "whitespace-pre-wrap break-words" : undefined}>
                      {m.role === "user" ? body(m) : <MessageResponse>{m.content}</MessageResponse>}
                    </MessageContent>
                    <span className={`text-xs text-muted-foreground ${m.role === "user" ? "self-end" : ""}`}>{speaker(m)} · {time(m.createdAt)}</span>
                  </Message>
                ))}
            </>
          ) : !list ? <Skeleton className="h-16" />
            : list.length === 0 ? <p className="rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground">No conversations in this channel yet.</p>
            : list.map((c) => (
              <button key={c.id} type="button" onClick={() => setOpen(c)} className="flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-muted">
                <MessageSquare className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 text-sm font-medium"><span className="truncate">Shared conversation</span>{c.endedAt ? <Badge variant="outline">Ended</Badge> : current(c) && <Badge variant="secondary">Current</Badge>}</span>
                  <span className="block text-xs text-muted-foreground">{c.messageCount} messages · {time(c.lastMessageAt ?? c.createdAt)}</span>
                </span>
              </button>
            ))}
        </div>
        {shown && <div className="border-t px-4 py-3 text-xs text-muted-foreground">Channel ID <CopyId value={shown.id} /></div>}
      </SheetContent>
    </Sheet>
  );
}
