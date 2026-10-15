/**
 * Domain types and the repository interface for task rows: the old tasks table, from before a Task became a file
 * in the Workspace. Nothing writes new rows in production; the one-off export reads them into task files.
 */

export type TaskRow = {
  id: string;
  tenantId: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  /** Plain text as it was typed, not an Assignee. */
  assignedTo: string | null;
  discordChannelId: string | null;
  discordGuildId: string | null;
  metadata: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
};

export type NewTaskRow = {
  tenantId: string;
  title: string;
  description?: string | null;
  status?: string;
  priority?: string;
  assignedTo?: string | null;
  discordChannelId?: string | null;
  discordGuildId?: string | null;
  metadata?: Record<string, any>;
};

export interface TaskRowRepository {
  create(input: NewTaskRow): Promise<TaskRow>;
  /** Every row, or one tenant's, oldest first. */
  list(tenantId?: string): Promise<TaskRow[]>;
}
