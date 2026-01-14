# Primitives Architecture Plan

## Executive Summary

This document outlines the architecture for 27 new primitives across 7 implementation waves, building a complete edge-native platform on Cloudflare Workers + Durable Objects.

**Total Scope**: ~1,735 tests across 27 primitives

## Design Principles

### 1. DO-First State Management
Every stateful primitive must have a Durable Object storage adapter:
```typescript
interface StorageAdapter<T> {
  get(key: string): Promise<T | null>
  set(key: string, value: T, options?: { ttl?: number }): Promise<void>
  delete(key: string): Promise<void>
  list(prefix?: string): Promise<Map<string, T>>
}

// Every primitive accepts optional storage
const lock = createDistributedLock({ storage: env.LOCK_DO })
const events = createEventBus({ storage: env.EVENTS_DO })
```

### 2. Event-Driven Backbone
The event-bus is the central nervous system. All primitives emit events:
```typescript
// Every primitive can emit to the bus
lock.on('acquired', (event) => bus.publish('lock.acquired', event))
queue.on('job:completed', (event) => bus.publish('job.completed', event))

// Cross-primitive coordination via events
bus.subscribe('payment.completed', async (event) => {
  await notifications.send(event.userId, 'payment-receipt', event)
  await analytics.track('Payment Completed', event)
})
```

### 3. Request Context Propagation
All primitives automatically inherit request context:
```typescript
const ctx = createRequestContext({
  requestId: crypto.randomUUID(),
  traceId: request.headers.get('x-trace-id'),
  userId: auth.userId,
})

// Context flows through all operations
await ctx.run(async () => {
  // All primitives see the same context
  logger.info('Processing') // Auto-includes requestId, traceId
  await cache.get('key')    // Cache key scoped to context
  await db.query(...)       // Query tagged with trace
})
```

### 4. Observability by Default
Every operation emits OpenTelemetry-compatible telemetry:
```typescript
// Automatic instrumentation
const result = await cache.get('user:123')
// Emits: span{name: "cache.get", attributes: {key: "user:123", hit: true}}
// Emits: metric{name: "cache.operations", tags: {operation: "get", result: "hit"}}
```

### 5. Composable Interfaces
Primitives compose via TypeScript interfaces:
```typescript
// Primitives share common interfaces
interface Publishable {
  publish(topic: string, event: unknown): Promise<void>
}

interface Subscribable {
  subscribe(topic: string, handler: Handler): Subscription
}

// event-bus, message-queue, notification-center all implement these
```

---

## Dependency Graph

```
                    ┌─────────────────┐
                    │ request-context │ (foundation for all)
                    └────────┬────────┘
                             │
         ┌───────────────────┼───────────────────┐
         │                   │                   │
         ▼                   ▼                   ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│distributed-lock │ │idempotency-store│ │ trace-collector │
└────────┬────────┘ └────────┬────────┘ └────────┬────────┘
         │                   │                   │
         └───────────────────┼───────────────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │    event-bus    │ (central nervous system)
                    └────────┬────────┘
                             │
    ┌────────────────────────┼────────────────────────┐
    │            │           │           │            │
    ▼            ▼           ▼           ▼            ▼
┌────────┐ ┌──────────┐ ┌────────┐ ┌────────┐ ┌──────────┐
│message │ │  event   │ │  cdc   │ │notific.│ │ billing  │
│ queue  │ │  store   │ │ engine │ │ center │ │  engine  │
└────────┘ └──────────┘ └────────┘ └────────┘ └──────────┘
```

---

## Implementation Waves

### Wave A: Foundation Layer (4 primitives, ~210 tests)

These primitives are dependencies for everything else. Must be implemented first.

#### A1. distributed-lock (~50 tests)
**Purpose**: Prevent double-execution, enable leader election, coordinate distributed access

```typescript
interface DistributedLock {
  // Core operations
  acquire(resource: string, options?: LockOptions): Promise<LockHandle | null>
  release(handle: LockHandle): Promise<void>
  extend(handle: LockHandle, duration: number): Promise<boolean>

  // Convenience
  withLock<T>(resource: string, fn: () => Promise<T>): Promise<T>

  // Leader election
  electLeader(group: string, options?: ElectionOptions): Promise<LeaderHandle>
  isLeader(group: string): boolean
  onLeaderChange(group: string, callback: LeaderCallback): void
}

interface LockHandle {
  resource: string
  token: string        // Fencing token for correctness
  expiresAt: number
  ownerId: string
}

interface LockOptions {
  ttl?: number         // Lock duration (default 30s)
  waitTimeout?: number // How long to wait for lock
  retryInterval?: number
}
```

**Test Categories**:
- Acquire/release basic flow (8 tests)
- Fencing token validation (6 tests)
- Lock expiration and auto-release (5 tests)
- Contention handling (7 tests)
- withLock convenience method (5 tests)
- Leader election (10 tests)
- DO persistence (5 tests)
- Edge cases (4 tests)

---

#### A2. request-context (~35 tests)
**Purpose**: Propagate correlation IDs, user context, and trace data across async boundaries

```typescript
interface RequestContext {
  // Identifiers
  requestId: string
  traceId: string
  spanId: string
  parentSpanId?: string

  // User context
  userId?: string
  tenantId?: string
  sessionId?: string

  // Metadata
  startTime: number
  attributes: Record<string, unknown>

  // Operations
  run<T>(fn: () => Promise<T>): Promise<T>
  child(name: string): RequestContext
  set(key: string, value: unknown): void
  get<T>(key: string): T | undefined
}

// Global accessor
function getContext(): RequestContext | undefined
function requireContext(): RequestContext // throws if not in context
```

**Test Categories**:
- Context creation and access (6 tests)
- Async propagation (7 tests)
- Child context creation (5 tests)
- Attribute management (5 tests)
- Header extraction/injection (6 tests)
- Edge cases (6 tests)

---

#### A3. idempotency-store (~45 tests)
**Purpose**: Ensure exactly-once execution for critical operations

