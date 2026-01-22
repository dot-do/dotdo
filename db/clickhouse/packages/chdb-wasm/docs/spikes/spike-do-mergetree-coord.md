# Spike: Durable Objects for MergeTree Coordination

## Executive Summary

This spike designs how Cloudflare Durable Objects (DOs) can coordinate MergeTree operations in a distributed, serverless environment. The key insight is that DOs provide **single-threaded, transactional execution** with persistent storage, making them ideal for coordinating concurrent writes, managing part metadata, and orchestrating background merges.

**Conclusion**: A hierarchical DO architecture with table-level coordinators and partition-level workers provides the optimal balance of consistency, performance, and scalability. This design enables true MergeTree semantics on Cloudflare Workers.

## 1. Background: MergeTree Coordination Challenges

### 1.1 Traditional MergeTree Architecture

In ClickHouse's native MergeTree:

1. **Parts**: Data is stored in immutable parts (directories containing column files)
2. **Merges**: Background threads periodically merge small parts into larger ones
3. **Mutations**: ALTER TABLE operations create new parts with modified data
4. **Concurrency**: Writes create new parts atomically; reads see a consistent snapshot

```
Traditional MergeTree Merge Flow:

  INSERT #1 -----> part_1_1_1
  INSERT #2 -----> part_2_2_2    ---> MERGE ---> part_1_3_3
  INSERT #3 -----> part_3_3_3

  Read sees: either [part_1_1_1, part_2_2_2, part_3_3_3]
             or     [part_1_3_3] (after merge commits)
```

### 1.2 Serverless Challenges

Cloudflare Workers introduces unique challenges:

| Challenge | Description | Impact |
|-----------|-------------|--------|
| Stateless Workers | No persistent process state | Cannot maintain part registry in memory |
| Concurrent Requests | Multiple Workers handling requests | Race conditions on part creation |
| No Background Threads | Workers only run during requests | Cannot run continuous merge process |
| 30s CPU Limit | Requests timeout after 30s | Long merges may fail |
| 128MB Memory | Limited memory per Worker | Cannot load large parts for merge |

### 1.3 Why Durable Objects

Durable Objects solve these challenges:

1. **Single-Threaded Execution**: One request at a time per DO instance
2. **Persistent Storage**: 10GB SQLite-backed storage survives restarts
3. **Global Coordination**: Single DO instance per ID worldwide
4. **Alarms**: Schedule future work (background merge scheduling)
5. **Hibernation**: DOs sleep when idle, wake on request

## 2. DO Architecture Design

### 2.1 Hierarchical Design Options

**Option A: One DO Per Table**
```
TableCoordinator DO (one per table)
├── Part Registry
├── Merge Scheduler
├── Write Lock Manager
└── Partition Metadata
```

**Option B: One DO Per Partition**
```
TableRegistry DO (one per database)
└── PartitionCoordinator DO (one per partition)
    ├── Part Registry
    ├── Merge Scheduler
    └── Write Lock
```

**Option C: Hybrid (Recommended)**
```
TableCoordinator DO (one per table)
├── Global Schema & Config
├── Partition Registry
├── Merge Policy
└── references to...
    └── PartitionWorker DO (one per partition)
        ├── Part List
        ├── Active Writers
        └── Merge State
```

### 2.2 Recommended Architecture: Hybrid Model

The hybrid model provides:
- **Table-level coordination**: Schema, config, global merge policy
- **Partition-level parallelism**: Independent partitions don't block each other
- **Scalability**: Hot partitions can handle high write throughput
- **Consistency**: Partition-level atomicity for writes

```
                     +-----------------------+
                     |    Worker Request     |
                     +-----------+-----------+
                                 |
                     +-----------v-----------+
                     |  TableCoordinator DO  |
                     |   (per database.table)|
                     +---+---------------+---+
                         |               |
           +-------------+               +-------------+
           |                                           |
+----------v----------+                   +-----------v---------+
|  PartitionWorker DO |                   |  PartitionWorker DO |
|   (partition: 2024) |                   |   (partition: 2025) |
+---------------------+                   +---------------------+
           |                                           |
    +------+------+                             +------+------+
    |             |                             |             |
 +--v--+       +--v--+                       +--v--+       +--v--+
 |Part1|       |Part2|                       |Part1|       |Part2|
 | R2  |       | R2  |                       | R2  |       | R2  |
 +-----+       +-----+                       +-----+       +-----+
```

