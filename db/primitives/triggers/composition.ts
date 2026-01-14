/**
 * Trigger Composition - AND/OR/Debounce/Throttle patterns for triggers
 *
 * Provides composable trigger patterns:
 * - AND composition (all triggers must fire within a window)
 * - OR composition (any trigger fires)
 * - Debounce (coalesce rapid-fire events)
 * - Throttle (rate limit trigger fires)
 * - Window-based aggregation
 *
 * @example
 * ```typescript
 * import {
 *   and,
 *   or,
 *   debounce,
 *   throttle,
 *   window,
 *   createTrigger,
 * } from 'db/primitives/triggers/composition'
 *
 * // AND: Fire when both triggers fire within 5s
 * const composed = and(trigger1, trigger2, { windowMs: 5000 })
 *
 * // OR: Fire when any trigger fires
 * const either = or(trigger1, trigger2)
 *
 * // Debounce: Wait for 100ms of quiet before firing
 * const debounced = debounce(trigger, { delayMs: 100 })
 *
 * // Throttle: Max one fire per 1000ms
 * const throttled = throttle(trigger, { intervalMs: 1000 })
 *
 * // Nested composition
 * const complex = and(
 *   debounce(trigger1, { delayMs: 100 }),
 *   or(trigger2, trigger3)
 * )
 * ```
 *
 * @module db/primitives/triggers/composition
 */

// =============================================================================
// TYPES
// =============================================================================

/**
 * Trigger event payload
 */
export interface TriggerEvent<T = unknown> {
  /** Unique event ID */
  id: string
  /** Source trigger ID */
  sourceId: string
  /** Event timestamp */
  timestamp: Date
  /** Event payload */
  data: T
  /** Metadata about the trigger fire */
  metadata?: Record<string, unknown>
}

/**
 * Trigger fire result
 */
export interface TriggerResult<T = unknown> {
  /** Whether the trigger fired */
  fired: boolean
  /** Combined event if fired */
  event?: TriggerEvent<T>
  /** Individual events that contributed */
  sourceEvents?: TriggerEvent[]
  /** Reason if not fired */
  reason?: string
}

/**
 * Trigger handler function
 */
export type TriggerHandler<T = unknown> = (
  event: TriggerEvent<T>
) => void | Promise<void>

/**
 * Base trigger interface
 */
export interface Trigger<T = unknown> {
  /** Unique trigger ID */
  readonly id: string
  /** Trigger type for debugging */
  readonly type: string
  /** Register handler for trigger fires */
  onFire(handler: TriggerHandler<T>): () => void
  /** Manually emit an event to this trigger */
  emit(event: TriggerEvent<T>): Promise<TriggerResult<T>>
  /** Get current trigger state */
  getState(): TriggerState
  /** Reset trigger state */
  reset(): void
  /** Dispose of the trigger */
  dispose(): void
}

/**
 * Trigger state
 */
export interface TriggerState {
  /** Total events received */
  eventsReceived: number
  /** Total fires emitted */
  fireCount: number
  /** Last fire timestamp */
  lastFireAt?: Date
  /** Last event received timestamp */
  lastEventAt?: Date
  /** Whether the trigger is active */
  active: boolean
  /** Additional state info */
  extra?: Record<string, unknown>
}

/**
 * AND composition options
 */
export interface AndOptions {
  /** Time window for all triggers to fire (ms) */
  windowMs: number
  /** How to combine events */
  combineStrategy?: 'all' | 'latest' | 'first'
  /** Require specific order */
  ordered?: boolean
  /** ID for the composed trigger */
  id?: string
}

/**
 * OR composition options
 */
export interface OrOptions {
  /** ID for the composed trigger */
  id?: string
  /** Pass through original event or wrap */
  passthrough?: boolean
}

/**
 * Debounce options
 */
