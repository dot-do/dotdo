/**
 * Track Context - Event tracking API implementation
 *
 * Provides the $.track API for event tracking, analysis, and subscriptions.
 *
 * @module workflows/data/track/context
 */

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

/**
 * Tracked event structure
 */
export interface TrackedEvent<T = Record<string, unknown>> {
  id: string
  type: string
  data: T
  timestamp: number
  experiment?: string
  variant?: string
}

/**
 * Event subscription handle
 */
export interface EventSubscription {
  id: string
  unsubscribe: () => void
}

/**
 * Funnel step result
 */
export interface FunnelStepResult {
  count: number
  conversionRate: number
  avgTimeFromPrevious?: number
}

/**
 * Funnel analysis result
 */
export interface FunnelResult {
  steps: FunnelStepResult[]
  overallConversionRate: number
}

/**
 * Cohort result
 */
export interface CohortResult {
  cohorts: Array<{
    startDate: number
    size: number
    retention: number[]
  }>
  granularity: 'day' | 'week' | 'month'
}

/**
 * Time series data point
 */
export interface TimeSeriesPoint {
  timestamp: number
  count: number
}

/**
 * Filter operators for where clauses
 */
export interface FilterOperators {
  gte?: number
  gt?: number
  lte?: number
  lt?: number
  ne?: unknown
  in?: unknown[]
}

/**
 * Track context options
 */
export interface TrackOptions {
  experiment?: string
  variant?: string
}

/**
 * Funnel step definition
 */
export interface FunnelStep {
  eventType: string
  filter?: Record<string, unknown>
}

/**
 * Cohort configuration
 */
export interface CohortConfig {
  anchor: string
  activity: string
  periods: number
  granularity: 'day' | 'week' | 'month'
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

let idCounter = 0

function generateId(): string {
  return `evt_${Date.now()}_${++idCounter}_${Math.random().toString(36).substring(2, 9)}`
}

function generateSubscriptionId(): string {
  return `sub_${Date.now()}_${++idCounter}_${Math.random().toString(36).substring(2, 9)}`
}

/**
 * Parse duration string to milliseconds.
 * Returns the actual timestamp if given a number (for since(timestamp) calls).
 */
function parseDuration(duration: string | number): { isTimestamp: boolean; value: number } {
  if (typeof duration === 'number') {
    // If it's a large number (> 1 year in ms), treat it as a timestamp
    // Otherwise treat it as milliseconds duration
    const oneYearMs = 365 * 24 * 60 * 60 * 1000
    if (duration > oneYearMs) {
      return { isTimestamp: true, value: duration }
    }
    return { isTimestamp: false, value: duration }
  }

  const match = duration.match(/^(\d+)([smhdwMy]|month|quarter|year|week)?$/)
  if (!match) {
    // Handle special cases
    if (duration === 'month') return { isTimestamp: false, value: 30 * 24 * 60 * 60 * 1000 }
    if (duration === 'quarter') return { isTimestamp: false, value: 90 * 24 * 60 * 60 * 1000 }
    if (duration === 'year') return { isTimestamp: false, value: 365 * 24 * 60 * 60 * 1000 }
    if (duration === 'week') return { isTimestamp: false, value: 7 * 24 * 60 * 60 * 1000 }
    throw new Error(`Invalid duration: ${duration}`)
  }

  const value = parseInt(match[1]!, 10)
  const unit = match[2] || 's'

  let ms: number
  switch (unit) {
    case 's':
      ms = value * 1000
      break
    case 'm':
      ms = value * 60 * 1000
      break
    case 'h':
      ms = value * 60 * 60 * 1000
      break
    case 'd':
      ms = value * 24 * 60 * 60 * 1000
      break
    case 'w':
    case 'week':
      ms = value * 7 * 24 * 60 * 60 * 1000
      break
    case 'M':
    case 'month':
      ms = value * 30 * 24 * 60 * 60 * 1000
      break
    case 'quarter':
      ms = value * 90 * 24 * 60 * 60 * 1000
      break
    case 'y':
    case 'year':
      ms = value * 365 * 24 * 60 * 60 * 1000
      break
    default:
      ms = value * 1000
  }
  return { isTimestamp: false, value: ms }
}

/**
 * Get the "since" timestamp from duration or timestamp
 */
function getSinceTimestamp(duration: string | number): number {
  const parsed = parseDuration(duration)
  if (parsed.isTimestamp) {
    return parsed.value
  }
  return Date.now() - parsed.value
}

/**
 * Get period start for a timestamp based on granularity
 */
function getPeriodStart(timestamp: number, granularity: 'day' | 'week' | 'month' | 'hour' | 'minute'): number {
  const date = new Date(timestamp)

  switch (granularity) {
    case 'minute':
      return new Date(date.getFullYear(), date.getMonth(), date.getDate(), date.getHours(), date.getMinutes()).getTime()
    case 'hour':
      return new Date(date.getFullYear(), date.getMonth(), date.getDate(), date.getHours()).getTime()
    case 'day':
      return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
    case 'week':
      const day = date.getDay()
      const diff = date.getDate() - day
      return new Date(date.getFullYear(), date.getMonth(), diff).getTime()
    case 'month':
      return new Date(date.getFullYear(), date.getMonth(), 1).getTime()
    default:
      return timestamp
  }
}

/**
 * Get the period number from anchor timestamp
 */
function getPeriodNumber(anchorTimestamp: number, eventTimestamp: number, granularity: 'day' | 'week' | 'month'): number {
  const diff = eventTimestamp - anchorTimestamp
  switch (granularity) {
    case 'day':
      return Math.floor(diff / (24 * 60 * 60 * 1000))
    case 'week':
      return Math.floor(diff / (7 * 24 * 60 * 60 * 1000))
    case 'month':
      return Math.floor(diff / (30 * 24 * 60 * 60 * 1000))
    default:
      return 0
  }
}

/**
 * Check if event matches filter
 */
function matchesFilter(
  event: TrackedEvent,
  filter: Record<string, unknown>
): boolean {
  for (const [key, value] of Object.entries(filter)) {
    // Handle experiment and variant as top-level properties
    if (key === 'experiment') {
      if (event.experiment !== value) return false
      continue
    }
    if (key === 'variant') {
      if (event.variant !== value) return false
      continue
    }

    const eventValue = event.data[key]

    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      const ops = value as FilterOperators
      if (ops.gte !== undefined && (typeof eventValue !== 'number' || eventValue < ops.gte)) return false
      if (ops.gt !== undefined && (typeof eventValue !== 'number' || eventValue <= ops.gt)) return false
      if (ops.lte !== undefined && (typeof eventValue !== 'number' || eventValue > ops.lte)) return false
      if (ops.lt !== undefined && (typeof eventValue !== 'number' || eventValue >= ops.lt)) return false
      if (ops.ne !== undefined && eventValue === ops.ne) return false
      if (ops.in !== undefined && !ops.in.includes(eventValue)) return false
    } else {
      if (eventValue !== value) return false
    }
  }
  return true
}

