/**
 * @dotdo/neo4j - Neo4j Driver Compat Layer for Cloudflare Workers
 *
 * Drop-in replacement for neo4j-driver that runs on Cloudflare Workers
 * using Durable Objects with SQLite storage and the GraphEngine.
 *
 * Features:
 * - API-compatible with `neo4j-driver` npm package
 * - Driver, Session, and Transaction classes
 * - Cypher query parsing and execution
 * - Graph algorithms (PageRank, betweenness, closeness centrality)
 * - Path finding (shortestPath, allShortestPaths, dijkstra)
 * - Pattern matching with variable-length paths
 * - APOC-like procedures
 *
 * @example Basic usage
 * ```typescript
 * import neo4j from '@dotdo/neo4j'
 *
 * const driver = neo4j.driver('bolt://localhost', neo4j.auth.basic('neo4j', 'password'))
 * const session = driver.session()
 *
 * const result = await session.run('CREATE (n:Person {name: $name}) RETURN n', { name: 'Alice' })
 * console.log(result.records[0].get('n'))
 *
 * await session.close()
 * await driver.close()
 * ```
 *
 * @example Transaction usage
 * ```typescript
 * const session = driver.session()
 *
 * await session.executeWrite(async tx => {
 *   await tx.run('CREATE (n:Person {name: $name})', { name: 'Bob' })
 *   await tx.run('MATCH (a:Person {name: $from}), (b:Person {name: $to}) CREATE (a)-[:KNOWS]->(b)', {
 *     from: 'Alice',
 *     to: 'Bob'
 *   })
 * })
 *
 * await session.close()
 * ```
 *
 * @see https://neo4j.com/docs/javascript-manual/current/
 */

import {
  GraphEngine,
  type Node,
  type Edge,
  type PathResult,
} from '../../db/graph/index.js'

import type {
  Driver,
  Session,
  Transaction,
  SessionConfig,
  TransactionConfig,
  DriverConfig,
  AuthToken,
  QueryResult,
  Record as Neo4jRecord,
  ResultSummary,
  Counters,
  ServerInfo,
  CypherParams,
  TransactionWork,
  Neo4jNode,
  Neo4jRelationship,
  Neo4jPath,
  Neo4jInteger,
  Neo4jError,
} from './types.js'

// Re-export types
export type * from './types.js'

// ============================================================================
// INTEGER HELPER
// ============================================================================

/**
 * Create a Neo4j-compatible integer object.
 */
function int(value: number | string): Neo4jInteger {
  const num = typeof value === 'string' ? parseInt(value, 10) : value
  return {
    low: num & 0xffffffff,
    high: Math.floor(num / 0x100000000),
    toNumber: () => num,
    toString: () => num.toString(),
    toInt: () => num,
  }
}

// ============================================================================
// RECORD CLASS
// ============================================================================

class RecordImpl<T = Record<string, unknown>> implements Neo4jRecord<T> {
  keys: string[]
  length: number
  private data: Map<string, unknown>

  constructor(keys: string[], values: unknown[]) {
    this.keys = keys
    this.length = keys.length
    this.data = new Map()
    keys.forEach((key, i) => this.data.set(key, values[i]))
  }

  get(key: string | number): unknown {
    if (typeof key === 'number') {
      return this.data.get(this.keys[key]!)
    }
    return this.data.get(key)
  }

  toObject(): T {
    const obj: Record<string, unknown> = {}
    for (const [key, value] of this.data) {
      obj[key] = value
    }
    return obj as T
  }

  has(key: string): boolean {
    return this.data.has(key)
  }

  forEach(visitor: (value: unknown, key: string, record: Neo4jRecord<T>) => void): void {
    for (const [key, value] of this.data) {
      visitor(value, key, this)
    }
  }

  map<U>(mapper: (value: unknown, key: string, record: Neo4jRecord<T>) => U): U[] {
    const result: U[] = []
    for (const [key, value] of this.data) {
      result.push(mapper(value, key, this))
    }
    return result
  }

  *entries(): IterableIterator<[string, unknown]> {
    yield* this.data.entries()
  }

  *values(): IterableIterator<unknown> {
    yield* this.data.values()
  }
}

// ============================================================================
// COUNTERS CLASS
// ============================================================================

class CountersImpl implements Counters {
  private counts = {
    nodesCreated: 0,
    nodesDeleted: 0,
    relationshipsCreated: 0,
    relationshipsDeleted: 0,
    propertiesSet: 0,
    labelsAdded: 0,
    labelsRemoved: 0,
    indexesAdded: 0,
    indexesRemoved: 0,
    constraintsAdded: 0,
    constraintsRemoved: 0,
  }

  constructor(updates?: Partial<typeof CountersImpl.prototype.counts>) {
    if (updates) {
      Object.assign(this.counts, updates)
    }
  }

  nodesCreated() { return this.counts.nodesCreated }
  nodesDeleted() { return this.counts.nodesDeleted }
  relationshipsCreated() { return this.counts.relationshipsCreated }
  relationshipsDeleted() { return this.counts.relationshipsDeleted }
  propertiesSet() { return this.counts.propertiesSet }
  labelsAdded() { return this.counts.labelsAdded }
  labelsRemoved() { return this.counts.labelsRemoved }
  indexesAdded() { return this.counts.indexesAdded }
  indexesRemoved() { return this.counts.indexesRemoved }
  constraintsAdded() { return this.counts.constraintsAdded }
  constraintsRemoved() { return this.counts.constraintsRemoved }
  containsUpdates() {
    return Object.values(this.counts).some(v => v > 0)
  }
  containsSystemUpdates() { return false }
  systemUpdates() { return 0 }
}

