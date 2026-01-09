# Hybrid Iceberg Architecture: Workers + R2 Data Catalog + Browser

## Executive Summary

This document describes a hybrid query execution architecture that leverages the best capabilities of each platform:

- **Browser DuckDB-WASM**: Heavy analytics with zero server compute cost
- **Cloudflare Workers**: Fast point lookups, API layer, query routing
- **R2 Data Catalog**: Iceberg metadata management, transaction coordination
- **Durable Objects**: Metadata caching, write coordination, state management

The architecture achieves:
- Point lookups: **< 100ms** (direct R2 Parquet read)
- Analytics queries: **Zero compute cost** (browser-side execution)
- Writes: **Strong consistency** via DO transaction coordination
- Complex queries: **Scalable fan-out** using worker partitioning

---

## Architecture Diagram

```
                                    HYBRID ICEBERG QUERY ARCHITECTURE
                                    ==================================

  CLIENT (Browser)                           EDGE (Workers)                         STORAGE (R2)
  ================                           ==============                         ============

  +-------------------+                    +------------------+
  | Query SDK         |                    | Query Router     |
  | (TypeScript)      |                    | Worker           |
  |                   |                    |                  |
  | - Query builder   | ----HTTP/WS---->   | - Query analyzer |
  | - Plan executor   |                    | - Route selector |
  | - Result cache    | <---Query Plan---- | - Cost estimator |
  +-------------------+                    +--------+---------+
         |                                          |
         |                                          v
         |                                 +------------------+                    +------------------+
         |                                 | Iceberg Metadata |                    | R2 Data Catalog  |
         |                                 | DO (Cache)       | <---REST API--->   | (Managed)        |
         |                                 |                  |                    |                  |
         |                                 | - metadata.json  |                    | - Namespaces     |
         |                                 | - Manifest cache |                    | - Tables         |
         |                                 | - Bloom filters  |                    | - Snapshots      |
         |                                 | - Partition map  |                    | - Scan Planning  |
         |                                 +--------+---------+                    +--------+---------+
         |                                          |                                       |
         |                                          v                                       |
         |   PATH A: Browser Analytics    +------------------+                              |
         | <-----Presigned URLs---------- | URL Signer       |                              |
         |                                | Worker           |                              |
         v                                +------------------+                              |
  +-------------------+                            |                                        |
  | DuckDB-WASM       |                            |                                        |
  | (In-Browser)      |                            v                                        |
  |                   |   PATH B: Point    +------------------+                    +--------+---------+
  | - Iceberg ext     |   Lookup           | Point Lookup     |                    |                  |
  | - Arrow IPC       | -----------------> | Worker           | ----Direct GET---> | R2 Bucket        |
  | - Web Workers     |                    |                  |                    |                  |
  | - OPFS cache      | <--Single Record-- | - Partition prune|                    | - Parquet files  |
  +-------------------+                    | - Stats check    |                    | - Manifest files |
         |                                 | - Parquet read   |                    | - Metadata       |
         |                                 +------------------+                    +------------------+
         |                                          |                                       ^
         |   PATH C: Federated           +----------+----------+                            |
         |   Query                       |                     |                            |
         |                        +------v------+       +------v------+                     |
         |                        | Data Worker | . . . | Data Worker |                     |
         |                        | (Shard 1)   |       | (Shard N)   | ----Fan-out GET---->+
         |                        +------+------+       +------+------+
         |                               |                     |
         |                               v                     v
         | <---------Aggregated---------+----------+----------+
                        Results         | Coordinator Worker   |
                                        | (Aggregation)        |
                                        +----------------------+

                                                   |
  PATH D: Write                                    v
  ============                            +------------------+
                                          | Transaction      |
  +-------------------+                   | Manager DO       |
  | Write Client      | ----Mutation----> |                  |
  |                   |                   | - WAL buffer     |
  | - Batch writer    |                   | - Conflict check |
  | - Parquet gen     |                   | - Atomic commit  |
  +-------------------+                   +--------+---------+
                                                   |
                                                   | Commit via REST API
                                                   v
                                          +------------------+
                                          | R2 Data Catalog  |
                                          | (Iceberg Commit) |
                                          +------------------+
```

---

## Query Execution Paths

### Use Case 1: Point Lookup (< 100ms)

**When to use**: Single record retrieval by known key with partition hints.

```
Client --> Query Router Worker --> Iceberg Metadata DO --> R2 (direct Parquet read) --> Response
```

**Sequence**:

```typescript
// 1. Client sends point lookup request
const response = await fetch('/api/v1/iceberg/lookup', {
  method: 'POST',
  body: JSON.stringify({
    table: 'do_resources',
    partition: { ns: 'payments.do', type: 'Function' },
    id: 'charge',
  }),
})

// 2. Worker checks DO cache for metadata
const metadata = await icebergMetadataDO.getMetadata(table)

// 3. Worker prunes partitions, gets file path
const file = await findFile({ table, partition, id })

// 4. Worker reads specific row group from Parquet
const record = await readParquetRecord(env.R2, file.path, id)

// 5. Return single record
return new Response(JSON.stringify(record))
```

**Latency Breakdown**:
| Step | Target | Description |
|------|--------|-------------|
| Route analysis | 5ms | Parse request, determine path |
| DO cache hit | 10ms | Get cached metadata from DO |
| DO cache miss | 50ms | Fetch metadata from R2 |
| Partition prune | 5ms | Filter manifests by bounds |
| R2 GET (Parquet) | 30-50ms | Single file read |
| **Total** | **50-120ms** | |

### Use Case 2: Analytics Query (Browser-Powered)

**When to use**: Complex aggregations, joins, large scans where compute cost matters.

```
Client --> Worker (plan) --> Client gets plan --> Browser DuckDB-WASM --> R2 via CORS --> Results
```

**Sequence**:

```typescript
// 1. Client sends query for planning
const planResponse = await fetch('/api/v1/iceberg/plan', {
  method: 'POST',
  body: JSON.stringify({
    sql: `SELECT region, SUM(revenue) as total
          FROM do_analytics.sales
          WHERE year = 2024
          GROUP BY region`,
    executionHint: 'client', // Prefer client-side
  }),
})

// 2. Worker returns execution plan (not results!)
const plan: QueryPlan = await planResponse.json()
// {
//   type: 'client-execute',
//   dataFiles: [
//     { url: 'https://r2.../sales/year=2024/part-0.parquet', sizeBytes: 1234567 },
//     { url: 'https://r2.../sales/year=2024/part-1.parquet', sizeBytes: 2345678 },
//   ],
//   credentials: { ... }, // Temporary R2 credentials
//   estimatedRows: 1000000,
//   estimatedSizeBytes: 50000000,
//   optimizedSql: 'SELECT region, SUM(revenue) ...',
// }

// 3. Client executes with DuckDB-WASM
const db = await initDuckDB()
for (const file of plan.dataFiles) {
  const buffer = await fetch(file.url, { headers: plan.credentials }).then(r => r.arrayBuffer())
  await db.registerBuffer(`part_${i}.parquet`, buffer)
}
const result = await db.query(plan.optimizedSql)

// 4. Zero server compute cost!
```

**Key Innovation**: The worker never processes data - it only provides:
- Partition-pruned file list
- Presigned URLs or vended credentials
- Optimized SQL with pushdown applied
- Estimated costs for client decision-making

### Use Case 3: Write Operation

**When to use**: Any data mutation (INSERT, UPDATE, DELETE).

```
Client --> Worker --> Transaction Manager DO --> R2 + R2 Data Catalog --> Commit
```

**Sequence**:

```typescript
// 1. Client batches writes
const writeResponse = await fetch('/api/v1/iceberg/write', {
  method: 'POST',
  body: JSON.stringify({
    table: 'do_analytics.events',
    records: [
      { id: 'evt_1', type: 'click', timestamp: '2024-01-01T00:00:00Z' },
      { id: 'evt_2', type: 'view', timestamp: '2024-01-01T00:00:01Z' },
    ],
  }),
})

// 2. Worker routes to Transaction Manager DO
const txDO = env.TRANSACTION_MANAGER.get(
  env.TRANSACTION_MANAGER.idFromName(`table:${table}`)
)

// 3. DO handles transactional write
await txDO.fetch('/write', {
  method: 'POST',
  body: JSON.stringify({ records }),
})

// Inside Transaction Manager DO:
class TransactionManagerDO {
  async write(records: Record[]) {
    // 3a. Append to WAL (in DO storage)
    await this.wal.append(records)

    // 3b. Check batch size threshold
    if (this.wal.size >= COMMIT_THRESHOLD) {
      await this.commit()
    }
  }

  async commit() {
    // 3c. Generate Parquet file
    const parquet = await generateParquet(this.wal.records)

    // 3d. Upload to R2
    const dataFile = `data/${uuid()}.parquet`
    await this.env.R2.put(dataFile, parquet)

    // 3e. Commit via R2 Data Catalog REST API
    await this.catalog.commitTable(this.table, {
      requirements: [
        { type: 'assert-ref-snapshot-id', ref: 'main', snapshotId: this.currentSnapshotId },
      ],
      updates: [
        { action: 'add-snapshot', snapshot: newSnapshot },
        { action: 'set-snapshot-ref', refName: 'main', type: 'branch', snapshotId: newSnapshotId },
      ],
    })

    // 3f. Clear WAL
    this.wal.clear()

    // 3g. Invalidate metadata cache
    await this.metadataDO.invalidate(this.table)
  }
}
```