// =============================================================================
// STORAGE
// =============================================================================

interface EventStorage {
  events: TrackedEvent[]
  subscriptions: Map<string, Array<{ id: string; handler: (event: TrackedEvent) => void; filter?: Record<string, unknown> }>>
}

function createStorage(): EventStorage {
  return {
    events: [],
    subscriptions: new Map(),
  }
}

// =============================================================================
// QUERY BUILDERS
// =============================================================================

interface CountQuery {
  (): Promise<number>
  since(duration: string | number): Promise<number> | CountQuery
  by(field: string): Promise<Record<string, number>>
  groupBy(granularity: 'minute' | 'hour' | 'day'): Promise<TimeSeriesPoint[]>
}

interface EventsQuery {
  limit(n: number): Promise<TrackedEvent[]>
  since(duration: string | number): EventsQuery
}

interface WhereQuery {
  count(): CountQuery
  sum(field: string): SumQuery
  avg(field: string): Promise<number | null>
  countUnique(field: string): CountUniqueQuery
}

interface SumQuery {
  (): Promise<number>
  since(duration: string | number): Promise<number>
}

interface CountUniqueQuery {
  (): Promise<number>
  since(duration: string | number): Promise<number>
}

interface FunnelQuery {
  within(duration: string): FunnelQueryWithin
}

interface FunnelQueryWithin {
  (): Promise<FunnelResult>
  by(field: string): Promise<Record<string, FunnelResult>>
  strict(): FunnelQueryStrict
  where(filter: Record<string, unknown>): FunnelQueryWithFilter
}

interface FunnelQueryStrict {
  (): Promise<FunnelResult>
}

interface FunnelQueryWithFilter {
  by(field: string): Promise<Record<string, FunnelResult>>
}

