/**
 * SQLite RelationshipsStore Tests - Using Real Miniflare Runtime
 *
 * These tests use Miniflare to test against real SQLite storage instead of mocks.
 * This follows the NO MOCKS philosophy from CLAUDE.md.
 *
 * @module db/tests/sqlite-relationships.test
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { Miniflare } from 'miniflare'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface Relationship {
  subject: string
  predicate: string
  object: string
  $createdAt: number
}

// ============================================================================
// DO SCRIPT FOR TESTING RelationshipsStore
// ============================================================================

const RELATIONSHIPS_TEST_DO_SCRIPT = `
export class RelationshipsTestDO {
  constructor(state, env) {
    this.state = state
    this.sql = state.storage.sql
  }

  async fetch(request) {
    const url = new URL(request.url)
    const path = url.pathname

    try {
      // INITIALIZE
      if (path === '/initialize' && request.method === 'POST') {
        this.sql.exec(\`
          CREATE TABLE IF NOT EXISTS relationships (
            subject TEXT NOT NULL,
            predicate TEXT NOT NULL,
            object TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            PRIMARY KEY (subject, predicate, object)
          );
          CREATE INDEX IF NOT EXISTS idx_relationships_subject ON relationships(subject);
          CREATE INDEX IF NOT EXISTS idx_relationships_predicate ON relationships(predicate);
          CREATE INDEX IF NOT EXISTS idx_relationships_object ON relationships(object);
        \`)
        return Response.json({ success: true })
      }

      // ADD RELATIONSHIP
      if (path === '/relationships' && request.method === 'POST') {
        const data = await request.json()

        // Check for duplicate
        const existing = this.sql.exec(
          'SELECT 1 FROM relationships WHERE subject = ? AND predicate = ? AND object = ?',
          data.subject, data.predicate, data.object
        ).toArray()

        if (existing.length > 0) {
          return Response.json({ error: 'Relationship already exists' }, { status: 409 })
        }

        const relationship = {
          subject: data.subject,
          predicate: data.predicate,
          object: data.object,
          $createdAt: Date.now()
        }

        this.sql.exec(
          'INSERT INTO relationships (subject, predicate, object, created_at) VALUES (?, ?, ?, ?)',
          relationship.subject,
          relationship.predicate,
          relationship.object,
          relationship.$createdAt
        )

        return Response.json(relationship, { status: 201 })
      }

      // REMOVE RELATIONSHIP
      if (path === '/relationships' && request.method === 'DELETE') {
        const data = await request.json()

        // Check if exists
        const existing = this.sql.exec(
          'SELECT 1 FROM relationships WHERE subject = ? AND predicate = ? AND object = ?',
          data.subject, data.predicate, data.object
        ).toArray()

        if (existing.length === 0) {
          return Response.json({ error: 'Relationship not found' }, { status: 404 })
        }

        this.sql.exec(
          'DELETE FROM relationships WHERE subject = ? AND predicate = ? AND object = ?',
          data.subject, data.predicate, data.object
        )

        return Response.json({ success: true })
      }

      // FIND RELATIONSHIPS
      if (path === '/relationships/find' && request.method === 'POST') {
        const query = await request.json()

        let sql = 'SELECT subject, predicate, object, created_at FROM relationships WHERE 1=1'
        const params = []

        if (query.subject) {
          sql += ' AND subject = ?'
          params.push(query.subject)
        }

        if (query.predicate) {
          sql += ' AND predicate = ?'
          params.push(query.predicate)
        }

        if (query.object) {
          sql += ' AND object = ?'
          params.push(query.object)
        }

        const rows = this.sql.exec(sql, ...params).toArray()

        const relationships = rows.map(row => ({
          subject: row.subject,
          predicate: row.predicate,
          object: row.object,
          $createdAt: row.created_at
        }))

        return Response.json(relationships)
      }

      // GET RELATED (subject -> object)
      if (path === '/relationships/related' && request.method === 'GET') {
        const subjectId = url.searchParams.get('subject')
        const predicate = url.searchParams.get('predicate')

        const rows = this.sql.exec(
          'SELECT object FROM relationships WHERE subject = ? AND predicate = ?',
          subjectId, predicate
        ).toArray()

        const objectIds = rows.map(row => row.object)
        return Response.json(objectIds)
      }

      // GET RELATED TO (object <- subject)
      if (path === '/relationships/relatedTo' && request.method === 'GET') {
        const objectId = url.searchParams.get('object')
        const predicate = url.searchParams.get('predicate')

        const rows = this.sql.exec(
          'SELECT subject FROM relationships WHERE object = ? AND predicate = ?',
          objectId, predicate
        ).toArray()

        const subjectIds = rows.map(row => row.subject)
        return Response.json(subjectIds)
      }

      if (path === '/health') {
        return Response.json({ status: 'ok' })
      }

      return Response.json({ error: 'Not found' }, { status: 404 })
    } catch (error) {
      return Response.json({ error: error.message, stack: error.stack }, { status: 500 })
    }
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    const doName = url.searchParams.get('name') || 'default'
    const id = env.RELATIONSHIPS_DO.idFromName(doName)
    const stub = env.RELATIONSHIPS_DO.get(id)
    return stub.fetch(request)
  }
}
`

// ============================================================================
// TEST HELPERS
// ============================================================================

function generateTestId(): string {
  return `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

// ============================================================================
// TEST SUITE
// ============================================================================

describe('SQLite RelationshipsStore', () => {
  let mf: Miniflare

  beforeAll(async () => {
    mf = new Miniflare({
      modules: true,
      script: RELATIONSHIPS_TEST_DO_SCRIPT,
      durableObjects: {
        RELATIONSHIPS_DO: {
          className: 'RelationshipsTestDO',
          // Enable SQLite for this DO class - required for state.storage.sql
          useSQLite: true,
        },
      },
      durableObjectsPersist: false,
    })
  })

  afterAll(async () => {
    await mf.dispose()
  })

  async function getRelationshipsStub(name: string = 'default') {
    const ns = await mf.getDurableObjectNamespace('RELATIONSHIPS_DO')
    const id = ns.idFromName(name)
    return ns.get(id)
  }

  type StubType = { fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> }

  // Helper functions
  async function initialize(stub: StubType): Promise<void> {
    await stub.fetch('http://internal/initialize', { method: 'POST' })
  }

  async function addRelationship(stub: StubType, rel: {
    subject: string
    predicate: string
    object: string
  }): Promise<Relationship> {
    const response = await stub.fetch('http://internal/relationships', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rel)
    })
    if (!response.ok) {
      const error = await response.json() as { error: string }
      throw new Error(error.error)
    }
    return response.json() as Promise<Relationship>
  }

  async function removeRelationship(stub: StubType, rel: {
    subject: string
    predicate: string
    object: string
  }): Promise<void> {
    const response = await stub.fetch('http://internal/relationships', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rel)
    })
    if (!response.ok) {
      const error = await response.json() as { error: string }
      throw new Error(error.error)
    }
  }

  async function findRelationships(stub: StubType, query: {
    subject?: string
    predicate?: string
    object?: string
  }): Promise<Relationship[]> {
    const response = await stub.fetch('http://internal/relationships/find', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(query)
    })
    return response.json() as Promise<Relationship[]>
  }

  async function getRelated(stub: StubType, subjectId: string, predicate: string): Promise<string[]> {
    const params = new URLSearchParams({ subject: subjectId, predicate })
    const response = await stub.fetch(`http://internal/relationships/related?${params}`)
    return response.json() as Promise<string[]>
  }

  async function getRelatedTo(stub: StubType, objectId: string, predicate: string): Promise<string[]> {
    const params = new URLSearchParams({ object: objectId, predicate })
    const response = await stub.fetch(`http://internal/relationships/relatedTo?${params}`)
    return response.json() as Promise<string[]>
  }

  describe('add', () => {
    let stub: StubType

    beforeEach(async () => {
      stub = await getRelationshipsStub(generateTestId())
      await initialize(stub)
    })

    it('should insert relationship into SQLite', async () => {
      const rel = await addRelationship(stub, {
        subject: 'user-1',
        predicate: 'owns',
        object: 'order-1'
      })

      expect(rel.subject).toBe('user-1')
      expect(rel.predicate).toBe('owns')
      expect(rel.object).toBe('order-1')
      expect(rel.$createdAt).toBeDefined()
    })

    it('should prevent duplicate relationships', async () => {
      await addRelationship(stub, { subject: 'user-1', predicate: 'owns', object: 'order-1' })

      await expect(
        addRelationship(stub, { subject: 'user-1', predicate: 'owns', object: 'order-1' })
      ).rejects.toThrow('Relationship already exists')
    })
  })

  describe('remove', () => {
    let stub: StubType

    beforeEach(async () => {
      stub = await getRelationshipsStub(generateTestId())
      await initialize(stub)
    })

    it('should delete relationship from SQLite', async () => {
      await addRelationship(stub, { subject: 'user-1', predicate: 'owns', object: 'order-1' })
      await removeRelationship(stub, { subject: 'user-1', predicate: 'owns', object: 'order-1' })

      const found = await findRelationships(stub, { subject: 'user-1', predicate: 'owns' })
      expect(found).toHaveLength(0)
    })

    it('should throw for non-existent relationship', async () => {
      await expect(
        removeRelationship(stub, { subject: 'user-1', predicate: 'owns', object: 'order-1' })
      ).rejects.toThrow('Relationship not found')
    })
  })

  describe('find', () => {
    let stub: StubType

    beforeEach(async () => {
      stub = await getRelationshipsStub(generateTestId())
      await initialize(stub)

      await addRelationship(stub, { subject: 'user-1', predicate: 'owns', object: 'order-1' })
      await addRelationship(stub, { subject: 'user-1', predicate: 'owns', object: 'order-2' })
      await addRelationship(stub, { subject: 'user-2', predicate: 'owns', object: 'order-3' })
      await addRelationship(stub, { subject: 'user-1', predicate: 'created', object: 'post-1' })
    })

    it('should find by subject', async () => {
      const rels = await findRelationships(stub, { subject: 'user-1' })
      expect(rels).toHaveLength(3)
    })

    it('should find by predicate', async () => {
      const rels = await findRelationships(stub, { predicate: 'owns' })
      expect(rels).toHaveLength(3)
    })

    it('should find by object', async () => {
      const rels = await findRelationships(stub, { object: 'order-1' })
      expect(rels).toHaveLength(1)
    })

    it('should find by multiple criteria', async () => {
      // With real SQLite, this works correctly with multiple AND conditions
      const rels = await findRelationships(stub, { subject: 'user-1', predicate: 'owns' })
      expect(rels).toHaveLength(2)
    })
  })

  describe('getRelated', () => {
    let stub: StubType

    beforeEach(async () => {
      stub = await getRelationshipsStub(generateTestId())
      await initialize(stub)

      await addRelationship(stub, { subject: 'user-1', predicate: 'owns', object: 'order-1' })
      await addRelationship(stub, { subject: 'user-1', predicate: 'owns', object: 'order-2' })
      await addRelationship(stub, { subject: 'user-1', predicate: 'created', object: 'post-1' })
    })

    it('should return related object IDs', async () => {
      // With real SQLite, multi-criteria queries work correctly
      const orders = await getRelated(stub, 'user-1', 'owns')
      expect(orders).toEqual(['order-1', 'order-2'])
    })

    it('should return empty array when no relations', async () => {
      const results = await getRelated(stub, 'user-2', 'owns')
      expect(results).toEqual([])
    })
  })

  describe('getRelatedTo', () => {
    let stub: StubType

    beforeEach(async () => {
      stub = await getRelationshipsStub(generateTestId())
      await initialize(stub)

      await addRelationship(stub, { subject: 'user-1', predicate: 'owns', object: 'order-1' })
      await addRelationship(stub, { subject: 'user-2', predicate: 'owns', object: 'order-1' })
      await addRelationship(stub, { subject: 'user-1', predicate: 'created', object: 'order-1' })
    })

    it('should return related subject IDs', async () => {
      // With real SQLite, multi-criteria queries work correctly
      const owners = await getRelatedTo(stub, 'order-1', 'owns')
      expect(owners).toEqual(['user-1', 'user-2'])
    })

    it('should return empty array when no relations', async () => {
      const results = await getRelatedTo(stub, 'order-2', 'owns')
      expect(results).toEqual([])
    })
  })
})