```typescript
interface IdempotencyStore {
  // Check and execute
  execute<T>(
    key: string,
    fn: () => Promise<T>,
    options?: IdempotencyOptions
  ): Promise<IdempotencyResult<T>>

  // Manual operations
  check(key: string): Promise<IdempotencyStatus>
  store(key: string, result: unknown, options?: StoreOptions): Promise<void>
  delete(key: string): Promise<void>

  // Bulk operations
  checkMany(keys: string[]): Promise<Map<string, IdempotencyStatus>>
}

interface IdempotencyResult<T> {
  result: T
  cached: boolean
  key: string
  storedAt?: number
}

interface IdempotencyOptions {
  ttl?: number              // How long to remember (default 24h)
  lockTimeout?: number      // Max execution time
  fingerprint?: string      // Additional uniqueness factor
  onConflict?: 'wait' | 'reject' | 'ignore'
}

type IdempotencyStatus =
  | { status: 'new' }
  | { status: 'pending', startedAt: number }
  | { status: 'completed', result: unknown, completedAt: number }
  | { status: 'failed', error: string, failedAt: number }
```

**Test Categories**:
- First execution stores result (5 tests)
- Duplicate returns cached (5 tests)
- Concurrent requests (8 tests)
- TTL expiration (5 tests)
- Error handling (6 tests)
- Fingerprint matching (5 tests)
- DO persistence (6 tests)
- Edge cases (5 tests)

---

#### A4. event-bus (~80 tests)
**Purpose**: Central pub/sub backbone for event-driven architecture

```typescript
interface EventBus {
  // Publishing
  publish(topic: string, event: unknown, options?: PublishOptions): Promise<EventId>
  publishBatch(events: Array<{ topic: string; event: unknown }>): Promise<EventId[]>

  // Subscribing
  subscribe(topic: string, handler: EventHandler, options?: SubscribeOptions): Subscription
  subscribePattern(pattern: string, handler: EventHandler): Subscription

  // Topic management
  createTopic(name: string, config?: TopicConfig): Promise<void>
  deleteTopic(name: string): Promise<void>
  listTopics(): Promise<TopicInfo[]>

  // Consumer groups (for work distribution)
  joinGroup(group: string, topics: string[], handler: EventHandler): GroupMembership

  // Dead letter
  getDeadLetters(topic?: string): AsyncIterable<DeadLetter>
  replayDeadLetter(id: string): Promise<void>
}

interface EventHandler {
  (event: BusEvent): Promise<void> | void
}

interface BusEvent {
  id: string
  topic: string
  data: unknown
  timestamp: number
  metadata: {
    source?: string
    correlationId?: string
    causationId?: string
  }
}

interface TopicConfig {
  partitions?: number
  retention?: number
  maxSize?: number
  schema?: Schema
}
```

**Test Categories**:
- Publish and receive (8 tests)
- Pattern subscriptions (7 tests)
- Consumer groups (10 tests)
- Partitioning (8 tests)
- Dead letter queue (7 tests)
- Ordering guarantees (6 tests)
- Backpressure handling (5 tests)
- DO persistence (8 tests)
- Replay and recovery (6 tests)
- CloudEvents compatibility (5 tests)
- Multi-region (5 tests)
- Edge cases (5 tests)

---

### Wave B: Data Infrastructure (4 primitives, ~305 tests)

#### B1. time-series-engine (~90 tests)
**Purpose**: Efficient storage and querying of time-stamped metrics data

```typescript
interface TimeSeriesEngine {
  // Write
  write(measurement: string, fields: Fields, tags?: Tags, timestamp?: Date): Promise<void>
  writeBatch(points: TimeSeriesPoint[]): Promise<void>

  // Query
  query(measurement: string, options: QueryOptions): Promise<TimeSeriesResult>

  // Aggregations
  aggregate(measurement: string, options: AggregateOptions): Promise<AggregateResult>

  // Downsampling
  createRetentionPolicy(name: string, policy: RetentionPolicy): Promise<void>
  createContinuousQuery(name: string, query: ContinuousQueryDef): Promise<void>

  // Special functions
  derivative(measurement: string, field: string, options: QueryOptions): Promise<number[]>
  movingAverage(measurement: string, field: string, window: number, options: QueryOptions): Promise<number[]>
  percentile(measurement: string, field: string, p: number, options: QueryOptions): Promise<number>
}

interface QueryOptions {
  start: Date
  end: Date
  tags?: Tags
  groupBy?: string[]
  fill?: 'none' | 'null' | 'previous' | number
  limit?: number
}

interface RetentionPolicy {
  duration: string      // '7d', '30d', '1y'
  shardDuration: string // '1h', '1d'
  replication?: number
}
```

**Test Categories**:
- Write single/batch points (8 tests)
- Basic queries (10 tests)
- Tag filtering (8 tests)
- Time range queries (7 tests)
- Aggregations (sum, avg, min, max, count) (10 tests)
- Group by time (6 tests)
- Group by tag (5 tests)
- Downsampling (8 tests)
- Retention policies (6 tests)
- Continuous queries (5 tests)
- Gap filling (5 tests)
- Special functions (7 tests)
- DO persistence (5 tests)

---

#### B2. event-store (~85 tests)
**Purpose**: Append-only event storage with projections for event sourcing

```typescript
interface EventStore {
  // Append
  append(stream: string, events: DomainEvent[], expectedVersion?: number): Promise<AppendResult>

  // Read
  readStream(stream: string, options?: ReadOptions): AsyncIterable<StoredEvent>
  readAll(options?: ReadAllOptions): AsyncIterable<StoredEvent>
  readCategory(category: string, options?: ReadOptions): AsyncIterable<StoredEvent>

  // Subscriptions
  subscribeToStream(stream: string, handler: EventHandler, options?: SubscribeOptions): Subscription
  subscribeToAll(handler: EventHandler, options?: SubscribeOptions): Subscription
  subscribeToCategory(category: string, handler: EventHandler): Subscription

  // Projections
  createProjection(name: string, definition: ProjectionDef): Promise<void>
  getProjectionState<T>(name: string): Promise<T>
  resetProjection(name: string): Promise<void>

  // Snapshots
  saveSnapshot(stream: string, state: unknown, version: number): Promise<void>
  getSnapshot<T>(stream: string): Promise<Snapshot<T> | null>
}

interface StoredEvent {
  id: string
  stream: string
  type: string
  data: unknown
  metadata: EventMetadata
  version: number
  timestamp: Date
  position: bigint  // Global position
}

interface ProjectionDef {
  source: string | string[]  // Stream(s) or '$all'
  handlers: Record<string, (state: unknown, event: StoredEvent) => unknown>
  initialState: unknown
}
```

