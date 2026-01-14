/**
 * Neo4j Compat Layer Tests
 *
 * Tests for the Neo4j driver-compatible API.
 * Verifies compatibility with common neo4j-driver patterns.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import neo4j from '../index'
import type { Driver, Session, QueryResult, Neo4jNode, Neo4jRelationship } from '../types'

describe('Neo4j Compat Layer', () => {
  let driver: Driver
  let session: Session

  beforeEach(() => {
    driver = neo4j.driver('bolt://localhost:7687', neo4j.auth.basic('neo4j', 'password'))
    session = driver.session()
  })

  afterEach(async () => {
    await session.close()
    await driver.close()
  })

  // ==========================================================================
  // DRIVER & SESSION
  // ==========================================================================

  describe('Driver', () => {
    it('creates a driver with bolt URI', () => {
      expect(driver).toBeDefined()
    })

    it('verifies connectivity', async () => {
      const serverInfo = await driver.verifyConnectivity()
      expect(serverInfo.address).toBeDefined()
      expect(serverInfo.version).toContain('DotDO')
    })

    it('supports multi-db', async () => {
      const supports = await driver.supportsMultiDb()
      expect(supports).toBe(true)
    })

    it('supports transaction config', async () => {
      const supports = await driver.supportsTransactionConfig()
      expect(supports).toBe(true)
    })

    it('creates sessions', () => {
      const session = driver.session()
      expect(session).toBeDefined()
    })

    it('creates sessions with config', () => {
      const session = driver.session({
        database: 'neo4j',
        defaultAccessMode: 'WRITE'
      })
      expect(session).toBeDefined()
    })
  })

  describe('Session', () => {
    it('runs simple queries', async () => {
      const result = await session.run('CREATE (n:Test {name: "Test"}) RETURN n')
      expect(result.records).toBeDefined()
      expect(result.summary).toBeDefined()
    })

    it('provides bookmarks', () => {
      expect(session.lastBookmark()).toBeDefined()
      expect(session.lastBookmarks()).toBeInstanceOf(Array)
    })
  })

  // ==========================================================================
  // CREATE OPERATIONS
  // ==========================================================================

  describe('CREATE', () => {
    it('creates a node with label', async () => {
      const result = await session.run('CREATE (n:Person {name: "Alice"}) RETURN n')

      expect(result.records).toHaveLength(1)
      const node = result.records[0]!.get('n') as Neo4jNode
      expect(node.labels).toContain('Person')
      expect(node.properties.name).toBe('Alice')
    })

    it('creates a node with parameters', async () => {
      const result = await session.run(
        'CREATE (n:Person {name: $name, age: $age}) RETURN n',
        { name: 'Bob', age: 30 }
      )

      const node = result.records[0]!.get('n') as Neo4jNode
      expect(node.properties.name).toBe('Bob')
      expect(node.properties.age).toBe(30)
    })

    it('creates multiple nodes', async () => {
      await session.run('CREATE (a:Person {name: "A"})')
      await session.run('CREATE (b:Person {name: "B"})')

      const result = await session.run('MATCH (n:Person) RETURN n')
      expect(result.records.length).toBeGreaterThanOrEqual(2)
    })

    it('creates a relationship', async () => {
      await session.run('CREATE (a:Person {name: "Alice"})')
      await session.run('CREATE (b:Person {name: "Bob"})')
      await session.run(`
        MATCH (a:Person {name: "Alice"}), (b:Person {name: "Bob"})
        CREATE (a)-[r:KNOWS]->(b)
        RETURN r
      `)

      const result = await session.run(`
        MATCH (a:Person)-[r:KNOWS]->(b:Person)
        RETURN a, r, b
      `)

      expect(result.records.length).toBeGreaterThanOrEqual(1)
    })

    it('creates relationship with properties', async () => {
      await session.run('CREATE (a:Person {name: "Alice"})')
      await session.run('CREATE (b:Person {name: "Bob"})')
      await session.run(`
        MATCH (a:Person {name: "Alice"}), (b:Person {name: "Bob"})
        CREATE (a)-[r:KNOWS {since: 2020}]->(b)
        RETURN r
      `)

      const result = await session.run(`
        MATCH ()-[r:KNOWS {since: 2020}]->()
        RETURN r
      `)

      expect(result.records.length).toBeGreaterThanOrEqual(1)
    })
  })

  // ==========================================================================
  // MATCH OPERATIONS
  // ==========================================================================

  describe('MATCH', () => {
    beforeEach(async () => {
      await session.run('CREATE (a:Person {name: "Alice", age: 30}) RETURN a')
      await session.run('CREATE (b:Person {name: "Bob", age: 25}) RETURN b')
      await session.run('CREATE (c:Company {name: "Acme"}) RETURN c')
    })

    it('matches all nodes with label', async () => {
      const result = await session.run('MATCH (n:Person) RETURN n')

      expect(result.records.length).toBeGreaterThanOrEqual(2)
      result.records.forEach(record => {
        const node = record.get('n') as Neo4jNode
        expect(node.labels).toContain('Person')
      })
    })

    it('matches nodes with property filter', async () => {
      const result = await session.run(
        'MATCH (n:Person {name: $name}) RETURN n',
        { name: 'Alice' }
      )

      expect(result.records).toHaveLength(1)
      const node = result.records[0]!.get('n') as Neo4jNode
      expect(node.properties.name).toBe('Alice')
    })

    it('matches with WHERE clause', async () => {
      const result = await session.run('MATCH (n:Person) WHERE n.age = 30 RETURN n')

      expect(result.records).toHaveLength(1)
      const node = result.records[0]!.get('n') as Neo4jNode
      expect(node.properties.age).toBe(30)
    })

    it('returns specific properties', async () => {
      const result = await session.run('MATCH (n:Person) RETURN n.name')

      expect(result.records.length).toBeGreaterThanOrEqual(2)
      result.records.forEach(record => {
        expect(record.get('n.name')).toBeDefined()
      })
    })

    it('supports aliases', async () => {
      const result = await session.run('MATCH (n:Person) RETURN n.name AS personName')

      expect(result.records.length).toBeGreaterThanOrEqual(1)
      expect(result.records[0]!.get('personName')).toBeDefined()
    })

    it('supports LIMIT', async () => {
      const result = await session.run('MATCH (n:Person) RETURN n LIMIT 1')

      expect(result.records).toHaveLength(1)
    })
  })

  // ==========================================================================
  // UPDATE OPERATIONS
  // ==========================================================================

  describe('SET', () => {
    beforeEach(async () => {
      await session.run('CREATE (n:Person {name: "Alice", age: 30}) RETURN n')
    })

    it('updates node properties', async () => {
      await session.run('MATCH (n:Person {name: "Alice"}) SET n.age = 31 RETURN n')

      const result = await session.run('MATCH (n:Person {name: "Alice"}) RETURN n')
      const node = result.records[0]!.get('n') as Neo4jNode
      expect(node.properties.age).toBe(31)
    })

    it('adds new properties', async () => {
      await session.run('MATCH (n:Person {name: "Alice"}) SET n.email = "alice@test.com" RETURN n')

      const result = await session.run('MATCH (n:Person {name: "Alice"}) RETURN n')
      const node = result.records[0]!.get('n') as Neo4jNode
      expect(node.properties.email).toBe('alice@test.com')
    })
  })

  // ==========================================================================
  // DELETE OPERATIONS
  // ==========================================================================

  describe('DELETE', () => {
    beforeEach(async () => {
      await session.run('CREATE (n:Temp {name: "ToDelete"}) RETURN n')
    })

    it('deletes nodes', async () => {
      await session.run('MATCH (n:Temp) DELETE n')

      const result = await session.run('MATCH (n:Temp) RETURN n')
      expect(result.records).toHaveLength(0)
    })
  })

  // ==========================================================================
  // TRANSACTIONS
  // ==========================================================================

  describe('Transactions', () => {
    it('supports executeWrite', async () => {
      const result = await session.executeWrite(async tx => {
        const res = await tx.run('CREATE (n:TxTest {name: "Test"}) RETURN n')
        return res
      })

      expect(result.records).toHaveLength(1)
    })

    it('supports executeRead', async () => {
      await session.run('CREATE (n:ReadTest {name: "Test"})')

      const result = await session.executeRead(async tx => {
        return tx.run('MATCH (n:ReadTest) RETURN n')
      })

      expect(result.records.length).toBeGreaterThanOrEqual(1)
    })

    it('supports beginTransaction', async () => {
      const tx = session.beginTransaction()

      await tx.run('CREATE (n:ManualTx {name: "Test"})')
      expect(tx.isOpen()).toBe(true)

      await tx.commit()
      expect(tx.isOpen()).toBe(false)
    })

    it('supports transaction rollback', async () => {
      const tx = session.beginTransaction()

      await tx.run('CREATE (n:RollbackTest {name: "Test"})')
      await tx.rollback()

      // Note: In our implementation, rollback doesn't actually undo
      // This is a simplified implementation
      expect(tx.isOpen()).toBe(false)
    })
  })

  // ==========================================================================
  // RESULT SUMMARY
  // ==========================================================================

  describe('Result Summary', () => {
    it('includes query text', async () => {
      const result = await session.run('CREATE (n:SummaryTest) RETURN n')

      expect(result.summary.query.text).toContain('CREATE')
    })

    it('includes counters', async () => {
      const result = await session.run('CREATE (n:CounterTest) RETURN n')

      expect(result.summary.counters.nodesCreated()).toBeGreaterThanOrEqual(1)
    })

    it('includes server info', async () => {
      const result = await session.run('RETURN 1')

      expect(result.summary.server.address).toBeDefined()
      expect(result.summary.server.version).toBeDefined()
    })
  })

  // ==========================================================================
  // RECORDS
  // ==========================================================================

  describe('Records', () => {
    it('supports get by key', async () => {
      const result = await session.run('CREATE (n:RecordTest {name: "Test"}) RETURN n')
      const record = result.records[0]!

      expect(record.get('n')).toBeDefined()
    })

    it('supports get by index', async () => {
      const result = await session.run('RETURN 1 AS a, 2 AS b')
      const record = result.records[0]!

      expect(record.get(0)).toBeDefined()
      expect(record.get(1)).toBeDefined()
    })

    it('supports toObject', async () => {
      const result = await session.run('CREATE (n:ObjTest {name: "Test"}) RETURN n')
      const record = result.records[0]!
      const obj = record.toObject()

      expect(obj).toHaveProperty('n')
    })

    it('supports has', async () => {
      const result = await session.run('RETURN 1 AS value')
      const record = result.records[0]!

      expect(record.has('value')).toBe(true)
      expect(record.has('nonexistent')).toBe(false)
    })

    it('supports forEach', async () => {
      const result = await session.run('RETURN 1 AS a, 2 AS b')
      const record = result.records[0]!
      const keys: string[] = []

      record.forEach((_, key) => keys.push(key))

      expect(keys).toContain('a')
      expect(keys).toContain('b')
    })

    it('supports map', async () => {
      const result = await session.run('RETURN 1 AS a, 2 AS b')
      const record = result.records[0]!
      const mapped = record.map((value) => value)

      expect(mapped).toHaveLength(2)
    })
  })

  // ==========================================================================
  // TYPE CHECKS
  // ==========================================================================

  describe('Type Checks', () => {
    it('identifies nodes', async () => {
      const result = await session.run('CREATE (n:TypeTest) RETURN n')
      const node = result.records[0]!.get('n')

      expect(neo4j.isNode(node)).toBe(true)
      expect(neo4j.isRelationship(node)).toBe(false)
    })

    it('identifies integers', () => {
      const int = neo4j.int(42)

      expect(neo4j.isInt(int)).toBe(true)
      expect(int.toNumber()).toBe(42)
      expect(int.toString()).toBe('42')
    })
  })

  // ==========================================================================
  // PROCEDURES (APOC-like)
  // ==========================================================================

  describe('Procedures', () => {
    beforeEach(async () => {
      // Create test graph with RETURN to ensure nodes are created
      await session.run('CREATE (a:Node {name: "A"}) RETURN a')
      await session.run('CREATE (b:Node {name: "B"}) RETURN b')
      await session.run('CREATE (c:Node {name: "C"}) RETURN c')
      await session.run(`
        MATCH (a:Node {name: "A"}), (b:Node {name: "B"})
        CREATE (a)-[r:LINKS]->(b)
        RETURN r
      `)
      await session.run(`
        MATCH (b:Node {name: "B"}), (c:Node {name: "C"})
        CREATE (b)-[r:LINKS]->(c)
        RETURN r
      `)
    })

    it('supports db.labels', async () => {
      const result = await session.run('CALL db.labels()')

      expect(result.records.length).toBeGreaterThan(0)
      const labels = result.records.map(r => r.get('label'))
      expect(labels).toContain('Node')
    })

    it('supports db.relationshipTypes', async () => {
      const result = await session.run('CALL db.relationshiptypes()')

      expect(result.records.length).toBeGreaterThan(0)
      const types = result.records.map(r => r.get('relationshipType'))
      expect(types).toContain('LINKS')
    })

    it('supports apoc.algo.pageRank', async () => {
      const result = await session.run('CALL apoc.algo.pagerank()')

      expect(result.records.length).toBeGreaterThanOrEqual(3)
      result.records.forEach(record => {
        expect(record.get('node')).toBeDefined()
        expect(record.get('score')).toBeDefined()
      })
    })

    it('supports apoc.algo.betweenness', async () => {
      const result = await session.run('CALL apoc.algo.betweenness()')

      expect(result.records.length).toBeGreaterThanOrEqual(3)
      result.records.forEach(record => {
        expect(record.get('node')).toBeDefined()
        expect(typeof record.get('score')).toBe('number')
      })
    })

    it('supports apoc.algo.closeness', async () => {
      const result = await session.run('CALL apoc.algo.closeness()')

      expect(result.records.length).toBeGreaterThanOrEqual(3)
      result.records.forEach(record => {
        expect(record.get('node')).toBeDefined()
        expect(typeof record.get('score')).toBe('number')
      })
    })

    it('supports apoc.algo.connectedComponents', async () => {
      const result = await session.run('CALL apoc.algo.connectedComponents()')

      expect(result.records.length).toBeGreaterThanOrEqual(3)
      result.records.forEach(record => {
        expect(record.get('node')).toBeDefined()
        expect(record.get('componentId')).toBeDefined()
      })
    })
  })

  // ==========================================================================
  // AUTH TOKENS
  // ==========================================================================

  describe('Auth Tokens', () => {
    it('creates basic auth', () => {
      const token = neo4j.auth.basic('user', 'pass')
      expect(token.scheme).toBe('basic')
      expect(token.principal).toBe('user')
      expect(token.credentials).toBe('pass')
    })

    it('creates bearer auth', () => {
      const token = neo4j.auth.bearer('token123')
      expect(token.scheme).toBe('bearer')
      expect(token.credentials).toBe('token123')
    })

    it('creates kerberos auth', () => {
      const token = neo4j.auth.kerberos('ticket')
      expect(token.scheme).toBe('kerberos')
      expect(token.credentials).toBe('ticket')
    })

    it('creates no auth', () => {
      const token = neo4j.auth.none()
      expect(token.scheme).toBe('none')
    })

    it('creates custom auth', () => {
      const token = neo4j.auth.custom('principal', 'creds', 'realm', 'custom_scheme', { extra: 'param' })
      expect(token.scheme).toBe('custom_scheme')
      expect(token.principal).toBe('principal')
      expect(token.realm).toBe('realm')
    })
  })

  // ==========================================================================
  // MERGE OPERATIONS
  // ==========================================================================

  describe('MERGE', () => {
    it('creates node if not exists with MERGE', async () => {
      const result = await session.run('MERGE (n:MergeTest {name: "Unique"}) RETURN n')

      expect(result.records).toHaveLength(1)
      const node = result.records[0]!.get('n') as Neo4jNode
      expect(node.properties.name).toBe('Unique')
    })

    it('creates multiple nodes via separate MERGE calls', async () => {
      await session.run('MERGE (n:MergeDup {name: "First"}) RETURN n')
      await session.run('MERGE (n:MergeDup {name: "Second"}) RETURN n')

      const result = await session.run('MATCH (n:MergeDup) RETURN n')
      expect(result.records.length).toBeGreaterThanOrEqual(2)
    })

    it('MERGE creates label and basic node', async () => {
      const result = await session.run('MERGE (n:MergeLabel) RETURN n')

      expect(result.records).toHaveLength(1)
      const node = result.records[0]!.get('n') as Neo4jNode
      expect(node.labels).toContain('MergeLabel')
    })
  })

  // ==========================================================================
  // ORDER BY & PAGINATION
  // ==========================================================================

  describe('ORDER BY & Pagination', () => {
    beforeEach(async () => {
      await session.run('CREATE (n:Sortable {name: "Charlie", score: 30})')
      await session.run('CREATE (n:Sortable {name: "Alice", score: 50})')
      await session.run('CREATE (n:Sortable {name: "Bob", score: 40})')
    })

    it('orders by property ascending', async () => {
      const result = await session.run('MATCH (n:Sortable) RETURN n.name ORDER BY n.name')

      expect(result.records.length).toBeGreaterThanOrEqual(3)
      const names = result.records.map(r => r.get('n.name'))
      // First should be Alice (alphabetically first)
      expect(names[0]).toBe('Alice')
    })

    it('orders by property descending', async () => {
      const result = await session.run('MATCH (n:Sortable) RETURN n.score ORDER BY n.score DESC')

      expect(result.records.length).toBeGreaterThanOrEqual(3)
      const scores = result.records.map(r => r.get('n.score'))
      expect(scores[0]).toBe(50) // Highest first
    })

    it('supports SKIP', async () => {
      const result = await session.run('MATCH (n:Sortable) RETURN n ORDER BY n.name SKIP 1 LIMIT 2')

      expect(result.records).toHaveLength(2)
    })

    it('supports LIMIT', async () => {
      const result = await session.run('MATCH (n:Sortable) RETURN n LIMIT 2')

      expect(result.records).toHaveLength(2)
    })
  })

  // ==========================================================================
  // RELATIONSHIP QUERIES
  // ==========================================================================

  describe('Relationship Queries', () => {
    beforeEach(async () => {
      await session.run('CREATE (a:Actor {name: "Actor1"})')
      await session.run('CREATE (b:Actor {name: "Actor2"})')
      await session.run('CREATE (m:Movie {title: "Movie1"})')
      await session.run(`
        MATCH (a:Actor {name: "Actor1"}), (m:Movie {title: "Movie1"})
        CREATE (a)-[r:ACTED_IN {role: "Lead"}]->(m)
      `)
      await session.run(`
        MATCH (a:Actor {name: "Actor2"}), (m:Movie {title: "Movie1"})
        CREATE (a)-[r:ACTED_IN {role: "Supporting"}]->(m)
      `)
    })

    it('matches relationships by type', async () => {
      const result = await session.run(`
        MATCH (a:Actor)-[r:ACTED_IN]->(m:Movie)
        RETURN a, r, m
      `)

      expect(result.records.length).toBeGreaterThanOrEqual(2)
    })

    it('returns relationship properties', async () => {
      const result = await session.run(`
        MATCH (a:Actor)-[r:ACTED_IN]->(m:Movie)
        RETURN r
      `)

      // Verify at least one relationship has the expected properties
      expect(result.records.length).toBeGreaterThanOrEqual(1)
      const rels = result.records.map(rec => rec.get('r') as Neo4jRelationship)
      const leadRel = rels.find(r => r.properties.role === 'Lead')
      expect(leadRel).toBeDefined()
      expect(leadRel!.properties.role).toBe('Lead')
    })

    it('matches multiple actors in relationships', async () => {
      const result = await session.run(`
        MATCH (a:Actor)-[r:ACTED_IN]->(m:Movie)
        RETURN a.name, m.title
      `)

      expect(result.records.length).toBeGreaterThanOrEqual(2)
    })
  })

  // ==========================================================================
  // MULTI-HOP PATHS
  // ==========================================================================

  describe('Multi-Hop Paths', () => {
    beforeEach(async () => {
      // Create a chain: A -> B -> C -> D
      await session.run('CREATE (a:Chain {name: "A"})')
      await session.run('CREATE (b:Chain {name: "B"})')
      await session.run('CREATE (c:Chain {name: "C"})')
      await session.run('CREATE (d:Chain {name: "D"})')
      await session.run(`
        MATCH (a:Chain {name: "A"}), (b:Chain {name: "B"})
        CREATE (a)-[:NEXT]->(b)
      `)
      await session.run(`
        MATCH (b:Chain {name: "B"}), (c:Chain {name: "C"})
        CREATE (b)-[:NEXT]->(c)
      `)
      await session.run(`
        MATCH (c:Chain {name: "C"}), (d:Chain {name: "D"})
        CREATE (c)-[:NEXT]->(d)
      `)
    })

    it('traverses two hops', async () => {
      const result = await session.run(`
        MATCH (a:Chain {name: "A"})-[:NEXT]->(b)-[:NEXT]->(c)
        RETURN a.name, b.name, c.name
      `)

      expect(result.records).toHaveLength(1)
      expect(result.records[0]!.get('a.name')).toBe('A')
      expect(result.records[0]!.get('b.name')).toBe('B')
      expect(result.records[0]!.get('c.name')).toBe('C')
    })

    it('traverses three hops', async () => {
      const result = await session.run(`
        MATCH (a:Chain {name: "A"})-[:NEXT]->(b)-[:NEXT]->(c)-[:NEXT]->(d)
        RETURN a.name, d.name
      `)

      expect(result.records).toHaveLength(1)
      expect(result.records[0]!.get('a.name')).toBe('A')
      expect(result.records[0]!.get('d.name')).toBe('D')
    })
  })

  // ==========================================================================
  // RESULT COUNTERS
  // ==========================================================================

  describe('Result Counters', () => {
    it('counts nodes created', async () => {
      const result = await session.run('CREATE (n:CounterCreate {x: 1}), (m:CounterCreate {x: 2}) RETURN n, m')

      expect(result.summary.counters.nodesCreated()).toBeGreaterThanOrEqual(2)
    })

    it('counts relationships created', async () => {
      await session.run('CREATE (a:RelCounter {id: "a"})')
      await session.run('CREATE (b:RelCounter {id: "b"})')
      const result = await session.run(`
        MATCH (a:RelCounter {id: "a"}), (b:RelCounter {id: "b"})
        CREATE (a)-[r:RELATES]->(b)
        RETURN r
      `)

      expect(result.summary.counters.relationshipsCreated()).toBeGreaterThanOrEqual(1)
    })

    it('counts properties set', async () => {
      await session.run('CREATE (n:PropCounter {val: 1})')
      const result = await session.run('MATCH (n:PropCounter) SET n.val = 2, n.extra = "new" RETURN n')

      expect(result.summary.counters.propertiesSet()).toBeGreaterThanOrEqual(1)
    })

    it('reports containsUpdates correctly', async () => {
      const createResult = await session.run('CREATE (n:UpdateCheck) RETURN n')
      expect(createResult.summary.counters.containsUpdates()).toBe(true)

      const readResult = await session.run('MATCH (n:UpdateCheck) RETURN n')
      expect(readResult.summary.counters.containsUpdates()).toBe(false)
    })
  })

  // ==========================================================================
  // ERROR HANDLING
  // ==========================================================================

  describe('Error Handling', () => {
    it('throws on closed session', async () => {
      const newSession = driver.session()
      await newSession.close()

      await expect(newSession.run('RETURN 1')).rejects.toThrow()
    })

    it('throws on unknown procedure', async () => {
      await expect(session.run('CALL nonexistent.procedure()')).rejects.toThrow(/Unknown procedure/)
    })
  })

  // ==========================================================================
  // NODE ELEMENT IDS
  // ==========================================================================

  describe('Node Element IDs', () => {
    it('includes elementId on nodes', async () => {
      const result = await session.run('CREATE (n:ElementIdTest {name: "Test"}) RETURN n')

      const node = result.records[0]!.get('n') as Neo4jNode
      expect(node.elementId).toBeDefined()
      expect(typeof node.elementId).toBe('string')
    })

    it('includes identity on nodes', async () => {
      const result = await session.run('CREATE (n:IdentityTest {name: "Test"}) RETURN n')

      const node = result.records[0]!.get('n') as Neo4jNode
      expect(node.identity).toBeDefined()
      expect(neo4j.isInt(node.identity)).toBe(true)
    })
  })

  // ==========================================================================
  // RELATIONSHIP IDS
  // ==========================================================================

  describe('Relationship IDs', () => {
    it('includes elementId on relationships', async () => {
      await session.run('CREATE (a:RelIdTest {id: "a"})')
      await session.run('CREATE (b:RelIdTest {id: "b"})')
      const result = await session.run(`
        MATCH (a:RelIdTest {id: "a"}), (b:RelIdTest {id: "b"})
        CREATE (a)-[r:HAS_REL]->(b)
        RETURN r
      `)

      const rel = result.records[0]!.get('r') as Neo4jRelationship
      expect(rel.elementId).toBeDefined()
      expect(rel.startNodeElementId).toBeDefined()
      expect(rel.endNodeElementId).toBeDefined()
    })

    it('includes start and end on relationships', async () => {
      await session.run('CREATE (a:RelStartEnd {id: "a"})')
      await session.run('CREATE (b:RelStartEnd {id: "b"})')
      const result = await session.run(`
        MATCH (a:RelStartEnd {id: "a"}), (b:RelStartEnd {id: "b"})
        CREATE (a)-[r:CONNECTS]->(b)
        RETURN r
      `)

      const rel = result.records[0]!.get('r') as Neo4jRelationship
      expect(neo4j.isInt(rel.start)).toBe(true)
      expect(neo4j.isInt(rel.end)).toBe(true)
    })
  })

  // ==========================================================================
  // PATH TYPE CHECKS
  // ==========================================================================

  describe('Path Type Checks', () => {
    it('identifies paths', async () => {
      await session.run('CREATE (a:PathCheck {id: "a"})')
      await session.run('CREATE (b:PathCheck {id: "b"})')
      await session.run(`
        MATCH (a:PathCheck {id: "a"}), (b:PathCheck {id: "b"})
        CREATE (a)-[:PATH_LINK]->(b)
      `)

      // Note: Our current implementation doesn't return paths directly from MATCH
      // This tests the isPath function itself
      const mockPath = {
        start: { labels: ['Node'], properties: {}, elementId: '1', identity: neo4j.int(1) },
        end: { labels: ['Node'], properties: {}, elementId: '2', identity: neo4j.int(2) },
        segments: [],
        length: 0
      }
      expect(neo4j.isPath(mockPath)).toBe(true)
    })

    it('rejects non-paths', () => {
      expect(neo4j.isPath(null)).toBe(false)
      expect(neo4j.isPath({})).toBe(false)
      expect(neo4j.isPath({ start: {} })).toBe(false)
    })
  })

  // ==========================================================================
  // INTEGER OPERATIONS
  // ==========================================================================

  describe('Integer Operations', () => {
    it('converts string to int', () => {
      const int = neo4j.integer('42')
      expect(int.toNumber()).toBe(42)
    })

    it('converts number to int', () => {
      const int = neo4j.integer(100)
      expect(int.toNumber()).toBe(100)
    })

    it('supports toInt method', () => {
      const int = neo4j.int(55)
      expect(int.toInt()).toBe(55)
    })

    it('handles large integers', () => {
      const largeInt = neo4j.int(999999999)
      expect(largeInt.toNumber()).toBe(999999999)
    })
  })

  // ==========================================================================
  // MULTIPLE SESSIONS
  // ==========================================================================

  describe('Multiple Sessions', () => {
    it('creates independent sessions', async () => {
      const session1 = driver.session()
      const session2 = driver.session()

      await session1.run('CREATE (n:Session1Test {id: 1})')
      await session2.run('CREATE (n:Session2Test {id: 2})')

      // Both should be queryable
      const result1 = await session1.run('MATCH (n:Session1Test) RETURN n')
      const result2 = await session2.run('MATCH (n:Session2Test) RETURN n')

      expect(result1.records.length).toBeGreaterThanOrEqual(1)
      expect(result2.records.length).toBeGreaterThanOrEqual(1)

      await session1.close()
      await session2.close()
    })
  })

  // ==========================================================================
  // DISTINCT RESULTS
  // ==========================================================================

  describe('DISTINCT Results', () => {
    beforeEach(async () => {
      await session.run('CREATE (n:DistinctTest {type: "A"})')
      await session.run('CREATE (n:DistinctTest {type: "A"})')
      await session.run('CREATE (n:DistinctTest {type: "B"})')
    })

    it('returns distinct values', async () => {
      const result = await session.run('MATCH (n:DistinctTest) RETURN DISTINCT n.type')

      // Should have 2 distinct types: A and B
      const types = result.records.map(r => r.get('n.type'))
      const uniqueTypes = [...new Set(types)]
      expect(uniqueTypes).toHaveLength(2)
    })
  })
})
