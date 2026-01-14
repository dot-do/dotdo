/**
 * Zapier Trigger Implementations
 *
 * Polling and webhook-based triggers for Zapier-compatible automation.
 */

import type {
  TriggerConfig,
  PollingTriggerConfig,
  HookTriggerConfig,
  PollingTriggerOperation,
  HookTriggerOperation,
  Bundle,
  ZObject,
  InputField,
  InputFieldOrFunction,
  DisplayConfig,
} from './types'

// ============================================================================
// TRIGGER CLASS
// ============================================================================

/**
 * Trigger definition helper
 */
export class Trigger {
  readonly config: TriggerConfig

  constructor(config: TriggerConfig) {
    this.config = config
  }

  get key(): string {
    return this.config.key
  }

  get noun(): string {
    return this.config.noun
  }

  get display(): DisplayConfig {
    return this.config.display
  }

  get operation() {
    return this.config.operation
  }

  /**
   * Check if this is a polling trigger
   */
  isPolling(): this is Trigger & { operation: PollingTriggerOperation } {
    return this.config.operation.type === 'polling'
  }

  /**
   * Check if this is a webhook trigger
   */
  isHook(): this is Trigger & { operation: HookTriggerOperation } {
    return this.config.operation.type === 'hook'
  }

  /**
   * Execute the trigger's perform function
   */
  async perform(z: ZObject, bundle: Bundle): Promise<unknown[]> {
    return this.config.operation.perform(z, bundle)
  }

  /**
   * Get sample data for the trigger
   */
  getSample(): Record<string, unknown> | undefined {
    return this.config.operation.sample
  }

  /**
   * Resolve input fields (handles dynamic fields)
   */
  async resolveInputFields(z: ZObject, bundle: Bundle): Promise<InputField[]> {
    const fields = this.config.operation.inputFields || []
    const resolvedFields: InputField[] = []

    for (const field of fields) {
      if (typeof field === 'function') {
        const dynamicFields = await field(z, bundle)
        resolvedFields.push(...dynamicFields)
      } else {
        resolvedFields.push(field)
      }
    }

    return resolvedFields
  }
}

// ============================================================================
// POLLING TRIGGER
// ============================================================================

/**
 * Create a polling trigger configuration
 */
export function createPollingTrigger(config: {
  key: string
  noun: string
  display: DisplayConfig
  perform: (z: ZObject, bundle: Bundle) => Promise<unknown[]>
  inputFields?: InputFieldOrFunction[]
  sample?: Record<string, unknown>
  canPaginate?: boolean
}): PollingTriggerConfig {
  return {
    key: config.key,
    noun: config.noun,
    display: config.display,
    operation: {
      type: 'polling',
      perform: config.perform,
      inputFields: config.inputFields,
      sample: config.sample,
      canPaginate: config.canPaginate,
    },
  }
}

/**
 * Polling trigger executor with deduplication
 */
export class PollingTriggerExecutor {
  private seenIds = new Set<string>()
  private trigger: Trigger
  private dedupeKey: string

  constructor(trigger: Trigger, dedupeKey = 'id') {
    this.trigger = trigger
    this.dedupeKey = dedupeKey
  }

  /**
   * Execute polling and deduplicate results
   */
  async poll(z: ZObject, bundle: Bundle): Promise<unknown[]> {
    const results = await this.trigger.perform(z, bundle)

    // Deduplicate based on dedupeKey
    const newItems = results.filter((item) => {
      const record = item as Record<string, unknown>
      const id = String(record[this.dedupeKey] ?? '')
      if (this.seenIds.has(id)) {
        return false
      }
      this.seenIds.add(id)
      return true
    })

    return newItems
  }

  /**
   * Clear seen IDs (for testing)
   */
  clearSeen(): void {
    this.seenIds.clear()
  }

  /**
   * Get count of seen items
   */
  getSeenCount(): number {
    return this.seenIds.size
  }
}

// ============================================================================
// WEBHOOK TRIGGER
// ============================================================================

/**
 * Create a webhook (hook) trigger configuration
 */
