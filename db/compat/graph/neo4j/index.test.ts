/**
 * @dotdo/neo4j - Neo4j SDK compat tests
 *
 * Tests for Neo4j driver API compatibility backed by DO SQLite with JSON storage:
 * - driver(url, auth) / neo4j.driver()
 * - session.run(cypher, params)
 * - Node CRUD: CREATE, MATCH, SET, DELETE
 * - Relationship CRUD
 * - Basic Cypher parsing (MATCH, WHERE, RETURN, ORDER BY, LIMIT)
 * - Graph traversal patterns
 * - Transactions (beginTransaction, commit, rollback)
 * - Parameters and type conversion
 *
 * @see https://neo4j.com/docs/javascript-manual/current/
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type {
  Driver,
  Session,
  Transaction,
  Result,
  Node,
  Relationship,
  Path,
  ResultSummary,
  Record,
  DriverConfig,
  SessionConfig,
  TransactionConfig,
} from './types'
import {
  Integer,
  int,
  isInt,
  isNode,
  isRelationship,
  isPath,
  Point,
  Date as Neo4jDate,
  DateTime,
  LocalDateTime,
  Duration,
  Neo4jError,
  ServiceUnavailableError,
  SessionExpiredError,
  DatabaseError,
  ClientError,
  TransientError,
  auth,
  NodeImpl,
  RelationshipImpl,
  PathImpl,
} from './types'
import neo4j, { driver as createDriver, clearStorage } from './neo4j'

// ============================================================================
// DRIVER CREATION & CONNECTION TESTS
// ============================================================================

describe('Driver creation and connection', () => {
  it('should create driver with bolt URL', () => {
    const d = createDriver('bolt://localhost:7687', auth.basic('neo4j', 'password'))
    expect(d).toBeDefined()
  })

  it('should create driver with neo4j URL', () => {
    const d = createDriver('neo4j://localhost:7687', auth.basic('neo4j', 'password'))
    expect(d).toBeDefined()
  })

  it('should create driver using default export', () => {
    const d = neo4j.driver('bolt://localhost:7687', neo4j.auth.basic('neo4j', 'password'))
    expect(d).toBeDefined()
  })

  it('should create driver with config options', () => {
    const d = createDriver('bolt://localhost:7687', auth.basic('neo4j', 'password'), {
      maxConnectionPoolSize: 50,
      connectionTimeout: 30000,
      encrypted: true,
    })
    expect(d).toBeDefined()
  })

  it('should verify connectivity', async () => {
    const d = createDriver('bolt://localhost:7687', auth.basic('neo4j', 'password'))
    const serverInfo = await d.verifyConnectivity()
    expect(serverInfo).toBeDefined()
    expect(serverInfo.address).toBeDefined()
    await d.close()
  })

  it('should get server info', async () => {
    const d = createDriver('bolt://localhost:7687', auth.basic('neo4j', 'password'))
    const serverInfo = await d.getServerInfo()
    expect(serverInfo.address).toBe('localhost:7687')
    expect(serverInfo.protocolVersion).toBeDefined()
    await d.close()
  })

  it('should close driver', async () => {
    const d = createDriver('bolt://localhost:7687', auth.basic('neo4j', 'password'))
    await d.close()
    // Driver should be closed
  })

  it('should support multi-database', () => {
    const d = createDriver('bolt://localhost:7687', auth.basic('neo4j', 'password'))
    expect(d.supportsMultiDatabase()).toBe(true)
  })

  it('should support transaction config', () => {
    const d = createDriver('bolt://localhost:7687', auth.basic('neo4j', 'password'))
    expect(d.supportsTransactionConfig()).toBe(true)
  })
})

// ============================================================================
// AUTH TESTS
// ============================================================================

describe('Authentication', () => {
  it('should create basic auth token', () => {
    const token = auth.basic('neo4j', 'password')
    expect(token.scheme).toBe('basic')
    expect(token.principal).toBe('neo4j')
    expect(token.credentials).toBe('password')
  })

  it('should create basic auth with realm', () => {
    const token = auth.basic('neo4j', 'password', 'native')
    expect(token.realm).toBe('native')
  })

  it('should create kerberos auth', () => {
    const token = auth.kerberos('base64ticket')
    expect(token.scheme).toBe('kerberos')
    expect(token.credentials).toBe('base64ticket')
  })

  it('should create bearer auth', () => {
    const token = auth.bearer('base64token')
    expect(token.scheme).toBe('bearer')
    expect(token.credentials).toBe('base64token')
  })

  it('should create custom auth', () => {
    const token = auth.custom('user', 'creds', 'realm', 'custom-scheme', { extra: 'data' })
    expect(token.scheme).toBe('custom-scheme')
    expect(token.parameters).toEqual({ extra: 'data' })
  })
})

// ============================================================================
// SESSION MANAGEMENT TESTS
// ============================================================================

describe('Session management', () => {
  let d: Driver

  beforeEach(() => {
    d = createDriver('bolt://localhost:7687', auth.basic('neo4j', 'password'))
  })

  afterEach(async () => {
    await d.close()
  })

  it('should create session', () => {
    const session = d.session()
    expect(session).toBeDefined()
  })

  it('should create session with database', () => {
    const session = d.session({ database: 'neo4j' })
    expect(session).toBeDefined()
  })

  it('should create session with access mode', () => {
    const readSession = d.session({ defaultAccessMode: 'READ' })
    const writeSession = d.session({ defaultAccessMode: 'WRITE' })
    expect(readSession).toBeDefined()
    expect(writeSession).toBeDefined()
  })

  it('should create session with bookmarks', () => {
    const session = d.session({ bookmarks: ['bookmark1', 'bookmark2'] })
    expect(session).toBeDefined()
  })

  it('should close session', async () => {
    const session = d.session()
    await session.close()
    // Session should be closed
  })

  it('should get last bookmarks', async () => {
    const session = d.session()
    const bookmarks = session.lastBookmarks()
    expect(Array.isArray(bookmarks)).toBe(true)
    await session.close()
  })
})

// ============================================================================
// NODE CRUD TESTS
// ============================================================================

describe('Node CRUD operations', () => {
  let d: Driver
  let session: Session

  beforeEach(async () => {
    clearStorage() // Ensure clean slate
    d = createDriver('bolt://localhost:7687', auth.basic('neo4j', 'password'))
    session = d.session()
  })

  afterEach(async () => {
    await session.close()
    await d.close()
  })

  it('should create a node with single label', async () => {
    const result = await session.run('CREATE (n:Person {name: $name}) RETURN n', { name: 'Alice' })
    const records = await result.records()
    expect(records.length).toBe(1)
    const node = records[0].get('n') as Node
    expect(isNode(node)).toBe(true)
    expect(node.labels).toContain('Person')
    expect(node.properties.name).toBe('Alice')
  })

  it('should create a node with multiple labels', async () => {
    const result = await session.run('CREATE (n:Person:Employee {name: $name}) RETURN n', { name: 'Bob' })
    const records = await result.records()
    const node = records[0].get('n') as Node
    expect(node.labels).toContain('Person')
    expect(node.labels).toContain('Employee')
  })

  it('should create a node with multiple properties', async () => {
    const result = await session.run(
      'CREATE (n:Person {name: $name, age: $age, active: $active}) RETURN n',
      { name: 'Charlie', age: 30, active: true }
    )
    const records = await result.records()
    const node = records[0].get('n') as Node
    expect(node.properties.name).toBe('Charlie')
    expect(node.properties.age).toBe(30)
    expect(node.properties.active).toBe(true)
  })

  it('should match nodes by label', async () => {
    await session.run('CREATE (n:Person {name: $name})', { name: 'Alice' })
    await session.run('CREATE (n:Person {name: $name})', { name: 'Bob' })
    await session.run('CREATE (n:Company {name: $name})', { name: 'Acme' })

    const result = await session.run('MATCH (n:Person) RETURN n')
    const records = await result.records()
    expect(records.length).toBe(2)
  })

  it('should match nodes by property', async () => {
    await session.run('CREATE (n:Person {name: $name, age: $age})', { name: 'Alice', age: 30 })
    await session.run('CREATE (n:Person {name: $name, age: $age})', { name: 'Bob', age: 25 })

    const result = await session.run('MATCH (n:Person {age: $age}) RETURN n', { age: 30 })
    const records = await result.records()
    expect(records.length).toBe(1)
    expect((records[0].get('n') as Node).properties.name).toBe('Alice')
  })

  it('should match nodes with WHERE clause', async () => {
    await session.run('CREATE (n:Person {name: $name, age: $age})', { name: 'Alice', age: 30 })
    await session.run('CREATE (n:Person {name: $name, age: $age})', { name: 'Bob', age: 25 })
    await session.run('CREATE (n:Person {name: $name, age: $age})', { name: 'Charlie', age: 35 })

    const result = await session.run('MATCH (n:Person) WHERE n.age > $minAge RETURN n', { minAge: 28 })
    const records = await result.records()
    expect(records.length).toBe(2)
  })

  it('should update node properties with SET', async () => {
    await session.run('CREATE (n:Person {name: $name, age: $age})', { name: 'Alice', age: 30 })
    await session.run('MATCH (n:Person {name: $name}) SET n.age = $newAge', { name: 'Alice', newAge: 31 })

    const result = await session.run('MATCH (n:Person {name: $name}) RETURN n', { name: 'Alice' })
    const records = await result.records()
    expect((records[0].get('n') as Node).properties.age).toBe(31)
  })

  it('should add new property with SET', async () => {
    await session.run('CREATE (n:Person {name: $name})', { name: 'Alice' })
    await session.run('MATCH (n:Person {name: $name}) SET n.city = $city', { name: 'Alice', city: 'NYC' })

    const result = await session.run('MATCH (n:Person {name: $name}) RETURN n', { name: 'Alice' })
    const records = await result.records()
    expect((records[0].get('n') as Node).properties.city).toBe('NYC')
  })

  it('should remove property with REMOVE', async () => {
    await session.run('CREATE (n:Person {name: $name, age: $age})', { name: 'Alice', age: 30 })
    await session.run('MATCH (n:Person {name: $name}) REMOVE n.age', { name: 'Alice' })

    const result = await session.run('MATCH (n:Person {name: $name}) RETURN n', { name: 'Alice' })
    const records = await result.records()
    expect((records[0].get('n') as Node).properties.age).toBeUndefined()
  })

  it('should delete a node', async () => {
    await session.run('CREATE (n:Person {name: $name})', { name: 'ToDelete' })
    await session.run('MATCH (n:Person {name: $name}) DELETE n', { name: 'ToDelete' })

    const result = await session.run('MATCH (n:Person {name: $name}) RETURN n', { name: 'ToDelete' })
    const records = await result.records()
    expect(records.length).toBe(0)
  })

  it('should return node identity', async () => {
    const result = await session.run('CREATE (n:Person {name: $name}) RETURN n', { name: 'Alice' })
    const records = await result.records()
    const node = records[0].get('n') as Node
    expect(node.identity).toBeDefined()
    expect(isInt(node.identity)).toBe(true)
  })

  it('should return element ID', async () => {
    const result = await session.run('CREATE (n:Person {name: $name}) RETURN n', { name: 'Alice' })
    const records = await result.records()
    const node = records[0].get('n') as Node
    expect(node.elementId).toBeDefined()
    expect(typeof node.elementId).toBe('string')
  })
})

// ============================================================================
// RELATIONSHIP CRUD TESTS
// ============================================================================

describe('Relationship CRUD operations', () => {
  let d: Driver
  let session: Session

  beforeEach(async () => {
    clearStorage() // Ensure clean slate
    d = createDriver('bolt://localhost:7687', auth.basic('neo4j', 'password'))
    session = d.session()
    // Create test nodes
    await session.run('CREATE (a:Person {name: $name})', { name: 'Alice' })
    await session.run('CREATE (b:Person {name: $name})', { name: 'Bob' })
  })

  afterEach(async () => {
    await session.close()
    await d.close()
  })

  it('should create a relationship', async () => {
    await session.run(
      'MATCH (a:Person {name: $a}), (b:Person {name: $b}) CREATE (a)-[r:KNOWS]->(b)',
      { a: 'Alice', b: 'Bob' }
    )

    const result = await session.run(
      'MATCH (a:Person {name: $a})-[r:KNOWS]->(b:Person {name: $b}) RETURN r',
      { a: 'Alice', b: 'Bob' }
    )
    const records = await result.records()
    expect(records.length).toBe(1)
  })

  it('should create relationship with properties', async () => {
    await session.run(
      'MATCH (a:Person {name: $a}), (b:Person {name: $b}) CREATE (a)-[r:KNOWS {since: $since}]->(b)',
      { a: 'Alice', b: 'Bob', since: 2020 }
    )

    const result = await session.run(
      'MATCH (a:Person)-[r:KNOWS]->(b:Person) RETURN r',
      {}
    )
    const records = await result.records()
    const rel = records[0].get('r') as Relationship
    expect(isRelationship(rel)).toBe(true)
    expect(rel.properties.since).toBe(2020)
  })

  it('should return relationship type', async () => {
    await session.run(
      'MATCH (a:Person {name: $a}), (b:Person {name: $b}) CREATE (a)-[r:FRIENDS_WITH]->(b)',
      { a: 'Alice', b: 'Bob' }
    )

    const result = await session.run('MATCH ()-[r:FRIENDS_WITH]->() RETURN r')
    const records = await result.records()
    const rel = records[0].get('r') as Relationship
    expect(rel.type).toBe('FRIENDS_WITH')
  })

  it('should return relationship start and end', async () => {
    await session.run(
      'MATCH (a:Person {name: $a}), (b:Person {name: $b}) CREATE (a)-[r:KNOWS]->(b)',
      { a: 'Alice', b: 'Bob' }
    )

    const result = await session.run('MATCH (a)-[r]->(b) RETURN a, r, b')
    const records = await result.records()
    const rel = records[0].get('r') as Relationship
    const startNode = records[0].get('a') as Node
    const endNode = records[0].get('b') as Node
    expect(rel.start.equals(startNode.identity)).toBe(true)
    expect(rel.end.equals(endNode.identity)).toBe(true)
  })

  it('should match any relationship type with []', async () => {
    await session.run(
      'MATCH (a:Person {name: $a}), (b:Person {name: $b}) CREATE (a)-[:KNOWS]->(b)',
      { a: 'Alice', b: 'Bob' }
    )

    const result = await session.run('MATCH (a)-[r]->(b) RETURN r')
    const records = await result.records()
    expect(records.length).toBe(1)
  })

  it('should update relationship properties', async () => {
    await session.run(
      'MATCH (a:Person {name: $a}), (b:Person {name: $b}) CREATE (a)-[r:KNOWS {since: $since}]->(b)',
      { a: 'Alice', b: 'Bob', since: 2020 }
    )
    await session.run(
      'MATCH ()-[r:KNOWS]->() SET r.since = $newSince',
      { newSince: 2021 }
    )

    const result = await session.run('MATCH ()-[r:KNOWS]->() RETURN r')
    const records = await result.records()
    expect((records[0].get('r') as Relationship).properties.since).toBe(2021)
  })

  it('should delete relationship', async () => {
    await session.run(
      'MATCH (a:Person {name: $a}), (b:Person {name: $b}) CREATE (a)-[r:KNOWS]->(b)',
      { a: 'Alice', b: 'Bob' }
    )
    await session.run('MATCH ()-[r:KNOWS]->() DELETE r')

    const result = await session.run('MATCH ()-[r:KNOWS]->() RETURN r')
    const records = await result.records()
    expect(records.length).toBe(0)
  })

  it('should delete node with DETACH DELETE', async () => {
    await session.run(
      'MATCH (a:Person {name: $a}), (b:Person {name: $b}) CREATE (a)-[r:KNOWS]->(b)',
      { a: 'Alice', b: 'Bob' }
    )
    await session.run('MATCH (n:Person {name: $name}) DETACH DELETE n', { name: 'Alice' })

    const result = await session.run('MATCH (n:Person {name: $name}) RETURN n', { name: 'Alice' })
    const records = await result.records()
    expect(records.length).toBe(0)
  })
})

// ============================================================================
// CYPHER PARSING TESTS
// ============================================================================

describe('Basic Cypher parsing', () => {
  let d: Driver
  let session: Session

  beforeEach(async () => {
    clearStorage() // Ensure clean slate
    d = createDriver('bolt://localhost:7687', auth.basic('neo4j', 'password'))
    session = d.session()
    // Create test data
    await session.run('CREATE (a:Person {name: $name, age: $age})', { name: 'Alice', age: 30 })
    await session.run('CREATE (b:Person {name: $name, age: $age})', { name: 'Bob', age: 25 })
    await session.run('CREATE (c:Person {name: $name, age: $age})', { name: 'Charlie', age: 35 })
  })

  afterEach(async () => {
    await session.close()
    await d.close()
  })

  it('should parse RETURN with specific fields', async () => {
    const result = await session.run('MATCH (n:Person) RETURN n.name, n.age')
    const records = await result.records()
    expect(records.length).toBe(3)
    expect(records[0].has('n.name')).toBe(true)
    expect(records[0].has('n.age')).toBe(true)
  })

  it('should parse RETURN with alias', async () => {
    const result = await session.run('MATCH (n:Person) RETURN n.name AS name')
    const records = await result.records()
    expect(records[0].has('name')).toBe(true)
  })

  it('should parse ORDER BY ascending', async () => {
    const result = await session.run('MATCH (n:Person) RETURN n ORDER BY n.age')
    const records = await result.records()
    const ages = records.map(r => (r.get('n') as Node).properties.age)
    expect(ages).toEqual([25, 30, 35])
  })

  it('should parse ORDER BY descending', async () => {
    const result = await session.run('MATCH (n:Person) RETURN n ORDER BY n.age DESC')
    const records = await result.records()
    const ages = records.map(r => (r.get('n') as Node).properties.age)
    expect(ages).toEqual([35, 30, 25])
  })

  it('should parse LIMIT', async () => {
    const result = await session.run('MATCH (n:Person) RETURN n LIMIT 2')
    const records = await result.records()
    expect(records.length).toBe(2)
  })

  it('should parse SKIP', async () => {
    const result = await session.run('MATCH (n:Person) RETURN n ORDER BY n.age SKIP 1')
    const records = await result.records()
    expect(records.length).toBe(2)
    expect((records[0].get('n') as Node).properties.age).toBe(30)
  })

  it('should parse SKIP and LIMIT together', async () => {
    const result = await session.run('MATCH (n:Person) RETURN n ORDER BY n.age SKIP 1 LIMIT 1')
    const records = await result.records()
    expect(records.length).toBe(1)
    expect((records[0].get('n') as Node).properties.age).toBe(30)
  })

  it('should parse WHERE with comparison operators', async () => {
    const result = await session.run('MATCH (n:Person) WHERE n.age >= 30 RETURN n')
    const records = await result.records()
    expect(records.length).toBe(2)
  })

  it('should parse WHERE with AND', async () => {
    const result = await session.run('MATCH (n:Person) WHERE n.age > 25 AND n.age < 35 RETURN n')
    const records = await result.records()
    expect(records.length).toBe(1)
    expect((records[0].get('n') as Node).properties.name).toBe('Alice')
  })

  it('should parse WHERE with OR', async () => {
    const result = await session.run('MATCH (n:Person) WHERE n.name = $a OR n.name = $b RETURN n', { a: 'Alice', b: 'Bob' })
    const records = await result.records()
    expect(records.length).toBe(2)
  })

  it('should parse WHERE with CONTAINS', async () => {
    const result = await session.run('MATCH (n:Person) WHERE n.name CONTAINS $substr RETURN n', { substr: 'lic' })
    const records = await result.records()
    expect(records.length).toBe(1)
    expect((records[0].get('n') as Node).properties.name).toBe('Alice')
  })

  it('should parse WHERE with STARTS WITH', async () => {
    const result = await session.run('MATCH (n:Person) WHERE n.name STARTS WITH $prefix RETURN n', { prefix: 'Al' })
    const records = await result.records()
    expect(records.length).toBe(1)
  })

  it('should parse WHERE with ENDS WITH', async () => {
    const result = await session.run('MATCH (n:Person) WHERE n.name ENDS WITH $suffix RETURN n', { suffix: 'ob' })
    const records = await result.records()
    expect(records.length).toBe(1)
    expect((records[0].get('n') as Node).properties.name).toBe('Bob')
  })

  it('should parse WHERE with IN list', async () => {
    const result = await session.run('MATCH (n:Person) WHERE n.name IN $names RETURN n', { names: ['Alice', 'Charlie'] })
    const records = await result.records()
    expect(records.length).toBe(2)
  })

  it('should parse WHERE with IS NULL', async () => {
    await session.run('CREATE (n:Person {name: $name})', { name: 'NoAge' })
    const result = await session.run('MATCH (n:Person) WHERE n.age IS NULL RETURN n')
    const records = await result.records()
    expect(records.length).toBe(1)
    expect((records[0].get('n') as Node).properties.name).toBe('NoAge')
  })

  it('should parse WHERE with IS NOT NULL', async () => {
    await session.run('CREATE (n:Person {name: $name})', { name: 'NoAge' })
    const result = await session.run('MATCH (n:Person) WHERE n.age IS NOT NULL RETURN n')
    const records = await result.records()
    expect(records.length).toBe(3)
  })
})

// ============================================================================
// GRAPH TRAVERSAL TESTS
// ============================================================================

describe('Graph traversal patterns', () => {
  let d: Driver
  let session: Session

  beforeEach(async () => {
    clearStorage() // Ensure clean slate
    d = createDriver('bolt://localhost:7687', auth.basic('neo4j', 'password'))
    session = d.session()
    // Create a small social graph - note: separate statements work better
    await session.run('CREATE (n:Person {name: $name})', { name: 'Alice' })
    await session.run('CREATE (n:Person {name: $name})', { name: 'Bob' })
    await session.run('CREATE (n:Person {name: $name})', { name: 'Charlie' })
    await session.run('CREATE (n:Person {name: $name})', { name: 'Diana' })
    await session.run('MATCH (a:Person {name: $a}), (b:Person {name: $b}) CREATE (a)-[:KNOWS]->(b)', { a: 'Alice', b: 'Bob' })
    await session.run('MATCH (a:Person {name: $a}), (b:Person {name: $b}) CREATE (a)-[:KNOWS]->(b)', { a: 'Bob', b: 'Charlie' })
    await session.run('MATCH (a:Person {name: $a}), (b:Person {name: $b}) CREATE (a)-[:KNOWS]->(b)', { a: 'Charlie', b: 'Diana' })
    await session.run('MATCH (a:Person {name: $a}), (b:Person {name: $b}) CREATE (a)-[:KNOWS]->(b)', { a: 'Alice', b: 'Charlie' })
  })

  afterEach(async () => {
    await session.close()
    await d.close()
  })

  it('should traverse direct relationships', async () => {
    const result = await session.run(
      'MATCH (a:Person {name: $name})-[:KNOWS]->(b) RETURN b',
      { name: 'Alice' }
    )
    const records = await result.records()
    expect(records.length).toBe(2) // Alice knows Bob and Charlie
  })

  it('should traverse variable length paths *1..2', async () => {
    const result = await session.run(
      'MATCH (a:Person {name: $name})-[:KNOWS*1..2]->(b) RETURN DISTINCT b',
      { name: 'Alice' }
    )
    const records = await result.records()
    // Alice -> Bob, Alice -> Charlie, Bob -> Charlie (through Alice->Bob->Charlie)
    expect(records.length).toBeGreaterThanOrEqual(2)
  })

  it('should traverse variable length paths *1..3', async () => {
    const result = await session.run(
      'MATCH (a:Person {name: $name})-[:KNOWS*1..3]->(b) RETURN DISTINCT b',
      { name: 'Alice' }
    )
    const records = await result.records()
    // Should reach Diana through the chain
    const names = records.map(r => (r.get('b') as Node).properties.name)
    expect(names).toContain('Diana')
  })

  it.skip('should return paths', async () => {
    // TODO: Path variable assignment not yet implemented
    const result = await session.run(
      'MATCH p = (a:Person {name: $name})-[:KNOWS*1..2]->(b) RETURN p',
      { name: 'Alice' }
    )
    const records = await result.records()
    expect(records.length).toBeGreaterThan(0)
    const path = records[0].get('p') as Path
    expect(isPath(path)).toBe(true)
    expect(path.start).toBeDefined()
    expect(path.end).toBeDefined()
    expect(path.segments).toBeDefined()
  })

  it('should traverse bidirectional relationships', async () => {
    const result = await session.run(
      'MATCH (a:Person {name: $name})-[:KNOWS]-(b) RETURN b',
      { name: 'Bob' }
    )
    const records = await result.records()
    // Bob is connected to Alice (incoming) and Charlie (outgoing)
    expect(records.length).toBe(2)
  })

  it('should traverse any relationship type', async () => {
    await session.run(`
      MATCH (a:Person {name: 'Alice'}), (b:Person {name: 'Diana'})
      CREATE (a)-[:WORKS_WITH]->(b)
    `)

    const result = await session.run(
      'MATCH (a:Person {name: $name})-[]->(b) RETURN b',
      { name: 'Alice' }
    )
    const records = await result.records()
    // Alice knows Bob, Charlie and works_with Diana
    expect(records.length).toBe(3)
  })

  it.skip('should handle shortest path', async () => {
    // TODO: shortestPath function not yet implemented
    const result = await session.run(
      'MATCH p = shortestPath((a:Person {name: $from})-[*]-(b:Person {name: $to})) RETURN p',
      { from: 'Alice', to: 'Diana' }
    )
    const records = await result.records()
    expect(records.length).toBe(1)
  })

  it('should count relationships', async () => {
    const result = await session.run(
      'MATCH (a:Person {name: $name})-[r:KNOWS]->() RETURN count(r) AS count',
      { name: 'Alice' }
    )
    const records = await result.records()
    expect(records[0].get('count')).toBe(2)
  })
})

// ============================================================================
// TRANSACTION TESTS
// ============================================================================

describe('Transactions', () => {
  let d: Driver
  let session: Session

  beforeEach(async () => {
    clearStorage() // Ensure clean slate
    d = createDriver('bolt://localhost:7687', auth.basic('neo4j', 'password'))
    session = d.session()
  })

  afterEach(async () => {
    await session.close()
    await d.close()
  })

  it('should begin transaction', async () => {
    const tx = session.beginTransaction()
    expect(tx).toBeDefined()
    expect(tx.isOpen()).toBe(true)
    await tx.rollback()
  })

  it('should run queries in transaction', async () => {
    const tx = session.beginTransaction()
    await tx.run('CREATE (n:Person {name: $name})', { name: 'TxPerson' })
    const result = await tx.run('MATCH (n:Person {name: $name}) RETURN n', { name: 'TxPerson' })
    const records = await result.records()
    expect(records.length).toBe(1)
    await tx.rollback()
  })

  it('should commit transaction', async () => {
    const tx = session.beginTransaction()
    await tx.run('CREATE (n:Person {name: $name})', { name: 'Committed' })
    await tx.commit()

    // Verify the data persisted
    const result = await session.run('MATCH (n:Person {name: $name}) RETURN n', { name: 'Committed' })
    const records = await result.records()
    expect(records.length).toBe(1)
  })

  it('should rollback transaction', async () => {
    const tx = session.beginTransaction()
    await tx.run('CREATE (n:Person {name: $name})', { name: 'RolledBack' })
    await tx.rollback()

    // Verify the data was not persisted
    const result = await session.run('MATCH (n:Person {name: $name}) RETURN n', { name: 'RolledBack' })
    const records = await result.records()
    expect(records.length).toBe(0)
  })

  it('should close transaction (implicit rollback)', async () => {
    const tx = session.beginTransaction()
    await tx.run('CREATE (n:Person {name: $name})', { name: 'Closed' })
    await tx.close()

    // Should have rolled back
    const result = await session.run('MATCH (n:Person {name: $name}) RETURN n', { name: 'Closed' })
    const records = await result.records()
    expect(records.length).toBe(0)
  })

  it('should execute read transaction', async () => {
    await session.run('CREATE (n:Person {name: $name})', { name: 'ReadTarget' })

    const result = await session.executeRead(async (tx) => {
      const res = await tx.run('MATCH (n:Person {name: $name}) RETURN n', { name: 'ReadTarget' })
      return res.records()
    })
    expect(result.length).toBe(1)
  })

  it('should execute write transaction', async () => {
    await session.executeWrite(async (tx) => {
      await tx.run('CREATE (n:Person {name: $name})', { name: 'WriteTarget' })
    })

    const result = await session.run('MATCH (n:Person {name: $name}) RETURN n', { name: 'WriteTarget' })
    const records = await result.records()
    expect(records.length).toBe(1)
  })

  it('should retry failed transaction', async () => {
    let attempts = 0
    await session.executeWrite(async (tx) => {
      attempts++
      await tx.run('CREATE (n:Person {name: $name})', { name: 'Retried' })
    })
    expect(attempts).toBeGreaterThanOrEqual(1)
  })

  it('should use transaction config', async () => {
    const tx = session.beginTransaction({ timeout: 5000, metadata: { app: 'test' } })
    expect(tx.isOpen()).toBe(true)
    await tx.rollback()
  })
})

// ============================================================================
// PARAMETERS AND TYPE CONVERSION TESTS
// ============================================================================

describe('Parameters and type conversion', () => {
  let d: Driver
  let session: Session

  beforeEach(async () => {
    clearStorage() // Ensure clean slate
    d = createDriver('bolt://localhost:7687', auth.basic('neo4j', 'password'))
    session = d.session()
  })

  afterEach(async () => {
    await session.close()
    await d.close()
  })

  it('should handle string parameters', async () => {
    const result = await session.run('CREATE (n:Test {value: $val}) RETURN n', { val: 'hello' })
    const records = await result.records()
    expect((records[0].get('n') as Node).properties.value).toBe('hello')
  })

  it('should handle number parameters', async () => {
    const result = await session.run('CREATE (n:Test {value: $val}) RETURN n', { val: 42 })
    const records = await result.records()
    expect((records[0].get('n') as Node).properties.value).toBe(42)
  })

  it('should handle float parameters', async () => {
    const result = await session.run('CREATE (n:Test {value: $val}) RETURN n', { val: 3.14 })
    const records = await result.records()
    expect((records[0].get('n') as Node).properties.value).toBeCloseTo(3.14)
  })

  it('should handle boolean parameters', async () => {
    const result = await session.run('CREATE (n:Test {value: $val}) RETURN n', { val: true })
    const records = await result.records()
    expect((records[0].get('n') as Node).properties.value).toBe(true)
  })

  it('should handle null parameters', async () => {
    const result = await session.run('CREATE (n:Test {value: $val}) RETURN n', { val: null })
    const records = await result.records()
    expect((records[0].get('n') as Node).properties.value).toBeNull()
  })

  it('should handle array parameters', async () => {
    const result = await session.run('CREATE (n:Test {values: $val}) RETURN n', { val: [1, 2, 3] })
    const records = await result.records()
    expect((records[0].get('n') as Node).properties.values).toEqual([1, 2, 3])
  })

  it.skip('should handle map parameters for properties', async () => {
    // TODO: CREATE (n:Label $props) syntax not yet implemented
    const props = { name: 'Test', age: 30 }
    const result = await session.run('CREATE (n:Test $props) RETURN n', { props })
    const records = await result.records()
    expect((records[0].get('n') as Node).properties.name).toBe('Test')
    expect((records[0].get('n') as Node).properties.age).toBe(30)
  })

  it('should handle Integer type', async () => {
    const result = await session.run('CREATE (n:Test {value: $val}) RETURN n', { val: int(9007199254740993) })
    const records = await result.records()
    const value = (records[0].get('n') as Node).properties.value
    expect(isInt(value)).toBe(true)
  })

  it('should handle Point type', async () => {
    const point = Point.geographic(-122.3, 47.6)
    const result = await session.run('CREATE (n:Test {location: $loc}) RETURN n', { loc: point })
    const records = await result.records()
    const loc = (records[0].get('n') as Node).properties.location as Point
    expect(loc.x).toBeCloseTo(-122.3)
    expect(loc.y).toBeCloseTo(47.6)
  })

  it('should handle Date type', async () => {
    const date = new Neo4jDate(2025, 1, 15)
    const result = await session.run('CREATE (n:Test {date: $d}) RETURN n', { d: date })
    const records = await result.records()
    const d = (records[0].get('n') as Node).properties.date as Neo4jDate
    expect(d.year).toBe(2025)
    expect(d.month).toBe(1)
    expect(d.day).toBe(15)
  })

  it('should handle DateTime type', async () => {
    const dt = new DateTime(2025, 1, 15, 10, 30, 0, 0)
    const result = await session.run('CREATE (n:Test {datetime: $dt}) RETURN n', { dt })
    const records = await result.records()
    const stored = (records[0].get('n') as Node).properties.datetime as DateTime
    expect(stored.year).toBe(2025)
    expect(stored.hour).toBe(10)
  })

  it('should handle Duration type', async () => {
    const duration = new Duration(1, 2, 3, 0)
    const result = await session.run('CREATE (n:Test {duration: $d}) RETURN n', { d: duration })
    const records = await result.records()
    const d = (records[0].get('n') as Node).properties.duration as Duration
    expect(d.months).toBe(1)
    expect(d.days).toBe(2)
  })
})

// ============================================================================
// RESULT AND RECORD TESTS
// ============================================================================

describe('Result and Record', () => {
  let d: Driver
  let session: Session

  beforeEach(async () => {
    clearStorage() // Ensure clean slate
    d = createDriver('bolt://localhost:7687', auth.basic('neo4j', 'password'))
    session = d.session()
    await session.run('CREATE (n:Person {name: $name, age: $age})', { name: 'Alice', age: 30 })
  })

  afterEach(async () => {
    await session.close()
    await d.close()
  })

  it('should get records as array', async () => {
    const result = await session.run('MATCH (n:Person) RETURN n')
    const records = await result.records()
    expect(Array.isArray(records)).toBe(true)
  })

  it('should get keys', async () => {
    const result = await session.run('MATCH (n:Person) RETURN n.name AS name, n.age AS age')
    const keys = await result.keys()
    expect(keys).toContain('name')
    expect(keys).toContain('age')
  })

  it('should get result summary', async () => {
    const result = await session.run('CREATE (n:Test) RETURN n')
    const summary = await result.summary()
    expect(summary).toBeDefined()
    expect(summary.counters).toBeDefined()
    expect(summary.counters.nodesCreated).toBe(1)
  })

  it('should consume result', async () => {
    const result = await session.run('CREATE (n:Test) RETURN n')
    const summary = await result.consume()
    expect(summary.queryType).toBeDefined()
  })

  it('should peek at first record', async () => {
    const result = await session.run('MATCH (n:Person) RETURN n')
    const record = await result.peek()
    expect(record).not.toBeNull()
  })

  it('should get record by key', async () => {
    const result = await session.run('MATCH (n:Person) RETURN n.name AS name')
    const records = await result.records()
    expect(records[0].get('name')).toBe('Alice')
  })

  it('should get record by index', async () => {
    const result = await session.run('MATCH (n:Person) RETURN n.name AS name, n.age AS age')
    const records = await result.records()
    expect(records[0].get(0)).toBe('Alice')
    expect(records[0].get(1)).toBe(30)
  })

  it('should check if record has key', async () => {
    const result = await session.run('MATCH (n:Person) RETURN n.name AS name')
    const records = await result.records()
    expect(records[0].has('name')).toBe(true)
    expect(records[0].has('nonexistent')).toBe(false)
  })

  it('should convert record to object', async () => {
    const result = await session.run('MATCH (n:Person) RETURN n.name AS name, n.age AS age')
    const records = await result.records()
    const obj = records[0].toObject()
    expect(obj).toEqual({ name: 'Alice', age: 30 })
  })

  it('should get record values', async () => {
    const result = await session.run('MATCH (n:Person) RETURN n.name AS name, n.age AS age')
    const records = await result.records()
    expect(records[0].values()).toEqual(['Alice', 30])
  })

  it('should iterate record with forEach', async () => {
    const result = await session.run('MATCH (n:Person) RETURN n.name AS name, n.age AS age')
    const records = await result.records()
    const values: unknown[] = []
    records[0].forEach((value) => values.push(value))
    expect(values).toEqual(['Alice', 30])
  })

  it('should be async iterable', async () => {
    const result = await session.run('MATCH (n:Person) RETURN n')
    const records: unknown[] = []
    for await (const record of result) {
      records.push(record)
    }
    expect(records.length).toBe(1)
  })
})

// ============================================================================
// INTEGER TYPE TESTS
// ============================================================================

describe('Integer type', () => {
  it('should create from number', () => {
    const i = Integer.fromNumber(42)
    expect(i.toNumber()).toBe(42)
  })

  it('should create from string', () => {
    const i = Integer.fromString('9007199254740993')
    expect(i.toString()).toBe('9007199254740993')
  })

  it('should create from bigint', () => {
    const i = Integer.fromBigInt(BigInt('9007199254740993'))
    expect(i.toBigInt()).toBe(BigInt('9007199254740993'))
  })

  it('should check safe range', () => {
    const safe = Integer.fromNumber(100)
    const unsafe = Integer.fromString('9007199254740993')
    expect(safe.inSafeRange()).toBe(true)
    expect(unsafe.inSafeRange()).toBe(false)
  })

  it('should throw on unsafe conversion', () => {
    const unsafe = Integer.fromString('9007199254740993')
    expect(() => unsafe.toNumberOrThrow()).toThrow()
  })

  it('should compare integers', () => {
    const a = Integer.fromNumber(10)
    const b = Integer.fromNumber(20)
    expect(a.compare(b)).toBe(-1)
    expect(b.compare(a)).toBe(1)
    expect(a.compare(Integer.fromNumber(10))).toBe(0)
  })

  it('should perform arithmetic', () => {
    const a = Integer.fromNumber(10)
    const b = Integer.fromNumber(3)
    expect(a.add(b).toNumber()).toBe(13)
    expect(a.subtract(b).toNumber()).toBe(7)
    expect(a.multiply(b).toNumber()).toBe(30)
    expect(a.divide(b).toNumber()).toBe(3)
  })

  it('should check zero/positive/negative', () => {
    expect(Integer.ZERO.isZero()).toBe(true)
    expect(Integer.ONE.isPositive()).toBe(true)
    expect(Integer.NEG_ONE.isNegative()).toBe(true)
  })

  it('should use int() helper', () => {
    const i = int(42)
    expect(i.toNumber()).toBe(42)
  })

  it('should use isInt() helper', () => {
    expect(isInt(int(42))).toBe(true)
    expect(isInt(42)).toBe(false)
  })
})

// ============================================================================
// ERROR TESTS
// ============================================================================

describe('Errors', () => {
  it('should create Neo4jError', () => {
    const error = new Neo4jError('Test error', 'TestCode')
    expect(error.name).toBe('Neo4jError')
    expect(error.code).toBe('TestCode')
    expect(error.retriable).toBe(false)
  })

  it('should create ServiceUnavailableError', () => {
    const error = new ServiceUnavailableError('Service down')
    expect(error.name).toBe('ServiceUnavailableError')
    expect(error.retriable).toBe(true)
  })

  it('should create SessionExpiredError', () => {
    const error = new SessionExpiredError('Session expired')
    expect(error.name).toBe('SessionExpiredError')
    expect(error.retriable).toBe(true)
  })

  it('should create DatabaseError', () => {
    const error = new DatabaseError('DB error', 'Neo.DatabaseError.General')
    expect(error.name).toBe('DatabaseError')
    expect(error.code).toBe('Neo.DatabaseError.General')
  })

  it('should create ClientError', () => {
    const error = new ClientError('Bad request', 'Neo.ClientError.Statement.SyntaxError')
    expect(error.name).toBe('ClientError')
  })

  it('should create TransientError', () => {
    const error = new TransientError('Transient failure')
    expect(error.retriable).toBe(true)
  })
})

// ============================================================================
// TYPE GUARD TESTS
// ============================================================================

describe('Type guards', () => {
  it('should identify Node', () => {
    const node = new NodeImpl(int(1), ['Person'], { name: 'Alice' }, '4:1')
    expect(isNode(node)).toBe(true)
    expect(isNode({ labels: [] })).toBe(false)
  })

  it('should identify Relationship', () => {
    const rel = new RelationshipImpl(int(1), 'KNOWS', int(1), int(2), {}, '5:1', '4:1', '4:2')
    expect(isRelationship(rel)).toBe(true)
    expect(isRelationship({ type: 'KNOWS' })).toBe(false)
  })

  it('should identify Path', () => {
    const node1 = new NodeImpl(int(1), ['Person'], {}, '4:1')
    const node2 = new NodeImpl(int(2), ['Person'], {}, '4:2')
    const rel = new RelationshipImpl(int(1), 'KNOWS', int(1), int(2), {}, '5:1', '4:1', '4:2')
    const path = new PathImpl(node1, node2, [{ start: node1, relationship: rel, end: node2 }])
    expect(isPath(path)).toBe(true)
  })
})

// ============================================================================
// EXECUTE QUERY TESTS
// ============================================================================

describe('Driver.executeQuery', () => {
  let d: Driver

  beforeEach(async () => {
    clearStorage() // Ensure clean slate
    d = createDriver('bolt://localhost:7687', auth.basic('neo4j', 'password'))
  })

  afterEach(async () => {
    await d.close()
  })

  it('should execute query directly on driver', async () => {
    const result = await d.executeQuery('CREATE (n:Test {value: $val}) RETURN n', { val: 'direct' })
    expect(result.records.length).toBe(1)
    expect(result.keys).toContain('n')
    expect(result.summary).toBeDefined()
  })

  it('should execute read query with routing', async () => {
    await d.executeQuery('CREATE (n:Test {value: $val})', { val: 'routing' })
    const result = await d.executeQuery('MATCH (n:Test) RETURN n', {}, { routing: 'READ' })
    expect(result.records.length).toBe(1)
  })

  it('should execute write query with routing', async () => {
    const result = await d.executeQuery('CREATE (n:Test) RETURN n', {}, { routing: 'WRITE' })
    expect(result.summary.counters.nodesCreated).toBe(1)
  })
})