### Use Case 4: Federated Query (Distributed)

**When to use**: Queries too complex for browser, requiring parallel partition processing.

```
Client --> Coordinator Worker --> N Data Workers --> R2 shards --> Aggregate --> Response
```

**Sequence**:

```typescript
// 1. Client requests federated execution
const response = await fetch('/api/v1/iceberg/query', {
  method: 'POST',
  body: JSON.stringify({
    sql: `SELECT customer_id, SUM(amount) as total
          FROM do_analytics.transactions
          WHERE date >= '2024-01-01'
          GROUP BY customer_id
          HAVING total > 10000`,
    executionHint: 'server', // Force server execution
  }),
})

// 2. Coordinator analyzes and fans out
async function coordinateQuery(sql: string, ctx: ExecutionContext) {
  // 2a. Get partitions from scan planning
  const scanPlan = await catalog.planScan(table, filters)

  // 2b. Group files by partition for parallel execution
  const partitions = groupByPartition(scanPlan.files)

  // 2c. Fan out to data workers
  const workerPromises = partitions.map((partition, i) =>
    ctx.waitUntil(
      fetch(`https://data-worker-${i % NUM_WORKERS}.workers.dev/execute`, {
        method: 'POST',
        body: JSON.stringify({
          files: partition.files,
          sql: pushdownSql, // Partial aggregation SQL
        }),
      }).then(r => r.json())
    )
  )

  // 2d. Collect partial results
  const partialResults = await Promise.all(workerPromises)

  // 2e. Final aggregation
  const finalResult = mergeResults(partialResults)

  return finalResult
}
```

---

## Component Specifications

### 1. Query Router Worker

The entry point for all queries. Analyzes queries and routes to optimal execution path.

```typescript
// api/iceberg/router.ts

interface QueryRequest {
  sql?: string
  operation?: 'lookup' | 'scan' | 'write'
  table: string
  partition?: PartitionFilter
  id?: string
  executionHint?: 'client' | 'server' | 'auto'
}

interface QueryAnalysis {
  queryType: 'point-lookup' | 'range-scan' | 'aggregation' | 'join' | 'write'
  estimatedRows: number
  estimatedSizeBytes: number
  partitionsPruned: number
  partitionsRemaining: number
  recommendedPath: ExecutionPath
  clientCapable: boolean
  serverRequired: boolean
}

type ExecutionPath =
  | { type: 'point-lookup' }
  | { type: 'client-execute'; plan: ClientExecutionPlan }
  | { type: 'server-execute'; strategy: 'single' | 'federated' }
  | { type: 'write'; transactionId: string }

export class QueryRouter {
  constructor(
    private env: Env,
    private metadataDO: DurableObjectStub,
    private catalog: R2DataCatalog
  ) {}

  async route(request: QueryRequest): Promise<Response> {
    // 1. Analyze the query
    const analysis = await this.analyze(request)

    // 2. Apply routing decision tree
    const path = this.selectExecutionPath(request, analysis)

    // 3. Execute or return plan
    switch (path.type) {
      case 'point-lookup':
        return this.executePointLookup(request)

      case 'client-execute':
        return this.returnClientPlan(path.plan)

      case 'server-execute':
        if (path.strategy === 'federated') {
          return this.executeFederated(request, analysis)
        }
        return this.executeSingle(request)

      case 'write':
        return this.routeToTransaction(request, path.transactionId)
    }
  }

  private selectExecutionPath(
    request: QueryRequest,
    analysis: QueryAnalysis
  ): ExecutionPath {
    // See Decision Tree below
    return applyDecisionTree(request, analysis)
  }
}
```

### 2. Iceberg Metadata Durable Object

Caches Iceberg metadata with intelligent invalidation.

```typescript
// objects/IcebergMetadataDO.ts

