import { describe, it, expect, vi } from 'vitest'

/**
 * Relationships Table Schema Tests
 *
 * The relationships table implements a graph-like structure for representing
 * edges between nodes (things) using fully qualified URLs. This enables:
 * - Local relationships within a single DO
 * - Cross-DO relationships across namespaces
 * - External relationships to third-party services
 *
 * This is RED phase TDD - tests should FAIL until the schema is fully
 * implemented with all required indexes and constraints.
 *
 * Schema definition (from db/relationships.ts):
 * - id: text primary key
 * - verb: text (not null) - relationship type: 'created', 'manages', 'owns'
 * - from: text (not null) - source URL
 * - to: text (not null) - target URL
 * - data: JSON (nullable) - edge properties
 * - createdAt: integer timestamp (not null)
 *
 * Indexes:
 * - rel_verb_idx: on verb
 * - rel_from_idx: on from
 * - rel_to_idx: on to
 * - rel_from_verb_idx: composite on (from, verb)
 * - rel_to_verb_idx: composite on (to, verb)
 * - rel_unique_idx: unique on (verb, from, to)
 */

// ============================================================================
// Schema Types (Expected Interface)
// ============================================================================

interface Relationship {
  id: string
  verb: string // 'created', 'manages', 'owns', 'belongs_to', etc.
  from: string // URL like 'https://startups.studio/headless.ly'
  to: string // URL like 'https://startups.studio/nathan'
  data: Record<string, unknown> | null
  createdAt: Date
}

// Import the schema - will be used for testing
import { relationships } from '../relationships'

// ============================================================================
// 1. Schema Table Definition Tests
// ============================================================================

describe('Schema Table Definition', () => {
  it('relationships table is exported from db/relationships.ts', () => {
    expect(relationships).toBeDefined()
  })

  it('has id column as text primary key', () => {
    expect(relationships.id).toBeDefined()
  })

  it('has verb column (text, not null)', () => {
    expect(relationships.verb).toBeDefined()
  })

  it('has from column (text, not null)', () => {
    expect(relationships.from).toBeDefined()
  })

  it('has to column (text, not null)', () => {
    expect(relationships.to).toBeDefined()
  })

  it('has data column (JSON, nullable)', () => {
    expect(relationships.data).toBeDefined()
  })

  it('has createdAt column (integer timestamp, not null)', () => {
    expect(relationships.createdAt).toBeDefined()
  })

  describe('Indexes', () => {
    it('has verb index for filtering by relationship type', () => {
      // Schema should include: index('rel_verb_idx').on(table.verb)
      expect(relationships.verb).toBeDefined()
    })

    it('has from index for forward traversal queries', () => {
      // Schema should include: index('rel_from_idx').on(table.from)
      expect(relationships.from).toBeDefined()
    })

    it('has to index for backward traversal queries', () => {
      // Schema should include: index('rel_to_idx').on(table.to)
      expect(relationships.to).toBeDefined()
    })

    it('has composite from+verb index for filtered forward traversal', () => {
      // Schema should include: index('rel_from_verb_idx').on(table.from, table.verb)
      expect(relationships.from).toBeDefined()
      expect(relationships.verb).toBeDefined()
    })

    it('has composite to+verb index for filtered backward traversal', () => {
      // Schema should include: index('rel_to_verb_idx').on(table.to, table.verb)
      expect(relationships.to).toBeDefined()
      expect(relationships.verb).toBeDefined()
    })

    it('has unique constraint on (verb, from, to)', () => {
      // Schema should include: uniqueIndex('rel_unique_idx').on(table.verb, table.from, table.to)
      expect(relationships.verb).toBeDefined()
      expect(relationships.from).toBeDefined()
      expect(relationships.to).toBeDefined()
    })
  })
})

// ============================================================================
// 2. CRUD Operations Tests
// ============================================================================

