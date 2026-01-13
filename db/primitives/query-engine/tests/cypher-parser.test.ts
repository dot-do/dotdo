/**
 * Cypher Parser Tests (RED Phase)
 *
 * Tests for parsing Cypher graph query language into unified AST format.
 *
 * @see dotdo-7boq8
 */

import { describe, it, expect } from 'vitest'
import { CypherParser, type ParsedCypher } from '../parsers/cypher-parser'
import type { TraversalNode, PredicateNode, LogicalNode, ProjectionNode, SortNode, GroupByNode } from '../ast'

describe('CypherParser', () => {
  const parser = new CypherParser()

  describe('MATCH patterns with nodes', () => {
    it('parses simple node pattern', () => {
      const result = parser.parse('MATCH (n) RETURN n')

      expect(result.startNode).toBeDefined()
      expect(result.startNode!.variable).toBe('n')
      expect(result.startNode!.labels).toBeUndefined()
    })

    it('parses node with label', () => {
      const result = parser.parse('MATCH (p:Person) RETURN p')

      expect(result.startNode).toBeDefined()
      expect(result.startNode!.variable).toBe('p')
      expect(result.startNode!.labels).toEqual(['Person'])
    })

    it('parses node with multiple labels', () => {
      const result = parser.parse('MATCH (p:Person:Employee) RETURN p')

      expect(result.startNode).toBeDefined()
      expect(result.startNode!.variable).toBe('p')
      expect(result.startNode!.labels).toEqual(['Person', 'Employee'])
    })

    it('parses node with properties', () => {
      const result = parser.parse("MATCH (p:Person {name: 'Alice'}) RETURN p")

      expect(result.startNode).toBeDefined()
      expect(result.startNode!.variable).toBe('p')
      expect(result.startNode!.labels).toEqual(['Person'])
      expect(result.startNode!.properties).toEqual({ name: 'Alice' })
    })

    it('parses node with multiple properties', () => {
      const result = parser.parse("MATCH (p:Person {name: 'Alice', age: 30}) RETURN p")

      expect(result.startNode).toBeDefined()
      expect(result.startNode!.properties).toEqual({ name: 'Alice', age: 30 })
    })

    it('parses anonymous node', () => {
      const result = parser.parse('MATCH (:Person) RETURN 1')

      expect(result.startNode).toBeDefined()
      expect(result.startNode!.variable).toBeUndefined()
      expect(result.startNode!.labels).toEqual(['Person'])
    })
  })

  describe('MATCH patterns with relationships', () => {
    it('parses directed relationship', () => {
      const result = parser.parse('MATCH (a)-[r]->(b) RETURN a, b')

      expect(result.traversals).toHaveLength(1)
      expect(result.traversals![0]!.direction).toBe('OUT')
      expect(result.traversals![0]!.minHops).toBe(1)
      expect(result.traversals![0]!.maxHops).toBe(1)
    })

    it('parses incoming relationship', () => {
      const result = parser.parse('MATCH (a)<-[r]-(b) RETURN a, b')

      expect(result.traversals).toHaveLength(1)
      expect(result.traversals![0]!.direction).toBe('IN')
    })

    it('parses undirected relationship', () => {
      const result = parser.parse('MATCH (a)-[r]-(b) RETURN a, b')

      expect(result.traversals).toHaveLength(1)
      expect(result.traversals![0]!.direction).toBe('BOTH')
    })

    it('parses relationship with type', () => {
      const result = parser.parse('MATCH (a)-[:KNOWS]->(b) RETURN a, b')

      expect(result.traversals).toHaveLength(1)
      expect(result.traversals![0]!.edgeTypes).toEqual(['KNOWS'])
    })

    it('parses relationship with multiple types', () => {
      const result = parser.parse('MATCH (a)-[:KNOWS|:FRIENDS]->(b) RETURN a, b')

      expect(result.traversals).toHaveLength(1)
      expect(result.traversals![0]!.edgeTypes).toEqual(['KNOWS', 'FRIENDS'])
    })

    it('parses relationship with variable', () => {
      const result = parser.parse('MATCH (a)-[r:KNOWS]->(b) RETURN r')

      expect(result.traversals).toHaveLength(1)
      expect(result.traversals![0]!.variable).toBe('r')
      expect(result.traversals![0]!.edgeTypes).toEqual(['KNOWS'])
    })
  })

  describe('variable length paths', () => {
    it('parses fixed hop count', () => {
      const result = parser.parse('MATCH (a)-[:KNOWS*2]->(b) RETURN b')

      expect(result.traversals).toHaveLength(1)
      expect(result.traversals![0]!.minHops).toBe(2)
      expect(result.traversals![0]!.maxHops).toBe(2)
    })

    it('parses min..max hops', () => {
      const result = parser.parse('MATCH (a)-[:KNOWS*1..3]->(b) RETURN b')

      expect(result.traversals).toHaveLength(1)
      expect(result.traversals![0]!.minHops).toBe(1)
      expect(result.traversals![0]!.maxHops).toBe(3)
    })

    it('parses min.. hops (no max)', () => {
      const result = parser.parse('MATCH (a)-[:KNOWS*2..]->(b) RETURN b')

      expect(result.traversals).toHaveLength(1)
      expect(result.traversals![0]!.minHops).toBe(2)
      expect(result.traversals![0]!.maxHops).toBe(Infinity)
    })

    it('parses ..max hops (no min)', () => {
      const result = parser.parse('MATCH (a)-[:KNOWS*..3]->(b) RETURN b')

      expect(result.traversals).toHaveLength(1)
      expect(result.traversals![0]!.minHops).toBe(1)
      expect(result.traversals![0]!.maxHops).toBe(3)
    })

    it('parses unbounded variable length', () => {
      const result = parser.parse('MATCH (a)-[:KNOWS*]->(b) RETURN b')

      expect(result.traversals).toHaveLength(1)
      expect(result.traversals![0]!.minHops).toBe(1)
      expect(result.traversals![0]!.maxHops).toBe(Infinity)
    })
  })

  describe('WHERE clauses', () => {
    it('parses simple equality', () => {
      const result = parser.parse("MATCH (p:Person) WHERE p.name = 'Alice' RETURN p")

      expect(result.where).toBeDefined()
      expect(result.where!.type).toBe('predicate')
      expect((result.where as PredicateNode).column).toBe('p.name')
      expect((result.where as PredicateNode).op).toBe('=')
      expect((result.where as PredicateNode).value).toBe('Alice')
    })

    it('parses comparison operators', () => {
      const result = parser.parse('MATCH (p:Person) WHERE p.age > 30 RETURN p')

      expect(result.where).toBeDefined()
      expect((result.where as PredicateNode).op).toBe('>')
      expect((result.where as PredicateNode).value).toBe(30)
    })

    it('parses AND conditions', () => {
      const result = parser.parse("MATCH (p:Person) WHERE p.name = 'Alice' AND p.age > 30 RETURN p")

      expect(result.where).toBeDefined()
      expect(result.where!.type).toBe('logical')
      expect((result.where as LogicalNode).op).toBe('AND')
      expect((result.where as LogicalNode).children).toHaveLength(2)
    })

    it('parses OR conditions', () => {
      const result = parser.parse("MATCH (p:Person) WHERE p.name = 'Alice' OR p.name = 'Bob' RETURN p")

      expect(result.where).toBeDefined()
      expect(result.where!.type).toBe('logical')
      expect((result.where as LogicalNode).op).toBe('OR')
      expect((result.where as LogicalNode).children).toHaveLength(2)
    })

    it('parses NOT conditions', () => {
      const result = parser.parse("MATCH (p:Person) WHERE NOT p.name = 'Alice' RETURN p")

      expect(result.where).toBeDefined()
      expect(result.where!.type).toBe('logical')
      expect((result.where as LogicalNode).op).toBe('NOT')
    })

    it('parses IN operator', () => {
      const result = parser.parse("MATCH (p:Person) WHERE p.name IN ['Alice', 'Bob'] RETURN p")

      expect(result.where).toBeDefined()
      expect((result.where as PredicateNode).op).toBe('IN')
      expect((result.where as PredicateNode).value).toEqual(['Alice', 'Bob'])
    })

    it('parses STARTS WITH', () => {
      const result = parser.parse("MATCH (p:Person) WHERE p.name STARTS WITH 'A' RETURN p")

      expect(result.where).toBeDefined()
      expect((result.where as PredicateNode).op).toBe('STARTS_WITH')
      expect((result.where as PredicateNode).value).toBe('A')
    })

    it('parses CONTAINS', () => {
      const result = parser.parse("MATCH (p:Person) WHERE p.name CONTAINS 'li' RETURN p")

      expect(result.where).toBeDefined()
      expect((result.where as PredicateNode).op).toBe('CONTAINS')
      expect((result.where as PredicateNode).value).toBe('li')
    })

    it('parses IS NULL', () => {
      const result = parser.parse('MATCH (p:Person) WHERE p.email IS NULL RETURN p')

      expect(result.where).toBeDefined()
      expect((result.where as PredicateNode).op).toBe('IS NULL')
    })

    it('parses IS NOT NULL', () => {
      const result = parser.parse('MATCH (p:Person) WHERE p.email IS NOT NULL RETURN p')

      expect(result.where).toBeDefined()
      expect((result.where as PredicateNode).op).toBe('IS NOT NULL')
    })
  })

  describe('RETURN projections', () => {
    it('parses single return', () => {
      const result = parser.parse('MATCH (p:Person) RETURN p')

      expect(result.return).toBeDefined()
      expect(result.return!.columns).toHaveLength(1)
      expect(result.return!.columns[0]!.source).toBe('p')
    })

    it('parses multiple returns', () => {
      const result = parser.parse('MATCH (p:Person) RETURN p.name, p.age')

      expect(result.return).toBeDefined()
      expect(result.return!.columns).toHaveLength(2)
      expect(result.return!.columns[0]!.source).toBe('p.name')
      expect(result.return!.columns[1]!.source).toBe('p.age')
    })

    it('parses return with alias', () => {
      const result = parser.parse('MATCH (p:Person) RETURN p.name AS personName')

      expect(result.return).toBeDefined()
      expect(result.return!.columns[0]!.source).toBe('p.name')
      expect(result.return!.columns[0]!.alias).toBe('personName')
    })

    it('parses RETURN DISTINCT', () => {
      const result = parser.parse('MATCH (p:Person) RETURN DISTINCT p.name')

      expect(result.distinct).toBe(true)
    })

    it('parses aggregation COUNT', () => {
      const result = parser.parse('MATCH (p:Person) RETURN COUNT(p)')

      expect(result.return).toBeDefined()
      expect(result.return!.columns[0]!.source).toBe('COUNT(p)')
    })

    it('parses aggregation with alias', () => {
      const result = parser.parse('MATCH (p:Person) RETURN COUNT(p) AS total')

      expect(result.return).toBeDefined()
      expect(result.return!.columns[0]!.source).toBe('COUNT(p)')
      expect(result.return!.columns[0]!.alias).toBe('total')
    })
  })

  describe('ORDER BY', () => {
    it('parses ORDER BY ascending', () => {
      const result = parser.parse('MATCH (p:Person) RETURN p ORDER BY p.name')

      expect(result.sort).toBeDefined()
      expect(result.sort!.columns).toHaveLength(1)
      expect(result.sort!.columns[0]!.column).toBe('p.name')
      expect(result.sort!.columns[0]!.direction).toBe('ASC')
    })

    it('parses ORDER BY descending', () => {
      const result = parser.parse('MATCH (p:Person) RETURN p ORDER BY p.name DESC')

      expect(result.sort).toBeDefined()
      expect(result.sort!.columns[0]!.direction).toBe('DESC')
    })

    it('parses multiple ORDER BY columns', () => {
      const result = parser.parse('MATCH (p:Person) RETURN p ORDER BY p.name, p.age DESC')

      expect(result.sort).toBeDefined()
      expect(result.sort!.columns).toHaveLength(2)
      expect(result.sort!.columns[0]!.column).toBe('p.name')
      expect(result.sort!.columns[0]!.direction).toBe('ASC')
      expect(result.sort!.columns[1]!.column).toBe('p.age')
      expect(result.sort!.columns[1]!.direction).toBe('DESC')
    })
  })

  describe('SKIP and LIMIT', () => {
    it('parses LIMIT', () => {
      const result = parser.parse('MATCH (p:Person) RETURN p LIMIT 10')

      expect(result.limit).toBe(10)
    })

    it('parses SKIP', () => {
      const result = parser.parse('MATCH (p:Person) RETURN p SKIP 5')

      expect(result.skip).toBe(5)
    })

    it('parses SKIP and LIMIT together', () => {
      const result = parser.parse('MATCH (p:Person) RETURN p SKIP 5 LIMIT 10')

      expect(result.skip).toBe(5)
      expect(result.limit).toBe(10)
    })
  })

  describe('complex queries', () => {
    it('parses multi-hop traversal', () => {
      const result = parser.parse(`
        MATCH (a:Person)-[:KNOWS]->(b:Person)-[:WORKS_AT]->(c:Company)
        RETURN a, b, c
      `)

      expect(result.traversals).toHaveLength(2)
      expect(result.traversals![0]!.edgeTypes).toEqual(['KNOWS'])
      expect(result.traversals![1]!.edgeTypes).toEqual(['WORKS_AT'])
    })

    it('parses full query with all clauses', () => {
      const result = parser.parse(`
        MATCH (a:Person)-[:KNOWS*1..3]->(b:Person)
        WHERE a.name = 'Alice' AND b.age > 25
        RETURN DISTINCT b.name, b.age
        ORDER BY b.age DESC
        SKIP 5
        LIMIT 10
      `)

      expect(result.startNode!.labels).toEqual(['Person'])
      expect(result.traversals).toHaveLength(1)
      expect(result.traversals![0]!.minHops).toBe(1)
      expect(result.traversals![0]!.maxHops).toBe(3)
      expect(result.where).toBeDefined()
      expect(result.distinct).toBe(true)
      expect(result.sort).toBeDefined()
      expect(result.skip).toBe(5)
      expect(result.limit).toBe(10)
    })
  })

  describe('conversion to unified AST', () => {
    it('converts traversal to TraversalNode', () => {
      const result = parser.parse('MATCH (a)-[:KNOWS*1..3]->(b) RETURN b')
      const traversalAst = result.toTraversalNode()

      expect(traversalAst).toBeDefined()
      expect(traversalAst!.type).toBe('traversal')
      expect(traversalAst!.direction).toBe('OUT')
      expect(traversalAst!.edgeTypes).toEqual(['KNOWS'])
      expect(traversalAst!.minHops).toBe(1)
      expect(traversalAst!.maxHops).toBe(3)
    })

    it('converts vertex filter to predicate', () => {
      const result = parser.parse("MATCH (p:Person {name: 'Alice'}) RETURN p")
      const predicateAst = result.toVertexFilter()

      expect(predicateAst).toBeDefined()
      expect(predicateAst!.type).toBe('logical')
    })
  })

  describe('error handling', () => {
    it('throws on missing MATCH', () => {
      expect(() => parser.parse('RETURN n')).toThrow()
    })

    it('throws on invalid relationship syntax', () => {
      expect(() => parser.parse('MATCH (a)-->(b) RETURN a')).toThrow()
    })

    it('throws on unclosed parenthesis', () => {
      expect(() => parser.parse('MATCH (a RETURN a')).toThrow()
    })

    it('throws on unclosed bracket', () => {
      expect(() => parser.parse('MATCH (a)-[r RETURN a')).toThrow()
    })
  })
})