**Test Categories**:
- Append events (8 tests)
- Optimistic concurrency (7 tests)
- Read stream (6 tests)
- Read all (5 tests)
- Category streams (6 tests)
- Subscriptions (8 tests)
- Catch-up subscriptions (5 tests)
- Projections (10 tests)
- Snapshots (6 tests)
- Stream metadata (4 tests)
- Tombstones/soft delete (4 tests)
- Global ordering (5 tests)
- DO persistence (6 tests)
- Edge cases (5 tests)

---

#### B3. message-queue (~70 tests)
**Purpose**: Durable work distribution with consumer groups

```typescript
interface MessageQueue {
  // Queues
  createQueue(name: string, config?: QueueConfig): Promise<void>
  deleteQueue(name: string): Promise<void>

  // Send
  send(queue: string, message: unknown, options?: SendOptions): Promise<MessageId>
  sendBatch(queue: string, messages: unknown[]): Promise<MessageId[]>

  // Receive
  receive(queue: string, options?: ReceiveOptions): Promise<Message[]>

  // Process (higher-level)
  process(queue: string, handler: MessageHandler, options?: ProcessOptions): QueueProcessor

  // Acknowledgment
  ack(messageId: MessageId): Promise<void>
  nack(messageId: MessageId, options?: NackOptions): Promise<void>

  // Dead letter
  getDeadLetters(queue: string): AsyncIterable<DeadMessage>
  redriveDeadLetters(queue: string, count?: number): Promise<number>

  // Inspection
  getQueueStats(queue: string): Promise<QueueStats>
}

interface QueueConfig {
  visibilityTimeout?: number   // Default 30s
  messageRetention?: number    // Default 7 days
  maxReceives?: number         // Before DLQ (default 3)
  deadLetterQueue?: string
  fifo?: boolean
  deduplicationWindow?: number
}

interface Message {
  id: string
  body: unknown
  attributes: Record<string, string>
  receiptHandle: string
  approximateReceiveCount: number
  sentTimestamp: number
  firstReceiveTimestamp?: number
}
```

**Test Categories**:
- Send and receive (8 tests)
- Visibility timeout (6 tests)
- Acknowledgment (5 tests)
- Negative acknowledgment (5 tests)
- Dead letter queue (7 tests)
- FIFO ordering (6 tests)
- Deduplication (5 tests)
- Batch operations (5 tests)
- Long polling (4 tests)
- Message attributes (4 tests)
- Process handler (6 tests)
- Queue stats (4 tests)
- DO persistence (5 tests)

---

#### B4. probabilistic (~60 tests)
**Purpose**: Space-efficient approximate data structures

```typescript
// HyperLogLog for cardinality estimation
interface HyperLogLog {
  add(item: string | Uint8Array): void
  count(): number
  merge(other: HyperLogLog): HyperLogLog
  serialize(): Uint8Array
  static deserialize(data: Uint8Array): HyperLogLog
}

// Bloom filter for membership testing
interface BloomFilter {
  add(item: string | Uint8Array): void
  contains(item: string | Uint8Array): boolean  // May have false positives
  serialize(): Uint8Array
  static create(expectedItems: number, falsePositiveRate: number): BloomFilter
}

// Counting Bloom filter (supports removal)
interface CountingBloomFilter extends BloomFilter {
  remove(item: string | Uint8Array): void
  count(item: string | Uint8Array): number
}

// Count-Min Sketch for frequency estimation
interface CountMinSketch {
  add(item: string, count?: number): void
  estimate(item: string): number
  merge(other: CountMinSketch): CountMinSketch
  serialize(): Uint8Array
}

// Top-K for heavy hitters
interface TopK {
  add(item: string, increment?: number): void
  list(k?: number): Array<{ item: string; count: number }>
  serialize(): Uint8Array
}

// T-Digest for percentile estimation
interface TDigest {
  add(value: number, weight?: number): void
  percentile(p: number): number
  cdf(value: number): number
  merge(other: TDigest): TDigest
  serialize(): Uint8Array
}
```

**Test Categories**:
- HyperLogLog accuracy (8 tests)
- HyperLogLog merge (4 tests)
- Bloom filter false positives (6 tests)
- Bloom filter capacity (4 tests)
- Counting Bloom add/remove (5 tests)
- Count-Min Sketch accuracy (6 tests)
- Count-Min Sketch merge (3 tests)
- TopK accuracy (6 tests)
- T-Digest percentiles (8 tests)
- Serialization/deserialization (6 tests)
- Edge cases (4 tests)

---

### Wave C: Enhanced Processing (4 primitives, ~225 tests)

#### C1. windowing (~55 tests)
**Purpose**: Time-based windowing for stream processing

```typescript
interface WindowOperator<T, R> {
  // Window types
  tumbling(duration: number): WindowedStream<T, R>
  sliding(size: number, slide: number): WindowedStream<T, R>
  session(gap: number): WindowedStream<T, R>

  // Event time
  withTimestampExtractor(fn: (item: T) => number): WindowOperator<T, R>
  withWatermark(strategy: WatermarkStrategy): WindowOperator<T, R>

  // Processing
  aggregate<A>(aggregator: Aggregator<T, A, R>): WindowedStream<T, R>
  reduce(fn: (acc: R, item: T) => R, initial: R): WindowedStream<T, R>
}

interface WindowedStream<T, R> {
  // Late data handling
  allowedLateness(duration: number): WindowedStream<T, R>
  sideOutputLateData(handler: (item: T) => void): WindowedStream<T, R>

  // Triggers
  trigger(trigger: Trigger): WindowedStream<T, R>

  // Output
  process(handler: (window: Window, results: R[]) => void): void
}

interface Window {
  start: number
  end: number
  maxTimestamp: number
}

type WatermarkStrategy =
  | { type: 'bounded', maxOutOfOrder: number }
  | { type: 'monotonic' }
  | { type: 'idle', timeout: number }
```