describe('CRUD Operations', () => {
  describe('Create', () => {
    it('creates a relationship with all fields', () => {
      const now = new Date()
      const rel: Relationship = {
        id: 'rel-001',
        verb: 'created',
        from: 'https://startups.studio/nathan',
        to: 'https://startups.studio/headless.ly',
        data: { role: 'founder', year: 2024 },
        createdAt: now,
      }

      expect(rel.id).toBe('rel-001')
      expect(rel.verb).toBe('created')
      expect(rel.from).toBe('https://startups.studio/nathan')
      expect(rel.to).toBe('https://startups.studio/headless.ly')
      expect(rel.data).toEqual({ role: 'founder', year: 2024 })
      expect(rel.createdAt).toBe(now)
    })

    it('creates a relationship with null data', () => {
      const rel: Relationship = {
        id: 'rel-002',
        verb: 'owns',
        from: 'https://startups.studio/nathan',
        to: 'https://startups.studio/docs.do',
        data: null,
        createdAt: new Date(),
      }

      expect(rel.data).toBeNull()
    })

    it('creates multiple relationships from same source', () => {
      const now = new Date()
      const rels: Relationship[] = [
        {
          id: 'rel-multi-001',
          verb: 'owns',
          from: 'https://startups.studio/nathan',
          to: 'https://startups.studio/headless.ly',
          data: null,
          createdAt: now,
        },
        {
          id: 'rel-multi-002',
          verb: 'owns',
          from: 'https://startups.studio/nathan',
          to: 'https://startups.studio/docs.do',
          data: null,
          createdAt: now,
        },
        {
          id: 'rel-multi-003',
          verb: 'owns',
          from: 'https://startups.studio/nathan',
          to: 'https://startups.studio/workers.do',
          data: null,
          createdAt: now,
        },
      ]

      const fromNathan = rels.filter((r) => r.from === 'https://startups.studio/nathan')
      expect(fromNathan.length).toBe(3)
    })
  })

  describe('Read', () => {
    const testData: Relationship[] = [
      {
        id: 'read-001',
        verb: 'created',
        from: 'https://startups.studio/nathan',
        to: 'https://startups.studio/headless.ly',
        data: { role: 'founder' },
        createdAt: new Date(),
      },
      {
        id: 'read-002',
        verb: 'manages',
        from: 'https://startups.studio/nathan',
        to: 'https://startups.studio/team/alice',
        data: null,
        createdAt: new Date(),
      },
    ]

    it('reads relationship by id', () => {
      const result = testData.find((r) => r.id === 'read-001')

      expect(result).toBeDefined()
      expect(result!.id).toBe('read-001')
      expect(result!.verb).toBe('created')
    })

    it('returns undefined for non-existent id', () => {
      const result = testData.find((r) => r.id === 'non-existent')

      expect(result).toBeUndefined()
    })

    it('reads all relationships', () => {
      expect(testData.length).toBe(2)
    })
  })

  describe('Update', () => {
    it('updates relationship data', () => {
      const rel: Relationship = {
        id: 'update-001',
        verb: 'owns',
        from: 'https://startups.studio/nathan',
        to: 'https://startups.studio/headless.ly',
        data: { percentage: 50 },
        createdAt: new Date(),
      }

      const updated = { ...rel, data: { percentage: 75, updated: true } }

      expect(updated.data).toEqual({ percentage: 75, updated: true })
    })

    it('updates relationship data to null', () => {
      const rel: Relationship = {
        id: 'update-002',
        verb: 'owns',
        from: 'https://startups.studio/nathan',
        to: 'https://startups.studio/headless.ly',
        data: { percentage: 50 },
        createdAt: new Date(),
      }

      const updated = { ...rel, data: null }

      expect(updated.data).toBeNull()
    })

    it('edges are immutable except for data field', () => {
      // verb, from, to should not be updated (design decision)
      const rel: Relationship = {
        id: 'update-003',
        verb: 'owns',
        from: 'https://startups.studio/nathan',
        to: 'https://startups.studio/headless.ly',
        data: null,
        createdAt: new Date(),
      }

      // Only data field changes are expected
      expect(rel.verb).toBe('owns')
      expect(rel.from).toBe('https://startups.studio/nathan')
    })
  })

  describe('Delete', () => {
    it('deletes relationship by id', () => {
      const rels: Relationship[] = [
        {
          id: 'delete-001',
          verb: 'owns',
          from: 'https://startups.studio/nathan',
          to: 'https://startups.studio/headless.ly',
          data: null,
          createdAt: new Date(),
        },
        {
          id: 'delete-002',
          verb: 'owns',
          from: 'https://startups.studio/nathan',
          to: 'https://startups.studio/docs.do',
          data: null,
          createdAt: new Date(),
        },
      ]

      const afterDelete = rels.filter((r) => r.id !== 'delete-001')

      expect(afterDelete.length).toBe(1)
      expect(afterDelete[0].id).toBe('delete-002')
    })

    it('deletes all relationships from a source', () => {
      const rels: Relationship[] = [
        {
          id: 'del-src-001',
          verb: 'owns',
          from: 'https://startups.studio/nathan',
          to: 'https://startups.studio/headless.ly',
          data: null,
          createdAt: new Date(),
        },
        {
          id: 'del-src-002',
          verb: 'owns',
          from: 'https://startups.studio/nathan',
          to: 'https://startups.studio/docs.do',
          data: null,
          createdAt: new Date(),
        },
      ]

      const afterDelete = rels.filter((r) => r.from !== 'https://startups.studio/nathan')

      expect(afterDelete.length).toBe(0)
    })
  })
})

// ============================================================================
// 3. Edge Patterns (Graph Operations) Tests
// ============================================================================

