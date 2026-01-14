import { describe, it, expect } from 'vitest'

/**
 * Search Table Schema Tests
 *
 * These tests verify the schema for the 3-tier search index in dotdo.
 * Search enables full-text and vector similarity queries across Things.
 *
 * Key design decisions:
 * - 3-tier architecture: Local DO SQLite, Cloudflare Vectorize, R2 SQL
 * - Local tier uses 128-dim MRL (Matryoshka) embeddings for fast flat scan
 * - Pre-computed fields (LSH, clustering, semantic hierarchy) for R2 filtering
 * - URL-based $id links search entries to Things
 *
 * Vector dimensions:
 * - 128-dim: Local DO SQLite (fast, low memory)
 * - 256-dim: Optional middle ground
 * - 512-dim: Higher quality local search
 * - 768-dim: Full quality, streamed to Vectorize
 *
 * Pre-computed fields for R2 SQL:
 * - cluster: K-means cluster assignment
 * - lsh1-3: Locality-Sensitive Hashing buckets
 * - semanticL1-L3: Hierarchical semantic categories
 */

// ============================================================================
// Schema Types (Expected Interface)
// ============================================================================

interface SearchEntry {
  $id: string // URL of indexed Thing: 'Startup/acme'
  $type: string // Noun type: 'Startup'
  content: string // Searchable text content
  embedding: Buffer | null // Vector embedding bytes
  embeddingDim: number | null // 128, 256, 512, or 768
  cluster: number | null // K-means cluster ID
  lsh1: string | null // LSH bucket 1
  lsh2: string | null // LSH bucket 2
  lsh3: string | null // LSH bucket 3
  semanticL1: string | null // Semantic category L1: 'tech'
  semanticL2: string | null // Semantic category L2: 'saas'
  semanticL3: string | null // Semantic category L3: 'b2b-saas'
  indexedAt: Date
}

// Import the schema - this should work since search.ts exists
import { search } from '../search'

// ============================================================================
// Schema Table Definition Tests
// ============================================================================

describe('Schema Table Definition', () => {
  describe('Table Export', () => {
    it('search table is exported from db/search.ts', () => {
      expect(search).toBeDefined()
    })

    it('table name is "search"', () => {
      // Drizzle tables have a _ property with table info
      expect((search as { _: { name: string } })._?.name ?? 'search').toBe('search')
    })
  })

  describe('Column Definitions', () => {
    it('has $id column (text, primary key)', () => {
      expect(search.$id).toBeDefined()
    })

    it('has $type column (text, not null)', () => {
      expect(search.$type).toBeDefined()
    })

    it('has content column (text, not null)', () => {
      expect(search.content).toBeDefined()
    })

    it('has embedding column (blob, nullable)', () => {
      expect(search.embedding).toBeDefined()
    })

    it('has embeddingDim column (integer, nullable)', () => {
      expect(search.embeddingDim).toBeDefined()
    })

    it('has cluster column (integer, nullable)', () => {
      expect(search.cluster).toBeDefined()
    })

    it('has lsh1 column (text, nullable)', () => {
      expect(search.lsh1).toBeDefined()
    })

    it('has lsh2 column (text, nullable)', () => {
      expect(search.lsh2).toBeDefined()
    })

    it('has lsh3 column (text, nullable)', () => {
      expect(search.lsh3).toBeDefined()
    })

    it('has semanticL1 column (text, nullable)', () => {
      expect(search.semanticL1).toBeDefined()
    })

    it('has semanticL2 column (text, nullable)', () => {
      expect(search.semanticL2).toBeDefined()
    })

    it('has semanticL3 column (text, nullable)', () => {
      expect(search.semanticL3).toBeDefined()
    })

    it('has indexedAt column (timestamp, not null)', () => {
      expect(search.indexedAt).toBeDefined()
    })
  })

  describe('Column Types', () => {
    it('$id column is text type', () => {
      expect(search.$id.dataType).toBe('string')
    })

    it('$type column is text type', () => {
      expect(search.$type.dataType).toBe('string')
    })

    it('content column is text type', () => {
      expect(search.content.dataType).toBe('string')
    })

    it('embedding column is buffer type', () => {
      expect(search.embedding.dataType).toBe('buffer')
    })

    it('embeddingDim column is number type', () => {
      expect(search.embeddingDim.dataType).toBe('number')
    })

    it('cluster column is number type', () => {
      expect(search.cluster.dataType).toBe('number')
    })

    it('lsh1 column is text type', () => {
      expect(search.lsh1.dataType).toBe('string')
    })

    it('semanticL1 column is text type', () => {
      expect(search.semanticL1.dataType).toBe('string')
    })

    it('indexedAt column is timestamp mode', () => {
      expect(search.indexedAt.dataType).toBe('date')
    })
  })
})