interface MetadataCache {
  metadata: IcebergMetadata
  manifests: Map<string, ManifestFile[]>
  partitionIndex: PartitionIndex
  bloomFilters: Map<string, BloomFilter>
  cachedAt: number
  version: number
}

interface PartitionIndex {
  // Fast lookup: partition values -> manifest paths
  index: Map<string, string[]>
  // Min/max ranges per partition column
  ranges: Map<string, { min: string; max: string }>
}

export class IcebergMetadataDO extends DurableObject {
  private cache: Map<string, MetadataCache> = new Map()

  async getMetadata(table: string): Promise<IcebergMetadata> {
    const cached = this.cache.get(table)

    if (cached && !this.isStale(cached)) {
      return cached.metadata
    }

    // Fetch from R2 Data Catalog
    const metadata = await this.catalog.loadTable(table)

    // Build indexes for fast lookup
    const partitionIndex = await this.buildPartitionIndex(metadata)

    // Optional: Build bloom filters for ID columns
    const bloomFilters = await this.buildBloomFilters(metadata)

    this.cache.set(table, {
      metadata,
      manifests: new Map(),
      partitionIndex,
      bloomFilters,
      cachedAt: Date.now(),
      version: metadata.currentSnapshotId ?? 0,
    })

    return metadata
  }

  async invalidate(table: string): Promise<void> {
    this.cache.delete(table)

    // Broadcast invalidation to other DOs if sharded
    await this.broadcastInvalidation(table)
  }

  // Partition pruning helper
  async getMatchingManifests(
    table: string,
    partition: PartitionFilter
  ): Promise<ManifestFile[]> {
    const cache = this.cache.get(table)
    if (!cache) {
      await this.getMetadata(table)
      return this.getMatchingManifests(table, partition)
    }

    // Use partition index for O(1) lookup
    const key = `${partition.ns}|${partition.type}`
    const manifestPaths = cache.partitionIndex.index.get(key) ?? []

    return manifestPaths.map(path =>
      cache.manifests.get(path)
    ).filter(Boolean).flat()
  }

  // Bloom filter check for ID existence
  async mayContainId(table: string, partition: PartitionFilter, id: string): Promise<boolean> {
    const cache = this.cache.get(table)
    if (!cache) return true // Assume yes if no cache

    const key = `${partition.ns}|${partition.type}`
    const bloom = cache.bloomFilters.get(key)
    if (!bloom) return true

    return bloom.mayContain(id)
  }
}
```

### 3. Browser Query SDK

Client-side library for executing query plans with DuckDB-WASM.

```typescript
// packages/iceberg-client/src/index.ts

interface IcebergClientConfig {
  endpoint: string
  credentials?: () => Promise<Credentials>
  cacheOptions?: {
    useOPFS?: boolean
    maxCacheSize?: number
  }
}

interface QueryOptions {
  sql: string
  executionHint?: 'client' | 'server' | 'auto'
  progressCallback?: (progress: QueryProgress) => void
}

interface QueryProgress {
  phase: 'planning' | 'downloading' | 'executing' | 'complete'
  bytesDownloaded?: number
  totalBytes?: number
  rowsProcessed?: number
  estimatedRowsTotal?: number
}

export class IcebergClient {
  private db: DuckDBInstance | null = null
  private cache: OPFSCache | null = null

  constructor(private config: IcebergClientConfig) {}

  async query<T = Record<string, unknown>>(
    options: QueryOptions
  ): Promise<T[]> {
    // 1. Get execution plan from server
    const plan = await this.getQueryPlan(options)

    // 2. If server-execute, wait for results
    if (plan.type === 'server-execute') {
      return this.waitForServerResults(plan.executionId)
    }

    // 3. Client-side execution
    options.progressCallback?.({ phase: 'downloading', bytesDownloaded: 0, totalBytes: plan.estimatedSizeBytes })

    // Initialize DuckDB if needed
    if (!this.db) {
      this.db = await this.initDuckDB()
    }

    // 4. Download and register data files
    let downloaded = 0
    for (const file of plan.dataFiles) {
      // Check OPFS cache first
      let buffer = await this.cache?.get(file.url)

      if (!buffer) {
        buffer = await this.downloadFile(file.url, plan.credentials)
        await this.cache?.set(file.url, buffer)
      }

      await this.db.registerBuffer(file.name, buffer)
      downloaded += file.sizeBytes
      options.progressCallback?.({
        phase: 'downloading',
        bytesDownloaded: downloaded,
        totalBytes: plan.estimatedSizeBytes
      })
    }

    // 5. Execute optimized SQL
    options.progressCallback?.({ phase: 'executing' })
    const result = await this.db.query<T>(plan.optimizedSql)

    // 6. Clean up registered buffers
    for (const file of plan.dataFiles) {
      await this.db.dropBuffer(file.name)
    }

    options.progressCallback?.({ phase: 'complete', rowsProcessed: result.rows.length })
    return result.rows
  }

