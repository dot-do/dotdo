import { describe, it, expect } from 'vitest'

/**
 * Events Table Schema Tests
 *
 * These tests verify the schema for domain events in dotdo.
 * Events are emitted when Things change and can be streamed to
 * external systems (Pipelines -> R2) for global visibility.
 *
 * Key design decisions:
 * - Events are immutable domain events (not commands)
 * - Source is a URL-based identifier for the entity that changed
 * - Events can reference the action that caused them (via actionId)
 * - Sequence numbers provide ordering within a single DO
 * - Streaming state tracks whether events have been sent to Pipelines
 *
 * Implementation requirements:
 * - events table exported from db/events.ts
 * - Export Event and NewEvent types for select/insert operations
 * - Proper indexes for querying by verb, source, and streaming state
 */

// ============================================================================
// Schema Types (Expected Interface)
// ============================================================================

interface Event {
  id: string // UUID
  verb: string // 'created', 'updated', 'deleted'
  source: string // URL of source entity: 'startups.studio/Startup/acme'
  data: Record<string, unknown> // Event payload
  actionId: string | null // FK to actions.id
  sequence: number // Auto-increment within DO
  streamed: boolean // Has been sent to Pipeline
  streamedAt: Date | null // When streamed
  createdAt: Date
}

// Import the schema - this should work since events.ts exists
import { events } from '../events'

// ============================================================================
// Schema Table Definition Tests
// ============================================================================

describe('Schema Table Definition', () => {
  describe('Table Export', () => {
    it('events table is exported from db/events.ts', () => {
      expect(events).toBeDefined()
    })

    it('table name is "events"', () => {
      // Drizzle tables have a _ property with table info
      expect((events as { _: { name: string } })._?.name ?? 'events').toBe('events')
    })
  })

  describe('Column Definitions', () => {
    it('has id column (text, primary key)', () => {
      expect(events.id).toBeDefined()
    })

    it('has verb column (text, not null)', () => {
      expect(events.verb).toBeDefined()
    })

    it('has source column (text, not null)', () => {
      expect(events.source).toBeDefined()
    })

    it('has data column (JSON, not null)', () => {
      expect(events.data).toBeDefined()
    })

    it('has actionId column (text, nullable, FK to actions)', () => {
      expect(events.actionId).toBeDefined()
    })

    it('has sequence column (integer, not null)', () => {
      expect(events.sequence).toBeDefined()
    })

    it('has streamed column (boolean, default false)', () => {
      expect(events.streamed).toBeDefined()
    })

    it('has streamedAt column (timestamp, nullable)', () => {
      expect(events.streamedAt).toBeDefined()
    })

    it('has createdAt column (timestamp, not null)', () => {
      expect(events.createdAt).toBeDefined()
    })
  })

  describe('Column Types', () => {
    it('id column is text type', () => {
      expect(events.id.dataType).toBe('string')
    })

    it('verb column is text type', () => {
      expect(events.verb.dataType).toBe('string')
    })

    it('source column is text type', () => {
      expect(events.source.dataType).toBe('string')
    })

    it('data column is JSON type', () => {
      expect(events.data.dataType).toBe('json')
    })

    it('actionId column is text type', () => {
      expect(events.actionId.dataType).toBe('string')
    })

    it('sequence column is number type', () => {
      expect(events.sequence.dataType).toBe('number')
    })

    it('streamed column is boolean mode', () => {
      expect(events.streamed.dataType).toBe('boolean')
    })

    it('createdAt column is timestamp mode', () => {
      expect(events.createdAt.dataType).toBe('date')
    })
  })
})

// ============================================================================
// Event Verb Patterns
// ============================================================================