## 3. Data Structures

### 3.1 TableCoordinator State

```typescript
interface TableCoordinatorState {
  // Table identity
  database: string;
  tableName: string;

  // Schema (immutable after creation, mutations create new version)
  schema: TableSchema;
  schemaVersion: number;

  // Engine configuration
  engine: {
    type: 'MergeTree' | 'ReplacingMergeTree' | 'SummingMergeTree';
    orderBy: string[];
    partitionBy?: string;
    primaryKey?: string[];
    settings: MergeTreeSettings;
  };

  // Partition registry (DO IDs for partition workers)
  partitions: Map<string, {
    doId: string;            // Durable Object ID
    createdAt: number;
    partCount: number;       // Cached part count
    totalBytes: number;      // Cached size estimate
    lastMerge: number;       // Timestamp of last merge
  }>;

  // Global merge policy
  mergePolicy: {
    minPartsToMerge: number;        // Default: 3
    maxPartsToMerge: number;        // Default: 100
    minMergeBytes: number;          // Minimum bytes to merge
    maxMergeBytes: number;          // Maximum bytes per merge
    mergeMaxAge: number;            // Force merge after N seconds
    backgroundMergeEnabled: boolean;
  };

  // Timestamps
  createdAt: number;
  updatedAt: number;
}

interface TableSchema {
  columns: Array<{
    name: string;
    type: ClickHouseType;
    nullable: boolean;
    default?: DefaultExpression;
    codec?: CompressionCodec;
  }>;
}
```

### 3.2 PartitionWorker State

```typescript
interface PartitionWorkerState {
  // Identity
  database: string;
  tableName: string;
  partitionId: string;       // e.g., "202401" or "0" for unpartitioned
  partitionExpression: string;

  // Part registry (the core state)
  parts: Map<string, PartInfo>;

  // Active parts (not superseded by merge)
  activeParts: Set<string>;  // Set of part names currently queryable

  // Write coordination
  activeWriters: Map<string, WriterInfo>;
  nextBlockNumber: number;   // Monotonically increasing

  // Merge state
  mergeState: {
    status: 'idle' | 'selecting' | 'merging' | 'finalizing';
    currentMerge?: {
      mergeId: string;
      sourceParts: string[];
      targetPart: string;
      startedAt: number;
      progress: number;       // 0-100
    };
    lastMergeAt: number;
    mergeCount: number;
  };

  // Statistics
  stats: {
    totalRows: bigint;
    totalBytes: number;
    partCount: number;
    oldestPartAge: number;
  };
}

interface PartInfo {
  // Part identification (ClickHouse naming: minBlock_maxBlock_level)
  name: string;              // e.g., "1_1_0", "1_3_1" (after merge)
  minBlock: number;
  maxBlock: number;
  level: number;             // Merge level (0 = original insert)

  // Data location
  r2Key: string;             // R2 object key prefix
  columnFiles: string[];     // Column file names

  // Metadata
  rows: bigint;
  bytes: number;
  minValues: Record<string, unknown>;  // Min value per column
  maxValues: Record<string, unknown>;  // Max value per column

  // State
  state: 'writing' | 'committed' | 'merging' | 'obsolete' | 'deleted';
  createdAt: number;
  supersededBy?: string;     // Part name that replaced this
}

interface WriterInfo {
  writerId: string;
  startedAt: number;
  blockNumber: number;
  state: 'active' | 'committing' | 'rolledBack';
}
```

## 4. Core Operations API

### 4.1 TableCoordinator Methods