**Test Categories**:
- Tumbling windows (8 tests)
- Sliding windows (8 tests)
- Session windows (7 tests)
- Event time processing (6 tests)
- Watermarks (6 tests)
- Late data handling (5 tests)
- Triggers (5 tests)
- Aggregations in windows (5 tests)
- Edge cases (5 tests)

---

#### C2. geospatial (~65 tests)
**Purpose**: Geographic queries and calculations

```typescript
interface GeoEngine {
  // Indexing
  addPoint(id: string, coords: GeoCoord, data?: unknown): void
  addPolygon(id: string, polygon: GeoPolygon, data?: unknown): void
  remove(id: string): void

  // Queries
  nearby(center: GeoCoord, radius: number, options?: NearbyOptions): GeoResult[]
  boundingBox(bounds: GeoBounds): GeoResult[]
  withinPolygon(polygon: GeoPolygon): GeoResult[]
  intersects(geometry: GeoGeometry): GeoResult[]

  // Calculations
  distance(from: GeoCoord, to: GeoCoord, unit?: DistanceUnit): number
  area(polygon: GeoPolygon, unit?: AreaUnit): number
  centroid(polygon: GeoPolygon): GeoCoord

  // H3 integration
  toH3(coord: GeoCoord, resolution: number): string
  fromH3(h3Index: string): GeoCoord
  h3ToPolygon(h3Index: string): GeoPolygon
  getH3Neighbors(h3Index: string): string[]

  // Clustering
  cluster(options: ClusterOptions): GeoCluster[]
}

interface GeoCoord {
  lat: number
  lon: number
}

interface GeoResult {
  id: string
  coords: GeoCoord
  distance?: number
  data?: unknown
}
```

**Test Categories**:
- Add/remove points (5 tests)
- Nearby search (8 tests)
- Bounding box (5 tests)
- Within polygon (6 tests)
- Distance calculations (6 tests)
- Area calculations (4 tests)
- H3 indexing (8 tests)
- H3 neighbors (4 tests)
- Clustering (6 tests)
- Polygon operations (6 tests)
- Edge cases (7 tests)

---

#### C3. cdc-engine (~50 tests)
**Purpose**: Change Data Capture for reactive architectures

```typescript
interface CDCEngine {
  // Watch changes
  watch(collection: string, options?: WatchOptions): ChangeStream

  // Outbox pattern
  createOutbox(name: string, config?: OutboxConfig): Promise<void>
  appendToOutbox(outbox: string, event: OutboxEvent): Promise<void>
  publishOutbox(outbox: string): Promise<number>

  // Change log
  getChanges(collection: string, options?: GetChangesOptions): AsyncIterable<Change>
  getChangesSince(collection: string, position: ChangePosition): AsyncIterable<Change>

  // Connectors
  createSourceConnector(config: SourceConnectorConfig): Promise<void>
  createSinkConnector(config: SinkConnectorConfig): Promise<void>
}

interface Change {
  id: string
  collection: string
  operation: 'insert' | 'update' | 'delete'
  timestamp: Date
  position: ChangePosition
  before?: unknown
  after?: unknown
  diff?: Diff[]
}

interface ChangeStream {
  on(event: 'change', handler: (change: Change) => void): void
  on(event: 'error', handler: (error: Error) => void): void
  close(): void
}
```

**Test Categories**:
- Watch for changes (8 tests)
- Change types (insert/update/delete) (6 tests)
- Resume tokens (5 tests)
- Outbox pattern (8 tests)
- Change log queries (6 tests)
- Diff generation (5 tests)
- Connectors (6 tests)
- Edge cases (6 tests)

---

#### C4. schema-registry (~55 tests)
**Purpose**: Schema versioning and compatibility management

```typescript
interface SchemaRegistry {
  // Register
  register(subject: string, schema: Schema): Promise<SchemaId>

  // Retrieve
  getSchema(id: SchemaId): Promise<Schema>
  getLatestSchema(subject: string): Promise<Schema>
  getSchemaByVersion(subject: string, version: number): Promise<Schema>
  getAllVersions(subject: string): Promise<SchemaVersion[]>

  // Compatibility
  checkCompatibility(subject: string, schema: Schema): Promise<CompatibilityResult>
  setCompatibilityLevel(subject: string, level: CompatibilityLevel): Promise<void>
  getCompatibilityLevel(subject: string): Promise<CompatibilityLevel>

  // Validation
  validate(subject: string, data: unknown, version?: number): Promise<ValidationResult>

  // Evolution
  evolve(subject: string, newSchema: Schema): Promise<MigrationPlan>
}

type CompatibilityLevel =
  | 'BACKWARD'           // New can read old
  | 'FORWARD'            // Old can read new
  | 'FULL'               // Both directions
  | 'BACKWARD_TRANSITIVE'
  | 'FORWARD_TRANSITIVE'
  | 'FULL_TRANSITIVE'
  | 'NONE'
```

**Test Categories**:
- Register schemas (5 tests)
- Retrieve by ID/subject/version (6 tests)
- Version listing (4 tests)
- Backward compatibility (6 tests)
- Forward compatibility (6 tests)
- Full compatibility (4 tests)
- Transitive compatibility (5 tests)
- Validation (6 tests)
- Migration plans (6 tests)
- Edge cases (7 tests)

---

### Wave D: Observability (3 primitives, ~160 tests)

#### D1. trace-collector (~60 tests)
**Purpose**: Distributed tracing with OpenTelemetry compatibility

