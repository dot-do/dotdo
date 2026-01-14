/**
 * Cypher Parser Tests
 *
 * Tests for parsing Cypher queries into AST format.
 */
import { describe, it, expect } from 'vitest'
import {
  CypherParser,
  parseCypher,
  parseCypherWhere,
  type ParsedCypherQuery,
  type CypherNodePattern,
  type CypherRelationshipPattern,
} from '../cypher-parser'

// ============================================================================
// NODE PATTERN TESTS
// ============================================================================

describe('Cypher Node Pattern Parsing', () => {
  const parser = new CypherParser()

  it('should parse simple node pattern', () => {
    const queries = parser.parse('CREATE (n)')
    expect(queries).toHaveLength(1)
    expect(queries[0].type).toBe('CREATE')

    const node = queries[0].patterns[0].elements[0] as CypherNodePattern
    expect(node.variable).toBe('n')
    expect(node.labels).toEqual([])
  })

  it('should parse node with label', () => {
    const queries = parser.parse('CREATE (n:Person)')
    const node = queries[0].patterns[0].elements[0] as CypherNodePattern
    expect(node.variable).toBe('n')
    expect(node.labels).toEqual(['Person'])
  })

  it('should parse node with multiple labels', () => {
    const queries = parser.parse('CREATE (n:Person:Employee)')
    const node = queries[0].patterns[0].elements[0] as CypherNodePattern
    expect(node.labels).toEqual(['Person', 'Employee'])
  })

  it('should parse node with properties', () => {
    const queries = parser.parse('CREATE (n:Person {name: "Alice", age: 30})')
    const node = queries[0].patterns[0].elements[0] as CypherNodePattern
    expect(node.properties).toEqual({ name: 'Alice', age: 30 })
  })

  it('should parse node with parameter properties', () => {
    const queries = parser.parse('CREATE (n:Person {name: $name})', { name: 'Alice' })
    const node = queries[0].patterns[0].elements[0] as CypherNodePattern
    expect(node.properties).toEqual({ name: 'Alice' })
  })

  it('should parse anonymous node', () => {
    const queries = parser.parse('CREATE (:Person)')
    const node = queries[0].patterns[0].elements[0] as CypherNodePattern
    expect(node.variable).toBeUndefined()
    expect(node.labels).toEqual(['Person'])
  })
})

// ============================================================================
// RELATIONSHIP PATTERN TESTS
// ============================================================================

describe('Cypher Relationship Pattern Parsing', () => {
  const parser = new CypherParser()

  it('should parse outgoing relationship', () => {
    const queries = parser.parse('CREATE (a)-[r:KNOWS]->(b)')
    expect(queries[0].patterns[0].elements).toHaveLength(3)

    const rel = queries[0].patterns[0].elements[1] as CypherRelationshipPattern
    expect(rel.variable).toBe('r')
    expect(rel.types).toEqual(['KNOWS'])
    expect(rel.direction).toBe('OUT')
  })

  it('should parse incoming relationship', () => {
    const queries = parser.parse('CREATE (a)<-[r:KNOWS]-(b)')
    const rel = queries[0].patterns[0].elements[1] as CypherRelationshipPattern
    expect(rel.direction).toBe('IN')
  })

  it('should parse undirected relationship', () => {
    const queries = parser.parse('MATCH (a)-[r:KNOWS]-(b) RETURN a, b')
    const rel = queries[0].patterns[0].elements[1] as CypherRelationshipPattern
    expect(rel.direction).toBe('BOTH')
  })

  it('should parse relationship with properties', () => {
    const queries = parser.parse('CREATE (a)-[r:KNOWS {since: 2020}]->(b)')
    const rel = queries[0].patterns[0].elements[1] as CypherRelationshipPattern
    expect(rel.properties).toEqual({ since: 2020 })
  })

  it('should parse variable length relationship *1..3', () => {
    const queries = parser.parse('MATCH (a)-[r:KNOWS*1..3]->(b) RETURN b')
    const rel = queries[0].patterns[0].elements[1] as CypherRelationshipPattern
    expect(rel.minHops).toBe(1)
    expect(rel.maxHops).toBe(3)
  })

  it('should parse variable length relationship *..5', () => {
    const queries = parser.parse('MATCH (a)-[:KNOWS*..5]->(b) RETURN b')
    const rel = queries[0].patterns[0].elements[1] as CypherRelationshipPattern
    expect(rel.minHops).toBe(1)
    expect(rel.maxHops).toBe(5)
  })

  it('should parse variable length relationship *', () => {
    const queries = parser.parse('MATCH (a)-[:KNOWS*]->(b) RETURN b')
    const rel = queries[0].patterns[0].elements[1] as CypherRelationshipPattern
    expect(rel.minHops).toBe(1)
    expect(rel.maxHops).toBe(Infinity)
  })

  it('should parse multiple relationship types', () => {
    const queries = parser.parse('MATCH (a)-[r:KNOWS|FRIENDS]->(b) RETURN b')
    const rel = queries[0].patterns[0].elements[1] as CypherRelationshipPattern
    expect(rel.types).toEqual(['KNOWS', 'FRIENDS'])
  })

  it('should parse anonymous relationship', () => {
    const queries = parser.parse('CREATE (a)-[:KNOWS]->(b)')
    const rel = queries[0].patterns[0].elements[1] as CypherRelationshipPattern
    expect(rel.variable).toBeUndefined()
    expect(rel.types).toEqual(['KNOWS'])
  })
})