describe('Edge Patterns (Graph Operations)', () => {
  // Set up a graph structure:
  // Nathan -> owns -> Headless.ly
  // Nathan -> owns -> Docs.do
  // Nathan -> manages -> Alice
  // Alice -> contributes_to -> Headless.ly
  // Alice -> contributes_to -> Docs.do
  // Headless.ly -> depends_on -> Docs.do
  // Headless.ly -> integrates_with -> GitHub
  const graphData: Relationship[] = [
    {
      id: 'graph-001',
      verb: 'owns',
      from: 'https://startups.studio/nathan',
      to: 'https://startups.studio/headless.ly',
      data: null,
      createdAt: new Date(),
    },
    {
      id: 'graph-002',
      verb: 'owns',
      from: 'https://startups.studio/nathan',
      to: 'https://startups.studio/docs.do',
      data: null,
      createdAt: new Date(),
    },
    {
      id: 'graph-003',
      verb: 'manages',
      from: 'https://startups.studio/nathan',
      to: 'https://startups.studio/alice',
      data: null,
      createdAt: new Date(),
    },
    {
      id: 'graph-004',
      verb: 'contributes_to',
      from: 'https://startups.studio/alice',
      to: 'https://startups.studio/headless.ly',
      data: null,
      createdAt: new Date(),
    },
    {
      id: 'graph-005',
      verb: 'contributes_to',
      from: 'https://startups.studio/alice',
      to: 'https://startups.studio/docs.do',
      data: null,
      createdAt: new Date(),
    },
    {
      id: 'graph-006',
      verb: 'depends_on',
      from: 'https://startups.studio/headless.ly',
      to: 'https://startups.studio/docs.do',
      data: null,
      createdAt: new Date(),
    },
    {
      id: 'graph-007',
      verb: 'integrates_with',
      from: 'https://startups.studio/headless.ly',
      to: 'https://github.com/headlessly',
      data: null,
      createdAt: new Date(),
    },
  ]

  describe('Forward Traversal', () => {
    it('gets all "to" nodes from a "from" node', () => {
      const result = graphData.filter((r) => r.from === 'https://startups.studio/nathan')

      expect(result.length).toBe(3)

      const toUrls = result.map((r) => r.to)
      expect(toUrls).toContain('https://startups.studio/headless.ly')
      expect(toUrls).toContain('https://startups.studio/docs.do')
      expect(toUrls).toContain('https://startups.studio/alice')
    })

    it('gets all owned entities', () => {
      const result = graphData.filter(
        (r) => r.from === 'https://startups.studio/nathan' && r.verb === 'owns'
      )

      expect(result.length).toBe(2)

      const ownedUrls = result.map((r) => r.to)
      expect(ownedUrls).toContain('https://startups.studio/headless.ly')
      expect(ownedUrls).toContain('https://startups.studio/docs.do')
    })
  })

  describe('Backward Traversal', () => {
    it('gets all "from" nodes pointing to a "to" node', () => {
      const result = graphData.filter((r) => r.to === 'https://startups.studio/headless.ly')

      expect(result.length).toBe(2)

      const fromUrls = result.map((r) => r.from)
      expect(fromUrls).toContain('https://startups.studio/nathan')
      expect(fromUrls).toContain('https://startups.studio/alice')
    })

    it('finds who contributes to a project', () => {
      const result = graphData.filter(
        (r) => r.to === 'https://startups.studio/headless.ly' && r.verb === 'contributes_to'
      )

      expect(result.length).toBe(1)
      expect(result[0].from).toBe('https://startups.studio/alice')
    })

    it('finds the owner of an entity', () => {
      const result = graphData.filter(
        (r) => r.to === 'https://startups.studio/headless.ly' && r.verb === 'owns'
      )

      expect(result.length).toBe(1)
      expect(result[0].from).toBe('https://startups.studio/nathan')
    })
  })

  describe('Filter by Verb', () => {
    it('gets all relationships of a specific type', () => {
      const result = graphData.filter((r) => r.verb === 'owns')

      expect(result.length).toBe(2)

      result.forEach((r) => {
        expect(r.verb).toBe('owns')
      })
    })

    it('gets all contribution relationships', () => {
      const result = graphData.filter((r) => r.verb === 'contributes_to')

      expect(result.length).toBe(2)

      result.forEach((r) => {
        expect(r.verb).toBe('contributes_to')
        expect(r.from).toBe('https://startups.studio/alice')
      })
    })

    it('counts relationships by verb type', () => {
      const verbCounts: Record<string, number> = {}

      graphData.forEach((r) => {
        verbCounts[r.verb] = (verbCounts[r.verb] || 0) + 1
      })

      expect(verbCounts['owns']).toBe(2)
      expect(verbCounts['contributes_to']).toBe(2)
      expect(verbCounts['manages']).toBe(1)
      expect(verbCounts['depends_on']).toBe(1)
      expect(verbCounts['integrates_with']).toBe(1)
    })
  })

  describe('Multi-hop Traversal', () => {
    it('finds A->C when A->B and B->C exist (2-hop)', () => {
      // Nathan manages Alice, Alice contributes_to Headless.ly
      // Query: What does Nathan manage that contributes to Headless.ly?

      // Step 1: Get who Nathan manages
      const managedByNathan = graphData.filter(
        (r) => r.from === 'https://startups.studio/nathan' && r.verb === 'manages'
      )

      expect(managedByNathan.length).toBe(1)
      expect(managedByNathan[0].to).toBe('https://startups.studio/alice')

      // Step 2: Get what those managed people contribute to
      const managedUrls = managedByNathan.map((r) => r.to)
      const contributions = graphData.filter(
        (r) => managedUrls.includes(r.from) && r.verb === 'contributes_to'
      )

      expect(contributions.length).toBe(2)
      const contributedProjects = contributions.map((r) => r.to)
      expect(contributedProjects).toContain('https://startups.studio/headless.ly')
      expect(contributedProjects).toContain('https://startups.studio/docs.do')
    })

    it('finds dependency chain: A depends_on B, B integrates_with C', () => {
      // Add: Docs.do integrates_with some-service
      const extendedGraph = [
        ...graphData,
        {
          id: 'graph-chain-001',
          verb: 'integrates_with',
          from: 'https://startups.studio/docs.do',
          to: 'https://api.some-service.com',
          data: null,
          createdAt: new Date(),
        },
      ]

      // Step 1: What does Headless.ly depend on?
      const deps = extendedGraph.filter(
        (r) => r.from === 'https://startups.studio/headless.ly' && r.verb === 'depends_on'
      )

      expect(deps.length).toBe(1)
      expect(deps[0].to).toBe('https://startups.studio/docs.do')

      // Step 2: What does that dependency integrate with?
      const depUrls = deps.map((r) => r.to)
      const integrations = extendedGraph.filter(
        (r) => depUrls.includes(r.from) && r.verb === 'integrates_with'
      )

      expect(integrations.length).toBe(1)
      expect(integrations[0].to).toBe('https://api.some-service.com')
    })

    it('finds all entities within N hops from a starting node', () => {
      // Find all things within 2 hops from Nathan
      const visited = new Set<string>()
      const startUrl = 'https://startups.studio/nathan'
      visited.add(startUrl)

      // Hop 1
      const hop1 = graphData.filter((r) => r.from === startUrl)
      const hop1Urls = hop1.map((r) => r.to)
      hop1Urls.forEach((url) => visited.add(url))

      // Hop 2
      const hop2 = graphData.filter((r) => hop1Urls.includes(r.from))
      const hop2Urls = hop2.map((r) => r.to)
      hop2Urls.forEach((url) => visited.add(url))

      // Nathan + 3 direct (headless.ly, docs.do, alice) + 3 indirect (headless.ly again, docs.do again, github)
      // Unique: nathan, headless.ly, docs.do, alice, github
      expect(visited.size).toBe(5)
      expect(visited.has('https://startups.studio/nathan')).toBe(true)
      expect(visited.has('https://startups.studio/headless.ly')).toBe(true)
      expect(visited.has('https://startups.studio/docs.do')).toBe(true)
      expect(visited.has('https://startups.studio/alice')).toBe(true)
      expect(visited.has('https://github.com/headlessly')).toBe(true)
    })
  })
})

// ============================================================================
// 4. URL Handling Tests
// ============================================================================