```typescript
class TableCoordinator extends DurableObject {
  // ─────────────────────────────────────────────────────────────────
  // Schema Operations
  // ─────────────────────────────────────────────────────────────────

  /**
   * Initialize table with schema and engine settings
   */
  async createTable(schema: TableSchema, engine: EngineConfig): Promise<void> {
    await this.state.blockConcurrencyWhile(async () => {
      if (this.tableExists) {
        throw new Error(`Table ${this.database}.${this.tableName} already exists`);
      }

      this.schema = schema;
      this.engine = engine;
      this.partitions = new Map();
      this.createdAt = Date.now();

      await this.persist();
    });
  }

  /**
   * Get or create partition worker DO for a partition key
   */
  async getPartitionWorker(partitionKey: string): Promise<DurableObjectStub> {
    let partition = this.partitions.get(partitionKey);

    if (!partition) {
      // Create new partition worker
      const doId = this.env.PARTITION_WORKER.newUniqueId();
      partition = {
        doId: doId.toString(),
        createdAt: Date.now(),
        partCount: 0,
        totalBytes: 0,
        lastMerge: 0,
      };
      this.partitions.set(partitionKey, partition);
      await this.persist();

      // Initialize the partition worker
      const stub = this.env.PARTITION_WORKER.get(doId);
      await stub.initialize({
        database: this.database,
        tableName: this.tableName,
        partitionId: partitionKey,
        schema: this.schema,
        engine: this.engine,
      });
    }

    return this.env.PARTITION_WORKER.get(
      this.env.PARTITION_WORKER.idFromString(partition.doId)
    );
  }

  /**
   * Get all active parts across all partitions (for query planning)
   */
  async getAllActiveParts(): Promise<PartInfo[]> {
    const allParts: PartInfo[] = [];

    // Fan out to all partition workers
    const stubs = [...this.partitions.values()].map(p =>
      this.env.PARTITION_WORKER.get(
        this.env.PARTITION_WORKER.idFromString(p.doId)
      )
    );

    const results = await Promise.all(
      stubs.map(stub => stub.getActiveParts())
    );

    for (const parts of results) {
      allParts.push(...parts);
    }

    return allParts;
  }

  /**
   * Trigger merge evaluation across all partitions
   */
  async evaluateMerges(): Promise<MergeCandidate[]> {
    const candidates: MergeCandidate[] = [];

    for (const [partitionKey, partition] of this.partitions) {
      const stub = this.env.PARTITION_WORKER.get(
        this.env.PARTITION_WORKER.idFromString(partition.doId)
      );

      const candidate = await stub.getMergeCandidate(this.mergePolicy);
      if (candidate) {
        candidates.push({
          partitionKey,
          ...candidate,
        });
      }
    }

    return candidates;
  }
}
```

### 4.2 PartitionWorker Methods

