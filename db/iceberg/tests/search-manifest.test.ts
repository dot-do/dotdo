import { describe, it, expect } from 'vitest'
import {
  validateSearchManifest,
  parseSearchManifest,
  buildIndexUrl,
  buildDataUrl,
  buildAllDataUrls,
  getAvailableIndexes,
  getIndexConfig,
  hasIndex,
  SearchManifestValidationError,
  type SearchManifest,
  type BloomIndexConfig,
  type RangeIndexConfig,
  type VectorIndexConfig,
  type InvertedIndexConfig,
} from '../search-manifest'

/**
 * Search Manifest Tests
 *
 * Tests for the search manifest format used by the unified search snippet.
 * The manifest describes available indexes (bloom, range, vector, inverted)
 * for searchable datasets stored in R2/CDN.
 */

// ============================================================================
// Test Fixtures
// ============================================================================

/**
 * Minimal valid manifest with only required fields.
 */
const minimalManifest = {
  version: 1,
  base: 'cdn.apis.do/test/v1',
  indexes: {
    bloom: {
      id: { file: 'indexes/bloom/id.bloom', fpr: 0.01, items: 1000 },
    },
  },
  data: {
    files: ['data/test.parquet'],
  },
}

/**
 * Full manifest with all index types and optional fields.
 */
const fullManifest = {
  version: 1,
  base: 'cdn.apis.do/wiktionary/v1',
  indexes: {
    bloom: {
      word: { file: 'indexes/bloom/word.bloom', fpr: 0.01, items: 500000 },
      lemma: { file: 'indexes/bloom/lemma.bloom', fpr: 0.001, items: 100000 },
    },
    range: {
      word: { file: 'indexes/range/word.range', offset: 0, blocks: 1000 },
    },
    vector: {
      definition: { file: 'indexes/vector/definition.hnsw', dims: 384, count: 500000, metric: 'cosine' as const },
      example: { file: 'indexes/vector/example.hnsw', dims: 768, count: 200000, metric: 'euclidean' as const },
    },
    inverted: {
      text: { file: 'indexes/inverted/text.idx', terms: 50000 },
    },
  },
  data: {
    files: ['data/words-0001.parquet', 'data/words-0002.parquet', 'data/words-0003.parquet'],
    puffin: ['stats/words-stats.puffin'],
  },
  cache: {
    queries: {
      file: 'cache/common-queries.bin',
      count: 10000,
    },
  },
}

// ============================================================================
// validateSearchManifest Tests
// ============================================================================

