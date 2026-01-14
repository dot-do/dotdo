/**
 * @dotdo/triggers - Trigger Registry for Workflow Automation
 *
 * A simple, focused registry for managing triggers.
 * Supports registration, unregistration, lookup, and listing.
 *
 * @example
 * ```typescript
 * import { TriggerRegistry, createTriggerRegistry } from '@dotdo/triggers'
 *
 * const registry = createTriggerRegistry()
 *
 * // Register a trigger
 * registry.register({
 *   id: 'my-webhook',
 *   type: 'webhook',
 *   config: { path: '/webhooks/github' },
 *   handler: async (ctx) => ({ success: true, data: ctx.data }),
 * })
 *
 * // Get trigger by ID
 * const trigger = registry.get('my-webhook')
 *
 * // List all triggers
 * const all = registry.list()
 *
 * // Unregister a trigger
 * registry.unregister('my-webhook')
 * ```
 *
 * @packageDocumentation
 */

// =============================================================================
// Types
// =============================================================================

/** Supported trigger types */
export type TriggerType = 'webhook' | 'polling' | 'schedule' | 'event' | 'manual'

/** Trigger status */
export type TriggerStatus = 'active' | 'inactive' | 'error'

/** Base trigger configuration */
export interface TriggerConfig {
  /** Optional path for webhook triggers */
  path?: string
  /** Optional URL for polling triggers */
  url?: string
  /** Optional interval for polling triggers (ms) */
  intervalMs?: number
  /** Optional cron expression for schedule triggers */
  cron?: string
  /** Optional event name for event triggers */
  eventName?: string
  /** Optional metadata */
  metadata?: Record<string, unknown>
}

/** Trigger context passed to handlers */
export interface TriggerContext<T = unknown> {
  /** Trigger ID */
  triggerId: string
  /** Trigger type */
  triggerType: TriggerType
  /** Timestamp when trigger fired */
  timestamp: number
  /** Trigger data/payload */
  data: T
  /** Optional metadata */
  metadata?: Record<string, unknown>
}

/** Trigger handler result */
export interface TriggerResult<T = unknown> {
  /** Whether the trigger execution was successful */
  success: boolean
  /** Error message if failed */
  error?: string
  /** Result data */
  data?: T
}

/** Trigger handler function */
export type TriggerHandler<T = unknown, R = unknown> = (
  ctx: TriggerContext<T>
) => Promise<TriggerResult<R>> | TriggerResult<R>

/** Trigger definition */
export interface Trigger<T = unknown, R = unknown> {
  /** Unique trigger ID */
  id: string
  /** Trigger type */
  type: TriggerType
  /** Trigger configuration */
  config: TriggerConfig
  /** Whether trigger is enabled */
  enabled?: boolean
  /** Trigger status */
  status?: TriggerStatus
  /** Handler function */
  handler: TriggerHandler<T, R>
  /** Optional description */
  description?: string
  /** Optional tags for filtering */
  tags?: string[]
  /** Creation timestamp */
  createdAt?: number
  /** Last updated timestamp */
  updatedAt?: number
}

/** Options for listing triggers */
export interface ListOptions {
  /** Filter by trigger type */
  type?: TriggerType
  /** Filter by enabled status */
  enabled?: boolean
  /** Filter by status */
  status?: TriggerStatus
  /** Filter by tags (all must match) */
  tags?: string[]
  /** Maximum number of results */
  limit?: number
  /** Offset for pagination */
  offset?: number
}

/** Registry statistics */
export interface RegistryStats {
  /** Total number of triggers */
  total: number
  /** Number of enabled triggers */
  enabled: number
  /** Number of disabled triggers */
  disabled: number
  /** Count by type */
  byType: Record<TriggerType, number>
  /** Count by status */
  byStatus: Record<TriggerStatus, number>
}

// =============================================================================
// TriggerRegistry
// =============================================================================

/**
 * Registry for trigger definitions
 *
 * Provides CRUD operations for triggers with filtering and lookup capabilities.
 */
export class TriggerRegistry<T = unknown, R = unknown> {
  private triggers = new Map<string, Trigger<T, R>>()