export function createHookTrigger(config: {
  key: string
  noun: string
  display: DisplayConfig
  performSubscribe: (
    z: ZObject,
    bundle: Bundle
  ) => Promise<{ id: string; [key: string]: unknown }>
  performUnsubscribe: (z: ZObject, bundle: Bundle) => Promise<unknown>
  perform: (z: ZObject, bundle: Bundle) => Promise<unknown[]>
  performList?: (z: ZObject, bundle: Bundle) => Promise<unknown[]>
  inputFields?: InputFieldOrFunction[]
  sample?: Record<string, unknown>
}): HookTriggerConfig {
  return {
    key: config.key,
    noun: config.noun,
    display: config.display,
    operation: {
      type: 'hook',
      performSubscribe: config.performSubscribe,
      performUnsubscribe: config.performUnsubscribe,
      perform: config.perform,
      performList: config.performList,
      inputFields: config.inputFields,
      sample: config.sample,
    },
  }
}

/**
 * Webhook trigger manager
 */
export class WebhookTriggerManager {
  private subscriptions = new Map<
    string,
    { id: string; targetUrl: string; data: Record<string, unknown> }
  >()

  /**
   * Subscribe to webhook
   */
  async subscribe(
    trigger: Trigger,
    z: ZObject,
    bundle: Bundle
  ): Promise<{ id: string; [key: string]: unknown }> {
    if (!trigger.isHook()) {
      throw new Error('Trigger is not a webhook trigger')
    }

    const operation = trigger.config.operation as HookTriggerOperation
    const result = await operation.performSubscribe(z, bundle)

    // Store subscription
    this.subscriptions.set(result.id, {
      id: result.id,
      targetUrl: bundle.targetUrl || '',
      data: result,
    })

    return result
  }

  /**
   * Unsubscribe from webhook
   */
  async unsubscribe(
    trigger: Trigger,
    z: ZObject,
    bundle: Bundle
  ): Promise<void> {
    if (!trigger.isHook()) {
      throw new Error('Trigger is not a webhook trigger')
    }

    const operation = trigger.config.operation as HookTriggerOperation
    await operation.performUnsubscribe(z, bundle)

    // Remove subscription
    const subscribeData = bundle.subscribeData as { id?: string } | undefined
    if (subscribeData?.id) {
      this.subscriptions.delete(subscribeData.id)
    }
  }

  /**
   * Handle incoming webhook payload
   */
  async handleWebhook(
    trigger: Trigger,
    z: ZObject,
    bundle: Bundle
  ): Promise<unknown[]> {
    return trigger.perform(z, bundle)
  }

  /**
   * Get sample data via performList
   */
  async getSamples(
    trigger: Trigger,
    z: ZObject,
    bundle: Bundle
  ): Promise<unknown[]> {
    if (!trigger.isHook()) {
      throw new Error('Trigger is not a webhook trigger')
    }

    const operation = trigger.config.operation as HookTriggerOperation

    if (operation.performList) {
      return operation.performList(z, bundle)
    }

    // Fall back to sample data
    const sample = trigger.getSample()
    return sample ? [sample] : []
  }

  /**
   * Get all active subscriptions
   */
  getSubscriptions(): Array<{
    id: string
    targetUrl: string
    data: Record<string, unknown>
  }> {
    return Array.from(this.subscriptions.values())
  }

  /**
   * Check if subscription exists
   */
  hasSubscription(id: string): boolean {
    return this.subscriptions.has(id)
  }
}

// ============================================================================
// TRIGGER BUILDER
// ============================================================================

/**
 * Fluent builder for creating triggers
 */
export class TriggerBuilder {
  private config: Partial<TriggerConfig> = {}
  private operationType: 'polling' | 'hook' = 'polling'

  key(key: string): this {
    this.config.key = key
    return this
  }

  noun(noun: string): this {
    this.config.noun = noun
    return this
  }

  display(display: DisplayConfig): this {
    this.config.display = display
    return this
  }

  label(label: string): this {
    if (!this.config.display) {
      this.config.display = { label, description: '' }
    } else {
      this.config.display.label = label
    }
    return this
  }

  description(description: string): this {
    if (!this.config.display) {
      this.config.display = { label: '', description }
    } else {
      this.config.display.description = description
    }
    return this
  }

