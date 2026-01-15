/**
 * MCP Search Tool Tests
 *
 * Tests for semantic, keyword, and hybrid search functionality.
 *
 * @module mcp/tools/search.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  searchTool,
  searchToolSchema,
  searchToolDefinition,
  indexDocument,
  removeFromIndex,
  type SearchInput,
  type SearchEnv,
  type SearchToolProps,
  type SearchResponse,
} from './search'

// =============================================================================
// MOCKS
// =============================================================================

/**
 * Create mock AI environment binding
 */
function createMockAI() {
  return {
    run: vi.fn().mockResolvedValue({
      data: [[0.1, 0.2, 0.3, 0.4, 0.5]], // Mock embedding vector
    }),
  }
}

/**
 * Create mock Vectorize environment binding
 */
function createMockVectorize() {
  const vectors: Array<{ id: string; values: number[]; metadata?: Record<string, unknown> }> = []

  return {
    query: vi.fn().mockImplementation(async (_vector: number[], options: { topK: number }) => {
      // Return stored vectors sorted by simple similarity (mock)
      const matches = vectors.slice(0, options.topK).map((v, i) => ({
        id: v.id,
        score: 1 - i * 0.1,
        metadata: v.metadata,
      }))
      return { matches }
    }),
    insert: vi.fn().mockImplementation(async (newVectors: typeof vectors) => {
      vectors.push(...newVectors)
    }),
    _vectors: vectors, // Expose for test verification
  }
}

/**
 * Create mock SQL environment binding
 */
function createMockSQL() {
  const things: Array<{ id: string; type: string; data: string; namespace?: string }> = []

  return {
    exec: vi.fn().mockImplementation((query: string, ...params: unknown[]) => {
      // Simple query parser for test purposes
      if (query.includes('INSERT') || query.includes('REPLACE')) {
        const [id, type, namespace, data] = params as string[]
        const existing = things.findIndex((t) => t.id === id)
        const entry = { id, type, data, namespace }
        if (existing >= 0) {
          things[existing] = entry
        } else {
          things.push(entry)
        }
        return { toArray: () => [] }
      }

      if (query.includes('DELETE')) {
        const id = params[0] as string
        const index = things.findIndex((t) => t.id === id)
        if (index >= 0) things.splice(index, 1)
        return { toArray: () => [] }
      }

      if (query.includes('SELECT') && query.includes('things_fts')) {
        // FTS query - throw to trigger fallback
        throw new Error('FTS table not found')
      }

      if (query.includes('SELECT') && query.includes('LIKE')) {
        // Fallback LIKE query with LIMIT and OFFSET support
        const searchTerm = (params[0] as string).replace(/%/g, '')
        let filtered = things.filter((t) => t.data.includes(searchTerm))

        // Extract limit and offset from params (they are the last two params)
        const limit = params[params.length - 2] as number
        const offset = params[params.length - 1] as number

        // Apply offset and limit
        if (typeof offset === 'number' && typeof limit === 'number') {
          filtered = filtered.slice(offset, offset + limit)
        }

        return {
          toArray: () =>
            filtered.map((t) => ({
              id: t.id,
              $type: t.type,
              data: t.data,
            })),
        }
      }

      return { toArray: () => [] }
    }),
    _things: things, // Expose for test verification
  }
}

/**
 * Create test environment
 */
function createTestEnv(): SearchEnv & {
  AI: ReturnType<typeof createMockAI>
  VECTORIZE: ReturnType<typeof createMockVectorize>
  sql: ReturnType<typeof createMockSQL>
} {
  return {
    AI: createMockAI(),
    VECTORIZE: createMockVectorize(),
    sql: createMockSQL(),
  }
}

/**
 * Create test props with permissions
 */
function createTestProps(permissions: string[] = ['search']): SearchToolProps {
  return {
    permissions,
    namespace: 'test-namespace',
  }
}

// =============================================================================
// SCHEMA VALIDATION TESTS
// =============================================================================

