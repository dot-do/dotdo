# Multi-Tenant Semantic Layer Isolation

**Issue:** dotdo-pmgiv
**Date:** 2026-01-13
**Author:** Research Spike
**Status:** COMPLETE

## Executive Summary

This spike investigates isolation patterns for multi-tenant semantic layers in the dotdo platform. Based on analysis of existing codebase patterns (TenantDB, semantic-layer primitives, cross-DO latency data), we recommend a **hybrid isolation strategy** combining:

1. **Per-tenant Durable Objects** for schema isolation and data security
2. **Namespace separation** for cube/metric definitions
3. **Row-Level Security (RLS)** for shared infrastructure scenarios
4. **Cross-tenant aggregation APIs** for platform-wide analytics

### Success Criteria (from issue)

| Criteria | Target | Result |
|----------|--------|--------|
| Define isolation boundaries | Complete | Per-tenant DO + namespace separation |
| Schema isolation strategy | Complete | Tenant-scoped SemanticContext |
| Cross-tenant analytics | Complete | Aggregation DO pattern with consent |
| Performance impact | < 10% overhead | Achievable via namespace caching |

## Background: Existing Patterns

### Current Semantic Layer Architecture

The semantic layer in `db/primitives/semantic-layer/` provides:

```typescript
// From index.ts - SemanticContext is the core abstraction
export interface SemanticContext {
  cubes: Map<string, CubeDefinition>
  joins: JoinGraph
  accessControl: AccessControlConfig
  sqlGenerator: SQLGenerator
}
```

Key components:
- **CubeDefinition**: Metrics, dimensions, and measures
- **JoinGraph**: Relationships between cubes (join paths)
- **AccessControlConfig**: Role-based access to cubes/dimensions
- **SQLGenerator**: Converts semantic queries to SQL

### Existing Multi-Tenant Pattern (TenantDB)

The `TenantDB` in `examples/compat-postgres-multi-tenant/` demonstrates the proven isolation pattern:

```typescript
// Per-tenant DO with isolated SQLite
export class TenantDB extends DurableObject<Env> {
  private tenantId: string

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.tenantId = ctx.id.toString()  // DO ID = tenant ID
  }

  // RLS policies for fine-grained control
  private setupPolicies() {
    this.addPolicy('customers', {
      select: (ctx) => `tenant_id = '${ctx.tenantId}'`,
      insert: (ctx, row) => ({ ...row, tenant_id: ctx.tenantId }),
    })
  }
}
```

### Cross-DO Latency Constraints

From `docs/spikes/cross-do-join-latency.md`:

| Pattern | Max DOs | Target p50 | Notes |
|---------|---------|------------|-------|
| Point lookups | 10+ | <50ms | Parallel fan-out |
| 2-way equi-join | 2 | <20ms | Hash join |
| N-way star schema | 5-10 | <100ms | Broadcast dimensions |

**Key constraint:** Cross-tenant queries involve cross-DO calls with ~2-5ms same-colo latency per hop.

## Isolation Strategies Analyzed

### Strategy 1: Per-Tenant Semantic DO (Recommended)

Each tenant gets a dedicated `SemanticLayerDO` instance:

```typescript
export class SemanticLayerDO extends DOBase {
  private tenantId: string
  private context: SemanticContext

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.tenantId = ctx.id.toString()
    this.context = this.loadTenantSchema()
  }

  // Tenant-scoped cube registration
  async registerCube(cube: CubeDefinition): Promise<void> {
    // Validate cube belongs to this tenant's namespace
    if (!cube.name.startsWith(`${this.tenantId}/`)) {
      cube.name = `${this.tenantId}/${cube.name}`
    }
    this.context.cubes.set(cube.name, cube)
    await this.persistSchema()
  }

  // Query execution with tenant isolation
  async query(request: SemanticQuery): Promise<QueryResult> {
    // All referenced cubes must be in tenant namespace
    this.validateTenantScope(request)
    return this.context.sqlGenerator.execute(request)
  }
}
```

**Pros:**
- Complete data isolation (separate SQLite per tenant)
- Independent schema evolution
- No noisy neighbor effects
- Natural horizontal scaling

**Cons:**
- Cross-tenant queries require multi-DO coordination
- Schema duplication for shared reference data

### Strategy 2: Namespace Separation (Single DO)

All tenants share a single SemanticLayerDO with namespace prefixes:

```typescript
// Namespace-based isolation
const tenantPrefix = `tenant:${tenantId}`

cubes.set(`${tenantPrefix}/orders`, ordersCube)
cubes.set(`${tenantPrefix}/customers`, customersCube)

// Query validation
function validateAccess(query: SemanticQuery, tenantId: string) {
  for (const cube of query.cubes) {
    if (!cube.startsWith(`tenant:${tenantId}/`)) {
      throw new UnauthorizedError(`Access denied to cube: ${cube}`)
    }
  }
}
```

**Pros:**
- Simpler deployment (single DO)
- Easier cross-tenant analytics
- Lower memory overhead for small tenants

**Cons:**
- Shared failure domain
- Requires careful namespace enforcement
- Scale limits (~10K cubes per DO)

### Strategy 3: Hybrid Approach (Recommended)

Combine per-tenant DOs with a shared platform layer:

```
                    +-------------------+
                    |  PlatformMetrics  |  (aggregated, anonymized)
                    |       DO          |
                    +-------------------+
                            |
            +---------------+---------------+
            |               |               |
    +-------v------+ +------v-------+ +-----v--------+
    | TenantA      | | TenantB      | | TenantC      |
    | SemanticDO   | | SemanticDO   | | SemanticDO   |
    +-------+------+ +------+-------+ +------+-------+
            |               |                |
    +-------v------+ +------v-------+ +------v-------+
    | TenantA      | | TenantB      | | TenantC      |
    | DataDO       | | DataDO       | | DataDO       |
    +--------------+ +--------------+ +--------------+
```

## Recommended Implementation

### 1. Tenant-Scoped SemanticContext

```typescript
// db/primitives/semantic-layer/tenant-context.ts

export interface TenantSemanticContext extends SemanticContext {
  tenantId: string
  namespace: string  // e.g., "acme" for acme.api.dotdo.dev
  isolation: IsolationLevel
  sharedCubes: string[]  // Reference cubes from platform
}

export enum IsolationLevel {
  FULL = 'full',           // Complete isolation, no shared data
  NAMESPACE = 'namespace', // Namespace-based, shared infra
  HYBRID = 'hybrid',       // Per-tenant DO + platform aggregation
}

export function createTenantContext(
  tenantId: string,
  config: TenantConfig
): TenantSemanticContext {
  return {
    tenantId,
    namespace: config.namespace || tenantId,
    isolation: config.isolation || IsolationLevel.HYBRID,
    cubes: new Map(),
    joins: new JoinGraph(),
    accessControl: createTenantAccessControl(tenantId),
    sqlGenerator: new TenantSQLGenerator(tenantId),
    sharedCubes: config.sharedCubes || [],
  }
}
```

### 2. Tenant SemanticLayer DO

```typescript
// objects/SemanticLayerDO.ts

export class SemanticLayerDO extends DOBase {
  private tenantContext: TenantSemanticContext

  async initialize(): Promise<void> {
    this.tenantContext = createTenantContext(
      this.ctx.id.toString(),
      await this.loadTenantConfig()
    )

    // Import tenant-specific schemas
    await this.importTenantSchemas()

    // Setup RLS for data access
    this.setupAccessPolicies()
  }

  // Import from LookML or Cube.js files
  async importSchema(source: SchemaSource): Promise<ImportResult> {
    const imported = await importSchema(source)

    // Namespace all imported cubes
    for (const cube of imported.cubes) {
      cube.name = `${this.tenantContext.namespace}/${cube.name}`
      this.tenantContext.cubes.set(cube.name, cube)
    }

    await this.persistSchema()
    return { cubesImported: imported.cubes.length }
  }

  // Execute semantic query with tenant isolation
  async query(request: SemanticQuery): Promise<QueryResult> {
    // Validate all cubes are in tenant namespace or shared
    for (const cubeName of request.cubes) {
      if (!this.isAccessible(cubeName)) {
        throw new AccessDeniedError(`Cube not accessible: ${cubeName}`)
      }
    }

    // Generate and execute SQL
    const sql = this.tenantContext.sqlGenerator.generate(request)
    return this.executeWithRLS(sql)
  }

  private isAccessible(cubeName: string): boolean {
    const { namespace, sharedCubes } = this.tenantContext
    return (
      cubeName.startsWith(`${namespace}/`) ||
      sharedCubes.includes(cubeName) ||
      cubeName.startsWith('platform/')  // Platform-wide cubes
    )
  }
}
```