describe('validateSearchManifest', () => {
  describe('valid manifests', () => {
    it('accepts minimal valid manifest', () => {
      const result = validateSearchManifest(minimalManifest)

      expect(result.version).toBe(1)
      expect(result.base).toBe('cdn.apis.do/test/v1')
      expect(result.indexes.bloom).toBeDefined()
      expect(result.data.files).toHaveLength(1)
    })

    it('accepts full manifest with all index types', () => {
      const result = validateSearchManifest(fullManifest)

      expect(result.version).toBe(1)
      expect(result.base).toBe('cdn.apis.do/wiktionary/v1')

      // Check bloom indexes
      expect(result.indexes.bloom).toBeDefined()
      expect(result.indexes.bloom!.word.fpr).toBe(0.01)
      expect(result.indexes.bloom!.word.items).toBe(500000)

      // Check range indexes
      expect(result.indexes.range).toBeDefined()
      expect(result.indexes.range!.word.blocks).toBe(1000)

      // Check vector indexes
      expect(result.indexes.vector).toBeDefined()
      expect(result.indexes.vector!.definition.dims).toBe(384)
      expect(result.indexes.vector!.definition.metric).toBe('cosine')

      // Check inverted indexes
      expect(result.indexes.inverted).toBeDefined()
      expect(result.indexes.inverted!.text.terms).toBe(50000)

      // Check data files
      expect(result.data.files).toHaveLength(3)
      expect(result.data.puffin).toHaveLength(1)

      // Check cache
      expect(result.cache).toBeDefined()
      expect(result.cache!.queries!.file).toBe('cache/common-queries.bin')
      expect(result.cache!.queries!.count).toBe(10000)
    })

    it('accepts manifest with only vector indexes', () => {
      const manifest = {
        version: 1,
        base: 'cdn.apis.do/embeddings/v1',
        indexes: {
          vector: {
            content: { file: 'vectors/content.hnsw', dims: 1536, count: 1000000, metric: 'dot' as const },
          },
        },
        data: {
          files: ['data/embeddings.parquet'],
        },
      }

      const result = validateSearchManifest(manifest)

      expect(result.indexes.vector).toBeDefined()
      expect(result.indexes.vector!.content.metric).toBe('dot')
    })

    it('accepts manifest with only inverted indexes', () => {
      const manifest = {
        version: 1,
        base: 'cdn.apis.do/search/v1',
        indexes: {
          inverted: {
            body: { file: 'indexes/body.idx', terms: 100000 },
            title: { file: 'indexes/title.idx', terms: 10000 },
          },
        },
        data: {
          files: ['data/documents.parquet'],
        },
      }

      const result = validateSearchManifest(manifest)

      expect(result.indexes.inverted).toBeDefined()
      expect(Object.keys(result.indexes.inverted!)).toHaveLength(2)
    })
  })

  describe('version validation', () => {
    it('rejects manifest with version 0', () => {
      const manifest = { ...minimalManifest, version: 0 }

      expect(() => validateSearchManifest(manifest)).toThrow(SearchManifestValidationError)
      expect(() => validateSearchManifest(manifest)).toThrow('version')
    })

    it('rejects manifest with version 2', () => {
      const manifest = { ...minimalManifest, version: 2 }

      expect(() => validateSearchManifest(manifest)).toThrow(SearchManifestValidationError)
    })

    it('rejects manifest with string version', () => {
      const manifest = { ...minimalManifest, version: '1' }

      expect(() => validateSearchManifest(manifest)).toThrow(SearchManifestValidationError)
    })

    it('rejects manifest without version', () => {
      const { version, ...manifest } = minimalManifest

      expect(() => validateSearchManifest(manifest)).toThrow(SearchManifestValidationError)
    })
  })

  describe('base URL validation', () => {
    it('rejects empty base URL', () => {
      const manifest = { ...minimalManifest, base: '' }

      expect(() => validateSearchManifest(manifest)).toThrow(SearchManifestValidationError)
      expect(() => validateSearchManifest(manifest)).toThrow('base')
    })

    it('rejects non-string base URL', () => {
      const manifest = { ...minimalManifest, base: 123 }

      expect(() => validateSearchManifest(manifest)).toThrow(SearchManifestValidationError)
    })
  })

  describe('indexes validation', () => {
    it('rejects manifest with no indexes', () => {
      const manifest = { ...minimalManifest, indexes: {} }

      expect(() => validateSearchManifest(manifest)).toThrow(SearchManifestValidationError)
      expect(() => validateSearchManifest(manifest)).toThrow('At least one index type')
    })

    it('rejects manifest with null indexes', () => {
      const manifest = { ...minimalManifest, indexes: null }

      expect(() => validateSearchManifest(manifest)).toThrow(SearchManifestValidationError)
    })

    describe('bloom index validation', () => {
      it('rejects bloom index with invalid fpr (0)', () => {
        const manifest = {
          ...minimalManifest,
          indexes: {
            bloom: { id: { file: 'test.bloom', fpr: 0, items: 1000 } },
          },
        }

        expect(() => validateSearchManifest(manifest)).toThrow(SearchManifestValidationError)
        expect(() => validateSearchManifest(manifest)).toThrow('fpr')
      })

      it('rejects bloom index with invalid fpr (1)', () => {
        const manifest = {
          ...minimalManifest,
          indexes: {
            bloom: { id: { file: 'test.bloom', fpr: 1, items: 1000 } },
          },
        }

        expect(() => validateSearchManifest(manifest)).toThrow(SearchManifestValidationError)
      })

      it('rejects bloom index with invalid fpr (> 1)', () => {
        const manifest = {
          ...minimalManifest,
          indexes: {
            bloom: { id: { file: 'test.bloom', fpr: 1.5, items: 1000 } },
          },
        }

        expect(() => validateSearchManifest(manifest)).toThrow(SearchManifestValidationError)
      })

      it('rejects bloom index with negative items', () => {
        const manifest = {
          ...minimalManifest,
          indexes: {
            bloom: { id: { file: 'test.bloom', fpr: 0.01, items: -100 } },
          },
        }

        expect(() => validateSearchManifest(manifest)).toThrow(SearchManifestValidationError)
      })

      it('rejects bloom index with non-integer items', () => {
        const manifest = {
          ...minimalManifest,
          indexes: {
            bloom: { id: { file: 'test.bloom', fpr: 0.01, items: 100.5 } },
          },
        }

        expect(() => validateSearchManifest(manifest)).toThrow(SearchManifestValidationError)
      })

      it('rejects bloom index with missing file', () => {
        const manifest = {
          ...minimalManifest,
          indexes: {
            bloom: { id: { fpr: 0.01, items: 1000 } },
          },
        }

        expect(() => validateSearchManifest(manifest)).toThrow(SearchManifestValidationError)
      })
    })

    describe('range index validation', () => {
      it('rejects range index with negative offset', () => {
        const manifest = {
          ...minimalManifest,
          indexes: {
            range: { id: { file: 'test.range', offset: -1, blocks: 100 } },
          },
        }

        expect(() => validateSearchManifest(manifest)).toThrow(SearchManifestValidationError)
      })

      it('rejects range index with zero blocks', () => {
        const manifest = {
          ...minimalManifest,
          indexes: {
            range: { id: { file: 'test.range', offset: 0, blocks: 0 } },
          },
        }

        expect(() => validateSearchManifest(manifest)).toThrow(SearchManifestValidationError)
      })

      it('accepts range index with zero offset', () => {
        const manifest = {
          ...minimalManifest,
          indexes: {
            range: { id: { file: 'test.range', offset: 0, blocks: 100 } },
          },
        }

        const result = validateSearchManifest(manifest)
        expect(result.indexes.range!.id.offset).toBe(0)
      })
    })

    describe('vector index validation', () => {
      it('rejects vector index with zero dims', () => {
        const manifest = {
          ...minimalManifest,
          indexes: {
            vector: { emb: { file: 'test.hnsw', dims: 0, count: 1000, metric: 'cosine' } },
          },
        }

        expect(() => validateSearchManifest(manifest)).toThrow(SearchManifestValidationError)
      })

      it('rejects vector index with invalid metric', () => {
        const manifest = {
          ...minimalManifest,
          indexes: {
            vector: { emb: { file: 'test.hnsw', dims: 384, count: 1000, metric: 'manhattan' } },
          },
        }

        expect(() => validateSearchManifest(manifest)).toThrow(SearchManifestValidationError)
        expect(() => validateSearchManifest(manifest)).toThrow('metric')
      })

      it('accepts all valid metrics', () => {
        for (const metric of ['cosine', 'euclidean', 'dot'] as const) {
          const manifest = {
            ...minimalManifest,
            indexes: {
              vector: { emb: { file: 'test.hnsw', dims: 384, count: 1000, metric } },
            },
          }

          const result = validateSearchManifest(manifest)
          expect(result.indexes.vector!.emb.metric).toBe(metric)
        }
      })
    })

    describe('inverted index validation', () => {
      it('rejects inverted index with zero terms', () => {
        const manifest = {
          ...minimalManifest,
          indexes: {
            inverted: { text: { file: 'test.idx', terms: 0 } },
          },
        }

        expect(() => validateSearchManifest(manifest)).toThrow(SearchManifestValidationError)
      })

      it('rejects inverted index with missing terms', () => {
        const manifest = {
          ...minimalManifest,
          indexes: {
            inverted: { text: { file: 'test.idx' } },
          },
        }

        expect(() => validateSearchManifest(manifest)).toThrow(SearchManifestValidationError)
      })
    })
  })

  describe('data validation', () => {
    it('rejects manifest with empty files array', () => {
      const manifest = { ...minimalManifest, data: { files: [] } }

      expect(() => validateSearchManifest(manifest)).toThrow(SearchManifestValidationError)
      expect(() => validateSearchManifest(manifest)).toThrow('non-empty array')
    })

    it('rejects manifest with non-string file path', () => {
      const manifest = { ...minimalManifest, data: { files: [123] } }

      expect(() => validateSearchManifest(manifest)).toThrow(SearchManifestValidationError)
    })

    it('rejects manifest with empty file path', () => {
      const manifest = { ...minimalManifest, data: { files: [''] } }

      expect(() => validateSearchManifest(manifest)).toThrow(SearchManifestValidationError)
    })

    it('accepts manifest with puffin files', () => {
      const manifest = {
        ...minimalManifest,
        data: {
          files: ['data/test.parquet'],
          puffin: ['stats/test.puffin'],
        },
      }

      const result = validateSearchManifest(manifest)
      expect(result.data.puffin).toHaveLength(1)
    })
  })

  describe('cache validation', () => {
    it('accepts manifest without cache', () => {
      const result = validateSearchManifest(minimalManifest)
      expect(result.cache).toBeUndefined()
    })

    it('accepts manifest with cache queries', () => {
      const manifest = {
        ...minimalManifest,
        cache: {
          queries: { file: 'cache/queries.bin' },
        },
      }

      const result = validateSearchManifest(manifest)
      expect(result.cache!.queries!.file).toBe('cache/queries.bin')
    })

    it('accepts manifest with cache queries count', () => {
      const manifest = {
        ...minimalManifest,
        cache: {
          queries: { file: 'cache/queries.bin', count: 5000 },
        },
      }

      const result = validateSearchManifest(manifest)
      expect(result.cache!.queries!.count).toBe(5000)
    })

    it('rejects cache with invalid count', () => {
      const manifest = {
        ...minimalManifest,
        cache: {
          queries: { file: 'cache/queries.bin', count: -1 },
        },
      }

      expect(() => validateSearchManifest(manifest)).toThrow(SearchManifestValidationError)
    })
  })

  describe('error handling', () => {
    it('rejects null input', () => {
      expect(() => validateSearchManifest(null)).toThrow(SearchManifestValidationError)
    })

    it('rejects undefined input', () => {
      expect(() => validateSearchManifest(undefined)).toThrow(SearchManifestValidationError)
    })

    it('rejects string input', () => {
      expect(() => validateSearchManifest('manifest')).toThrow(SearchManifestValidationError)
    })

    it('rejects array input', () => {
      expect(() => validateSearchManifest([minimalManifest])).toThrow(SearchManifestValidationError)
    })

    it('includes path in error message', () => {
      const manifest = {
        ...minimalManifest,
        indexes: {
          bloom: { word: { file: 'test.bloom', fpr: 2, items: 1000 } },
        },
      }

      try {
        validateSearchManifest(manifest)
        expect.fail('Should have thrown')
      } catch (e) {
        expect(e).toBeInstanceOf(SearchManifestValidationError)
        const error = e as SearchManifestValidationError
        expect(error.path).toBe('indexes.bloom.word.fpr')
      }
    })
  })
})