// ============================================================================
// CYPHER PARSER
// ============================================================================

interface ParsedQuery {
  type: 'CREATE' | 'MATCH' | 'MERGE' | 'DELETE' | 'SET' | 'RETURN' | 'WITH' | 'CALL'
  patterns: PatternClause[]
  where?: WhereClause
  return?: ReturnClause
  set?: SetClause[]
  delete?: string[]
  orderBy?: OrderByClause[]
  skip?: number
  limit?: number
  procedure?: ProcedureCall
}

interface PatternClause {
  clauseType: 'MATCH' | 'CREATE' | 'MERGE'
  nodes: NodePattern[]
  relationships: RelationshipPattern[]
}

interface NodePattern {
  variable?: string
  labels: string[]
  properties: Record<string, unknown>
}

interface RelationshipPattern {
  variable?: string
  type?: string
  types?: string[]
  direction: 'OUT' | 'IN' | 'BOTH'
  properties: Record<string, unknown>
  minHops?: number
  maxHops?: number
}

interface WhereClause {
  conditions: Condition[]
}

interface Condition {
  left: string
  operator: '=' | '<>' | '<' | '>' | '<=' | '>=' | 'IN' | 'CONTAINS' | 'STARTS WITH' | 'ENDS WITH' | 'IS NULL' | 'IS NOT NULL'
  right: unknown
}

interface ReturnClause {
  items: ReturnItem[]
  distinct?: boolean
}

interface ReturnItem {
  expression: string
  alias?: string
}

interface SetClause {
  target: string
  property?: string
  value: unknown
  operator: '=' | '+='
}

interface OrderByClause {
  expression: string
  direction: 'ASC' | 'DESC'
}

interface ProcedureCall {
  name: string
  args: unknown[]
  yields?: string[]
}

/**
 * Simple Cypher query parser.
 * This is a basic implementation that handles common patterns.
 */
function parseCypher(query: string, params: CypherParams = {}): ParsedQuery {
  const normalized = query.trim().replace(/\s+/g, ' ')

  // Substitute parameters
  let substituted = normalized
  for (const [key, value] of Object.entries(params)) {
    const regex = new RegExp(`\\$${key}\\b`, 'g')
    substituted = substituted.replace(regex, JSON.stringify(value))
  }

  // Detect query type
  const upperQuery = substituted.toUpperCase()
  let type: ParsedQuery['type'] = 'RETURN'

  if (upperQuery.startsWith('CREATE')) {
    type = 'CREATE'
  } else if (upperQuery.startsWith('MATCH')) {
    type = 'MATCH'
  } else if (upperQuery.startsWith('MERGE')) {
    type = 'MERGE'
  } else if (upperQuery.includes('DELETE')) {
    type = 'DELETE'
  } else if (upperQuery.startsWith('CALL')) {
    type = 'CALL'
  }

  // Parse patterns
  const patterns = parsePatterns(substituted)

  // Parse WHERE clause
  const whereMatch = substituted.match(/WHERE\s+(.+?)(?=\s+(?:RETURN|SET|DELETE|ORDER|SKIP|LIMIT|WITH)\b|$)/is)
  const where = whereMatch ? parseWhere(whereMatch[1]!) : undefined

  // Parse RETURN clause - use a non-greedy match that stops at ORDER, SKIP, LIMIT, or end
  const returnMatch = substituted.match(/RETURN\s+(.+?)(?:\s+ORDER\b|\s+SKIP\b|\s+LIMIT\b|$)/is)
  const returnClause = returnMatch ? parseReturn(returnMatch[1]!) : undefined

  // Parse SET clause
  const setMatch = substituted.match(/SET\s+(.+?)(?=\s+(?:RETURN|DELETE|ORDER|SKIP|LIMIT)\b|$)/is)
  const set = setMatch ? parseSet(setMatch[1]!) : undefined

  // Parse DELETE clause
  const deleteMatch = substituted.match(/DELETE\s+(.+?)(?=\s+(?:RETURN|ORDER|SKIP|LIMIT)\b|$)/is)
  const deleteClause = deleteMatch ? deleteMatch[1]!.split(',').map(s => s.trim()) : undefined

  // Parse ORDER BY
  const orderMatch = substituted.match(/ORDER\s+BY\s+(.+?)(?=\s+(?:SKIP|LIMIT)\b|$)/is)
  const orderBy = orderMatch ? parseOrderBy(orderMatch[1]!) : undefined

  // Parse SKIP and LIMIT
  const skipMatch = substituted.match(/SKIP\s+(\d+)/i)
  const skip = skipMatch ? parseInt(skipMatch[1]!, 10) : undefined

  const limitMatch = substituted.match(/LIMIT\s+(\d+)/i)
  const limit = limitMatch ? parseInt(limitMatch[1]!, 10) : undefined

  // Parse CALL procedure
  const callMatch = substituted.match(/CALL\s+([\w.]+)\s*\(([^)]*)\)(?:\s+YIELD\s+(.+))?/i)
  const procedure = callMatch ? {
    name: callMatch[1]!,
    args: callMatch[2] ? parseArgs(callMatch[2]) : [],
    yields: callMatch[3] ? callMatch[3].split(',').map(s => s.trim()) : undefined
  } : undefined

  return {
    type,
    patterns,
    where,
    return: returnClause,
    set,
    delete: deleteClause,
    orderBy,
    skip,
    limit,
    procedure
  }
}