// ============================================================================
// WHERE CLAUSE TESTS
// ============================================================================

describe('Cypher WHERE Clause Parsing', () => {
  const parser = new CypherParser()

  it('should parse simple equality', () => {
    const queries = parser.parse('MATCH (n:Person) WHERE n.name = "Alice" RETURN n')
    expect(queries[0].where).toBeDefined()
    expect(queries[0].where?.type).toBe('predicate')
  })

  it('should parse comparison operators', () => {
    const queries = parser.parse('MATCH (n:Person) WHERE n.age > 30 RETURN n')
    const pred = queries[0].where as { type: string; op: string; value: unknown }
    expect(pred.op).toBe('>')
    expect(pred.value).toBe(30)
  })

  it('should parse AND conditions', () => {
    const queries = parser.parse('MATCH (n:Person) WHERE n.age > 25 AND n.age < 35 RETURN n')
    expect(queries[0].where?.type).toBe('logical')
    expect((queries[0].where as { op: string }).op).toBe('AND')
  })

  it('should parse OR conditions', () => {
    const queries = parser.parse('MATCH (n:Person) WHERE n.name = "Alice" OR n.name = "Bob" RETURN n')
    expect((queries[0].where as { op: string }).op).toBe('OR')
  })

  it('should parse NOT condition', () => {
    const queries = parser.parse('MATCH (n:Person) WHERE NOT n.active RETURN n')
    expect((queries[0].where as { op: string }).op).toBe('NOT')
  })

  it('should parse IS NULL', () => {
    const queries = parser.parse('MATCH (n:Person) WHERE n.email IS NULL RETURN n')
    const pred = queries[0].where as { op: string }
    expect(pred.op).toBe('IS NULL')
  })

  it('should parse IS NOT NULL', () => {
    const queries = parser.parse('MATCH (n:Person) WHERE n.email IS NOT NULL RETURN n')
    const pred = queries[0].where as { op: string }
    expect(pred.op).toBe('IS NOT NULL')
  })

  it('should parse IN clause', () => {
    const queries = parser.parse('MATCH (n:Person) WHERE n.name IN ["Alice", "Bob"] RETURN n')
    const pred = queries[0].where as { op: string; value: unknown }
    expect(pred.op).toBe('IN')
    expect(pred.value).toEqual(['Alice', 'Bob'])
  })

  it('should parse CONTAINS', () => {
    const queries = parser.parse('MATCH (n:Person) WHERE n.name CONTAINS "lic" RETURN n')
    const pred = queries[0].where as { op: string }
    expect(pred.op).toBe('CONTAINS')
  })

  it('should parse STARTS WITH', () => {
    const queries = parser.parse('MATCH (n:Person) WHERE n.name STARTS WITH "Al" RETURN n')
    const pred = queries[0].where as { op: string }
    expect(pred.op).toBe('STARTS_WITH')
  })

  it('should parse parameter in WHERE', () => {
    const queries = parser.parse('MATCH (n:Person) WHERE n.name = $name RETURN n', { name: 'Alice' })
    const pred = queries[0].where as { value: unknown }
    expect(pred.value).toBe('Alice')
  })

  it('should parse parenthesized conditions', () => {
    const queries = parser.parse('MATCH (n:Person) WHERE (n.age > 25 AND n.age < 35) OR n.vip = true RETURN n')
    expect((queries[0].where as { op: string }).op).toBe('OR')
  })
})