  polling(): this {
    this.operationType = 'polling'
    return this
  }

  hook(): this {
    this.operationType = 'hook'
    return this
  }

  perform(fn: (z: ZObject, bundle: Bundle) => Promise<unknown[]>): this {
    if (!this.config.operation) {
      this.config.operation = { type: this.operationType } as any
    }
    (this.config.operation as any).perform = fn
    return this
  }

  performSubscribe(
    fn: (z: ZObject, bundle: Bundle) => Promise<{ id: string; [key: string]: unknown }>
  ): this {
    this.operationType = 'hook'
    if (!this.config.operation) {
      this.config.operation = { type: 'hook' } as any
    }
    (this.config.operation as HookTriggerOperation).performSubscribe = fn
    return this
  }

  performUnsubscribe(
    fn: (z: ZObject, bundle: Bundle) => Promise<unknown>
  ): this {
    if (!this.config.operation) {
      this.config.operation = { type: 'hook' } as any
    }
    (this.config.operation as HookTriggerOperation).performUnsubscribe = fn
    return this
  }

  performList(fn: (z: ZObject, bundle: Bundle) => Promise<unknown[]>): this {
    if (!this.config.operation) {
      this.config.operation = { type: 'hook' } as any
    }
    (this.config.operation as HookTriggerOperation).performList = fn
    return this
  }

  inputFields(fields: InputFieldOrFunction[]): this {
    if (!this.config.operation) {
      this.config.operation = { type: this.operationType } as any
    }
    (this.config.operation as any).inputFields = fields
    return this
  }

  sample(sample: Record<string, unknown>): this {
    if (!this.config.operation) {
      this.config.operation = { type: this.operationType } as any
    }
    (this.config.operation as any).sample = sample
    return this
  }

  canPaginate(canPaginate = true): this {
    if (!this.config.operation) {
      this.config.operation = { type: 'polling' } as any
    }
    (this.config.operation as PollingTriggerOperation).canPaginate = canPaginate
    return this
  }

  build(): TriggerConfig {
    if (!this.config.key) {
      throw new Error('Trigger key is required')
    }
    if (!this.config.noun) {
      throw new Error('Trigger noun is required')
    }
    if (!this.config.display) {
      throw new Error('Trigger display is required')
    }
    if (!this.config.operation?.perform) {
      throw new Error('Trigger perform function is required')
    }

    // Set type
    (this.config.operation as any).type = this.operationType

    // Validate hook trigger has required functions
    if (this.operationType === 'hook') {
      const op = this.config.operation as HookTriggerOperation
      if (!op.performSubscribe) {
        throw new Error('Hook trigger requires performSubscribe')
      }
      if (!op.performUnsubscribe) {
        throw new Error('Hook trigger requires performUnsubscribe')
      }
    }

    return this.config as TriggerConfig
  }
}

/**
 * Start building a trigger
 */
export function trigger(): TriggerBuilder {
  return new TriggerBuilder()
}

// ============================================================================
// TRIGGER UTILITIES
// ============================================================================

/**
 * Sort trigger results by a field (newest first)
 */
export function sortByNewest<T extends Record<string, unknown>>(
  items: T[],
  dateField = 'created_at'
): T[] {
  return [...items].sort((a, b) => {
    const dateA = new Date(a[dateField] as string).getTime()
    const dateB = new Date(b[dateField] as string).getTime()
    return dateB - dateA
  })
}

/**
 * Limit trigger results to a maximum count
 */
export function limitResults<T>(items: T[], limit = 100): T[] {
  return items.slice(0, limit)
}

/**
 * Filter trigger results by a predicate
 */
export function filterResults<T>(
  items: T[],
  predicate: (item: T) => boolean
): T[] {
  return items.filter(predicate)
}

/**
 * Transform trigger results
 */
export function transformResults<T, U>(
  items: T[],
  transformer: (item: T) => U
): U[] {
  return items.map(transformer)
}

/**
 * Deduplicate results by a key field
 */
export function deduplicateResults<T extends Record<string, unknown>>(
  items: T[],
  keyField = 'id'
): T[] {
  const seen = new Set<string>()
  return items.filter((item) => {
    const key = String(item[keyField] ?? '')
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
}