function parsePatterns(query: string): PatternClause[] {
  const patterns: PatternClause[] = []

  // Find pattern sections (after MATCH, CREATE, MERGE) - capture until next keyword or end
  // Note: The lookahead must handle both "keyword preceded by space" AND "end of string"
  // Capture the clause keyword (MATCH, CREATE, MERGE) along with the pattern
  const patternMatches = query.matchAll(/(MATCH|CREATE|MERGE)\s+(.+?)(?=\s+(?:WHERE|RETURN|SET|DELETE|ORDER|SKIP|LIMIT|CREATE|MATCH|MERGE|WITH)\b|$)/gi)

  for (const match of patternMatches) {
    const clauseType = match[1]!.toUpperCase() as 'MATCH' | 'CREATE' | 'MERGE'
    const patternStr = match[2]!
    const nodes: NodePattern[] = []
    const relationships: RelationshipPattern[] = []

    // Parse nodes: (var:Label {props}) - handle properties with quotes and numbers
    const nodeMatches = patternStr.matchAll(/\((\w+)?(?::(\w+(?::\w+)*))?(?:\s*\{([^}]*)\})?\)/g)
    for (const nodeMatch of nodeMatches) {
      nodes.push({
        variable: nodeMatch[1],
        labels: nodeMatch[2] ? nodeMatch[2].split(':').filter(Boolean) : [],
        properties: nodeMatch[3] ? parseProperties(nodeMatch[3]) : {}
      })
    }

    // Parse relationships: -[var:TYPE {props}]-> or <-[var:TYPE]-
    const relMatches = patternStr.matchAll(/<?\-\[(\w+)?(?::([A-Z_|]+))?(?:\*(\d+)?(?:\.\.(\d+))?)?\s*(?:\{([^}]*)\})?\]\->/g)
    for (const relMatch of relMatches) {
      const isIncoming = patternStr.charAt(relMatch.index! - 1) === '<'
      relationships.push({
        variable: relMatch[1],
        type: relMatch[2]?.includes('|') ? undefined : relMatch[2],
        types: relMatch[2]?.includes('|') ? relMatch[2].split('|') : undefined,
        direction: isIncoming ? 'IN' : 'OUT',
        properties: relMatch[5] ? parseProperties(relMatch[5]) : {},
        minHops: relMatch[3] ? parseInt(relMatch[3], 10) : undefined,
        maxHops: relMatch[4] ? parseInt(relMatch[4], 10) : undefined
      })
    }

    // Handle undirected relationships: -[var:TYPE]-
    const undirectedMatches = patternStr.matchAll(/\-\[(\w+)?(?::([A-Z_|]+))?(?:\s*\{([^}]*)\})?\]\-(?!>)/g)
    for (const relMatch of undirectedMatches) {
      relationships.push({
        variable: relMatch[1],
        type: relMatch[2]?.includes('|') ? undefined : relMatch[2],
        types: relMatch[2]?.includes('|') ? relMatch[2].split('|') : undefined,
        direction: 'BOTH',
        properties: relMatch[3] ? parseProperties(relMatch[3]) : {},
      })
    }

    if (nodes.length > 0 || relationships.length > 0) {
      patterns.push({ clauseType, nodes, relationships })
    }
  }

  return patterns
}

function parseProperties(propsStr: string): Record<string, unknown> {
  const props: Record<string, unknown> = {}
  // Simple key: value parsing
  const matches = propsStr.matchAll(/(\w+)\s*:\s*(?:"([^"]*)"|([\d.]+)|(\w+))/g)
  for (const match of matches) {
    const key = match[1]!
    if (match[2] !== undefined) {
      props[key] = match[2] // String
    } else if (match[3] !== undefined) {
      props[key] = parseFloat(match[3]) // Number
    } else if (match[4] !== undefined) {
      props[key] = match[4] === 'true' ? true : match[4] === 'false' ? false : match[4]
    }
  }
  return props
}

function parseWhere(whereStr: string): WhereClause {
  const conditions: Condition[] = []
  // Simple condition parsing
  const conditionParts = whereStr.split(/\s+AND\s+/i)

  for (const part of conditionParts) {
    const eqMatch = part.match(/(\w+(?:\.\w+)?)\s*=\s*(?:"([^"]*)"|([\d.]+)|(\w+))/i)
    if (eqMatch) {
      conditions.push({
        left: eqMatch[1]!,
        operator: '=',
        right: eqMatch[2] ?? (eqMatch[3] ? parseFloat(eqMatch[3]) : eqMatch[4])
      })
    }
  }

  return { conditions }
}

function parseReturn(returnStr: string): ReturnClause {
  const distinct = returnStr.trim().toUpperCase().startsWith('DISTINCT')
  const itemsStr = distinct ? returnStr.replace(/DISTINCT\s+/i, '') : returnStr

  const items: ReturnItem[] = itemsStr.split(',').map(item => {
    const asMatch = item.trim().match(/(.+?)\s+AS\s+(\w+)/i)
    if (asMatch) {
      return { expression: asMatch[1]!.trim(), alias: asMatch[2] }
    }
    return { expression: item.trim() }
  })

  return { items, distinct }
}

function parseSet(setStr: string): SetClause[] {
  const clauses: SetClause[] = []
  const parts = setStr.split(',')

  for (const part of parts) {
    const match = part.match(/(\w+)\.(\w+)\s*(=|\+=)\s*(.+)/i)
    if (match) {
      let value: unknown = match[4]!.trim()
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1)
      } else if (!isNaN(Number(value))) {
        value = parseFloat(value)
      }
      clauses.push({
        target: match[1]!,
        property: match[2],
        value,
        operator: match[3] as '=' | '+='
      })
    }
  }

  return clauses
}

