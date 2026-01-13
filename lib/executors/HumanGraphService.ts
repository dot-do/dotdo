/**
 * HumanGraphService
 *
 * Graph-based persistence layer for HumanFunctionExecutor.
 * Replaces DO storage.put/get with graph Things and Relationships.
 *
 * ## Thing Types:
 *
 * - **HumanTask**: A human task request
 *   - typeName: 'HumanTask'
 *   - data: { status, prompt, channel, timeout, error?, messageId?, notificationSent? }
 *
 * - **HumanNotification**: A notification sent for a task
 *   - typeName: 'HumanNotification'
 *   - data: { messageId, channel, sentAt }
 *
 * - **HumanAudit**: An audit log entry for a task
 *   - typeName: 'HumanAudit'
 *   - data: { action, userId, comment?, timestamp }
 *
 * ## Relationships:
 *
 * - HumanTask `sentVia` HumanNotification
 * - HumanTask `auditedBy` HumanAudit
 * - Human `requested` HumanTask (requestedBy relationship)
 * - Human `completed` HumanTask (completedBy relationship)
 *
 * @see dotdo-r1go4 - [REFACTOR] HumanFunctionExecutor: Use Graph for state persistence
 */

import type {
  GraphStore,
  GraphThing,
  GraphRelationship,
  CreateRelationshipInput,
} from '../../db/graph/types'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/** Task status */
export type HumanTaskStatus = 'pending' | 'completed' | 'failed' | 'timeout' | 'cancelled'

/** HumanTask Thing data */
export interface HumanTaskData {
  status: HumanTaskStatus
  prompt: string
  channel: string
  timeout: number
  error?: string
  messageId?: string
  notificationSent?: boolean
  input?: unknown
}

/** HumanNotification Thing data */
export interface HumanNotificationData {
  messageId: string
  channel: string
  sentAt: number
}

/** HumanAudit Thing data */
export interface HumanAuditData {
  action: string
  userId: string
  comment?: string
  reason?: string
  timestamp: number
}

/** Options for creating a HumanTask */
export interface CreateHumanTaskOptions {
  taskId: string
  prompt: string
  channel: string
  timeout: number
  input?: unknown
}

/** Options for recording an audit entry */
export interface RecordAuditOptions {
  taskId: string
  action: string
  userId: string
  comment?: string
  reason?: string
}

/** Options for querying tasks */
export interface QueryTasksOptions {
  status?: HumanTaskStatus
  channel?: string
  limit?: number
  includeDeleted?: boolean
}

// ============================================================================
// CONSTANTS
// ============================================================================

/** Type IDs for Human-related Things */
export const HUMAN_TYPE_IDS = {
  HumanTask: 100,
  HumanNotification: 101,
  HumanAudit: 102,
} as const

/** Verbs for Human-related Relationships */
export const HUMAN_VERBS = {
  sentVia: 'sentVia',
  auditedBy: 'auditedBy',
  requested: 'requested',
  completed: 'completed',
} as const

// ============================================================================
// HUMAN GRAPH SERVICE
// ============================================================================

/**
 * HumanGraphService provides graph-based persistence for HumanFunctionExecutor.
 *
 * This replaces the DO storage.put/get pattern with a unified graph model
 * where tasks, notifications, and audit entries are stored as Things
 * with Relationships connecting them.
 *
 * @example
 * ```typescript
 * const service = new HumanGraphService(graphStore)
 *
 * // Create a task
 * const task = await service.createTask({
 *   taskId: 'task-123',
 *   prompt: 'Approve this request',
 *   channel: 'slack',
 *   timeout: 60000,
 * })
 *
 * // Record notification
 * await service.recordNotification('task-123', 'slack-msg-456', 'slack')
 *
 * // Update task status
 * await service.updateTaskStatus('task-123', 'completed')
 *
 * // Record audit
 * await service.recordAudit({
 *   taskId: 'task-123',
 *   action: 'approve',
 *   userId: 'U123',
 *   comment: 'Looks good!',
 * })
 * ```
 */
export class HumanGraphService {
  constructor(private graphStore: GraphStore) {}

  // ==========================================================================
  // TASK OPERATIONS
  // ==========================================================================

  /**
   * Create a new HumanTask Thing.
   *
   * @param options - Task creation options
   * @returns The created GraphThing
   */
  async createTask(options: CreateHumanTaskOptions): Promise<GraphThing> {
    const data: HumanTaskData = {
      status: 'pending',
      prompt: options.prompt,
      channel: options.channel,
      timeout: options.timeout,
      input: options.input,
    }

    return this.graphStore.createThing({
      id: `human-task:${options.taskId}`,
      typeId: HUMAN_TYPE_IDS.HumanTask,
      typeName: 'HumanTask',
      data,
    })
  }