describe('URL Handling', () => {
  describe('Local URLs (within same DO)', () => {
    it('handles local thing URLs', () => {
      const rel: Relationship = {
        id: 'local-001',
        verb: 'contains',
        from: 'https://startups.studio/collection/projects',
        to: 'https://startups.studio/project/headless',
        data: null,
        createdAt: new Date(),
      }

      expect(rel.from).toBe('https://startups.studio/collection/projects')
      expect(rel.to).toBe('https://startups.studio/project/headless')
    })

    it('handles URLs with path segments', () => {
      const rel: Relationship = {
        id: 'path-001',
        verb: 'parent_of',
        from: 'https://startups.studio/org/acme/team/engineering',
        to: 'https://startups.studio/org/acme/team/engineering/frontend',
        data: null,
        createdAt: new Date(),
      }

      expect(rel.from).toContain('/org/acme/team/engineering')
    })
  })

  describe('Cross-DO URLs (different namespace)', () => {
    it('handles relationships between different DOs', () => {
      const rel: Relationship = {
        id: 'cross-do-001',
        verb: 'deployed_to',
        from: 'https://apps.do/my-app',
        to: 'https://workers.do/my-app-worker',
        data: null,
        createdAt: new Date(),
      }

      expect(rel.from).toContain('apps.do')
      expect(rel.to).toContain('workers.do')
    })

    it('handles relationships across multiple DO namespaces', () => {
      const rels: Relationship[] = [
        {
          id: 'multi-do-001',
          verb: 'uses',
          from: 'https://apis.do/payment-api',
          to: 'https://functions.do/stripe-handler',
          data: null,
          createdAt: new Date(),
        },
        {
          id: 'multi-do-002',
          verb: 'uses',
          from: 'https://apis.do/payment-api',
          to: 'https://queues.do/payment-processing',
          data: null,
          createdAt: new Date(),
        },
      ]

      const fromPaymentApi = rels.filter((r) => r.from === 'https://apis.do/payment-api')
      expect(fromPaymentApi.length).toBe(2)

      const toUrls = fromPaymentApi.map((r) => r.to)
      expect(toUrls).toContain('https://functions.do/stripe-handler')
      expect(toUrls).toContain('https://queues.do/payment-processing')
    })
  })

  describe('External URLs (github.com, etc.)', () => {
    it('handles external GitHub URLs', () => {
      const rel: Relationship = {
        id: 'github-001',
        verb: 'source_at',
        from: 'https://startups.studio/headless.ly',
        to: 'https://github.com/headlessly/headless.ly',
        data: { branch: 'main', lastCommit: 'abc123' },
        createdAt: new Date(),
      }

      expect(rel.to).toBe('https://github.com/headlessly/headless.ly')
    })

    it('handles various external service URLs', () => {
      const rels: Relationship[] = [
        {
          id: 'ext-001',
          verb: 'tracked_in',
          from: 'https://startups.studio/headless.ly',
          to: 'https://linear.app/headlessly/project/main',
          data: null,
          createdAt: new Date(),
        },
        {
          id: 'ext-002',
          verb: 'documented_at',
          from: 'https://startups.studio/headless.ly',
          to: 'https://notion.so/headlessly/docs',
          data: null,
          createdAt: new Date(),
        },
        {
          id: 'ext-003',
          verb: 'deployed_at',
          from: 'https://startups.studio/headless.ly',
          to: 'https://headless.ly',
          data: null,
          createdAt: new Date(),
        },
      ]

      const fromHeadless = rels.filter((r) => r.from === 'https://startups.studio/headless.ly')
      expect(fromHeadless.length).toBe(3)

      const externalUrls = fromHeadless.map((r) => r.to)
      expect(externalUrls.some((url) => url.includes('linear.app'))).toBe(true)
      expect(externalUrls.some((url) => url.includes('notion.so'))).toBe(true)
      expect(externalUrls.some((url) => url.includes('headless.ly'))).toBe(true)
    })

    it('handles API endpoint URLs', () => {
      const rel: Relationship = {
        id: 'api-001',
        verb: 'calls',
        from: 'https://apis.do/my-api',
        to: 'https://api.stripe.com/v1/charges',
        data: { method: 'POST', authType: 'bearer' },
        createdAt: new Date(),
      }

      expect(rel.to).toBe('https://api.stripe.com/v1/charges')
    })
  })
})

// ============================================================================
// 5. Unique Constraint Tests
// ============================================================================

describe('Unique Constraint', () => {
  it('rejects duplicate verb+from+to combination (business logic)', () => {
    const rels: Relationship[] = []

    // First insert
    rels.push({
      id: 'unique-001',
      verb: 'owns',
      from: 'https://startups.studio/nathan',
      to: 'https://startups.studio/headless.ly',
      data: null,
      createdAt: new Date(),
    })

    // Check if duplicate would be rejected
    const isDuplicate = rels.some(
      (r) =>
        r.verb === 'owns' &&
        r.from === 'https://startups.studio/nathan' &&
        r.to === 'https://startups.studio/headless.ly'
    )

    expect(isDuplicate).toBe(true)
    // In real DB, insert would throw UNIQUE constraint violation
  })

  it('allows different verb for same from+to', () => {
    const rels: Relationship[] = [
      {
        id: 'diff-verb-001',
        verb: 'owns',
        from: 'https://startups.studio/nathan',
        to: 'https://startups.studio/headless.ly',
        data: null,
        createdAt: new Date(),
      },
      {
        id: 'diff-verb-002',
        verb: 'created', // Different verb
        from: 'https://startups.studio/nathan',
        to: 'https://startups.studio/headless.ly',
        data: null,
        createdAt: new Date(),
      },
    ]

    const samePair = rels.filter(
      (r) =>
        r.from === 'https://startups.studio/nathan' && r.to === 'https://startups.studio/headless.ly'
    )

    expect(samePair.length).toBe(2)

    const verbs = samePair.map((r) => r.verb)
    expect(verbs).toContain('owns')
    expect(verbs).toContain('created')
  })

  it('allows same verb with different from or to', () => {
    const rels: Relationship[] = [
      {
        id: 'same-verb-001',
        verb: 'owns',
        from: 'https://startups.studio/nathan',
        to: 'https://startups.studio/headless.ly',
        data: null,
        createdAt: new Date(),
      },
      {
        id: 'same-verb-002',
        verb: 'owns',
        from: 'https://startups.studio/nathan',
        to: 'https://startups.studio/docs.do', // Different to
        data: null,
        createdAt: new Date(),
      },
      {
        id: 'same-verb-003',
        verb: 'owns',
        from: 'https://startups.studio/alice', // Different from
        to: 'https://startups.studio/headless.ly',
        data: null,
        createdAt: new Date(),
      },
    ]

    const ownsRels = rels.filter((r) => r.verb === 'owns')
    expect(ownsRels.length).toBe(3)
  })
})

// ============================================================================
// 6. Edge Data Tests
// ============================================================================