  /**
   * Register a trigger
   *
   * @param trigger - The trigger to register
   * @throws Error if a trigger with the same ID already exists
   *
   * @example
   * ```typescript
   * registry.register({
   *   id: 'github-webhook',
   *   type: 'webhook',
   *   config: { path: '/webhooks/github' },
   *   handler: async (ctx) => ({ success: true, data: ctx.data }),
   * })
   * ```
   */
  register(trigger: Trigger<T, R>): void {
    if (this.triggers.has(trigger.id)) {
      throw new Error(`Trigger already registered: ${trigger.id}`)
    }
    const now = Date.now()
    this.triggers.set(trigger.id, {
      ...trigger,
      enabled: trigger.enabled ?? true,
      status: trigger.status ?? 'active',
      createdAt: trigger.createdAt ?? now,
      updatedAt: trigger.updatedAt ?? now,
    })
  }

  /**
   * Unregister a trigger by ID
   *
   * @param id - The trigger ID to unregister
   * @returns true if the trigger was removed, false if it didn't exist
   *
   * @example
   * ```typescript
   * const removed = registry.unregister('github-webhook')
   * ```
   */
  unregister(id: string): boolean {
    return this.triggers.delete(id)
  }

  /**
   * Check if a trigger exists
   *
   * @param id - The trigger ID to check
   * @returns true if the trigger exists
   */
  has(id: string): boolean {
    return this.triggers.has(id)
  }

  /**
   * Get a trigger by ID
   *
   * @param id - The trigger ID
   * @returns The trigger or undefined if not found
   *
   * @example
   * ```typescript
   * const trigger = registry.get('github-webhook')
   * if (trigger) {
   *   console.log(trigger.type) // 'webhook'
   * }
   * ```
   */
  get(id: string): Trigger<T, R> | undefined {
    return this.triggers.get(id)
  }

  /**
   * List all triggers with optional filtering
   *
   * @param options - Optional filter and pagination options
   * @returns Array of triggers matching the criteria
   *
   * @example
   * ```typescript
   * // List all triggers
   * const all = registry.list()
   *
   * // List only enabled webhook triggers
   * const webhooks = registry.list({ type: 'webhook', enabled: true })
   *
   * // Paginate results
   * const page = registry.list({ limit: 10, offset: 20 })
   * ```
   */
  list(options?: ListOptions): Trigger<T, R>[] {
    let results = Array.from(this.triggers.values())

    if (options?.type !== undefined) {
      results = results.filter((t) => t.type === options.type)
    }

    if (options?.enabled !== undefined) {
      results = results.filter((t) => t.enabled === options.enabled)
    }

    if (options?.status !== undefined) {
      results = results.filter((t) => t.status === options.status)
    }

    if (options?.tags !== undefined && options.tags.length > 0) {
      results = results.filter((t) => {
        const triggerTags = t.tags ?? []
        return options.tags!.every((tag) => triggerTags.includes(tag))
      })
    }

    if (options?.offset !== undefined && options.offset > 0) {
      results = results.slice(options.offset)
    }

    if (options?.limit !== undefined && options.limit > 0) {
      results = results.slice(0, options.limit)
    }

    return results
  }

  /**
   * List triggers by type
   *
   * @param type - The trigger type to filter by
   * @returns Array of triggers of the specified type
   */
  listByType(type: TriggerType): Trigger<T, R>[] {
    return this.list({ type })
  }

  /**
   * List only enabled triggers
   *
   * @returns Array of enabled triggers
   */
  listEnabled(): Trigger<T, R>[] {
    return this.list({ enabled: true })
  }

  /**
   * List only disabled triggers
   *
   * @returns Array of disabled triggers
   */
  listDisabled(): Trigger<T, R>[] {
    return this.list({ enabled: false })
  }

  /**
   * Enable a trigger
   *
   * @param id - The trigger ID to enable
   * @returns true if the trigger was enabled, false if not found
   */
  enable(id: string): boolean {
    const trigger = this.triggers.get(id)
    if (trigger) {
      trigger.enabled = true
      trigger.updatedAt = Date.now()
      return true
    }
    return false
  }