// ============================================================================
// SET/REMOVE/DELETE TESTS
// ============================================================================

describe('Cypher SET/REMOVE/DELETE Parsing', () => {
  const parser = new CypherParser()

  it('should parse SET single property', () => {
    const queries = parser.parse('MATCH (n:Person {name: "Alice"}) SET n.age = 31')
    expect(queries[0].set).toHaveLength(1)
    expect(queries[0].set![0].variable).toBe('n')
    expect(queries[0].set![0].property).toBe('age')
    expect(queries[0].set![0].value).toBe(31)
  })

  it('should parse SET multiple properties', () => {
    const queries = parser.parse('MATCH (n:Person) SET n.age = 31, n.city = "NYC"')
    expect(queries[0].set).toHaveLength(2)
  })

  it('should parse SET with += operator', () => {
    const queries = parser.parse('MATCH (n:Person) SET n += {age: 31}')
    expect(queries[0].set![0].operator).toBe('+=')
    expect(queries[0].set![0].properties).toEqual({ age: 31 })
  })

  it('should parse REMOVE property', () => {
    const queries = parser.parse('MATCH (n:Person) REMOVE n.age')
    expect(queries[0].remove).toHaveLength(1)
    expect(queries[0].remove![0].variable).toBe('n')
    expect(queries[0].remove![0].property).toBe('age')
  })

  it('should parse DELETE', () => {
    const queries = parser.parse('MATCH (n:Person {name: "Alice"}) DELETE n')
    expect(queries[0].delete).toBeDefined()
    expect(queries[0].delete!.variables).toEqual(['n'])
    expect(queries[0].delete!.detach).toBe(false)
  })

  it('should parse DETACH DELETE', () => {
    const queries = parser.parse('MATCH (n:Person {name: "Alice"}) DETACH DELETE n')
    expect(queries[0].delete!.detach).toBe(true)
  })
})

// ============================================================================
// RETURN CLAUSE TESTS
// ============================================================================