interface CohortQuery {
  (): Promise<CohortResult>
  by(field: string): Promise<Record<string, CohortResult>>
}

// =============================================================================
// PUBLIC API TYPES
// =============================================================================

/**
 * Event proxy interface for tracking and querying events of a specific type.
 * Callable to track an event, with methods for querying.
 */
export interface EventProxy<T = Record<string, unknown>> {
  /** Track an event with data */
  (data: T, options?: TrackOptions): Promise<TrackedEvent<T>>
  /** Count events */
  count(): CountQuery
  /** Get events with limit */
  events(): EventsQuery
  /** Filter events */
  where(filter: Record<string, unknown>): WhereQuery
  /** Sum a numeric field */
  sum(field: string): SumQuery
  /** Average of a numeric field */
  avg(field: string): Promise<number | null>
  /** Min of a numeric field */
  min(field: string): Promise<number | null>
  /** Max of a numeric field */
  max(field: string): Promise<number | null>
  /** Count unique values of a field */
  countUnique(field: string): CountUniqueQuery
  /** Subscribe to events */
  subscribe(
    handler: (event: TrackedEvent<T>) => void,
    options?: { where?: Record<string, unknown> }
  ): EventSubscription
}

/**
 * Track proxy interface for event tracking and analytics.
 * Access event types via index signature (e.g., track.PageView).
 */
export interface TrackProxy {
  /** Batch track multiple events */
  batch(
    events: Array<{ event: string; data: Record<string, unknown>; options?: TrackOptions }>
  ): Promise<TrackedEvent[]>
  /** Create a funnel analysis */
  funnel(steps: FunnelStep[]): FunnelQuery
  /** Create a cohort analysis */
  cohort(config: CohortConfig): CohortQuery
  /** Calculate ratio between two event types */
  ratio(numerator: string, denominator: string): Promise<number>
  /** Access event proxy by event type name */
  [eventType: string]: EventProxy | unknown
}

// =============================================================================
// EVENT PROXY
// =============================================================================

