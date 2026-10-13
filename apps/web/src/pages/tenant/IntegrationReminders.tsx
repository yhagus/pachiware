import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmAction } from "@/components/ConfirmAction";
import { api, type Guild, type Reminder } from "@/lib/api";
import { useIntegration } from "@/pages/tenant/IntegrationDetail";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** The next post, as the people in that place will see it: wall time in the Reminder's zone, the zone named when it differs from the browser's. */
function nextTime(r: Reminder): string {
  const at = new Date(r.nextAt);
  try {
    const text = at.toLocaleString(undefined, { timeZone: r.timezone, dateStyle: "medium", timeStyle: "short" });
    return r.timezone === Intl.DateTimeFormat().resolvedOptions().timeZone ? text : `${text} (${r.timezone})`;
  } catch { return at.toLocaleString(); }
}

function repeats(r: Reminder): string {
  const at = r.timeOfDay ? ` at ${r.timeOfDay}` : "";
  const until = r.until ? `, until ${new Date(r.until).toLocaleDateString(undefined, { timeZone: r.timezone, dateStyle: "medium" })}` : "";
  if (r.recurrence === "once") return "Once";
  if (r.recurrence === "daily") return `Every day${at}${until}`;
  if (r.recurrence === "weekly") return `Every ${r.weekdays.length ? r.weekdays.map((d) => DAYS[d] ?? d).join(", ") : "week"}${at}${until}`;
  return `Day ${r.dayOfMonth ?? "?"} of every month${at}${until}`;
}

export function IntegrationReminders() {
  const { bot } = useIntegration();
  const [guilds, setGuilds] = useState<Guild[]>([]);
  const [list, setList] = useState<Reminder[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => { api.getBotGuilds(bot.id).then((r) => setGuilds(r.guilds)).catch(() => setGuilds([])); }, [bot.id]);
  const load = useCallback(() => api.listReminders(bot.id).then((r) => { setList(r.reminders); setError(null); }).catch((e: Error) => setError(e.message)), [bot.id]);
  useEffect(() => { void load(); const t = setInterval(() => !document.hidden && void load(), 15000); return () => clearInterval(t); }, [load]);

  const where = (r: Reminder) => {
    const guild = guilds.find((g) => g.id === r.guildId), channel = guild?.channels.find((c) => c.id === r.channelId);
    if (!r.guildId) return "Direct message";
    return `${guild?.name ?? r.guildId} · ${channel ? `#${channel.name}` : r.channelId}`;
  };
  const cancel = async (r: Reminder) => {
    setBusy(r.id);
    try { await api.cancelReminder(bot.id, r.id); setList((l) => l?.filter((x) => x.id !== r.id) ?? l); toast.success("Reminder cancelled"); }
    catch (e) { toast.error(`Could not cancel the Reminder: ${(e as Error).message}`); }
    finally { setBusy(null); }
  };

  return (
    <Card className="py-0">
      <CardContent className="px-0">
        <div className="p-4 pb-2">
          <h3 className="font-medium">Reminders</h3>
          <p className="text-xs text-muted-foreground">What {bot.name} will post and when. People set these from chat; a cancelled one stops without a message to its owner.</p>
        </div>
        {error ? (
          <div role="alert" className="space-y-3 border-t p-4 text-sm">
            <p>Could not load the Reminders: {error}</p>
            <Button variant="outline" size="sm" onClick={() => void load()}>Try again</Button>
          </div>
        ) : !list ? (
          <div role="status" className="space-y-3 border-t p-4"><p className="sr-only">Loading Reminders</p>{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
        ) : list.length === 0 ? (
          <p className="border-t px-4 py-10 text-center text-sm text-muted-foreground">No active Reminders. One appears here when someone asks {bot.name} in chat to remind them.</p>
        ) : (
          <ul className="divide-y border-t px-4">
            {list.map((r) => (
              <li key={r.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:gap-3">
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="break-words text-sm font-medium">{r.text}</p>
                  <dl className="grid gap-x-4 gap-y-0.5 text-xs text-muted-foreground sm:grid-cols-[auto_1fr]">
                    <dt>Next</dt><dd className="text-foreground">{nextTime(r)}</dd>
                    <dt>Repeats</dt><dd>{repeats(r)}</dd>
                    <dt>Owner</dt><dd>{r.ownerName ?? r.ownerId ?? "Unknown"}{r.mentions.length > 0 && `, pinging ${r.mentions.length} more`}</dd>
                    <dt>Where</dt><dd className="break-all">{where(r)}</dd>
                  </dl>
                </div>
                <ConfirmAction
                  trigger={<Button variant="ghost" size="sm" className="h-11 shrink-0 self-start sm:h-8" disabled={busy === r.id} aria-label={`Cancel the Reminder "${r.text}"`}>Cancel</Button>}
                  title="Cancel this Reminder?" description={`"${r.text}" will not be posted again, and ${r.ownerName ?? "its owner"} is not told. They can set a new one from chat.`}
                  confirmLabel="Cancel the Reminder" danger onConfirm={() => void cancel(r)} />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