  private async initDuckDB(): Promise<DuckDBInstance> {
    const db = await createDuckDB()

    // Install Iceberg extension for metadata awareness
    await db.query("INSTALL iceberg; LOAD iceberg;")

    // Configure for optimal browser performance
    await db.query("SET threads=4;") // Use web workers
    await db.query("SET memory_limit='1GB';")

    return db
  }

  // Point lookup shortcut (always server-side)
  async get<T>(
    table: string,
    partition: PartitionFilter,
    id: string
  ): Promise<T | null> {
    const response = await fetch(`${this.config.endpoint}/lookup`, {
      method: 'POST',
      body: JSON.stringify({ table, partition, id }),
    })

    if (response.status === 404) return null
    return response.json()
  }
}
```

### 4. Transaction Manager Durable Object

Handles write coordination with ACID guarantees.

```typescript
// objects/TransactionManagerDO.ts

interface WriteRequest {
  table: string
  records: Record<string, unknown>[]
  partitionKey?: string
}

interface WALEntry {
  id: string
  timestamp: number
  records: Record<string, unknown>[]
  partition: string
}

const COMMIT_THRESHOLD = 1000 // records
const COMMIT_INTERVAL_MS = 5000 // 5 seconds

export class TransactionManagerDO extends DurableObject {
  private wal: WALEntry[] = []
  private currentSnapshotId: number | null = null
  private commitTimer: number | null = null

  async write(request: WriteRequest): Promise<{ success: boolean; txId: string }> {
    const txId = crypto.randomUUID()

    // 1. Append to WAL in DO storage (durable immediately)
    const entry: WALEntry = {
      id: txId,
      timestamp: Date.now(),
      records: request.records,
      partition: this.computePartition(request),
    }

    await this.state.storage.put(`wal:${txId}`, entry)
    this.wal.push(entry)

    // 2. Check if we should commit
    const totalRecords = this.wal.reduce((sum, e) => sum + e.records.length, 0)

    if (totalRecords >= COMMIT_THRESHOLD) {
      await this.commit()
    } else if (!this.commitTimer) {
      // Schedule delayed commit
      this.commitTimer = this.state.waitUntil(
        new Promise(resolve => setTimeout(resolve, COMMIT_INTERVAL_MS))
          .then(() => this.commit())
      )
    }

    return { success: true, txId }
  }

  async commit(): Promise<void> {
    if (this.wal.length === 0) return

    const entriestoCommit = [...this.wal]
    this.wal = []
    this.commitTimer = null

    try {
      // 1. Generate Parquet file from WAL entries
      const allRecords = entriestoCommit.flatMap(e => e.records)
      const parquetBuffer = await this.generateParquet(allRecords)

      // 2. Upload data file to R2
      const dataFilePath = `data/${this.table}/${Date.now()}-${crypto.randomUUID()}.parquet`
      await this.env.R2.put(dataFilePath, parquetBuffer)

      // 3. Generate manifest entry
      const manifestEntry = await this.createManifestEntry(dataFilePath, allRecords)

      // 4. Atomic commit via R2 Data Catalog
      const newSnapshotId = Date.now()
      await this.catalog.commitTable(this.namespace, this.tableName, {
        identifier: { namespace: [this.namespace], name: this.tableName },
        requirements: [
          {
            type: 'assert-ref-snapshot-id',
            ref: 'main',
            snapshotId: this.currentSnapshotId
          },
        ],
        updates: [
          {
            action: 'add-snapshot',
            snapshot: {
              snapshotId: newSnapshotId,
              parentSnapshotId: this.currentSnapshotId,
              timestampMs: Date.now(),
              manifestList: `metadata/manifest-list-${newSnapshotId}.avro`,
              summary: {
                operation: 'append',
                'added-files-size': String(parquetBuffer.byteLength),
                'added-records': String(allRecords.length),
              },
            },
          },
          {
            action: 'set-snapshot-ref',
            refName: 'main',
            type: 'branch',
            snapshotId: newSnapshotId,
          },
        ],
      })

      this.currentSnapshotId = newSnapshotId

      // 5. Clean up committed WAL entries
      for (const entry of entriestoCommit) {
        await this.state.storage.delete(`wal:${entry.id}`)
      }

      // 6. Invalidate metadata cache
      await this.invalidateCache()

    } catch (error) {
      // On failure, entries remain in WAL for retry
      this.wal = [...entriestoCommit, ...this.wal]
      throw error
    }
  }

