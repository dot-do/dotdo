# Spike: Catalog and Metadata Management for Document DB on Workers

## Executive Summary

This spike investigates how ClickHouse manages catalog and metadata for tables, and designs a metadata management system for a document database running on Cloudflare Workers with WASM. The key insight is that while ClickHouse stores metadata as SQL text files on disk with system tables providing runtime access, our serverless architecture requires a distributed metadata store using **Durable Objects for consistency** and **KV for caching**, with **R2 for backup/recovery**.

**Conclusion**: A hybrid metadata architecture using Durable Objects as the source of truth, KV for edge-cached reads, and R2 for durability provides the optimal balance of consistency, performance, and cost for a multi-tenant document database on Workers.

## 1. ClickHouse Metadata Architecture

### 1.1 How ClickHouse Stores Metadata

ClickHouse's metadata storage is file-based with several layers:

**File System Layer:**
- Table DDL stored as SQL text files in `metadata/$DB_UUID/`
- Each table has a `.sql` file with the complete CREATE TABLE statement
- Dropped tables temporarily stored in `metadata_dropped/`
- Part metadata stored in column files within each part directory

**System Tables (Runtime Access):**
| Table | Purpose |
|-------|---------|
| `system.tables` | Table metadata (engine, row count, bytes, create query) |
| `system.columns` | Column definitions (name, type, default, compression) |
| `system.databases` | Database list and metadata |
| `system.parts` | MergeTree part information |
| `system.mutations` | Active mutations |
| `system.replicas` | Replication state (for Replicated tables) |

**Key Fields in system.tables:**
```sql
SELECT
    database,
    name,
    uuid,
    engine,
    engine_full,
    create_table_query,
    metadata_path,
    metadata_modification_time,
    metadata_version,
    total_rows,
    total_bytes,
    data_paths
FROM system.tables
```

**Key Fields in system.columns:**
```sql
SELECT
    database,
    table,
    name,
    type,
    default_kind,
    default_expression,
    compression_codec,
    position
FROM system.columns
```

### 1.2 ClickHouse Cloud SharedCatalog (2025)

ClickHouse Cloud introduced SharedCatalog for centralized metadata:

- **Purpose**: Cloud-scale DDL operations with high concurrency
- **Benefits**:
  - Lightning-fast service spin-ups (stateless nodes)
  - Stateless compute across native and open formats (Iceberg, Delta)
- **Implementation**: Uses FoundationDB as backing store
- **Metadata Types**: Database DDL, Table DDL, Part metadata, Config, Dictionaries, ACL

This validates our approach of externalizing metadata storage for serverless environments.

### 1.3 INFORMATION_SCHEMA Compatibility

ClickHouse provides INFORMATION_SCHEMA views mapping to system tables:
- `INFORMATION_SCHEMA.tables` -> `system.tables`
- `INFORMATION_SCHEMA.columns` -> `system.columns`
- `INFORMATION_SCHEMA.schemata` -> `system.databases`

This provides SQL standard compatibility for schema discovery.

## 2. Cloudflare Workers Storage Options

### 2.1 Storage Comparison for Metadata

| Feature | Workers KV | Durable Objects | R2 | D1 |
|---------|-----------|-----------------|-----|-----|
| **Consistency** | Eventually consistent | Strongly consistent | Strong (per object) | Strong |
| **Latency** | < 10ms (hot keys) | 1-5ms (in-region) | 50-200ms | Variable |
| **Throughput** | 1 write/sec per key | ~1000 req/sec | Unlimited | Moderate |
| **Storage Limit** | 1GB total, 25MB/key | 10GB per DO | Unlimited | 10GB |
| **Best For** | Config, session data | Coordination, state | Blobs, backup | Relational data |
| **Cost** | Cheap reads | Moderate | Cheap storage | Per query |

### 2.2 Recommended Architecture

```
                    ┌─────────────────────────────────────────┐
                    │           Edge (Workers)                 │
                    │  ┌─────────────────────────────────┐    │
                    │  │        KV Cache Layer            │    │
                    │  │  (Collection metadata, schema)   │    │
                    │  └─────────────┬───────────────────┘    │
                    │                │ cache miss             │
                    └────────────────┼────────────────────────┘
                                     │
                    ┌────────────────┼────────────────────────┐
                    │                ▼                        │
                    │      ┌─────────────────────┐            │
                    │      │  CatalogCoordinator │            │
                    │      │   Durable Object    │            │
                    │      │  (Source of Truth)  │            │
                    │      └─────────┬───────────┘            │
                    │                │                        │
                    │     ┌──────────┼──────────┐             │
                    │     ▼          ▼          ▼             │
                    │ ┌──────┐  ┌──────┐  ┌──────┐            │
                    │ │Tenant│  │Tenant│  │Tenant│            │
                    │ │  DO  │  │  DO  │  │  DO  │            │
                    │ └──────┘  └──────┘  └──────┘            │
                    │     Durable Objects Tier                │
                    └────────────────┬────────────────────────┘
                                     │ backup/recovery
                    ┌────────────────┼────────────────────────┐
                    │                ▼                        │
                    │      ┌─────────────────────┐            │
                    │      │         R2          │            │
                    │      │  (Backup, Snapshots)│            │
                    │      └─────────────────────┘            │
                    │            R2 Storage                   │
                    └─────────────────────────────────────────┘
```