function createEventProxy(
  eventType: string,
  storage: EventStorage
): EventProxy {
  const getEvents = (since?: number): TrackedEvent[] => {
    return storage.events.filter((e) => {
      if (e.type !== eventType) return false
      if (since !== undefined && e.timestamp < since) return false
      return true
    })
  }

  const getFilteredEvents = (filter: Record<string, unknown>, since?: number): TrackedEvent[] => {
    return storage.events.filter((e) => {
      if (e.type !== eventType) return false
      if (since !== undefined && e.timestamp < since) return false
      return matchesFilter(e, filter)
    })
  }

  const proxy: any = async (data: Record<string, unknown>, options?: TrackOptions): Promise<TrackedEvent> => {
    const event: TrackedEvent = {
      id: generateId(),
      type: eventType,
      data,
      timestamp: Date.now(),
      ...(options?.experiment && { experiment: options.experiment }),
      ...(options?.variant && { variant: options.variant }),
    }

    storage.events.push(event)

    // Notify subscribers
    const subs = storage.subscriptions.get(eventType) || []
    for (const sub of subs) {
      if (!sub.filter || matchesFilter(event, sub.filter)) {
        sub.handler(event)
      }
    }

    return event
  }

  // count()
  proxy.count = (): CountQuery => {
    let sinceTime: number | undefined

    // Create a thenable that also has methods
    const countPromise = Promise.resolve().then(async () => {
      const events = getEvents(sinceTime)
      return events.length
    })

    // Add chainable methods
    const countFn: any = countPromise

    countFn.since = (duration: string | number): CountQuery => {
      sinceTime = getSinceTimestamp(duration)
      // Return a new thenable with the updated sinceTime
      const newPromise = Promise.resolve().then(async () => {
        const events = getEvents(sinceTime)
        return events.length
      })
      const newFn: any = newPromise
      newFn.by = async (field: string): Promise<Record<string, number>> => {
        const events = getEvents(sinceTime)
        const result: Record<string, number> = {}
        for (const event of events) {
          const value = field === 'variant' ? event.variant : event.data[field]
          if (value !== undefined) {
            const key = String(value)
            result[key] = (result[key] || 0) + 1
          }
        }
        return result
      }
      newFn.groupBy = async (granularity: 'minute' | 'hour' | 'day'): Promise<TimeSeriesPoint[]> => {
        const events = getEvents(sinceTime)
        const buckets = new Map<number, number>()

        for (const event of events) {
          const periodStart = getPeriodStart(event.timestamp, granularity)
          buckets.set(periodStart, (buckets.get(periodStart) || 0) + 1)
        }

        return Array.from(buckets.entries())
          .map(([timestamp, count]) => ({ timestamp, count }))
          .sort((a, b) => a.timestamp - b.timestamp)
      }
      return newFn
    }

    countFn.by = async (field: string): Promise<Record<string, number>> => {
      const events = getEvents(sinceTime)
      const result: Record<string, number> = {}
      for (const event of events) {
        const value = field === 'variant' ? event.variant : event.data[field]
        if (value !== undefined) {
          const key = String(value)
          result[key] = (result[key] || 0) + 1
        }
      }
      return result
    }

    countFn.groupBy = async (granularity: 'minute' | 'hour' | 'day'): Promise<TimeSeriesPoint[]> => {
      const events = getEvents(sinceTime)
      const buckets = new Map<number, number>()

      for (const event of events) {
        const periodStart = getPeriodStart(event.timestamp, granularity)
        buckets.set(periodStart, (buckets.get(periodStart) || 0) + 1)
      }

      return Array.from(buckets.entries())
        .map(([timestamp, count]) => ({ timestamp, count }))
        .sort((a, b) => a.timestamp - b.timestamp)
    }

    return countFn
  }

  // events()
  proxy.events = (): EventsQuery => {
    let sinceTime: number | undefined

    const eventsQuery: any = {
      limit: async (n: number): Promise<TrackedEvent[]> => {
        const events = getEvents(sinceTime)
        // Get events with their original indices for stable sorting
        const eventsWithIndex = events.map((e, i) => ({ event: e, originalIndex: i }))
        // Return in reverse chronological order (most recent first)
        // Use original index as tiebreaker when timestamps are equal (stable sort)
        eventsWithIndex.sort((a, b) => {
          const timeDiff = b.event.timestamp - a.event.timestamp
          if (timeDiff !== 0) return timeDiff
          // Same timestamp: later in array = more recent
          return b.originalIndex - a.originalIndex
        })
        return eventsWithIndex.slice(0, n).map((e) => e.event)
      },
      since: (duration: string | number): EventsQuery => {
        sinceTime = getSinceTimestamp(duration)
        return eventsQuery
      },
    }

    return eventsQuery
  }

  // where()
  proxy.where = (filter: Record<string, unknown>): WhereQuery => {
    const whereQuery: any = {
      count: (): CountQuery => {
        let sinceTime: number | undefined

        const countPromise = Promise.resolve().then(async () => {
          return getFilteredEvents(filter, sinceTime).length
        })

        const countFn: any = countPromise

        countFn.since = (duration: string | number): CountQuery => {
          sinceTime = getSinceTimestamp(duration)
          const newPromise = Promise.resolve().then(async () => {
            return getFilteredEvents(filter, sinceTime).length
          })
          const newFn: any = newPromise
          newFn.by = async (field: string): Promise<Record<string, number>> => {
            const events = getFilteredEvents(filter, sinceTime)
            const result: Record<string, number> = {}
            for (const event of events) {
              const value = field === 'variant' ? event.variant : event.data[field]
              if (value !== undefined) {
                const key = String(value)
                result[key] = (result[key] || 0) + 1
              }
            }
            return result
          }
          return newFn
        }

        countFn.by = async (field: string): Promise<Record<string, number>> => {
          const events = getFilteredEvents(filter, sinceTime)
          const result: Record<string, number> = {}
          for (const event of events) {
            const value = field === 'variant' ? event.variant : event.data[field]
            if (value !== undefined) {
              const key = String(value)
              result[key] = (result[key] || 0) + 1
            }
          }
          return result
        }

        return countFn
      },

      sum: (field: string): SumQuery => {
        let sinceTime: number | undefined

        const sumPromise = Promise.resolve().then(async () => {
          const events = getFilteredEvents(filter, sinceTime)
          return events.reduce((sum, e) => {
            const val = e.data[field]
            return sum + (typeof val === 'number' ? val : 0)
          }, 0)
        })

        const sumFn: any = sumPromise

        sumFn.since = (duration: string | number): SumQuery => {
          sinceTime = getSinceTimestamp(duration)
          return Promise.resolve().then(async () => {
            const events = getFilteredEvents(filter, sinceTime)
            return events.reduce((sum, e) => {
              const val = e.data[field]
              return sum + (typeof val === 'number' ? val : 0)
            }, 0)
          }) as any
        }

        return sumFn
      },

      avg: async (field: string): Promise<number | null> => {
        const events = getFilteredEvents(filter)
        if (events.length === 0) return null
        const sum = events.reduce((sum, e) => {
          const val = e.data[field]
          return sum + (typeof val === 'number' ? val : 0)
        }, 0)
        return sum / events.length
      },

      countUnique: (field: string): CountUniqueQuery => {
        let sinceTime: number | undefined

        const uniquePromise = Promise.resolve().then(async () => {
          const events = getFilteredEvents(filter, sinceTime)
          const unique = new Set(events.map((e) => e.data[field]))
          return unique.size
        })

        const uniqueFn: any = uniquePromise

        uniqueFn.since = (duration: string | number): CountUniqueQuery => {
          sinceTime = getSinceTimestamp(duration)
          return Promise.resolve().then(async () => {
            const events = getFilteredEvents(filter, sinceTime)
            const unique = new Set(events.map((e) => e.data[field]))
            return unique.size
          }) as any
        }

        return uniqueFn
      },
    }

    return whereQuery
  }

  // sum()
  proxy.sum = (field: string): SumQuery => {
    let sinceTime: number | undefined

    const sumPromise = Promise.resolve().then(async () => {
      const events = getEvents(sinceTime)
      return events.reduce((sum, e) => {
        const val = e.data[field]
        return sum + (typeof val === 'number' ? val : 0)
      }, 0)
    })

    const sumFn: any = sumPromise

    sumFn.since = (duration: string | number): Promise<number> => {
      sinceTime = getSinceTimestamp(duration)
      return Promise.resolve().then(async () => {
        const events = getEvents(sinceTime)
        return events.reduce((sum, e) => {
          const val = e.data[field]
          return sum + (typeof val === 'number' ? val : 0)
        }, 0)
      })
    }

    return sumFn
  }

  // avg()
  proxy.avg = async (field: string): Promise<number | null> => {
    const events = getEvents()
    if (events.length === 0) return null
    const sum = events.reduce((sum, e) => {
      const val = e.data[field]
      return sum + (typeof val === 'number' ? val : 0)
    }, 0)
    return sum / events.length
  }

  // min()
  proxy.min = async (field: string): Promise<number | null> => {
    const events = getEvents()
    if (events.length === 0) return null
    let min: number | null = null
    for (const e of events) {
      const val = e.data[field]
      if (typeof val === 'number') {
        if (min === null || val < min) min = val
      }
    }
    return min
  }

  // max()
  proxy.max = async (field: string): Promise<number | null> => {
    const events = getEvents()
    if (events.length === 0) return null
    let max: number | null = null
    for (const e of events) {
      const val = e.data[field]
      if (typeof val === 'number') {
        if (max === null || val > max) max = val
      }
    }
    return max
  }

  // countUnique()
  proxy.countUnique = (field: string): CountUniqueQuery => {
    let sinceTime: number | undefined

    const uniquePromise = Promise.resolve().then(async () => {
      const events = getEvents(sinceTime)
      const unique = new Set(events.map((e) => e.data[field]))
      return unique.size
    })

    const uniqueFn: any = uniquePromise

    uniqueFn.since = (duration: string | number): Promise<number> => {
      sinceTime = getSinceTimestamp(duration)
      return Promise.resolve().then(async () => {
        const events = getEvents(sinceTime)
        const unique = new Set(events.map((e) => e.data[field]))
        return unique.size
      })
    }

    return uniqueFn
  }

  // subscribe()
  proxy.subscribe = (
    handler: (event: TrackedEvent) => void,
    options?: { where?: Record<string, unknown> }
  ): EventSubscription => {
    const id = generateSubscriptionId()

    if (!storage.subscriptions.has(eventType)) {
      storage.subscriptions.set(eventType, [])
    }

    storage.subscriptions.get(eventType)!.push({
      id,
      handler,
      filter: options?.where,
    })

    return {
      id,
      unsubscribe: () => {
        const subs = storage.subscriptions.get(eventType)
        if (subs) {
          const idx = subs.findIndex((s) => s.id === id)
          if (idx !== -1) subs.splice(idx, 1)
        }
      },
    }
  }

  return proxy
}

