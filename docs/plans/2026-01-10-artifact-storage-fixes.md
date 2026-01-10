# Artifact Storage Fixes Plan

**Date**: 2026-01-10
**Status**: Draft
**Author**: Claude + Nathan
**Depends On**: 2026-01-10-artifact-storage-design.md

## Overview

Based on comprehensive code, architecture, TypeScript, and product reviews, this plan addresses critical issues blocking production deployment of the artifact storage system.

## Issue Summary

### Critical (P0) - Blocking Production
| Issue | Description | Effort |
|-------|-------------|--------|
| IcebergReader interface mismatch | Serve snippet uses incompatible interface | 2d |
| Snippet size limits | Files exceed 32KB limit | 1d |
| Real Pipeline HTTP endpoints | Endpoints don't exist yet | 2d |
| Real Parquet parsing | Currently JSON mocks | 3d |

### High (P1) - Must Fix Before Launch
| Issue | Description | Effort |
|-------|-------------|--------|
| Memory leak in inFlightRequests | Map never cleaned up | 0.5d |
| handleIngest buffers all artifacts | Should use streaming chunker | 0.5d |
| RetryResult<T> unsafe cast | Should use discriminated union | 0.5d |
| E2E tests with real R2 | No integration tests | 2d |

### Medium (P2) - Should Fix
| Issue | Description | Effort |
|-------|-------------|--------|
| Duplicate JSONL parsing | Logic duplicated in handleIngest | 0.5d |
| Rate limiting not implemented | Config defined but unused | 1d |
| No idempotency/deduplication | Repeated ingests create duplicates | 1d |
| No cache invalidation on write | Stale content after updates | 1d |
| Duplicate ArtifactMode type | Defined in two files | 0.25d |
| AST fields use `object` type | Should use `unknown` | 0.25d |

### Low (P3) - Nice to Have
| Issue | Description | Effort |
|-------|-------------|--------|
| Missing readonly modifiers | Config interfaces mutable | 0.25d |
| No @dotdo/artifacts SDK | Agent integration missing | 2d |
| No $.on.Artifact workflow | Event integration missing | 1d |
| Gzip ingest compression | Reduce transfer size | 0.5d |
| Batch GET support | Multi-artifact fetch | 1d |
| Versioning support | home@v1.md pattern | 3d |

## Phase 1: Interface Compatibility (Critical Path)

### 1.1 IcebergReader Integration

**Current Interface in artifacts-serve.ts:**
```typescript
export interface IcebergReader {
  getRecord(options: {
    table: string
    partition: { ns: string; type: string }
    id: string
  }): Promise<Record<string, unknown> | null>
}
```

**Actual Interface in db/iceberg/reader.ts:**
```typescript
interface GetRecordOptions extends FindFileOptions {
  columns?: string[]
}

interface FindFileOptions {
  table: string
  partition: PartitionFilter
  id: string
  snapshotId?: number
  auth?: AuthContext
}

interface PartitionFilter {
  ns: string
  type: string
  visibility?: Visibility  // MISSING!
}

interface AuthContext {       // MISSING!
  userId?: string
  orgId?: string
  roles?: string[]
}
```

**Fix Required:**
1. Import types from `db/iceberg/types`
2. Update `IcebergReader` interface to match actual signature
3. Pass `visibility` based on authenticated user
4. Pass `auth` context from request headers
5. Add `columns` projection for efficiency

### 1.2 Snippet Size Optimization

Current sizes (unminified):
- artifacts-ingest.ts: ~40KB (1,151 lines)
- artifacts-serve.ts: ~35KB (955 lines)

Cloudflare Snippet limit: 32KB

**Options:**
1. Bundle and minify (likely reduces to <20KB each)
2. Extract shared utilities to a common module
3. Split into multiple snippets with routing

### 1.3 Type Safety Fixes