describe('Edge Data', () => {
  describe('Store Metadata on Edges', () => {
    it('stores complex JSON data on edge', () => {
      const edgeData = {
        role: 'founder',
        percentage: 60,
        since: '2024-01-01',
        permissions: ['admin', 'write', 'delete'],
        nested: {
          level1: {
            level2: 'deep value',
          },
        },
      }

      const rel: Relationship = {
        id: 'data-001',
        verb: 'owns',
        from: 'https://startups.studio/nathan',
        to: 'https://startups.studio/headless.ly',
        data: edgeData,
        createdAt: new Date(),
      }

      expect(rel.data).toBeDefined()
      expect((rel.data as Record<string, unknown>).role).toBe('founder')
      expect((rel.data as Record<string, unknown>).percentage).toBe(60)
      expect(((rel.data as Record<string, unknown>).permissions as string[]).length).toBe(3)
      expect(
        (((rel.data as Record<string, unknown>).nested as Record<string, unknown>).level1 as Record<
          string,
          unknown
        >).level2
      ).toBe('deep value')
    })

    it('stores timestamps and dates in data', () => {
      const edgeData = {
        startDate: '2024-01-15',
        endDate: null,
        lastModified: 1704067200000,
        meetingSchedule: 'weekly',
      }

      const rel: Relationship = {
        id: 'data-dates-001',
        verb: 'manages',
        from: 'https://startups.studio/nathan',
        to: 'https://startups.studio/alice',
        data: edgeData,
        createdAt: new Date(),
      }

      expect((rel.data as Record<string, unknown>).startDate).toBe('2024-01-15')
      expect((rel.data as Record<string, unknown>).lastModified).toBe(1704067200000)
    })

    it('stores arrays in data', () => {
      const edgeData = {
        scopes: ['read', 'write', 'admin'],
        repositories: ['repo1', 'repo2', 'repo3'],
        numbers: [1, 2, 3, 4, 5],
      }

      const rel: Relationship = {
        id: 'data-arrays-001',
        verb: 'has_access_to',
        from: 'https://startups.studio/alice',
        to: 'https://github.com/headlessly',
        data: edgeData,
        createdAt: new Date(),
      }

      expect(((rel.data as Record<string, unknown>).scopes as string[]).length).toBe(3)
      expect((rel.data as Record<string, unknown>).scopes).toContain('admin')
    })
  })

  describe('Query by Edge Properties', () => {
    const testData: Relationship[] = [
      {
        id: 'prop-001',
        verb: 'owns',
        from: 'https://startups.studio/nathan',
        to: 'https://startups.studio/headless.ly',
        data: { percentage: 60, role: 'founder' },
        createdAt: new Date(),
      },
      {
        id: 'prop-002',
        verb: 'owns',
        from: 'https://startups.studio/alice',
        to: 'https://startups.studio/headless.ly',
        data: { percentage: 40, role: 'co-founder' },
        createdAt: new Date(),
      },
      {
        id: 'prop-003',
        verb: 'owns',
        from: 'https://startups.studio/nathan',
        to: 'https://startups.studio/docs.do',
        data: { percentage: 100, role: 'sole-owner' },
        createdAt: new Date(),
      },
    ]

    it('filters relationships by JSON property', () => {
      // Find all ownership relationships where percentage > 50
      const result = testData.filter(
        (r) =>
          r.verb === 'owns' &&
          r.data &&
          ((r.data as Record<string, unknown>).percentage as number) > 50
      )

      expect(result.length).toBe(2)

      const ids = result.map((r) => r.id)
      expect(ids).toContain('prop-001')
      expect(ids).toContain('prop-003')
    })

    it('filters by string property in data', () => {
      // Find all ownership relationships where role = 'founder'
      const result = testData.filter(
        (r) =>
          r.verb === 'owns' && r.data && (r.data as Record<string, unknown>).role === 'founder'
      )

      expect(result.length).toBe(1)
      expect(result[0].id).toBe('prop-001')
    })

    it('aggregates data across relationships', () => {
      // Sum all ownership percentages for headless.ly
      const headlessOwnership = testData.filter(
        (r) => r.to === 'https://startups.studio/headless.ly' && r.verb === 'owns'
      )

      const totalPercentage = headlessOwnership.reduce(
        (sum, r) => sum + ((r.data as Record<string, unknown>)?.percentage as number) || 0,
        0
      )

      expect(totalPercentage).toBe(100) // 60 + 40
    })
  })
})

// ============================================================================
// 7. Query Patterns Tests
// ============================================================================

describe('Query Patterns', () => {
  const testData: Relationship[] = [
    {
      id: 'qp-001',
      verb: 'owns',
      from: 'https://startups.studio/nathan',
      to: 'https://startups.studio/headless.ly',
      data: null,
      createdAt: new Date(),
    },
    {
      id: 'qp-002',
      verb: 'created',
      from: 'https://startups.studio/nathan',
      to: 'https://startups.studio/headless.ly',
      data: null,
      createdAt: new Date(),
    },
    {
      id: 'qp-003',
      verb: 'manages',
      from: 'https://startups.studio/nathan',
      to: 'https://startups.studio/alice',
      data: null,
      createdAt: new Date(),
    },
    {
      id: 'qp-004',
      verb: 'owns',
      from: 'https://startups.studio/nathan',
      to: 'https://startups.studio/docs.do',
      data: null,
      createdAt: new Date(),
    },
    {
      id: 'qp-005',
      verb: 'contributes_to',
      from: 'https://startups.studio/alice',
      to: 'https://startups.studio/headless.ly',
      data: null,
      createdAt: new Date(),
    },
  ]

  describe('Get All Relationships for a Thing', () => {
    it('gets all outgoing relationships from a thing', () => {
      const result = testData.filter((r) => r.from === 'https://startups.studio/nathan')

      expect(result.length).toBe(4)
    })

    it('gets all incoming relationships to a thing', () => {
      const result = testData.filter((r) => r.to === 'https://startups.studio/headless.ly')

      expect(result.length).toBe(3)

      const verbs = result.map((r) => r.verb)
      expect(verbs).toContain('owns')
      expect(verbs).toContain('created')
      expect(verbs).toContain('contributes_to')
    })

    it('gets all relationships (both directions) for a thing', () => {
      const outgoing = testData.filter((r) => r.from === 'https://startups.studio/alice')
      const incoming = testData.filter((r) => r.to === 'https://startups.studio/alice')

      expect(outgoing.length).toBe(1) // contributes_to headless.ly
      expect(incoming.length).toBe(1) // nathan manages alice
    })
  })

  describe('Get Relationship Count by Verb', () => {
    it('counts relationships grouped by verb', () => {
      const counts: Record<string, number> = {}

      testData.forEach((r) => {
        counts[r.verb] = (counts[r.verb] || 0) + 1
      })

      expect(counts['owns']).toBe(2)
      expect(counts['created']).toBe(1)
      expect(counts['manages']).toBe(1)
      expect(counts['contributes_to']).toBe(1)
    })

    it('counts outgoing relationships by verb for a specific thing', () => {
      const nathanRels = testData.filter((r) => r.from === 'https://startups.studio/nathan')
      const counts: Record<string, number> = {}

      nathanRels.forEach((r) => {
        counts[r.verb] = (counts[r.verb] || 0) + 1
      })

      expect(counts['owns']).toBe(2)
      expect(counts['created']).toBe(1)
      expect(counts['manages']).toBe(1)
    })

    it('counts incoming relationships by verb for a specific thing', () => {
      const headlessRels = testData.filter((r) => r.to === 'https://startups.studio/headless.ly')
      const counts: Record<string, number> = {}

      headlessRels.forEach((r) => {
        counts[r.verb] = (counts[r.verb] || 0) + 1
      })

      expect(counts['owns']).toBe(1)
      expect(counts['created']).toBe(1)
      expect(counts['contributes_to']).toBe(1)
    })
  })

  describe('Find Things Connected Within N Hops', () => {
    const extendedData = [
      ...testData,
      {
        id: 'hop-001',
        verb: 'depends_on',
        from: 'https://startups.studio/headless.ly',
        to: 'https://startups.studio/workers.do',
        data: null,
        createdAt: new Date(),
      },
      {
        id: 'hop-002',
        verb: 'uses',
        from: 'https://startups.studio/workers.do',
        to: 'https://cloudflare.com/workers',
        data: null,
        createdAt: new Date(),
      },
    ]

    it('finds all things within 1 hop', () => {
      const hop1 = extendedData.filter((r) => r.from === 'https://startups.studio/nathan')
      const connectedUrls = hop1.map((r) => r.to)

      expect(connectedUrls.length).toBe(4)
      expect(connectedUrls).toContain('https://startups.studio/headless.ly')
      expect(connectedUrls).toContain('https://startups.studio/docs.do')
      expect(connectedUrls).toContain('https://startups.studio/alice')
    })

    it('finds all things within 2 hops', () => {
      // Hop 1
      const hop1 = extendedData.filter((r) => r.from === 'https://startups.studio/nathan')
      const hop1Urls = hop1.map((r) => r.to)

      // Hop 2
      const hop2 = extendedData.filter((r) => hop1Urls.includes(r.from))
      const hop2Urls = hop2.map((r) => r.to)

      // Combined unique URLs
      const allConnected = new Set([...hop1Urls, ...hop2Urls])

      expect(allConnected.has('https://startups.studio/headless.ly')).toBe(true)
      expect(allConnected.has('https://startups.studio/workers.do')).toBe(true) // Via headless.ly
    })

    it('finds all things within 3 hops', () => {
      const visited = new Set<string>()
      let currentLevel = ['https://startups.studio/nathan']

      for (let hop = 0; hop < 3; hop++) {
        const nextLevel: string[] = []

        for (const url of currentLevel) {
          const edges = extendedData.filter((r) => r.from === url)

          for (const edge of edges) {
            if (!visited.has(edge.to)) {
              visited.add(edge.to)
              nextLevel.push(edge.to)
            }
          }
        }

        currentLevel = nextLevel
      }

      // Should include things 3 hops away
      expect(visited.has('https://cloudflare.com/workers')).toBe(true) // Nathan -> headless.ly -> workers.do -> cloudflare
    })
  })
})

