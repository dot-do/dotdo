/**
 * @dotdo/neo4j - Neo4j SDK compat
 *
 * Drop-in replacement for neo4j-driver backed by DO SQLite with JSON storage.
 * This in-memory implementation matches the Neo4j JavaScript driver API.
 * Production version routes to Durable Objects based on config.
 *
 * @see https://neo4j.com/docs/javascript-manual/current/
 */
import type {
  Driver as IDriver,
  Session as ISession,
  Transaction as ITransaction,
  ManagedTransaction as IManagedTransaction,
  Result as IResult,
  Neo4jRecord as IRecord,
  EagerResult,
  ResultSummary,
  ResultObserver,
  Counters,
  QueryType,
  Node,
  Relationship,
  Path,
  PathSegment,
  ServerInfo,
  DatabaseInfo,
  AuthToken,
  DriverConfig,
  ExtendedDriverConfig,
  SessionConfig,
  TransactionConfig,
  QueryConfig,
  BookmarkManager,
} from './types'

import {
  Integer,
  int,
  isInt,
  NodeImpl,
  RelationshipImpl,
  PathImpl,
  Neo4jError,
  ClientError,
  auth,
} from './types'

// Re-export types and classes
export {
  Integer,
  int,
  isInt,
  isNode,
  isRelationship,
  isPath,
  isPoint,
  isDate,
  isDateTime,
  isLocalDateTime,
  isDuration,
  NodeImpl,
  RelationshipImpl,
  PathImpl,
  Neo4jError,
  ServiceUnavailableError,
  SessionExpiredError,
  ProtocolError,
  DatabaseError,
  ClientError,
  TransientError,
  Point,
  Date,
  Time,
  LocalTime,
  DateTime,
  LocalDateTime,
  Duration,
  auth,
  notificationCategory,
  notificationSeverityLevel,
} from './types'

// ============================================================================
// IN-MEMORY STORAGE
// ============================================================================

interface StoredNode {
  id: number
  labels: string[]
  properties: Record<string, unknown>
}

interface StoredRelationship {
  id: number
  type: string
  startNodeId: number
  endNodeId: number
  properties: Record<string, unknown>
}

/**
 * Global in-memory storage for graph data
 */
class GraphStorage {
  private nodes: Map<number, StoredNode> = new Map()
  private relationships: Map<number, StoredRelationship> = new Map()
  private nodeIdCounter = 0
  private relIdCounter = 0

  // Pending transaction changes
  private txNodes: Map<number, StoredNode> | null = null
  private txRelationships: Map<number, StoredRelationship> | null = null
  private txDeletedNodes: Set<number> | null = null
  private txDeletedRels: Set<number> | null = null
  private txNodeIdCounter: number | null = null
  private txRelIdCounter: number | null = null

  beginTransaction(): void {
    this.txNodes = new Map(this.nodes)
    this.txRelationships = new Map(this.relationships)
    this.txDeletedNodes = new Set()
    this.txDeletedRels = new Set()
    this.txNodeIdCounter = this.nodeIdCounter
    this.txRelIdCounter = this.relIdCounter
  }

  commitTransaction(): void {
    if (this.txNodes) {
      this.nodes = this.txNodes
      this.relationships = this.txRelationships!
      this.nodeIdCounter = this.txNodeIdCounter!
      this.relIdCounter = this.txRelIdCounter!
    }
    this.clearTransaction()
  }

  rollbackTransaction(): void {
    this.clearTransaction()
  }

  private clearTransaction(): void {
    this.txNodes = null
    this.txRelationships = null
    this.txDeletedNodes = null
    this.txDeletedRels = null
    this.txNodeIdCounter = null
    this.txRelIdCounter = null
  }

  private getActiveNodes(): Map<number, StoredNode> {
    return this.txNodes ?? this.nodes
  }

  private getActiveRelationships(): Map<number, StoredRelationship> {
    return this.txRelationships ?? this.relationships
  }

  createNode(labels: string[], properties: Record<string, unknown>): StoredNode {
    const id = this.txNodeIdCounter !== null ? ++this.txNodeIdCounter : ++this.nodeIdCounter
    const node: StoredNode = { id, labels, properties }
    this.getActiveNodes().set(id, node)
    return node
  }

  createRelationship(
    type: string,
    startNodeId: number,
    endNodeId: number,
    properties: Record<string, unknown>
  ): StoredRelationship {
    const id = this.txRelIdCounter !== null ? ++this.txRelIdCounter : ++this.relIdCounter
    const rel: StoredRelationship = { id, type, startNodeId, endNodeId, properties }
    this.getActiveRelationships().set(id, rel)
    return rel
  }

  getNode(id: number): StoredNode | undefined {
    return this.getActiveNodes().get(id)
  }

  getRelationship(id: number): StoredRelationship | undefined {
    return this.getActiveRelationships().get(id)
  }

  getAllNodes(): StoredNode[] {
    return Array.from(this.getActiveNodes().values())
  }

  getAllRelationships(): StoredRelationship[] {
    return Array.from(this.getActiveRelationships().values())
  }

  findNodesByLabel(label: string): StoredNode[] {
    return this.getAllNodes().filter((n) => n.labels.includes(label))
  }

  findNodesByLabels(labels: string[]): StoredNode[] {
    return this.getAllNodes().filter((n) => labels.every((l) => n.labels.includes(l)))
  }

  findNodesByProperties(properties: Record<string, unknown>): StoredNode[] {
    return this.getAllNodes().filter((n) =>
      Object.entries(properties).every(([k, v]) => this.matchValue(n.properties[k], v))
    )
  }

  findNodesByLabelAndProperties(label: string, properties: Record<string, unknown>): StoredNode[] {
    return this.findNodesByLabel(label).filter((n) =>
      Object.entries(properties).every(([k, v]) => this.matchValue(n.properties[k], v))
    )
  }

  findRelationshipsByType(type: string): StoredRelationship[] {
    return this.getAllRelationships().filter((r) => r.type === type)
  }

  findOutgoingRelationships(nodeId: number, type?: string): StoredRelationship[] {
    return this.getAllRelationships().filter(
      (r) => r.startNodeId === nodeId && (type === undefined || r.type === type)
    )
  }

  findIncomingRelationships(nodeId: number, type?: string): StoredRelationship[] {
    return this.getAllRelationships().filter(
      (r) => r.endNodeId === nodeId && (type === undefined || r.type === type)
    )
  }

  findRelationships(nodeId: number, type?: string): StoredRelationship[] {
    return this.getAllRelationships().filter(
      (r) =>
        (r.startNodeId === nodeId || r.endNodeId === nodeId) &&
        (type === undefined || r.type === type)
    )
  }

  updateNodeProperties(nodeId: number, properties: Record<string, unknown>): void {
    const node = this.getActiveNodes().get(nodeId)
    if (node) {
      Object.assign(node.properties, properties)
    }
  }

  setNodeProperty(nodeId: number, key: string, value: unknown): void {
    const node = this.getActiveNodes().get(nodeId)
    if (node) {
      node.properties[key] = value
    }
  }

  removeNodeProperty(nodeId: number, key: string): void {
    const node = this.getActiveNodes().get(nodeId)
    if (node) {
      delete node.properties[key]
    }
  }

  updateRelationshipProperties(relId: number, properties: Record<string, unknown>): void {
    const rel = this.getActiveRelationships().get(relId)
    if (rel) {
      Object.assign(rel.properties, properties)
    }
  }

  deleteNode(nodeId: number): void {
    this.getActiveNodes().delete(nodeId)
    if (this.txDeletedNodes) {
      this.txDeletedNodes.add(nodeId)
    }
  }

  deleteRelationship(relId: number): void {
    this.getActiveRelationships().delete(relId)
    if (this.txDeletedRels) {
      this.txDeletedRels.add(relId)
    }
  }

  detachDeleteNode(nodeId: number): void {
    // Delete all relationships connected to this node
    const rels = this.findRelationships(nodeId)
    for (const rel of rels) {
      this.deleteRelationship(rel.id)
    }
    this.deleteNode(nodeId)
  }