function parseOrderBy(orderStr: string): OrderByClause[] {
  return orderStr.split(',').map(item => {
    const parts = item.trim().split(/\s+/)
    return {
      expression: parts[0]!,
      direction: parts[1]?.toUpperCase() === 'DESC' ? 'DESC' : 'ASC'
    }
  })
}

function parseArgs(argsStr: string): unknown[] {
  if (!argsStr.trim()) return []
  return argsStr.split(',').map(arg => {
    const trimmed = arg.trim()
    if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
      return trimmed.slice(1, -1)
    }
    if (!isNaN(Number(trimmed))) {
      return parseFloat(trimmed)
    }
    return trimmed
  })
}

// ============================================================================
// NODE/RELATIONSHIP CONVERTERS
// ============================================================================

function nodeToNeo4j(node: Node): Neo4jNode {
  return {
    identity: int(parseInt(node.id.split('-')[1] ?? '0', 10)),
    labels: [node.label],
    properties: node.properties,
    elementId: node.id
  }
}

function edgeToNeo4j(edge: Edge, startId: string, endId: string): Neo4jRelationship {
  return {
    identity: int(parseInt(edge.id.split('-')[1] ?? '0', 10)),
    type: edge.type,
    start: int(parseInt(startId.split('-')[1] ?? '0', 10)),
    end: int(parseInt(endId.split('-')[1] ?? '0', 10)),
    properties: edge.properties,
    elementId: edge.id,
    startNodeElementId: startId,
    endNodeElementId: endId
  }
}

function pathToNeo4j(path: PathResult): Neo4jPath {
  const segments = []
  for (let i = 0; i < path.edges.length; i++) {
    segments.push({
      start: nodeToNeo4j(path.nodes[i]!),
      relationship: edgeToNeo4j(path.edges[i]!, path.nodes[i]!.id, path.nodes[i + 1]!.id),
      end: nodeToNeo4j(path.nodes[i + 1]!)
    })
  }
  return {
    start: nodeToNeo4j(path.nodes[0]!),
    end: nodeToNeo4j(path.nodes[path.nodes.length - 1]!),
    segments,
    length: path.length
  }
}

// ============================================================================
// TRANSACTION CLASS
// ============================================================================

class TransactionImpl implements Transaction {
  private graph: GraphEngine
  private open = true
  private updates = {
    nodesCreated: 0,
    nodesDeleted: 0,
    relationshipsCreated: 0,
    relationshipsDeleted: 0,
    propertiesSet: 0,
    labelsAdded: 0
  }

  constructor(graph: GraphEngine) {
    this.graph = graph
  }

  async run<T = Record<string, unknown>>(query: string, params?: CypherParams): Promise<QueryResult<T>> {
    if (!this.open) {
      throw createNeo4jError('Transaction has been closed', 'Neo.ClientError.Transaction.TransactionTerminated')
    }

    const parsed = parseCypher(query, params)
    const records: Neo4jRecord<T>[] = []

    try {
      switch (parsed.type) {
        case 'CREATE':
          await this.executeCreate(parsed, records as Neo4jRecord[])
          break
        case 'MATCH':
          await this.executeMatch(parsed, records as Neo4jRecord[])
          break
        case 'MERGE':
          await this.executeMerge(parsed, records as Neo4jRecord[])
          break
        case 'DELETE':
          await this.executeDelete(parsed, records as Neo4jRecord[])
          break
        case 'CALL':
          await this.executeCall(parsed, records as Neo4jRecord[])
          break
        default:
          await this.executeMatch(parsed, records as Neo4jRecord[])
      }
    } catch (error) {
      throw createNeo4jError(
        error instanceof Error ? error.message : String(error),
        'Neo.ClientError.Statement.ExecutionFailed'
      )
    }

    return {
      records,
      summary: this.createSummary(query, params ?? {})
    }
  }

  private async executeCreate(parsed: ParsedQuery, records: Neo4jRecord[]): Promise<void> {
    const bindings = new Map<string, Node | Edge>()

    for (const pattern of parsed.patterns) {
      let prevNode: Node | null = null

      for (let i = 0; i < pattern.nodes.length; i++) {
        const nodePat = pattern.nodes[i]!
        const node = await this.graph.createNode(
          nodePat.labels[0] ?? 'Node',
          nodePat.properties
        )
        this.updates.nodesCreated++
        if (nodePat.labels.length > 0) {
          this.updates.labelsAdded += nodePat.labels.length
        }

        if (nodePat.variable) {
          bindings.set(nodePat.variable, node)
        }

        // Create relationship to previous node if we have one
        if (prevNode && pattern.relationships[i - 1]) {
          const relPat = pattern.relationships[i - 1]!
          const edge = await this.graph.createEdge(
            relPat.direction === 'IN' ? node.id : prevNode.id,
            relPat.type ?? 'RELATED_TO',
            relPat.direction === 'IN' ? prevNode.id : node.id,
            relPat.properties
          )
          this.updates.relationshipsCreated++

          if (relPat.variable) {
            bindings.set(relPat.variable, edge)
          }
        }

        prevNode = node
      }
    }

    // Build return record if needed
    if (parsed.return) {
      const keys = parsed.return.items.map(item => item.alias ?? item.expression)
      const values = parsed.return.items.map(item => {
        const binding = bindings.get(item.expression)
        if (binding) {
          if ('label' in binding) {
            return nodeToNeo4j(binding as Node)
          } else {
            return edgeToNeo4j(binding as Edge, (binding as Edge).from, (binding as Edge).to)
          }
        }
        return null
      })
      records.push(new RecordImpl(keys, values))
    }
  }