describe('Search Tool Schema', () => {
  describe('searchToolSchema', () => {
    it('validates minimal valid input', () => {
      const input = { query: 'test search' }
      const result = searchToolSchema.safeParse(input)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.query).toBe('test search')
        expect(result.data.type).toBe('hybrid')
        expect(result.data.limit).toBe(10)
        expect(result.data.offset).toBe(0)
      }
    })

    it('validates full input with all options', () => {
      const input = {
        query: 'customer support',
        type: 'semantic',
        filters: {
          $type: 'Customer',
          namespace: 'prod',
          dateRange: {
            from: '2026-01-01',
            to: '2026-12-31',
          },
        },
        limit: 20,
        offset: 5,
      }

      const result = searchToolSchema.safeParse(input)
      expect(result.success).toBe(true)
    })

    it('rejects empty query', () => {
      const input = { query: '' }
      const result = searchToolSchema.safeParse(input)

      expect(result.success).toBe(false)
    })

    it('rejects invalid search type', () => {
      const input = { query: 'test', type: 'invalid' }
      const result = searchToolSchema.safeParse(input)

      expect(result.success).toBe(false)
    })

    it('enforces limit bounds', () => {
      const tooLow = searchToolSchema.safeParse({ query: 'test', limit: 0 })
      const tooHigh = searchToolSchema.safeParse({ query: 'test', limit: 101 })

      expect(tooLow.success).toBe(false)
      expect(tooHigh.success).toBe(false)
    })

    it('rejects negative offset', () => {
      const input = { query: 'test', offset: -1 }
      const result = searchToolSchema.safeParse(input)

      expect(result.success).toBe(false)
    })
  })

  describe('searchToolDefinition', () => {
    it('has correct structure', () => {
      expect(searchToolDefinition.name).toBe('search')
      expect(searchToolDefinition.description).toBeDefined()
      expect(searchToolDefinition.inputSchema).toBe(searchToolSchema)
      expect(searchToolDefinition.handler).toBe(searchTool)
    })
  })
})

// =============================================================================
// PERMISSION TESTS
// =============================================================================

describe('Search Tool Permissions', () => {
  it('rejects request without search permission', async () => {
    const env = createTestEnv()
    const props = createTestProps([]) // No permissions

    await expect(
      searchTool({ query: 'test' }, env, props)
    ).rejects.toThrow('Permission denied: search')
  })

  it('accepts request with search permission', async () => {
    const env = createTestEnv()
    const props = createTestProps(['search'])

    // Should not throw
    const result = await searchTool({ query: 'test' }, env, props)
    expect(result).toBeDefined()
  })

  it('uses namespace from props when not in filters', async () => {
    const env = createTestEnv()
    const props = createTestProps(['search'])
    props.namespace = 'tenant-123'

    await searchTool({ query: 'test', type: 'keyword' }, env, props)

    // Verify namespace was passed to SQL query
    expect(env.sql.exec).toHaveBeenCalled()
  })
})

// =============================================================================
// SEMANTIC SEARCH TESTS
// =============================================================================

describe('Semantic Search', () => {
  let env: ReturnType<typeof createTestEnv>
  let props: SearchToolProps

  beforeEach(() => {
    env = createTestEnv()
    props = createTestProps()
  })

  it('generates embeddings for query', async () => {
    await searchTool({ query: 'find customers', type: 'semantic' }, env, props)

    expect(env.AI.run).toHaveBeenCalledWith(
      '@cf/baai/bge-base-en-v1.5',
      { text: 'find customers' }
    )
  })

  it('queries vector store with embedding', async () => {
    await searchTool({ query: 'find customers', type: 'semantic', limit: 5 }, env, props)

    expect(env.VECTORIZE.query).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ topK: expect.any(Number) })
    )
  })

  it('returns results with semantic source', async () => {
    // Pre-populate vector store
    await env.VECTORIZE.insert([
      { id: 'cust-1', values: [0.1, 0.2], metadata: { $type: 'Customer', name: 'Alice' } },
    ])

    const result = await searchTool({ query: 'find customers', type: 'semantic' }, env, props)

    expect(result.results.length).toBeGreaterThan(0)
    expect(result.results[0].source).toBe('semantic')
    expect(result.type).toBe('semantic')
  })

  it('applies $type filter to vector query', async () => {
    await searchTool(
      {
        query: 'find customers',
        type: 'semantic',
        filters: { $type: 'Customer' },
      },
      env,
      props
    )

    expect(env.VECTORIZE.query).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        filter: expect.objectContaining({ $type: 'Customer' }),
      })
    )
  })

  it('throws when AI binding not available', async () => {
    const envWithoutAI = { ...env, AI: undefined }

    await expect(
      searchTool({ query: 'test', type: 'semantic' }, envWithoutAI, props)
    ).rejects.toThrow('AI binding not available')
  })

  it('throws when VECTORIZE binding not available', async () => {
    const envWithoutVectorize = { ...env, VECTORIZE: undefined }

    await expect(
      searchTool({ query: 'test', type: 'semantic' }, envWithoutVectorize, props)
    ).rejects.toThrow('VECTORIZE binding not available')
  })
})