  /**
   * Get a HumanTask by task ID.
   *
   * @param taskId - The task ID (without prefix)
   * @returns The task Thing or null if not found
   */
  async getTask(taskId: string): Promise<GraphThing | null> {
    return this.graphStore.getThing(`human-task:${taskId}`)
  }

  /**
   * Update a task's status.
   *
   * @param taskId - The task ID
   * @param status - The new status
   * @param additionalData - Additional data to merge (e.g., error message)
   * @returns The updated task or null if not found
   */
  async updateTaskStatus(
    taskId: string,
    status: HumanTaskStatus,
    additionalData?: Partial<HumanTaskData>
  ): Promise<GraphThing | null> {
    const task = await this.getTask(taskId)
    if (!task) {
      return null
    }

    const currentData = (task.data ?? {}) as HumanTaskData
    const updatedData: HumanTaskData = {
      ...currentData,
      status,
      ...additionalData,
    }

    return this.graphStore.updateThing(`human-task:${taskId}`, {
      data: updatedData,
    })
  }

  /**
   * Mark a task as failed with an error message.
   *
   * @param taskId - The task ID
   * @param error - The error message
   * @returns The updated task or null
   */
  async failTask(taskId: string, error: string): Promise<GraphThing | null> {
    return this.updateTaskStatus(taskId, 'failed', { error })
  }

  /**
   * Mark a task as timed out.
   *
   * @param taskId - The task ID
   * @param notificationSent - Whether a notification was sent
   * @param messageId - The message ID if notification was sent
   * @returns The updated task or null
   */
  async timeoutTask(
    taskId: string,
    notificationSent: boolean,
    messageId?: string
  ): Promise<GraphThing | null> {
    return this.updateTaskStatus(taskId, 'timeout', {
      notificationSent,
      messageId,
    })
  }

  /**
   * Query tasks by status or channel.
   *
   * @param options - Query options
   * @returns Array of matching tasks
   */
  async queryTasks(options: QueryTasksOptions = {}): Promise<GraphThing[]> {
    const tasks = await this.graphStore.getThingsByType({
      typeName: 'HumanTask',
      limit: options.limit,
      includeDeleted: options.includeDeleted,
    })

    // Filter by status and channel in-memory (graph store doesn't support data queries)
    return tasks.filter((task) => {
      const data = task.data as HumanTaskData | null
      if (!data) return false

      if (options.status && data.status !== options.status) return false
      if (options.channel && data.channel !== options.channel) return false

      return true
    })
  }

  // ==========================================================================
  // NOTIFICATION OPERATIONS
  // ==========================================================================

  /**
   * Record a notification sent for a task.
   *
   * Creates a HumanNotification Thing and links it to the task via `sentVia` relationship.
   *
   * @param taskId - The task ID
   * @param messageId - The notification message ID
   * @param channel - The channel used
   * @returns The created notification Thing
   */
  async recordNotification(
    taskId: string,
    messageId: string,
    channel: string
  ): Promise<GraphThing> {
    const notificationId = `human-notification:${taskId}:${messageId}`

    const data: HumanNotificationData = {
      messageId,
      channel,
      sentAt: Date.now(),
    }

    const notification = await this.graphStore.createThing({
      id: notificationId,
      typeId: HUMAN_TYPE_IDS.HumanNotification,
      typeName: 'HumanNotification',
      data,
    })

    // Create relationship: Task --sentVia--> Notification
    await this.graphStore.createRelationship({
      id: `rel:${taskId}:sentVia:${messageId}`,
      verb: HUMAN_VERBS.sentVia,
      from: `human-task:${taskId}`,
      to: notificationId,
    })

    return notification
  }

  /**
   * Get all notifications for a task.
   *
   * @param taskId - The task ID
   * @returns Array of notification Things
   */
  async getNotifications(taskId: string): Promise<GraphThing[]> {
    const relationships = await this.graphStore.queryRelationshipsFrom(
      `human-task:${taskId}`,
      { verb: HUMAN_VERBS.sentVia }
    )

    const notifications: GraphThing[] = []
    for (const rel of relationships) {
      const notification = await this.graphStore.getThing(rel.to)
      if (notification) {
        notifications.push(notification)
      }
    }

    return notifications
  }

  // ==========================================================================
  // AUDIT OPERATIONS
  // ==========================================================================

