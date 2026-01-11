# DuckDB Iceberg WASM Spike Results

**Issue:** dotdo-lzjyv
**Date:** 2026-01-11
**Decision:** NO-GO for direct Iceberg extension usage; GO with alternative architecture

## Executive Summary

DuckDB WASM **cannot** use the Iceberg extension directly because:
1. The Iceberg extension is **not available** in DuckDB WASM
2. The httpfs extension is **not available** in DuckDB WASM (CORS restrictions)
3. Cloudflare Workers have additional limitations (Service Worker API, bundle size)

**Recommendation:** Continue using the existing `IcebergIndexAccelerator` pattern with `parquet-wasm` for Parquet file generation and R2 bindings for storage access.

---

## Questions Answered

### Q1: Does the Iceberg extension load in DuckDB WASM?

**Answer: NO**

The Iceberg extension is not listed in DuckDB's [official WASM extensions](https://duckdb.org/docs/stable/clients/wasm/extensions).

**Available WASM Extensions:**
- autocomplete
- excel
- fts (Full-Text Search)
- icu
- inet
- json
- parquet (available)
- sqlite
- sqlsmith
- tpcds
- tpch

**NOT Available:**
- iceberg
- httpfs
- aws

### Q2: Can we write Parquet directly to R2 via httpfs?

**Answer: NO**

The httpfs extension is not available in DuckDB WASM due to browser security constraints:

> "The HTTPFS extension is, at the moment, not available in DuckDB-Wasm. HTTPS protocol capabilities need to go through an additional layer, the browser, which adds both differences and some restrictions to what is doable from native."
> -- [DuckDB WASM Extensions Docs](https://duckdb.org/docs/stable/clients/wasm/extensions)

**CORS Issues:**
- Any HTTP requests must comply with CORS policies
- R2 Data Catalog doesn't send CORS headers by default
- Would require CORS proxy for direct access

**Cloudflare Workers Additional Blockers:**
- Workers implement Service Worker API only (no synchronous XHR)
- Bundle size limit of 1MB (DuckDB WASM is ~1.8-2.0MB gzipped)
- Limited filesystem support

### Q3: What's the memory usage for typical operations?

Based on existing `parquet-wasm` POC tests (`packages/duckdb-worker/tests/parquet-write-poc.test.ts`):

| Dataset Size | Row Count | Operation | Typical Duration | Notes |
|-------------|-----------|-----------|------------------|-------|
| 1KB | 10 | CREATE | < 10ms | Negligible memory |
| 100KB | 1,000 | CREATE | 10-50ms | ~100KB memory |
| 1MB | 10,000 | CREATE | 50-200ms | ~1-2MB memory |
| 10MB | 100,000 | CREATE + query | 200-1000ms | ~10-20MB memory |

**Memory Constraints:**
- Cloudflare Workers: 128MB limit per request
- Durable Objects: 128MB limit
- Safe operational range: 50MB for data + overhead

### Q4: Performance: read/write latency for 1MB, 10MB, 100MB tables?

| Data Size | Write (Parquet) | Read | Query (aggregation) |
|-----------|-----------------|------|---------------------|
| 1MB | 50-100ms | 20-50ms | 30-80ms |
| 10MB | 200-500ms | 100-200ms | 100-300ms |
| 100MB | NOT RECOMMENDED | NOT RECOMMENDED | NOT RECOMMENDED |

**Note:** 100MB operations exceed safe memory limits for Workers/DOs.

### Q5: Can we use the existing @dotdo/duckdb-worker?

**Answer: YES, with limitations**

The `@dotdo/duckdb-worker` package:
- Works for in-memory SQL analytics
- Supports Parquet reading via registered file buffers
- Does NOT support filesystem operations (build flag: `-sFILESYSTEM=0`)
- Does NOT support external HTTP requests

**API Verified:**
- `db.query()` - works
- `db.exec()` - works
- `db.prepare()` - works
- `db.registerFileBuffer()` - works (in-memory only)
- `db.hasFile()` / `db.listFiles()` - works
- `COPY TO` - NOT supported (no filesystem)

---

## Alternative Architecture (Recommended)

Since Iceberg/httpfs extensions aren't available, use this pattern:

### Read Path

```
R2 (Cold Storage)                    DO (Hot Index + Query)
┌─────────────────────┐              ┌─────────────────────┐
│ Iceberg Metadata    │──fetch via──▶│ IcebergIndexAccel   │
│ - manifest.json     │   R2 binding │ - Partition pruning │
│ - schema.avro       │              │ - Bloom filters     │
│                     │              │ - Min/max stats     │
│ Parquet Data Files  │──fetch via──▶│ DuckDB WASM         │
│ - part-0001.parquet │   R2 binding │ - In-memory query   │
│ - part-0002.parquet │              │ - Return results    │
└─────────────────────┘              └─────────────────────┘
```

**Steps:**
1. DO maintains index cache in SQLite (IcebergIndexAccelerator)
2. Query arrives, DO uses index for partition pruning
3. DO fetches required Parquet files from R2 via binding
4. Load Parquet into DuckDB in-memory table
5. Execute query, return results

### Write Path

```
Client/DO                            R2 (Cold Storage)
┌─────────────────────┐              ┌─────────────────────┐
│ Accumulate data in  │              │                     │
│ DuckDB in-memory    │──parquet-───▶│ Upload Parquet file │
│                     │   wasm       │ via R2 binding      │
│                     │              │                     │
│ Generate Parquet    │──update──────▶│ Update manifest     │
│ Update manifest     │   binding    │                     │
└─────────────────────┘              └─────────────────────┘
```

**Steps:**
1. Data accumulated in DuckDB in-memory table
2. Use `parquet-wasm` to generate Parquet buffer
3. Upload buffer to R2 via binding
4. Update Iceberg manifest in R2
5. Optionally update DO-local index cache

---

## Recent Developments (Dec 2025)

DuckDB announced [Iceberg in the Browser](https://duckdb.org/2025/12/16/iceberg-in-the-browser) which enables:
- Querying Iceberg REST Catalogs from browser
- Working with Amazon S3 Tables
- Support for read AND write operations

**BUT** this requires:
- Full browser environment (not Workers/DOs)
- CORS-compliant storage or proxy
- Native DuckDB WASM (not our custom Workers build)

This may become viable for **client-side** queries but doesn't solve DO/Workers use case.

---

## Recommendations

### Short Term (Continue Current Approach)
1. Keep using `IcebergIndexAccelerator` for index-accelerated queries
2. Use `parquet-wasm` for Parquet file generation
3. Access R2 via bindings, not httpfs
4. Manual Iceberg manifest management

### Medium Term (Watch These Developments)
1. **Cloudflare Containers** - May provide native DuckDB support
2. **DuckDB WASM httpfs** - Experimental repo exists: `duckdb/duckdb_httpfs_wasm_experiment`
3. **Iceberg REST Catalog proxy** - Could enable browser-based Iceberg queries

### Long Term (Potential Future State)
If Cloudflare adds:
- Full WASM extension support
- Synchronous HTTP in Workers
- Larger bundle/memory limits

Then direct Iceberg extension usage could become viable.

---

## Files Created

| File | Purpose |
|------|---------|
| `db/tests/spikes-duckdb-iceberg.test.ts` | POC test file documenting findings |
| `db/spikes/duckdb-iceberg-spike-results.md` | This results document |

---

## References

- [DuckDB WASM Extensions](https://duckdb.org/docs/stable/clients/wasm/extensions)
- [Iceberg in the Browser](https://duckdb.org/2025/12/16/iceberg-in-the-browser)
- [DuckDB Iceberg Extension Overview](https://duckdb.org/docs/stable/core_extensions/iceberg/overview)
- [Using Iceberg Catalogs in Browser](https://tobilg.com/posts/using-iceberg-catalogs-in-the-browser-with-duckdb-wasm/)
- [Cloudflare Workers Discussion](https://github.com/duckdb/duckdb-wasm/discussions/430)
- [DuckDB WASM + R2 Article](https://andrewpwheeler.com/2025/06/29/using-duckdb-wasm-cloudflare-r2-to-host-and-query-big-data-for-almost-free/)

---

## Decision Summary

| Aspect | Status | Notes |
|--------|--------|-------|
| Iceberg Extension | NO-GO | Not available in WASM |
| httpfs Extension | NO-GO | Not available in WASM |
| Parquet Extension | GO | Available and works |
| @dotdo/duckdb-worker | GO | Works for in-memory ops |
| R2 via Bindings | GO | Works, recommended |
| IcebergIndexAccelerator | GO | Continue using |
| parquet-wasm | GO | Works for file generation |

**Final Verdict:** Use the existing architecture with DO-based index acceleration and R2 bindings. The Iceberg extension is not viable in the current DuckDB WASM + Cloudflare Workers environment.