// =============================================================================
// FUNNEL IMPLEMENTATION
// =============================================================================

function createFunnelQuery(
  steps: FunnelStep[],
  storage: EventStorage
): FunnelQuery {
  return {
    within: (duration: string): FunnelQueryWithin => {
      const parsed = parseDuration(duration)
      const windowMs = parsed.value
      let isStrict = false
      let whereFilter: Record<string, unknown> | undefined

      const calculateFunnel = (events: TrackedEvent[]): FunnelResult => {
        if (steps.length === 0) {
          return { steps: [], overallConversionRate: 0 }
        }

        // Group events by userId
        const userEvents = new Map<string, TrackedEvent[]>()
        for (const event of events) {
          const userId = event.data.userId as string
          if (!userId) continue
          if (!userEvents.has(userId)) userEvents.set(userId, [])
          userEvents.get(userId)!.push(event)
        }

        // Sort each user's events by timestamp
        for (const events of userEvents.values()) {
          events.sort((a, b) => a.timestamp - b.timestamp)
        }

        const stepResults: FunnelStepResult[] = []
        const usersInStep: Set<string>[] = []
        const stepTimes: Map<string, number>[] = []

        for (let i = 0; i < steps.length; i++) {
          usersInStep.push(new Set())
          stepTimes.push(new Map())
        }

        // For each user, check if they complete the funnel
        for (const [userId, events] of userEvents) {
          let lastStepTime = -Infinity
          let lastStepIdx = -1

          for (const event of events) {
            // Find which step this event matches
            for (let stepIdx = 0; stepIdx < steps.length; stepIdx++) {
              const step = steps[stepIdx]!

              if (event.type !== step.eventType) continue
              if (step.filter && !matchesFilter(event, step.filter)) continue

              // Check if this is the next expected step
              if (stepIdx === 0) {
                // First step - always valid
                usersInStep[0]!.add(userId)
                stepTimes[0]!.set(userId, event.timestamp)
                lastStepTime = event.timestamp
                lastStepIdx = 0
              } else if (stepIdx === lastStepIdx + 1) {
                // Next step in sequence
                const prevTime = stepTimes[stepIdx - 1]!.get(userId)
                if (prevTime === undefined) continue

                // Check time window
                if (event.timestamp - prevTime > windowMs) continue

                // For strict mode, ensure this step happens after the previous
                if (isStrict && event.timestamp <= lastStepTime) continue

                usersInStep[stepIdx]!.add(userId)
                stepTimes[stepIdx]!.set(userId, event.timestamp)
                lastStepTime = event.timestamp
                lastStepIdx = stepIdx
              }
              break
            }
          }
        }

        // Build results
        for (let i = 0; i < steps.length; i++) {
          const count = usersInStep[i]!.size
          const prevCount = i === 0 ? count : usersInStep[i - 1]!.size

          // Calculate average time from previous step
          let avgTimeFromPrevious: number | undefined
          if (i > 0) {
            const times: number[] = []
            for (const userId of usersInStep[i]!) {
              const currTime = stepTimes[i]!.get(userId)
              const prevTime = stepTimes[i - 1]!.get(userId)
              if (currTime !== undefined && prevTime !== undefined) {
                times.push(currTime - prevTime)
              }
            }
            if (times.length > 0) {
              avgTimeFromPrevious = times.reduce((a, b) => a + b, 0) / times.length
            }
          }

          stepResults.push({
            count,
            conversionRate: prevCount > 0 ? count / prevCount : i === 0 ? 1 : 0,
            ...(avgTimeFromPrevious !== undefined && { avgTimeFromPrevious }),
          })
        }

        const firstCount = stepResults[0]?.count || 0
        const lastCount = stepResults[stepResults.length - 1]?.count || 0

        return {
          steps: stepResults,
          overallConversionRate: firstCount > 0 ? lastCount / firstCount : 0,
        }
      }

      const getEventsForFunnel = (): TrackedEvent[] => {
        let events = storage.events
        if (whereFilter) {
          events = events.filter((e) => matchesFilter(e, whereFilter!))
        }
        return events
      }

      // Create a thenable that is directly awaitable
      const withinPromise = Promise.resolve().then(async () => {
        return calculateFunnel(getEventsForFunnel())
      })

      const withinQuery: any = withinPromise

      withinQuery.by = async (field: string): Promise<Record<string, FunnelResult>> => {
        const events = getEventsForFunnel()
        const groups = new Map<string, TrackedEvent[]>()

        for (const event of events) {
          const value = event.data[field]
          if (value !== undefined) {
            const key = String(value)
            if (!groups.has(key)) groups.set(key, [])
            groups.get(key)!.push(event)
          }
        }

        const result: Record<string, FunnelResult> = {}
        for (const [key, groupEvents] of groups) {
          result[key] = calculateFunnel(groupEvents)
        }
        return result
      }

      withinQuery.strict = (): FunnelQueryStrict => {
        isStrict = true
        // Return a new thenable with strict mode enabled
        const strictPromise = Promise.resolve().then(async () => {
          return calculateFunnel(getEventsForFunnel())
        })
        return strictPromise as any
      }

      withinQuery.where = (filter: Record<string, unknown>): FunnelQueryWithFilter => {
        whereFilter = filter
        return {
          by: async (field: string): Promise<Record<string, FunnelResult>> => {
            const events = getEventsForFunnel()
            const groups = new Map<string, TrackedEvent[]>()

            for (const event of events) {
              const value = field === 'variant' ? event.variant : event.data[field]
              if (value !== undefined) {
                const key = String(value)
                if (!groups.has(key)) groups.set(key, [])
                groups.get(key)!.push(event)
              }
            }

            const result: Record<string, FunnelResult> = {}
            for (const [key, groupEvents] of groups) {
              result[key] = calculateFunnel(groupEvents)
            }
            return result
          },
        }
      }

      return withinQuery
    },
  }
}