  /**
   * Record an audit entry for a task.
   *
   * Creates a HumanAudit Thing and links it to the task via `auditedBy` relationship.
   *
   * @param options - Audit options
   * @returns The created audit Thing
   */
  async recordAudit(options: RecordAuditOptions): Promise<GraphThing> {
    const timestamp = Date.now()
    const auditId = `human-audit:${options.taskId}:${timestamp}`

    const data: HumanAuditData = {
      action: options.action,
      userId: options.userId,
      comment: options.comment,
      reason: options.reason,
      timestamp,
    }

    const audit = await this.graphStore.createThing({
      id: auditId,
      typeId: HUMAN_TYPE_IDS.HumanAudit,
      typeName: 'HumanAudit',
      data,
    })

    // Create relationship: Task --auditedBy--> Audit
    await this.graphStore.createRelationship({
      id: `rel:${options.taskId}:auditedBy:${timestamp}`,
      verb: HUMAN_VERBS.auditedBy,
      from: `human-task:${options.taskId}`,
      to: auditId,
    })

    return audit
  }

  /**
   * Get all audit entries for a task.
   *
   * @param taskId - The task ID
   * @returns Array of audit Things, sorted by timestamp ascending
   */
  async getAuditLog(taskId: string): Promise<GraphThing[]> {
    const relationships = await this.graphStore.queryRelationshipsFrom(
      `human-task:${taskId}`,
      { verb: HUMAN_VERBS.auditedBy }
    )

    const audits: GraphThing[] = []
    for (const rel of relationships) {
      const audit = await this.graphStore.getThing(rel.to)
      if (audit) {
        audits.push(audit)
      }
    }

    // Sort by timestamp ascending
    return audits.sort((a, b) => {
      const aData = a.data as HumanAuditData | null
      const bData = b.data as HumanAuditData | null
      return (aData?.timestamp ?? 0) - (bData?.timestamp ?? 0)
    })
  }

  // ==========================================================================
  // CONVENIENCE METHODS (replacing DO storage patterns)
  // ==========================================================================

  /**
   * Legacy compatibility: Get value by key pattern.
   *
   * Maps the old DO storage key patterns to graph queries:
   * - `task:${taskId}` -> getTask(taskId)
   * - `notification:${taskId}` -> getNotifications(taskId)[0]
   * - `audit:${taskId}` -> getAuditLog(taskId)
   *
   * @param key - The storage key
   * @returns The stored value or null
   */
  async get<T>(key: string): Promise<T | null> {
    const [prefix, ...rest] = key.split(':')
    const id = rest.join(':')

    switch (prefix) {
      case 'task': {
        const task = await this.getTask(id)
        return task?.data as T | null
      }
      case 'notification': {
        const notifications = await this.getNotifications(id)
        if (notifications.length > 0) {
          return notifications[0]!.data as T
        }
        return null
      }
      case 'audit': {
        const audits = await this.getAuditLog(id)
        if (audits.length > 0) {
          // Return the latest audit entry
          return audits[audits.length - 1]!.data as T
        }
        return null
      }
      default:
        return null
    }
  }

  /**
   * Legacy compatibility: Put value by key pattern.
   *
   * Maps the old DO storage key patterns to graph operations:
   * - `task:${taskId}` -> updateTaskStatus(taskId, value.status, value)
   * - `notification:${taskId}` -> recordNotification(taskId, value.messageId, value.channel)
   * - `audit:${taskId}` -> recordAudit(taskId, value)
   *
   * @param key - The storage key
   * @param value - The value to store
   */
  async put(key: string, value: unknown): Promise<void> {
    const [prefix, ...rest] = key.split(':')
    const id = rest.join(':')
    const data = value as Record<string, unknown>

    switch (prefix) {
      case 'task': {
        const task = await this.getTask(id)
        if (task) {
          await this.updateTaskStatus(
            id,
            (data.status as HumanTaskStatus) ?? 'pending',
            data as Partial<HumanTaskData>
          )
        }
        break
      }
      case 'notification': {
        await this.recordNotification(
          id,
          data.messageId as string,
          data.channel as string
        )
        break
      }
      case 'audit': {
        await this.recordAudit({
          taskId: id,
          action: data.action as string,
          userId: data.userId as string,
          comment: data.comment as string | undefined,
          reason: data.reason as string | undefined,
        })
        break
      }
    }
  }

  /**
   * Legacy compatibility: Delete by key pattern.
   *
   * @param key - The storage key
   * @returns Whether the deletion was successful
   */
  async delete(key: string): Promise<boolean> {
    const [prefix, ...rest] = key.split(':')
    const id = rest.join(':')

    switch (prefix) {
      case 'task': {
        const result = await this.graphStore.deleteThing(`human-task:${id}`)
        return result !== null
      }
      default:
        return false
    }
  }
}

export default HumanGraphService
