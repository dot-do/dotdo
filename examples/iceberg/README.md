# Iceberg Data Lake

**Time travel, schema evolution, and petabyte analytics. Zero infrastructure.**

```typescript
import { DO } from 'dotdo'

export class AnalyticsDO extends DO {
  async getYesterdaysCustomers() {
    return this.iceberg.query({
      asOf: new Date(Date.now() - 86400000),
      entityType: 'Customer'
    })
  }
}
```

**Your data lake runs on R2. Query any point in history.**

---

## The Problem

You need historical analytics. Traditional data lakes require Spark clusters ($10k+/month), S3 with complex IAM, Airflow DAGs, schema registries, and teams of data engineers.

You just wanted to answer: "What did our data look like last Tuesday?"

## The Solution

dotdo's L3 storage layer is Iceberg-compatible. Data flows automatically from hot (memory) to warm (SQLite) to cold (R2/Iceberg). Time travel and schema evolution come free.

---

## Storage Tiers

```
L0: InMemory   O(1) reads, dirty tracking
L1: Pipeline   WAL, immediate ACK
L2: SQLite     Lazy checkpoint
L3: Iceberg    Cold storage, time travel
```

Data flows automatically. Configure archival:

```typescript
this.storage.configure({
  l3: {
    bucket: env.DATA_LAKE,
    archiveAfterDays: 30,
    partitionBy: 'date'
  }
})
```

---

## Time Travel

Query your data at any point in history:

```typescript
// Yesterday's state
const yesterday = await this.iceberg.query({
  asOf: new Date('2024-01-14'),
  entityType: 'Customer'
})

// Specific snapshot
const snapshot = await this.iceberg.query({
  snapshotId: 'snap-42',
  entityType: 'Order'
})

// List snapshots
const snapshots = await this.iceberg.listSnapshots()
// [{ snapshotId: 'snap-45', timestamp: '2024-01-15T00:00:00Z', ... }]

// Rollback (creates new snapshot, preserves history)
await this.iceberg.rollbackTo('snap-42')
```

---

## Schema Evolution

Add fields without migrations:

```typescript
// Original
await this.things.create({ $type: 'Customer', name: 'Alice', email: 'alice@example.com' })

// Later: add phone (no migration)
await this.things.create({ $type: 'Customer', name: 'Bob', email: 'bob@example.com', phone: '+1-555-0123' })

// Query spans both schemas
const customers = await this.iceberg.query({ entityType: 'Customer' })
// [{ name: 'Alice', phone: null }, { name: 'Bob', phone: '+1-555-0123' }]
```

Schema versions are tracked automatically:

```typescript
const schema = await this.iceberg.getSchema()
// { version: 2, fields: [...] }
```

---

## Partitioning

Data is partitioned by namespace and date:

```
data-lake/events/
  ns=tenant-a/
    date=2024-01-15/data-abc123.parquet
    date=2024-01-14/data-def456.parquet
  ns=tenant-b/...
```

Query specific partitions:

```typescript
const janEvents = await this.iceberg.query({
  entityType: 'Order',
  partition: { dateStart: '2024-01-01', dateEnd: '2024-01-31' }
})
```

---

## Analytics Integration

Query Parquet with DuckDB:

```typescript
import { DuckDB } from 'dotdo'

const results = await db.query(`
  SELECT DATE_TRUNC('month', ts) as month, COUNT(*) as events
  FROM parquet_scan('r2://data-lake/events/ns=${tenant}/date=*/*.parquet')
  GROUP BY 1
`)
```

R2 is S3-compatible for external tools:

```bash
aws s3 ls s3://data-lake/events/ --endpoint-url https://account.r2.cloudflarestorage.com
```

---

## Quick Start

```bash
npm install && npm run dev
```

```toml
# wrangler.toml
[[r2_buckets]]
binding = "DATA_LAKE"
bucket_name = "your-data-lake"
```

---

## Cost Comparison

| Traditional | dotdo L3 |
|-------------|----------|
| Spark: $10k+/mo | $0 (serverless) |
| S3: variable | R2: $0.015/GB/mo |
| Egress: $0.09/GB | R2: $0 |

---

Built with [dotdo](https://dotdo.dev)
