# Partition Strategy for Iceberg Tables

> Optimized partition layout for visibility-based query pruning

## Partition Key Order Decision

### Current Order: (ns, type, visibility)

After analysis, we chose **`(ns, type, visibility)`** as the partition key order for the following reasons:

#### 1. Namespace Isolation (Primary Concern)

Multi-tenancy requires that **namespace is the first partition key** to ensure:

- Data from different tenants is physically separated in different data files
- Cross-tenant data leakage is impossible at the storage level
- Tenant-specific queries never scan other tenants' data

```
data/
├── ns=payments.do/
│   ├── type=Function/
│   │   ├── visibility=public/
│   │   ├── visibility=org/
│   │   └── visibility=user/
│   └── type=Schema/
│       └── ...
└── ns=startups.studio/
    └── ...
```

#### 2. Type Filtering (Secondary)

Within a namespace, filtering by type is the second most common query pattern:

- "Show me all Functions in my namespace"
- "List all Schemas"
- Type filtering is required for nearly all DO lookups

#### 3. Visibility Pruning (Tertiary)

Visibility as the third partition key enables efficient filtering for:

- Public content queries (most common anonymous access)
- Private data isolation for authenticated users
- Manifest-level pruning skips entire visibility segments

### Why Not (visibility, ns, type)?

While `visibility` as leading key would optimize public queries, it has drawbacks:

1. **Security Risk**: Physical proximity of public data across tenants
2. **Query Pattern Mismatch**: Most queries include namespace context
3. **Multi-tenant Anti-pattern**: Tenants should be isolated first

### Why Not (ns, visibility, type)?

This was considered but rejected:

1. **Type queries dominate**: "List all Functions" is more common than "List all public"
2. **Type cardinality is low**: 10-20 types vs 4 visibility levels
3. **Better manifest bounds**: Type ranges are more selective

## Partition Spec Definition

### Iceberg Partition Spec (spec ID 0)

```json
{
  "specId": 0,
  "fields": [
    {
      "sourceId": 10,
      "fieldId": 1000,
      "name": "ns",
      "transform": "identity"
    },
    {
      "sourceId": 2,
      "fieldId": 1001,
      "name": "type",
      "transform": "identity"
    },
    {
      "sourceId": 11,
      "fieldId": 1002,
      "name": "visibility",
      "transform": "identity"
    }
  ]
}
```

### Field Mapping

| Source Field | Field ID | Partition Position | Purpose                      |
| ------------ | -------- | ------------------ | ---------------------------- |
| ns           | 10       | 0                  | Tenant isolation             |
| type         | 2        | 1                  | Resource type filtering      |
| visibility   | 11       | 2                  | Access control pruning       |

## Manifest Pruning Strategy

### Partition Summaries

Each manifest file contains partition summaries with min/max bounds:

```json
{
  "manifestPath": "s3://bucket/iceberg/do_things/manifests/manifest-1.avro",
  "partitions": [
    { "lowerBound": "payments.do", "upperBound": "payments.do", "containsNull": false },
    { "lowerBound": "Function", "upperBound": "Schema", "containsNull": false },
    { "lowerBound": "org", "upperBound": "user", "containsNull": false }
  ]
}
```

### Pruning Order

The reader applies filters in partition order:

1. **Namespace Check**: Skip if ns not in [lower, upper] bounds
2. **Type Check**: Skip if type not in [lower, upper] bounds
3. **Visibility Check**: Skip if visibility not in [lower, upper] bounds

### Visibility-Specific Optimizations

#### Public Query Fast Path

For queries with `visibility = 'public'`:

```typescript
// Skip manifests that don't contain public data
if (visibilityBounds.lowerBound === 'user' && visibilityBounds.upperBound === 'user') {
  // This manifest only contains private user data - skip
  return false
}
```

#### Unlisted Exclusion

For queries without explicit visibility filter:

```typescript
// Exclude unlisted data from general queries
if (visibilityBounds.lowerBound === 'unlisted' && visibilityBounds.upperBound === 'unlisted') {
  // Unlisted data requires explicit lookup - skip
  return false
}
```

## Query Patterns & Performance

### Common Query Patterns

| Query Type | Filter | Partition Prune Effectiveness |
| --- | --- | --- |
| Public content | `visibility = 'public'` | High - skips org/user manifests |
| Type listing | `type = 'Function'` | Medium - skips other type manifests |
| Point lookup | `ns + type + id` | High - single manifest typically |
| User data | `visibility = 'user' + auth` | High - skips public/org manifests |

### Performance Targets

| Scenario | Target Latency | Manifest Reads |
| --- | --- | --- |
| Cached metadata | 50-100ms | 0 (from cache) |
| Public point lookup | 100-150ms | 1-2 manifests |
| Cross-type query | 150-300ms | 2-5 manifests |
| Full table scan | 500ms-2s | All manifests |

## SQLite Index Strategy

For the local DO SQLite database, composite indexes support visibility queries:

```sql
-- Primary: visibility + type for listing public resources
CREATE INDEX things_visibility_type_idx ON things(visibility, type);

-- Secondary: visibility alone for filtering
CREATE INDEX things_visibility_idx ON things(visibility);
```

### Index Selection Rationale

1. **`(visibility, type)`**: Supports "list all public Functions" efficiently
2. **`(visibility)`**: Supports "count by visibility" and general access checks
3. **`(id, branch)`**: Primary lookup pattern (unchanged)

## Separate Partition Paths (Future Consideration)

For very large deployments, consider separate Iceberg tables:

```
iceberg/
├── do_things_public/    # Public data only (no auth required)
├── do_things_private/   # Org + user data (auth required)
```

Benefits:
- Complete isolation of public/private workloads
- Different compaction strategies per visibility
- Separate access control at storage level

Drawbacks:
- More complex query routing
- Cross-visibility queries require UNION
- Schema evolution must be coordinated

**Current recommendation**: Keep single table with partition-based pruning until data volume exceeds 100M records or query latency exceeds targets.

## R2 SQL Considerations

### Table Properties

```json
{
  "properties": {
    "write.parquet.compression-codec": "zstd",
    "write.target-file-size-bytes": "134217728",
    "write.distribution-mode": "hash",
    "write.metadata.metrics.default": "full"
  }
}
```

### Statistics Configuration

Enable statistics for efficient pruning:

```json
{
  "statistics.truncate.length": 16,
  "write.metadata.metrics.column.id": "full",
  "write.metadata.metrics.column.visibility": "full",
  "write.metadata.metrics.column.ns": "truncate(16)",
  "write.metadata.metrics.column.type": "full"
}
```

## Summary

The **`(ns, type, visibility)`** partition order provides:

1. **Security**: Tenant data isolation at storage level
2. **Performance**: Efficient visibility-based pruning
3. **Flexibility**: Supports all common query patterns
4. **Simplicity**: Single table with partition filtering

Manifest bounds checking on visibility enables:
- Public queries to skip private manifests
- Private queries to skip public manifests
- Unlisted data to be excluded from listings