  clear(): void {
    this.nodes.clear()
    this.relationships.clear()
    this.nodeIdCounter = 0
    this.relIdCounter = 0
    this.clearTransaction()
  }

  private matchValue(actual: unknown, expected: unknown): boolean {
    if (expected === null) {
      return actual === null || actual === undefined
    }
    if (isInt(expected)) {
      if (isInt(actual)) {
        return expected.equals(actual)
      }
      return expected.toNumber() === actual
    }
    if (isInt(actual)) {
      return actual.toNumber() === expected
    }
    if (Array.isArray(expected) && Array.isArray(actual)) {
      return (
        expected.length === actual.length &&
        expected.every((v, i) => this.matchValue(actual[i], v))
      )
    }
    return actual === expected
  }
}

// Global storage instance
const globalStorage = new GraphStorage()

/**
 * Clear all data from the global storage.
 * This is useful for testing to ensure a clean state between tests.
 */
export function clearStorage(): void {
  globalStorage.clear()
}

// ============================================================================
// CYPHER PARSER
// ============================================================================

interface ParsedQuery {
  type: 'CREATE' | 'MATCH' | 'MERGE' | 'DELETE' | 'SET' | 'REMOVE' | 'RETURN' | 'DETACH_DELETE'
  patterns: Pattern[]
  where?: WhereClause
  set?: SetClause[]
  remove?: RemoveClause[]
  return?: ReturnClause
  orderBy?: OrderByClause
  skip?: number
  limit?: number
  delete?: string[]
  detachDelete?: string[]
  create?: Pattern[]  // For MATCH ... CREATE patterns
}

interface Pattern {
  variable?: string
  labels?: string[]
  properties?: Record<string, unknown>
  relationships?: RelationshipPattern[]
}

interface RelationshipPattern {
  variable?: string
  type?: string
  direction: 'OUT' | 'IN' | 'BOTH'
  minHops?: number
  maxHops?: number
  properties?: Record<string, unknown>
  targetVariable?: string
  targetLabels?: string[]
  targetProperties?: Record<string, unknown>
}

interface WhereClause {
  conditions: Condition[]
  operator?: 'AND' | 'OR'
}

interface Condition {
  left: string
  operator: string
  right: unknown
  isNull?: boolean
  not?: boolean
}

interface SetClause {
  target: string
  property?: string
  value: unknown
  properties?: Record<string, unknown>
}

interface RemoveClause {
  target: string
  property: string
}

interface ReturnClause {
  items: ReturnItem[]
  distinct?: boolean
}

interface ReturnItem {
  expression: string
  alias?: string
  isNode?: boolean
  isRelationship?: boolean
  isPath?: boolean
  aggregate?: string
}

interface OrderByClause {
  items: { expression: string; direction: 'ASC' | 'DESC' }[]
}

/**
 * Simple Cypher parser
 */
function parseCypher(query: string, parameters: Record<string, unknown>): ParsedQuery[] {
  const normalized = query.trim().replace(/\s+/g, ' ')
  const queries: ParsedQuery[] = []

  // Split by main clauses while preserving order
  const clauses = splitClauses(normalized)

  let currentQuery: ParsedQuery | null = null
  let matchPatterns: Pattern[] = []

  for (const clause of clauses) {
    const upperClause = clause.toUpperCase()

    if (upperClause.startsWith('CREATE ')) {
      // If there's a current MATCH query, add CREATE patterns to it
      // This handles `MATCH ... CREATE ...` patterns
      if (currentQuery && currentQuery.type === 'MATCH') {
        if (!currentQuery.create) {
          currentQuery.create = []
        }
        currentQuery.create.push(...parsePatterns(clause.substring(7), parameters))
      } else {
        if (currentQuery) queries.push(currentQuery)
        currentQuery = {
          type: 'CREATE',
          patterns: parsePatterns(clause.substring(7), parameters),
        }
      }
    } else if (upperClause.startsWith('MATCH ')) {
      if (currentQuery && currentQuery.type !== 'MATCH') {
        queries.push(currentQuery)
        currentQuery = null
      }
      matchPatterns = parsePatterns(clause.substring(6), parameters)
      if (!currentQuery) {
        currentQuery = { type: 'MATCH', patterns: matchPatterns }
      } else {
        currentQuery.patterns.push(...matchPatterns)
      }
    } else if (upperClause.startsWith('WHERE ')) {
      if (currentQuery) {
        currentQuery.where = parseWhere(clause.substring(6), parameters)
      }
    } else if (upperClause.startsWith('SET ')) {
      if (currentQuery) {
        currentQuery.set = parseSet(clause.substring(4), parameters)
      }
    } else if (upperClause.startsWith('REMOVE ')) {
      if (currentQuery) {
        currentQuery.remove = parseRemove(clause.substring(7))
      }
    } else if (upperClause.startsWith('DELETE ')) {
      if (currentQuery) {
        currentQuery.delete = parseDelete(clause.substring(7))
      }
    } else if (upperClause.startsWith('DETACH DELETE ')) {
      if (currentQuery) {
        currentQuery.detachDelete = parseDelete(clause.substring(14))
      }
    } else if (upperClause.startsWith('RETURN ')) {
      if (currentQuery) {
        currentQuery.return = parseReturn(clause.substring(7))
      }
    } else if (upperClause.startsWith('ORDER BY ')) {
      if (currentQuery) {
        currentQuery.orderBy = parseOrderBy(clause.substring(9))
      }
    } else if (upperClause.startsWith('SKIP ')) {
      if (currentQuery) {
        currentQuery.skip = parseInt(clause.substring(5).trim(), 10)
      }
    } else if (upperClause.startsWith('LIMIT ')) {
      if (currentQuery) {
        currentQuery.limit = parseInt(clause.substring(6).trim(), 10)
      }
    }
  }

  if (currentQuery) queries.push(currentQuery)

  return queries
}

function splitClauses(query: string): string[] {
  // IMPORTANT: Order matters! Longer keywords must come before shorter ones
  // e.g., 'DETACH DELETE' before 'DELETE', 'ORDER BY' before 'ORDER'
  const keywords = ['DETACH DELETE', 'ORDER BY', 'CREATE', 'MATCH', 'WHERE', 'SET', 'REMOVE', 'DELETE', 'RETURN', 'SKIP', 'LIMIT', 'MERGE']
  const clauses: string[] = []
  let remaining = query

  while (remaining.length > 0) {
    let foundKeyword = ''
    let foundIndex = -1

    for (const keyword of keywords) {
      const regex = new RegExp(`\\b${keyword}\\b`, 'i')
      const match = remaining.match(regex)
      if (match && (foundIndex === -1 || match.index! < foundIndex)) {
        foundIndex = match.index!
        foundKeyword = keyword
      }
    }

    if (foundIndex === -1) {
      if (remaining.trim()) clauses.push(remaining.trim())
      break
    }

    if (foundIndex > 0) {
      const before = remaining.substring(0, foundIndex).trim()
      if (before) clauses.push(before)
    }

    // Find the next keyword to determine clause end
    let nextKeywordIndex = remaining.length
    for (const keyword of keywords) {
      const regex = new RegExp(`\\b${keyword}\\b`, 'gi')
      let match
      while ((match = regex.exec(remaining)) !== null) {
        if (match.index > foundIndex + foundKeyword.length) {
          nextKeywordIndex = Math.min(nextKeywordIndex, match.index)
          break
        }
      }
    }

    clauses.push(remaining.substring(foundIndex, nextKeywordIndex).trim())
    remaining = remaining.substring(nextKeywordIndex)
  }

  return clauses
}