// ============================================================================
// parseSearchManifest Tests
// ============================================================================

describe('parseSearchManifest', () => {
  it('parses valid JSON manifest', () => {
    const json = JSON.stringify(minimalManifest)
    const result = parseSearchManifest(json)

    expect(result.version).toBe(1)
    expect(result.base).toBe('cdn.apis.do/test/v1')
  })

  it('parses full manifest from JSON', () => {
    const json = JSON.stringify(fullManifest)
    const result = parseSearchManifest(json)

    expect(result.indexes.bloom).toBeDefined()
    expect(result.indexes.vector).toBeDefined()
    expect(result.data.files).toHaveLength(3)
  })

  it('throws SyntaxError for invalid JSON', () => {
    const invalidJson = '{ invalid json }'

    expect(() => parseSearchManifest(invalidJson)).toThrow(SyntaxError)
  })

  it('throws SearchManifestValidationError for valid JSON but invalid manifest', () => {
    const json = JSON.stringify({ version: 2 })

    expect(() => parseSearchManifest(json)).toThrow(SearchManifestValidationError)
  })
})

// ============================================================================
// URL Builder Tests
// ============================================================================

describe('buildIndexUrl', () => {
  const manifest = validateSearchManifest(fullManifest)

  it('builds URL for bloom index', () => {
    const url = buildIndexUrl(manifest, 'bloom', 'word')

    expect(url).toBe('https://cdn.apis.do/wiktionary/v1/indexes/bloom/word.bloom')
  })

  it('builds URL for range index', () => {
    const url = buildIndexUrl(manifest, 'range', 'word')

    expect(url).toBe('https://cdn.apis.do/wiktionary/v1/indexes/range/word.range')
  })

  it('builds URL for vector index', () => {
    const url = buildIndexUrl(manifest, 'vector', 'definition')

    expect(url).toBe('https://cdn.apis.do/wiktionary/v1/indexes/vector/definition.hnsw')
  })

  it('builds URL for inverted index', () => {
    const url = buildIndexUrl(manifest, 'inverted', 'text')

    expect(url).toBe('https://cdn.apis.do/wiktionary/v1/indexes/inverted/text.idx')
  })

  it('returns null for non-existent index type', () => {
    const simpleManifest = validateSearchManifest(minimalManifest)
    const url = buildIndexUrl(simpleManifest, 'vector', 'missing')

    expect(url).toBeNull()
  })

  it('returns null for non-existent field', () => {
    const url = buildIndexUrl(manifest, 'bloom', 'nonexistent')

    expect(url).toBeNull()
  })

  it('supports custom protocol', () => {
    const url = buildIndexUrl(manifest, 'bloom', 'word', 'http')

    expect(url).toBe('http://cdn.apis.do/wiktionary/v1/indexes/bloom/word.bloom')
  })
})