  private async executeMatch(parsed: ParsedQuery, records: Neo4jRecord[]): Promise<void> {
    // Separate MATCH and CREATE patterns
    const matchPatterns = parsed.patterns.filter(p => p.clauseType === 'MATCH')
    const createPatterns = parsed.patterns.filter(p => p.clauseType === 'CREATE')

    // For each pattern, find matching nodes and relationships
    let bindings: Map<string, Node | Edge>[] = [new Map()]

    // Process MATCH patterns first
    for (const pattern of matchPatterns) {
      const newBindings: Map<string, Node | Edge>[] = []

      for (const binding of bindings) {
        // Find matching starting nodes
        if (pattern.nodes.length > 0) {
          const firstNodePat = pattern.nodes[0]!
          const matchingNodes = await this.graph.queryNodes({
            label: firstNodePat.labels[0],
            where: firstNodePat.properties
          })

          for (const node of matchingNodes) {
            // Check WHERE conditions
            if (parsed.where && !this.checkConditions(parsed.where.conditions, { ...Object.fromEntries(binding), [firstNodePat.variable ?? 'n']: node })) {
              continue
            }

            const newBinding = new Map(binding)
            if (firstNodePat.variable) {
              newBinding.set(firstNodePat.variable, node)
            }

            // Handle additional nodes in same pattern (comma-separated: MATCH (a), (b))
            for (let i = 1; i < pattern.nodes.length; i++) {
              const additionalNodePat = pattern.nodes[i]!
              const additionalMatches = await this.graph.queryNodes({
                label: additionalNodePat.labels[0],
                where: additionalNodePat.properties
              })
              // For comma-separated nodes, bind the first matching node
              if (additionalMatches.length > 0 && additionalNodePat.variable) {
                newBinding.set(additionalNodePat.variable, additionalMatches[0]!)
              }
            }

            // Traverse relationships
            if (pattern.relationships.length > 0) {
              const paths = await this.traversePattern(node, pattern, 0, newBinding)
              for (const path of paths) {
                newBindings.push(path)
              }
            } else {
              newBindings.push(newBinding)
            }
          }
        }
      }

      bindings = newBindings.length > 0 ? newBindings : [new Map()]
    }

    // If no MATCH patterns or all MATCHes returned results, process CREATE patterns
    // Skip CREATE if MATCH patterns existed but found no matches
    if (matchPatterns.length > 0 && bindings.length === 1 && bindings[0]!.size === 0) {
      // MATCH found nothing, skip CREATE
      return
    }

    // Process CREATE patterns using existing bindings
    for (const pattern of createPatterns) {
      for (const binding of bindings) {
        // For each relationship in the CREATE pattern
        for (const relPat of pattern.relationships) {
          // Find the source and target nodes from bindings
          const sourceVar = pattern.nodes[0]?.variable
          const targetVar = pattern.nodes[1]?.variable

          if (sourceVar && targetVar) {
            const sourceNode = binding.get(sourceVar) as Node | undefined
            const targetNode = binding.get(targetVar) as Node | undefined

            if (sourceNode && targetNode) {
              const edge = await this.graph.createEdge(
                relPat.direction === 'IN' ? targetNode.id : sourceNode.id,
                relPat.type ?? 'RELATED_TO',
                relPat.direction === 'IN' ? sourceNode.id : targetNode.id,
                relPat.properties
              )
              this.updates.relationshipsCreated++

              if (relPat.variable) {
                binding.set(relPat.variable, edge)
              }
            }
          }
        }

        // Handle creating new nodes (not bound from MATCH)
        for (const nodePat of pattern.nodes) {
          if (nodePat.variable && !binding.has(nodePat.variable)) {
            const node = await this.graph.createNode(
              nodePat.labels[0] ?? 'Node',
              nodePat.properties
            )
            this.updates.nodesCreated++
            binding.set(nodePat.variable, node)
          }
        }
      }
    }

    // Apply SET if present
    if (parsed.set) {
      for (const setClause of parsed.set) {
        for (const binding of bindings) {
          const target = binding.get(setClause.target)
          if (target && 'properties' in target) {
            if (setClause.property) {
              await this.graph.updateNode(target.id, { [setClause.property]: setClause.value })
              this.updates.propertiesSet++
            }
          }
        }
      }
    }

    // Build return records
    if (parsed.return) {
      for (const binding of bindings) {
        const keys = parsed.return.items.map(item => item.alias ?? item.expression)
        const values = parsed.return.items.map(item => {
          const expr = item.expression

          // Handle property access (n.name)
          if (expr.includes('.')) {
            const [varName, propName] = expr.split('.')
            const bound = binding.get(varName!)
            if (bound && 'properties' in bound) {
              return (bound as Node).properties[propName!]
            }
            return null
          }

          // Handle function calls (count, collect, etc.)
          const funcMatch = expr.match(/(\w+)\((\w+|\*)\)/i)
          if (funcMatch) {
            const func = funcMatch[1]!.toLowerCase()
            const arg = funcMatch[2]
            if (func === 'count') {
              return int(bindings.length)
            }
            // Add more aggregate functions as needed
          }

          // Handle variable reference
          const bound = binding.get(expr)
          if (bound) {
            if ('label' in bound) {
              return nodeToNeo4j(bound as Node)
            } else {
              return edgeToNeo4j(bound as Edge, (bound as Edge).from, (bound as Edge).to)
            }
          }

          return null
        })
        records.push(new RecordImpl(keys, values))
      }
    }

    // Apply ORDER BY, SKIP, LIMIT
    if (parsed.orderBy && records.length > 0) {
      records.sort((a, b) => {
        for (const order of parsed.orderBy!) {
          const aVal = a.get(order.expression)
          const bVal = b.get(order.expression)
          const cmp = this.compareValues(aVal, bVal)
          if (cmp !== 0) {
            return order.direction === 'DESC' ? -cmp : cmp
          }
        }
        return 0
      })
    }

    if (parsed.skip) {
      records.splice(0, parsed.skip)
    }

    if (parsed.limit) {
      records.splice(parsed.limit)
    }
  }