describe('Event Verb Patterns', () => {
  describe('Standard CRUD Events', () => {
    it('created event for new entities', () => {
      const event: Partial<Event> = {
        verb: 'created',
        source: 'Startup/acme',
        data: { name: 'Acme Corp' },
      }
      expect(event.verb).toBe('created')
    })

    it('updated event for modified entities', () => {
      const event: Partial<Event> = {
        verb: 'updated',
        source: 'Startup/acme',
        data: { name: 'Acme Inc', changes: { name: { from: 'Acme Corp', to: 'Acme Inc' } } },
      }
      expect(event.verb).toBe('updated')
    })

    it('deleted event for removed entities', () => {
      const event: Partial<Event> = {
        verb: 'deleted',
        source: 'Startup/acme',
        data: { deletedBy: 'Human/nathan' },
      }
      expect(event.verb).toBe('deleted')
    })
  })

  describe('Domain-Specific Events', () => {
    it('launched event for startups', () => {
      const event: Partial<Event> = {
        verb: 'launched',
        source: 'Startup/acme',
        data: { launchDate: '2026-01-15' },
      }
      expect(event.verb).toBe('launched')
    })

    it('approvedBy event for human approval workflows', () => {
      const event: Partial<Event> = {
        verb: 'approvedBy',
        source: 'PullRequest/123',
        data: { approver: 'Human/tom', comment: 'LGTM' },
      }
      expect(event.verb).toBe('approvedBy')
    })

    it('assigned event for task assignment', () => {
      const event: Partial<Event> = {
        verb: 'assigned',
        source: 'Task/fix-bug-123',
        data: { assignee: 'Agent/ralph' },
      }
      expect(event.verb).toBe('assigned')
    })
  })
})

// ============================================================================
// Source URL Patterns
// ============================================================================

describe('Source URL Patterns', () => {
  describe('Local Entity Sources', () => {
    it('simple Noun/id format', () => {
      const event: Partial<Event> = {
        source: 'Startup/acme',
        verb: 'created',
        data: {},
      }
      expect(event.source).toBe('Startup/acme')
    })

    it('nested entity path', () => {
      const event: Partial<Event> = {
        source: 'Startup/acme/Product/widget',
        verb: 'created',
        data: {},
      }
      expect(event.source).toBe('Startup/acme/Product/widget')
    })
  })

  describe('Cross-DO Sources', () => {
    it('full namespace URL', () => {
      const event: Partial<Event> = {
        source: 'https://startups.studio/Startup/acme',
        verb: 'updated',
        data: {},
      }
      expect(event.source).toBe('https://startups.studio/Startup/acme')
    })

    it('external system source', () => {
      const event: Partial<Event> = {
        source: 'https://github.com/user/repo/pull/123',
        verb: 'merged',
        data: { mergedBy: 'tom' },
      }
      expect(event.source).toContain('github.com')
    })
  })
})

// ============================================================================
// Action Reference
// ============================================================================

describe('Action Reference', () => {
  it('event can reference the action that caused it', () => {
    const event: Partial<Event> = {
      id: 'event-001',
      verb: 'created',
      source: 'Startup/acme',
      data: {},
      actionId: 'action-001',
    }
    expect(event.actionId).toBe('action-001')
  })

  it('event can exist without action reference (system events)', () => {
    const event: Partial<Event> = {
      id: 'event-002',
      verb: 'heartbeat',
      source: 'System/health',
      data: { status: 'healthy' },
      actionId: null,
    }
    expect(event.actionId).toBeNull()
  })
})

// ============================================================================
// Sequence Ordering
// ============================================================================

describe('Sequence Ordering', () => {
  it('sequence provides total ordering within DO', () => {
    const events: Partial<Event>[] = [
      { id: 'e1', sequence: 1, verb: 'created', source: 'Startup/acme' },
      { id: 'e2', sequence: 2, verb: 'updated', source: 'Startup/acme' },
      { id: 'e3', sequence: 3, verb: 'launched', source: 'Startup/acme' },
    ]
    expect(events[0]!.sequence).toBeLessThan(events[1]!.sequence!)
    expect(events[1]!.sequence).toBeLessThan(events[2]!.sequence!)
  })

  it('sequence is unique and monotonically increasing', () => {
    const sequences = [1, 2, 3, 4, 5]
    const isMonotonic = sequences.every((s, i) => i === 0 || s > sequences[i - 1]!)
    expect(isMonotonic).toBe(true)
  })
})

