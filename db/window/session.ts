/**
 * SessionWindow - Gap-based windows per key
 */

import { parseDuration, generateWindowId } from './utils'
import type {
  SessionWindowOptions,
  TimestampedEvent,
  WindowState,
  ClosedWindowResult,
  AggregateFunction,
  KeyExtractor,
  BaseTrigger,
} from './types'

interface InternalSession<T> {
  windowId: string
  startTime: number
  endTime: number
  events: T[]
  key: string
  status: 'active' | 'closed'
  lastEventTime: number
}

export class SessionWindow<T extends TimestampedEvent, R = unknown> {
  readonly gap: number
  readonly keyExtractor: (event: T) => string
  readonly aggregate?: AggregateFunction<T, R>
  readonly trigger?: BaseTrigger

  private sessions: Map<string, InternalSession<T>[]> = new Map()
  private latestTimestamp: number = 0

  constructor(options: SessionWindowOptions<T, R>) {
    this.gap = parseDuration(options.gap)
    this.aggregate = options.aggregate as AggregateFunction<T, R> | undefined
    this.trigger = options.trigger

    // Convert string keyBy to function
    if (typeof options.keyBy === 'string') {
      const key = options.keyBy
      this.keyExtractor = (event: T) => (event as Record<string, unknown>)[key] as string
    } else {
      this.keyExtractor = options.keyBy
    }
  }

  /**
   * Add an event to the appropriate session
   */
  async add(event: T): Promise<void> {
    const key = this.keyExtractor(event)

    // Update latest timestamp for closing sessions
    if (event.timestamp > this.latestTimestamp) {
      this.latestTimestamp = event.timestamp
      this.closeOldSessions()
    }

    let keySessions = this.sessions.get(key)
    if (!keySessions) {
      keySessions = []
      this.sessions.set(key, keySessions)
    }

    // Find sessions that this event can extend or merge
    const sessionsToMerge: InternalSession<T>[] = []
    let remainingSessions: InternalSession<T>[] = []

    for (const session of keySessions) {
      // Check if event is within gap of session bounds
      const eventInGapBefore = event.timestamp >= session.startTime - this.gap
      const eventInGapAfter = event.timestamp <= session.endTime + this.gap

      if (eventInGapBefore && eventInGapAfter) {
        sessionsToMerge.push(session)
      } else {
        remainingSessions.push(session)
      }
    }

    let mergedSession: InternalSession<T>

    if (sessionsToMerge.length === 0) {
      // Create new session
      mergedSession = {
        windowId: generateWindowId('session', event.timestamp),
        startTime: event.timestamp,
        endTime: event.timestamp,
        events: [event],
        key,
        status: 'active',
        lastEventTime: event.timestamp,
      }
    } else {
      // Merge all overlapping sessions with the new event
      const allEvents = [event, ...sessionsToMerge.flatMap((s) => s.events)]
      allEvents.sort((a, b) => a.timestamp - b.timestamp)

      mergedSession = {
        windowId: sessionsToMerge[0].windowId,
        startTime: Math.min(event.timestamp, ...sessionsToMerge.map((s) => s.startTime)),
        endTime: Math.max(event.timestamp, ...sessionsToMerge.map((s) => s.endTime)),
        events: allEvents,
        key,
        status: 'active',
        lastEventTime: Math.max(event.timestamp, ...sessionsToMerge.map((s) => s.lastEventTime)),
      }
    }

    // Now check if the merged session overlaps with any remaining sessions (transitive merge)
    let needsAnotherPass = true
    while (needsAnotherPass) {
      needsAnotherPass = false
      const newRemaining: InternalSession<T>[] = []

      for (const session of remainingSessions) {
        // Check if merged session and this session overlap (considering gap on both sides)
        const mergedStart = mergedSession.startTime - this.gap
        const mergedEnd = mergedSession.endTime + this.gap
        const sessionStart = session.startTime - this.gap
        const sessionEnd = session.endTime + this.gap

        // Sessions can merge if the gap between them is <= this.gap
        // That means: end of one + gap >= start of the other
        const gapBetween = Math.max(
          session.startTime - mergedSession.endTime,
          mergedSession.startTime - session.endTime
        )
        const overlaps = gapBetween <= this.gap

        if (overlaps) {
          // Merge this session into mergedSession
          const allEvents = [...mergedSession.events, ...session.events]
          allEvents.sort((a, b) => a.timestamp - b.timestamp)

          mergedSession = {
            windowId: mergedSession.windowId,
            startTime: Math.min(mergedSession.startTime, session.startTime),
            endTime: Math.max(mergedSession.endTime, session.endTime),
            events: allEvents,
            key,
            status: 'active',
            lastEventTime: Math.max(mergedSession.lastEventTime, session.lastEventTime),
          }
          needsAnotherPass = true
        } else {
          newRemaining.push(session)
        }
      }

      remainingSessions = newRemaining
    }

    remainingSessions.push(mergedSession)
    this.sessions.set(key, remainingSessions)
  }

  /**
   * Close sessions where the gap has been exceeded
   */
  private closeOldSessions(): void {
    for (const [key, keySessions] of this.sessions) {
      for (const session of keySessions) {
        if (session.status === 'active') {
          // Session is closed if latest timestamp is beyond the gap from last event
          if (this.latestTimestamp - session.lastEventTime > this.gap) {
            session.status = 'closed'
          }
        }
      }
    }
  }

  /**
   * Get all sessions for a key
   */
  async getByKey(key: string): Promise<WindowState<T, R>[]> {
    const keySessions = this.sessions.get(key) || []
    return keySessions
      .sort((a, b) => a.startTime - b.startTime)
      .map((s) => ({
        windowId: s.windowId,
        startTime: s.startTime,
        endTime: s.endTime,
        events: s.events,
        result: this.computeResult(s.events),
        key: s.key,
      }))
  }

  /**
   * Get all active sessions
   */
  async getActive(): Promise<WindowState<T, R>[]> {
    const active: WindowState<T, R>[] = []
    for (const keySessions of this.sessions.values()) {
      for (const session of keySessions) {
        if (session.status === 'active') {
          active.push({
            windowId: session.windowId,
            startTime: session.startTime,
            endTime: session.endTime,
            events: session.events,
            result: this.computeResult(session.events),
            key: session.key,
          })
        }
      }
    }
    return active.sort((a, b) => a.startTime - b.startTime)
  }

  /**
   * Get all closed sessions
   */
  async getClosed(options?: { limit?: number }): Promise<ClosedWindowResult<R>[]> {
    const closed: ClosedWindowResult<R>[] = []
    for (const keySessions of this.sessions.values()) {
      for (const session of keySessions) {
        if (session.status === 'closed') {
          closed.push({
            windowId: session.windowId,
            startTime: session.startTime,
            endTime: session.endTime,
            result: this.computeResult(session.events),
            key: session.key,
          })
        }
      }
    }

    const sorted = closed.sort((a, b) => a.startTime - b.startTime)
    if (options?.limit) {
      return sorted.slice(0, options.limit)
    }
    return sorted
  }

  /**
   * Compute aggregate result
   */
  private computeResult(events: T[]): R {
    if (this.aggregate && events.length > 0) {
      return this.aggregate(events)
    }
    return {} as R
  }
}