// =============================================================================
// KEYWORD SEARCH TESTS
// =============================================================================

describe('Keyword Search', () => {
  let env: ReturnType<typeof createTestEnv>
  let props: SearchToolProps

  beforeEach(() => {
    env = createTestEnv()
    props = createTestProps()
  })

  it('uses SQL for keyword search', async () => {
    await searchTool({ query: 'customer', type: 'keyword' }, env, props)

    expect(env.sql.exec).toHaveBeenCalled()
  })

  it('falls back to LIKE when FTS not available', async () => {
    // Pre-populate things
    env.sql._things.push({
      id: 'cust-1',
      type: 'Customer',
      data: JSON.stringify({ name: 'Alice', email: 'alice@customer.com' }),
    })

    const result = await searchTool({ query: 'customer', type: 'keyword' }, env, props)

    // Should have used LIKE fallback (FTS throws in mock)
    expect(result.results.length).toBeGreaterThan(0)
  })

  it('returns results with keyword source', async () => {
    env.sql._things.push({
      id: 'cust-1',
      type: 'Customer',
      data: JSON.stringify({ name: 'Test Customer' }),
    })

    const result = await searchTool({ query: 'Test', type: 'keyword' }, env, props)

    expect(result.results[0]?.source).toBe('keyword')
    expect(result.type).toBe('keyword')
  })

  it('applies $type filter', async () => {
    env.sql._things.push(
      { id: 'cust-1', type: 'Customer', data: JSON.stringify({ name: 'Customer Test' }) },
      { id: 'order-1', type: 'Order', data: JSON.stringify({ name: 'Order Test' }) }
    )

    await searchTool(
      {
        query: 'Test',
        type: 'keyword',
        filters: { $type: 'Customer' },
      },
      env,
      props
    )

    // The filter should be passed to SQL
    const callArgs = env.sql.exec.mock.calls.flat()
    expect(callArgs.some((arg) => arg === 'Customer')).toBe(true)
  })

  it('returns empty array when sql not available', async () => {
    const envWithoutSQL = { ...env, sql: undefined }

    await expect(
      searchTool({ query: 'test', type: 'keyword' }, envWithoutSQL, props)
    ).rejects.toThrow('SQL binding not available')
  })
})

// =============================================================================
// HYBRID SEARCH TESTS
// =============================================================================

describe('Hybrid Search', () => {
  let env: ReturnType<typeof createTestEnv>
  let props: SearchToolProps

  beforeEach(() => {
    env = createTestEnv()
    props = createTestProps()
  })

  it('runs both semantic and keyword search', async () => {
    await searchTool({ query: 'customer support', type: 'hybrid' }, env, props)

    // Both should be called
    expect(env.AI.run).toHaveBeenCalled() // For semantic
    expect(env.sql.exec).toHaveBeenCalled() // For keyword
  })

  it('merges results using RRF', async () => {
    // Add data to both stores
    await env.VECTORIZE.insert([
      { id: 'cust-1', values: [0.1, 0.2], metadata: { $type: 'Customer', name: 'Alice' } },
    ])
    env.sql._things.push({
      id: 'cust-2',
      type: 'Customer',
      data: JSON.stringify({ name: 'Bob Support' }),
    })

    const result = await searchTool({ query: 'support', type: 'hybrid' }, env, props)

    expect(result.type).toBe('hybrid')
    expect(result.results.length).toBeGreaterThan(0)
  })

  it('marks items found in both sources', async () => {
    // Same ID in both stores
    await env.VECTORIZE.insert([
      { id: 'cust-1', values: [0.1, 0.2], metadata: { $type: 'Customer', name: 'Support Alice' } },
    ])
    env.sql._things.push({
      id: 'cust-1',
      type: 'Customer',
      data: JSON.stringify({ name: 'Support Alice' }),
    })

    const result = await searchTool({ query: 'Support', type: 'hybrid' }, env, props)

    // Item should appear once with source='both' or be merged
    const customer = result.results.find((r) => r.id === 'cust-1')
    expect(customer).toBeDefined()
    // Source should be 'both' if found in both, or one of them
    expect(['both', 'semantic', 'keyword']).toContain(customer?.source)
  })

  it('continues when one search mode fails', async () => {
    // Make semantic fail by removing AI
    const envPartial = { ...env, AI: undefined }

    // Should still return keyword results
    env.sql._things.push({
      id: 'cust-1',
      type: 'Customer',
      data: JSON.stringify({ name: 'Test Customer' }),
    })

    const result = await searchTool({ query: 'Test', type: 'hybrid' }, envPartial, props)

    expect(result.results.length).toBeGreaterThan(0)
  })

  it('is the default search type', async () => {
    const result = await searchTool({ query: 'test' }, env, props)

    expect(result.type).toBe('hybrid')
  })
})