function parsePatterns(patternStr: string, parameters: Record<string, unknown>): Pattern[] {
  const patterns: Pattern[] = []

  // Handle path assignment: p = (a)-[r]->(b)
  let pathVariable: string | undefined
  const pathAssignMatch = patternStr.match(/^(\w+)\s*=\s*(.+)$/)
  if (pathAssignMatch) {
    pathVariable = pathAssignMatch[1].trim()
    patternStr = pathAssignMatch[2].trim()
  }

  // Split by comma for multiple patterns (but not commas inside braces)
  const patternParts = splitPatternsByComma(patternStr)

  for (const part of patternParts) {
    const trimmedPart = part.trim()
    if (!trimmedPart) continue

    // Check if this part has relationships or is a standalone node
    const hasRelationship = /-\[|\]-|<-/g.test(trimmedPart)

    if (!hasRelationship) {
      // Standalone node pattern
      const nodeMatch = trimmedPart.match(/\((\w*)?(?::(\w+(?::\w+)*))?(?:\s*\{([^}]*)\})?\)/)
      if (nodeMatch) {
        const variable = nodeMatch[1] || undefined
        const labelsStr = nodeMatch[2]
        const propsStr = nodeMatch[3]

        const labels = labelsStr ? labelsStr.split(':').filter(Boolean) : undefined
        const properties = propsStr ? parseProperties(propsStr, parameters) : undefined

        patterns.push({
          variable,
          labels,
          properties,
          relationships: [],
        })
      }
    } else {
      // Pattern with relationships - parse the chain
      const chainPattern = parseRelationshipChainPattern(trimmedPart, parameters, pathVariable)
      if (chainPattern) {
        patterns.push(chainPattern)
      }
    }
  }

  return patterns
}

function splitPatternsByComma(str: string): string[] {
  const parts: string[] = []
  let current = ''
  let parenDepth = 0
  let braceDepth = 0
  let bracketDepth = 0

  for (let i = 0; i < str.length; i++) {
    const char = str[i]
    if (char === '(') parenDepth++
    if (char === ')') parenDepth--
    if (char === '{') braceDepth++
    if (char === '}') braceDepth--
    if (char === '[') bracketDepth++
    if (char === ']') bracketDepth--

    // Split on comma only when not inside any brackets
    if (char === ',' && parenDepth === 0 && braceDepth === 0 && bracketDepth === 0) {
      parts.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }
  if (current.trim()) parts.push(current.trim())

  return parts
}

function parseRelationshipChainPattern(
  chainStr: string,
  parameters: Record<string, unknown>,
  pathVariable?: string
): Pattern | null {
  // Parse a chain like (a:Person {name: $a})-[r:KNOWS]->(b:Person)
  const nodeRegex = /\((\w*)?(?::(\w+(?::\w+)*))?(?:\s*\{([^}]*)\})?\)/g
  const relRegex = /-\[(\w*)?(?::(\w+))?(?:\s*\{([^}]*)\})?(?:\*(\d*)(?:\.\.(\d+))?)?\]->|<-\[(\w*)?(?::(\w+))?(?:\s*\{([^}]*)\})?(?:\*(\d*)(?:\.\.(\d+))?)?\]-|-\[(\w*)?(?::(\w+))?(?:\s*\{([^}]*)\})?(?:\*(\d*)(?:\.\.(\d+))?)?\]-/g

  interface NodeMatch {
    index: number
    endIndex: number
    variable?: string
    labels?: string[]
    properties?: Record<string, unknown>
  }

  interface RelMatch {
    index: number
    endIndex: number
    variable?: string
    type?: string
    properties?: Record<string, unknown>
    direction: 'OUT' | 'IN' | 'BOTH'
    minHops?: number
    maxHops?: number
  }

  const nodeMatches: NodeMatch[] = []
  const relMatches: RelMatch[] = []

  let match
  // Extract all nodes
  while ((match = nodeRegex.exec(chainStr)) !== null) {
    const variable = match[1] || undefined
    const labelsStr = match[2]
    const propsStr = match[3]

    const labels = labelsStr ? labelsStr.split(':').filter(Boolean) : undefined
    const properties = propsStr ? parseProperties(propsStr, parameters) : undefined

    nodeMatches.push({
      index: match.index,
      endIndex: match.index + match[0].length,
      variable,
      labels,
      properties
    })
  }

  // Extract all relationships
  while ((match = relRegex.exec(chainStr)) !== null) {
    let variable: string | undefined
    let type: string | undefined
    let propsStr: string | undefined
    let direction: 'OUT' | 'IN' | 'BOTH' = 'OUT'
    let minHops: number | undefined
    let maxHops: number | undefined

    if (match[0].startsWith('-[') && match[0].endsWith(']->')) {
      // Outgoing: -[r:TYPE]->
      variable = match[1] || undefined
      type = match[2] || undefined
      propsStr = match[3]
      minHops = match[4] !== undefined && match[4] !== '' ? parseInt(match[4], 10) : undefined
      maxHops = match[5] !== undefined ? parseInt(match[5], 10) : undefined
      direction = 'OUT'
    } else if (match[0].startsWith('<-[') && match[0].endsWith(']-')) {
      // Incoming: <-[r:TYPE]-
      variable = match[6] || undefined
      type = match[7] || undefined
      propsStr = match[8]
      minHops = match[9] !== undefined && match[9] !== '' ? parseInt(match[9], 10) : undefined
      maxHops = match[10] !== undefined ? parseInt(match[10], 10) : undefined
      direction = 'IN'
    } else {
      // Bidirectional: -[r:TYPE]-
      variable = match[11] || undefined
      type = match[12] || undefined
      propsStr = match[13]
      minHops = match[14] !== undefined && match[14] !== '' ? parseInt(match[14], 10) : undefined
      maxHops = match[15] !== undefined ? parseInt(match[15], 10) : undefined
      direction = 'BOTH'
    }

    // Handle *1..3 syntax - set defaults for variable length paths
    if (minHops !== undefined || maxHops !== undefined) {
      if (minHops === undefined) minHops = 1
      if (maxHops === undefined) maxHops = minHops
    }

    const properties = propsStr ? parseProperties(propsStr, parameters) : undefined

    relMatches.push({
      index: match.index,
      endIndex: match.index + match[0].length,
      variable,
      type,
      properties,
      direction,
      minHops,
      maxHops
    })
  }

  if (nodeMatches.length === 0) {
    return null
  }

  // Sort by index
  nodeMatches.sort((a, b) => a.index - b.index)
  relMatches.sort((a, b) => a.index - b.index)

  // First node is the main pattern
  const firstNode = nodeMatches[0]
  const pattern: Pattern = {
    variable: firstNode.variable,
    labels: firstNode.labels,
    properties: firstNode.properties,
    relationships: [],
  }

  // Match relationships with their target nodes based on position
  for (const rel of relMatches) {
    // Find the node that comes after this relationship (>= because they may be adjacent)
    const targetNode = nodeMatches.find(n => n.index >= rel.endIndex)

    if (targetNode) {
      pattern.relationships!.push({
        variable: rel.variable,
        type: rel.type,
        properties: rel.properties,
        direction: rel.direction,
        minHops: rel.minHops,
        maxHops: rel.maxHops,
        targetVariable: targetNode.variable,
        targetLabels: targetNode.labels,
        targetProperties: targetNode.properties,
      })
    }
  }

  return pattern
}

function parseProperties(propsStr: string, parameters: Record<string, unknown>): Record<string, unknown> {
  const props: Record<string, unknown> = {}
  const pairs = propsStr.split(',')

  for (const pair of pairs) {
    const colonIndex = pair.indexOf(':')
    if (colonIndex === -1) continue

    const key = pair.substring(0, colonIndex).trim()
    let value = pair.substring(colonIndex + 1).trim()

    props[key] = parseValue(value, parameters)
  }

  return props
}

function parseValue(valueStr: string, parameters: Record<string, unknown>): unknown {
  valueStr = valueStr.trim()

  // Parameter reference
  if (valueStr.startsWith('$')) {
    const paramName = valueStr.substring(1)
    return parameters[paramName]
  }

  // String literal
  if ((valueStr.startsWith("'") && valueStr.endsWith("'")) ||
      (valueStr.startsWith('"') && valueStr.endsWith('"'))) {
    return valueStr.slice(1, -1)
  }

  // Boolean
  if (valueStr === 'true') return true
  if (valueStr === 'false') return false

  // Null
  if (valueStr === 'null') return null

  // Array
  if (valueStr.startsWith('[') && valueStr.endsWith(']')) {
    const inner = valueStr.slice(1, -1)
    if (!inner.trim()) return []
    return inner.split(',').map((v) => parseValue(v, parameters))
  }

  // Number
  const num = Number(valueStr)
  if (!isNaN(num)) return num

  return valueStr
}