  /**
   * Disable a trigger
   *
   * @param id - The trigger ID to disable
   * @returns true if the trigger was disabled, false if not found
   */
  disable(id: string): boolean {
    const trigger = this.triggers.get(id)
    if (trigger) {
      trigger.enabled = false
      trigger.updatedAt = Date.now()
      return true
    }
    return false
  }

  /**
   * Update a trigger's status
   *
   * @param id - The trigger ID
   * @param status - The new status
   * @returns true if updated, false if not found
   */
  setStatus(id: string, status: TriggerStatus): boolean {
    const trigger = this.triggers.get(id)
    if (trigger) {
      trigger.status = status
      trigger.updatedAt = Date.now()
      return true
    }
    return false
  }

  /**
   * Update a trigger's configuration
   *
   * @param id - The trigger ID
   * @param updates - Partial trigger updates
   * @returns The updated trigger or undefined if not found
   */
  update(
    id: string,
    updates: Partial<Omit<Trigger<T, R>, 'id' | 'createdAt'>>
  ): Trigger<T, R> | undefined {
    const trigger = this.triggers.get(id)
    if (!trigger) {
      return undefined
    }

    const updated = {
      ...trigger,
      ...updates,
      id: trigger.id, // Preserve ID
      createdAt: trigger.createdAt, // Preserve createdAt
      updatedAt: Date.now(),
    }

    this.triggers.set(id, updated)
    return updated
  }

  /**
   * Get the total count of triggers
   *
   * @returns Number of registered triggers
   */
  count(): number {
    return this.triggers.size
  }

  /**
   * Get registry statistics
   *
   * @returns Statistics about registered triggers
   */
  stats(): RegistryStats {
    const triggers = Array.from(this.triggers.values())

    const byType: Record<TriggerType, number> = {
      webhook: 0,
      polling: 0,
      schedule: 0,
      event: 0,
      manual: 0,
    }

    const byStatus: Record<TriggerStatus, number> = {
      active: 0,
      inactive: 0,
      error: 0,
    }

    let enabled = 0
    let disabled = 0

    for (const trigger of triggers) {
      byType[trigger.type]++
      byStatus[trigger.status ?? 'active']++
      if (trigger.enabled) {
        enabled++
      } else {
        disabled++
      }
    }

    return {
      total: triggers.length,
      enabled,
      disabled,
      byType,
      byStatus,
    }
  }

  /**
   * Clear all triggers
   */
  clear(): void {
    this.triggers.clear()
  }

  /**
   * Get all trigger IDs
   *
   * @returns Array of all trigger IDs
   */
  ids(): string[] {
    return Array.from(this.triggers.keys())
  }

  /**
   * Execute a trigger's handler
   *
   * @param id - The trigger ID
   * @param data - The data to pass to the handler
   * @returns The handler result or undefined if trigger not found
   */
  async execute(id: string, data: T): Promise<TriggerResult<R> | undefined> {
    const trigger = this.triggers.get(id)
    if (!trigger) {
      return undefined
    }

    if (!trigger.enabled) {
      return {
        success: false,
        error: `Trigger ${id} is disabled`,
      }
    }

    const ctx: TriggerContext<T> = {
      triggerId: id,
      triggerType: trigger.type,
      timestamp: Date.now(),
      data,
      metadata: trigger.config.metadata,
    }

    try {
      return await trigger.handler(ctx)
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a new trigger registry
 *
 * @returns A new TriggerRegistry instance
 *
 * @example
 * ```typescript
 * const registry = createTriggerRegistry()
 *
 * registry.register({
 *   id: 'my-trigger',
 *   type: 'webhook',
 *   config: { path: '/webhook' },
 *   handler: async (ctx) => ({ success: true, data: ctx.data }),
 * })
 * ```
 */
export function createTriggerRegistry<T = unknown, R = unknown>(): TriggerRegistry<T, R> {
  return new TriggerRegistry<T, R>()
}

// =============================================================================
// Default Export
// =============================================================================

export default TriggerRegistry
