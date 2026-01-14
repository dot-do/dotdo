/**
 * Window Triggers - Custom window firing policies
 */

import { parseDuration } from './utils'
import type { BaseTrigger, TriggerContext, DurationString } from './types'
import type { Watermark } from './watermark'

/**
 * EventTimeTrigger - Fires when watermark passes window end
 */
export class EventTimeTrigger implements BaseTrigger {
  shouldFire(context: TriggerContext): boolean {
    if (context.windowEnd === undefined || !context.watermark) {
      return false
    }
    return context.watermark.timestamp >= context.windowEnd
  }
}

/**
 * ProcessingTimeTrigger - Fires after processing time duration
 */
export class ProcessingTimeTrigger implements BaseTrigger {
  readonly interval: number

  constructor(duration: DurationString | number) {
    this.interval = parseDuration(duration)
  }

  shouldFire(context: TriggerContext): boolean {
    if (context.windowCreated === undefined || context.now === undefined) {
      return false
    }
    return context.now - context.windowCreated >= this.interval
  }
}

/**
 * CountTrigger - Fires when event count reaches threshold
 */
class CountTrigger implements BaseTrigger {
  readonly threshold: number

  constructor(count: number) {
    this.threshold = count
  }

  shouldFire(context: TriggerContext): boolean {
    if (context.eventCount === undefined) {
      return false
    }
    return context.eventCount >= this.threshold
  }
}

/**
 * TimeoutTrigger - Fires if no events for duration
 */
class TimeoutTrigger implements BaseTrigger {
  readonly timeout: number

  constructor(duration: DurationString | number) {
    this.timeout = parseDuration(duration)
  }

  shouldFire(context: TriggerContext): boolean {
    if (context.lastEventTime === undefined || context.now === undefined) {
      return false
    }
    return context.now - context.lastEventTime >= this.timeout
  }
}

/**
 * AnyTrigger - Fires when any of the sub-triggers fire (OR logic)
 */
class AnyTrigger implements BaseTrigger {
  readonly triggers: BaseTrigger[]

  constructor(triggers: BaseTrigger[]) {
    this.triggers = triggers
  }

  shouldFire(context: TriggerContext): boolean {
    return this.triggers.some((trigger) => trigger.shouldFire(context))
  }
}

/**
 * Trigger namespace with factory methods
 */
export const Trigger = {
  Count: CountTrigger,

  timeout(duration: DurationString | number): TimeoutTrigger {
    return new TimeoutTrigger(duration)
  },

  any(triggers: BaseTrigger[]): AnyTrigger {
    return new AnyTrigger(triggers)
  },
}