describe('buildDataUrl', () => {
  const manifest = validateSearchManifest(fullManifest)

  it('builds URL for first data file', () => {
    const url = buildDataUrl(manifest, 0)

    expect(url).toBe('https://cdn.apis.do/wiktionary/v1/data/words-0001.parquet')
  })

  it('builds URL for middle data file', () => {
    const url = buildDataUrl(manifest, 1)

    expect(url).toBe('https://cdn.apis.do/wiktionary/v1/data/words-0002.parquet')
  })

  it('builds URL for last data file', () => {
    const url = buildDataUrl(manifest, 2)

    expect(url).toBe('https://cdn.apis.do/wiktionary/v1/data/words-0003.parquet')
  })

  it('returns null for negative index', () => {
    const url = buildDataUrl(manifest, -1)

    expect(url).toBeNull()
  })

  it('returns null for out of bounds index', () => {
    const url = buildDataUrl(manifest, 100)

    expect(url).toBeNull()
  })

  it('supports custom protocol', () => {
    const url = buildDataUrl(manifest, 0, 'http')

    expect(url).toBe('http://cdn.apis.do/wiktionary/v1/data/words-0001.parquet')
  })
})

describe('buildAllDataUrls', () => {
  const manifest = validateSearchManifest(fullManifest)

  it('returns all data file URLs', () => {
    const urls = buildAllDataUrls(manifest)

    expect(urls).toHaveLength(3)
    expect(urls[0]).toBe('https://cdn.apis.do/wiktionary/v1/data/words-0001.parquet')
    expect(urls[1]).toBe('https://cdn.apis.do/wiktionary/v1/data/words-0002.parquet')
    expect(urls[2]).toBe('https://cdn.apis.do/wiktionary/v1/data/words-0003.parquet')
  })

  it('returns single URL for single file', () => {
    const simpleManifest = validateSearchManifest(minimalManifest)
    const urls = buildAllDataUrls(simpleManifest)

    expect(urls).toHaveLength(1)
    expect(urls[0]).toBe('https://cdn.apis.do/test/v1/data/test.parquet')
  })

  it('supports custom protocol', () => {
    const urls = buildAllDataUrls(manifest, 'http')

    expect(urls[0].startsWith('http://')).toBe(true)
  })
})