export interface DebounceOptions {
  /** Delay in ms before firing */
  delayMs: number
  /** Maximum wait time before forcing fire */
  maxWaitMs?: number
  /** Take first event in window instead of last */
  leading?: boolean
  /** Take last event in window */
  trailing?: boolean
  /** ID for the debounced trigger */
  id?: string
}

/**
 * Throttle options
 */
export interface ThrottleOptions {
  /** Minimum interval between fires (ms) */
  intervalMs: number
  /** Fire immediately on first event */
  leading?: boolean
  /** Fire on trailing edge */
  trailing?: boolean
  /** ID for the throttled trigger */
  id?: string
}

/**
 * Window aggregation options
 */
export interface WindowOptions {
  /** Window duration in ms */
  durationMs: number
  /** Slide interval (tumbling if not set) */
  slideMs?: number
  /** Minimum events to fire */
  minEvents?: number
  /** Maximum events per window */
  maxEvents?: number
  /** ID for the windowed trigger */
  id?: string
}

// =============================================================================
// UTILITIES
// =============================================================================

/**
 * Generate unique ID
 */
function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 11)}`
}

/**
 * Create a trigger event
 */
export function createEvent<T>(
  sourceId: string,
  data: T,
  metadata?: Record<string, unknown>
): TriggerEvent<T> {
  return {
    id: generateId(),
    sourceId,
    timestamp: new Date(),
    data,
    metadata,
  }
}

// =============================================================================
// BASE TRIGGER
// =============================================================================

/**
 * Base trigger implementation
 */
export class BaseTrigger<T = unknown> implements Trigger<T> {
  readonly id: string
  readonly type: string = 'base'

  protected handlers: Set<TriggerHandler<T>> = new Set()
  protected state: TriggerState = {
    eventsReceived: 0,
    fireCount: 0,
    active: true,
  }

  constructor(id?: string) {
    this.id = id ?? generateId()
  }

  onFire(handler: TriggerHandler<T>): () => void {
    this.handlers.add(handler)
    return () => {
      this.handlers.delete(handler)
    }
  }

  async emit(event: TriggerEvent<T>): Promise<TriggerResult<T>> {
    if (!this.state.active) {
      return { fired: false, reason: 'Trigger is inactive' }
    }

    this.state.eventsReceived++
    this.state.lastEventAt = event.timestamp

    // Process the event
    const result = await this.processEvent(event)

    if (result.fired) {
      this.state.fireCount++
      this.state.lastFireAt = new Date()
      await this.notifyHandlers(result.event!)
    }

    return result
  }

  protected async processEvent(event: TriggerEvent<T>): Promise<TriggerResult<T>> {
    // Base implementation: pass through
    return { fired: true, event, sourceEvents: [event] }
  }

  protected async notifyHandlers(event: TriggerEvent<T>): Promise<void> {
    const promises = Array.from(this.handlers).map((handler) =>
      Promise.resolve(handler(event)).catch((err) => {
        console.error(`Trigger handler error: ${err}`)
      })
    )
    await Promise.all(promises)
  }

  getState(): TriggerState {
    return { ...this.state }
  }

  reset(): void {
    this.state = {
      eventsReceived: 0,
      fireCount: 0,
      active: true,
    }
  }

  dispose(): void {
    this.state.active = false
    this.handlers.clear()
  }
}

// =============================================================================
// AND COMPOSITION
// =============================================================================

/**
 * Pending event in AND composition
 */
interface PendingAndEvent {
  sourceId: string
  event: TriggerEvent
  receivedAt: Date
}

/**
 * AND composed trigger - fires when all source triggers fire within window
 */
export class AndTrigger<T = unknown> extends BaseTrigger<T[]> {
  readonly type = 'and'

  private sources: Map<string, Trigger> = new Map()
  private unsubscribers: Array<() => void> = []
  private pendingEvents: Map<string, PendingAndEvent> = new Map()
  private windowMs: number
  private combineStrategy: 'all' | 'latest' | 'first'
  private ordered: boolean
  private expectedOrder: string[] = []
  private cleanupTimer?: ReturnType<typeof setTimeout>

  constructor(triggers: Trigger[], options: AndOptions) {
    super(options.id)
    this.windowMs = options.windowMs
    this.combineStrategy = options.combineStrategy ?? 'latest'
    this.ordered = options.ordered ?? false

    // Register all source triggers
    for (const trigger of triggers) {
      this.sources.set(trigger.id, trigger)
      this.expectedOrder.push(trigger.id)

      const unsubscribe = trigger.onFire((event) => {
        this.handleSourceEvent(trigger.id, event)
      })
      this.unsubscribers.push(unsubscribe)
    }

    // Start cleanup timer
    this.startCleanupTimer()
  }

  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpiredEvents()
    }, Math.min(this.windowMs / 2, 1000))
  }

  private cleanupExpiredEvents(): void {
    const now = Date.now()
    for (const [sourceId, pending] of this.pendingEvents) {
      if (now - pending.receivedAt.getTime() > this.windowMs) {
        this.pendingEvents.delete(sourceId)
      }
    }
  }

  private async handleSourceEvent(sourceId: string, event: TriggerEvent): Promise<void> {
    const now = new Date()

    // Store pending event
    this.pendingEvents.set(sourceId, {
      sourceId,
      event,
      receivedAt: now,
    })

    // Check if all sources have fired within window
    if (this.checkAllFired()) {
      await this.fireComposedEvent()
    }
  }

  private checkAllFired(): boolean {
    const now = Date.now()

    // Check all sources have pending events within window
    for (const sourceId of this.sources.keys()) {
      const pending = this.pendingEvents.get(sourceId)
      if (!pending) {
        return false
      }
      if (now - pending.receivedAt.getTime() > this.windowMs) {
        return false
      }
    }

    // Check order if required
    if (this.ordered) {
      const eventTimes = this.expectedOrder.map((id) => ({
        id,
        time: this.pendingEvents.get(id)!.receivedAt.getTime(),
      }))

      for (let i = 1; i < eventTimes.length; i++) {
        if (eventTimes[i]!.time < eventTimes[i - 1]!.time) {
          return false
        }
      }
    }

    return true
  }

  private async fireComposedEvent(): Promise<void> {
    if (!this.state.active) return

    // Collect source events
    const sourceEvents = Array.from(this.pendingEvents.values()).map((p) => p.event)

    // Combine data based on strategy
    let combinedData: unknown[]
    switch (this.combineStrategy) {
      case 'all':
        combinedData = sourceEvents.map((e) => e.data)
        break
      case 'first':
        combinedData = [sourceEvents.sort((a, b) =>
          a.timestamp.getTime() - b.timestamp.getTime()
        )[0]!.data]
        break
      case 'latest':
      default:
        combinedData = [sourceEvents.sort((a, b) =>
          b.timestamp.getTime() - a.timestamp.getTime()
        )[0]!.data]
        break
    }

    const composedEvent: TriggerEvent<unknown[]> = {
      id: generateId(),
      sourceId: this.id,
      timestamp: new Date(),
      data: combinedData,
      metadata: {
        compositionType: 'and',
        sourceCount: sourceEvents.length,
        sourceIds: Array.from(this.sources.keys()),
      },
    }

    // Clear pending events
    this.pendingEvents.clear()

    // Update state and notify
    this.state.fireCount++
    this.state.lastFireAt = composedEvent.timestamp

    await this.notifyHandlers(composedEvent as TriggerEvent<T[]>)
  }

  protected override async processEvent(event: TriggerEvent<T[]>): Promise<TriggerResult<T[]>> {
    // Direct emit bypasses composition logic
    return { fired: true, event, sourceEvents: [event] }
  }

  override dispose(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
    }
    for (const unsubscribe of this.unsubscribers) {
      unsubscribe()
    }
    this.pendingEvents.clear()
    super.dispose()
  }

  override getState(): TriggerState {
    return {
      ...super.getState(),
      extra: {
        pendingCount: this.pendingEvents.size,
        sourceCount: this.sources.size,
        windowMs: this.windowMs,
      },
    }
  }
}

/**
 * Create an AND composed trigger
 */
export function and<T = unknown>(
  ...args: [...Trigger[], AndOptions]
): AndTrigger<T> {
  const options = args.pop() as AndOptions
  const triggers = args as Trigger[]
  return new AndTrigger<T>(triggers, options)
}

// =============================================================================
// OR COMPOSITION
// =============================================================================

/**
 * OR composed trigger - fires when any source trigger fires
 */
export class OrTrigger<T = unknown> extends BaseTrigger<T> {
  readonly type = 'or'

  private sources: Map<string, Trigger> = new Map()
  private unsubscribers: Array<() => void> = []
  private passthrough: boolean

  constructor(triggers: Trigger[], options: OrOptions = {}) {
    super(options.id)
    this.passthrough = options.passthrough ?? false

    // Register all source triggers
    for (const trigger of triggers) {
      this.sources.set(trigger.id, trigger)

      const unsubscribe = trigger.onFire((event) => {
        this.handleSourceEvent(trigger.id, event)
      })
      this.unsubscribers.push(unsubscribe)
    }
  }

  private async handleSourceEvent(sourceId: string, event: TriggerEvent): Promise<void> {
    if (!this.state.active) return

    let outputEvent: TriggerEvent<T>

    if (this.passthrough) {
      outputEvent = event as TriggerEvent<T>
    } else {
      outputEvent = {
        id: generateId(),
        sourceId: this.id,
        timestamp: new Date(),
        data: event.data as T,
        metadata: {
          compositionType: 'or',
          originalSourceId: sourceId,
          originalEventId: event.id,
        },
      }
    }

    this.state.eventsReceived++
    this.state.lastEventAt = event.timestamp
    this.state.fireCount++
    this.state.lastFireAt = outputEvent.timestamp

    await this.notifyHandlers(outputEvent)
  }

  override dispose(): void {
    for (const unsubscribe of this.unsubscribers) {
      unsubscribe()
    }
    super.dispose()
  }

  override getState(): TriggerState {
    return {
      ...super.getState(),
      extra: {
        sourceCount: this.sources.size,
        passthrough: this.passthrough,
      },
    }
  }
}

/**
 * Create an OR composed trigger
 */
export function or<T = unknown>(
  ...args: [...Trigger[], OrOptions?]
): OrTrigger<T> {
  let options: OrOptions = {}
  let triggers: Trigger[] = args as Trigger[]

  // Check if last arg is options
  const lastArg = args[args.length - 1]
  if (lastArg && typeof lastArg === 'object' && !('onFire' in lastArg)) {
    options = lastArg as OrOptions
    triggers = args.slice(0, -1) as Trigger[]
  }

  return new OrTrigger<T>(triggers, options)
}

// =============================================================================
// DEBOUNCE COMPOSITION
// =============================================================================

/**
 * Debounced trigger - waits for quiet period before firing
 */
export class DebounceTrigger<T = unknown> extends BaseTrigger<T> {
  readonly type = 'debounce'

  private source: Trigger<T>
  private unsubscribe: () => void
  private delayMs: number
  private maxWaitMs?: number
  private leading: boolean
  private trailing: boolean

  private pendingEvent?: TriggerEvent<T>
  private debounceTimer?: ReturnType<typeof setTimeout>
  private maxWaitTimer?: ReturnType<typeof setTimeout>
  private windowStartTime?: number
  private hasFiredLeading = false

  constructor(trigger: Trigger<T>, options: DebounceOptions) {
    super(options.id)
    this.source = trigger
    this.delayMs = options.delayMs
    this.maxWaitMs = options.maxWaitMs
    this.leading = options.leading ?? false
    this.trailing = options.trailing ?? true

    this.unsubscribe = this.source.onFire((event) => {
      this.handleSourceEvent(event)
    })
  }

  private async handleSourceEvent(event: TriggerEvent<T>): Promise<void> {
    if (!this.state.active) return

    this.state.eventsReceived++
    this.state.lastEventAt = event.timestamp
    this.pendingEvent = event

    // Start window if not started
    if (this.windowStartTime === undefined) {
      this.windowStartTime = Date.now()

      // Fire on leading edge if configured
      if (this.leading && !this.hasFiredLeading) {
        this.hasFiredLeading = true
        await this.fireEvent(event)
      }

      // Start max wait timer if configured
      if (this.maxWaitMs) {
        this.maxWaitTimer = setTimeout(() => {
          this.forceFlush()
        }, this.maxWaitMs)
      }
    }

    // Reset debounce timer
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
    }

    if (this.trailing) {
      this.debounceTimer = setTimeout(() => {
        this.flush()
      }, this.delayMs)
    }
  }

  private async forceFlush(): Promise<void> {
    // Clear debounce timer
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = undefined
    }

    await this.flush()
  }

  private async flush(): Promise<void> {
    // Clear timers
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = undefined
    }
    if (this.maxWaitTimer) {
      clearTimeout(this.maxWaitTimer)
      this.maxWaitTimer = undefined
    }

    // Fire pending event if trailing enabled and we haven't already fired on leading
    if (this.pendingEvent && this.trailing) {
      // Don't fire if we already fired on leading and this is the same event
      if (!(this.leading && this.hasFiredLeading && this.state.fireCount > 0)) {
        await this.fireEvent(this.pendingEvent)
      }
    }

    // Reset state
    this.pendingEvent = undefined
    this.windowStartTime = undefined
    this.hasFiredLeading = false
  }

  private async fireEvent(event: TriggerEvent<T>): Promise<void> {
    const debouncedEvent: TriggerEvent<T> = {
      id: generateId(),
      sourceId: this.id,
      timestamp: new Date(),
      data: event.data,
      metadata: {
        compositionType: 'debounce',
        originalSourceId: event.sourceId,
        originalEventId: event.id,
        delayMs: this.delayMs,
      },
    }

    this.state.fireCount++
    this.state.lastFireAt = debouncedEvent.timestamp

    await this.notifyHandlers(debouncedEvent)
  }

  override dispose(): void {
    this.unsubscribe()
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
    }
    if (this.maxWaitTimer) {
      clearTimeout(this.maxWaitTimer)
    }
    super.dispose()
  }

  override getState(): TriggerState {
    return {
      ...super.getState(),
      extra: {
        delayMs: this.delayMs,
        maxWaitMs: this.maxWaitMs,
        hasPending: this.pendingEvent !== undefined,
        leading: this.leading,
        trailing: this.trailing,
      },
    }
  }

  override reset(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = undefined
    }
    if (this.maxWaitTimer) {
      clearTimeout(this.maxWaitTimer)
      this.maxWaitTimer = undefined
    }
    this.pendingEvent = undefined
    this.windowStartTime = undefined
    this.hasFiredLeading = false
    super.reset()
  }
}

/**
 * Create a debounced trigger
 */
export function debounce<T = unknown>(
  trigger: Trigger<T>,
  options: DebounceOptions
): DebounceTrigger<T> {
  return new DebounceTrigger<T>(trigger, options)
}

// =============================================================================
// THROTTLE COMPOSITION
// =============================================================================

/**
 * Throttled trigger - rate limits fires
 */
export class ThrottleTrigger<T = unknown> extends BaseTrigger<T> {
  readonly type = 'throttle'

  private source: Trigger<T>
  private unsubscribe: () => void
  private intervalMs: number
  private leading: boolean
  private trailing: boolean

  private lastFireTime = 0
  private pendingEvent?: TriggerEvent<T>
  private trailingTimer?: ReturnType<typeof setTimeout>

  constructor(trigger: Trigger<T>, options: ThrottleOptions) {
    super(options.id)
    this.source = trigger
    this.intervalMs = options.intervalMs
    this.leading = options.leading ?? true
    this.trailing = options.trailing ?? false

    this.unsubscribe = this.source.onFire((event) => {
      this.handleSourceEvent(event)
    })
  }

  private async handleSourceEvent(event: TriggerEvent<T>): Promise<void> {
    if (!this.state.active) return

    this.state.eventsReceived++
    this.state.lastEventAt = event.timestamp

    const now = Date.now()
    const elapsed = now - this.lastFireTime
    const remaining = this.intervalMs - elapsed

    // Store for potential trailing fire
    this.pendingEvent = event

    if (elapsed >= this.intervalMs) {
      // Enough time has passed, fire immediately if leading
      if (this.leading) {
        await this.fireEvent(event)
        this.lastFireTime = now
      }

      // Schedule trailing fire if configured and not leading
      if (this.trailing && !this.leading) {
        this.scheduleTrailing(this.intervalMs)
      }
    } else {
      // Within throttle window
      // Schedule trailing fire if configured
      if (this.trailing) {
        this.scheduleTrailing(remaining)
      }
    }
  }

  private scheduleTrailing(delay: number): void {
    // Clear existing trailing timer
    if (this.trailingTimer) {
      clearTimeout(this.trailingTimer)
    }

    this.trailingTimer = setTimeout(() => {
      this.trailingTimer = undefined
      if (this.pendingEvent) {
        this.fireEvent(this.pendingEvent)
        this.lastFireTime = Date.now()
        this.pendingEvent = undefined
      }
    }, delay)
  }

  private async fireEvent(event: TriggerEvent<T>): Promise<void> {
    const throttledEvent: TriggerEvent<T> = {
      id: generateId(),
      sourceId: this.id,
      timestamp: new Date(),
      data: event.data,
      metadata: {
        compositionType: 'throttle',
        originalSourceId: event.sourceId,
        originalEventId: event.id,
        intervalMs: this.intervalMs,
      },
    }

    this.state.fireCount++
    this.state.lastFireAt = throttledEvent.timestamp

    await this.notifyHandlers(throttledEvent)
  }

  override dispose(): void {
    this.unsubscribe()
    if (this.trailingTimer) {
      clearTimeout(this.trailingTimer)
    }
    super.dispose()
  }

  override getState(): TriggerState {
    return {
      ...super.getState(),
      extra: {
        intervalMs: this.intervalMs,
        hasPending: this.pendingEvent !== undefined,
        lastFireTime: this.lastFireTime,
        leading: this.leading,
        trailing: this.trailing,
      },
    }
  }

  override reset(): void {
    if (this.trailingTimer) {
      clearTimeout(this.trailingTimer)
      this.trailingTimer = undefined
    }
    this.pendingEvent = undefined
    this.lastFireTime = 0
    super.reset()
  }
}

/**
 * Create a throttled trigger
 */
export function throttle<T = unknown>(
  trigger: Trigger<T>,
  options: ThrottleOptions
): ThrottleTrigger<T> {
  return new ThrottleTrigger<T>(trigger, options)
}

// =============================================================================
// WINDOW AGGREGATION
// =============================================================================

/**
 * Windowed trigger - aggregates events in time windows
 */
export class WindowTrigger<T = unknown> extends BaseTrigger<T[]> {
  readonly type = 'window'

  private source: Trigger<T>
  private unsubscribe: () => void
  private durationMs: number
  private slideMs?: number
  private minEvents: number
  private maxEvents: number

  private windowEvents: TriggerEvent<T>[] = []
  private windowStartTime?: number
  private windowTimer?: ReturnType<typeof setTimeout>
  private slideTimer?: ReturnType<typeof setInterval>

  constructor(trigger: Trigger<T>, options: WindowOptions) {
    super(options.id)
    this.source = trigger
    this.durationMs = options.durationMs
    this.slideMs = options.slideMs
    this.minEvents = options.minEvents ?? 1
    this.maxEvents = options.maxEvents ?? Infinity

    this.unsubscribe = this.source.onFire((event) => {
      this.handleSourceEvent(event)
    })

    // For sliding windows, set up slide timer
    if (this.slideMs) {
      this.slideTimer = setInterval(() => {
        this.slideWindow()
      }, this.slideMs)
    }
  }

  private async handleSourceEvent(event: TriggerEvent<T>): Promise<void> {
    if (!this.state.active) return

    this.state.eventsReceived++
    this.state.lastEventAt = event.timestamp

    // Start window if not started
    if (this.windowStartTime === undefined) {
      this.windowStartTime = Date.now()

      // For tumbling windows, set up window timer
      if (!this.slideMs) {
        this.windowTimer = setTimeout(() => {
          this.closeWindow()
        }, this.durationMs)
      }
    }

    // Add event to window
    this.windowEvents.push(event)

    // Check if we've hit max events
    if (this.windowEvents.length >= this.maxEvents) {
      await this.closeWindow()
    }
  }

  private slideWindow(): void {
    const now = Date.now()

    // Remove events outside window
    this.windowEvents = this.windowEvents.filter(
      (e) => now - e.timestamp.getTime() < this.durationMs
    )

    // Fire if we have enough events
    if (this.windowEvents.length >= this.minEvents) {
      this.fireWindow()
    }
  }

  private async closeWindow(): Promise<void> {
    // Clear timer
    if (this.windowTimer) {
      clearTimeout(this.windowTimer)
      this.windowTimer = undefined
    }

    // Fire if we have enough events
    if (this.windowEvents.length >= this.minEvents) {
      await this.fireWindow()
    }

    // Reset window
    this.windowEvents = []
    this.windowStartTime = undefined
  }

  private async fireWindow(): Promise<void> {
    if (this.windowEvents.length === 0) return

    const events = [...this.windowEvents]
    const windowedEvent: TriggerEvent<T[]> = {
      id: generateId(),
      sourceId: this.id,
      timestamp: new Date(),
      data: events.map((e) => e.data),
      metadata: {
        compositionType: 'window',
        eventCount: events.length,
        windowDurationMs: this.durationMs,
        windowStartTime: this.windowStartTime,
        isSliding: !!this.slideMs,
      },
    }

    this.state.fireCount++
    this.state.lastFireAt = windowedEvent.timestamp

    await this.notifyHandlers(windowedEvent)
  }

  override dispose(): void {
    this.unsubscribe()
    if (this.windowTimer) {
      clearTimeout(this.windowTimer)
    }
    if (this.slideTimer) {
      clearInterval(this.slideTimer)
    }
    super.dispose()
  }

  override getState(): TriggerState {
    return {
      ...super.getState(),
      extra: {
        durationMs: this.durationMs,
        slideMs: this.slideMs,
        currentEventCount: this.windowEvents.length,
        minEvents: this.minEvents,
        maxEvents: this.maxEvents,
      },
    }
  }

  override reset(): void {
    if (this.windowTimer) {
      clearTimeout(this.windowTimer)
      this.windowTimer = undefined
    }
    this.windowEvents = []
    this.windowStartTime = undefined
    super.reset()
  }
}

/**
 * Create a windowed trigger
 */
export function window<T = unknown>(
  trigger: Trigger<T>,
  options: WindowOptions
): WindowTrigger<T> {
  return new WindowTrigger<T>(trigger, options)
}

// =============================================================================
// FACTORY FUNCTIONS
// =============================================================================

/**
 * Create a simple trigger for testing or manual emission
 */
export function createTrigger<T = unknown>(id?: string): BaseTrigger<T> {
  return new BaseTrigger<T>(id)
}

// =============================================================================
// EXPORTS
// =============================================================================

export default {
  // Classes
  BaseTrigger,
  AndTrigger,
  OrTrigger,
  DebounceTrigger,
  ThrottleTrigger,
  WindowTrigger,

  // Factory functions
  createTrigger,
  createEvent,
  and,
  or,
  debounce,
  throttle,
  window,
}