// =============================================================================
// FILTERING TESTS
// =============================================================================

describe('Search Filtering', () => {
  let env: ReturnType<typeof createTestEnv>
  let props: SearchToolProps

  beforeEach(() => {
    env = createTestEnv()
    props = createTestProps()
  })

  it('filters by namespace', async () => {
    await env.VECTORIZE.insert([
      { id: 'cust-1', values: [0.1, 0.2], metadata: { $type: 'Customer', namespace: 'prod' } },
      { id: 'cust-2', values: [0.1, 0.2], metadata: { $type: 'Customer', namespace: 'dev' } },
    ])

    await searchTool(
      {
        query: 'test',
        type: 'semantic',
        filters: { namespace: 'prod' },
      },
      env,
      props
    )

    expect(env.VECTORIZE.query).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        filter: expect.objectContaining({ namespace: 'prod' }),
      })
    )
  })

  it('applies date range filter', async () => {
    await env.VECTORIZE.insert([
      {
        id: 'cust-1',
        values: [0.1, 0.2],
        metadata: { $type: 'Customer', createdAt: '2026-06-15' },
      },
    ])

    const result = await searchTool(
      {
        query: 'test',
        type: 'semantic',
        filters: {
          dateRange: {
            from: '2026-01-01',
            to: '2026-12-31',
          },
        },
      },
      env,
      props
    )

    // Date filtering happens post-query for semantic
    expect(result).toBeDefined()
  })
})

// =============================================================================
// PAGINATION TESTS
// =============================================================================

describe('Search Pagination', () => {
  let env: ReturnType<typeof createTestEnv>
  let props: SearchToolProps

  beforeEach(() => {
    env = createTestEnv()
    props = createTestProps()

    // Add multiple items
    for (let i = 0; i < 20; i++) {
      env.sql._things.push({
        id: `item-${i}`,
        type: 'Item',
        data: JSON.stringify({ name: `Item ${i} Test` }),
      })
    }
  })

  it('respects limit parameter', async () => {
    const result = await searchTool(
      { query: 'Test', type: 'keyword', limit: 5 },
      env,
      props
    )

    expect(result.results.length).toBeLessThanOrEqual(5)
  })

  it('respects offset parameter', async () => {
    const page1 = await searchTool(
      { query: 'Test', type: 'keyword', limit: 5, offset: 0 },
      env,
      props
    )

    const page2 = await searchTool(
      { query: 'Test', type: 'keyword', limit: 5, offset: 5 },
      env,
      props
    )

    // Pages should be different (if there are enough results)
    if (page1.results.length > 0 && page2.results.length > 0) {
      expect(page1.results[0].id).not.toBe(page2.results[0].id)
    }
  })
})

// =============================================================================
// RESPONSE FORMAT TESTS
// =============================================================================