describe('Cypher RETURN Clause Parsing', () => {
  const parser = new CypherParser()

  it('should parse simple RETURN', () => {
    const queries = parser.parse('MATCH (n:Person) RETURN n')
    expect(queries[0].return).toBeDefined()
    expect(queries[0].return!.items).toHaveLength(1)
    expect(queries[0].return!.items[0].expression).toBe('n')
  })

  it('should parse RETURN with alias', () => {
    const queries = parser.parse('MATCH (n:Person) RETURN n.name AS name')
    expect(queries[0].return!.items[0].alias).toBe('name')
  })

  it('should parse RETURN DISTINCT', () => {
    const queries = parser.parse('MATCH (n:Person) RETURN DISTINCT n.name')
    expect(queries[0].return!.distinct).toBe(true)
  })

  it('should parse RETURN with COUNT', () => {
    const queries = parser.parse('MATCH (n:Person) RETURN count(n) AS total')
    expect(queries[0].return!.items[0].aggregate).toBe('count')
  })

  it('should parse RETURN with SUM', () => {
    const queries = parser.parse('MATCH (n:Person) RETURN sum(n.age)')
    expect(queries[0].return!.items[0].aggregate).toBe('sum')
  })

  it('should parse ORDER BY', () => {
    const queries = parser.parse('MATCH (n:Person) RETURN n ORDER BY n.name')
    expect(queries[0].return!.orderBy).toHaveLength(1)
    expect(queries[0].return!.orderBy![0].column).toBe('n.name')
    expect(queries[0].return!.orderBy![0].direction).toBe('ASC')
  })

  it('should parse ORDER BY DESC', () => {
    const queries = parser.parse('MATCH (n:Person) RETURN n ORDER BY n.age DESC')
    expect(queries[0].return!.orderBy![0].direction).toBe('DESC')
  })

  it('should parse SKIP', () => {
    const queries = parser.parse('MATCH (n:Person) RETURN n SKIP 10')
    expect(queries[0].return!.skip).toBe(10)
  })

  it('should parse LIMIT', () => {
    const queries = parser.parse('MATCH (n:Person) RETURN n LIMIT 5')
    expect(queries[0].return!.limit).toBe(5)
  })

  it('should parse SKIP and LIMIT together', () => {
    const queries = parser.parse('MATCH (n:Person) RETURN n SKIP 10 LIMIT 5')
    expect(queries[0].return!.skip).toBe(10)
    expect(queries[0].return!.limit).toBe(5)
  })

  it('should parse multiple RETURN items', () => {
    const queries = parser.parse('MATCH (n:Person) RETURN n.name, n.age, n.city')
    expect(queries[0].return!.items).toHaveLength(3)
  })
})

// ============================================================================
// MATCH...CREATE TESTS
// ============================================================================

describe('Cypher MATCH...CREATE Parsing', () => {
  const parser = new CypherParser()

  it('should parse MATCH...CREATE pattern', () => {
    const queries = parser.parse('MATCH (a:Person {name: "Alice"}), (b:Person {name: "Bob"}) CREATE (a)-[r:KNOWS]->(b)')
    expect(queries[0].type).toBe('MATCH')
    expect(queries[0].create).toBeDefined()
    expect(queries[0].create).toHaveLength(1)
  })

  it('should parse MATCH...MERGE pattern', () => {
    const queries = parser.parse('MATCH (a:Person {name: "Alice"}) MERGE (a)-[:KNOWS]->(b:Person {name: "Bob"})')
    expect(queries[0].merge).toBeDefined()
  })
})

// ============================================================================
// MERGE TESTS
// ============================================================================

describe('Cypher MERGE Parsing', () => {
  const parser = new CypherParser()

  it('should parse simple MERGE', () => {
    const queries = parser.parse('MERGE (n:Person {name: "Alice"})')
    expect(queries[0].type).toBe('MERGE')
  })

  it('should parse MERGE with ON CREATE SET', () => {
    const queries = parser.parse('MERGE (n:Person {name: "Alice"}) ON CREATE SET n.created = timestamp()')
    expect(queries[0].set).toBeDefined()
  })
})

// ============================================================================
// OPTIONAL MATCH TESTS
// ============================================================================

describe('Cypher OPTIONAL MATCH Parsing', () => {
  const parser = new CypherParser()

  it('should parse OPTIONAL MATCH', () => {
    const queries = parser.parse('OPTIONAL MATCH (n:Person)-[:KNOWS]->(m) RETURN n, m')
    expect(queries[0].type).toBe('MATCH')
    expect(queries[0].optional).toBe(true)
  })
})

// ============================================================================
// PATH PATTERN TESTS
// ============================================================================

describe('Cypher Path Pattern Parsing', () => {
  const parser = new CypherParser()

  it('should parse path assignment', () => {
    const queries = parser.parse('MATCH p = (a:Person)-[:KNOWS]->(b:Person) RETURN p')
    expect(queries[0].patterns[0].variable).toBe('p')
  })

  it('should parse multi-hop path', () => {
    const queries = parser.parse('MATCH (a:Person)-[:KNOWS]->(b:Person)-[:KNOWS]->(c:Person) RETURN a, b, c')
    expect(queries[0].patterns[0].elements).toHaveLength(5) // 3 nodes, 2 relationships
  })
})