// =============================================================================
// COHORT IMPLEMENTATION
// =============================================================================

function createCohortQuery(
  config: CohortConfig,
  storage: EventStorage
): CohortQuery {
  const calculateCohort = (events: TrackedEvent[]): CohortResult => {
    const { anchor, activity, periods, granularity } = config

    // Find anchor events (e.g., Signup)
    const anchorEvents = events.filter((e) => e.type === anchor)
    const activityEvents = events.filter((e) => e.type === activity)

    // Group anchor events by period and user
    const periodMs = granularity === 'day' ? 24 * 60 * 60 * 1000 : granularity === 'week' ? 7 * 24 * 60 * 60 * 1000 : 30 * 24 * 60 * 60 * 1000

    // Group by cohort period
    const cohortGroups = new Map<number, Map<string, number>>() // periodStart -> (userId -> anchorTime)

    for (const event of anchorEvents) {
      const userId = event.data.userId as string
      if (!userId) continue

      const periodStart = getPeriodStart(event.timestamp, granularity)

      if (!cohortGroups.has(periodStart)) {
        cohortGroups.set(periodStart, new Map())
      }

      const cohort = cohortGroups.get(periodStart)!
      if (!cohort.has(userId)) {
        cohort.set(userId, event.timestamp)
      }
    }

    // Build activity lookup by user
    const userActivities = new Map<string, number[]>()
    for (const event of activityEvents) {
      const userId = event.data.userId as string
      if (!userId) continue

      if (!userActivities.has(userId)) {
        userActivities.set(userId, [])
      }
      userActivities.get(userId)!.push(event.timestamp)
    }

    // Calculate retention for each cohort
    const cohorts: Array<{ startDate: number; size: number; retention: number[] }> = []

    for (const [periodStart, users] of cohortGroups) {
      const size = users.size
      const retention: number[] = []

      for (let period = 1; period < periods; period++) {
        let retainedCount = 0

        for (const [userId, anchorTime] of users) {
          const activities = userActivities.get(userId) || []

          // Check if user had activity in this period
          // retention[0] = period 1 = activity in 1st week after signup (anchorTime+week to anchorTime+2*week)
          const periodStartTime = anchorTime + period * periodMs
          const periodEndTime = anchorTime + (period + 1) * periodMs

          const hasActivity = activities.some(
            (t) => t >= periodStartTime && t < periodEndTime
          )

          if (hasActivity) retainedCount++
        }

        retention.push(size > 0 ? retainedCount / size : 0)
      }

      cohorts.push({ startDate: periodStart, size, retention })
    }

    // Sort by start date
    cohorts.sort((a, b) => a.startDate - b.startDate)

    return { cohorts, granularity }
  }

  // Create a thenable that can be awaited directly
  const cohortPromise = Promise.resolve().then(async () => {
    return calculateCohort(storage.events)
  })

  const cohortQuery: any = cohortPromise

  cohortQuery.by = async (field: string): Promise<Record<string, CohortResult>> => {
    const groups = new Map<string, TrackedEvent[]>()

    for (const event of storage.events) {
      const value = event.data[field]
      if (value !== undefined) {
        const key = String(value)
        if (!groups.has(key)) groups.set(key, [])
        groups.get(key)!.push(event)
      }
    }

    const result: Record<string, CohortResult> = {}
    for (const [key, groupEvents] of groups) {
      result[key] = calculateCohort(groupEvents)
    }
    return result
  }

  return cohortQuery
}

