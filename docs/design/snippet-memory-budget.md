# Snippet Memory Budget Analysis

**Author:** dotdo Architecture Team
**Date:** 2026-01-10
**Issue:** dotdo-dqlhw

## Executive Summary

Cloudflare Snippets provide 2MB of memory for lightweight edge operations. This document analyzes exactly what index sizes fit within this constraint across four index types: Bloom Filters, Marks/Zonemaps, Vector Centroids, and Inverted Indexes.

**Key Findings:**

| Index Type | Max Capacity in 1MB | Use Case |
|------------|---------------------|----------|
| Bloom Filter (1% FPR) | 872,000 items | Membership testing |
| Marks/Zonemap | 65,536 blocks | Range pruning |
| Vector Centroids (384d) | 655 centroids | Coarse ANN search |
| Inverted Index | ~25,000 terms | Full-text routing |

## Snippet Constraints

From [Cloudflare Snippets documentation](https://developers.cloudflare.com/rules/snippets/):

| Resource | Limit | Notes |
|----------|-------|-------|
| **Memory** | 2 MB | Total heap + allocations |
| **CPU time** | 5 ms | Wall clock execution |
| **Package size** | 32 KB | Compressed JS bundle |
| **Subrequests** | 2-5 | Depends on plan |

**Memory Budget Strategy:**

```
Total Available:           2,048 KB (2 MB)

Reserved:
  V8 baseline overhead:      ~200 KB
  Code + closures:           ~100 KB
  Request/Response buffers:  ~100 KB
  Safety margin:             ~150 KB
  ─────────────────────────────────
  Subtotal reserved:         ~550 KB

Available for indexes:    ~1,500 KB (~1.5 MB)
```

## Index Type 1: Bloom Filters

### Theory

Bloom filters provide probabilistic membership testing. The optimal size formula:

```
bits = -n × ln(fpr) / (ln(2)²)
     = -n × ln(fpr) / 0.4805
```

Where:
- `n` = number of items
- `fpr` = false positive rate (e.g., 0.01 for 1%)

At 1% FPR: **~9.58 bits per item**

### Capacity Calculations

| FPR | Bits/Item | Items in 100KB | Items in 500KB | Items in 1MB |
|-----|-----------|----------------|----------------|--------------|
| 10% | 4.79 | 167,014 | 835,073 | 1,750,218 |
| 5% | 6.24 | 128,205 | 641,025 | 1,342,177 |
| **1%** | **9.58** | **83,507** | **417,537** | **872,180** |
| 0.1% | 14.38 | 55,632 | 278,164 | 582,542 |
| 0.01% | 19.17 | 41,732 | 208,663 | 436,906 |

**Formula derivation:**
```typescript
function bloomFilterCapacity(memoryBytes: number, fpr: number): number {
  const bits = memoryBytes * 8
  const bitsPerItem = -Math.log(fpr) / (Math.LN2 * Math.LN2)
  return Math.floor(bits / bitsPerItem)
}

// Example: 1MB at 1% FPR
bloomFilterCapacity(1024 * 1024, 0.01) // → 872,180 items
```

### Practical Considerations

**Optimal hash count:**
```
k = (m/n) × ln(2) ≈ 0.693 × (bits/items)
```

For 1% FPR: k ≈ 7 hash functions

**Memory layout (1MB allocation):**
```
┌─────────────────────────────────────────────────────┐
│ Bit array: 1,048,576 bytes = 8,388,608 bits         │
│ Items at 1% FPR: 872,180                            │
│ Hash functions: 7 (computed, not stored)            │
└─────────────────────────────────────────────────────┘
```

### Snippet Use Cases

- **Route caching decisions**: Is this URL in the "always cache" set?
- **Auth bypass lists**: Is this IP in the allow list?
- **Feature flags**: Is this user in the beta cohort?

```typescript
// Snippet example: Fast membership check
const BLOOM_FILTER = new Uint8Array(/* 100KB pre-computed */)
const HASH_SEEDS = [0x9e3779b9, 0x85ebca6b, /* 5 more */]

function mightContain(key: string): boolean {
  for (const seed of HASH_SEEDS) {
    const hash = murmur3(key, seed)
    const bit = hash % (BLOOM_FILTER.length * 8)
    if (!(BLOOM_FILTER[bit >> 3] & (1 << (bit & 7)))) {
      return false // Definitely not in set
    }
  }
  return true // Probably in set
}
```

---

## Index Type 2: Marks/Zonemaps

### Theory

Zonemaps store min/max statistics per block for predicate pushdown. Each block requires:

```
Per-block storage = min_value + max_value
                  = 8 bytes + 8 bytes = 16 bytes (for 64-bit values)
```

This enables skipping entire blocks during range scans.

### Capacity Calculations

| Block Size | Bytes/Block | Blocks in 100KB | Blocks in 500KB | Blocks in 1MB |
|------------|-------------|-----------------|-----------------|---------------|
| Min+Max only | 16 | 6,400 | 32,000 | 65,536 |
| +null bitmap | 17 | 6,023 | 30,117 | 63,105 |
| +count | 20 | 5,120 | 25,600 | 53,687 |
| +sum (for AVG) | 28 | 3,657 | 18,285 | 38,347 |
| Full stats | 40 | 2,560 | 12,800 | 26,843 |

**Extended zone metadata structure:**
```
struct ZoneMeta {
  min: int64       // 8 bytes
  max: int64       // 8 bytes
  count: uint32    // 4 bytes (rows in block)
  null_count: uint32 // 4 bytes
  sum: int64       // 8 bytes (for AVG pushdown)
  // Total: 32 bytes
}
```

### Coverage Analysis

If each block covers N rows, and you have B blocks:

| Rows/Block | Blocks in 100KB | Total Rows Covered |
|------------|-----------------|-------------------|
| 100 | 6,400 | 640,000 |
| 1,000 | 6,400 | 6,400,000 |
| 10,000 | 6,400 | 64,000,000 |
| 100,000 | 6,400 | 640,000,000 |

**Recommendation:** With 1,000-10,000 rows per block, 100KB of zonemap can cover 6M-64M rows.

### Snippet Use Cases

- **Time-range routing**: Route requests to appropriate time partition
- **ID-range sharding**: Determine which shard handles an ID
- **Price-tier filtering**: Quick elimination of irrelevant product categories

```typescript
// Snippet example: Time-range routing
interface ZoneMap {
  blocks: Array<{ min: number; max: number; partition: string }>
}

function findPartition(timestamp: number, zonemap: ZoneMap): string[] {
  return zonemap.blocks
    .filter(b => timestamp >= b.min && timestamp <= b.max)
    .map(b => b.partition)
}
```

---

## Index Type 3: Vector Centroids

### Theory

IVF (Inverted File Index) centroids for approximate nearest neighbor search:

```
centroid_bytes = count × dimensions × sizeof(float32)
               = count × dims × 4
```

### Capacity Calculations

| Dimensions | Bytes/Centroid | Centroids in 100KB | Centroids in 500KB | Centroids in 1MB |
|------------|----------------|--------------------|--------------------|------------------|
| 64 | 256 | 400 | 2,000 | 4,096 |
| 128 | 512 | 200 | 1,000 | 2,048 |
| 256 | 1,024 | 100 | 500 | 1,024 |
| **384** | **1,536** | **66** | **333** | **682** |
| 512 | 2,048 | 50 | 250 | 512 |
| 768 | 3,072 | 33 | 166 | 341 |
| 1024 | 4,096 | 25 | 125 | 256 |
| 1536 | 6,144 | 16 | 83 | 170 |

**With FP16 (half precision):**

| Dimensions | Bytes/Centroid (FP16) | Centroids in 1MB |
|------------|----------------------|------------------|
| 384 | 768 | 1,365 |
| 768 | 1,536 | 682 |
| 1536 | 3,072 | 341 |

### Effective Coverage

Typical IVF design: `nlist = sqrt(n)` where n = total vectors

| Total Vectors | Optimal nlist | Min Dims at FP32/1MB | Recommendation |
|---------------|---------------|----------------------|----------------|
| 10,000 | 100 | Any | Fits easily |
| 100,000 | 316 | 384+ | Fits at 384d |
| 1,000,000 | 1,000 | ≤1024d | Needs FP16 for 1536d |
| 10,000,000 | 3,162 | Split index | Hierarchical needed |

### Memory Layout Example (384d, 500 centroids)

```
┌─────────────────────────────────────────────────────┐
│ Header: 32 bytes                                    │
│   magic: uint32 (CENT)                              │
│   count: uint32 (500)                               │
│   dims: uint32 (384)                                │
│   dtype: uint8 (0 = fp32)                           │
│   reserved: 19 bytes                                │
├─────────────────────────────────────────────────────┤
│ Centroids: 500 × 384 × 4 = 768,000 bytes (750 KB)   │
├─────────────────────────────────────────────────────┤
│ Metadata (optional): 500 × 8 = 4,000 bytes          │
│   Per centroid: vector_count (4B) + avg_dist (4B)   │
└─────────────────────────────────────────────────────┘
Total: ~754 KB
```

### Snippet Use Cases

- **Semantic routing**: Route query to appropriate index partition
- **Cluster assignment**: Assign new vectors to clusters
- **Coarse search**: Find candidate clusters before R2 lookup

```typescript
// Snippet example: Semantic routing
function findNearestClusters(
  query: Float32Array,
  centroids: Float32Array,
  dims: number,
  topK: number
): number[] {
  const nCentroids = centroids.length / dims
  const distances: Array<{ idx: number; dist: number }> = []

  for (let i = 0; i < nCentroids; i++) {
    const offset = i * dims
    let dot = 0
    for (let d = 0; d < dims; d++) {
      dot += query[d] * centroids[offset + d]
    }
    distances.push({ idx: i, dist: 1 - dot }) // Cosine distance
  }

  distances.sort((a, b) => a.dist - b.dist)
  return distances.slice(0, topK).map(d => d.idx)
}
```

---

## Index Type 4: Inverted Index

### Theory

Inverted indexes map terms to posting lists (document IDs):

```
Per-term storage:
  term: variable (avg 10 bytes)
  term_length: 1 byte (for length-prefixed)
  posting_count: 4 bytes
  posting_list_offset: 4 bytes
  ─────────────────────────
  ~19 bytes per term (vocabulary only)

Per-posting:
  doc_id: 4 bytes
  term_frequency: 2 bytes (optional)
  position: 4 bytes (optional)
  ─────────────────────────
  4-10 bytes per posting
```

### Capacity Calculations

**Vocabulary-only (term → offset mapping):**

| Avg Term Length | Bytes/Term | Terms in 100KB | Terms in 500KB | Terms in 1MB |
|-----------------|------------|----------------|----------------|--------------|
| 6 | 15 | 6,826 | 34,133 | 71,582 |
| 8 | 17 | 6,023 | 30,117 | 63,105 |
| **10** | **19** | **5,389** | **26,947** | **56,483** |
| 12 | 21 | 4,876 | 24,380 | 51,100 |
| 15 | 24 | 4,266 | 21,333 | 44,739 |

**Full inverted index (vocabulary + postings):**

Assuming average posting list length of 100 documents:

| Component | Size per Term | 500KB Budget |
|-----------|---------------|--------------|
| Term (avg 10 bytes) | 10 | - |
| Metadata | 9 | - |
| Postings (100 × 4B) | 400 | - |
| **Total** | **419 bytes** | **~1,200 terms** |

**With variable-byte encoding for doc IDs:**

| Encoding | Bytes/Posting | Postings in 500KB (after vocab) |
|----------|---------------|--------------------------------|
| Fixed 4B | 4 | ~100,000 |
| VarInt | 1-2 avg | ~250,000 |
| Delta+VarInt | 0.5-1 avg | ~400,000 |

### Practical Index Configurations

**Configuration A: Large Vocabulary, Small Postings (routing)**
```
Budget: 500KB
Vocabulary: 400KB → ~21,000 terms
Postings: 100KB → ~25,000 entries (1.2 postings/term avg)
Use case: Route queries to appropriate index shard
```

**Configuration B: Small Vocabulary, Large Postings (filtering)**
```
Budget: 500KB
Vocabulary: 50KB → ~2,600 terms
Postings: 450KB → ~112,500 entries (43 postings/term avg)
Use case: Filter requests by known categories
```

**Configuration C: Prefix Trie (autocomplete)**
```
Budget: 500KB
Trie nodes: ~15,000 (assuming 35 bytes/node)
Completions stored: ~15,000 terms
Use case: Suggest completions for search prefixes
```

### Memory Layout Example (Configuration A)

```
┌─────────────────────────────────────────────────────┐
│ Header: 32 bytes                                    │
│   magic: uint32 (INVT)                              │
│   term_count: uint32 (21000)                        │
│   posting_count: uint32 (25000)                     │
│   reserved: 20 bytes                                │
├─────────────────────────────────────────────────────┤
│ Term Offset Table: 21000 × 4 = 84,000 bytes         │
│   term_offset[i] → position in term_data            │
├─────────────────────────────────────────────────────┤
│ Term Data: ~230KB (length-prefixed strings)         │
│   [len:1][chars:10][posting_offset:4][posting_len:2]│
├─────────────────────────────────────────────────────┤
│ Posting Lists: ~100KB                               │
│   [doc_id:4]... (variable length per term)          │
└─────────────────────────────────────────────────────┘
Total: ~430KB
```

### Snippet Use Cases

- **Query routing**: Route search queries to relevant shards
- **Category lookup**: Map product categories to backend services
- **Stopword filtering**: Quick check for terms to ignore

```typescript
// Snippet example: Term-based routing
interface TermIndex {
  terms: Map<string, number[]> // term → shard IDs
}

function findShards(query: string, index: TermIndex): Set<number> {
  const tokens = query.toLowerCase().split(/\s+/)
  const shards = new Set<number>()

  for (const token of tokens) {
    const termShards = index.terms.get(token)
    if (termShards) {
      termShards.forEach(s => shards.add(s))
    }
  }

  return shards
}
```

---

## Memory Budget Allocation Strategy

### Single-Index Snippet (Simple)

```
Total: 2,048 KB

Reserved:
  Runtime overhead:     550 KB

Available:            1,498 KB (~1.5 MB)

Allocation:
  Primary index:      1,200 KB
  Working buffers:      200 KB
  Response building:    ~98 KB
```

### Multi-Index Snippet (Advanced)

```
Total: 2,048 KB

Reserved:
  Runtime overhead:     550 KB

Available:            1,498 KB

Allocation:
  Bloom filter:         100 KB (83K items @ 1% FPR)
  Zonemap:              100 KB (6K blocks)
  Centroids (384d):     400 KB (260 centroids)
  Inverted vocab:       300 KB (15K terms)
  ─────────────────────────────
  Indexes total:        900 KB

  Working buffers:      400 KB
  Response building:    198 KB
```

### Decision Matrix

| Use Case | Recommended Index | Memory Allocation |
|----------|-------------------|-------------------|
| URL membership | Bloom filter | 100-500KB |
| Time-range routing | Zonemap | 50-100KB |
| Semantic routing | Centroids | 500KB-1MB |
| Query routing | Inverted index | 300-500KB |
| Multi-purpose | Hybrid | Split per above |

---

## Partitioning Recommendations

When data exceeds single-snippet capacity:

### Bloom Filter Partitioning

```
Strategy: Hash-based sharding
Partition key: hash(item) % num_partitions

Example: 10M items @ 1% FPR
  Single filter: 11.5 MB (too large)
  Partitioned: 12 snippets × 833K items × 1MB each

Routing: hash(item) % 12 → snippet_id
```

### Zonemap Partitioning

```
Strategy: Range-based sharding
Partition key: value range

Example: 100M rows, 100K rows/block = 1M blocks
  Single zonemap: 16 MB (too large)
  Partitioned: 16 snippets × 65K blocks × 1MB each

Routing: floor(min_value / range_size) → snippet_id
```

### Centroid Partitioning

```
Strategy: Hierarchical IVF
Level 1: Coarse clusters (fits in snippet)
Level 2: Fine clusters (in R2/Workers)

Example: 10M vectors, 3162 optimal clusters
  Single index: 4.6 MB @ 1536d (too large)
  Strategy:
    - 100 super-clusters in snippet (600KB @ 1536d FP16)
    - 3162 fine clusters in Workers

Routing: Find top-5 super-clusters → fetch fine clusters from R2
```

### Inverted Index Partitioning

```
Strategy: Term hash sharding + vertical partitioning
Vocab shards: hash(term) % N for vocabulary lookups
Posting shards: Separate posting lists to R2

Example: 1M vocabulary, 100M postings
  Vocabulary only: 19 MB (too large)
  Partitioned:
    - 20 vocabulary snippets × 50K terms × ~1MB
    - Posting lists in R2 with offset pointers

Routing: hash(term) % 20 → vocab snippet → posting offset → R2
```

---

## Implementation Guidelines

### 1. Pre-computation is Key

```typescript
// BAD: Computing at runtime
const bloomFilter = new BloomFilter(items) // Allocates in snippet

// GOOD: Pre-computed binary blob
const BLOOM_FILTER_BLOB = await fetch('/static/bloom.bin')
const bloomBits = new Uint8Array(await BLOOM_FILTER_BLOB.arrayBuffer())
```

### 2. Use TypedArrays

```typescript
// BAD: Object overhead
const centroids = items.map(i => ({ values: [...] }))

// GOOD: Flat TypedArray
const centroids = new Float32Array(count * dims)
```

### 3. Lazy Loading

```typescript
// Load index only when needed
let cachedIndex: Uint8Array | null = null

async function getIndex(): Promise<Uint8Array> {
  if (!cachedIndex) {
    const resp = await fetch('/static/index.bin')
    cachedIndex = new Uint8Array(await resp.arrayBuffer())
  }
  return cachedIndex
}
```

### 4. Binary Search over Hash Maps

```typescript
// For sorted data, binary search is more memory-efficient
function binarySearch(sortedArray: Uint32Array, target: number): number {
  let lo = 0, hi = sortedArray.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1
    if (sortedArray[mid] < target) lo = mid + 1
    else if (sortedArray[mid] > target) hi = mid - 1
    else return mid
  }
  return -1
}
```

---

## Summary Tables

### Maximum Capacities (1MB allocation)

| Index Type | Formula | Max Items/Entries |
|------------|---------|-------------------|
| Bloom (1% FPR) | `8M bits / 9.58` | 872,180 items |
| Zonemap (16B) | `1M / 16` | 65,536 blocks |
| Centroids (384d FP32) | `1M / 1536` | 682 centroids |
| Centroids (384d FP16) | `1M / 768` | 1,365 centroids |
| Inverted (vocab only) | `1M / 19` | 56,483 terms |
| Inverted (+ postings) | varies | ~5K terms + 100K postings |

### Quick Reference Formulas

```typescript
// Bloom filter capacity
const bloomCapacity = (bytes: number, fpr: number) =>
  Math.floor((bytes * 8) / (-Math.log(fpr) / (Math.LN2 ** 2)))

// Zonemap capacity
const zonemapCapacity = (bytes: number, metaSize = 16) =>
  Math.floor(bytes / metaSize)

// Centroid capacity
const centroidCapacity = (bytes: number, dims: number, fp16 = false) =>
  Math.floor(bytes / (dims * (fp16 ? 2 : 4)))

// Inverted index vocabulary capacity
const vocabCapacity = (bytes: number, avgTermLen = 10) =>
  Math.floor(bytes / (avgTermLen + 9))
```

---

## References

- [Cloudflare Snippets Documentation](https://developers.cloudflare.com/rules/snippets/)
- [Cloudflare Snippets Announcement](https://blog.cloudflare.com/snippets-announcement/)
- [Cloudflare Workers Limits](https://developers.cloudflare.com/workers/platform/limits/)
- [Bloom Filter Mathematics](https://en.wikipedia.org/wiki/Bloom_filter)
- [IVF Index Design](https://www.pinecone.io/learn/series/faiss/ivf/)
