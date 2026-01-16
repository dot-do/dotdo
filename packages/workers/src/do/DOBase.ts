/**
 * DOBase - Base class for Durable Objects
 *
 * Provides foundational functionality:
 * - State management via in-memory map (for testing) or SQLite
 * - Alarm scheduling
 *
 * @module @dotdo/workers/do
 */

// In-memory storage for state management
const inMemoryStore = new Map<string, Map<string, unknown>>()
const alarmStore = new Map<string, Date | null>()

let instanceCounter = 0

/**
 * DOBase - Base class for Durable Objects
 */
export class DOBase {
  protected ctx: unknown
  protected env: unknown
  protected instanceId: string
  protected storage: Map<string, unknown>

  constructor(ctx: unknown, env: unknown) {
    this.ctx = ctx
    this.env = env
    this.instanceId = `do_${++instanceCounter}`

    // Get or create storage for this instance
    if (!inMemoryStore.has(this.instanceId)) {
      inMemoryStore.set(this.instanceId, new Map())
    }
    this.storage = inMemoryStore.get(this.instanceId)!
  }

  // State management
  async get(key: string): Promise<unknown> {
    return this.storage.get(key)
  }

  async set(key: string, value: unknown): Promise<boolean> {
    this.storage.set(key, value)
    return true
  }

  async delete(key: string): Promise<boolean> {
    return this.storage.delete(key)
  }

  async list(options?: { prefix?: string; limit?: number }): Promise<Record<string, unknown>> {
    const result: Record<string, unknown> = {}
    let count = 0

    for (const [key, value] of this.storage.entries()) {
      if (options?.prefix && !key.startsWith(options.prefix)) {
        continue
      }
      if (options?.limit && count >= options.limit) {
        break
      }
      result[key] = value
      count++
    }

    return result
  }

  // Alarm scheduling
  async setAlarm(time: Date | number): Promise<void> {
    const alarmTime = time instanceof Date ? time : new Date(time)
    alarmStore.set(this.instanceId, alarmTime)
  }

  async getAlarm(): Promise<Date | null> {
    return alarmStore.get(this.instanceId) ?? null
  }

  async deleteAlarm(): Promise<void> {
    alarmStore.set(this.instanceId, null)
  }

  // Workflow context methods (delegates to WorkflowContext when used in DO)
  send(_eventType: string, _data: unknown): string {
    // This would be overridden or connected to WorkflowContext in actual DO
    throw new Error('DOBase.send not implemented yet')
  }

  get on(): Record<string, Record<string, (handler: (event: unknown) => void) => () => void>> {
    // This would be overridden or connected to WorkflowContext in actual DO
    throw new Error('DOBase.on not implemented yet')
  }

  async do<T>(_action: () => T | Promise<T>, _options?: { stepId?: string; maxRetries?: number }): Promise<T> {
    // This would be overridden or connected to WorkflowContext in actual DO
    throw new Error('DOBase.do not implemented yet')
  }

  async try<T>(_action: () => T | Promise<T>, _options?: { timeout?: number }): Promise<T> {
    // This would be overridden or connected to WorkflowContext in actual DO
    throw new Error('DOBase.try not implemented yet')
  }

  get every(): unknown {
    // This would be overridden or connected to WorkflowContext in actual DO
    throw new Error('DOBase.every not implemented yet')
  }

  // HTTP handling
  async fetch(_request: Request): Promise<Response> {
    // This would be overridden in actual DO classes
    return new Response('OK')
  }
}