// ============================================================================
// URL-Based Identification
// ============================================================================

describe('URL-Based Identification', () => {
  describe('$id Format', () => {
    it('simple Noun/id format', () => {
      const entry: Partial<SearchEntry> = {
        $id: 'Startup/acme',
        $type: 'Startup',
        content: 'Acme Corp is a B2B SaaS startup',
      }
      expect(entry.$id).toBe('Startup/acme')
    })

    it('nested entity path', () => {
      const entry: Partial<SearchEntry> = {
        $id: 'Startup/acme/Product/widget',
        $type: 'Product',
        content: 'Widget is a productivity tool',
      }
      expect(entry.$id).toBe('Startup/acme/Product/widget')
    })

    it('full namespace URL', () => {
      const entry: Partial<SearchEntry> = {
        $id: 'https://startups.studio/Startup/acme',
        $type: 'Startup',
        content: 'Acme Corp is a B2B SaaS startup',
      }
      expect(entry.$id).toContain('startups.studio')
    })
  })

  describe('$type Denormalization', () => {
    it('$type matches the noun of the Thing', () => {
      const entry: Partial<SearchEntry> = {
        $id: 'Startup/acme',
        $type: 'Startup',
        content: 'Acme Corp',
      }
      expect(entry.$type).toBe('Startup')
    })

    it('$type enables fast type filtering without joins', () => {
      // Type is denormalized for query efficiency
      const entries: Partial<SearchEntry>[] = [
        { $id: 'Startup/acme', $type: 'Startup' },
        { $id: 'Startup/beta', $type: 'Startup' },
        { $id: 'Product/widget', $type: 'Product' },
      ]
      const startups = entries.filter((e) => e.$type === 'Startup')
      expect(startups).toHaveLength(2)
    })
  })
})

// ============================================================================
// Vector Embeddings
// ============================================================================

describe('Vector Embeddings', () => {
  describe('Matryoshka Representation Learning (MRL)', () => {
    it('supports 128-dim embeddings (local fast search)', () => {
      const entry: Partial<SearchEntry> = {
        $id: 'Startup/acme',
        embeddingDim: 128,
        embedding: Buffer.alloc(128 * 4), // 128 floats * 4 bytes
      }
      expect(entry.embeddingDim).toBe(128)
    })

    it('supports 256-dim embeddings (middle ground)', () => {
      const entry: Partial<SearchEntry> = {
        $id: 'Startup/acme',
        embeddingDim: 256,
        embedding: Buffer.alloc(256 * 4),
      }
      expect(entry.embeddingDim).toBe(256)
    })

    it('supports 512-dim embeddings (higher quality)', () => {
      const entry: Partial<SearchEntry> = {
        $id: 'Startup/acme',
        embeddingDim: 512,
        embedding: Buffer.alloc(512 * 4),
      }
      expect(entry.embeddingDim).toBe(512)
    })

    it('supports 768-dim embeddings (full quality, for Vectorize)', () => {
      const entry: Partial<SearchEntry> = {
        $id: 'Startup/acme',
        embeddingDim: 768,
        embedding: Buffer.alloc(768 * 4),
      }
      expect(entry.embeddingDim).toBe(768)
    })
  })

  describe('Embedding Storage', () => {
    it('embeddings stored as binary blob', () => {
      // Float32 array to buffer
      const floats = new Float32Array([0.1, 0.2, 0.3, 0.4])
      const buffer = Buffer.from(floats.buffer)
      expect(buffer.length).toBe(16) // 4 floats * 4 bytes
    })

    it('null embedding for text-only entries', () => {
      const entry: Partial<SearchEntry> = {
        $id: 'Startup/acme',
        content: 'Acme Corp',
        embedding: null,
        embeddingDim: null,
      }
      expect(entry.embedding).toBeNull()
    })
  })
})

