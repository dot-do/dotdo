/**
 * ACID Test Suite - Phase 5: E2E Pipeline Test Fixtures
 *
 * Test fixtures specific to Phase 5 E2E pipeline testing, including
 * event fixtures, pipeline test data, and high-volume event generators.
 *
 * @see docs/plans/2026-01-09-acid-test-suite-design.md - Phase 5 E2E Pipeline
 */

import { generateTestResourceName } from '../../e2e/config'

// ============================================================================
// PIPELINE EVENT FIXTURES
// ============================================================================

/**
 * Pipeline event data structure
 */
export interface Phase5Event {
  id: string
  type: string
  source: string
  timestamp: string
  correlationId?: string
  payload: Record<string, unknown>
  metadata?: {
    version?: number
    branch?: string
    sequence?: number
  }
}

/**
 * Event types for Phase 5 testing
 */
export const PHASE5_EVENT_TYPES = {
  // CRUD events
  THING_CREATED: 'thing.created',
  THING_UPDATED: 'thing.updated',
  THING_DELETED: 'thing.deleted',

  // Lifecycle events
  LIFECYCLE_FORK: 'lifecycle.fork',
  LIFECYCLE_COMPACT: 'lifecycle.compact',
  LIFECYCLE_MOVE: 'lifecycle.move',
  LIFECYCLE_CLONE: 'lifecycle.clone',

  // Cross-DO events
  SHARD_CREATED: 'shard.created',
  REPLICA_SYNCED: 'replica.synced',
} as const

export type Phase5EventType = (typeof PHASE5_EVENT_TYPES)[keyof typeof PHASE5_EVENT_TYPES]

// ============================================================================
// FIXTURE FACTORY FUNCTIONS
// ============================================================================

/**
 * Create a Phase 5 event fixture
 */
