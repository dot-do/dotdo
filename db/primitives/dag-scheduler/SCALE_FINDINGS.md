# DAG Scheduler Scale Investigation (1000+ Tasks)

**Issue:** dotdo-d5fq7
**Date:** 2026-01-13
**Status:** SPIKE COMPLETE

## Executive Summary

Investigation of DAGScheduler performance at scale (1000+ tasks) reveals:

- **SQLite Performance:** Excellent - O(1) lookups, handles 10K+ tasks easily
- **Memory Footprint:** ~2-5 KB per task in-memory, manageable for 1000+ tasks
- **Algorithm Complexity:** Current implementation has O(n*m) hotspots that need optimization
- **Storage Limits:** 10 GB SQLite DO storage sufficient, 2 MB per row limit respected
- **Recommendation:** Implement indexed adjacency lists for O(1) dependency lookups

## Current Architecture Analysis

### Data Structures

| Component | Type | Memory per Task |
|-----------|------|-----------------|
| Task Map | `Map<string, TaskNode>` | ~500 bytes |
| Task Results | `Map<string, TaskResult>` | ~300 bytes |
| Dependencies | `string[]` per task | ~200 bytes avg |
| Completed Set | `Set<string>` | ~50 bytes |
| **Total** | | ~1-2 KB per task |

### Algorithm Complexity Analysis

#### `getExecutionOrder()` - Kahn's Algorithm (Topological Sort)

```typescript
// Current: O(n) + O(n*m) where n=tasks, m=avg dependencies
for (const [depId, task] of dag.tasks) {         // O(n)
  if (task.dependencies.includes(id)) {          // O(m) linear scan
    // ...
  }
}
```

**At 1000 tasks:** ~1M operations (acceptable)
**At 10000 tasks:** ~100M operations (slow)

**Optimization:** Pre-build adjacency list for O(1) dependent lookups:
```typescript
// Build once: O(n*m)
const dependentMap = new Map<string, Set<string>>()
for (const [id, task] of dag.tasks) {
  for (const dep of task.dependencies) {
    if (!dependentMap.has(dep)) dependentMap.set(dep, new Set())
    dependentMap.get(dep)!.add(id)
  }
}
// Query: O(1)
const dependents = dependentMap.get(taskId) || new Set()
```

#### `getReadyTasks()` - Critical Path

```typescript
// Current: O(n*m) every scheduling cycle
for (const [id, task] of dag.tasks) {            // O(n)
  const allDepsComplete = task.dependencies.every(
    (dep) => completed.has(dep)                   // O(m)
  )
}
```

**Impact:** Called repeatedly during execution
**At 1000 tasks with 10 avg deps:** 10K operations per cycle

**Optimization:** Track pending dependency counts:
```typescript
// Initialize: inDegree[taskId] = dependencies.length
// On task complete: decrement dependents' counts
// Ready tasks: all tasks where inDegree == 0
const readyQueue: TaskNode[] = []
for (const dependentId of dependentMap.get(completedTaskId) || []) {
  inDegree.set(dependentId, inDegree.get(dependentId)! - 1)
  if (inDegree.get(dependentId) === 0) {
    readyQueue.push(dag.tasks.get(dependentId)!)
  }
}
```

#### `getDependents()` with Transitive Option

```typescript
// Current: O(n*m) for each BFS iteration
for (const [_, task] of dag.tasks) {             // O(n)
  if (task.dependencies.includes(id)) { ... }    // O(m)
}
```

**Optimization:** Pre-computed adjacency list reduces to O(k) where k=direct dependents

### Memory Footprint at Scale

| Task Count | In-Memory Size | SQLite Size (with results) |
|------------|---------------|---------------------------|
| 100 | ~200 KB | ~500 KB |
| 1,000 | ~2 MB | ~5 MB |
| 10,000 | ~20 MB | ~50 MB |
| 100,000 | ~200 MB | ~500 MB |

**Cloudflare DO Limits:**
- SQLite storage: 10 GB total (sufficient)
- Max row size: 2 MB (task results should be small)
- Memory: ~128 MB heap available (fits 10K+ tasks)

## SQLite Performance Characteristics

### Current Storage Pattern (schedule-manager.ts)

```typescript
// KV-style storage (acceptable for < 1000 DAGs)
await storage.put(scheduleKey(dag.id), schedule)
await storage.get(scheduleKey(dagId))
await storage.list({ prefix: SCHEDULE_PREFIX })
```