  private async traversePattern(
    startNode: Node,
    pattern: PatternClause,
    relIndex: number,
    binding: Map<string, Node | Edge>
  ): Promise<Map<string, Node | Edge>[]> {
    const results: Map<string, Node | Edge>[] = []

    if (relIndex >= pattern.relationships.length) {
      results.push(new Map(binding))
      return results
    }

    const relPat = pattern.relationships[relIndex]!
    const targetNodePat = pattern.nodes[relIndex + 1]

    // Get matching edges
    const direction = relPat.direction === 'IN' ? 'INCOMING' : relPat.direction === 'OUT' ? 'OUTGOING' : 'BOTH'
    const edges = await this.graph.queryEdges({
      from: direction !== 'INCOMING' ? startNode.id : undefined,
      to: direction !== 'OUTGOING' ? startNode.id : undefined,
      type: relPat.type
    })

    for (const edge of edges) {
      // Check edge type matches
      if (relPat.types && !relPat.types.includes(edge.type)) {
        continue
      }

      const neighborId = edge.from === startNode.id ? edge.to : edge.from
      const neighbor = await this.graph.getNode(neighborId)
      if (!neighbor) continue

      // Check target node pattern
      if (targetNodePat) {
        if (targetNodePat.labels.length > 0 && !targetNodePat.labels.includes(neighbor.label)) {
          continue
        }

        // Check properties
        let propsMatch = true
        for (const [key, value] of Object.entries(targetNodePat.properties)) {
          if (neighbor.properties[key] !== value) {
            propsMatch = false
            break
          }
        }
        if (!propsMatch) continue
      }

      const newBinding = new Map(binding)
      if (relPat.variable) {
        newBinding.set(relPat.variable, edge)
      }
      if (targetNodePat?.variable) {
        newBinding.set(targetNodePat.variable, neighbor)
      }

      // Continue traversing
      const subResults = await this.traversePattern(neighbor, pattern, relIndex + 1, newBinding)
      results.push(...subResults)
    }

    return results
  }

  private checkConditions(conditions: Condition[], context: Record<string, unknown>): boolean {
    for (const cond of conditions) {
      const leftPath = cond.left.split('.')
      let leftValue: unknown = context
      for (const part of leftPath) {
        if (leftValue && typeof leftValue === 'object') {
          leftValue = (leftValue as Record<string, unknown>)[part] ??
            (leftValue as { properties?: Record<string, unknown> }).properties?.[part]
        }
      }

      switch (cond.operator) {
        case '=':
          if (leftValue !== cond.right) return false
          break
        case '<>':
          if (leftValue === cond.right) return false
          break
        case '<':
          if (!(leftValue as number < (cond.right as number))) return false
          break
        case '>':
          if (!(leftValue as number > (cond.right as number))) return false
          break
        case '<=':
          if (!(leftValue as number <= (cond.right as number))) return false
          break
        case '>=':
          if (!(leftValue as number >= (cond.right as number))) return false
          break
        case 'IS NULL':
          if (leftValue !== null && leftValue !== undefined) return false
          break
        case 'IS NOT NULL':
          if (leftValue === null || leftValue === undefined) return false
          break
      }
    }
    return true
  }

  private compareValues(a: unknown, b: unknown): number {
    if (a === b) return 0
    if (a === null || a === undefined) return 1
    if (b === null || b === undefined) return -1
    if (typeof a === 'number' && typeof b === 'number') return a - b
    if (typeof a === 'string' && typeof b === 'string') return a.localeCompare(b)
    return 0
  }

  private async executeMerge(parsed: ParsedQuery, records: Neo4jRecord[]): Promise<void> {
    // MERGE = MATCH or CREATE
    // First try to match, if no matches then create
    const matchRecords: Neo4jRecord[] = []
    await this.executeMatch({ ...parsed, type: 'MATCH' }, matchRecords)

    if (matchRecords.length === 0) {
      await this.executeCreate(parsed, records)
    } else {
      records.push(...matchRecords)
    }
  }

