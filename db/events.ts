// Events/Actions storage - immutable event log

export interface Event {
  $id: string
  type: string
  payload: unknown
  $timestamp: number
  source?: string      // Who emitted (thing $id, system, etc.)
  correlationId?: string // For tracing related events
}

export interface EventsStore {
  emit(event: Omit<Event, '$id' | '$timestamp'>): Promise<Event>
  get(id: string): Promise<Event | null>
  query(options?: EventQueryOptions): Promise<Event[]>
  subscribe(handler: (event: Event) => void): () => void
}

export interface EventQueryOptions {
  type?: string
  source?: string
  correlationId?: string
  since?: number
  until?: number
  limit?: number
  offset?: number
}

function generateEventId(): string {
  return `evt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

export function createEventsStore(): EventsStore {
  const events: Event[] = []
  const subscribers = new Set<(event: Event) => void>()

  return {
    async emit(data) {
      const event: Event = {
        ...data,
        $id: generateEventId(),
        $timestamp: Date.now()
      }

      events.push(event)

      // Notify subscribers
      subscribers.forEach(handler => {
        try {
          handler(event)
        } catch (e) {
          console.error('Event subscriber error:', e)
        }
      })

      return event
    },

    async get(id) {
      return events.find(e => e.$id === id) ?? null
    },

    async query(options = {}) {
      const { type, source, correlationId, since, until, limit = 100, offset = 0 } = options

      let results = events.filter(e => {
        if (type && e.type !== type) return false
        if (source && e.source !== source) return false
        if (correlationId && e.correlationId !== correlationId) return false
        if (since && e.$timestamp < since) return false
        if (until && e.$timestamp > until) return false
        return true
      })

      // Sort by timestamp descending (newest first)
      results.sort((a, b) => b.$timestamp - a.$timestamp)

      return results.slice(offset, offset + limit)
    },

    subscribe(handler) {
      subscribers.add(handler)
      return () => subscribers.delete(handler)
    }
  }
}