### 3. Access Control Integration

```typescript
// Extend existing access-control.ts

export interface TenantAccessPolicy {
  tenantId: string
  cubeAccess: Map<string, CubePermissions>
  dimensionFilters: Map<string, DimensionFilter>
  rowLevelSecurity: RLSPolicy[]
}

export interface RLSPolicy {
  table: string
  condition: (ctx: PolicyContext) => string
}

// Example RLS for tenant isolation
const tenantRLS: RLSPolicy = {
  table: '*',  // All tables
  condition: (ctx) => `tenant_id = '${ctx.tenantId}'`
}

// Example: Dimension-level access control
const salesRegionPolicy: DimensionFilter = {
  dimension: 'region',
  allowedValues: (ctx) => ctx.claims?.regions || ['*'],
}
```

### 4. Cross-Tenant Analytics Pattern

For platform-wide analytics (with tenant consent):

```typescript
// objects/PlatformMetricsDO.ts

export class PlatformMetricsDO extends DOBase {
  // Aggregated metrics from consenting tenants
  private aggregations: Map<string, AggregatedMetric>

  // Tenants push anonymized metrics here
  async ingestTenantMetrics(
    tenantId: string,
    metrics: AnonymizedMetric[]
  ): Promise<void> {
    // Verify tenant has opted in
    const consent = await this.getTenantConsent(tenantId)
    if (!consent.allowPlatformAggregation) {
      throw new ConsentRequiredError()
    }

    // Aggregate without storing raw tenant data
    for (const metric of metrics) {
      this.updateAggregation(metric)
    }
  }

  // Platform-wide queries (e.g., benchmarks)
  async queryPlatformMetrics(request: PlatformQuery): Promise<AggregatedResult> {
    // Only returns anonymized, aggregated data
    return this.executeAggregatedQuery(request)
  }
}

// Tenant-side: Push metrics to platform
export class SemanticLayerDO extends DOBase {
  async pushToPlatform(): Promise<void> {
    if (!this.tenantConfig.allowPlatformAggregation) return

    const anonymized = await this.computeAnonymizedMetrics()
    const platform = this.env.PLATFORM_METRICS.get(
      this.env.PLATFORM_METRICS.idFromName('global')
    )
    await platform.ingestTenantMetrics(this.tenantId, anonymized)
  }
}
```

## Schema Storage and Persistence

### Tenant Schema Storage

```typescript
// Per-tenant schema stored in DO's SQLite

interface StoredSchema {
  version: number
  cubes: SerializedCube[]
  joins: SerializedJoin[]
  policies: SerializedPolicy[]
  importSources: ImportSource[]  // LookML/Cube.js origins
  lastModified: Date
}

// Schema versioning for migrations
async function migrateSchema(
  stored: StoredSchema,
  targetVersion: number
): Promise<StoredSchema> {
  let current = stored
  while (current.version < targetVersion) {
    const migration = schemaMigrations[current.version + 1]
    current = await migration(current)
  }
  return current
}
```

### Schema Import/Export

Leverage existing `schema-import.ts` for multi-format support:

```typescript
// Support importing tenant schemas from multiple sources
async function importTenantSchema(
  tenantId: string,
  source: SchemaSource
): Promise<ImportedSchema> {
  switch (source.format) {
    case 'lookml':
      return importLookML(source.content, { namespace: tenantId })
    case 'cubejs':
      return importCubeJS(source.content, { namespace: tenantId })
    case 'dbt':
      return importDBT(source.content, { namespace: tenantId })
    default:
      throw new UnsupportedFormatError(source.format)
  }
}
```

## Performance Considerations

### Query Routing Latency

| Scenario | Latency Budget | Strategy |
|----------|----------------|----------|
| Single-tenant query | <20ms | Direct DO call |
| Cross-cube join (same tenant) | <50ms | Local join in DO |
| Cross-tenant aggregation | <200ms | Parallel fan-out + merge |
| Platform metrics query | <100ms | Pre-aggregated in PlatformDO |

### Caching Strategy

```typescript
// Per-tenant schema cache
const schemaCache = new LRUCache<string, TenantSemanticContext>({
  max: 1000,          // Max tenants in memory
  ttl: 5 * 60 * 1000, // 5 minute TTL
})

// Query plan cache (per-tenant)
const queryPlanCache = new LRUCache<string, CompiledQuery>({
  max: 100,           // Plans per tenant
  ttl: 60 * 1000,     // 1 minute TTL
})
```

