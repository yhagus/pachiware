import { useEffect, useState } from "react";
import { ArrowLeft, MessageSquare } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { CopyId } from "@/components/CopyId";
import { api, type ChatMessage, type Conversation, type GuildChannel } from "@/lib/api";

// Guild turns are stored as "Name: text"; older rows have no prefix.
const speaker = (m: ChatMessage) => (m.role === "user" ? m.content?.match(/^([^:\n]{1,40}): /)?.[1] ?? "User" : "Bot");
const body = (m: ChatMessage) => (m.role === "user" ? m.content?.replace(/^[^:\n]{1,40}: /, "") : m.content);
const time = (s: string | null) => (s ? new Date(s).toLocaleString() : "–");

export function ChannelConversations({ botId, channel, onClose }: { botId: string; channel: GuildChannel | null; onClose: () => void }) {
  const [list, setList] = useState<Conversation[] | null>(null);
  const [open, setOpen] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);

  useEffect(() => {
    setList(null); setOpen(null);
    if (!channel) return;
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
          <SheetTitle>{open ? "Conversation" : `# ${channel?.name ?? ""}`}</SheetTitle>
          <SheetDescription>{open ? `Shared conversation · started ${time(open.createdAt)}` : "Conversations the bot handled in this channel. Messages it did not respond to are not stored."}</SheetDescription>
        </SheetHeader>
        <div className="flex-1 space-y-3 overflow-y-auto px-4 pb-4">
          {open ? (
            <>
              <Button variant="ghost" size="sm" onClick={() => setOpen(null)}><ArrowLeft /> All conversations</Button>
              {!messages ? <Skeleton className="h-24" /> : messages.length === 0 ? <p className="text-sm text-muted-foreground">No messages.</p>
                : messages.map((m) => (
                  <div key={m.id} className={`flex flex-col ${m.role === "user" ? "items-end" : "items-start"}`}>
                    <div className={`max-w-[85%] whitespace-pre-wrap break-words rounded-lg px-3 py-2 text-sm ${m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"}`}>{body(m)}</div>
                    <span className="mt-1 text-xs text-muted-foreground">{speaker(m)} · {time(m.createdAt)}</span>
                  </div>
                ))}
            </>
          ) : !list ? <Skeleton className="h-16" />
            : list.length === 0 ? <p className="rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground">No conversations in this channel yet.</p>
            : list.map((c) => (
              <button key={c.id} type="button" onClick={() => setOpen(c)} className="flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-muted">
                <MessageSquare className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">Shared conversation</span>
                  <span className="block text-xs text-muted-foreground">{c.messageCount} messages · {time(c.lastMessageAt ?? c.createdAt)}</span>
                </span>
              </button>
            ))}
        </div>
        {channel && <div className="border-t px-4 py-3 text-xs text-muted-foreground">Channel ID <CopyId value={channel.id} /></div>}
      </SheetContent>
    </Sheet>
  );
}