```typescript
interface TraceCollector {
  // Span management
  startSpan(name: string, options?: SpanOptions): Span
  getActiveSpan(): Span | undefined

  // Context propagation
  extract(carrier: Carrier, getter: TextMapGetter): SpanContext | undefined
  inject(carrier: Carrier, setter: TextMapSetter): void

  // Exporters
  addExporter(exporter: SpanExporter): void

  // Sampling
  setSampler(sampler: Sampler): void
}

interface Span {
  spanContext(): SpanContext
  setAttribute(key: string, value: AttributeValue): Span
  setAttributes(attributes: Attributes): Span
  addEvent(name: string, attributes?: Attributes): Span
  setStatus(status: SpanStatus): Span
  recordException(exception: Error): Span
  end(endTime?: number): void
  isRecording(): boolean
}

interface SpanContext {
  traceId: string
  spanId: string
  traceFlags: number
  traceState?: TraceState
}
```

**Test Categories**:
- Span creation (6 tests)
- Span attributes (5 tests)
- Span events (4 tests)
- Span status (4 tests)
- Context propagation (8 tests)
- W3C trace context (5 tests)
- Parent-child spans (5 tests)
- Sampling (6 tests)
- Exporters (6 tests)
- Integration with request-context (6 tests)
- Edge cases (5 tests)

---

#### D2. blob-store (~55 tests)
**Purpose**: R2-backed object storage with transforms

```typescript
interface BlobStore {
  // CRUD
  put(key: string, data: BlobInput, options?: PutOptions): Promise<BlobMetadata>
  get(key: string, options?: GetOptions): Promise<Blob | null>
  head(key: string): Promise<BlobMetadata | null>
  delete(key: string): Promise<void>

  // Listing
  list(options?: ListOptions): AsyncIterable<BlobMetadata>

  // Multipart
  createMultipartUpload(key: string): Promise<MultipartUpload>

  // URLs
  getSignedUrl(key: string, options: SignedUrlOptions): Promise<string>

  // Transforms (images)
  transform(key: string, transforms: ImageTransform[]): Promise<Blob>

  // Lifecycle
  setLifecycleRules(rules: LifecycleRule[]): Promise<void>
}

interface ImageTransform {
  type: 'resize' | 'crop' | 'rotate' | 'format' | 'quality'
  options: Record<string, unknown>
}

interface SignedUrlOptions {
  expiresIn: number
  method?: 'GET' | 'PUT'
  contentType?: string
}
```

**Test Categories**:
- Put/get/delete (8 tests)
- Metadata (5 tests)
- Listing (5 tests)
- Multipart uploads (6 tests)
- Signed URLs (6 tests)
- Image transforms (8 tests)
- Lifecycle rules (5 tests)
- Streaming (5 tests)
- Edge cases (7 tests)

---

#### D3. data-lineage (~45 tests)
**Purpose**: Track data flow and impact analysis

```typescript
interface DataLineage {
  // Record lineage
  recordTransformation(input: DataRef[], output: DataRef[], operation: string): Promise<LineageId>
  recordRead(dataRef: DataRef, consumer: string): Promise<void>
  recordWrite(dataRef: DataRef, producer: string): Promise<void>

  // Query lineage
  getUpstream(dataRef: DataRef, depth?: number): Promise<LineageNode[]>
  getDownstream(dataRef: DataRef, depth?: number): Promise<LineageNode[]>
  getLineageGraph(dataRef: DataRef): Promise<LineageGraph>

  // Impact analysis
  analyzeImpact(dataRef: DataRef): Promise<ImpactReport>

  // Quality
  recordQualityMetrics(dataRef: DataRef, metrics: QualityMetrics): Promise<void>
  getQualityHistory(dataRef: DataRef): Promise<QualityMetrics[]>
}

interface DataRef {
  type: 'table' | 'column' | 'file' | 'stream' | 'api'
  namespace: string
  name: string
  version?: string
}

interface LineageNode {
  dataRef: DataRef
  operation?: string
  timestamp: Date
  metadata?: Record<string, unknown>
}
```

**Test Categories**:
- Record transformations (6 tests)
- Upstream queries (6 tests)
- Downstream queries (6 tests)
- Graph visualization (5 tests)
- Impact analysis (6 tests)
- Quality metrics (6 tests)
- Multi-hop lineage (5 tests)
- Edge cases (5 tests)

---

### Wave E: Security (4 primitives, ~275 tests)

#### E1. mfa-engine (~75 tests)
**Purpose**: Multi-factor authentication (TOTP, WebAuthn, SMS, backup codes)

```typescript
interface MFAEngine {
  // TOTP
  generateTOTPSecret(options?: TOTPOptions): TOTPSecret
  verifyTOTP(secret: string, code: string, options?: VerifyOptions): boolean

  // WebAuthn
  generateRegistrationOptions(user: WebAuthnUser): Promise<RegistrationOptions>
  verifyRegistration(response: RegistrationResponse): Promise<WebAuthnCredential>
  generateAuthenticationOptions(user: WebAuthnUser): Promise<AuthenticationOptions>
  verifyAuthentication(response: AuthenticationResponse): Promise<boolean>

  // SMS/Email
  sendVerificationCode(channel: 'sms' | 'email', destination: string): Promise<void>
  verifyCode(channel: string, destination: string, code: string): Promise<boolean>

  // Backup codes
  generateBackupCodes(count?: number): string[]
  verifyBackupCode(userId: string, code: string): Promise<boolean>

  // User MFA management
  getUserMFAMethods(userId: string): Promise<MFAMethod[]>
  enableMFA(userId: string, method: MFAMethod): Promise<void>
  disableMFA(userId: string, methodId: string): Promise<void>
}
```

**Test Categories**:
- TOTP generation (6 tests)
- TOTP verification (8 tests)
- WebAuthn registration (10 tests)
- WebAuthn authentication (10 tests)
- SMS verification (6 tests)
- Email verification (6 tests)
- Backup codes (8 tests)
- MFA method management (8 tests)
- Rate limiting (6 tests)
- Edge cases (7 tests)

---

#### E2. password-manager (~50 tests)
**Purpose**: Secure password handling with Argon2