function parseWhere(whereStr: string, parameters: Record<string, unknown>): WhereClause {
  const conditions: Condition[] = []
  let operator: 'AND' | 'OR' | undefined

  // Simple split by AND/OR
  const andParts = whereStr.split(/\bAND\b/i)
  if (andParts.length > 1) {
    operator = 'AND'
    for (const part of andParts) {
      const cond = parseCondition(part.trim(), parameters)
      if (cond) conditions.push(cond)
    }
  } else {
    const orParts = whereStr.split(/\bOR\b/i)
    if (orParts.length > 1) {
      operator = 'OR'
      for (const part of orParts) {
        const cond = parseCondition(part.trim(), parameters)
        if (cond) conditions.push(cond)
      }
    } else {
      const cond = parseCondition(whereStr.trim(), parameters)
      if (cond) conditions.push(cond)
    }
  }

  return { conditions, operator }
}

function parseCondition(condStr: string, parameters: Record<string, unknown>): Condition | null {
  // IS NULL / IS NOT NULL
  const isNullMatch = condStr.match(/^(.+?)\s+IS\s+(NOT\s+)?NULL$/i)
  if (isNullMatch) {
    return {
      left: isNullMatch[1].trim(),
      operator: 'IS',
      right: null,
      isNull: true,
      not: !!isNullMatch[2],
    }
  }

  // IN list
  const inMatch = condStr.match(/^(.+?)\s+IN\s+(.+)$/i)
  if (inMatch) {
    return {
      left: inMatch[1].trim(),
      operator: 'IN',
      right: parseValue(inMatch[2].trim(), parameters),
    }
  }

  // CONTAINS
  const containsMatch = condStr.match(/^(.+?)\s+CONTAINS\s+(.+)$/i)
  if (containsMatch) {
    return {
      left: containsMatch[1].trim(),
      operator: 'CONTAINS',
      right: parseValue(containsMatch[2].trim(), parameters),
    }
  }

  // STARTS WITH
  const startsMatch = condStr.match(/^(.+?)\s+STARTS\s+WITH\s+(.+)$/i)
  if (startsMatch) {
    return {
      left: startsMatch[1].trim(),
      operator: 'STARTS WITH',
      right: parseValue(startsMatch[2].trim(), parameters),
    }
  }

  // ENDS WITH
  const endsMatch = condStr.match(/^(.+?)\s+ENDS\s+WITH\s+(.+)$/i)
  if (endsMatch) {
    return {
      left: endsMatch[1].trim(),
      operator: 'ENDS WITH',
      right: parseValue(endsMatch[2].trim(), parameters),
    }
  }

  // Comparison operators
  const compMatch = condStr.match(/^(.+?)\s*(>=|<=|<>|!=|=|>|<)\s*(.+)$/)
  if (compMatch) {
    return {
      left: compMatch[1].trim(),
      operator: compMatch[2],
      right: parseValue(compMatch[3].trim(), parameters),
    }
  }

  return null
}

function parseSet(setStr: string, parameters: Record<string, unknown>): SetClause[] {
  const clauses: SetClause[] = []
  const parts = setStr.split(',')

  for (const part of parts) {
    const match = part.match(/^(\w+)\.(\w+)\s*=\s*(.+)$/)
    if (match) {
      clauses.push({
        target: match[1],
        property: match[2],
        value: parseValue(match[3].trim(), parameters),
      })
    } else {
      // SET n = $props or SET n += $props
      const propsMatch = part.match(/^(\w+)\s*\+?=\s*(.+)$/)
      if (propsMatch) {
        const value = parseValue(propsMatch[2].trim(), parameters)
        if (typeof value === 'object' && value !== null) {
          clauses.push({
            target: propsMatch[1],
            properties: value as Record<string, unknown>,
            value: null,
          })
        }
      }
    }
  }

  return clauses
}

function parseRemove(removeStr: string): RemoveClause[] {
  const clauses: RemoveClause[] = []
  const parts = removeStr.split(',')

  for (const part of parts) {
    const match = part.trim().match(/^(\w+)\.(\w+)$/)
    if (match) {
      clauses.push({
        target: match[1],
        property: match[2],
      })
    }
  }

  return clauses
}

function parseDelete(deleteStr: string): string[] {
  return deleteStr.split(',').map((s) => s.trim())
}

function parseReturn(returnStr: string): ReturnClause {
  const items: ReturnItem[] = []
  let distinct = false

  if (returnStr.toUpperCase().startsWith('DISTINCT ')) {
    distinct = true
    returnStr = returnStr.substring(9)
  }

  // Handle aggregations and aliases
  const parts = splitReturnParts(returnStr)

  for (const part of parts) {
    const aliasMatch = part.match(/^(.+?)\s+AS\s+(\w+)$/i)
    const expression = aliasMatch ? aliasMatch[1].trim() : part.trim()
    const alias = aliasMatch ? aliasMatch[2] : undefined

    // Check for aggregation
    const aggMatch = expression.match(/^(count|sum|avg|min|max|collect)\s*\((.+)\)$/i)

    items.push({
      expression,
      alias,
      aggregate: aggMatch ? aggMatch[1].toLowerCase() : undefined,
    })
  }

  return { items, distinct }
}