```typescript
class PartitionWorker extends DurableObject {
  // ─────────────────────────────────────────────────────────────────
  // Part Registration
  // ─────────────────────────────────────────────────────────────────

  /**
   * Register a new part after INSERT completes
   * Returns the assigned part name
   */
  async registerPart(partInfo: Omit<PartInfo, 'name' | 'minBlock' | 'maxBlock' | 'level'>): Promise<string> {
    return await this.state.blockConcurrencyWhile(async () => {
      // Assign block number (monotonically increasing)
      const blockNumber = this.nextBlockNumber++;

      // Create part name: minBlock_maxBlock_level
      // For fresh inserts: blockNumber_blockNumber_0
      const partName = `${blockNumber}_${blockNumber}_0`;

      const part: PartInfo = {
        ...partInfo,
        name: partName,
        minBlock: blockNumber,
        maxBlock: blockNumber,
        level: 0,
        state: 'committed',
        createdAt: Date.now(),
      };

      this.parts.set(partName, part);
      this.activeParts.add(partName);
      this.updateStats();

      await this.persist();

      // Check if merge should be triggered
      await this.maybeScheduleMerge();

      return partName;
    });
  }

  /**
   * Get list of currently active (queryable) parts
   */
  async getActiveParts(): Promise<PartInfo[]> {
    return [...this.activeParts].map(name => this.parts.get(name)!);
  }

  // ─────────────────────────────────────────────────────────────────
  // Write Lock Coordination
  // ─────────────────────────────────────────────────────────────────

  /**
   * Acquire write lock for INSERT operation
   * Returns a writer ID that must be used to commit or rollback
   */
  async lockForWrite(partitionKey: string): Promise<WriteHandle> {
    return await this.state.blockConcurrencyWhile(async () => {
      const writerId = crypto.randomUUID();
      const blockNumber = this.nextBlockNumber;

      // Don't increment nextBlockNumber until commit
      // This allows rollback without gaps

      const writer: WriterInfo = {
        writerId,
        startedAt: Date.now(),
        blockNumber,
        state: 'active',
      };

      this.activeWriters.set(writerId, writer);
      await this.persist();

      return {
        writerId,
        partitionKey,
        blockNumber,
        r2KeyPrefix: this.buildR2KeyPrefix(blockNumber),
      };
    });
  }

  /**
   * Commit write - makes part visible to queries
   */
  async commitWrite(writerId: string, partInfo: PartWriteInfo): Promise<string> {
    return await this.state.blockConcurrencyWhile(async () => {
      const writer = this.activeWriters.get(writerId);
      if (!writer) {
        throw new Error(`Unknown writer: ${writerId}`);
      }
      if (writer.state !== 'active') {
        throw new Error(`Writer ${writerId} is ${writer.state}`);
      }

      // Advance block number on successful commit
      this.nextBlockNumber++;

      // Register the part
      const partName = await this.registerPart({
        r2Key: partInfo.r2Key,
        columnFiles: partInfo.columnFiles,
        rows: partInfo.rows,
        bytes: partInfo.bytes,
        minValues: partInfo.minValues,
        maxValues: partInfo.maxValues,
        state: 'committed',
      });

      // Clean up writer
      this.activeWriters.delete(writerId);
      await this.persist();

      return partName;
    });
  }

  /**
   * Rollback write - releases lock without creating part
   */
  async rollbackWrite(writerId: string): Promise<void> {
    await this.state.blockConcurrencyWhile(async () => {
      const writer = this.activeWriters.get(writerId);
      if (writer) {
        writer.state = 'rolledBack';
        this.activeWriters.delete(writerId);
        await this.persist();
      }
    });
  }

  // ─────────────────────────────────────────────────────────────────
  // Merge Operations
  // ─────────────────────────────────────────────────────────────────

  /**
   * Get candidate parts for merge based on policy
   */
  async getMergeCandidate(policy: MergePolicy): Promise<MergeCandidate | null> {
    // Don't suggest merge if one is in progress
    if (this.mergeState.status !== 'idle') {
      return null;
    }

    const activeParts = this.getActiveParts();

    // Not enough parts to merge
    if (activeParts.length < policy.minPartsToMerge) {
      return null;
    }

    // Sort by minBlock (oldest first)
    const sortedParts = [...activeParts].sort((a, b) => a.minBlock - b.minBlock);

    // Find contiguous range at same level (prefer merging same-level parts)
    let bestCandidate: MergeCandidate | null = null;

    for (let i = 0; i <= sortedParts.length - policy.minPartsToMerge; i++) {
      const candidateParts: PartInfo[] = [sortedParts[i]];
      let totalBytes = sortedParts[i].bytes;

      for (let j = i + 1; j < sortedParts.length; j++) {
        const part = sortedParts[j];

        // Check if adding this part exceeds limits
        if (candidateParts.length >= policy.maxPartsToMerge) break;
        if (totalBytes + part.bytes > policy.maxMergeBytes) break;

        candidateParts.push(part);
        totalBytes += part.bytes;

        // We have enough parts
        if (candidateParts.length >= policy.minPartsToMerge) {
          const candidate: MergeCandidate = {
            sourceParts: candidateParts.map(p => p.name),
            estimatedBytes: totalBytes,
            estimatedRows: candidateParts.reduce((sum, p) => sum + p.rows, 0n),
            priority: this.calculateMergePriority(candidateParts, policy),
          };

          if (!bestCandidate || candidate.priority > bestCandidate.priority) {
            bestCandidate = candidate;
          }
        }
      }
    }

    return bestCandidate;
  }

  /**
   * Begin merge operation - locks source parts
   */
  async beginMerge(sourceParts: string[]): Promise<MergeHandle> {
    return await this.state.blockConcurrencyWhile(async () => {
      if (this.mergeState.status !== 'idle') {
        throw new Error(`Merge already in progress: ${this.mergeState.currentMerge?.mergeId}`);
      }

      // Verify all source parts are active
      for (const partName of sourceParts) {
        if (!this.activeParts.has(partName)) {
          throw new Error(`Part ${partName} is not active`);
        }
      }

      const mergeId = crypto.randomUUID();

      // Calculate target part name
      const parts = sourceParts.map(name => this.parts.get(name)!);
      const minBlock = Math.min(...parts.map(p => p.minBlock));
      const maxBlock = Math.max(...parts.map(p => p.maxBlock));
      const maxLevel = Math.max(...parts.map(p => p.level));
      const targetPartName = `${minBlock}_${maxBlock}_${maxLevel + 1}`;

      // Mark source parts as merging
      for (const partName of sourceParts) {
        const part = this.parts.get(partName)!;
        part.state = 'merging';
      }

      this.mergeState = {
        status: 'merging',
        currentMerge: {
          mergeId,
          sourceParts,
          targetPart: targetPartName,
          startedAt: Date.now(),
          progress: 0,
        },
        lastMergeAt: this.mergeState.lastMergeAt,
        mergeCount: this.mergeState.mergeCount,
      };

      await this.persist();

      return {
        mergeId,
        sourceParts: parts,
        targetPartName,
        r2KeyPrefix: this.buildR2KeyPrefix(targetPartName),
      };
    });
  }

  /**
   * Commit merge - activates new part, deactivates source parts
   */
  async commitMerge(mergeId: string, targetPartInfo: PartWriteInfo): Promise<void> {
    await this.state.blockConcurrencyWhile(async () => {
      const merge = this.mergeState.currentMerge;
      if (!merge || merge.mergeId !== mergeId) {
        throw new Error(`Unknown merge: ${mergeId}`);
      }

      // Create the merged part
      const sourceParts = merge.sourceParts.map(name => this.parts.get(name)!);
      const minBlock = Math.min(...sourceParts.map(p => p.minBlock));
      const maxBlock = Math.max(...sourceParts.map(p => p.maxBlock));
      const maxLevel = Math.max(...sourceParts.map(p => p.level));

      const mergedPart: PartInfo = {
        name: merge.targetPart,
        minBlock,
        maxBlock,
        level: maxLevel + 1,
        r2Key: targetPartInfo.r2Key,
        columnFiles: targetPartInfo.columnFiles,
        rows: targetPartInfo.rows,
        bytes: targetPartInfo.bytes,
        minValues: targetPartInfo.minValues,
        maxValues: targetPartInfo.maxValues,
        state: 'committed',
        createdAt: Date.now(),
      };

      // Atomically:
      // 1. Add merged part to registry
      // 2. Mark source parts as obsolete
      // 3. Update active parts set

      this.parts.set(mergedPart.name, mergedPart);
      this.activeParts.add(mergedPart.name);

      for (const partName of merge.sourceParts) {
        const part = this.parts.get(partName)!;
        part.state = 'obsolete';
        part.supersededBy = mergedPart.name;
        this.activeParts.delete(partName);
      }

      this.mergeState = {
        status: 'idle',
        currentMerge: undefined,
        lastMergeAt: Date.now(),
        mergeCount: this.mergeState.mergeCount + 1,
      };

      this.updateStats();
      await this.persist();

      // Schedule cleanup of obsolete parts
      await this.schedulePartCleanup(merge.sourceParts);
    });
  }

  /**
   * Rollback merge - restores source parts to committed state
   */
  async rollbackMerge(mergeId: string): Promise<void> {
    await this.state.blockConcurrencyWhile(async () => {
      const merge = this.mergeState.currentMerge;
      if (!merge || merge.mergeId !== mergeId) {
        return; // Already rolled back or unknown
      }

      // Restore source parts
      for (const partName of merge.sourceParts) {
        const part = this.parts.get(partName);
        if (part && part.state === 'merging') {
          part.state = 'committed';
        }
      }

      this.mergeState = {
        status: 'idle',
        currentMerge: undefined,
        lastMergeAt: this.mergeState.lastMergeAt,
        mergeCount: this.mergeState.mergeCount,
      };

      await this.persist();
    });
  }

  // ─────────────────────────────────────────────────────────────────
  // Background Operations (using Alarms)
  // ─────────────────────────────────────────────────────────────────

  /**
   * Durable Object alarm handler - runs scheduled tasks
   */
  async alarm(): Promise<void> {
    // Check for stale writers (timeout after 5 minutes)
    await this.cleanupStaleWriters();

    // Try to trigger a merge if conditions are met
    await this.maybeScheduleMerge();

    // Clean up obsolete parts from R2
    await this.cleanupObsoleteParts();
  }

  private async maybeScheduleMerge(): Promise<void> {
    if (this.mergeState.status !== 'idle') return;
    if (this.activeParts.size < 3) return;

    // Schedule alarm to check merge conditions in 1 minute
    const alarm = await this.state.storage.getAlarm();
    if (!alarm) {
      await this.state.storage.setAlarm(Date.now() + 60_000);
    }
  }
}
```