  private async executeDelete(parsed: ParsedQuery, records: Neo4jRecord[]): Promise<void> {
    // First execute the MATCH part with a temporary RETURN to get bindings
    const tempParsed = {
      ...parsed,
      type: 'MATCH' as const,
      return: {
        items: (parsed.delete ?? []).map(v => ({
          expression: v.replace('DETACH ', '').trim()
        })),
        distinct: false
      }
    }
    const matchRecords: Neo4jRecord[] = []
    await this.executeMatch(tempParsed, matchRecords)

    // Then delete the specified variables
    for (const record of matchRecords) {
      for (const varName of parsed.delete ?? []) {
        const cleanVar = varName.replace('DETACH ', '').trim()
        const item = record.get(cleanVar)
        if (item && typeof item === 'object' && 'elementId' in item) {
          const neo4jItem = item as Neo4jNode | Neo4jRelationship
          if ('labels' in neo4jItem) {
            await this.graph.deleteNode(neo4jItem.elementId)
            this.updates.nodesDeleted++
          } else {
            await this.graph.deleteEdge(neo4jItem.elementId)
            this.updates.relationshipsDeleted++
          }
        }
      }
    }
    // Note: We don't add records to the output since DELETE doesn't return results
  }

  private async executeCall(parsed: ParsedQuery, records: Neo4jRecord[]): Promise<void> {
    if (!parsed.procedure) return

    const { name, args } = parsed.procedure

    // Implement common APOC-like procedures
    switch (name.toLowerCase()) {
      case 'db.labels':
        const stats = await this.graph.stats()
        for (const label of Object.keys(stats.labelCounts)) {
          records.push(new RecordImpl(['label'], [label]))
        }
        break

      case 'db.relationshiptypes':
        const edgeStats = await this.graph.stats()
        for (const type of Object.keys(edgeStats.typeCounts)) {
          records.push(new RecordImpl(['relationshipType'], [type]))
        }
        break

      case 'apoc.algo.pagerank':
        const pageRanks = await this.graph.pageRank()
        for (const [nodeId, score] of pageRanks) {
          const node = await this.graph.getNode(nodeId)
          if (node) {
            records.push(new RecordImpl(['node', 'score'], [nodeToNeo4j(node), score]))
          }
        }
        break

      case 'apoc.algo.betweenness':
        const betweenness = await this.graph.betweennessCentrality()
        for (const [nodeId, score] of betweenness) {
          const node = await this.graph.getNode(nodeId)
          if (node) {
            records.push(new RecordImpl(['node', 'score'], [nodeToNeo4j(node), score]))
          }
        }
        break

      case 'apoc.algo.closeness':
        const closeness = await this.graph.closenessCentrality()
        for (const [nodeId, score] of closeness) {
          const node = await this.graph.getNode(nodeId)
          if (node) {
            records.push(new RecordImpl(['node', 'score'], [nodeToNeo4j(node), score]))
          }
        }
        break

      case 'apoc.path.shortestpath':
      case 'shortestpath':
        if (args.length >= 2) {
          const fromId = String(args[0])
          const toId = String(args[1])
          const path = await this.graph.shortestPath(fromId, toId)
          if (path) {
            records.push(new RecordImpl(['path'], [pathToNeo4j(path)]))
          }
        }
        break

      case 'apoc.algo.dijkstra':
        if (args.length >= 2) {
          const fromId = String(args[0])
          const toId = String(args[1])
          const weightProp = args[2] ? String(args[2]) : 'weight'
          const result = await this.graph.dijkstra(fromId, toId, { weightProperty: weightProp })
          if (result) {
            records.push(new RecordImpl(['path', 'weight'], [pathToNeo4j(result.path), result.weight]))
          }
        }
        break

      case 'apoc.algo.connectedcomponents':
        const components = await this.graph.connectedComponents()
        for (let i = 0; i < components.length; i++) {
          const component = components[i]!
          for (const nodeId of component) {
            const node = await this.graph.getNode(nodeId)
            if (node) {
              records.push(new RecordImpl(['node', 'componentId'], [nodeToNeo4j(node), int(i)]))
            }
          }
        }
        break

      default:
        throw createNeo4jError(`Unknown procedure: ${name}`, 'Neo.ClientError.Procedure.ProcedureNotFound')
    }
  }

  private createSummary(query: string, params: CypherParams): ResultSummary {
    return {
      query: { text: query, parameters: params },
      queryType: 'rw',
      counters: new CountersImpl(this.updates),
      updateStatistics: new CountersImpl(this.updates),
      notifications: [],
      server: { address: 'dotdo:7687', version: 'DotDO/1.0.0', protocolVersion: 5.0 },
      resultConsumedAfter: int(0),
      resultAvailableAfter: int(0),
      database: { name: 'neo4j' }
    }
  }

  async commit(): Promise<void> {
    this.open = false
  }

  async rollback(): Promise<void> {
    this.open = false
    // In a real implementation, we'd undo changes here
  }

  isOpen(): boolean {
    return this.open
  }
}

// ============================================================================
// SESSION CLASS
// ============================================================================

class SessionImpl implements Session {
  private graph: GraphEngine
  private bookmarks: string[] = []
  private closed = false

  constructor(graph: GraphEngine, config?: SessionConfig) {
    this.graph = graph
    if (config?.bookmarks) {
      this.bookmarks = config.bookmarks
    }
  }

  async run<T = Record<string, unknown>>(
    query: string,
    params?: CypherParams,
    config?: TransactionConfig
  ): Promise<QueryResult<T>> {
    this.ensureOpen()
    const tx = this.beginTransaction(config)
    try {
      const result = await tx.run<T>(query, params)
      await tx.commit()
      return result
    } catch (error) {
      await tx.rollback()
      throw error
    }
  }

  async readTransaction<T>(work: TransactionWork<T>, config?: TransactionConfig): Promise<T> {
    return this.executeRead(work, config)
  }

  async writeTransaction<T>(work: TransactionWork<T>, config?: TransactionConfig): Promise<T> {
    return this.executeWrite(work, config)
  }