```typescript
interface PasswordManager {
  // Hashing
  hash(password: string, options?: HashOptions): Promise<string>
  verify(password: string, hash: string): Promise<boolean>
  needsRehash(hash: string): boolean

  // Validation
  validateStrength(password: string): PasswordStrengthResult
  checkBreached(password: string): Promise<boolean>

  // Policy
  setPolicy(policy: PasswordPolicy): void
  validatePolicy(password: string): PolicyValidationResult

  // Reset flow
  generateResetToken(userId: string): Promise<ResetToken>
  verifyResetToken(token: string): Promise<string | null>
  invalidateResetToken(token: string): Promise<void>
}

interface PasswordPolicy {
  minLength: number
  maxLength?: number
  requireUppercase?: boolean
  requireLowercase?: boolean
  requireNumbers?: boolean
  requireSymbols?: boolean
  preventReuse?: number
  maxAge?: number
}

interface PasswordStrengthResult {
  score: 0 | 1 | 2 | 3 | 4
  feedback: string[]
  crackTime: string
}
```

**Test Categories**:
- Argon2 hashing (6 tests)
- Verification (5 tests)
- Rehash detection (4 tests)
- Strength validation (8 tests)
- Breach checking (5 tests)
- Policy validation (8 tests)
- Reset tokens (6 tests)
- Edge cases (8 tests)

---

#### E3. identity-provider (~90 tests)
**Purpose**: OAuth2/OIDC server implementation

```typescript
interface IdentityProvider {
  // Authorization
  authorize(request: AuthorizeRequest): Promise<AuthorizeResponse>

  // Token
  token(request: TokenRequest): Promise<TokenResponse>
  refresh(refreshToken: string): Promise<TokenResponse>
  revoke(token: string, hint?: 'access_token' | 'refresh_token'): Promise<void>
  introspect(token: string): Promise<IntrospectionResponse>

  // UserInfo
  userinfo(accessToken: string): Promise<UserInfoResponse>

  // OIDC
  getOpenIDConfiguration(): OpenIDConfiguration
  getJWKS(): JWKS

  // Client management
  registerClient(client: ClientRegistration): Promise<RegisteredClient>
  getClient(clientId: string): Promise<RegisteredClient | null>
  updateClient(clientId: string, updates: Partial<ClientRegistration>): Promise<RegisteredClient>
  deleteClient(clientId: string): Promise<void>

  // User management
  createUser(user: UserRegistration): Promise<User>
  authenticateUser(credentials: Credentials): Promise<User | null>
}
```

**Test Categories**:
- Authorization code flow (10 tests)
- PKCE (6 tests)
- Client credentials (5 tests)
- Refresh tokens (6 tests)
- Token introspection (5 tests)
- Token revocation (4 tests)
- UserInfo endpoint (5 tests)
- JWKS endpoint (4 tests)
- OpenID configuration (3 tests)
- Client registration (8 tests)
- User management (8 tests)
- Scopes and claims (6 tests)
- Error handling (8 tests)
- Security (CSRF, replay) (7 tests)
- Edge cases (5 tests)

---

#### E4. threat-detector (~60 tests)
**Purpose**: Detect and prevent security threats

```typescript
interface ThreatDetector {
  // Detection
  analyzeRequest(request: RequestInfo): Promise<ThreatAnalysis>

  // Brute force
  recordAttempt(key: string, success: boolean): Promise<void>
  isBlocked(key: string): Promise<boolean>
  unblock(key: string): Promise<void>

  // Anomaly detection
  recordBehavior(userId: string, behavior: BehaviorEvent): Promise<void>
  getAnomalyScore(userId: string): Promise<number>

  // IP reputation
  getIPReputation(ip: string): Promise<IPReputation>
  reportIP(ip: string, reason: string): Promise<void>

  // Bot detection
  detectBot(request: RequestInfo): Promise<BotDetectionResult>

  // Rules
  addRule(rule: ThreatRule): Promise<void>
  removeRule(ruleId: string): Promise<void>
}

interface ThreatAnalysis {
  riskScore: number  // 0-100
  threats: ThreatIndicator[]
  action: 'allow' | 'challenge' | 'block'
  reasons: string[]
}
```

**Test Categories**:
- Request analysis (8 tests)
- Brute force detection (8 tests)
- Account lockout (5 tests)
- Anomaly scoring (8 tests)
- IP reputation (6 tests)
- Bot detection (8 tests)
- Rule engine (7 tests)
- Rate limiting integration (5 tests)
- Edge cases (5 tests)

---

### Wave F: Application Layer (4 primitives, ~285 tests)

#### F1. notification-center (~80 tests)
**Purpose**: Multi-channel notification delivery

```typescript
interface NotificationCenter {
  // Send
  send(userId: string, template: string, data?: unknown): Promise<NotificationResult>
  sendBatch(notifications: BatchNotification[]): Promise<NotificationResult[]>

  // Channels
  registerChannel(channel: NotificationChannel): void

  // Templates
  registerTemplate(template: NotificationTemplate): void

  // Preferences
  getUserPreferences(userId: string): Promise<NotificationPreferences>
  updatePreferences(userId: string, prefs: Partial<NotificationPreferences>): Promise<void>

  // History
  getNotificationHistory(userId: string, options?: HistoryOptions): Promise<Notification[]>

  // Delivery tracking
  markAsRead(notificationId: string): Promise<void>
  getDeliveryStatus(notificationId: string): Promise<DeliveryStatus>
}

interface NotificationChannel {
  type: 'email' | 'sms' | 'push' | 'in-app' | 'slack' | 'webhook'
  send(notification: RenderedNotification): Promise<void>
}

interface NotificationTemplate {
  id: string
  channels: Record<string, ChannelTemplate>
  defaults?: {
    priority?: 'low' | 'normal' | 'high' | 'urgent'
    category?: string
  }
}
```

**Test Categories**:
- Send single notification (6 tests)
- Multi-channel delivery (8 tests)
- Template rendering (8 tests)
- User preferences (8 tests)
- Channel fallback (5 tests)
- Batch sending (5 tests)
- Delivery tracking (6 tests)
- Read receipts (4 tests)
- Rate limiting (5 tests)
- Retry logic (6 tests)
- History queries (5 tests)
- Scheduling (6 tests)
- Edge cases (8 tests)

---

#### F2. billing-engine (~95 tests)
**Purpose**: Subscriptions, usage billing, invoicing