### Recommended SQL Schema for Scale

```sql
-- Tasks table with indices
CREATE TABLE dag_tasks (
  dag_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  dependencies TEXT, -- JSON array of task IDs
  result TEXT,       -- JSON serialized result
  attempts INTEGER DEFAULT 0,
  started_at INTEGER,
  completed_at INTEGER,
  PRIMARY KEY (dag_id, task_id)
);

CREATE INDEX idx_dag_status ON dag_tasks(dag_id, status);
CREATE INDEX idx_dag_pending ON dag_tasks(dag_id) WHERE status = 'pending';

-- Dependency edges for O(1) lookups
CREATE TABLE dag_edges (
  dag_id TEXT NOT NULL,
  from_task TEXT NOT NULL,
  to_task TEXT NOT NULL,
  PRIMARY KEY (dag_id, from_task, to_task)
);

CREATE INDEX idx_edges_to ON dag_edges(dag_id, to_task);
```

### Query Performance Estimates

| Operation | KV-style | SQL with Index |
|-----------|----------|----------------|
| Get task by ID | O(1) | O(1) |
| List ready tasks | O(n) scan | O(log n) index |
| Get dependents | O(n*m) | O(k) via edge index |
| Update task status | O(1) | O(1) |
| Batch status update | O(k) | O(1) transaction |

## Pagination Strategies

### For Large DAG Listing

```typescript
interface PaginatedDAGQuery {
  dagId: string
  status?: TaskStatus
  limit: number
  cursor?: string // Last task ID seen
}

// SQL query with cursor pagination
SELECT * FROM dag_tasks
WHERE dag_id = ?
  AND (? IS NULL OR task_id > ?)
  AND (? IS NULL OR status = ?)
ORDER BY task_id
LIMIT ?
```

### For Task Results

```typescript
interface TaskResultPage {
  tasks: TaskResult[]
  nextCursor?: string
  totalCount: number
  hasMore: boolean
}

async function getTaskResults(
  dagId: string,
  options: { limit: number; cursor?: string }
): Promise<TaskResultPage> {
  // Paginated query implementation
}
```

## Archival Strategies

### 1. Time-Based Partitioning

```typescript
// Partition completed runs by execution date
const PARTITION_INTERVAL = 24 * 60 * 60 * 1000 // 1 day

function getPartitionKey(executionDate: Date): string {
  return `run:${executionDate.toISOString().split('T')[0]}`
}

// Archive old partitions to R2
async function archivePartition(partitionKey: string): Promise<void> {
  const runs = await storage.list({ prefix: partitionKey })
  await r2.put(`archives/${partitionKey}.json.gz`, gzip(serialize(runs)))
  await storage.delete([...runs.keys()])
}
```

### 2. Status-Based Archival

```typescript
// Archive completed runs older than retention period
const RETENTION_DAYS = 30

async function archiveCompletedRuns(): Promise<number> {
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000

  const completed = await sql.exec(`
    SELECT run_id, data FROM dag_runs
    WHERE status IN ('completed', 'failed', 'cancelled')
      AND completed_at < ?
    LIMIT 1000
  `, [cutoff])

  // Batch archive to R2
  for (const run of completed) {
    await r2.put(`archives/runs/${run.run_id}.json.gz`, gzip(run.data))
  }

  // Delete from SQLite
  await sql.exec(`
    DELETE FROM dag_runs WHERE run_id IN (?)
  `, [completed.map(r => r.run_id)])

  return completed.length
}
```

### 3. Summarization for Metrics

```typescript
interface DAGRunSummary {
  dagId: string
  runId: string
  status: DAGRunStatus
  totalTasks: number
  successTasks: number
  failedTasks: number
  skippedTasks: number
  startedAt: Date
  completedAt?: Date
  durationMs?: number
}

// Keep summaries, archive full task results
async function summarizeAndArchive(run: DAGRun): Promise<DAGRunSummary> {
  const summary: DAGRunSummary = {
    dagId: run.dagId,
    runId: run.runId,
    status: run.status,
    totalTasks: run.taskResults.size,
    successTasks: [...run.taskResults.values()].filter(r => r.status === 'success').length,
    failedTasks: [...run.taskResults.values()].filter(r => r.status === 'failed').length,
    skippedTasks: [...run.taskResults.values()].filter(r => r.status === 'skipped').length,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    durationMs: run.completedAt ? run.completedAt.getTime() - run.startedAt.getTime() : undefined,
  }

  // Archive full results to R2
  await r2.put(`runs/${run.dagId}/${run.runId}/results.json.gz`, gzip(serialize(run.taskResults)))

  // Store only summary in DO
  await storage.put(`summary:${run.runId}`, summary)

  return summary
}
```

