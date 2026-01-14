---
title: "Artifact Storage Design"
description: Documentation for plans
---

# Artifact Storage Design

**Date**: 2026-01-10
**Status**: Draft
**Author**: Claude + Nathan

## Overview

A dirt-cheap artifact storage system for .md, .mdx, .html, .json, and compiled outputs (ESM, DTS, ASTs) using Cloudflare Snippets, Pipelines, and R2 Iceberg.

## Goals

1. **Cost-efficient**: Leverage free Snippets + cheap Pipelines ($0.015/M events)
2. **Queryable**: Store in Parquet/Iceberg for full-text and vector search
3. **CDN-ready**: Serve artifacts with tunable freshness (SWR pattern)
4. **Configurable**: Per-tenant knobs for latency vs cost tradeoff

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         WRITE PATH                                   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  POST /$.artifacts                                                   │
│  Content-Type: application/x-ndjson                                  │
│  X-Artifact-Mode: preview | build | bulk                             │
│  Body: {"ns":"app.do","type":"Page","id":"home",...}\n...            │
│                           │                                          │
│                           ▼                                          │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  Snippet: artifacts-ingest.ts (<32KB, <5ms CPU)             │    │
│  │                                                              │    │
│  │  1. Parse JSONL lines                                        │    │
│  │  2. Validate schema (ns, type, id required)                  │    │
│  │  3. Route by X-Artifact-Mode header                          │    │
│  │  4. Chunk into ≤1MB batches                                  │    │
│  │  5. POST each chunk to Pipeline HTTP endpoint                │    │
│  │  6. Return { accepted: N, chunks: M, pipeline: "build" }     │    │
│  └──────────────────────────┬──────────────────────────────────┘    │
│                              │                                       │
│              ┌───────────────┼───────────────┐                       │
│              ▼               ▼               ▼                       │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐                 │
│  │   Pipeline   │ │   Pipeline   │ │   Pipeline   │                 │
│  │   preview    │ │    build     │ │     bulk     │                 │
│  │   (5s buf)   │ │   (30s buf)  │ │  (120s buf)  │                 │
│  └──────┬───────┘ └──────┬───────┘ └──────┬───────┘                 │
│         └────────────────┼────────────────┘                         │
│                          ▼                                          │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  R2 Bucket: artifacts-lake                                   │    │
│  │                                                              │    │
│  │  /data/do_resources/                                         │    │
│  │    ns=app.do/                                                │    │
│  │      type=Page/                                              │    │
│  │        *.parquet (Iceberg format)                            │    │
│  │                                                              │    │
│  │  /metadata/                                                  │    │
│  │    metadata.json, manifest-list.avro, manifest-*.avro        │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                         READ PATH                                    │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  GET /$.content/{ns}/{type}/{id}.{ext}                               │
│  ?max_age=N | ?fresh=true                                            │
│                           │                                          │
│                           ▼                                          │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  Snippet: artifacts-serve.ts (<32KB, <5ms CPU)              │    │
│  │                                                              │    │
│  │  1. Parse path → ns, type, id, ext                           │    │
│  │  2. Determine TTL from ?max_age, header, or tenant config    │    │
│  │  3. Check Cache API (SWR pattern)                            │    │
│  │     ├── HIT + fresh → Return cached                          │    │
│  │     ├── HIT + stale → Return cached + async revalidate       │    │
│  │     └── MISS → Fetch from IcebergReader                      │    │
│  │  4. Set Cache-Control headers                                │    │
│  │  5. Return content with correct Content-Type                 │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                              │                                       │
│                              ▼                                       │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  IcebergReader (existing, 50-150ms)                          │    │
│  │                                                              │    │
│  │  reader.getRecord({                                          │    │
│  │    table: 'do_resources',                                    │    │
│  │    partition: { ns, type },                                  │    │
│  │    id                                                        │    │
│  │  })                                                          │    │
│  │  → Extract column: markdown | mdx | html | esm | ...         │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

## Data Schema

Using existing `do_resources` table from `db/iceberg/README.md`:

```sql
CREATE TABLE do_resources (
  -- Identity (required)
  ns STRING,              -- 'myapp.do', 'tenant.do'
  type STRING,            -- 'Page', 'Component', 'Function', 'API'
  id STRING,              -- 'home', 'Button', 'checkout'
  ts TIMESTAMP,           -- creation/update timestamp

  -- Source artifacts
  markdown STRING,        -- raw .md content
  mdx STRING,             -- raw .mdx content

  -- Compiled artifacts
  html STRING,            -- rendered HTML
  esm STRING,             -- compiled ES module
  dts STRING,             -- TypeScript declarations
  css STRING,             -- extracted/compiled CSS

  -- AST artifacts (JSON)
  mdast STRUCT<...>,      -- Markdown AST (remark)
  hast STRUCT<...>,       -- HTML AST (rehype)
  estree STRUCT<...>,     -- ECMAScript AST (acorn/esbuild)
  tsast STRUCT<...>,      -- TypeScript AST

  -- Metadata
  frontmatter STRUCT<...>,-- parsed frontmatter
  dependencies ARRAY<STRING>, -- import dependencies
  exports ARRAY<STRING>,  -- exported symbols
  hash STRING,            -- content hash for dedup
  size_bytes INT,         -- content size

  -- Visibility/access control
  visibility STRING,      -- 'public', 'private', 'internal'
)
PARTITIONED BY (ns, type)
```