```typescript
interface BillingEngine {
  // Customers
  createCustomer(customer: CustomerInput): Promise<Customer>
  updateCustomer(customerId: string, updates: Partial<CustomerInput>): Promise<Customer>

  // Subscriptions
  createSubscription(customerId: string, planId: string, options?: SubscriptionOptions): Promise<Subscription>
  updateSubscription(subscriptionId: string, updates: SubscriptionUpdate): Promise<Subscription>
  cancelSubscription(subscriptionId: string, options?: CancelOptions): Promise<Subscription>

  // Usage
  recordUsage(subscriptionId: string, usage: UsageRecord): Promise<void>
  getUsageSummary(subscriptionId: string, period?: BillingPeriod): Promise<UsageSummary>

  // Invoices
  createInvoice(customerId: string, items: InvoiceItem[]): Promise<Invoice>
  finalizeInvoice(invoiceId: string): Promise<Invoice>
  getInvoice(invoiceId: string): Promise<Invoice>

  // Payments
  processPayment(invoiceId: string, paymentMethod: string): Promise<Payment>
  refund(paymentId: string, amount?: number): Promise<Refund>

  // Plans
  createPlan(plan: PlanInput): Promise<Plan>
  updatePlan(planId: string, updates: Partial<PlanInput>): Promise<Plan>
}

interface Plan {
  id: string
  name: string
  pricing: Pricing
  features: Feature[]
  limits?: Limits
  trialDays?: number
}

type Pricing =
  | { type: 'flat', amount: number, interval: Interval }
  | { type: 'tiered', tiers: Tier[], interval: Interval }
  | { type: 'usage', unitAmount: number, meter: string }
  | { type: 'hybrid', base: number, usage: UsagePricing[], interval: Interval }
```

**Test Categories**:
- Customer management (8 tests)
- Subscription lifecycle (12 tests)
- Plan changes (6 tests)
- Cancellation (6 tests)
- Usage recording (8 tests)
- Usage aggregation (6 tests)
- Invoice generation (8 tests)
- Invoice finalization (5 tests)
- Payment processing (8 tests)
- Refunds (5 tests)
- Tiered pricing (6 tests)
- Usage-based pricing (6 tests)
- Proration (5 tests)
- Trials (4 tests)
- Edge cases (8 tests)

---

#### F3. analytics-tracker (~55 tests)
**Purpose**: Event tracking and user analytics

```typescript
interface AnalyticsTracker {
  // Identification
  identify(userId: string, traits?: UserTraits): void
  alias(newId: string, previousId: string): void

  // Tracking
  track(event: string, properties?: EventProperties): void
  page(name?: string, properties?: PageProperties): void
  screen(name: string, properties?: ScreenProperties): void
  group(groupId: string, traits?: GroupTraits): void

  // Destinations
  addDestination(destination: AnalyticsDestination): void

  // Batching
  flush(): Promise<void>

  // Sampling
  setSamplingRate(rate: number): void
  setSamplingRules(rules: SamplingRule[]): void

  // Privacy
  setAnonymousId(id: string): void
  reset(): void
}

interface AnalyticsDestination {
  name: string
  send(batch: AnalyticsBatch): Promise<void>
}

interface SamplingRule {
  event: string | RegExp
  rate: number
}
```

**Test Categories**:
- Identify users (5 tests)
- Track events (6 tests)
- Page/screen views (4 tests)
- Group membership (4 tests)
- Event properties (5 tests)
- Batching (6 tests)
- Destinations (6 tests)
- Sampling (6 tests)
- Privacy controls (5 tests)
- Alias handling (4 tests)
- Edge cases (4 tests)

---

#### F4. error-tracker (~55 tests)
**Purpose**: Error capture and monitoring

```typescript
interface ErrorTracker {
  // Capture
  captureException(error: Error, context?: ErrorContext): string
  captureMessage(message: string, level?: ErrorLevel, context?: ErrorContext): string

  // Breadcrumbs
  addBreadcrumb(breadcrumb: Breadcrumb): void

  // Context
  setUser(user: ErrorUser): void
  setTags(tags: Record<string, string>): void
  setExtras(extras: Record<string, unknown>): void
  setContext(name: string, context: Record<string, unknown>): void

  // Scope
  withScope(callback: (scope: Scope) => void): void
  configureScope(callback: (scope: Scope) => void): void

  // Release tracking
  setRelease(release: string): void

  // Performance
  startTransaction(context: TransactionContext): Transaction

  // Filtering
  addEventProcessor(processor: EventProcessor): void
}

interface ErrorContext {
  tags?: Record<string, string>
  extras?: Record<string, unknown>
  user?: ErrorUser
  level?: ErrorLevel
  fingerprint?: string[]
}
```

**Test Categories**:
- Exception capture (6 tests)
- Message capture (4 tests)
- Breadcrumbs (6 tests)
- User context (5 tests)
- Tags and extras (5 tests)
- Scope management (6 tests)
- Event processors (5 tests)
- Fingerprinting (5 tests)
- Release tracking (4 tests)
- Transactions (5 tests)
- Edge cases (4 tests)

---

### Wave G: Developer Experience (4 primitives, ~240 tests)

#### G1. api-client (~65 tests)
**Purpose**: End-to-end type-safe API client (tRPC pattern)

```typescript
// Server-side router definition
interface RouterBuilder {
  query<I, O>(name: string, config: QueryConfig<I, O>): RouterBuilder
  mutation<I, O>(name: string, config: MutationConfig<I, O>): RouterBuilder
  subscription<I, O>(name: string, config: SubscriptionConfig<I, O>): RouterBuilder
  middleware(fn: MiddlewareFn): RouterBuilder
  router(prefix: string, router: Router): RouterBuilder
  build(): Router
}

// Client-side
type InferRouterClient<R extends Router> = {
  [K in keyof R]: R[K] extends Query<infer I, infer O>
    ? (input: I) => Promise<O>
    : R[K] extends Mutation<infer I, infer O>
    ? (input: I) => Promise<O>
    : never
}

function createClient<R extends Router>(options: ClientOptions): InferRouterClient<R>
```