  private async invalidateCache(): Promise<void> {
    const metadataDO = this.env.ICEBERG_METADATA.get(
      this.env.ICEBERG_METADATA.idFromName(`table:${this.table}`)
    )
    await metadataDO.fetch('/invalidate', { method: 'POST' })
  }
}
```

---

## Query Routing Decision Tree

```
                              START: Incoming Query
                                       |
                                       v
                         +----------------------------+
                         | Is this a point lookup?    |
                         | (single ID with partition) |
                         +----------------------------+
                                |             |
                               YES           NO
                                |             |
                                v             v
                    +---------------+   +----------------------------+
                    | PATH A:       |   | Is this a write operation? |
                    | Point Lookup  |   +----------------------------+
                    | (Worker)      |         |              |
                    | Target: <100ms|        YES            NO
                    +---------------+         |              |
                                             v              v
                              +---------------+   +---------------------------+
                              | PATH D:       |   | Analyze query complexity  |
                              | Write via     |   +---------------------------+
                              | Transaction DO|             |
                              +---------------+             v
                                           +--------------------------------+
                                           | Estimate data size & complexity |
                                           +--------------------------------+
                                                    |
                                                    v
                                        +------------------------+
                                        | Data size < 100MB AND  |
                                        | No complex joins AND   |
                                        | Client supports WASM?  |
                                        +------------------------+
                                              |            |
                                            YES          NO
                                              |            |
                                              v            v
                                  +-----------------+  +------------------+
                                  | PATH B:         |  | Subrequest count |
                                  | Browser Execute |  | < 50?            |
                                  | (Zero compute)  |  +------------------+
                                  +-----------------+       |          |
                                                          YES        NO
                                                           |          |
                                                           v          v
                                            +----------------+  +----------------+
                                            | PATH C:        |  | PATH C:        |
                                            | Server Single  |  | Federated      |
                                            | Worker Execute |  | Multi-Worker   |
                                            +----------------+  +----------------+
```

### Decision Factors

| Factor | Threshold | Impact |
|--------|-----------|--------|
| Data size | < 100MB | Client execution viable |
| Data size | 100MB - 1GB | Single server worker |
| Data size | > 1GB | Federated execution |
| Query complexity | Simple aggregation | Client-capable |
| Query complexity | Complex joins | Server-required |
| Subrequest count | < 50 | Single worker viable |
| Subrequest count | > 50 | Must federate |
| Client capability | DuckDB-WASM support | Enables Path B |
| Real-time requirement | < 200ms | Forces Path A or C |

---

## Query Plan API

### Plan Request

```typescript
interface PlanQueryRequest {
  // SQL query or structured query
  sql?: string
  query?: StructuredQuery

  // Execution preferences
  executionHint?: 'client' | 'server' | 'auto'

  // Client capabilities
  clientCapabilities?: {
    duckdbWasm?: boolean
    maxMemoryMB?: number
    opfsAvailable?: boolean
  }

  // Performance requirements
  requirements?: {
    maxLatencyMs?: number
    maxCostCents?: number
  }
}

interface StructuredQuery {
  table: string
  select?: string[]
  where?: FilterExpression[]
  groupBy?: string[]
  having?: FilterExpression[]
  orderBy?: OrderExpression[]
  limit?: number
  offset?: number
}
```

### Plan Response

```typescript
interface QueryPlan {
  // Plan metadata
  planId: string
  createdAt: string
  expiresAt: string

  // Execution type
  type: 'client-execute' | 'server-execute' | 'hybrid-execute'

  // For client-execute
  dataFiles?: DataFileInfo[]
  credentials?: TemporaryCredentials
  optimizedSql?: string

  // For server-execute
  executionId?: string
  pollEndpoint?: string
  estimatedCompletionMs?: number

  // Cost estimates
  estimates: QueryEstimates

  // Alternative plans (for 'auto' hint)
  alternatives?: AlternativePlan[]
}

interface DataFileInfo {
  // File location
  url: string
  name: string
  path: string

  // File metadata
  format: 'parquet' | 'avro'
  sizeBytes: number
  rowCount: number