**RetryResult<T> - Discriminated Union:**
```typescript
// Current (unsafe)
export interface RetryResult<T> {
  result: T          // Could be undefined when success=false
  retries: number
  success: boolean
  error?: string
}

// Fixed (type-safe)
export type RetryResult<T> =
  | { success: true; result: T; retries: number }
  | { success: false; result: undefined; retries: number; error: string }
```

**Type Consolidation:**
```typescript
// artifacts-types.ts (new shared module)
export type ArtifactMode = 'preview' | 'build' | 'bulk'
export type Visibility = 'public' | 'unlisted' | 'org' | 'user'

// Re-export from artifacts-ingest.ts and artifacts-config.ts
export { type ArtifactMode } from './artifacts-types'
```

## Phase 2: Memory & Reliability

### 2.1 inFlightRequests Cleanup

**Current (leaky):**
```typescript
const inFlightRequests = new Map<string, Promise<ServeResult>>()

async function handleServeIntegration(...) {
  const inFlight = inFlightRequests.get(cacheKey)
  if (inFlight) return inFlight

  const requestPromise = handleServeIntegrationInner(...)
  inFlightRequests.set(cacheKey, requestPromise)

  try {
    return await requestPromise
  } finally {
    inFlightRequests.delete(cacheKey)  // Only cleaned on success/error
  }
}
```

**Problem:** If promise never settles (e.g., infinite await), entry is never cleaned.

**Fix:** Add TTL-based cleanup:
```typescript
interface InFlightEntry {
  promise: Promise<ServeResult>
  createdAt: number
}

const inFlightRequests = new Map<string, InFlightEntry>()
const IN_FLIGHT_TTL_MS = 30_000  // 30 seconds max

function cleanupStaleEntries() {
  const now = Date.now()
  for (const [key, entry] of inFlightRequests) {
    if (now - entry.createdAt > IN_FLIGHT_TTL_MS) {
      inFlightRequests.delete(key)
    }
  }
}
```

### 2.2 Streaming handleIngest

**Current (buffers all):**
```typescript
const artifacts: ArtifactRecord[] = []
// ... parsing loop pushes to artifacts array
const chunks = chunkArtifacts(artifacts, maxBytes)  // All in memory
```

**Fixed (streams):**
```typescript
async function* validateAndYield(
  lines: AsyncGenerator<unknown>
): AsyncGenerator<ArtifactRecord> {
  for await (const line of lines) {
    yield validateArtifact(line)
  }
}

// Use streaming chunker
for await (const chunk of chunkArtifactsStreaming(
  validateAndYield(parseJSONL(body))
)) {
  await uploadChunk(chunk, endpoint, mode)
}
```

## Phase 3: Production Infrastructure

### 3.1 Pipeline Configuration

**wrangler.toml:**
```toml
[[pipelines]]
name = "artifacts-preview"
batch = { max_bytes = 102400, max_seconds = 5 }
destination = { type = "r2", bucket = "artifacts-lake", format = "parquet" }
partition_by = ["ns", "type"]

[[pipelines]]
name = "artifacts-build"
batch = { max_bytes = 1048576, max_seconds = 30 }
destination = { type = "r2", bucket = "artifacts-lake", format = "parquet" }
partition_by = ["ns", "type"]

[[pipelines]]
name = "artifacts-bulk"
batch = { max_bytes = 5242880, max_seconds = 120 }
destination = { type = "r2", bucket = "artifacts-lake", format = "parquet" }
partition_by = ["ns", "type"]
```

### 3.2 Real Parquet Parsing

The IcebergReader currently uses JSON mock files. Need to implement:
1. Avro manifest parsing (manifest-list.avro, manifest-*.avro)
2. Parquet file reading using parquet-wasm
3. Column projection for efficiency

### 3.3 Snippet Deployment

```bash
# Build and minify
npm run build:snippets

# Deploy via Wrangler
wrangler deploy snippets/artifacts-ingest.ts --snippet
wrangler deploy snippets/artifacts-serve.ts --snippet
```

## Phase 4: Feature Completeness

