/** Domain types and the repository interface for schedules: Reminders and the Digest. Every engine implements it. */

export type ScheduleKind = "reminder" | "digest";
export type ScheduleRecurrence = "once" | "daily" | "weekly" | "monthly";
export type ScheduleStatus = "active" | "cancelled" | "done";

/** One Reminder or one channel's Digest, and when it posts next. */
export type Schedule = {
  id: string;
  tenantId: string;
  botId: string;
  kind: ScheduleKind;
  guildId: string | null;
  channelId: string;
  /** The person who set a Reminder; a Digest has none. */
  ownerId: string | null;
  ownerName: string | null;
  text: string;
  withTasks: boolean;
  mentions: string[];
  recurrence: ScheduleRecurrence;
  /** 0 = Sunday. */
  weekdays: number[];
  dayOfMonth: number | null;
  /** "HH:MM" in `timezone`. */
  timeOfDay: string | null;
  timezone: string;
  until: Date | null;
  nextAt: Date;
  lastFiredAt: Date | null;
  status: ScheduleStatus;
  /** Posting failures since the last success. */
  attempts: number;
  error: string | null;
  createdAt: Date;
};

export type NewSchedule = {
  tenantId: string;
  /** Must be a bot of the same tenant. */
  botId: string;
  kind?: ScheduleKind;
  guildId?: string | null;
  channelId: string;
  ownerId?: string | null;
  ownerName?: string | null;
  text?: string;
  withTasks?: boolean;
  mentions?: string[];
  recurrence?: ScheduleRecurrence;
  weekdays?: number[];
  dayOfMonth?: number | null;
  timeOfDay?: string | null;
  timezone: string;
  until?: Date | null;
  nextAt: Date;
  status?: ScheduleStatus;
};

export type ScheduleUpdate = Partial<Pick<Schedule, "timeOfDay" | "timezone" | "nextAt" | "lastFiredAt" | "status" | "attempts" | "error">>;

/** Every field given must match. */
export type ScheduleFilter = {
  id?: string;
  tenantId?: string;
  botId?: string;
  kind?: ScheduleKind;
  status?: ScheduleStatus;
  guildId?: string;
  ownerId?: string;
  /** Owned by `ownerId`, or, when `guildId` is given, posting in that guild. */
  visibleTo?: { ownerId: string; guildId?: string };
};

export interface ScheduleRepository {
  /** A schedule whose bot belongs to another tenant rejects. */
  create(input: NewSchedule): Promise<Schedule>;
  get(id: string): Promise<Schedule | null>;
  /** Matching schedules, soonest `nextAt` first, then by id. */
  list(filter?: ScheduleFilter): Promise<Schedule[]>;
  count(filter?: ScheduleFilter): Promise<number>;
  /** Active schedules whose `nextAt` is at or before `at`, soonest first. */
  due(at: Date): Promise<Schedule[]>;
  /** Null when there is no such schedule. */
  update(id: string, changes: ScheduleUpdate): Promise<Schedule | null>;
}