### Memory Budget

| Component | Per-Tenant Budget | Notes |
|-----------|-------------------|-------|
| Schema (cubes, joins) | ~100KB | Compressed JSON |
| Query cache | ~50KB | LRU with 100 entries |
| RLS policies | ~10KB | Compiled predicates |
| Total per DO | ~200KB | Within DO memory limits |

## Security Considerations

### Isolation Guarantees

1. **Data Isolation**: Per-tenant SQLite databases (physical isolation)
2. **Schema Isolation**: Namespace prefixes prevent cross-tenant cube access
3. **Query Isolation**: RLS enforced at SQL generation time
4. **Network Isolation**: DO-to-DO calls authenticated via internal tokens

### Attack Vectors Mitigated

| Vector | Mitigation |
|--------|------------|
| SQL injection | Parameterized queries in SQLGenerator |
| Namespace escape | Strict prefix validation |
| Cross-tenant data leak | RLS + DO isolation |
| Schema enumeration | Access control on cube listings |

### Audit Trail

```typescript
// Log all cross-tenant access attempts
interface AuditEntry {
  timestamp: Date
  tenantId: string
  userId: string
  action: 'query' | 'schema_change' | 'cross_tenant_attempt'
  cubesAccessed: string[]
  success: boolean
  denialReason?: string
}
```

## Migration Path

### Phase 1: Namespace Separation (Week 1-2)

1. Add `tenantId` field to existing SemanticContext
2. Prefix all cube names with tenant namespace
3. Add validation to query execution

### Phase 2: Per-Tenant DO (Week 3-4)

1. Create `SemanticLayerDO` class
2. Migrate existing schemas to per-tenant storage
3. Update API routing to tenant DOs

### Phase 3: Cross-Tenant Analytics (Week 5-6)

1. Implement `PlatformMetricsDO`
2. Add consent management
3. Build aggregation pipeline

### Phase 4: Advanced Features (Week 7-8)

1. Schema versioning and migrations
2. Cross-tenant cube sharing (with permissions)
3. Federated queries for enterprise customers

## Open Questions

1. **Schema sharing**: How should shared reference cubes (e.g., date dimensions) be managed across tenants?

2. **Query quotas**: Should per-tenant query limits be enforced at the semantic layer or data layer?

3. **Schema versioning**: How to handle breaking schema changes without disrupting active queries?

4. **Enterprise federation**: Should enterprise customers be able to query across their sub-tenants?

## Recommendations

### Immediate (P0)

1. **Implement per-tenant SemanticLayerDO** - Primary isolation mechanism
2. **Add namespace validation** - Prevent cross-tenant cube access
3. **Integrate with existing TenantDB pattern** - Reuse RLS infrastructure

### Short-term (P1)

1. **Schema import with namespace injection** - Support LookML/Cube.js per-tenant
2. **Query plan caching** - Per-tenant LRU cache
3. **Audit logging** - Track all cross-tenant access attempts

### Medium-term (P2)

1. **PlatformMetricsDO for aggregation** - Opt-in platform analytics
2. **Schema versioning** - Migrations without downtime
3. **Cross-tenant cube sharing** - Permission-based sharing

## References

### Codebase

- `db/primitives/semantic-layer/` - Core semantic layer implementation
- `examples/compat-postgres-multi-tenant/objects/TenantDB.ts` - Multi-tenant DO pattern
- `db/primitives/semantic-layer/schema-import.ts` - LookML/Cube.js import
- `db/primitives/semantic-layer/access-control.ts` - RBAC implementation
- `docs/spikes/cross-do-join-latency.md` - Cross-DO latency analysis

### External

- Cube.js multi-tenant documentation
- LookML namespace patterns
- Cloudflare DO isolation guarantees

---

## See Also

### Related Spikes

- [Cross-DO Join Latency](./cross-do-join-latency.md) - Query performance constraints for tenant queries
- [Cron Hibernation](./cron-hibernation.md) - Multi-tenant scheduling patterns
- [Rate Limiting Isolates](./rate-limiting-isolates.md) - Per-tenant rate limiting strategies

### Related Architecture Documents

- [Architecture Overview](../architecture.md) - Main architecture documentation
- [DOBase Decomposition](../architecture/dobase-decomposition.md) - Module isolation patterns

### Spikes Index

- [All Spikes](./README.md) - Complete index of research spikes