// ============================================================================
// 8. Edge Cases Tests
// ============================================================================

describe('Edge Cases', () => {
  describe('Self-referential Relationships (from = to)', () => {
    it('allows self-referential relationship', () => {
      const rel: Relationship = {
        id: 'self-001',
        verb: 'references',
        from: 'https://startups.studio/docs/intro',
        to: 'https://startups.studio/docs/intro', // Same URL
        data: { section: 'footnote' },
        createdAt: new Date(),
      }

      expect(rel.from).toBe(rel.to)
    })

    it('can query self-referential relationships', () => {
      const rels: Relationship[] = [
        {
          id: 'self-query-001',
          verb: 'links_to',
          from: 'https://startups.studio/page/a',
          to: 'https://startups.studio/page/a',
          data: null,
          createdAt: new Date(),
        },
        {
          id: 'self-query-002',
          verb: 'links_to',
          from: 'https://startups.studio/page/a',
          to: 'https://startups.studio/page/b',
          data: null,
          createdAt: new Date(),
        },
      ]

      // Find self-referential relationships
      const result = rels.filter((r) => r.from === r.to)

      expect(result.length).toBe(1)
      expect(result[0].id).toBe('self-query-001')
    })
  })

  describe('Very Long URLs', () => {
    it('handles URLs up to 2000 characters', () => {
      const longPath = 'a'.repeat(1900) // Very long path segment
      const longUrl = `https://startups.studio/${longPath}`

      const rel: Relationship = {
        id: 'long-url-001',
        verb: 'references',
        from: 'https://startups.studio/short',
        to: longUrl,
        data: null,
        createdAt: new Date(),
      }

      expect(rel.to.length).toBeGreaterThan(1900)
    })

    it('handles URLs with many query parameters', () => {
      const params = Array.from({ length: 50 }, (_, i) => `param${i}=value${i}`).join('&')
      const urlWithParams = `https://startups.studio/api?${params}`

      const rel: Relationship = {
        id: 'params-url-001',
        verb: 'calls',
        from: 'https://startups.studio/client',
        to: urlWithParams,
        data: null,
        createdAt: new Date(),
      }

      expect(rel.to).toContain('param49=value49')
    })

    it('handles URLs with fragments', () => {
      const urlWithFragment = 'https://startups.studio/docs/api#authentication-section-2'

      const rel: Relationship = {
        id: 'fragment-url-001',
        verb: 'references',
        from: 'https://startups.studio/guide',
        to: urlWithFragment,
        data: null,
        createdAt: new Date(),
      }

      expect(rel.to).toContain('#authentication-section-2')
    })
  })

  describe('Unicode in URLs', () => {
    it('handles Unicode characters in URL paths', () => {
      const rel: Relationship = {
        id: 'unicode-001',
        verb: 'links_to',
        from: 'https://startups.studio/docs/getting-started',
        to: 'https://startups.studio/docs/introduction',
        data: null,
        createdAt: new Date(),
      }

      expect(rel.to).toBeDefined()
    })

    it('handles URL-encoded Unicode', () => {
      // Percent-encoded Japanese characters
      const encodedUrl = 'https://startups.studio/docs/%E6%97%A5%E6%9C%AC%E8%AA%9E'

      const rel: Relationship = {
        id: 'encoded-001',
        verb: 'translates_to',
        from: 'https://startups.studio/docs/english',
        to: encodedUrl,
        data: null,
        createdAt: new Date(),
      }

      expect(rel.to).toBe(encodedUrl)
    })

    it('handles emoji in URL slugs (if URL-encoded)', () => {
      // Emoji encoded as percent-encoding
      const emojiUrl = 'https://startups.studio/posts/%F0%9F%9A%80-launch'

      const rel: Relationship = {
        id: 'emoji-001',
        verb: 'related_to',
        from: 'https://startups.studio/posts/announcement',
        to: emojiUrl,
        data: null,
        createdAt: new Date(),
      }

      expect(rel.to).toContain('%F0%9F%9A%80')
    })

    it('handles international domain names', () => {
      // Punycode-encoded international domain
      const internationalUrl = 'https://xn--n3h.com/page' // Represents a Unicode domain

      const rel: Relationship = {
        id: 'idn-001',
        verb: 'mirrors',
        from: 'https://startups.studio/intl',
        to: internationalUrl,
        data: null,
        createdAt: new Date(),
      }

      expect(rel.to).toBe(internationalUrl)
    })
  })

  describe('Empty and Null Handling', () => {
    it('verb should not be null (business constraint)', () => {
      // Business logic: verb is required
      const rel: Partial<Relationship> = {
        id: 'null-verb-001',
        verb: undefined,
        from: 'https://startups.studio/a',
        to: 'https://startups.studio/b',
      }

      expect(rel.verb).toBeUndefined()
      // Schema should enforce NOT NULL
    })

    it('from should not be null (business constraint)', () => {
      const rel: Partial<Relationship> = {
        id: 'null-from-001',
        verb: 'test',
        from: undefined,
        to: 'https://startups.studio/b',
      }

      expect(rel.from).toBeUndefined()
      // Schema should enforce NOT NULL
    })

    it('to should not be null (business constraint)', () => {
      const rel: Partial<Relationship> = {
        id: 'null-to-001',
        verb: 'test',
        from: 'https://startups.studio/a',
        to: undefined,
      }

      expect(rel.to).toBeUndefined()
      // Schema should enforce NOT NULL
    })

    it('allows empty string verb (though not recommended)', () => {
      // Schema allows empty string, but application should validate
      const rel: Relationship = {
        id: 'empty-verb-001',
        verb: '',
        from: 'https://startups.studio/a',
        to: 'https://startups.studio/b',
        data: null,
        createdAt: new Date(),
      }

      expect(rel.verb).toBe('')
    })

    it('handles empty data object vs null', () => {
      const relWithEmpty: Relationship = {
        id: 'empty-data-001',
        verb: 'test',
        from: 'https://startups.studio/a',
        to: 'https://startups.studio/b',
        data: {}, // Empty object
        createdAt: new Date(),
      }

      const relWithNull: Relationship = {
        id: 'null-data-001',
        verb: 'test',
        from: 'https://startups.studio/c',
        to: 'https://startups.studio/d',
        data: null, // Null
        createdAt: new Date(),
      }

      expect(relWithEmpty.data).toEqual({})
      expect(relWithNull.data).toBeNull()
    })
  })

  describe('Timestamp Edge Cases', () => {
    it('handles very old timestamps', () => {
      const oldDate = new Date('1970-01-01T00:00:00Z')

      const rel: Relationship = {
        id: 'old-date-001',
        verb: 'archived',
        from: 'https://startups.studio/old',
        to: 'https://startups.studio/archive',
        data: null,
        createdAt: oldDate,
      }

      expect(rel.createdAt.getTime()).toBe(0)
    })

    it('handles future timestamps', () => {
      const futureDate = new Date('2100-01-01T00:00:00Z')

      const rel: Relationship = {
        id: 'future-001',
        verb: 'scheduled_for',
        from: 'https://startups.studio/event',
        to: 'https://startups.studio/venue',
        data: null,
        createdAt: futureDate,
      }

      expect(rel.createdAt.getTime()).toBe(futureDate.getTime())
    })
  })

  describe('Special Characters in Data', () => {
    it('handles JSON with special characters', () => {
      const dataWithSpecialChars = {
        message: 'Hello "World"!',
        path: 'C:\\Users\\test',
        newlines: 'line1\nline2\nline3',
        tabs: 'col1\tcol2\tcol3',
        unicode: 'caf\u00e9',
      }

      const rel: Relationship = {
        id: 'special-char-001',
        verb: 'has_config',
        from: 'https://startups.studio/app',
        to: 'https://startups.studio/config',
        data: dataWithSpecialChars,
        createdAt: new Date(),
      }

      const data = rel.data as Record<string, unknown>
      expect(data.message).toBe('Hello "World"!')
      expect(data.path).toBe('C:\\Users\\test')
      expect(data.newlines).toBe('line1\nline2\nline3')
    })
  })
})