## 5. Consistency Guarantees

### 5.1 Write Atomicity

Writes achieve atomicity through the following protocol:

```
INSERT Flow:

1. Worker receives INSERT request
   |
2. Worker calls PartitionWorker.lockForWrite(partitionKey)
   |---- DO assigns block number, creates writer record
   |---- Returns: { writerId, blockNumber, r2KeyPrefix }
   |
3. Worker writes data to R2 at r2KeyPrefix
   |---- Writes column files (*.bin, *.mrk, *.idx)
   |---- This may take several seconds for large inserts
   |
4a. On success: Worker calls PartitionWorker.commitWrite(writerId, partInfo)
    |---- DO atomically:
    |     - Creates PartInfo record
    |     - Adds to activeParts
    |     - Increments nextBlockNumber
    |     - Removes writer record
    |
4b. On failure: Worker calls PartitionWorker.rollbackWrite(writerId)
    |---- DO removes writer record
    |---- Block number is NOT consumed (no gaps)
```

### 5.2 Read Consistency

Reads always see a consistent snapshot:

```typescript
async function executeQuery(sql: string, env: Env): Promise<QueryResult> {
  // 1. Get table coordinator
  const tableCoord = getTableCoordinator(env, database, tableName);

  // 2. Get all active parts (atomic read from each partition DO)
  const activeParts = await tableCoord.getAllActiveParts();

  // 3. Parts list is now immutable for this query
  //    Even if merges happen, we have our snapshot

  // 4. Query data from R2 using the part list
  return queryPartsFromR2(activeParts, sql);
}
```