### 4.1 Rate Limiting

Implement using the existing config:
```typescript
interface TenantArtifactConfig {
  limits: {
    maxArtifactsPerRequest: number   // Check: artifacts.length <= limit
    maxBytesPerRequest: number       // Check: Content-Length <= limit
    maxRequestsPerMinute: number     // Check: rate limit in KV/DO
  }
}
```

### 4.2 Idempotency

Add `X-Idempotency-Key` header support:
```typescript
// Check if key was processed recently
const existing = await kv.get(`idempotency:${key}`)
if (existing) {
  return JSON.parse(existing)  // Return cached response
}

// Process request
const result = await processIngest(...)

// Cache result with TTL
await kv.put(`idempotency:${key}`, JSON.stringify(result), {
  expirationTtl: 86400  // 24 hours
})
```

### 4.3 Cache Invalidation

On successful ingest, purge affected cache keys:
```typescript
// After Pipeline write succeeds
for (const artifact of artifacts) {
  const cacheKey = `${origin}/$.content/${artifact.ns}/${artifact.type}/${artifact.id}.*`
  await caches.default.delete(cacheKey)
}
```

### 4.4 @dotdo/artifacts SDK

```typescript
// compat/artifacts/index.ts
import type { ArtifactRecord, ArtifactMode } from '../../snippets/artifacts-types'

export class Artifacts {
  constructor(private baseUrl: string, private authToken: string) {}

  async put(
    ns: string,
    type: string,
    id: string,
    content: Partial<ArtifactRecord>,
    options?: { mode?: ArtifactMode }
  ): Promise<IngestResponse> {
    const record = { ns, type, id, ...content }
    return fetch(`${this.baseUrl}/$.artifacts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-ndjson',
        'X-Artifact-Mode': options?.mode ?? 'build',
        'Authorization': `Bearer ${this.authToken}`,
      },
      body: JSON.stringify(record),
    }).then(r => r.json())
  }

  async get(
    ns: string,
    type: string,
    id: string,
    ext: string,
    options?: { fresh?: boolean; maxAge?: number }
  ): Promise<string> {
    const params = new URLSearchParams()
    if (options?.fresh) params.set('fresh', 'true')
    if (options?.maxAge) params.set('max_age', String(options.maxAge))

    const url = `${this.baseUrl}/$.content/${ns}/${type}/${id}.${ext}?${params}`
    return fetch(url).then(r => r.text())
  }
}
```

## TDD Issue Structure

### Phase 1: Interface Compatibility (P0)
- [RED] IcebergReader integration tests
- [GREEN] Update serve snippet to use real interface
- [REFACTOR] Extract shared types module

### Phase 2: Memory & Reliability (P1)
- [RED] Memory cleanup tests
- [GREEN] Fix inFlightRequests cleanup + streaming handleIngest
- [REFACTOR] RetryResult discriminated union + type consolidation

### Phase 3: Production Infrastructure (P0)
- [RED] E2E tests with real pipelines
- [GREEN] Pipeline config + Parquet parsing + deployment
- [REFACTOR] Performance optimization

### Phase 4: Feature Completeness (P2)
- [RED] Rate limiting + idempotency tests
- [GREEN] Implement rate limiting + idempotency + cache invalidation
- [REFACTOR] @dotdo/artifacts SDK

## Timeline

| Phase | Effort | Dependencies |
|-------|--------|--------------|
| Phase 1 | 3-4 days | None |
| Phase 2 | 2-3 days | Phase 1 |
| Phase 3 | 5-7 days | Phase 1, Phase 2 |
| Phase 4 | 4-5 days | Phase 3 |

**Total: 14-19 days to production-ready**

## Success Criteria

1. All 311+ tests pass
2. IcebergReader integration works with real visibility/auth
3. Snippets deploy within 32KB limit
4. E2E tests pass with real R2/Pipeline
5. No memory leaks under load
6. Rate limiting enforced per tenant
7. Cache invalidation works within SWR window