function splitReturnParts(str: string): string[] {
  const parts: string[] = []
  let current = ''
  let parenDepth = 0

  for (const char of str) {
    if (char === '(') parenDepth++
    if (char === ')') parenDepth--
    if (char === ',' && parenDepth === 0) {
      parts.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }
  if (current.trim()) parts.push(current.trim())

  return parts
}

function parseOrderBy(orderStr: string): OrderByClause {
  const items: { expression: string; direction: 'ASC' | 'DESC' }[] = []
  const parts = orderStr.split(',')

  for (const part of parts) {
    const descMatch = part.match(/^(.+?)\s+DESC$/i)
    const ascMatch = part.match(/^(.+?)\s+ASC$/i)

    if (descMatch) {
      items.push({ expression: descMatch[1].trim(), direction: 'DESC' })
    } else if (ascMatch) {
      items.push({ expression: ascMatch[1].trim(), direction: 'ASC' })
    } else {
      items.push({ expression: part.trim(), direction: 'ASC' })
    }
  }

  return { items }
}

// ============================================================================
// QUERY EXECUTOR
// ============================================================================

interface ExecutionContext {
  bindings: Map<string, StoredNode | StoredRelationship | Path<unknown, unknown> | unknown>
  results: Array<Map<string, unknown>>
  counters: CountersImpl
}

function executeQuery(
  queries: ParsedQuery[],
  parameters: Record<string, unknown>,
  storage: GraphStorage
): ExecutionContext {
  const ctx: ExecutionContext = {
    bindings: new Map(),
    results: [],
    counters: new CountersImpl(),
  }

  for (const query of queries) {
    switch (query.type) {
      case 'CREATE':
        executeCreate(query, parameters, storage, ctx)
        break
      case 'MATCH':
        executeMatch(query, parameters, storage, ctx)
        break
    }
  }

  return ctx
}

function executeCreate(
  query: ParsedQuery,
  parameters: Record<string, unknown>,
  storage: GraphStorage,
  ctx: ExecutionContext
): void {
  for (const pattern of query.patterns) {
    // Check if the main node already exists (from a prior MATCH)
    let currentNode: StoredNode

    if (pattern.variable && ctx.bindings.has(pattern.variable)) {
      // Use existing node from bindings
      currentNode = ctx.bindings.get(pattern.variable) as StoredNode
    } else {
      // Create the main node
      currentNode = storage.createNode(pattern.labels || [], pattern.properties || {})
      ctx.counters.nodesCreated++

      if (pattern.variable) {
        ctx.bindings.set(pattern.variable, currentNode)
      }
    }

    // Create relationships
    if (pattern.relationships) {
      for (const relPattern of pattern.relationships) {
        // Find or create target node
        let targetNode: StoredNode | undefined

        if (relPattern.targetVariable && ctx.bindings.has(relPattern.targetVariable)) {
          targetNode = ctx.bindings.get(relPattern.targetVariable) as StoredNode
        } else {
          targetNode = storage.createNode(
            relPattern.targetLabels || [],
            relPattern.targetProperties || {}
          )
          ctx.counters.nodesCreated++

          if (relPattern.targetVariable) {
            ctx.bindings.set(relPattern.targetVariable, targetNode)
          }
        }

        // Create relationship
        const startId = relPattern.direction === 'IN' ? targetNode.id : currentNode.id
        const endId = relPattern.direction === 'IN' ? currentNode.id : targetNode.id

        const rel = storage.createRelationship(
          relPattern.type || 'RELATED',
          startId,
          endId,
          relPattern.properties || {}
        )
        ctx.counters.relationshipsCreated++

        if (relPattern.variable) {
          ctx.bindings.set(relPattern.variable, rel)
        }

        currentNode = targetNode
      }
    }
  }

  // Handle RETURN
  if (query.return) {
    const result = new Map<string, unknown>()
    for (const item of query.return.items) {
      const key = item.alias || item.expression
      if (ctx.bindings.has(item.expression)) {
        result.set(key, ctx.bindings.get(item.expression))
      }
    }
    if (result.size > 0) {
      ctx.results.push(result)
    }
  }
}

function executeMatch(
  query: ParsedQuery,
  parameters: Record<string, unknown>,
  storage: GraphStorage,
  ctx: ExecutionContext
): void {
  let matchedBindings: Array<Map<string, StoredNode | StoredRelationship | Path<unknown, unknown>>> = []

  for (const pattern of query.patterns) {
    const patternMatches = matchPattern(pattern, storage, ctx)

    if (matchedBindings.length === 0) {
      matchedBindings = patternMatches
    } else {
      // Cross product or join based on shared variables
      const newBindings: Array<Map<string, StoredNode | StoredRelationship | Path<unknown, unknown>>> = []
      for (const existing of matchedBindings) {
        for (const newMatch of patternMatches) {
          // Check if shared variables match
          let compatible = true
          for (const [key, value] of newMatch) {
            if (existing.has(key)) {
              const existingValue = existing.get(key)
              if ('id' in (value as StoredNode) && 'id' in (existingValue as StoredNode)) {
                if ((value as StoredNode).id !== (existingValue as StoredNode).id) {
                  compatible = false
                  break
                }
              }
            }
          }
          if (compatible) {
            const merged = new Map(existing)
            for (const [key, value] of newMatch) {
              merged.set(key, value)
            }
            newBindings.push(merged)
          }
        }
      }
      matchedBindings = newBindings
    }
  }

  // Apply WHERE clause
  if (query.where) {
    matchedBindings = matchedBindings.filter((bindings) =>
      evaluateWhere(query.where!, bindings, parameters)
    )
  }

  // Apply SET
  if (query.set) {
    for (const setClause of query.set) {
      for (const bindings of matchedBindings) {
        const target = bindings.get(setClause.target)
        if (target && 'id' in (target as StoredNode)) {
          // Check if it's a node or relationship
          if ('labels' in (target as StoredNode)) {
            // It's a node
            if (setClause.property) {
              storage.setNodeProperty((target as StoredNode).id, setClause.property, setClause.value)
              ctx.counters.propertiesSet++
            } else if (setClause.properties) {
              storage.updateNodeProperties((target as StoredNode).id, setClause.properties)
              ctx.counters.propertiesSet += Object.keys(setClause.properties).length
            }
          } else if ('type' in (target as StoredRelationship)) {
            // It's a relationship
            if (setClause.property) {
              storage.updateRelationshipProperties((target as StoredRelationship).id, { [setClause.property]: setClause.value })
              ctx.counters.propertiesSet++
            } else if (setClause.properties) {
              storage.updateRelationshipProperties((target as StoredRelationship).id, setClause.properties)
              ctx.counters.propertiesSet += Object.keys(setClause.properties).length
            }
          }
        }
      }
    }
  }

  // Apply REMOVE
  if (query.remove) {
    for (const removeClause of query.remove) {
      for (const bindings of matchedBindings) {
        const target = bindings.get(removeClause.target) as StoredNode | undefined
        if (target && 'id' in target) {
          storage.removeNodeProperty(target.id, removeClause.property)
        }
      }
    }
  }

  // Apply DELETE
  if (query.delete) {
    for (const varName of query.delete) {
      for (const bindings of matchedBindings) {
        const target = bindings.get(varName)
        if (target && 'id' in (target as StoredNode)) {
          if ('labels' in (target as StoredNode)) {
            storage.deleteNode((target as StoredNode).id)
            ctx.counters.nodesDeleted++
          } else if ('type' in (target as StoredRelationship)) {
            storage.deleteRelationship((target as StoredRelationship).id)
            ctx.counters.relationshipsDeleted++
          }
        }
      }
    }
  }

  // Apply DETACH DELETE
  if (query.detachDelete) {
    for (const varName of query.detachDelete) {
      for (const bindings of matchedBindings) {
        const target = bindings.get(varName) as StoredNode | undefined
        if (target && 'id' in target && 'labels' in target) {
          const rels = storage.findRelationships(target.id)
          ctx.counters.relationshipsDeleted += rels.length
          storage.detachDeleteNode(target.id)
          ctx.counters.nodesDeleted++
        }
      }
    }
  }

  // Apply CREATE (for MATCH ... CREATE ... patterns)
  if (query.create) {
    for (const bindings of matchedBindings) {
      for (const createPattern of query.create) {
        // Check if the main node already exists in bindings
        let currentNode: StoredNode

        if (createPattern.variable && bindings.has(createPattern.variable)) {
          // Use existing node from bindings
          currentNode = bindings.get(createPattern.variable) as StoredNode
        } else {
          // Create new node
          currentNode = storage.createNode(createPattern.labels || [], createPattern.properties || {})
          ctx.counters.nodesCreated++
          if (createPattern.variable) {
            bindings.set(createPattern.variable, currentNode)
          }
        }

        // Create relationships
        if (createPattern.relationships) {
          for (const relPattern of createPattern.relationships) {
            let targetNode: StoredNode | undefined

            if (relPattern.targetVariable && bindings.has(relPattern.targetVariable)) {
              targetNode = bindings.get(relPattern.targetVariable) as StoredNode
            } else {
              targetNode = storage.createNode(
                relPattern.targetLabels || [],
                relPattern.targetProperties || {}
              )
              ctx.counters.nodesCreated++
              if (relPattern.targetVariable) {
                bindings.set(relPattern.targetVariable, targetNode)
              }
            }

            const startId = relPattern.direction === 'IN' ? targetNode.id : currentNode.id
            const endId = relPattern.direction === 'IN' ? currentNode.id : targetNode.id

            const rel = storage.createRelationship(
              relPattern.type || 'RELATED',
              startId,
              endId,
              relPattern.properties || {}
            )
            ctx.counters.relationshipsCreated++

            if (relPattern.variable) {
              bindings.set(relPattern.variable, rel)
            }

            currentNode = targetNode
          }
        }
      }
    }
  }

  // Handle RETURN with ORDER BY, SKIP, LIMIT
  if (query.return) {
    let results: Array<Map<string, unknown>> = []

    // Check for DISTINCT
    const seenValues = new Set<string>()

    for (const bindings of matchedBindings) {
      const result = new Map<string, unknown>()

      for (const item of query.return.items) {
        const key = item.alias || item.expression

        if (item.aggregate) {
          // Handle aggregations later
          continue
        }

        const value = evaluateExpression(item.expression, bindings, parameters)
        result.set(key, value)
      }

      // Handle DISTINCT
      if (query.return.distinct) {
        const valueKey = JSON.stringify(Array.from(result.values()))
        if (seenValues.has(valueKey)) continue
        seenValues.add(valueKey)
      }

      results.push(result)
    }

    // Handle aggregations
    const hasAggregates = query.return.items.some((item) => item.aggregate)
    if (hasAggregates) {
      const aggregateResult = new Map<string, unknown>()
      for (const item of query.return.items) {
        const key = item.alias || item.expression
        if (item.aggregate) {
          const values: unknown[] = []
          for (const bindings of matchedBindings) {
            const innerExpr = item.expression.match(/\((.+)\)/)?.[1] || ''
            if (innerExpr === '*' || innerExpr.trim() === 'r') {
              values.push(1)
            } else {
              values.push(evaluateExpression(innerExpr, bindings, parameters))
            }
          }
          aggregateResult.set(key, computeAggregate(item.aggregate, values))
        }
      }
      if (aggregateResult.size > 0) {
        results = [aggregateResult]
      }
    }

    // ORDER BY
    if (query.orderBy) {
      results.sort((a, b) => {
        for (const orderItem of query.orderBy!.items) {
          const aVal = evaluateExpressionFromResult(orderItem.expression, a)
          const bVal = evaluateExpressionFromResult(orderItem.expression, b)
          const cmp = compareValues(aVal, bVal)
          if (cmp !== 0) {
            return orderItem.direction === 'DESC' ? -cmp : cmp
          }
        }
        return 0
      })
    }

    // SKIP
    if (query.skip !== undefined) {
      results = results.slice(query.skip)
    }

    // LIMIT
    if (query.limit !== undefined) {
      results = results.slice(0, query.limit)
    }

    ctx.results.push(...results)
  }
}

function matchPattern(
  pattern: Pattern,
  storage: GraphStorage,
  ctx: ExecutionContext
): Array<Map<string, StoredNode | StoredRelationship | Path<unknown, unknown>>> {
  const results: Array<Map<string, StoredNode | StoredRelationship | Path<unknown, unknown>>> = []

  // Find candidate nodes
  let candidates: StoredNode[]

  if (pattern.labels && pattern.labels.length > 0) {
    candidates = storage.findNodesByLabels(pattern.labels)
  } else {
    candidates = storage.getAllNodes()
  }

  // Filter by properties
  if (pattern.properties && Object.keys(pattern.properties).length > 0) {
    candidates = candidates.filter((node) =>
      Object.entries(pattern.properties!).every(([k, v]) => matchPropertyValue(node.properties[k], v))
    )
  }

  // If no relationships, return node matches
  if (!pattern.relationships || pattern.relationships.length === 0) {
    for (const node of candidates) {
      const bindings = new Map<string, StoredNode | StoredRelationship | Path<unknown, unknown>>()
      if (pattern.variable) {
        bindings.set(pattern.variable, node)
      }
      results.push(bindings)
    }
    return results
  }

  // Match relationships
  for (const startNode of candidates) {
    const paths = matchRelationshipChain(
      startNode,
      pattern.relationships,
      0,
      storage,
      [startNode],
      []
    )

    for (const pathResult of paths) {
      const bindings = new Map<string, StoredNode | StoredRelationship | Path<unknown, unknown>>()
      if (pattern.variable) {
        bindings.set(pattern.variable, startNode)
      }

      // Add all nodes and relationships from the path
      for (const binding of pathResult.bindings) {
        bindings.set(binding.variable, binding.value)
      }

      // If path variable needed, create Path object
      if (pathResult.pathNodes.length > 1) {
        // Path would be added here if needed
      }

      results.push(bindings)
    }
  }

  return results
}

interface PathResult {
  pathNodes: StoredNode[]
  pathRels: StoredRelationship[]
  bindings: Array<{ variable: string; value: StoredNode | StoredRelationship }>
}

function matchRelationshipChain(
  currentNode: StoredNode,
  relationships: RelationshipPattern[],
  relIndex: number,
  storage: GraphStorage,
  pathNodes: StoredNode[],
  pathRels: StoredRelationship[]
): PathResult[] {
  if (relIndex >= relationships.length) {
    return [{ pathNodes: [...pathNodes], pathRels: [...pathRels], bindings: [] }]
  }

  const relPattern = relationships[relIndex]
  const results: PathResult[] = []

  // Handle variable length paths
  const minHops = relPattern.minHops ?? 1
  const maxHops = relPattern.maxHops ?? 1

  for (let hops = minHops; hops <= maxHops; hops++) {
    const pathResults = traversePath(
      currentNode,
      relPattern,
      hops,
      storage,
      new Set([currentNode.id])
    )

    for (const { endNode, rels } of pathResults) {
      // Check if target matches
      if (relPattern.targetLabels && relPattern.targetLabels.length > 0) {
        if (!relPattern.targetLabels.every((l) => endNode.labels.includes(l))) {
          continue
        }
      }

      if (relPattern.targetProperties && Object.keys(relPattern.targetProperties).length > 0) {
        const matches = Object.entries(relPattern.targetProperties).every(([k, v]) =>
          matchPropertyValue(endNode.properties[k], v)
        )
        if (!matches) continue
      }

      // Continue chain
      const subResults = matchRelationshipChain(
        endNode,
        relationships,
        relIndex + 1,
        storage,
        [...pathNodes, endNode],
        [...pathRels, ...rels]
      )

      for (const subResult of subResults) {
        const bindings: Array<{ variable: string; value: StoredNode | StoredRelationship }> = []

        if (relPattern.variable && rels.length === 1) {
          bindings.push({ variable: relPattern.variable, value: rels[0] })
        }
        if (relPattern.targetVariable) {
          bindings.push({ variable: relPattern.targetVariable, value: endNode })
        }

        results.push({
          pathNodes: subResult.pathNodes,
          pathRels: subResult.pathRels,
          bindings: [...bindings, ...subResult.bindings],
        })
      }
    }
  }

  return results
}

function traversePath(
  startNode: StoredNode,
  relPattern: RelationshipPattern,
  hops: number,
  storage: GraphStorage,
  visited: Set<number>
): Array<{ endNode: StoredNode; rels: StoredRelationship[] }> {
  if (hops === 0) {
    return [{ endNode: startNode, rels: [] }]
  }

  const results: Array<{ endNode: StoredNode; rels: StoredRelationship[] }> = []

  // Get relationships based on direction
  let rels: StoredRelationship[]
  switch (relPattern.direction) {
    case 'OUT':
      rels = storage.findOutgoingRelationships(startNode.id, relPattern.type)
      break
    case 'IN':
      rels = storage.findIncomingRelationships(startNode.id, relPattern.type)
      break
    case 'BOTH':
      rels = storage.findRelationships(startNode.id, relPattern.type)
      break
  }

  for (const rel of rels) {
    const nextNodeId = rel.startNodeId === startNode.id ? rel.endNodeId : rel.startNodeId
    if (visited.has(nextNodeId)) continue

    const nextNode = storage.getNode(nextNodeId)
    if (!nextNode) continue

    if (hops === 1) {
      results.push({ endNode: nextNode, rels: [rel] })
    } else {
      const newVisited = new Set(visited)
      newVisited.add(nextNodeId)
      const subPaths = traversePath(nextNode, relPattern, hops - 1, storage, newVisited)
      for (const subPath of subPaths) {
        results.push({
          endNode: subPath.endNode,
          rels: [rel, ...subPath.rels],
        })
      }
    }
  }

  return results
}

function matchPropertyValue(actual: unknown, expected: unknown): boolean {
  if (expected === null || expected === undefined) {
    return actual === null || actual === undefined
  }
  if (isInt(expected)) {
    if (isInt(actual)) return expected.equals(actual)
    return expected.toNumber() === actual
  }
  if (isInt(actual)) {
    return actual.toNumber() === expected
  }
  return actual === expected
}

function evaluateWhere(
  where: WhereClause,
  bindings: Map<string, StoredNode | StoredRelationship | Path<unknown, unknown>>,
  parameters: Record<string, unknown>
): boolean {
  if (where.operator === 'OR') {
    return where.conditions.some((cond) => evaluateCondition(cond, bindings, parameters))
  }
  // Default to AND
  return where.conditions.every((cond) => evaluateCondition(cond, bindings, parameters))
}

function evaluateCondition(
  cond: Condition,
  bindings: Map<string, StoredNode | StoredRelationship | Path<unknown, unknown>>,
  parameters: Record<string, unknown>
): boolean {
  const leftValue = evaluateExpression(cond.left, bindings, parameters)
  const rightValue = cond.right

  // IS NULL / IS NOT NULL
  if (cond.isNull) {
    const isNull = leftValue === null || leftValue === undefined
    return cond.not ? !isNull : isNull
  }

  switch (cond.operator) {
    case '=':
      return matchPropertyValue(leftValue, rightValue)
    case '<>':
    case '!=':
      return !matchPropertyValue(leftValue, rightValue)
    case '>':
      return compareValues(leftValue, rightValue) > 0
    case '>=':
      return compareValues(leftValue, rightValue) >= 0
    case '<':
      return compareValues(leftValue, rightValue) < 0
    case '<=':
      return compareValues(leftValue, rightValue) <= 0
    case 'IN':
      if (Array.isArray(rightValue)) {
        return rightValue.some((v) => matchPropertyValue(leftValue, v))
      }
      return false
    case 'CONTAINS':
      return typeof leftValue === 'string' && typeof rightValue === 'string' && leftValue.includes(rightValue)
    case 'STARTS WITH':
      return typeof leftValue === 'string' && typeof rightValue === 'string' && leftValue.startsWith(rightValue)
    case 'ENDS WITH':
      return typeof leftValue === 'string' && typeof rightValue === 'string' && leftValue.endsWith(rightValue)
    default:
      return false
  }
}

function evaluateExpression(
  expr: string,
  bindings: Map<string, StoredNode | StoredRelationship | Path<unknown, unknown>>,
  parameters: Record<string, unknown>
): unknown {
  // Parameter reference
  if (expr.startsWith('$')) {
    return parameters[expr.substring(1)]
  }

  // Property access: n.name
  const dotIndex = expr.indexOf('.')
  if (dotIndex !== -1) {
    const varName = expr.substring(0, dotIndex)
    const propName = expr.substring(dotIndex + 1)

    const binding = bindings.get(varName)
    if (binding && 'properties' in (binding as StoredNode)) {
      return (binding as StoredNode).properties[propName]
    }
  }

  // Variable reference
  if (bindings.has(expr)) {
    return bindings.get(expr)
  }

  // Literal
  return expr
}

function evaluateExpressionFromResult(expr: string, result: Map<string, unknown>): unknown {
  // Direct key lookup
  if (result.has(expr)) {
    return result.get(expr)
  }

  // Property access from node: n.age -> look up 'n' and get 'age'
  const dotIndex = expr.indexOf('.')
  if (dotIndex !== -1) {
    const varName = expr.substring(0, dotIndex)
    const propName = expr.substring(dotIndex + 1)

    const value = result.get(varName)
    if (value && typeof value === 'object' && 'properties' in (value as StoredNode)) {
      return (value as StoredNode).properties[propName]
    }
  }

  return undefined
}

function computeAggregate(func: string, values: unknown[]): unknown {
  switch (func) {
    case 'count':
      return values.length
    case 'sum':
      return values.reduce((acc: number, v) => acc + (typeof v === 'number' ? v : 0), 0)
    case 'avg': {
      const nums = values.filter((v): v is number => typeof v === 'number')
      return nums.length > 0 ? nums.reduce((a, b) => a + b, 0) / nums.length : 0
    }
    case 'min':
      return values.reduce((min, v) => (compareValues(v, min) < 0 ? v : min), values[0])
    case 'max':
      return values.reduce((max, v) => (compareValues(v, max) > 0 ? v : max), values[0])
    case 'collect':
      return values
    default:
      return null
  }
}

function compareValues(a: unknown, b: unknown): number {
  if (a === b) return 0
  if (a === null || a === undefined) return -1
  if (b === null || b === undefined) return 1

  if (typeof a === 'number' && typeof b === 'number') return a - b
  if (typeof a === 'string' && typeof b === 'string') return a.localeCompare(b)

  if (isInt(a) && isInt(b)) return a.compare(b)
  if (isInt(a) && typeof b === 'number') return a.toNumber() - b
  if (typeof a === 'number' && isInt(b)) return a - b.toNumber()

  return String(a).localeCompare(String(b))
}

// ============================================================================
// COUNTERS IMPLEMENTATION
// ============================================================================

class CountersImpl implements Counters {
  nodesCreated = 0
  nodesDeleted = 0
  relationshipsCreated = 0
  relationshipsDeleted = 0
  propertiesSet = 0
  labelsAdded = 0
  labelsRemoved = 0
  indexesAdded = 0
  indexesRemoved = 0
  constraintsAdded = 0
  constraintsRemoved = 0
  systemUpdates = 0

  containsUpdates(): boolean {
    return (
      this.nodesCreated > 0 ||
      this.nodesDeleted > 0 ||
      this.relationshipsCreated > 0 ||
      this.relationshipsDeleted > 0 ||
      this.propertiesSet > 0 ||
      this.labelsAdded > 0 ||
      this.labelsRemoved > 0
    )
  }

  containsSystemUpdates(): boolean {
    return this.systemUpdates > 0
  }
}

// ============================================================================
// RECORD IMPLEMENTATION
// ============================================================================

class RecordImpl<T = Record<string, unknown>> implements IRecord<T> {
  private _keys: string[]
  private _values: unknown[]

  constructor(keys: string[], values: unknown[]) {
    this._keys = keys
    this._values = values
  }

  get keys(): string[] {
    return this._keys
  }

  get length(): number {
    return this._keys.length
  }

  get(key: string | number): unknown {
    if (typeof key === 'number') {
      return this._values[key]
    }
    const index = this._keys.indexOf(key)
    return index >= 0 ? this._values[index] : undefined
  }

  has(key: string | number): boolean {
    if (typeof key === 'number') {
      return key >= 0 && key < this._values.length
    }
    return this._keys.includes(key)
  }

  forEach(visitor: (value: unknown, key: string, record: IRecord<T>) => void): void {
    for (let i = 0; i < this._keys.length; i++) {
      visitor(this._values[i], this._keys[i], this)
    }
  }

  toObject(): T {
    const obj: Record<string, unknown> = {}
    for (let i = 0; i < this._keys.length; i++) {
      obj[this._keys[i]] = this._values[i]
    }
    return obj as T
  }

  values(): unknown[] {
    return [...this._values]
  }

  entries(): Array<[string, unknown]> {
    return this._keys.map((k, i) => [k, this._values[i]])
  }
}

// ============================================================================
// RESULT IMPLEMENTATION
// ============================================================================

class ResultImpl<T = Record<string, unknown>> implements IResult<T> {
  private _records: RecordImpl<T>[]
  private _keys: string[]
  private _summary: ResultSummary
  private _position = 0

  constructor(
    records: Array<Map<string, unknown>>,
    keys: string[],
    counters: CountersImpl,
    serverInfo: ServerInfo
  ) {
    this._keys = keys
    this._records = records.map((r) => {
      const values = keys.map((k) => this.convertValue(r.get(k)))
      return new RecordImpl<T>(keys, values)
    })

    const queryType: QueryType = counters.containsUpdates() ? 'rw' : 'r'

    this._summary = {
      queryType,
      counters,
      notifications: [],
      server: serverInfo,
      database: { name: 'neo4j' },
      resultConsumedAfter: 0,
      resultAvailableAfter: 0,
      hasPlan: () => false,
      hasProfile: () => false,
    }
  }

  private convertValue(value: unknown): unknown {
    if (value === null || value === undefined) {
      return value
    }

    // Convert StoredNode to Node
    if (typeof value === 'object' && 'labels' in (value as StoredNode) && 'properties' in (value as StoredNode)) {
      const stored = value as StoredNode
      return new NodeImpl(
        int(stored.id),
        stored.labels,
        stored.properties,
        `4:${stored.id}`
      )
    }

    // Convert StoredRelationship to Relationship
    if (typeof value === 'object' && 'type' in (value as StoredRelationship) && 'startNodeId' in (value as StoredRelationship)) {
      const stored = value as StoredRelationship
      return new RelationshipImpl(
        int(stored.id),
        stored.type,
        int(stored.startNodeId),
        int(stored.endNodeId),
        stored.properties,
        `5:${stored.id}`,
        `4:${stored.startNodeId}`,
        `4:${stored.endNodeId}`
      )
    }

    return value
  }

  async records(): Promise<RecordImpl<T>[]> {
    return this._records
  }

  async summary(): Promise<ResultSummary> {
    return this._summary
  }

  async consume(): Promise<ResultSummary> {
    return this._summary
  }

  async keys(): Promise<string[]> {
    return this._keys
  }

  async peek(): Promise<RecordImpl<T> | null> {
    return this._records[0] ?? null
  }

  subscribe(observer: ResultObserver<T>): void {
    if (observer.onKeys) {
      observer.onKeys(this._keys)
    }
    for (const record of this._records) {
      if (observer.onNext) {
        observer.onNext(record as unknown as IRecord<T>)
      }
    }
    if (observer.onCompleted) {
      observer.onCompleted(this._summary)
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<IRecord<T>> {
    let position = 0
    const records = this._records

    return {
      async next(): Promise<IteratorResult<IRecord<T>>> {
        if (position >= records.length) {
          return { done: true, value: undefined }
        }
        return { done: false, value: records[position++] as unknown as IRecord<T> }
      },
    }
  }
}

// ============================================================================
// TRANSACTION IMPLEMENTATION
// ============================================================================

class TransactionImpl implements ITransaction {
  private _storage: GraphStorage
  private _isOpen = true
  private _serverInfo: ServerInfo
  private _parameters: Record<string, unknown> = {}

  constructor(storage: GraphStorage, serverInfo: ServerInfo) {
    this._storage = storage
    this._serverInfo = serverInfo
    this._storage.beginTransaction()
  }

  run<T = Record<string, unknown>>(
    query: string,
    parameters?: Record<string, unknown>
  ): IResult<T> {
    if (!this._isOpen) {
      throw new ClientError('Transaction is closed')
    }

    const params = { ...this._parameters, ...parameters }
    const parsed = parseCypher(query, params)
    const ctx = executeQuery(parsed, params, this._storage)

    // Extract keys from results
    const keys = ctx.results.length > 0 ? Array.from(ctx.results[0].keys()) : []

    return new ResultImpl<T>(ctx.results, keys, ctx.counters, this._serverInfo) as IResult<T>
  }

  async commit(): Promise<void> {
    if (!this._isOpen) {
      throw new ClientError('Transaction is already closed')
    }
    this._storage.commitTransaction()
    this._isOpen = false
  }

  async rollback(): Promise<void> {
    if (!this._isOpen) {
      throw new ClientError('Transaction is already closed')
    }
    this._storage.rollbackTransaction()
    this._isOpen = false
  }

  async close(): Promise<void> {
    if (this._isOpen) {
      await this.rollback()
    }
  }

  isOpen(): boolean {
    return this._isOpen
  }
}

class ManagedTransactionImpl implements IManagedTransaction {
  private _tx: TransactionImpl

  constructor(tx: TransactionImpl) {
    this._tx = tx
  }

  run<T = Record<string, unknown>>(
    query: string,
    parameters?: Record<string, unknown>
  ): IResult<T> {
    return this._tx.run<T>(query, parameters)
  }
}

// ============================================================================
// SESSION IMPLEMENTATION
// ============================================================================

class SessionImpl implements ISession {
  private _storage: GraphStorage
  private _config: SessionConfig
  private _serverInfo: ServerInfo
  private _bookmarks: string[] = []

  constructor(storage: GraphStorage, config: SessionConfig, serverInfo: ServerInfo) {
    this._storage = storage
    this._config = config
    this._serverInfo = serverInfo
    if (config.bookmarks) {
      this._bookmarks = Array.isArray(config.bookmarks) ? config.bookmarks : [config.bookmarks]
    }
  }

  run<T = Record<string, unknown>>(
    query: string,
    parameters?: Record<string, unknown>,
    config?: TransactionConfig
  ): IResult<T> {
    const params = parameters ?? {}
    const parsed = parseCypher(query, params)
    const ctx = executeQuery(parsed, params, this._storage)

    // Extract keys from results
    const keys = ctx.results.length > 0 ? Array.from(ctx.results[0].keys()) : []

    return new ResultImpl<T>(ctx.results, keys, ctx.counters, this._serverInfo) as IResult<T>
  }

  beginTransaction(config?: TransactionConfig): ITransaction {
    return new TransactionImpl(this._storage, this._serverInfo)
  }

  async executeRead<T>(
    work: (tx: IManagedTransaction) => Promise<T> | T,
    config?: TransactionConfig
  ): Promise<T> {
    const tx = new TransactionImpl(this._storage, this._serverInfo)
    const managedTx = new ManagedTransactionImpl(tx)
    try {
      const result = await work(managedTx)
      await tx.commit()
      return result
    } catch (e) {
      await tx.rollback()
      throw e
    }
  }

  async executeWrite<T>(
    work: (tx: IManagedTransaction) => Promise<T> | T,
    config?: TransactionConfig
  ): Promise<T> {
    const tx = new TransactionImpl(this._storage, this._serverInfo)
    const managedTx = new ManagedTransactionImpl(tx)
    try {
      const result = await work(managedTx)
      await tx.commit()
      return result
    } catch (e) {
      await tx.rollback()
      throw e
    }
  }

  async readTransaction<T>(
    work: (tx: ITransaction) => Promise<T> | T,
    config?: TransactionConfig
  ): Promise<T> {
    const tx = new TransactionImpl(this._storage, this._serverInfo)
    try {
      const result = await work(tx)
      await tx.commit()
      return result
    } catch (e) {
      await tx.rollback()
      throw e
    }
  }

  async writeTransaction<T>(
    work: (tx: ITransaction) => Promise<T> | T,
    config?: TransactionConfig
  ): Promise<T> {
    return this.readTransaction(work, config)
  }

  lastBookmarks(): string[] {
    return this._bookmarks
  }

  lastBookmark(): string[] {
    return this._bookmarks
  }

  async close(): Promise<void> {
    // Nothing to clean up for in-memory session
  }
}

// ============================================================================
// DRIVER IMPLEMENTATION
// ============================================================================

class DriverImpl implements IDriver {
  private _url: string
  private _auth: AuthToken
  private _config: ExtendedDriverConfig
  private _storage: GraphStorage
  private _serverInfo: ServerInfo

  constructor(url: string, authToken: AuthToken, config?: ExtendedDriverConfig) {
    this._url = url
    this._auth = authToken
    this._config = config ?? {}
    this._storage = globalStorage

    // Parse URL for server info
    const match = url.match(/(?:bolt|neo4j):\/\/([^:]+)(?::(\d+))?/)
    const host = match?.[1] ?? 'localhost'
    const port = match?.[2] ?? '7687'

    this._serverInfo = {
      address: `${host}:${port}`,
      protocolVersion: 5.0,
      agent: 'Neo4j/5.0.0',
    }
  }

  session(config?: SessionConfig): ISession {
    return new SessionImpl(this._storage, config ?? {}, this._serverInfo)
  }

  async verifyConnectivity(): Promise<ServerInfo> {
    return this._serverInfo
  }

  async getServerInfo(): Promise<ServerInfo> {
    return this._serverInfo
  }

  supportsSessionAcquisition(): boolean {
    return true
  }

  supportsMultiDatabase(): boolean {
    return true
  }

  supportsTransactionConfig(): boolean {
    return true
  }

  async executeQuery<T = Record<string, unknown>>(
    query: string,
    parameters?: Record<string, unknown>,
    config?: QueryConfig
  ): Promise<EagerResult<T>> {
    const session = this.session({ database: config?.database })
    try {
      const result = session.run<T>(query, parameters)
      const records = await result.records()
      const keys = await result.keys()
      const summary = await result.summary()

      return {
        keys,
        records: records as unknown as IRecord<T>[],
        summary,
      }
    } finally {
      await session.close()
    }
  }

  async close(): Promise<void> {
    // Clear storage on close (for testing)
    // In production, this would close connections
  }
}

// ============================================================================
// DRIVER FACTORY
// ============================================================================

/**
 * Create a new Neo4j driver
 */
export function driver(
  url: string,
  authToken: AuthToken,
  config?: DriverConfig | ExtendedDriverConfig
): IDriver {
  return new DriverImpl(url, authToken, config as ExtendedDriverConfig)
}

/**
 * Default export matching neo4j-driver API
 */
const neo4j = {
  driver,
  auth,
  int,
  isInt,
  Integer,
}

export default neo4j
