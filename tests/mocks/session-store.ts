/**
 * Mock Session Store for testing
 *
 * Implements an in-memory session store for testing the replay API.
 * Provides methods to add sessions and events, and to query the store.
 *
 * @see tests/session-replay/replay.test.ts
 */
import { vi, type Mock } from 'vitest'

// ============================================================================
// Types
// ============================================================================

export type SessionEventType = 'request' | 'response' | 'error' | 'log' | 'custom'

export interface SessionEvent {
  id: string
  correlationId: string
  timestamp: number
  type: SessionEventType
  data: Record<string, unknown>
  source?: 'frontend' | 'backend'
  sequence?: number
}

export interface SessionDetails {
  id: string
  correlationId: string
  userId?: string
  startTime: number
  endTime: number
  events: SessionEvent[]
  metadata?: Record<string, unknown>
}

export interface SessionSummary {
  id: string
  correlationId: string
  userId?: string
  startTime: number
  endTime: number
  eventCount: number
  hasErrors: boolean
  duration: number
}

/**
 * Mock Session Store with inspection and simulation capabilities
 */
export interface MockSessionStore {
  /** All sessions in the store */
  sessions: SessionDetails[]
  /** Add a session to the store */
  addSession(session: SessionDetails): void
  /** Add an event to a session */
  addEvent(sessionId: string, event: SessionEvent): void
  /** Clear all sessions */
  clear(): void
  /** Get a session by ID */
  getSession(id: string): SessionDetails | undefined
  /** Get events for a session */
  getEvents(sessionId: string): SessionEvent[]
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Creates a mock session store for testing
 *
 * NOTE: For test isolation, this resets and returns the global store.
 * This ensures that the handler and tests share the same store instance.
 *
 * @returns The global MockSessionStore instance (reset to empty state)
 *
 * @example
 * ```typescript
 * const store = createMockSessionStore()
 * store.addSession({ id: 'session-1', ... })
 * store.addEvent('session-1', { id: 'evt-1', ... })
 * expect(store.sessions).toHaveLength(1)
 * ```
 */
export function createMockSessionStore(): MockSessionStore {
  // Reset global store to ensure test isolation
  resetGlobalSessionStore()
  // Return the global store so handler and tests share it
  return getGlobalSessionStore()
}

// ============================================================================
// Singleton for sharing between modules
// ============================================================================

let globalStore: MockSessionStore | null = null

/**
 * Gets or creates the global mock session store
 * This allows the replay handler and tests to share the same store
 */
export function getGlobalSessionStore(): MockSessionStore {
  if (!globalStore) {
    globalStore = createMockSessionStoreInternal()
  }
  return globalStore
}

/**
 * Resets the global session store (for testing)
 */
export function resetGlobalSessionStore(): void {
  if (globalStore) {
    globalStore.clear()
  }
  globalStore = null
}

/**
 * Internal factory that creates an independent store
 */
function createMockSessionStoreInternal(): MockSessionStore {
  const sessions: SessionDetails[] = []

  return {
    sessions,

    addSession(session: SessionDetails): void {
      // Clone the session to prevent external mutations
      const cloned = { ...session, events: [...(session.events || [])] }
      sessions.push(cloned)
    },

    addEvent(sessionId: string, event: SessionEvent): void {
      const session = sessions.find((s) => s.id === sessionId)
      if (session) {
        session.events.push({ ...event })
        // Update endTime if this event is newer
        if (event.timestamp > session.endTime) {
          session.endTime = event.timestamp
        }
        // Update startTime if this event is older
        if (event.timestamp < session.startTime) {
          session.startTime = event.timestamp
        }
      }
    },

    clear(): void {
      sessions.length = 0
    },

    getSession(id: string): SessionDetails | undefined {
      return sessions.find((s) => s.id === id)
    },

    getEvents(sessionId: string): SessionEvent[] {
      const session = sessions.find((s) => s.id === sessionId)
      return session ? session.events : []
    },
  }
}