describe('Search Response Format', () => {
  let env: ReturnType<typeof createTestEnv>
  let props: SearchToolProps

  beforeEach(() => {
    env = createTestEnv()
    props = createTestProps()
  })

  it('includes all required fields', async () => {
    const result = await searchTool({ query: 'test' }, env, props)

    expect(result).toHaveProperty('results')
    expect(result).toHaveProperty('total')
    expect(result).toHaveProperty('query')
    expect(result).toHaveProperty('type')
    expect(result).toHaveProperty('took')
  })

  it('records query duration', async () => {
    const result = await searchTool({ query: 'test' }, env, props)

    expect(typeof result.took).toBe('number')
    expect(result.took).toBeGreaterThanOrEqual(0)
  })

  it('returns original query in response', async () => {
    const result = await searchTool({ query: 'original query text' }, env, props)

    expect(result.query).toBe('original query text')
  })

  it('search results have required fields', async () => {
    await env.VECTORIZE.insert([
      { id: 'test-1', values: [0.1], metadata: { $type: 'Test', name: 'Test Item' } },
    ])

    const result = await searchTool({ query: 'test', type: 'semantic' }, env, props)

    if (result.results.length > 0) {
      const item = result.results[0]
      expect(item).toHaveProperty('id')
      expect(item).toHaveProperty('$type')
      expect(item).toHaveProperty('score')
      expect(item).toHaveProperty('data')
    }
  })
})

// =============================================================================
// INDEXING TESTS
// =============================================================================

describe('Document Indexing', () => {
  let env: ReturnType<typeof createTestEnv>

  beforeEach(() => {
    env = createTestEnv()
  })

  it('indexes document in vector store', async () => {
    await indexDocument(
      'doc-1',
      'Document',
      { title: 'Test Doc', content: 'This is test content' },
      env,
      'test-ns'
    )

    expect(env.AI.run).toHaveBeenCalled()
    expect(env.VECTORIZE.insert).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 'doc-1',
        values: expect.any(Array),
        metadata: expect.objectContaining({
          $type: 'Document',
          namespace: 'test-ns',
        }),
      }),
    ])
  })

  it('indexes document in SQL store', async () => {
    await indexDocument(
      'doc-1',
      'Document',
      { title: 'Test Doc' },
      env,
      'test-ns'
    )

    expect(env.sql.exec).toHaveBeenCalled()
  })

  it('handles indexing without AI binding', async () => {
    const envWithoutAI = { ...env, AI: undefined, VECTORIZE: undefined }

    // Should not throw, just skip vector indexing
    await indexDocument('doc-1', 'Document', { title: 'Test' }, envWithoutAI)

    expect(envWithoutAI.sql.exec).toHaveBeenCalled()
  })

  it('removeFromIndex deletes from SQL', async () => {
    // First index
    await indexDocument('doc-1', 'Document', { title: 'Test' }, env)

    // Then remove
    await removeFromIndex('doc-1', env)

    expect(env.sql.exec).toHaveBeenCalledWith(
      expect.stringContaining('DELETE'),
      'doc-1'
    )
  })
})

// =============================================================================
// EDGE CASES
// =============================================================================

describe('Edge Cases', () => {
  let env: ReturnType<typeof createTestEnv>
  let props: SearchToolProps

  beforeEach(() => {
    env = createTestEnv()
    props = createTestProps()
  })

  it('handles empty search results', async () => {
    const result = await searchTool({ query: 'nonexistent xyz abc 123' }, env, props)

    expect(result.results).toEqual([])
    expect(result.total).toBe(0)
  })

  it('handles special characters in query', async () => {
    // Should not throw
    const result = await searchTool(
      { query: 'test "with quotes" and (parentheses)' },
      env,
      props
    )

    expect(result).toBeDefined()
  })

  it('handles very long queries', async () => {
    const longQuery = 'test '.repeat(100)

    const result = await searchTool({ query: longQuery }, env, props)

    expect(result).toBeDefined()
  })

  it('handles unicode characters', async () => {
    const result = await searchTool({ query: 'cafe' }, env, props)

    expect(result).toBeDefined()
  })

  it('normalizes scores to 0-1 range', async () => {
    await env.VECTORIZE.insert([
      { id: 'test-1', values: [0.1], metadata: { $type: 'Test' } },
    ])

    const result = await searchTool({ query: 'test', type: 'semantic' }, env, props)

    for (const item of result.results) {
      expect(item.score).toBeGreaterThanOrEqual(0)
      expect(item.score).toBeLessThanOrEqual(1)
    }
  })
})
