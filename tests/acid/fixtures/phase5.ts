/**
 * ACID Test Suite - Phase 5: E2E Pipeline Fixtures
 *
 * Shared fixtures and test data for Phase 5 E2E pipeline tests.
 * Includes event fixtures, pipeline test data generators, and SLA targets.
 *
 * @see docs/plans/2026-01-09-acid-test-suite-design.md - Phase 5 E2E Pipeline
 */

// ============================================================================
// PIPELINE EVENT TYPE DEFINITIONS
// ============================================================================

/**
 * Pipeline event data structure
 */
export interface PipelineEvent {
  /** Unique event ID */
  id: string
  /** Event type (e.g., 'thing.created', 'lifecycle.clone') */
  type: string
  /** Source namespace (DO) that emitted the event */
  source: string
  /** ISO 8601 timestamp */
  timestamp: string
  /** Correlation ID for tracing */
  correlationId?: string
  /** Event payload */
  payload: Record<string, unknown>
  /** Event metadata */
  metadata?: {
    /** Event version */
    version?: number
    /** Branch name */
    branch?: string
    /** Sequence number within source */
    sequence?: number
  }
}

/**
 * Event types for Phase 5 testing
 */
export const PHASE5_EVENT_TYPES = {
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

export type Phase5EventType = (typeof PHASE5_EVENT_TYPES)[keyof typeof PHASE5_EVENT_TYPES]

// ============================================================================
// SLA TARGETS
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
// THING FIXTURE DEFINITIONS
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
  data?: Record<string, unknown>
}

// ============================================================================
// ICEBERG PARTITION DEFINITIONS
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

// ============================================================================
// LATENCY MEASUREMENT DEFINITIONS
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

// ============================================================================
// CROSS-DO OPERATION DEFINITIONS
// ============================================================================

/**
 * Cross-DO operation fixture
 */
export interface CrossDOOperationFixture {
  operation: 'clone' | 'shard' | 'replicate'
  sourceNs: string
  targetNs: string
  correlationId: string
  expectedEvents: PipelineEvent[]
}

// ============================================================================
// ID GENERATION
// ============================================================================

let idCounter = 0

/**
 * Generate a unique test resource name
 */
export function generateTestResourceName(prefix: string = 'test'): string {
  const timestamp = Date.now().toString(36)
  const counter = (idCounter++).toString(36).padStart(4, '0')
  const random = Math.random().toString(36).slice(2, 6)
  return `e2e-test-${prefix}-${timestamp}-${counter}-${random}`
}

/**
 * Reset the ID counter (useful between test files)
 */
export function resetIdCounter(): void {
  idCounter = 0
}

// ============================================================================
// FIXTURE FACTORY FUNCTIONS
// ============================================================================

/**
 * Create a Phase 5 event fixture
 */
export function createPhase5EventFixture(overrides: Partial<PipelineEvent> = {}): PipelineEvent {
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
): PipelineEvent[] {
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
): Generator<PipelineEvent[], void, unknown> {
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
): PipelineEvent {
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
// CROSS-DO OPERATION FIXTURES
// ============================================================================

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
// EVENT SCHEMA VALIDATION
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
// ASSERTION HELPERS
// ============================================================================

/**
 * Assert event matches expected schema
 */
export function assertValidEvent(event: PipelineEvent): void {
  const result = validateEventSchema(event)
  if (!result.valid) {
    throw new Error(`Invalid event: ${result.errors.join(', ')}`)
  }
}

/**
 * Assert latency is within SLA target
 */
export function assertLatencyWithinSLA(
  latencyMs: number,
  targetMs: number,
  label: string = 'Latency'
): void {
  if (latencyMs > targetMs) {
    throw new Error(`${label} ${latencyMs}ms exceeds target ${targetMs}ms`)
  }
}

/**
 * Assert events are in order by sequence
 */
export function assertEventsInOrder(events: PipelineEvent[]): void {
  for (let i = 1; i < events.length; i++) {
    const prevSeq = events[i - 1].metadata?.sequence ?? 0
    const currSeq = events[i].metadata?.sequence ?? 0
    if (currSeq < prevSeq) {
      throw new Error(
        `Events out of order: index ${i - 1} has sequence ${prevSeq}, index ${i} has sequence ${currSeq}`
      )
    }
  }
}

/**
 * Assert no events were lost
 */
export function assertNoEventLoss(
  expectedCount: number,
  actualCount: number,
  tolerance: number = 0
): void {
  const lostCount = expectedCount - actualCount
  if (lostCount > tolerance) {
    throw new Error(
      `Event loss detected: expected ${expectedCount}, got ${actualCount}, lost ${lostCount}`
    )
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  // Event types
  PHASE5_EVENT_TYPES,

  // SLA targets
  PHASE5_SLA_TARGETS,
  SMOKE_TEST_FIXTURES,

  // Event fixtures
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

  // Cross-DO fixtures
  createCrossDOOperationFixtures,

  // Latency fixtures
  createLatencyMeasurementFixture,

  // Validation
  EVENT_SCHEMA,
  validateEventSchema,

  // Helpers
  generateTestResourceName,
  resetIdCounter,
  createPhase5TestNamespace,
  createPhase5CorrelationId,
  sleep,

  // Assertions
  assertValidEvent,
  assertLatencyWithinSLA,
  assertEventsInOrder,
  assertNoEventLoss,
}