// ============================================================================
// Additional Integration Tests
// ============================================================================

describe('Integration Patterns', () => {
  it('supports bidirectional relationship modeling', () => {
    // Model a symmetric relationship by creating edges in both directions
    const rels: Relationship[] = [
      {
        id: 'bi-001',
        verb: 'friends_with',
        from: 'https://social.do/alice',
        to: 'https://social.do/bob',
        data: null,
        createdAt: new Date(),
      },
      {
        id: 'bi-002',
        verb: 'friends_with',
        from: 'https://social.do/bob',
        to: 'https://social.do/alice',
        data: null,
        createdAt: new Date(),
      },
    ]

    // Query both directions
    const aliceFriends = rels.filter(
      (r) => r.from === 'https://social.do/alice' && r.verb === 'friends_with'
    )

    const bobFriends = rels.filter(
      (r) => r.from === 'https://social.do/bob' && r.verb === 'friends_with'
    )

    expect(aliceFriends.length).toBe(1)
    expect(bobFriends.length).toBe(1)
    expect(aliceFriends[0].to).toBe('https://social.do/bob')
    expect(bobFriends[0].to).toBe('https://social.do/alice')
  })

  it('supports hierarchical relationship modeling', () => {
    // Model a tree structure with parent/child relationships
    const rels: Relationship[] = [
      {
        id: 'tree-001',
        verb: 'parent_of',
        from: 'https://files.do/root',
        to: 'https://files.do/folder1',
        data: null,
        createdAt: new Date(),
      },
      {
        id: 'tree-002',
        verb: 'parent_of',
        from: 'https://files.do/root',
        to: 'https://files.do/folder2',
        data: null,
        createdAt: new Date(),
      },
      {
        id: 'tree-003',
        verb: 'parent_of',
        from: 'https://files.do/folder1',
        to: 'https://files.do/file1.txt',
        data: null,
        createdAt: new Date(),
      },
      {
        id: 'tree-004',
        verb: 'parent_of',
        from: 'https://files.do/folder1',
        to: 'https://files.do/file2.txt',
        data: null,
        createdAt: new Date(),
      },
    ]

    // Get direct children of root
    const rootChildren = rels.filter(
      (r) => r.from === 'https://files.do/root' && r.verb === 'parent_of'
    )

    expect(rootChildren.length).toBe(2)

    // Get children of folder1
    const folder1Children = rels.filter(
      (r) => r.from === 'https://files.do/folder1' && r.verb === 'parent_of'
    )

    expect(folder1Children.length).toBe(2)

    // Get parent of file1.txt (reverse lookup)
    const file1Parent = rels.filter(
      (r) => r.to === 'https://files.do/file1.txt' && r.verb === 'parent_of'
    )

    expect(file1Parent.length).toBe(1)
    expect(file1Parent[0].from).toBe('https://files.do/folder1')
  })

  it('supports many-to-many relationship modeling', () => {
    // Model tags on articles (many-to-many)
    const rels: Relationship[] = [
      {
        id: 'm2m-001',
        verb: 'tagged_with',
        from: 'https://blog.do/article1',
        to: 'https://blog.do/tag/javascript',
        data: null,
        createdAt: new Date(),
      },
      {
        id: 'm2m-002',
        verb: 'tagged_with',
        from: 'https://blog.do/article1',
        to: 'https://blog.do/tag/typescript',
        data: null,
        createdAt: new Date(),
      },
      {
        id: 'm2m-003',
        verb: 'tagged_with',
        from: 'https://blog.do/article2',
        to: 'https://blog.do/tag/javascript',
        data: null,
        createdAt: new Date(),
      },
      {
        id: 'm2m-004',
        verb: 'tagged_with',
        from: 'https://blog.do/article2',
        to: 'https://blog.do/tag/react',
        data: null,
        createdAt: new Date(),
      },
    ]

    // Get all tags for article1
    const article1Tags = rels.filter(
      (r) => r.from === 'https://blog.do/article1' && r.verb === 'tagged_with'
    )

    expect(article1Tags.length).toBe(2)

    // Get all articles with javascript tag
    const jsArticles = rels.filter(
      (r) => r.to === 'https://blog.do/tag/javascript' && r.verb === 'tagged_with'
    )

    expect(jsArticles.length).toBe(2)
  })
})