**Test Categories**:
- Query definition (6 tests)
- Mutation definition (6 tests)
- Input validation (6 tests)
- Output validation (5 tests)
- Middleware chain (6 tests)
- Error handling (6 tests)
- Type inference (8 tests)
- Client generation (6 tests)
- Batching (5 tests)
- Subscriptions (6 tests)
- Edge cases (5 tests)

---

#### G2. data-loader (~45 tests)
**Purpose**: Request batching and caching

```typescript
interface DataLoader<K, V> {
  load(key: K): Promise<V>
  loadMany(keys: K[]): Promise<Array<V | Error>>
  clear(key: K): DataLoader<K, V>
  clearAll(): DataLoader<K, V>
  prime(key: K, value: V): DataLoader<K, V>
}

interface DataLoaderOptions<K, V> {
  batchFn: (keys: K[]) => Promise<V[]>
  cacheKeyFn?: (key: K) => string
  cache?: boolean
  maxBatchSize?: number
  batchScheduleFn?: (callback: () => void) => void
}

function createDataLoader<K, V>(options: DataLoaderOptions<K, V>): DataLoader<K, V>
```

**Test Categories**:
- Batching (8 tests)
- Caching (6 tests)
- Cache priming (4 tests)
- Cache clearing (4 tests)
- Error handling (6 tests)
- Max batch size (4 tests)
- Custom cache key (4 tests)
- Batch scheduling (4 tests)
- Edge cases (5 tests)

---

#### G3. real-time-sync (~70 tests)
**Purpose**: Real-time collaboration primitives

```typescript
interface Room<P extends Presence, S extends Storage> {
  // Connection
  connect(): Promise<void>
  disconnect(): void

  // Presence
  updatePresence(presence: Partial<P>): void
  getPresence(): P
  getOthers(): Array<{ connectionId: string; presence: P }>

  // Storage
  getStorage(): S

  // Events
  subscribe(type: 'presence', callback: PresenceCallback<P>): () => void
  subscribe(type: 'storage', callback: StorageCallback<S>): () => void
  subscribe(type: 'connection', callback: ConnectionCallback): () => void

  // Undo/Redo
  undo(): void
  redo(): void
  canUndo(): boolean
  canRedo(): boolean

  // Batch
  batch(callback: () => void): void
}

// CRDT types
interface LiveList<T> {
  push(item: T): void
  insert(index: number, item: T): void
  delete(index: number): void
  move(from: number, to: number): void
  get(index: number): T
  toArray(): T[]
}

interface LiveMap<K, V> {
  set(key: K, value: V): void
  get(key: K): V | undefined
  delete(key: K): void
  has(key: K): boolean
  entries(): IterableIterator<[K, V]>
}

interface LiveObject<T extends Record<string, unknown>> {
  get<K extends keyof T>(key: K): T[K]
  set<K extends keyof T>(key: K, value: T[K]): void
  toObject(): T
}
```

**Test Categories**:
- Room connection (6 tests)
- Presence updates (8 tests)
- Presence subscription (5 tests)
- LiveList operations (10 tests)
- LiveMap operations (8 tests)
- LiveObject operations (6 tests)
- Storage subscriptions (5 tests)
- Undo/redo (6 tests)
- Batch operations (5 tests)
- Conflict resolution (6 tests)
- Edge cases (5 tests)

---

#### G4. multi-tenancy (~60 tests)
**Purpose**: Tenant isolation and management

```typescript
interface MultiTenancy {
  // Tenant resolution
  resolve(request: Request): Promise<Tenant | null>

  // Tenant management
  createTenant(tenant: TenantInput): Promise<Tenant>
  updateTenant(tenantId: string, updates: Partial<TenantInput>): Promise<Tenant>
  deleteTenant(tenantId: string): Promise<void>
  getTenant(tenantId: string): Promise<Tenant | null>

  // Context
  withTenant<T>(tenantId: string, fn: () => Promise<T>): Promise<T>
  getCurrentTenant(): Tenant | null

  // Isolation
  getIsolationStrategy(): IsolationStrategy

  // Limits
  checkLimit(tenantId: string, resource: string): Promise<LimitCheck>
  recordUsage(tenantId: string, resource: string, amount: number): Promise<void>
}

type IsolationStrategy =
  | { type: 'shared', discriminator: string }      // Row-level
  | { type: 'schema', schemaPrefix: string }       // Schema per tenant
  | { type: 'database', connectionResolver: (tenantId: string) => string }

interface TenantInput {
  id?: string
  name: string
  subdomain?: string
  customDomain?: string
  settings?: Record<string, unknown>
  limits?: TenantLimits
}
```

**Test Categories**:
- Tenant resolution (8 tests)
- Subdomain resolution (5 tests)
- Custom domain resolution (5 tests)
- Tenant CRUD (8 tests)
- Row-level isolation (6 tests)
- Schema isolation (5 tests)
- Context propagation (5 tests)
- Limit checking (6 tests)
- Usage tracking (5 tests)
- Edge cases (7 tests)

---

## Summary

| Wave | Primitives | Tests | Focus |
|------|------------|-------|-------|
| A | 4 | ~210 | Foundation (locks, context, idempotency, events) |
| B | 4 | ~305 | Data Infrastructure (time-series, events, queues) |
| C | 4 | ~225 | Enhanced Processing (windows, geo, CDC, schemas) |
| D | 3 | ~160 | Observability (tracing, blobs, lineage) |
| E | 4 | ~275 | Security (MFA, passwords, identity, threats) |
| F | 4 | ~285 | Application (notifications, billing, analytics) |
| G | 4 | ~240 | Developer Experience (API client, data-loader, sync) |
| **Total** | **27** | **~1,700** | |

## Implementation Order

1. **Wave A first** - Everything depends on distributed-lock, request-context, and event-bus
2. **Wave B second** - Data primitives are needed by application layer
3. **Waves C-D parallel** - Processing and observability can proceed together
4. **Wave E next** - Security before application features
5. **Waves F-G last** - Application and DX features build on everything else

## Next Steps

1. Create beads issues for each primitive
2. Set up dependency graph in beads
3. Begin Wave A implementation with TDD