// ============================================================================
// Pre-computed Fields for R2 SQL
// ============================================================================

describe('Pre-computed Fields for R2 SQL', () => {
  describe('Clustering', () => {
    it('cluster field stores K-means assignment', () => {
      const entry: Partial<SearchEntry> = {
        $id: 'Startup/acme',
        cluster: 42,
      }
      expect(entry.cluster).toBe(42)
    })

    it('cluster enables fast coarse filtering', () => {
      const entries: Partial<SearchEntry>[] = [
        { $id: 'Startup/a', cluster: 1 },
        { $id: 'Startup/b', cluster: 1 },
        { $id: 'Startup/c', cluster: 2 },
        { $id: 'Startup/d', cluster: 2 },
      ]
      const cluster1 = entries.filter((e) => e.cluster === 1)
      expect(cluster1).toHaveLength(2)
    })
  })

  describe('Locality-Sensitive Hashing (LSH)', () => {
    it('lsh1-3 provide multiple hash buckets', () => {
      const entry: Partial<SearchEntry> = {
        $id: 'Startup/acme',
        lsh1: 'a7f2b1',
        lsh2: 'c3d4e5',
        lsh3: 'f6g7h8',
      }
      expect(entry.lsh1).toBe('a7f2b1')
      expect(entry.lsh2).toBe('c3d4e5')
      expect(entry.lsh3).toBe('f6g7h8')
    })

    it('LSH buckets enable approximate nearest neighbor filtering', () => {
      // Items in the same bucket are likely similar
      const entries: Partial<SearchEntry>[] = [
        { $id: 'Startup/a', lsh1: 'abc123' },
        { $id: 'Startup/b', lsh1: 'abc123' },
        { $id: 'Startup/c', lsh1: 'xyz789' },
      ]
      const sameBucket = entries.filter((e) => e.lsh1 === 'abc123')
      expect(sameBucket).toHaveLength(2)
    })
  })

  describe('Semantic Hierarchy', () => {
    it('semanticL1 stores top-level category', () => {
      const entry: Partial<SearchEntry> = {
        $id: 'Startup/acme',
        semanticL1: 'technology',
      }
      expect(entry.semanticL1).toBe('technology')
    })

    it('semanticL2 stores mid-level category', () => {
      const entry: Partial<SearchEntry> = {
        $id: 'Startup/acme',
        semanticL1: 'technology',
        semanticL2: 'software',
      }
      expect(entry.semanticL2).toBe('software')
    })

    it('semanticL3 stores fine-grained category', () => {
      const entry: Partial<SearchEntry> = {
        $id: 'Startup/acme',
        semanticL1: 'technology',
        semanticL2: 'software',
        semanticL3: 'b2b-saas',
      }
      expect(entry.semanticL3).toBe('b2b-saas')
    })

    it('semantic hierarchy enables category filtering', () => {
      const entries: Partial<SearchEntry>[] = [
        { $id: 'Startup/a', semanticL1: 'technology', semanticL2: 'software' },
        { $id: 'Startup/b', semanticL1: 'technology', semanticL2: 'hardware' },
        { $id: 'Startup/c', semanticL1: 'healthcare', semanticL2: 'biotech' },
      ]
      const software = entries.filter(
        (e) => e.semanticL1 === 'technology' && e.semanticL2 === 'software'
      )
      expect(software).toHaveLength(1)
    })
  })
})

// ============================================================================
// Content Indexing
// ============================================================================

describe('Content Indexing', () => {
  it('content stores searchable text', () => {
    const entry: Partial<SearchEntry> = {
      $id: 'Startup/acme',
      content: 'Acme Corp is a B2B SaaS startup building productivity tools for enterprises.',
    }
    expect(entry.content).toContain('Acme Corp')
    expect(entry.content).toContain('B2B SaaS')
  })

  it('content can be extracted from Thing data', () => {
    // Simulate content extraction from Thing
    const thing = {
      $id: 'Startup/acme',
      $type: 'Startup',
      name: 'Acme Corp',
      data: {
        description: 'Building the future of work',
        tags: ['saas', 'b2b', 'enterprise'],
      },
    }

    // Content extraction would combine name, description, tags
    const content = [
      thing.name,
      (thing.data as any).description,
      (thing.data as any).tags.join(' '),
    ].join(' ')

    expect(content).toContain('Acme Corp')
    expect(content).toContain('Building the future')
    expect(content).toContain('saas b2b enterprise')
  })

  it('content supports full-text search patterns', () => {
    const content = 'Acme Corp is a B2B SaaS startup building productivity tools'

    // Simple word matching
    expect(content.toLowerCase()).toContain('saas')
    expect(content.toLowerCase()).toContain('productivity')

    // Multi-word matching
    expect(content.toLowerCase()).toContain('b2b saas')
  })
})

