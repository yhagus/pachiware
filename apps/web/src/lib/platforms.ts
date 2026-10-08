import type { ComponentType } from "react";
import { GitBranch, Plug, Server, type LucideIcon } from "lucide-react";
import { DiscordIcon } from "@/components/DiscordIcon";
import type { Bot, BotInput } from "@/lib/api";
import { label } from "@/lib/utils";

// One entry per integration. Adding a platform = add an entry here (plus backend support); the gallery, filter and form pick it up.
export interface Field { key: "token" | "clientId" | "guildIds"; label: string; secret?: boolean; list?: boolean; placeholder?: string }
export interface Section { path: string; label: string; icon: LucideIcon }
export interface Platform { id: string; name: string; description: string; icon: ComponentType<{ className?: string }>; scopeLabel: string; fields: Field[]; sections: Section[] }

export const PLATFORMS: Platform[] = [
  {
    id: "discord", name: "Discord", description: "Connect a Discord bot to servers and channels.", icon: DiscordIcon, scopeLabel: "servers",
    sections: [{ path: "servers", label: "Servers", icon: Server }, { path: "git-access", label: "Git access", icon: GitBranch }],
    fields: [
      { key: "token", label: "Bot token", secret: true },
      { key: "clientId", label: "Client ID" },
      { key: "guildIds", label: "Server (guild) IDs, comma-separated", list: true, placeholder: "Empty = all servers" },
    ],
  },
];

export const platformOf = (id: string): Platform =>
  PLATFORMS.find((p) => p.id === id) ?? { id, name: label(id), description: "", icon: Plug, scopeLabel: "scopes", fields: [], sections: [] };

export const emptyValues = (p: Platform) => Object.fromEntries(p.fields.map((f) => [f.key, ""]));
export const valuesOf = (p: Platform, b: Bot) =>
  Object.fromEntries(p.fields.map((f) => [f.key, f.secret ? "" : f.list ? ((b as any)[f.key] as string[]).join(", ") : String((b as any)[f.key] ?? "")]));
export const toInput = (p: Platform, v: Record<string, string>): BotInput =>
  Object.fromEntries(p.fields.flatMap((f) => {
    const x = v[f.key]?.trim() ?? "";
    if (f.secret) return x ? [[f.key, x]] : [];
    return [[f.key, f.list ? x.split(",").map((s) => s.trim()).filter(Boolean) : x || undefined]];
  }));