// ============================================================================
// Index Introspection Tests
// ============================================================================

describe('getAvailableIndexes', () => {
  it('returns all index types for full manifest', () => {
    const manifest = validateSearchManifest(fullManifest)
    const indexes = getAvailableIndexes(manifest)

    expect(indexes.bloom).toEqual(['word', 'lemma'])
    expect(indexes.range).toEqual(['word'])
    expect(indexes.vector).toEqual(['definition', 'example'])
    expect(indexes.inverted).toEqual(['text'])
  })

  it('returns empty arrays for missing index types', () => {
    const manifest = validateSearchManifest(minimalManifest)
    const indexes = getAvailableIndexes(manifest)

    expect(indexes.bloom).toEqual(['id'])
    expect(indexes.range).toEqual([])
    expect(indexes.vector).toEqual([])
    expect(indexes.inverted).toEqual([])
  })
})

describe('getIndexConfig', () => {
  const manifest = validateSearchManifest(fullManifest)

  it('returns bloom index config', () => {
    const config = getIndexConfig(manifest, 'bloom', 'word')

    expect(config).not.toBeNull()
    expect((config as BloomIndexConfig).fpr).toBe(0.01)
    expect((config as BloomIndexConfig).items).toBe(500000)
  })

  it('returns range index config', () => {
    const config = getIndexConfig(manifest, 'range', 'word')

    expect(config).not.toBeNull()
    expect((config as RangeIndexConfig).offset).toBe(0)
    expect((config as RangeIndexConfig).blocks).toBe(1000)
  })

  it('returns vector index config', () => {
    const config = getIndexConfig(manifest, 'vector', 'definition')

    expect(config).not.toBeNull()
    expect((config as VectorIndexConfig).dims).toBe(384)
    expect((config as VectorIndexConfig).metric).toBe('cosine')
  })

  it('returns inverted index config', () => {
    const config = getIndexConfig(manifest, 'inverted', 'text')

    expect(config).not.toBeNull()
    expect((config as InvertedIndexConfig).terms).toBe(50000)
  })

  it('returns null for non-existent index', () => {
    const config = getIndexConfig(manifest, 'bloom', 'nonexistent')

    expect(config).toBeNull()
  })

  it('returns null for non-existent index type', () => {
    const simpleManifest = validateSearchManifest(minimalManifest)
    const config = getIndexConfig(simpleManifest, 'vector', 'anything')

    expect(config).toBeNull()
  })
})

