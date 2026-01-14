/**
 * ACID Test Suite - Phase 5: E2E Test Fixtures
 *
 * E2E-specific test fixtures for pipeline tests, including test data
 * generators, event fixtures, and cleanup utilities.
 *
 * @see docs/plans/2026-01-09-acid-test-suite-design.md - Phase 5 E2E Pipeline
 */

import { generateTestResourceName } from '../config'
import type { PipelineEvent } from '../context'

// ============================================================================
// THING FIXTURES
// ============================================================================

/**
 * Thing data structure for test fixtures
 */
export interface ThingFixture {
  $id: string
  $type: string
  data: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

/**
 * Create a test Thing fixture
 */
export function createThingFixture(overrides: Partial<ThingFixture> = {}): ThingFixture {
  const id = overrides.$id || generateTestResourceName('thing')
  const now = new Date().toISOString()

  return {
    $id: id,
    $type: 'TestThing',
    data: {
      name: `Test Thing ${id}`,
      value: Math.random() * 1000,
      nested: {
        level: 1,
        items: ['a', 'b', 'c'],
      },
    },
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

/**
 * Create multiple Thing fixtures
 */
export function createThingFixtures(count: number, typePrefix = 'TestThing'): ThingFixture[] {
  return Array.from({ length: count }, (_, index) =>
    createThingFixture({
      $type: `${typePrefix}${index % 3}`, // Distribute across 3 types
      data: {
        name: `Thing ${index}`,
        index,
        batch: Math.floor(index / 10),
      },
    })
  )
}

// ============================================================================
// EVENT FIXTURES
// ============================================================================

/**
 * Event types for test fixtures
 */
export const EVENT_TYPES = {
  // Thing lifecycle events
  THING_CREATED: 'thing.created',
  THING_UPDATED: 'thing.updated',
  THING_DELETED: 'thing.deleted',

  // DO lifecycle events
  LIFECYCLE_FORK: 'lifecycle.fork',
  LIFECYCLE_COMPACT: 'lifecycle.compact',
  LIFECYCLE_MOVE: 'lifecycle.move',
  LIFECYCLE_CLONE: 'lifecycle.clone',
  LIFECYCLE_PROMOTE: 'lifecycle.promote',
  LIFECYCLE_DEMOTE: 'lifecycle.demote',

  // Sharding events
  SHARD_CREATED: 'shard.created',
  SHARD_ROUTED: 'shard.routed',
  SHARD_MERGED: 'shard.merged',

  // Replication events
  REPLICA_CREATED: 'replica.created',
  REPLICA_SYNCED: 'replica.synced',
  REPLICA_PROMOTED: 'replica.promoted',
  REPLICA_FAILED: 'replica.failed',
} as const

export type EventType = (typeof EVENT_TYPES)[keyof typeof EVENT_TYPES]

/**
 * Create a pipeline event fixture
 */
export function createEventFixture(overrides: Partial<PipelineEvent> = {}): PipelineEvent {
  const id = overrides.id || generateTestResourceName('event')
  const timestamp = overrides.timestamp || new Date().toISOString()

  return {
    id,
    type: EVENT_TYPES.THING_CREATED,
    source: 'test.e2e.do',
    timestamp,
    correlationId: generateTestResourceName('corr'),
    payload: {
      thingId: generateTestResourceName('thing'),
      thingType: 'TestThing',
      action: 'create',
    },
    metadata: {
      version: 1,
      sequence: 1,
    },
    ...overrides,
  }
}

/**
 * Create a Thing created event fixture
 */
export function createThingCreatedEvent(thing: ThingFixture, source: string): PipelineEvent {
  return createEventFixture({
    type: EVENT_TYPES.THING_CREATED,
    source,
    payload: {
      thingId: thing.$id,
      thingType: thing.$type,
      data: thing.data,
      action: 'create',
    },
  })
}

/**
 * Create a Thing updated event fixture
 */
export function createThingUpdatedEvent(
  thing: ThingFixture,
  source: string,
  changes: Record<string, unknown>
): PipelineEvent {
  return createEventFixture({
    type: EVENT_TYPES.THING_UPDATED,
    source,
    payload: {
      thingId: thing.$id,
      thingType: thing.$type,
      changes,
      action: 'update',
    },
  })
}

/**
 * Create a Thing deleted event fixture
 */
export function createThingDeletedEvent(thing: ThingFixture, source: string): PipelineEvent {
  return createEventFixture({
    type: EVENT_TYPES.THING_DELETED,
    source,
    payload: {
      thingId: thing.$id,
      thingType: thing.$type,
      action: 'delete',
    },
  })
}

/**
 * Create a lifecycle event fixture
 */
export function createLifecycleEvent(
  operation: 'fork' | 'compact' | 'move' | 'clone' | 'promote' | 'demote',
  source: string,
  details: Record<string, unknown> = {}
): PipelineEvent {
  const typeMap = {
    fork: EVENT_TYPES.LIFECYCLE_FORK,
    compact: EVENT_TYPES.LIFECYCLE_COMPACT,
    move: EVENT_TYPES.LIFECYCLE_MOVE,
    clone: EVENT_TYPES.LIFECYCLE_CLONE,
    promote: EVENT_TYPES.LIFECYCLE_PROMOTE,
    demote: EVENT_TYPES.LIFECYCLE_DEMOTE,
  }

  return createEventFixture({
    type: typeMap[operation],
    source,
    payload: {
      operation,
      ...details,
    },
  })
}

/**
 * Create multiple event fixtures for testing
 */
export function createEventFixtures(
  count: number,
  options: {
    types?: EventType[]
    source?: string
    correlationId?: string
  } = {}
): PipelineEvent[] {
  const types = options.types || [EVENT_TYPES.THING_CREATED]
  const source = options.source || 'test.e2e.do'
  const correlationId = options.correlationId || generateTestResourceName('corr')

  return Array.from({ length: count }, (_, index) =>
    createEventFixture({
      type: types[index % types.length],
      source,
      correlationId,
      payload: {
        index,
        batch: Math.floor(index / 10),
      },
      metadata: {
        version: 1,
        sequence: index + 1,
      },
    })
  )
}

// ============================================================================
// HIGH VOLUME FIXTURES
// ============================================================================

/**
 * Generate high-volume event stream for stress testing
 */
export function* generateHighVolumeEvents(
  count: number,
  options: {
    source?: string
    correlationId?: string
    types?: EventType[]
    batchSize?: number
  } = {}
): Generator<PipelineEvent[], void, unknown> {
  const source = options.source || 'stress-test.e2e.do'
  const correlationId = options.correlationId || generateTestResourceName('stress')
  const types = options.types || [EVENT_TYPES.THING_CREATED, EVENT_TYPES.THING_UPDATED]
  const batchSize = options.batchSize || 100

  let generated = 0
  let sequence = 1

  while (generated < count) {
    const remaining = count - generated
    const currentBatch = Math.min(batchSize, remaining)

    const events = Array.from({ length: currentBatch }, () => {
      const event = createEventFixture({
        type: types[generated % types.length],
        source,
        correlationId,
        metadata: {
          version: 1,
          sequence: sequence++,
        },
      })
      generated++
      return event
    })

    yield events
  }
}

/**
 * Create a large payload event for size limit testing
 */
export function createLargePayloadEvent(
  sizeBytes: number,
  source: string = 'large-payload.e2e.do'
): PipelineEvent {
  // Generate a string of specified size (approximately)
  const padding = 'x'.repeat(Math.max(0, sizeBytes - 200)) // Account for base event size

  return createEventFixture({
    type: EVENT_TYPES.THING_CREATED,
    source,
    payload: {
      largeData: padding,
      sizeBytes,
      generated: true,
    },
  })
}

// ============================================================================
// SCHEMA FIXTURES
// ============================================================================

/**
 * Event schema for validation
 */
export const EVENT_SCHEMA = {
  type: 'object',
  required: ['id', 'type', 'source', 'timestamp', 'payload'],
  properties: {
    id: { type: 'string', minLength: 1 },
    type: { type: 'string', minLength: 1 },
    source: { type: 'string', minLength: 1 },
    timestamp: { type: 'string', format: 'date-time' },
    correlationId: { type: 'string' },
    payload: { type: 'object' },
    metadata: {
      type: 'object',
      properties: {
        version: { type: 'number' },
        branch: { type: 'string' },
        sequence: { type: 'number' },
      },
    },
  },
} as const

/**
 * Validate an event matches the expected schema
 */
export function validateEventSchema(event: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  if (typeof event !== 'object' || event === null) {
    return { valid: false, errors: ['Event must be an object'] }
  }

  const e = event as Record<string, unknown>

  // Required fields
  if (typeof e.id !== 'string' || e.id.length === 0) {
    errors.push('Event id must be a non-empty string')
  }
  if (typeof e.type !== 'string' || e.type.length === 0) {
    errors.push('Event type must be a non-empty string')
  }
  if (typeof e.source !== 'string' || e.source.length === 0) {
    errors.push('Event source must be a non-empty string')
  }
  if (typeof e.timestamp !== 'string') {
    errors.push('Event timestamp must be a string')
  } else if (isNaN(Date.parse(e.timestamp))) {
    errors.push('Event timestamp must be a valid ISO date string')
  }
  if (typeof e.payload !== 'object' || e.payload === null) {
    errors.push('Event payload must be an object')
  }

  // Optional fields
  if (e.correlationId !== undefined && typeof e.correlationId !== 'string') {
    errors.push('Event correlationId must be a string if present')
  }
  if (e.metadata !== undefined) {
    if (typeof e.metadata !== 'object' || e.metadata === null) {
      errors.push('Event metadata must be an object if present')
    } else {
      const meta = e.metadata as Record<string, unknown>
      if (meta.version !== undefined && typeof meta.version !== 'number') {
        errors.push('Event metadata.version must be a number if present')
      }
      if (meta.sequence !== undefined && typeof meta.sequence !== 'number') {
        errors.push('Event metadata.sequence must be a number if present')
      }
      if (meta.branch !== undefined && typeof meta.branch !== 'string') {
        errors.push('Event metadata.branch must be a string if present')
      }
    }
  }

  return { valid: errors.length === 0, errors }
}

// ============================================================================
// CLEANUP UTILITIES
// ============================================================================

/**
 * Tracked resources for cleanup
 */
interface TrackedResources {
  namespaces: string[]
  things: Array<{ namespace: string; id: string }>
  events: string[]
}

/**
 * Resource tracker for test cleanup
 */
export class ResourceTracker {
  private resources: TrackedResources = {
    namespaces: [],
    things: [],
    events: [],
  }

  /**
   * Track a namespace for cleanup
   */
  trackNamespace(namespace: string): void {
    this.resources.namespaces.push(namespace)
  }

  /**
   * Track a Thing for cleanup
   */
  trackThing(namespace: string, id: string): void {
    this.resources.things.push({ namespace, id })
  }

  /**
   * Track an event for verification
   */
  trackEvent(eventId: string): void {
    this.resources.events.push(eventId)
  }

  /**
   * Get all tracked resources
   */
  getResources(): TrackedResources {
    return { ...this.resources }
  }

  /**
   * Get cleanup instructions
   */
  getCleanupInstructions(): Array<{ type: 'namespace' | 'thing'; target: string }> {
    const instructions: Array<{ type: 'namespace' | 'thing'; target: string }> = []

    // Things first (within namespaces)
    for (const thing of this.resources.things) {
      instructions.push({
        type: 'thing',
        target: `${thing.namespace}/${thing.id}`,
      })
    }

    // Then namespaces
    for (const ns of this.resources.namespaces) {
      instructions.push({
        type: 'namespace',
        target: ns,
      })
    }

    return instructions
  }

  /**
   * Clear all tracked resources
   */
  clear(): void {
    this.resources = {
      namespaces: [],
      things: [],
      events: [],
    }
  }
}

// ============================================================================
// TEST DATA GENERATORS
// ============================================================================

/**
 * Generate a stream of test operations for pipeline testing
 */
export function generateTestOperations(
  count: number,
  namespace: string
): Array<{
  type: 'create' | 'update' | 'delete'
  thing: ThingFixture
  expectedEvent: PipelineEvent
}> {
  const things = createThingFixtures(count)
  const operations: Array<{
    type: 'create' | 'update' | 'delete'
    thing: ThingFixture
    expectedEvent: PipelineEvent
  }> = []

  for (const thing of things) {
    // Create operation
    operations.push({
      type: 'create',
      thing,
      expectedEvent: createThingCreatedEvent(thing, namespace),
    })
  }

  // Add some updates (every 3rd thing)
  for (let i = 2; i < things.length; i += 3) {
    const thing = things[i]
    const changes = { name: `Updated ${thing.data.name}` }
    operations.push({
      type: 'update',
      thing: { ...thing, data: { ...thing.data, ...changes } },
      expectedEvent: createThingUpdatedEvent(thing, namespace, changes),
    })
  }

  // Add some deletes (every 5th thing)
  for (let i = 4; i < things.length; i += 5) {
    const thing = things[i]
    operations.push({
      type: 'delete',
      thing,
      expectedEvent: createThingDeletedEvent(thing, namespace),
    })
  }

  return operations
}

/**
 * Generate cross-DO operation fixtures for E2E testing
 */
export function generateCrossDOOperations(
  sourceNs: string,
  targetNs: string,
  count: number
): Array<{
  operation: 'clone' | 'move'
  source: string
  target: string
  expectedEvents: PipelineEvent[]
}> {
  const operations: Array<{
    operation: 'clone' | 'move'
    source: string
    target: string
    expectedEvents: PipelineEvent[]
  }> = []

  for (let i = 0; i < count; i++) {
    const operation = i % 2 === 0 ? 'clone' : 'move'
    const correlationId = generateTestResourceName('cross-do')

    operations.push({
      operation,
      source: sourceNs,
      target: targetNs,
      expectedEvents: [
        createEventFixture({
          type: operation === 'clone' ? EVENT_TYPES.LIFECYCLE_CLONE : EVENT_TYPES.LIFECYCLE_MOVE,
          source: sourceNs,
          correlationId,
          payload: {
            operation,
            sourceNs,
            targetNs,
            started: true,
          },
        }),
        createEventFixture({
          type: operation === 'clone' ? EVENT_TYPES.LIFECYCLE_CLONE : EVENT_TYPES.LIFECYCLE_MOVE,
          source: sourceNs,
          correlationId,
          payload: {
            operation,
            sourceNs,
            targetNs,
            completed: true,
          },
        }),
      ],
    })
  }

  return operations
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  // Thing fixtures
  createThingFixture,
  createThingFixtures,

  // Event fixtures
  EVENT_TYPES,
  createEventFixture,
  createThingCreatedEvent,
  createThingUpdatedEvent,
  createThingDeletedEvent,
  createLifecycleEvent,
  createEventFixtures,

  // High volume
  generateHighVolumeEvents,
  createLargePayloadEvent,

  // Schema validation
  EVENT_SCHEMA,
  validateEventSchema,

  // Cleanup
  ResourceTracker,

  // Data generators
  generateTestOperations,
  generateCrossDOOperations,
}