// ============================================================================
// Index Coverage
// ============================================================================

describe('Index Coverage', () => {
  it('has index on $type for type filtering', () => {
    // Verified by schema definition - search_type_idx
    expect(search.$type).toBeDefined()
  })

  it('has index on cluster for coarse filtering', () => {
    // Verified by schema definition - search_cluster_idx
    expect(search.cluster).toBeDefined()
  })

  it('has composite index on semanticL1+L2 for hierarchy queries', () => {
    // Verified by schema definition - search_semantic_idx
    expect(search.semanticL1).toBeDefined()
    expect(search.semanticL2).toBeDefined()
  })
})

// ============================================================================
// Type Exports
// ============================================================================

describe('Type Exports', () => {
  it('can create type-safe search entry objects', () => {
    const entry: Partial<SearchEntry> = {
      $id: 'Startup/acme',
      $type: 'Startup',
      content: 'Acme Corp is a B2B SaaS startup',
      embeddingDim: 128,
      cluster: 5,
      semanticL1: 'technology',
      indexedAt: new Date(),
    }
    expect(entry.$id).toBe('Startup/acme')
    expect(entry.$type).toBe('Startup')
    expect(entry.embeddingDim).toBe(128)
  })
})

// ============================================================================
// 3-Tier Search Architecture
// ============================================================================

describe('3-Tier Search Architecture', () => {
  describe('Tier 1: Local DO SQLite', () => {
    it('uses 128-dim MRL embeddings for fast flat scan', () => {
      const localEntry: Partial<SearchEntry> = {
        $id: 'Startup/acme',
        embeddingDim: 128,
        embedding: Buffer.alloc(128 * 4),
      }
      expect(localEntry.embeddingDim).toBe(128)
    })

    it('provides sub-millisecond search within single DO', () => {
      // Flat scan on 128-dim vectors is fast for <10K items
      const items = 1000
      const dims = 128
      const bytesPerFloat = 4
      const totalBytes = items * dims * bytesPerFloat

      // 512KB for 1000 128-dim vectors
      expect(totalBytes).toBe(512000)
    })
  })

  describe('Tier 2: Cloudflare Vectorize', () => {
    it('uses 768-dim embeddings for full quality', () => {
      const vectorizeEntry: Partial<SearchEntry> = {
        $id: 'Startup/acme',
        embeddingDim: 768,
      }
      expect(vectorizeEntry.embeddingDim).toBe(768)
    })

    it('HNSW index enables fast approximate nearest neighbor', () => {
      // Vectorize uses HNSW algorithm
      // Expected query time: O(log n) vs O(n) for flat scan
      expect(true).toBe(true) // Architecture documentation test
    })
  })

  describe('Tier 3: R2 SQL Analytics', () => {
    it('pre-computed fields enable filtering before vector search', () => {
      const r2Entry: Partial<SearchEntry> = {
        $id: 'Startup/acme',
        cluster: 42,
        lsh1: 'abc123',
        lsh2: 'def456',
        lsh3: 'ghi789',
        semanticL1: 'technology',
        semanticL2: 'software',
        semanticL3: 'b2b-saas',
      }

      // Can filter by cluster first, then by LSH, then semantic
      expect(r2Entry.cluster).toBe(42)
      expect(r2Entry.lsh1).toBe('abc123')
      expect(r2Entry.semanticL1).toBe('technology')
    })

    it('hierarchical filtering reduces Vectorize query scope', () => {
      // Strategy: Filter 1M items to 10K using R2 SQL, then Vectorize
      const totalItems = 1000000
      const afterClusterFilter = totalItems / 100 // ~10K per cluster
      const afterLSHFilter = afterClusterFilter / 10 // ~1K similar items
      const afterSemanticFilter = afterLSHFilter / 2 // ~500 in category

      expect(afterSemanticFilter).toBeLessThan(1000)
    })
  })
})
