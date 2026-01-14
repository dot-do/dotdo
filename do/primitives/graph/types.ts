/**
 * Graph Primitives - Shared Type Definitions
 *
 * Core types used across the graph primitives module.
 *
 * @module db/primitives/graph/types
 */

// =============================================================================
// PRIMITIVE TYPES
// =============================================================================

/**
 * Unique identifier for a node
 */
export type NodeId = string

/**
 * Unique identifier for an edge
 */
export type EdgeId = string

/**
 * Node label (type classification)
 */
export type Label = string

/**
 * Edge type (relationship type)
 */
export type EdgeType = string

/**
 * Generic properties map
 */
export type Properties = Record<string, unknown>

/**
 * Timestamp in milliseconds since epoch
 */
export type Timestamp = number

// =============================================================================
// DIRECTION
// =============================================================================

/**
 * Direction for edge queries and traversals
 */
export type Direction = 'outgoing' | 'incoming' | 'both'

/**
 * Neo4j-style direction (uppercase for compatibility)
 */
export type DirectionNeo4j = 'OUTGOING' | 'INCOMING' | 'BOTH'

/**
 * Convert direction to Neo4j-style
 */
export function toNeo4jDirection(dir: Direction): DirectionNeo4j {
  switch (dir) {
    case 'outgoing':
      return 'OUTGOING'
    case 'incoming':
      return 'INCOMING'
    case 'both':
      return 'BOTH'
  }
}

/**
 * Convert Neo4j-style direction to lowercase
 */
export function fromNeo4jDirection(dir: DirectionNeo4j): Direction {
  switch (dir) {
    case 'OUTGOING':
      return 'outgoing'
    case 'INCOMING':
      return 'incoming'
    case 'BOTH':
      return 'both'
  }
}

// =============================================================================
// COMPARISON OPERATORS
// =============================================================================

/**
 * Comparison operator for WHERE clauses
 */
export type ComparisonOp =
  | '='
  | '!='
  | '<>'
  | '<'
  | '>'
  | '<='
  | '>='
  | 'IN'
  | 'NOT IN'
  | 'CONTAINS'
  | 'STARTS WITH'
  | 'ENDS WITH'
  | 'IS NULL'
  | 'IS NOT NULL'
  | 'REGEX'

/**
 * Comparison operators object (MongoDB-style)
 */
export interface ComparisonOperators {
  $eq?: unknown
  $ne?: unknown
  $gt?: number
  $gte?: number
  $lt?: number
  $lte?: number
  $in?: unknown[]
  $nin?: unknown[]
  $contains?: string
  $startsWith?: string
  $endsWith?: string
  $regex?: string
  $exists?: boolean
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Generate a unique ID
 */
export function generateId(prefix: string): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 8)
  return `${prefix}-${timestamp}-${random}`
}

/**
 * Generate a unique node ID
 */
export function generateNodeId(): NodeId {
  return generateId('node')
}

/**
 * Generate a unique edge ID
 */
export function generateEdgeId(): EdgeId {
  return generateId('edge')
}

/**
 * Check if a value matches a comparison operator
 */
export function matchesOperator(value: unknown, operator: ComparisonOperators): boolean {
  if (operator.$eq !== undefined && value !== operator.$eq) return false
  if (operator.$ne !== undefined && value === operator.$ne) return false

  if (typeof value === 'number') {
    if (operator.$gt !== undefined && value <= operator.$gt) return false
    if (operator.$gte !== undefined && value < operator.$gte) return false
    if (operator.$lt !== undefined && value >= operator.$lt) return false
    if (operator.$lte !== undefined && value > operator.$lte) return false
  }

  if (operator.$in !== undefined && !operator.$in.includes(value)) return false
  if (operator.$nin !== undefined && operator.$nin.includes(value)) return false

  if (typeof value === 'string') {
    if (operator.$contains !== undefined && !value.includes(operator.$contains)) return false
    if (operator.$startsWith !== undefined && !value.startsWith(operator.$startsWith)) return false
    if (operator.$endsWith !== undefined && !value.endsWith(operator.$endsWith)) return false
    if (operator.$regex !== undefined && !new RegExp(operator.$regex).test(value)) return false
  }

  if (operator.$exists !== undefined) {
    const exists = value !== undefined && value !== null
    if (operator.$exists !== exists) return false
  }

  return true
}

/**
 * Check if properties match a where clause
 */
export function matchesProperties(
  properties: Properties,
  where: Record<string, unknown | ComparisonOperators>
): boolean {
  for (const [key, condition] of Object.entries(where)) {
    const value = properties[key]

    if (typeof condition === 'object' && condition !== null && !Array.isArray(condition)) {
      // It's a comparison operators object
      if (!matchesOperator(value, condition as ComparisonOperators)) {
        return false
      }
    } else {
      // Direct equality check
      if (value !== condition) {
        return false
      }
    }
  }

  return true
}
