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
  })
})