## API Design

### POST /$.artifacts (Ingest)

```typescript
// Request
POST /$.artifacts
Content-Type: application/x-ndjson
X-Artifact-Mode: preview | build | bulk  // optional, default: build
Authorization: Bearer <token>

{"ns":"app.do","type":"Page","id":"home","markdown":"# Home\n...","html":"<h1>Home</h1>..."}
{"ns":"app.do","type":"Page","id":"about","markdown":"# About\n..."}
{"ns":"app.do","type":"Component","id":"Button","mdx":"export...","esm":"export...","dts":"..."}

// Response
{
  "accepted": 3,
  "chunks": 1,
  "pipeline": "build",
  "estimatedAvailableAt": "2026-01-10T12:00:30Z"  // now + buffer time
}
```

### GET /$.content/{ns}/{type}/{id}.{ext} (Serve)

```typescript
// Request
GET /$.content/app.do/Page/home.md
Cache-Control: max-age=60  // optional override

// Or with query params
GET /$.content/app.do/Page/home.html?max_age=10
GET /$.content/app.do/Page/home.html?fresh=true  // bypass cache

// Response
HTTP/1.1 200 OK
Content-Type: text/markdown; charset=utf-8
Cache-Control: public, max-age=300, stale-while-revalidate=60
ETag: "abc123"
X-Artifact-Source: cache | parquet
X-Artifact-Age: 45

# Home

Welcome to our app...
```

### Extension to Column Mapping

| Extension | Column | Content-Type |
|-----------|--------|--------------|
| `.md` | markdown | text/markdown |
| `.mdx` | mdx | text/mdx |
| `.html` | html | text/html |
| `.js`, `.mjs` | esm | application/javascript |
| `.d.ts` | dts | application/typescript |
| `.css` | css | text/css |
| `.json` | frontmatter | application/json |
| `.mdast.json` | mdast | application/json |
| `.hast.json` | hast | application/json |
| `.estree.json` | estree | application/json |

## Configuration

### Pipeline Configuration (wrangler.toml)

```toml
# Fast preview - live editing, instant feedback
[[pipelines]]
name = "artifacts-preview"
batch = { max_bytes = 102400, max_seconds = 5 }
destination = { type = "r2", bucket = "artifacts-lake", format = "parquet", table_format = "iceberg" }
partition_by = ["ns", "type"]

# Standard builds - most traffic
[[pipelines]]
name = "artifacts-build"
batch = { max_bytes = 1048576, max_seconds = 30 }
destination = { type = "r2", bucket = "artifacts-lake", format = "parquet", table_format = "iceberg" }
partition_by = ["ns", "type"]

# Bulk imports - migrations, large uploads
[[pipelines]]
name = "artifacts-bulk"
batch = { max_bytes = 5242880, max_seconds = 120 }
destination = { type = "r2", bucket = "artifacts-lake", format = "parquet", table_format = "iceberg" }
partition_by = ["ns", "type"]
```

### Tenant Configuration (KV or D1)

```typescript
interface TenantArtifactConfig {
  ns: string

  // Write-side: which pipelines can this tenant use?
  pipelines: {
    allowedModes: ('preview' | 'build' | 'bulk')[]
    defaultMode: 'build'
  }

  // Read-side: cache behavior
  cache: {
    defaultMaxAge: number      // default: 300 (5 min)
    defaultStaleWhileRevalidate: number  // default: 60
    minMaxAge: number          // floor to prevent abuse, default: 10
    allowFreshBypass: boolean  // allow ?fresh=true, default: true
  }

  // Rate limits
  limits: {
    maxArtifactsPerRequest: number   // default: 1000
    maxBytesPerRequest: number       // default: 10MB
    maxRequestsPerMinute: number     // default: 100
  }
}
```

## Cost Analysis

### Write Costs (per 1M artifacts/day)

| Component | Cost | Notes |
|-----------|------|-------|
| Pipeline ingestion | $0.015 | $0.015/M events |
| R2 Class A (writes) | $4.50 | $4.50/M operations |
| R2 Storage | ~$0.015/GB | Parquet is efficient |
| **Total writes** | **~$5/day** | **~$150/month** |

