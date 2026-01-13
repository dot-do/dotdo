/**
 * @dotdo/salesforce - Apex Trigger Simulation
 *
 * Simulates Salesforce Apex triggers for edge-native development.
 * Provides before/after triggers for insert, update, delete, and undelete operations.
 *
 * @example
 * ```typescript
 * import { ApexTrigger, TriggerManager, createTriggerContext } from '@dotdo/salesforce'
 *
 * const trigger = new ApexTrigger({
 *   name: 'AccountTrigger',
 *   object: 'Account',
 *   events: ['before_insert', 'after_insert'],
 * })
 *
 * trigger.setHandler((context) => {
 *   if (context.isBefore && context.isInsert) {
 *     for (const account of context.new!) {
 *       account.Rating = account.Rating || 'Cold'
 *     }
 *   }
 * })
 *
 * const manager = new TriggerManager()
 * manager.registerTrigger(trigger)
 * await manager.fireInsert('Account', records)
 * ```
 *
 * @module @dotdo/salesforce/triggers
 */

import type { SObject } from './types'

// =============================================================================
// Types
// =============================================================================

/**
 * Trigger operation types matching Salesforce Apex trigger events
 */
export type TriggerOperation = 'insert' | 'update' | 'delete' | 'undelete'

/**
 * Trigger timing - before or after DML operation
 */
export type TriggerTiming = 'before' | 'after'

/**
 * Trigger event combining timing and operation
 */
export type TriggerEvent = `${TriggerTiming}_${TriggerOperation}`

/**
 * Trigger context variables available in Apex triggers
 * @see https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_triggers_context_variables.htm
 */
export interface TriggerContext<T extends SObject = SObject> {
  /** True if fired due to insert operation */
  isInsert: boolean
  /** True if fired due to update operation */
  isUpdate: boolean
  /** True if fired due to delete operation */
  isDelete: boolean
  /** True if fired due to undelete operation */
  isUndelete: boolean
  /** True if before trigger */
  isBefore: boolean
  /** True if after trigger */
  isAfter: boolean
  /** True if trigger was fired from API/Apex */
  isExecuting: boolean
  /** List of new records (available in insert/update triggers) */
  new: T[] | null
  /** Map of new records by ID (available in before update, after insert, after update) */
  newMap: Map<string, T> | null
  /** List of old records (available in update/delete triggers) */
  old: T[] | null
  /** Map of old records by ID (available in update/delete triggers) */
  oldMap: Map<string, T> | null
  /** Number of records in trigger invocation */
  size: number
  /** DML operation that fired the trigger */
  operationType: TriggerOperation
}

/**
 * Trigger handler function signature
 */
export type TriggerHandler<T extends SObject = SObject> = (context: TriggerContext<T>) => void | Promise<void>

/**
 * Apex trigger configuration
 */
export interface ApexTriggerConfig {
  name: string
  object: string
  events: TriggerEvent[]
  active?: boolean
  order?: number
}

/**
 * Apex trigger execution result
 */
export interface TriggerExecutionResult {
  triggerName: string
  event: TriggerEvent
  success: boolean
  recordsProcessed: number
  error?: string
  durationMs: number
}

// =============================================================================
// ApexTrigger Class
// =============================================================================

/**
 * Represents a Salesforce Apex trigger
 */
export class ApexTrigger<T extends SObject = SObject> {
  readonly name: string
  readonly object: string
  readonly events: TriggerEvent[]
  active: boolean
  order: number
  handler: TriggerHandler<T> | null = null

  constructor(config: ApexTriggerConfig) {
    this.name = config.name
    this.object = config.object
    this.events = config.events
    this.active = config.active ?? true
    this.order = config.order ?? 0
  }

  /**
   * Set the handler function for this trigger
   */
  setHandler(handler: TriggerHandler<T>): void {
    this.handler = handler
  }

  /**
   * Check if this trigger applies to an object type
   */
  appliesTo(objectType: string): boolean
  appliesTo(objectType: string, event: TriggerEvent): boolean
  appliesTo(objectType: string, event?: TriggerEvent): boolean {
    if (!this.active) {
      return false
    }

    const objectMatch = this.object.toLowerCase() === objectType.toLowerCase()

    if (event === undefined) {
      return objectMatch
    }

    return objectMatch && this.events.includes(event)
  }