// ============================================================================
// DATA TYPE TESTS
// ============================================================================

describe('Cypher Data Types Parsing', () => {
  const parser = new CypherParser()

  it('should parse boolean true', () => {
    const queries = parser.parse('CREATE (n:Person {active: true})')
    const node = queries[0].patterns[0].elements[0] as CypherNodePattern
    expect(node.properties.active).toBe(true)
  })

  it('should parse boolean false', () => {
    const queries = parser.parse('CREATE (n:Person {active: false})')
    const node = queries[0].patterns[0].elements[0] as CypherNodePattern
    expect(node.properties.active).toBe(false)
  })

  it('should parse null', () => {
    const queries = parser.parse('CREATE (n:Person {email: null})')
    const node = queries[0].patterns[0].elements[0] as CypherNodePattern
    expect(node.properties.email).toBeNull()
  })

  it('should parse integer', () => {
    const queries = parser.parse('CREATE (n:Person {age: 30})')
    const node = queries[0].patterns[0].elements[0] as CypherNodePattern
    expect(node.properties.age).toBe(30)
  })

  it('should parse float', () => {
    const queries = parser.parse('CREATE (n:Person {score: 3.14})')
    const node = queries[0].patterns[0].elements[0] as CypherNodePattern
    expect(node.properties.score).toBeCloseTo(3.14)
  })

  it('should parse negative number', () => {
    const queries = parser.parse('CREATE (n:Account {balance: -100})')
    const node = queries[0].patterns[0].elements[0] as CypherNodePattern
    expect(node.properties.balance).toBe(-100)
  })

  it('should parse array', () => {
    const queries = parser.parse('CREATE (n:Person {tags: ["a", "b", "c"]})')
    const node = queries[0].patterns[0].elements[0] as CypherNodePattern
    expect(node.properties.tags).toEqual(['a', 'b', 'c'])
  })

  it('should parse string with escaped quotes', () => {
    const queries = parser.parse(`CREATE (n:Person {quote: "He said \\"hello\\""})`)
    const node = queries[0].patterns[0].elements[0] as CypherNodePattern
    expect(node.properties.quote).toBe('He said "hello"')
  })
})

// ============================================================================
// parseCypherWhere HELPER TESTS
// ============================================================================

describe('parseCypherWhere helper', () => {
  it('should parse simple condition', () => {
    const ast = parseCypherWhere('n.age > 30')
    expect(ast).toBeDefined()
    expect(ast?.type).toBe('predicate')
  })

  it('should parse complex condition', () => {
    const ast = parseCypherWhere('n.age > 25 AND n.age < 35 OR n.vip = true')
    expect(ast).toBeDefined()
    expect(ast?.type).toBe('logical')
  })

  it('should handle parameters', () => {
    const ast = parseCypherWhere('n.name = $name', { name: 'Alice' })
    expect(ast).toBeDefined()
    expect((ast as { value: unknown }).value).toBe('Alice')
  })

  it('should return undefined for empty input', () => {
    const ast = parseCypherWhere('')
    expect(ast).toBeUndefined()
  })
})

// ============================================================================
// ERROR HANDLING TESTS
// ============================================================================

describe('Cypher Parser Error Handling', () => {
  const parser = new CypherParser()

  it('should throw on unclosed parenthesis', () => {
    expect(() => parser.parse('CREATE (n:Person')).toThrow()
  })

  it('should throw on invalid syntax', () => {
    expect(() => parser.parse('CREATE n:Person)')).toThrow()
  })

  it('should throw on missing relationship bracket', () => {
    expect(() => parser.parse('CREATE (a)-[r:KNOWS->(b)')).toThrow()
  })
})