The key insight: **DO returns a snapshot of activeParts**. Even if a merge completes during query execution:
- The merged part won't appear (not in our snapshot)
- Source parts won't disappear from R2 until cleanup (scheduled after grace period)

### 5.3 Merge Atomicity

Merges are atomic through the following invariants:

1. **Source parts remain queryable** until commit
2. **Merged part not visible** until commit
3. **Commit is atomic** - single DO transaction switches visibility
4. **Cleanup is delayed** - source parts stay in R2 for grace period

```
Merge Flow Timeline:

t0: beginMerge() called
    - Source parts marked 'merging' but still in activeParts
    - Queries can still use them

t1-t99: Merge executes in Worker
    - Read source parts from R2
    - Write merged part to R2
    - Source parts still queryable

t100: commitMerge() called
    - Atomic in DO:
      - Add merged part to activeParts
      - Remove source parts from activeParts
      - Mark source parts 'obsolete'
    - From this moment, queries see merged part

t100-t200: Grace period
    - Source parts still in R2 (for in-flight queries)

t200: Cleanup alarm fires
    - Delete source parts from R2
    - Mark source parts 'deleted'
```

### 5.4 Failure Handling

| Failure Point | Recovery Action |
|---------------|-----------------|
| Worker crash during INSERT | Writer timeout (5 min) triggers rollback |
| R2 write failure | Worker calls rollbackWrite, retries |
| Merge Worker crash | Merge timeout (30 min) triggers rollback |
| DO restart during merge | Alarm reschedules, state persisted |
| R2 unavailable | Retry with exponential backoff |

## 6. Performance Considerations

### 6.1 Latency Analysis