  /**
   * Fire the trigger with the given context
   */
  async fire(event: TriggerEvent, context: TriggerContext<T>): Promise<TriggerExecutionResult> {
    const startTime = performance.now()

    const result: TriggerExecutionResult = {
      triggerName: this.name,
      event,
      success: true,
      recordsProcessed: context.size,
      durationMs: 0,
    }

    if (!this.handler) {
      result.durationMs = performance.now() - startTime
      return result
    }

    try {
      await Promise.resolve(this.handler(context))
    } catch (error) {
      result.success = false
      result.error = error instanceof Error ? error.message : String(error)
    }

    result.durationMs = performance.now() - startTime
    return result
  }
}

// =============================================================================
// TriggerManager Class
// =============================================================================

/**
 * Manages Apex triggers and fires them during DML operations
 */
export class TriggerManager {
  private triggers: Map<string, ApexTrigger> = new Map()

  /**
   * Register a trigger
   */
  registerTrigger(trigger: ApexTrigger): void {
    this.triggers.set(trigger.name, trigger)
  }

  /**
   * Unregister a trigger
   */
  unregisterTrigger(triggerName: string): boolean {
    return this.triggers.delete(triggerName)
  }

  /**
   * Get a trigger by name
   */
  getTrigger(triggerName: string): ApexTrigger | undefined {
    return this.triggers.get(triggerName)
  }

  /**
   * List all triggers, optionally filtered by object type
   */
  listTriggers(objectType?: string): ApexTrigger[] {
    const triggers = Array.from(this.triggers.values())

    if (objectType === undefined) {
      return triggers
    }

    return triggers.filter((t) => t.appliesTo(objectType))
  }

  /**
   * Fire insert triggers
   */
  async fireInsert(objectType: string, records: SObject[]): Promise<TriggerExecutionResult[]> {
    if (records.length === 0) {
      return []
    }

    const results: TriggerExecutionResult[] = []

    // Fire before_insert triggers
    const beforeTriggers = this.getTriggersForEvent(objectType, 'before_insert')
    for (const trigger of beforeTriggers) {
      const context = createTriggerContext('insert', 'before', records)
      const result = await trigger.fire('before_insert', context)
      results.push(result)

      if (!result.success) {
        // Stop on before trigger failure
        return results
      }
    }

    // Fire after_insert triggers
    const afterTriggers = this.getTriggersForEvent(objectType, 'after_insert')
    for (const trigger of afterTriggers) {
      const context = createTriggerContext('insert', 'after', records)
      const result = await trigger.fire('after_insert', context)
      results.push(result)

      if (!result.success) {
        return results
      }
    }

    return results
  }

  /**
   * Fire update triggers
   */
  async fireUpdate(
    objectType: string,
    newRecords: SObject[],
    oldRecords: SObject[]
  ): Promise<TriggerExecutionResult[]> {
    if (newRecords.length === 0) {
      return []
    }

    const results: TriggerExecutionResult[] = []

    // Fire before_update triggers
    const beforeTriggers = this.getTriggersForEvent(objectType, 'before_update')
    for (const trigger of beforeTriggers) {
      const context = createTriggerContext('update', 'before', newRecords, oldRecords)
      const result = await trigger.fire('before_update', context)
      results.push(result)

      if (!result.success) {
        return results
      }
    }

    // Fire after_update triggers
    const afterTriggers = this.getTriggersForEvent(objectType, 'after_update')
    for (const trigger of afterTriggers) {
      const context = createTriggerContext('update', 'after', newRecords, oldRecords)
      const result = await trigger.fire('after_update', context)
      results.push(result)

      if (!result.success) {
        return results
      }
    }

    return results
  }

  /**
   * Fire delete triggers
   */
  async fireDelete(objectType: string, records: SObject[]): Promise<TriggerExecutionResult[]> {
    if (records.length === 0) {
      return []
    }

    const results: TriggerExecutionResult[] = []

    // Fire before_delete triggers
    const beforeTriggers = this.getTriggersForEvent(objectType, 'before_delete')
    for (const trigger of beforeTriggers) {
      const context = createTriggerContext('delete', 'before', undefined, records)
      const result = await trigger.fire('before_delete', context)
      results.push(result)

      if (!result.success) {
        return results
      }
    }

    // Fire after_delete triggers
    const afterTriggers = this.getTriggersForEvent(objectType, 'after_delete')
    for (const trigger of afterTriggers) {
      const context = createTriggerContext('delete', 'after', undefined, records)
      const result = await trigger.fire('after_delete', context)
      results.push(result)

      if (!result.success) {
        return results
      }
    }

    return results
  }