### 2.3 Why This Architecture

1. **KV for Edge Caching**: Collection schemas rarely change but are read on every query. KV's edge caching provides <10ms access.

2. **Durable Objects for Consistency**: Schema changes, collection creation/deletion require strong consistency. DOs provide single-threaded execution.

3. **R2 for Durability**: Periodic snapshots to R2 enable disaster recovery and cross-region backup.

## 3. Catalog Design for Document DB

### 3.1 Catalog Data Model

```typescript
// Global catalog structure (stored in CatalogCoordinator DO)
interface Catalog {
  // Tenant registry
  tenants: Map<TenantId, TenantInfo>;

  // Global settings
  settings: {
    defaultPartitionStrategy: 'day' | 'month' | 'none';
    defaultTTL: number | null;
    maxCollectionsPerTenant: number;
    maxDocumentsPerCollection: number;
  };

  // System metadata
  version: number;
  createdAt: number;
  updatedAt: number;
}

// Per-tenant metadata (stored in TenantCoordinator DO)
interface TenantCatalog {
  tenantId: string;

  // Collection registry
  collections: Map<CollectionName, CollectionMetadata>;

  // Database-level settings
  databases: Map<DatabaseName, DatabaseInfo>;

  // Quota tracking
  quotas: TenantQuotas;

  // Timestamps
  createdAt: number;
  updatedAt: number;
}

// Collection metadata
interface CollectionMetadata {
  // Identity
  name: string;
  database: string;
  uuid: string;

  // Schema definition
  schema: {
    version: number;
    columns: ColumnDefinition[];
    primaryKey: string;
    orderBy: string[];
    partitionBy?: string;
  };

  // Index definitions
  indexes: IndexDefinition[];

  // Engine configuration
  engine: {
    type: 'ReplacingMergeTree' | 'SummingMergeTree' | 'MergeTree';
    settings: MergeTreeSettings;
  };

  // Statistics (cached, updated periodically)
  stats: {
    rowCount: bigint;
    byteSize: number;
    partCount: number;
    lastInsert: number;
    lastQuery: number;
  };

  // Metadata timestamps
  createdAt: number;
  updatedAt: number;
  schemaUpdatedAt: number;
}

interface ColumnDefinition {
  name: string;
  type: ClickHouseType;
  nullable: boolean;
  defaultExpression?: string;
  codec?: string;
  comment?: string;
}

interface IndexDefinition {
  name: string;
  type: 'minmax' | 'set' | 'bloom_filter' | 'ngrambf_v1' | 'tokenbf_v1';
  columns: string[];
  granularity: number;
  parameters?: Record<string, unknown>;
}
```

### 3.2 Schema Evolution Strategy

Document DBs need flexible schema evolution. Our approach:

**Additive Changes (Automatic):**
- New fields in documents automatically extend schema
- New columns added with `DEFAULT NULL` or expression
- No migration needed for reads

**Type Changes (Manual Validation):**
```typescript
interface SchemaEvolution {
  // Allowed automatic coercions
  allowedCoercions: Map<FromType, ToType[]>;

  // Schema validation mode
  validationMode: 'strict' | 'flexible' | 'none';

  // Migration history
  migrations: SchemaMigration[];
}

// Example: Int32 -> Int64 is safe
// String -> Int is not safe without explicit migration
```

**Schema Versioning:**
```typescript
interface SchemaVersion {
  version: number;
  columns: ColumnDefinition[];
  createdAt: number;

  // For rollback
  previousVersion?: number;
}

// Store multiple schema versions
interface CollectionSchemaHistory {
  currentVersion: number;
  versions: Map<number, SchemaVersion>;

  // Max versions to retain
  maxVersions: number;
}
```

### 3.3 KV Cache Schema

For fast edge access, cache collection metadata in KV:

```typescript
// KV key format: catalog:{tenantId}:collection:{collectionName}
interface CachedCollectionMetadata {
  // Core fields needed for query processing
  name: string;
  database: string;
  schema: {
    columns: ColumnDefinition[];
    primaryKey: string;
  };
  engine: string;

  // Cache metadata
  cachedAt: number;
  version: number;  // For cache invalidation
}

// KV key format: catalog:{tenantId}:list
interface CachedCollectionList {
  collections: Array<{
    name: string;
    database: string;
  }>;
  cachedAt: number;
  version: number;
}
```

**Cache Invalidation Strategy:**
1. On schema change, increment version in DO
2. Write-through to KV with new version
3. Workers check version on read, refresh if stale
4. TTL of 60 seconds for automatic refresh

## 4. Multi-Tenant Considerations

### 4.1 Isolation Patterns

We recommend **Shared Database, Tenant-Prefixed Namespace**:

```
Namespace Format: {tenantId}_{database}_{collection}

Example:
  tenant123_default_users
  tenant123_default_orders
  tenant456_analytics_events
```

**Why This Pattern:**
- Cost-effective (single ClickHouse instance via WASM)
- Good isolation (tenant prefix ensures no cross-access)
- Scalable (thousands of tenants)
- Flexible (per-tenant databases within namespace)

### 4.2 Tenant Hierarchy in DOs

```
CatalogCoordinator (singleton)
├── TenantCoordinator:tenant123
│   ├── TableCoordinator:tenant123_default_users
│   │   └── PartitionWorker:2024-01
│   └── TableCoordinator:tenant123_default_orders
│       └── PartitionWorker:2024-01
├── TenantCoordinator:tenant456
│   └── TableCoordinator:tenant456_analytics_events
│       └── PartitionWorker:2024-01
└── TenantCoordinator:tenant789
    └── ...
```

### 4.3 Quota Management

```typescript
interface TenantQuotas {
  // Storage limits
  maxStorageBytes: number;
  currentStorageBytes: number;

  // Collection limits
  maxCollections: number;
  currentCollections: number;

  // Document limits (per collection)
  maxDocumentsPerCollection: number;

  // Rate limits
  maxWritesPerSecond: number;
  maxReadsPerSecond: number;

  // Feature flags
  features: {
    customIndexes: boolean;
    ttlSupport: boolean;
    schemaValidation: boolean;
    fullTextSearch: boolean;
  };
}

// Quota checking in TenantCoordinator DO
async function checkQuota(
  operation: 'create_collection' | 'insert' | 'storage',
  amount: number
): Promise<QuotaCheckResult> {
  const quotas = await this.getQuotas();

  switch (operation) {
    case 'create_collection':
      if (quotas.currentCollections >= quotas.maxCollections) {
        return { allowed: false, reason: 'Collection limit exceeded' };
      }
      break;
    case 'storage':
      if (quotas.currentStorageBytes + amount > quotas.maxStorageBytes) {
        return { allowed: false, reason: 'Storage quota exceeded' };
      }
      break;
  }

  return { allowed: true };
}
```

### 4.4 Tenant Lifecycle

```typescript
// Tenant provisioning
async function provisionTenant(tenantId: string, plan: TenantPlan): Promise<void> {
  // 1. Create tenant entry in CatalogCoordinator
  await catalogCoordinator.createTenant({
    id: tenantId,
    plan,
    quotas: getQuotasForPlan(plan),
    createdAt: Date.now(),
  });

  // 2. Create TenantCoordinator DO
  const tenantDO = await env.TENANT_COORDINATOR.get(
    env.TENANT_COORDINATOR.idFromName(`tenant:${tenantId}`)
  );
  await tenantDO.initialize({ tenantId, plan });

  // 3. Create default database
  await tenantDO.createDatabase('default');
}

// Tenant deletion (soft delete first)
async function deprovisionTenant(tenantId: string): Promise<void> {
  // 1. Mark tenant as deleted (soft delete)
  await catalogCoordinator.markTenantDeleted(tenantId);

  // 2. Schedule cleanup alarm (30 day retention)
  await catalogCoordinator.scheduleCleanup(tenantId, 30 * 24 * 60 * 60 * 1000);

  // 3. Invalidate caches
  await invalidateTenantCaches(tenantId);
}
```

## 5. Implementation Plan

### Phase 1: Core Catalog (Week 1-2)

1. **CatalogCoordinator DO**
   - Tenant registry
   - Global settings
   - Health monitoring

2. **TenantCoordinator DO**
   - Collection metadata CRUD
   - Schema storage
   - Quota tracking

3. **KV Cache Layer**
   - Collection metadata caching
   - Cache invalidation on write

### Phase 2: Schema Evolution (Week 3)

1. **Schema versioning**
2. **Automatic type coercion**
3. **Migration tracking**

### Phase 3: Indexes (Week 4)