describe('hasIndex', () => {
  const manifest = validateSearchManifest(fullManifest)

  it('returns true for existing bloom index', () => {
    expect(hasIndex(manifest, 'bloom', 'word')).toBe(true)
  })

  it('returns true for existing vector index', () => {
    expect(hasIndex(manifest, 'vector', 'definition')).toBe(true)
  })

  it('returns false for non-existent field', () => {
    expect(hasIndex(manifest, 'bloom', 'nonexistent')).toBe(false)
  })

  it('returns false for non-existent index type', () => {
    const simpleManifest = validateSearchManifest(minimalManifest)
    expect(hasIndex(simpleManifest, 'vector', 'anything')).toBe(false)
  })
})

// ============================================================================
// Integration Tests
// ============================================================================

describe('integration scenarios', () => {
  describe('Wiktionary search manifest', () => {
    it('validates example Wiktionary manifest', () => {
      const wiktionaryManifest = {
        version: 1,
        base: 'cdn.apis.do/wiktionary/v1',
        indexes: {
          bloom: {
            word: { file: 'indexes/bloom/word.bloom', fpr: 0.01, items: 500000 },
          },
          range: {
            word: { file: 'indexes/range/word.range', offset: 0, blocks: 1000 },
          },
          vector: {
            definition: { file: 'indexes/vector/definition.hnsw', dims: 384, count: 500000, metric: 'cosine' as const },
          },
          inverted: {
            definition: { file: 'indexes/inverted/definition.idx', terms: 50000 },
          },
        },
        data: {
          files: ['data/wiktionary-en-0001.parquet', 'data/wiktionary-en-0002.parquet'],
        },
      }

      const manifest = validateSearchManifest(wiktionaryManifest)

      // Build URLs for all index types
      expect(buildIndexUrl(manifest, 'bloom', 'word')).toBe(
        'https://cdn.apis.do/wiktionary/v1/indexes/bloom/word.bloom'
      )
      expect(buildIndexUrl(manifest, 'range', 'word')).toBe(
        'https://cdn.apis.do/wiktionary/v1/indexes/range/word.range'
      )
      expect(buildIndexUrl(manifest, 'vector', 'definition')).toBe(
        'https://cdn.apis.do/wiktionary/v1/indexes/vector/definition.hnsw'
      )
      expect(buildIndexUrl(manifest, 'inverted', 'definition')).toBe(
        'https://cdn.apis.do/wiktionary/v1/indexes/inverted/definition.idx'
      )
    })
  })

  describe('search flow', () => {
    it('supports typical search workflow', () => {
      const manifest = validateSearchManifest(fullManifest)

      // 1. Check if word might exist using bloom filter
      expect(hasIndex(manifest, 'bloom', 'word')).toBe(true)
      const bloomUrl = buildIndexUrl(manifest, 'bloom', 'word')
      expect(bloomUrl).toContain('word.bloom')

      // 2. If bloom says yes, use range index to find position
      expect(hasIndex(manifest, 'range', 'word')).toBe(true)
      const rangeConfig = getIndexConfig(manifest, 'range', 'word')
      expect(rangeConfig).not.toBeNull()

      // 3. For semantic search, use vector index
      expect(hasIndex(manifest, 'vector', 'definition')).toBe(true)
      const vectorConfig = getIndexConfig(manifest, 'vector', 'definition')
      expect((vectorConfig as VectorIndexConfig).dims).toBe(384)

      // 4. Fetch data from parquet files
      const dataUrls = buildAllDataUrls(manifest)
      expect(dataUrls.length).toBeGreaterThan(0)
    })
  })
})