## Partitioning by Execution Date

### Schema Design

```sql
-- Runs partitioned by date
CREATE TABLE dag_runs_YYYYMMDD (
  run_id TEXT PRIMARY KEY,
  dag_id TEXT NOT NULL,
  status TEXT NOT NULL,
  task_results TEXT, -- JSON
  started_at INTEGER NOT NULL,
  completed_at INTEGER
);

-- Current partition view
CREATE VIEW dag_runs_current AS
SELECT * FROM dag_runs_20260113
UNION ALL
SELECT * FROM dag_runs_20260112
UNION ALL
SELECT * FROM dag_runs_20260111;
```

### Partition Management

```typescript
class PartitionedDAGStore {
  private getPartitionTable(date: Date): string {
    return `dag_runs_${date.toISOString().split('T')[0].replace(/-/g, '')}`
  }

  async createPartition(date: Date): Promise<void> {
    const table = this.getPartitionTable(date)
    await this.sql.exec(`
      CREATE TABLE IF NOT EXISTS ${table} (
        run_id TEXT PRIMARY KEY,
        dag_id TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        completed_at INTEGER,
        task_count INTEGER,
        summary TEXT
      )
    `)
    await this.sql.exec(`CREATE INDEX IF NOT EXISTS idx_${table}_dag ON ${table}(dag_id)`)
  }

  async dropOldPartitions(retentionDays: number): Promise<string[]> {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - retentionDays)

    // Get partition tables older than retention
    const tables = await this.sql.exec(`
      SELECT name FROM sqlite_master
      WHERE type='table' AND name LIKE 'dag_runs_%'
    `)

    const dropped: string[] = []
    for (const { name } of tables) {
      const dateStr = name.replace('dag_runs_', '')
      const partitionDate = new Date(
        parseInt(dateStr.slice(0, 4)),
        parseInt(dateStr.slice(4, 6)) - 1,
        parseInt(dateStr.slice(6, 8))
      )

      if (partitionDate < cutoff) {
        // Archive to R2 first
        const data = await this.sql.exec(`SELECT * FROM ${name}`)
        await this.r2.put(`archives/${name}.json.gz`, gzip(JSON.stringify(data)))

        // Drop partition
        await this.sql.exec(`DROP TABLE ${name}`)
        dropped.push(name)
      }
    }

    return dropped
  }
}
```

## Recommended Optimizations

### Priority 1: Adjacency List Pre-computation

```typescript
// Add to DAG creation
interface OptimizedDAG extends DAG {
  dependentMap: Map<string, Set<string>> // taskId -> tasks that depend on it
  dependencyCount: Map<string, number>   // taskId -> number of unmet dependencies
}

function createOptimizedDAG(options: DAGOptions): OptimizedDAG {
  const dag = createDAG(options)

  // Pre-compute adjacency list
  const dependentMap = new Map<string, Set<string>>()
  const dependencyCount = new Map<string, number>()

  for (const [id, task] of dag.tasks) {
    dependencyCount.set(id, task.dependencies.length)
    for (const dep of task.dependencies) {
      if (!dependentMap.has(dep)) dependentMap.set(dep, new Set())
      dependentMap.get(dep)!.add(id)
    }
  }

  return { ...dag, dependentMap, dependencyCount }
}
```

**Impact:** Reduces getReadyTasks from O(n*m) to O(k) per completion

### Priority 2: SQLite State Store