  // Column info for projection pushdown
  columns: ColumnInfo[]

  // Partition values
  partition: Record<string, string | number>

  // Row group hints for predicate pushdown
  rowGroups?: RowGroupHint[]
}

interface RowGroupHint {
  index: number
  offset: number
  sizeBytes: number
  rowCount: number
  // Statistics for predicate pushdown
  stats: Record<string, { min: unknown; max: unknown; nullCount: number }>
}

interface QueryEstimates {
  // Data estimates
  totalSizeBytes: number
  totalRows: number
  resultSizeBytes: number
  resultRows: number

  // Cost estimates
  serverComputeCostCents: number
  egressCostCents: number

  // Performance estimates
  clientExecutionMs: number
  serverExecutionMs: number
  downloadTimeMs: number
}

interface TemporaryCredentials {
  type: 'presigned' | 'vended'

  // For presigned URLs (embedded in DataFileInfo.url)
  expiresAt?: string

  // For vended credentials
  accessKeyId?: string
  secretAccessKey?: string
  sessionToken?: string
  endpoint?: string
}

interface AlternativePlan {
  type: 'client-execute' | 'server-execute'
  estimates: QueryEstimates
  tradeoffs: string[]
}
```

### Example Plan Response

```json
{
  "planId": "plan_2024010112345",
  "createdAt": "2024-01-01T12:00:00Z",
  "expiresAt": "2024-01-01T12:15:00Z",
  "type": "client-execute",

  "dataFiles": [
    {
      "url": "https://account.r2.cloudflarestorage.com/bucket/data/sales/year=2024/month=01/part-0.parquet?X-Amz-...",
      "name": "part-0.parquet",
      "path": "data/sales/year=2024/month=01/part-0.parquet",
      "format": "parquet",
      "sizeBytes": 15728640,
      "rowCount": 125000,
      "columns": [
        { "name": "region", "type": "VARCHAR" },
        { "name": "revenue", "type": "DECIMAL(18,2)" },
        { "name": "date", "type": "DATE" }
      ],
      "partition": { "year": 2024, "month": 1 },
      "rowGroups": [
        {
          "index": 0,
          "offset": 0,
          "sizeBytes": 5242880,
          "rowCount": 41666,
          "stats": {
            "region": { "min": "APAC", "max": "NA", "nullCount": 0 },
            "revenue": { "min": 10.00, "max": 99999.99, "nullCount": 12 }
          }
        }
      ]
    }
  ],

  "credentials": {
    "type": "presigned",
    "expiresAt": "2024-01-01T12:15:00Z"
  },

  "optimizedSql": "SELECT region, SUM(revenue) as total FROM read_parquet(['part-0.parquet', 'part-1.parquet']) GROUP BY region ORDER BY total DESC",

  "estimates": {
    "totalSizeBytes": 47185920,
    "totalRows": 375000,
    "resultSizeBytes": 256,
    "resultRows": 5,
    "serverComputeCostCents": 0,
    "egressCostCents": 0.47,
    "clientExecutionMs": 1500,
    "serverExecutionMs": 800,
    "downloadTimeMs": 2000
  },

  "alternatives": [
    {
      "type": "server-execute",
      "estimates": {
        "totalSizeBytes": 47185920,
        "totalRows": 375000,
        "resultSizeBytes": 256,
        "resultRows": 5,
        "serverComputeCostCents": 0.05,
        "egressCostCents": 0,
        "clientExecutionMs": 0,
        "serverExecutionMs": 800,
        "downloadTimeMs": 50
      },
      "tradeoffs": [
        "Lower total latency (850ms vs 3500ms)",
        "Server compute cost ($0.05)",
        "No client CPU usage"
      ]
    }
  ]
}
```

---

## Cost/Latency Analysis

### Path A: Point Lookup

| Component | Latency | Cost | Notes |
|-----------|---------|------|-------|
| Worker invocation | 5ms | $0.00005 | Cold start excluded |
| DO cache hit | 10ms | $0.00001 | Most common case |
| DO cache miss | 50ms | $0.00003 | R2 GET + parse |
| Partition pruning | 5ms | - | In-memory |
| R2 GET (Parquet) | 30-50ms | $0.00036/GB | Class A op |
| Parquet parse | 10ms | - | Single row group |
| **Total (cache hit)** | **60ms** | **$0.0001** | |
| **Total (cache miss)** | **120ms** | **$0.0002** | |

### Path B: Browser Analytics

| Component | Latency | Cost | Notes |
|-----------|---------|------|-------|
| Worker (plan) | 30ms | $0.00005 | Query analysis |
| DO metadata | 10ms | $0.00001 | Cached |
| Presigned URL gen | 5ms | - | Per file |
| Network RTT | 20ms | - | Plan response |
| **Subtotal (planning)** | **65ms** | **$0.00006** | |
| | | | |
| File download (50MB) | 2000ms | $0.0045 | Egress |
| DuckDB init | 500ms | $0 | First query |
| Query execution | 1000ms | $0 | Client CPU |
| **Subtotal (execution)** | **3500ms** | **$0.0045** | |
| | | | |
| **Total** | **3565ms** | **$0.0046** | Zero compute! |

### Path C: Server Federated

| Component | Latency | Cost | Notes |
|-----------|---------|------|-------|
| Coordinator worker | 10ms | $0.00005 | |
| Scan planning | 30ms | $0.00003 | Via R2 Catalog |
| Fan-out to N workers | 5ms | - | Parallel |
| Per-shard processing | 200ms | $0.0001/worker | Parallel |
| R2 reads (N shards) | 50ms | $0.00036/GB | Parallel |
| Aggregation | 50ms | $0.00005 | Coordinator |
| **Total (10 shards)** | **345ms** | **$0.002** | |

### Path D: Write Operation

| Component | Latency | Cost | Notes |
|-----------|---------|------|-------|
| Worker routing | 5ms | $0.00005 | |
| DO WAL append | 10ms | $0.000001 | Per record |
| **Subtotal (ack)** | **15ms** | **$0.00005** | Return to client |
| | | | |
| Parquet generation | 100ms | - | Batched |
| R2 PUT | 50ms | $0.0045/GB | Class B |
| Catalog commit | 100ms | - | REST API |
| Cache invalidation | 10ms | $0.00001 | |
| **Subtotal (commit)** | **260ms** | **$0.005** | Async |

### Cost Comparison Summary

| Scenario | Browser Path | Server Path | Savings |
|----------|--------------|-------------|---------|
| 100MB scan | $0.009 (egress) | $0.05 (compute) | 82% |
| 500MB scan | $0.045 (egress) | $0.25 (compute) | 82% |
| 1GB scan | $0.09 (egress) | $0.50 (compute) | 82% |
| Point lookup | N/A | $0.0002 | - |

**Key insight**: Browser execution trades latency for cost. For non-time-critical analytics, the ~80% cost savings is significant at scale.

---

## Implementation Phases

### Phase 1: Foundation (Week 1-2)
- [ ] Iceberg Metadata DO with caching
- [ ] Point lookup path (Path A)
- [ ] Basic Query Router Worker

### Phase 2: Browser Execution (Week 3-4)
- [ ] Query Plan API
- [ ] Browser Query SDK
- [ ] Presigned URL generation
- [ ] OPFS caching layer

### Phase 3: Write Path (Week 5-6)
- [ ] Transaction Manager DO
- [ ] WAL implementation
- [ ] R2 Data Catalog commit integration
- [ ] Cache invalidation

### Phase 4: Federated Queries (Week 7-8)
- [ ] Coordinator Worker
- [ ] Data Worker pool
- [ ] Partition-aware routing
- [ ] Result aggregation

### Phase 5: Optimization (Week 9-10)
- [ ] Bloom filter indexes
- [ ] Partition index
- [ ] Query result caching
- [ ] Progressive loading

---

## References

- [DuckDB WASM + Iceberg in Browser](https://www.infoq.com/news/2026/01/duckdb-iceberg-browser-s3/) - January 2026 announcement
- [MotherDuck Dual Query Execution](https://motherduck.com/docs/key-tasks/data-apps/) - Hybrid architecture pattern
- [Apache Iceberg REST Catalog Spec](https://iceberg.apache.org/rest-catalog-spec/) - REST API specification
- [Iceberg Scan Planning API](https://medium.com/data-engineering-with-dremio/10-future-apache-iceberg-developments-to-look-forward-to-in-2025-7292a2a2101d) - 2025 roadmap
- [DuckDB WASM Architecture](https://thinhdanggroup.github.io/duckdb/) - Deep dive
- [Browser WASM + Arrow + Web Workers](https://motifanalytics.medium.com/my-browser-wasmt-prepared-for-this-using-duckdb-apache-arrow-and-web-workers-in-real-life-e3dd4695623d) - Production patterns