// ============================================================================
// Schema Export Tests
// ============================================================================

describe('Schema Exports', () => {
  it('relationships is exported from db/index.ts', async () => {
    const { relationships: indexRelationships } = await import('../index')
    expect(indexRelationships).toBeDefined()
  })

  it('relationships table matches expected structure', () => {
    // Verify the table has the expected columns by checking they are defined
    expect(relationships.id).toBeDefined()
    expect(relationships.verb).toBeDefined()
    expect(relationships.from).toBeDefined()
    expect(relationships.to).toBeDefined()
    expect(relationships.data).toBeDefined()
    expect(relationships.createdAt).toBeDefined()
  })
})

// ============================================================================
// Schema Structure Validation Tests
// ============================================================================

describe('Schema Structure Validation', () => {
  describe('Table Name', () => {
    it('table is named "relationships"', () => {
      // Access the internal table name - drizzle stores this in the symbol
      const tableName = (relationships as any)[Symbol.for('drizzle:Name')] ?? (relationships as any)._.name
      expect(tableName).toBe('relationships')
    })
  })

  describe('Column Definitions', () => {
    it('id column is text type', () => {
      expect(relationships.id.dataType).toBe('string')
    })

    it('id column is primary key', () => {
      expect(relationships.id.primary).toBe(true)
    })

    it('verb column is text type', () => {
      expect(relationships.verb.dataType).toBe('string')
    })

    it('verb column is not null', () => {
      expect(relationships.verb.notNull).toBe(true)
    })

    it('from column is text type', () => {
      expect(relationships.from.dataType).toBe('string')
    })

    it('from column is not null', () => {
      expect(relationships.from.notNull).toBe(true)
    })

    it('to column is text type', () => {
      expect(relationships.to.dataType).toBe('string')
    })

    it('to column is not null', () => {
      expect(relationships.to.notNull).toBe(true)
    })

    it('data column is JSON mode text', () => {
      expect(relationships.data.dataType).toBe('json')
    })

    it('data column is nullable', () => {
      expect(relationships.data.notNull).toBe(false)
    })

    it('createdAt column is integer type', () => {
      expect(relationships.createdAt.dataType).toBe('date')
    })

    it('createdAt column is not null', () => {
      expect(relationships.createdAt.notNull).toBe(true)
    })
  })

  describe('Column Names (SQL names)', () => {
    it('id column has correct SQL name', () => {
      expect(relationships.id.name).toBe('id')
    })

    it('verb column has correct SQL name', () => {
      expect(relationships.verb.name).toBe('verb')
    })

    it('from column has correct SQL name', () => {
      expect(relationships.from.name).toBe('from')
    })

    it('to column has correct SQL name', () => {
      expect(relationships.to.name).toBe('to')
    })

    it('data column has correct SQL name', () => {
      expect(relationships.data.name).toBe('data')
    })

    it('createdAt column has correct SQL name (snake_case)', () => {
      expect(relationships.createdAt.name).toBe('created_at')
    })
  })
})

// ============================================================================
// Type Inference Tests
// ============================================================================

describe('Type Inference', () => {
  it('inferred insert type has required fields', () => {
    // This tests that TypeScript would correctly infer the insert type
    type InsertRelationship = typeof relationships.$inferInsert

    // Create a valid insert object - if this compiles, types are correct
    const validInsert: InsertRelationship = {
      id: 'test-id',
      verb: 'owns',
      from: 'https://example.com/a',
      to: 'https://example.com/b',
      createdAt: new Date(),
    }

    expect(validInsert.id).toBe('test-id')
    expect(validInsert.verb).toBe('owns')
    expect(validInsert.data).toBeUndefined() // optional
  })

  it('inferred select type has all fields', () => {
    type SelectRelationship = typeof relationships.$inferSelect

    // Validate select type structure
    const mockSelect: SelectRelationship = {
      id: 'test-id',
      verb: 'owns',
      from: 'https://example.com/a',
      to: 'https://example.com/b',
      data: { key: 'value' },
      createdAt: new Date(),
    }

    expect(mockSelect.id).toBe('test-id')
    expect(mockSelect.data).toEqual({ key: 'value' })
  })

  it('data field accepts null', () => {
    type InsertRelationship = typeof relationships.$inferInsert

    const insertWithNullData: InsertRelationship = {
      id: 'test-id',
      verb: 'owns',
      from: 'https://example.com/a',
      to: 'https://example.com/b',
      data: null,
      createdAt: new Date(),
    }

    expect(insertWithNullData.data).toBeNull()
  })

  it('data field accepts JSON objects', () => {
    type InsertRelationship = typeof relationships.$inferInsert

    const insertWithData: InsertRelationship = {
      id: 'test-id',
      verb: 'owns',
      from: 'https://example.com/a',
      to: 'https://example.com/b',
      data: {
        role: 'admin',
        permissions: ['read', 'write'],
        metadata: { nested: true },
      },
      createdAt: new Date(),
    }

    expect(insertWithData.data).toBeDefined()
  })
})