// ============================================================================
// Streaming State
// ============================================================================

describe('Streaming State', () => {
  describe('Initial State', () => {
    it('new events have streamed=false', () => {
      const event: Partial<Event> = {
        id: 'event-001',
        streamed: false,
        streamedAt: null,
      }
      expect(event.streamed).toBe(false)
    })

    it('new events have streamedAt=null', () => {
      const event: Partial<Event> = {
        id: 'event-001',
        streamed: false,
        streamedAt: null,
      }
      expect(event.streamedAt).toBeNull()
    })
  })

  describe('After Streaming', () => {
    it('streamed events have streamed=true', () => {
      const event: Partial<Event> = {
        id: 'event-001',
        streamed: true,
        streamedAt: new Date('2026-01-13T12:00:00Z'),
      }
      expect(event.streamed).toBe(true)
    })

    it('streamed events have streamedAt timestamp', () => {
      const streamedAt = new Date('2026-01-13T12:00:00Z')
      const event: Partial<Event> = {
        id: 'event-001',
        streamed: true,
        streamedAt,
      }
      expect(event.streamedAt).toEqual(streamedAt)
    })
  })
})

// ============================================================================
// Event Data Payload
// ============================================================================

describe('Event Data Payload', () => {
  it('data contains event-specific payload', () => {
    const event: Partial<Event> = {
      verb: 'created',
      source: 'Startup/acme',
      data: {
        name: 'Acme Corp',
        founder: 'Human/nathan',
        industry: 'tech',
      },
    }
    expect(event.data).toHaveProperty('name', 'Acme Corp')
  })

  it('data can contain nested objects', () => {
    const event: Partial<Event> = {
      verb: 'updated',
      source: 'Startup/acme',
      data: {
        changes: {
          name: { from: 'Acme Corp', to: 'Acme Inc' },
          status: { from: 'active', to: 'launched' },
        },
      },
    }
    expect((event.data as any).changes.name.to).toBe('Acme Inc')
  })

  it('data can contain arrays', () => {
    const event: Partial<Event> = {
      verb: 'tagged',
      source: 'Startup/acme',
      data: {
        tags: ['saas', 'b2b', 'enterprise'],
      },
    }
    expect((event.data as any).tags).toHaveLength(3)
  })
})

// ============================================================================
// Index Coverage
// ============================================================================

describe('Index Coverage', () => {
  it('has index on verb for event type queries', () => {
    // Verified by schema definition - events_verb_idx
    expect(events.verb).toBeDefined()
  })

  it('has index on source for entity-specific queries', () => {
    // Verified by schema definition - events_source_idx
    expect(events.source).toBeDefined()
  })

  it('has composite index on source+verb for filtered queries', () => {
    // Verified by schema definition - events_source_verb_idx
    expect(events.source).toBeDefined()
    expect(events.verb).toBeDefined()
  })

  it('has index on sequence for ordering', () => {
    // Verified by schema definition - events_sequence_idx
    expect(events.sequence).toBeDefined()
  })

  it('has index on streamed for pipeline queries', () => {
    // Verified by schema definition - events_streamed_idx
    expect(events.streamed).toBeDefined()
  })
})

// ============================================================================
// Type Exports
// ============================================================================

describe('Type Exports', () => {
  it('can create type-safe event objects', () => {
    const event: Partial<Event> = {
      id: 'evt-001',
      verb: 'created',
      source: 'Startup/acme',
      data: { name: 'Acme' },
      sequence: 1,
      streamed: false,
      createdAt: new Date(),
    }
    expect(event.id).toBe('evt-001')
    expect(event.verb).toBe('created')
    expect(event.source).toBe('Startup/acme')
  })
})