  async executeRead<T>(work: TransactionWork<T>, config?: TransactionConfig): Promise<T> {
    this.ensureOpen()
    const tx = this.beginTransaction(config)
    try {
      const result = await work(tx)
      await tx.commit()
      return result
    } catch (error) {
      await tx.rollback()
      throw error
    }
  }

  async executeWrite<T>(work: TransactionWork<T>, config?: TransactionConfig): Promise<T> {
    this.ensureOpen()
    const tx = this.beginTransaction(config)
    try {
      const result = await work(tx)
      await tx.commit()
      return result
    } catch (error) {
      await tx.rollback()
      throw error
    }
  }

  beginTransaction(config?: TransactionConfig): Transaction {
    this.ensureOpen()
    return new TransactionImpl(this.graph)
  }

  lastBookmark(): string {
    return this.bookmarks[this.bookmarks.length - 1] ?? ''
  }

  lastBookmarks(): string[] {
    return [...this.bookmarks]
  }

  async close(): Promise<void> {
    this.closed = true
  }

  private ensureOpen(): void {
    if (this.closed) {
      throw createNeo4jError('Session has been closed', 'Neo.ClientError.Request.Invalid')
    }
  }
}

// ============================================================================
// DRIVER CLASS
// ============================================================================

class DriverImpl implements Driver {
  private graph: GraphEngine
  private closed = false
  private uri: string
  private config?: DriverConfig

  constructor(uri: string, authToken?: AuthToken, config?: DriverConfig) {
    this.uri = uri
    this.config = config
    this.graph = new GraphEngine()
  }

  session(config?: SessionConfig): Session {
    this.ensureOpen()
    return new SessionImpl(this.graph, config)
  }

  async verifyConnectivity(): Promise<ServerInfo> {
    this.ensureOpen()
    return {
      address: this.uri,
      version: 'DotDO/1.0.0-neo4j-compat',
      protocolVersion: 5.0
    }
  }

  async supportsMultiDb(): Promise<boolean> {
    return true
  }

  async supportsTransactionConfig(): Promise<boolean> {
    return true
  }

  async close(): Promise<void> {
    this.closed = true
    await this.graph.clear()
  }

  async getServerInfo(): Promise<ServerInfo> {
    return this.verifyConnectivity()
  }

  private ensureOpen(): void {
    if (this.closed) {
      throw createNeo4jError('Driver has been closed', 'Neo.ClientError.Request.Invalid')
    }
  }
}

// ============================================================================
// ERROR HELPER
// ============================================================================

function createNeo4jError(message: string, code: string): Neo4jError {
  const error = new Error(message) as Neo4jError
  error.code = code
  error.retriable = code.includes('Transient')
  error.name = 'Neo4jError'
  return error
}

// ============================================================================
// AUTH TOKENS
// ============================================================================

const auth = {
  basic(username: string, password: string, realm?: string): AuthToken {
    return {
      scheme: 'basic',
      principal: username,
      credentials: password,
      realm
    }
  },

  bearer(token: string): AuthToken {
    return {
      scheme: 'bearer',
      credentials: token
    }
  },

  kerberos(ticket: string): AuthToken {
    return {
      scheme: 'kerberos',
      credentials: ticket
    }
  },

  none(): AuthToken {
    return { scheme: 'none' }
  },

  custom(principal: string, credentials: string, realm: string, scheme: string, parameters?: Record<string, unknown>): AuthToken {
    return {
      scheme: scheme as AuthToken['scheme'],
      principal,
      credentials,
      realm,
      parameters
    }
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

/**
 * Create a new Neo4j driver instance.
 */
function driver(uri: string, authToken?: AuthToken, config?: DriverConfig): Driver {
  return new DriverImpl(uri, authToken, config)
}

/**
 * Create a Neo4j integer.
 */
function integer(value: number | string): Neo4jInteger {
  return int(value)
}

/**
 * Check if a value is a Neo4j integer.
 */
function isInt(value: unknown): value is Neo4jInteger {
  return value !== null &&
    typeof value === 'object' &&
    'low' in value &&
    'high' in value &&
    'toNumber' in value
}

/**
 * Check if a value is a Neo4j Node.
 */
function isNode(value: unknown): value is Neo4jNode {
  return value !== null &&
    typeof value === 'object' &&
    'labels' in value &&
    'properties' in value &&
    'elementId' in value
}

/**
 * Check if a value is a Neo4j Relationship.
 */
function isRelationship(value: unknown): value is Neo4jRelationship {
  return value !== null &&
    typeof value === 'object' &&
    'type' in value &&
    'start' in value &&
    'end' in value &&
    'elementId' in value
}

/**
 * Check if a value is a Neo4j Path.
 */
function isPath(value: unknown): value is Neo4jPath {
  return value !== null &&
    typeof value === 'object' &&
    'start' in value &&
    'end' in value &&
    'segments' in value &&
    'length' in value
}

// Default export matching neo4j-driver module structure
const neo4j = {
  driver,
  auth,
  int: integer,
  integer,
  isInt,
  isNode,
  isRelationship,
  isPath,
  types: {
    Node: {} as Neo4jNode,
    Relationship: {} as Neo4jRelationship,
    Path: {} as Neo4jPath,
    Integer: {} as Neo4jInteger
  },
  session: {
    READ: 'READ' as const,
    WRITE: 'WRITE' as const
  }
}

export {
  driver,
  auth,
  integer,
  isInt,
  isNode,
  isRelationship,
  isPath
}

export default neo4j