  /**
   * Fire undelete triggers
   */
  async fireUndelete(objectType: string, records: SObject[]): Promise<TriggerExecutionResult[]> {
    if (records.length === 0) {
      return []
    }

    const results: TriggerExecutionResult[] = []

    // Fire before_undelete triggers
    const beforeTriggers = this.getTriggersForEvent(objectType, 'before_undelete')
    for (const trigger of beforeTriggers) {
      const context = createTriggerContext('undelete', 'before', records)
      const result = await trigger.fire('before_undelete', context)
      results.push(result)

      if (!result.success) {
        return results
      }
    }

    // Fire after_undelete triggers
    const afterTriggers = this.getTriggersForEvent(objectType, 'after_undelete')
    for (const trigger of afterTriggers) {
      const context = createTriggerContext('undelete', 'after', records)
      const result = await trigger.fire('after_undelete', context)
      results.push(result)

      if (!result.success) {
        return results
      }
    }

    return results
  }

  /**
   * Clear all registered triggers
   */
  clear(): void {
    this.triggers.clear()
  }

  /**
   * Get triggers for a specific event, sorted by order
   */
  private getTriggersForEvent(objectType: string, event: TriggerEvent): ApexTrigger[] {
    return Array.from(this.triggers.values())
      .filter((t) => t.appliesTo(objectType, event))
      .sort((a, b) => a.order - b.order)
  }
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Create a trigger context for the given operation and timing
 */
export function createTriggerContext<T extends SObject>(
  operation: TriggerOperation,
  timing: TriggerTiming,
  newRecords?: T[],
  oldRecords?: T[]
): TriggerContext<T> {
  const isAfter = timing === 'after'
  const isBefore = timing === 'before'

  // Build newMap if we have new records with IDs
  let newMap: Map<string, T> | null = null
  if (newRecords && newRecords.length > 0) {
    // In before insert, records don't have IDs yet
    const hasIds = newRecords.every((r) => r.Id !== undefined)

    // For after triggers and before update, we have IDs
    if (hasIds && (isAfter || operation === 'update')) {
      newMap = new Map(newRecords.map((r) => [r.Id!, r]))
    }
  }

  // Build oldMap if we have old records
  let oldMap: Map<string, T> | null = null
  if (oldRecords && oldRecords.length > 0) {
    oldMap = new Map(oldRecords.map((r) => [r.Id!, r]))
  }

  // Freeze records in after triggers (read-only)
  let processedNewRecords: T[] | null = null
  let processedOldRecords: T[] | null = null

  if (newRecords) {
    if (isAfter) {
      processedNewRecords = newRecords.map((r) => Object.freeze({ ...r }) as T)
    } else {
      processedNewRecords = newRecords
    }
  }

  if (oldRecords) {
    if (isAfter) {
      processedOldRecords = oldRecords.map((r) => Object.freeze({ ...r }) as T)
    } else {
      processedOldRecords = oldRecords
    }
  }

  // Determine what should be present based on operation type
  let finalNew: T[] | null = null
  let finalOld: T[] | null = null

  switch (operation) {
    case 'insert':
    case 'undelete':
      finalNew = processedNewRecords
      finalOld = null
      break
    case 'update':
      finalNew = processedNewRecords
      finalOld = processedOldRecords
      break
    case 'delete':
      finalNew = null
      finalOld = processedOldRecords
      break
  }

  // Calculate size
  const size = finalNew?.length ?? finalOld?.length ?? 0

  return {
    isInsert: operation === 'insert',
    isUpdate: operation === 'update',
    isDelete: operation === 'delete',
    isUndelete: operation === 'undelete',
    isBefore,
    isAfter,
    isExecuting: true,
    new: finalNew,
    newMap: operation === 'delete' ? null : newMap,
    old: finalOld,
    oldMap,
    size,
    operationType: operation,
  }
}