export function createPhase5EventFixture(overrides: Partial<Phase5Event> = {}): Phase5Event {
  const id = overrides.id || generateTestResourceName('evt')
  const timestamp = overrides.timestamp || new Date().toISOString()

  return {
    id,
    type: PHASE5_EVENT_TYPES.THING_CREATED,
    source: 'phase5.test.do',
    timestamp,
    correlationId: generateTestResourceName('corr'),
    payload: {
      thingId: generateTestResourceName('thing'),
      thingType: 'Phase5TestThing',
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
 * Create a batch of event fixtures
 */
export function createPhase5EventBatch(
  count: number,
  options: {
    type?: Phase5EventType
    source?: string
    correlationId?: string
  } = {}
): Phase5Event[] {
  const correlationId = options.correlationId || generateTestResourceName('batch')

  return Array.from({ length: count }, (_, index) =>
    createPhase5EventFixture({
      type: options.type || PHASE5_EVENT_TYPES.THING_CREATED,
      source: options.source || 'phase5.batch.do',
      correlationId,
      metadata: {
        version: 1,
        sequence: index + 1,
      },
    })
  )
}

// ============================================================================
// THING FIXTURES FOR E2E TESTS
// ============================================================================

/**
 * Thing fixture for Phase 5 tests
 */
export interface Phase5ThingFixture {
  $id: string
  $type: string
  name: string
  value: number
  createdAt: string
  testRunId: string
}

/**
 * Create a Thing fixture for E2E testing
 */
export function createPhase5ThingFixture(overrides: Partial<Phase5ThingFixture> = {}): Phase5ThingFixture {
  const id = overrides.$id || generateTestResourceName('thing')
  const testRunId = overrides.testRunId || generateTestResourceName('run')

  return {
    $id: id,
    $type: 'Phase5TestThing',
    name: `Test Thing ${id.slice(-8)}`,
    value: Math.floor(Math.random() * 1000),
    createdAt: new Date().toISOString(),
    testRunId,
    ...overrides,
  }
}

/**
 * Create multiple Thing fixtures
 */
export function createPhase5ThingBatch(
  count: number,
  options: { testRunId?: string; type?: string } = {}
): Phase5ThingFixture[] {
  const testRunId = options.testRunId || generateTestResourceName('run')

  return Array.from({ length: count }, (_, index) =>
    createPhase5ThingFixture({
      $type: options.type || 'Phase5TestThing',
      name: `Batch Thing ${index}`,
      value: index * 10,
      testRunId,
    })
  )
}

// ============================================================================
// HIGH VOLUME EVENT FIXTURES
// ============================================================================

/**
 * Generator for high-volume event streams
 */
export function* generateHighVolumePhase5Events(
  totalCount: number,
  options: {
    batchSize?: number
    types?: Phase5EventType[]
    source?: string
  } = {}
): Generator<Phase5Event[], void, unknown> {
  const batchSize = options.batchSize || 100
  const types = options.types || [
    PHASE5_EVENT_TYPES.THING_CREATED,
    PHASE5_EVENT_TYPES.THING_UPDATED,
  ]
  const source = options.source || 'high-volume.phase5.do'
  const correlationId = generateTestResourceName('hv')

  let generated = 0
  let sequence = 1

  while (generated < totalCount) {
    const remaining = totalCount - generated
    const currentBatch = Math.min(batchSize, remaining)

    const events = Array.from({ length: currentBatch }, () => {
      const event = createPhase5EventFixture({
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
 * Create a large payload event for testing size limits
 */
export function createLargePayloadPhase5Event(
  sizeKB: number,
  source: string = 'large-payload.phase5.do'
): Phase5Event {
  const sizeBytes = sizeKB * 1024
  // Account for base event size (~200 bytes)
  const paddingSize = Math.max(0, sizeBytes - 200)
  const padding = 'x'.repeat(paddingSize)

  return createPhase5EventFixture({
    source,
    payload: {
      largeData: padding,
      sizeKB,
      generated: true,
    },
  })
}

// ============================================================================
// ICEBERG PARTITION FIXTURES
// ============================================================================

/**
 * Iceberg partition descriptor
 */
export interface IcebergPartitionFixture {
  year: number
  month: number
  day: number
  hour?: number
}

/**
 * Get current UTC partition
 */
export function getCurrentPartition(timestamp: Date = new Date()): IcebergPartitionFixture {
  return {
    year: timestamp.getUTCFullYear(),
    month: timestamp.getUTCMonth() + 1, // 1-indexed
    day: timestamp.getUTCDate(),
    hour: timestamp.getUTCHours(),
  }
}

/**
 * Create partition path string
 */
export function formatPartitionPath(partition: IcebergPartitionFixture): string {
  const { year, month, day, hour } = partition
  const base = `${year}/${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}`
  return hour !== undefined ? `${base}/${String(hour).padStart(2, '0')}` : base
}

// ============================================================================
// PIPELINE SLA FIXTURES
// ============================================================================

/**
 * SLA targets for pipeline latency testing
 */
export const PHASE5_SLA_TARGETS = {
  /** Maximum acceptable E2E latency (5 minutes) */
  maxE2ELatencyMs: 300000,

  /** Target P50 latency (5 seconds) */
  p50TargetMs: 5000,

  /** Target P95 latency (30 seconds) */
  p95TargetMs: 30000,

  /** Target P99 latency (60 seconds) */
  p99TargetMs: 60000,

  /** Maximum acceptable event loss rate */
  maxEventLossRate: 0.001,

  /** Pipeline delivery timeout */
  pipelineDeliveryTimeoutMs: 60000,

  /** Iceberg flush timeout (accounting for batch delay) */
  icebergFlushTimeoutMs: 300000,
} as const

/**
 * Smoke test timing fixtures
 */
export const SMOKE_TEST_FIXTURES = {
  /** Maximum time for all smoke tests */
  maxTotalDurationMs: 60000,

  /** Individual test timeout */
  testTimeoutMs: 10000,

  /** Health check timeout */
  healthCheckTimeoutMs: 5000,

  /** CRUD operation timeout */
  crudTimeoutMs: 10000,

  /** Clone operation timeout */
  cloneTimeoutMs: 20000,
} as const

// ============================================================================
// CROSS-DO OPERATION FIXTURES
// ============================================================================

/**
 * Cross-DO operation fixture
 */
export interface CrossDOOperationFixture {
  operation: 'clone' | 'shard' | 'replicate'
  sourceNs: string
  targetNs: string
  correlationId: string
  expectedEvents: Phase5Event[]
}

/**
 * Create cross-DO operation fixtures
 */
export function createCrossDOOperationFixtures(
  count: number,
  sourceNs: string,
  targetNs: string
): CrossDOOperationFixture[] {
  const operations: CrossDOOperationFixture[] = []
  const opTypes: Array<'clone' | 'shard' | 'replicate'> = ['clone', 'shard', 'replicate']

  for (let i = 0; i < count; i++) {
    const operation = opTypes[i % opTypes.length]
    const correlationId = generateTestResourceName('cross-do')

    const typeMap = {
      clone: PHASE5_EVENT_TYPES.LIFECYCLE_CLONE,
      shard: PHASE5_EVENT_TYPES.SHARD_CREATED,
      replicate: PHASE5_EVENT_TYPES.REPLICA_SYNCED,
    }

    operations.push({
      operation,
      sourceNs,
      targetNs,
      correlationId,
      expectedEvents: [
        createPhase5EventFixture({
          type: typeMap[operation],
          source: sourceNs,
          correlationId,
          payload: {
            operation,
            sourceNs,
            targetNs,
            phase: 'started',
          },
        }),
        createPhase5EventFixture({
          type: typeMap[operation],
          source: sourceNs,
          correlationId,
          payload: {
            operation,
            sourceNs,
            targetNs,
            phase: 'completed',
          },
        }),
      ],
    })
  }

  return operations
}

// ============================================================================
// LATENCY MEASUREMENT FIXTURES
// ============================================================================

/**
 * Latency measurement result fixture
 */
export interface LatencyMeasurementFixture {
  operationName: string
  startTime: number
  endTime: number
  durationMs: number
  phases?: {
    name: string
    durationMs: number
  }[]
}

/**
 * Create expected latency measurement fixture
 */
export function createLatencyMeasurementFixture(
  operationName: string,
  durationMs: number,
  phases?: { name: string; durationMs: number }[]
): LatencyMeasurementFixture {
  const startTime = Date.now() - durationMs

  return {
    operationName,
    startTime,
    endTime: startTime + durationMs,
    durationMs,
    phases,
  }
}

// ============================================================================
// TEST HELPERS
// ============================================================================

/**
 * Helper to generate unique test namespace
 */
export function createPhase5TestNamespace(prefix = 'phase5'): string {
  return generateTestResourceName(prefix)
}

/**
 * Helper to create correlation ID for tracing
 */
export function createPhase5CorrelationId(prefix = 'p5'): string {
  return generateTestResourceName(prefix)
}

/**
 * Sleep utility for async tests
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  // Event fixtures
  PHASE5_EVENT_TYPES,
  createPhase5EventFixture,
  createPhase5EventBatch,
  generateHighVolumePhase5Events,
  createLargePayloadPhase5Event,

  // Thing fixtures
  createPhase5ThingFixture,
  createPhase5ThingBatch,

  // Partition fixtures
  getCurrentPartition,
  formatPartitionPath,

  // SLA fixtures
  PHASE5_SLA_TARGETS,
  SMOKE_TEST_FIXTURES,

  // Cross-DO fixtures
  createCrossDOOperationFixtures,

  // Latency fixtures
  createLatencyMeasurementFixture,

  // Helpers
  createPhase5TestNamespace,
  createPhase5CorrelationId,
  sleep,
}