// =============================================================================
// STEP HELPER
// =============================================================================

/**
 * Create a funnel step definition
 */
export function $step(eventType: string): {
  where: (filter: Record<string, unknown>) => FunnelStep
} & FunnelStep {
  const step: FunnelStep & { where?: (filter: Record<string, unknown>) => FunnelStep } = { eventType }
  step.where = (filter: Record<string, unknown>): FunnelStep => {
    return { eventType, filter }
  }
  return step as { where: (filter: Record<string, unknown>) => FunnelStep } & FunnelStep
}

// =============================================================================
// TRACK PROXY
// =============================================================================

function createTrackProxy(storage: EventStorage): TrackProxy {
  const cache = new Map<string, EventProxy>()

  const proxy = new Proxy(
    {},
    {
      get(target, prop: string) {
        if (prop === 'batch') {
          return async (
            events: Array<{ event: string; data: Record<string, unknown>; options?: TrackOptions }>
          ): Promise<TrackedEvent[]> => {
            const results: TrackedEvent[] = []
            const baseTime = Date.now()

            for (let i = 0; i < events.length; i++) {
              const { event: eventType, data, options } = events[i]!

              const trackedEvent: TrackedEvent = {
                id: generateId(),
                type: eventType,
                data,
                timestamp: baseTime + i, // Sequential timestamps
                ...(options?.experiment && { experiment: options.experiment }),
                ...(options?.variant && { variant: options.variant }),
              }

              storage.events.push(trackedEvent)
              results.push(trackedEvent)

              // Notify subscribers
              const subs = storage.subscriptions.get(eventType) || []
              for (const sub of subs) {
                if (!sub.filter || matchesFilter(trackedEvent, sub.filter)) {
                  sub.handler(trackedEvent)
                }
              }
            }

            return results
          }
        }

        if (prop === 'funnel') {
          return (steps: FunnelStep[]): FunnelQuery => {
            return createFunnelQuery(steps, storage)
          }
        }

        if (prop === 'cohort') {
          return (config: CohortConfig): CohortQuery => {
            return createCohortQuery(config, storage)
          }
        }

        if (prop === 'ratio') {
          return async (numerator: string, denominator: string): Promise<number> => {
            // Parse denominator - may include filter like "PageView:/pricing"
            let denomEventType = denominator
            let denomFilter: Record<string, unknown> | undefined

            if (denominator.includes(':')) {
              const [type, path] = denominator.split(':')
              denomEventType = type!
              denomFilter = { path }
            }

            const numeratorEvents = storage.events.filter((e) => e.type === numerator)
            const denominatorEvents = storage.events.filter((e) => {
              if (e.type !== denomEventType) return false
              if (denomFilter && !matchesFilter(e, denomFilter)) return false
              return true
            })

            if (denominatorEvents.length === 0) return 0
            return numeratorEvents.length / denominatorEvents.length
          }
        }

        // Return cached event proxy or create new one
        if (!cache.has(prop)) {
          cache.set(prop, createEventProxy(prop, storage))
        }
        return cache.get(prop)
      },
    }
  )

  return proxy
}

// =============================================================================
// CONTEXT FACTORY
// =============================================================================

export interface TrackContext {
  track: TrackProxy
  _storage: {
    put: (type: string, data: Record<string, unknown>, timestamp: number) => Promise<void>
    clear: () => Promise<void>
  }
}

/**
 * Create a track context for event tracking
 */
export function createTrackContext(): TrackContext {
  const storage = createStorage()

  return {
    track: createTrackProxy(storage),
    _storage: {
      put: async (type: string, data: Record<string, unknown>, timestamp: number): Promise<void> => {
        const event: TrackedEvent = {
          id: generateId(),
          type,
          data,
          timestamp,
        }
        storage.events.push(event)
      },
      clear: async (): Promise<void> => {
        storage.events.length = 0
      },
    },
  }
}