```typescript
// Replace createInMemoryStateStore with SQLite-backed store
function createSQLiteStateStore(sql: SqlStorage): DAGStateStore {
  // Initialize schema
  sql.exec(`
    CREATE TABLE IF NOT EXISTS dag_runs (
      run_id TEXT PRIMARY KEY,
      dag_id TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      completed_at INTEGER
    )
  `)

  sql.exec(`
    CREATE TABLE IF NOT EXISTS task_results (
      run_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      status TEXT NOT NULL,
      output TEXT,
      error TEXT,
      attempts INTEGER DEFAULT 0,
      started_at INTEGER,
      completed_at INTEGER,
      PRIMARY KEY (run_id, task_id)
    )
  `)

  sql.exec(`CREATE INDEX IF NOT EXISTS idx_runs_dag ON dag_runs(dag_id)`)
  sql.exec(`CREATE INDEX IF NOT EXISTS idx_results_status ON task_results(run_id, status)`)

  return {
    async saveRun(runId, state) { /* batch insert */ },
    async loadRun(runId) { /* join query */ },
    async updateTask(runId, taskId, result) { /* upsert */ },
    async listRuns(dagId, options) { /* paginated query */ }
  }
}
```

### Priority 3: Batch Operations

```typescript
// Batch task status updates in a transaction
async function batchUpdateTasks(
  sql: SqlStorage,
  runId: string,
  updates: Array<{ taskId: string; status: TaskStatus; output?: unknown }>
): Promise<void> {
  sql.exec('BEGIN TRANSACTION')
  try {
    for (const { taskId, status, output } of updates) {
      sql.exec(
        `UPDATE task_results SET status = ?, output = ?, completed_at = ? WHERE run_id = ? AND task_id = ?`,
        [status, JSON.stringify(output), Date.now(), runId, taskId]
      )
    }
    sql.exec('COMMIT')
  } catch (e) {
    sql.exec('ROLLBACK')
    throw e
  }
}
```

## Benchmark Targets

| Metric | Target | Current Estimate |
|--------|--------|------------------|
| DAG creation (1000 tasks) | < 50ms | ~100ms |
| Ready tasks lookup | < 1ms | ~10ms (O(n)) |
| Task status update | < 1ms | ~1ms |
| Full DAG execution (1000 tasks, 10 concurrency) | < 10s | ~30s |
| Memory footprint (1000 tasks) | < 5 MB | ~2 MB |

## Test Plan for Verification

```typescript
describe('DAGScheduler at Scale', () => {
  it('should handle 1000 task chain efficiently', async () => {
    const tasks = Array.from({ length: 1000 }, (_, i) =>
      createTaskNode({
        id: `task-${i}`,
        execute: async () => i,
        dependencies: i > 0 ? [`task-${i - 1}`] : [],
      })
    )

    const dag = createDAG({ id: 'scale-test', tasks })
    const start = performance.now()
    const run = await dag.run({ maxConcurrency: 10 })
    const duration = performance.now() - start

    expect(run.status).toBe('completed')
    expect(duration).toBeLessThan(5000) // < 5s for creation + validation
  })

  it('should handle 1000 parallel tasks efficiently', async () => {
    const tasks = [
      createTaskNode({ id: 'root', execute: async () => 'start', dependencies: [] }),
      ...Array.from({ length: 1000 }, (_, i) =>
        createTaskNode({
          id: `parallel-${i}`,
          execute: async () => i,
          dependencies: ['root'],
        })
      ),
      createTaskNode({
        id: 'final',
        execute: async () => 'done',
        dependencies: Array.from({ length: 1000 }, (_, i) => `parallel-${i}`),
      }),
    ]

    const dag = createDAG({ id: 'parallel-scale', tasks })
    const start = performance.now()
    const run = await dag.run({ maxConcurrency: 50 })
    const duration = performance.now() - start

    expect(run.status).toBe('completed')
    expect(duration).toBeLessThan(10000) // < 10s
  })
})
```

## Conclusion

The DAGScheduler can handle 1000+ tasks with optimizations:

1. **Immediate Win:** Pre-compute adjacency lists for O(1) dependent lookups
2. **Short-term:** Implement SQLite-backed state store for persistence
3. **Medium-term:** Add pagination and archival for long-running systems
4. **Long-term:** Partition by execution date for efficient retention management

The current in-memory implementation with O(n*m) algorithms will degrade at ~10K tasks, but the SQLite DO storage limits (10 GB) and typical memory constraints support well beyond 1000 tasks with the recommended optimizations.

## References

- [Cloudflare DO Limits](https://developers.cloudflare.com/durable-objects/platform/limits/)
- `/db/primitives/dag-scheduler/index.ts` - Current implementation
- `/docs/spikes/checkpoint-size-limits.md` - Related storage limits spike
- `/lib/StateStorage.ts` - Type-safe DO storage wrapper