1. **Index definitions storage**
2. **Index metadata in KV**
3. **Index-aware query planning

### Phase 4: Multi-Tenant Features (Week 5-6)

1. **Quota enforcement**
2. **Tenant isolation testing**
3. **Rate limiting
4. **Billing integration hooks**

### Phase 5: Backup & Recovery (Week 7)

1. **R2 snapshot creation**
2. **Point-in-time recovery**
3. **Cross-region replication**

## 6. API Design

### 6.1 Catalog Management API

```typescript
// Collection CRUD
POST   /v1/collections              // Create collection
GET    /v1/collections              // List collections
GET    /v1/collections/:name        // Get collection info
DELETE /v1/collections/:name        // Drop collection
PATCH  /v1/collections/:name/schema // Update schema

// Index management
POST   /v1/collections/:name/indexes          // Create index
GET    /v1/collections/:name/indexes          // List indexes
DELETE /v1/collections/:name/indexes/:index   // Drop index

// Schema introspection (ClickHouse-compatible)
GET    /v1/system/tables            // system.tables equivalent
GET    /v1/system/columns           // system.columns equivalent
```

### 6.2 SQL Compatibility

```sql
-- These queries work against our catalog
SELECT * FROM system.tables WHERE database = 'default';
SELECT * FROM system.columns WHERE table = 'users';
SHOW TABLES;
SHOW CREATE TABLE users;
DESCRIBE users;
```

## 7. Trade-offs and Alternatives

### 7.1 Alternative: D1 for Catalog

**Pros:**
- SQL queries against catalog
- Familiar relational model
- Built-in transactions

**Cons:**
- Higher latency than KV
- Per-query pricing
- No global distribution like KV

**Decision**: Use DO + KV. D1's query latency and pricing don't fit high-frequency metadata lookups.

### 7.2 Alternative: Single DO for Everything

**Pros:**
- Simpler implementation
- Single source of truth

**Cons:**
- Scalability bottleneck (~1000 req/sec limit)
- All tenants share one DO

**Decision**: Hierarchical DOs. CatalogCoordinator routes to TenantCoordinators.

### 7.3 Alternative: Push-based Cache Invalidation

**Pros:**
- Immediate consistency
- No stale reads

**Cons:**
- Complex to implement
- Fan-out at scale

**Decision**: Pull-based with version checking. Simpler, and 60s staleness is acceptable for schema metadata.

## 8. Monitoring and Observability

```typescript
// Metrics to track
interface CatalogMetrics {
  // Cache performance
  kvCacheHitRate: number;
  kvCacheMissRate: number;

  // DO performance
  catalogDOLatencyP50: number;
  catalogDOLatencyP99: number;

  // Tenant metrics
  tenantsCount: number;
  collectionsPerTenant: Map<string, number>;

  // Error rates
  schemaValidationErrors: number;
  quotaExceededErrors: number;
}
```

## 9. Conclusion

The recommended metadata architecture for document DB on Workers:

1. **Durable Objects**: Source of truth for catalog, tenant, and collection metadata
2. **Workers KV**: Edge-cached schema and collection metadata for fast reads
3. **R2**: Backup and disaster recovery for catalog snapshots

This design provides:
- **Strong consistency** for writes via Durable Objects
- **Low latency** for reads via KV edge caching
- **Scalability** via tenant-isolated DO hierarchy
- **Durability** via R2 backups
- **Multi-tenant isolation** via namespace prefixing and quota enforcement

Key implementation insights:
- Use ClickHouse's system table patterns for API compatibility
- Schema evolution should be additive by default
- Cache invalidation via versioning is simpler than push-based approaches
- Quota enforcement belongs in TenantCoordinator DO for consistency

## References

- [ClickHouse system.tables Documentation](https://clickhouse.com/docs/operations/system-tables/tables)
- [ClickHouse SharedCatalog GitHub Issue #48620](https://github.com/ClickHouse/ClickHouse/issues/48620)
- [ClickHouse INFORMATION_SCHEMA](https://clickhouse.com/docs/operations/system-tables/information_schema)
- [Cloudflare Workers Storage Options](https://developers.cloudflare.com/workers/platform/storage-options/)
- [Cloudflare Durable Objects Documentation](https://developers.cloudflare.com/durable-objects/)
- [Cloudflare KV Documentation](https://developers.cloudflare.com/kv/)
- [Multi-Tenant Database Architecture Patterns](https://www.bytebase.com/blog/multi-tenant-database-architecture-patterns-explained/)
- [Azure Multi-Tenant Storage Approaches](https://learn.microsoft.com/en-us/azure/architecture/guide/multitenant/approaches/storage-data)