### Read Costs (per 100M requests/day)

| Component | Cache Rate | R2 Reads | Cost |
|-----------|------------|----------|------|
| max_age=300 (5m) | 95% | 5M/day | $1.80/day |
| max_age=60 (1m) | 80% | 20M/day | $7.20/day |
| max_age=10 (10s) | 50% | 50M/day | $18/day |

### Total Monthly (Typical: 1M writes, 100M reads, 80% cache)

| Component | Monthly |
|-----------|---------|
| Pipeline | $0.50 |
| R2 Writes | $135 |
| R2 Reads | $216 |
| R2 Storage (100GB) | $1.50 |
| **Total** | **~$350/month** |

## Implementation Plan

### Phase 1: RED (Failing Tests)

Write comprehensive tests before implementation:

1. **Ingest Snippet Tests** (`snippets/tests/artifacts-ingest.test.ts`)
   - JSONL parsing and validation
   - Schema validation (ns, type, id required)
   - Chunking logic (≤1MB batches)
   - Pipeline routing by mode
   - Error handling (malformed JSON, missing fields)
   - Rate limiting behavior

2. **Serve Snippet Tests** (`snippets/tests/artifacts-serve.test.ts`)
   - Path parsing ({ns}/{type}/{id}.{ext})
   - Extension to column mapping
   - Cache-Control header generation
   - SWR behavior (stale, fresh, revalidate)
   - ?max_age and ?fresh query params
   - Content-Type mapping
   - 404 handling

3. **Integration Tests** (`snippets/tests/artifacts-integration.test.ts`)
   - End-to-end: POST → Pipeline mock → GET
   - Cache invalidation on update
   - Multi-tenant isolation
   - Large file chunking

### Phase 2: GREEN (Implementation)

Implement to make tests pass:

1. **Ingest Snippet** (`snippets/artifacts-ingest.ts`)
   - JSONL stream parser
   - Schema validator
   - Chunk builder
   - Pipeline HTTP client
   - Response formatter

2. **Serve Snippet** (`snippets/artifacts-serve.ts`)
   - Path parser
   - Cache layer (Cache API)
   - IcebergReader integration
   - Content-Type resolver
   - SWR logic

3. **Config Loader** (`snippets/artifacts-config.ts`)
   - Tenant config from KV
   - Default fallbacks
   - Config validation

### Phase 3: REFACTOR

Optimize after tests pass:

1. **Performance**
   - Streaming JSONL parser (no full buffer)
   - Parallel chunk uploads
   - Connection pooling for Pipeline HTTP

2. **Observability**
   - Timing metrics (ingest latency, cache hit rate)
   - Error tracking
   - Cost attribution by tenant

3. **Edge Cases**
   - Retry logic for failed chunks
   - Partial success handling
   - Graceful degradation

## File Structure

```
snippets/
  artifacts-ingest.ts      # POST handler
  artifacts-serve.ts       # GET handler
  artifacts-config.ts      # Config loader
  tests/
    artifacts-ingest.test.ts
    artifacts-serve.test.ts
    artifacts-integration.test.ts

streaming/
  pipelines/
    artifacts-preview.ts   # Pipeline config
    artifacts-build.ts
    artifacts-bulk.ts
```

## Dependencies

### Existing (already implemented)
- `db/iceberg/reader.ts` - IcebergReader for Parquet access
- `db/iceberg/search-manifest.ts` - Search manifest loading
- `snippets/search.ts` - Search snippet infrastructure

### New (to implement)
- Pipeline HTTP endpoint integration
- Tenant config schema and loader
- Cache API wrapper with SWR

## Security Considerations

1. **Authentication**: Bearer token required for POST
2. **Authorization**: Tenant can only write to their namespace
3. **Validation**: Strict schema validation, reject malformed input
4. **Rate Limiting**: Per-tenant limits on requests and bytes
5. **Content Sanitization**: No executable content in artifacts (CSP headers)

## Open Questions

1. **Versioning**: Should we support multiple versions per artifact? (e.g., `home@v1.md`)
2. **Compression**: Should ingest accept gzip-compressed JSONL?
3. **Webhooks**: Notify on artifact availability? (after Pipeline flush)
4. **Batch GET**: Support multi-artifact fetch in single request?

## References

- [Cloudflare Pipelines Docs](https://developers.cloudflare.com/pipelines/)
- [R2 Data Catalog](https://developers.cloudflare.com/r2/data-catalog/)
- [Iceberg REST Catalog Spec](https://iceberg.apache.org/spec/#iceberg-rest-catalog)
- `db/iceberg/README.md` - Existing Iceberg implementation
- `streaming/README.md` - Existing Pipeline integration