| Operation | Typical Latency | Notes |
|-----------|-----------------|-------|
| lockForWrite | 1-5ms | DO in-region, single storage op |
| commitWrite | 2-10ms | DO transaction + storage |
| getActiveParts | 1-5ms | Read-only, cached in DO memory |
| beginMerge | 5-15ms | Multiple storage ops |
| commitMerge | 5-20ms | Transaction with cleanup scheduling |

### 6.2 Throughput Optimization

**Write Throughput per Partition:**
- DO processes ~1,000 requests/second
- With batching (multiple INSERTs per part), can achieve higher effective throughput

**Read Throughput:**
- activeParts can be cached in DO memory
- Multiple Workers can read simultaneously (read-only)
- Fan-out to partition DOs is parallelized

**Merge Throughput:**
- One merge per partition at a time
- Merge is CPU-intensive in Worker, not DO
- DO just coordinates; actual merge happens in Worker

### 6.3 Scaling Recommendations

```
Expected Workload          | Recommended Partitioning
---------------------------|-------------------------
< 100 writes/sec           | Single partition (unpartitioned)
100-1000 writes/sec        | Partition by day
1000-10000 writes/sec      | Partition by hour
> 10000 writes/sec         | Partition by hour + sharding
```

## 7. wrangler.toml Configuration

```toml
# MergeTree coordination Durable Objects

# Table-level coordinator - one per database.table
[[durable_objects.bindings]]
name = "TABLE_COORDINATOR"
class_name = "TableCoordinator"

# Partition-level worker - one per table.partition
[[durable_objects.bindings]]
name = "PARTITION_WORKER"
class_name = "PartitionWorker"

# Migrations
[[migrations]]
tag = "v1"
new_classes = ["TableCoordinator", "PartitionWorker"]
```

## 8. Implementation Phases

### Phase 1: Basic Part Registration (Week 1)
- PartitionWorker with registerPart, getActiveParts
- Single-partition tables
- Unit tests

### Phase 2: Write Coordination (Week 2)
- lockForWrite, commitWrite, rollbackWrite
- Writer timeout handling
- Integration with R2 writes

### Phase 3: Merge Scheduling (Week 3)
- getMergeCandidate with policies
- beginMerge, commitMerge, rollbackMerge
- Alarm-based background scheduling

### Phase 4: Multi-Partition (Week 4)
- TableCoordinator with partition routing
- Fan-out for getAllActiveParts
- Cross-partition query planning

### Phase 5: Cleanup & Optimization (Week 5)
- Obsolete part cleanup
- Memory caching for hot paths
- Performance benchmarking

## 9. Trade-offs and Alternatives

### 9.1 Alternative: Single DO Per Table

**Pros:**
- Simpler implementation
- No cross-DO coordination needed
- Single source of truth

**Cons:**
- All writes to table serialize through one DO
- ~1000 req/s limit per table
- Large state (all partitions) in one DO

**Recommendation:** Use for tables with <100 writes/sec

### 9.2 Alternative: DO Per Part

**Pros:**
- Maximum parallelism
- Fine-grained locking

**Cons:**
- Coordination explosion (merge needs N DOs)
- Complex cleanup
- High DO count

**Recommendation:** Not recommended - too complex

### 9.3 Alternative: External Coordination (Redis, etc.)

**Pros:**
- Battle-tested solutions exist
- Higher throughput possible

**Cons:**
- Additional infrastructure
- Latency to external service
- Not available in all CF locations
- Cost

**Recommendation:** Consider if throughput exceeds DO limits

## 10. Conclusion

The hybrid TableCoordinator + PartitionWorker architecture provides:

1. **Correct MergeTree semantics**: Atomic writes, consistent reads, proper merges
2. **Scalability**: Partition-level parallelism, with limits of ~1000 writes/sec/partition
3. **Durability**: All state persisted in DO storage, survives restarts
4. **Simplicity**: Leverages DO's single-threaded model for safe concurrent operations

Key implementation insights:

- **DOs are coordinators, not data processors**: Actual merge work happens in Workers
- **Alarms enable background work**: Schedule cleanup and merge evaluation
- **Snapshot reads**: Return part list and let queries proceed independently
- **Grace periods**: Allow in-flight queries to complete before cleanup

This design enables true MergeTree functionality on Cloudflare's serverless platform while respecting platform constraints.
