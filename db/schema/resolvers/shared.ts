/**
 * Shared Types and Utilities for Cascade Resolvers
 *
 * Common functionality used by both forward and backward cascade resolvers:
 * - Entity and Relationship type definitions
 * - ID generation
 * - Search query building
 * - Entity sorting utilities
 */

// ============================================================================
// SHARED TYPE DEFINITIONS
// ============================================================================

/**
 * Base entity with ID and type metadata.
 * All generated entities conform to this interface.
 */
export interface Entity {
  $id: string
  $type: string
  [key: string]: unknown
}

/**
 * Relationship between two entities with verb-based semantic.
 */
export interface Relationship {
  id: string
  from: string
  to: string
  verb: string
  data?: Record<string, unknown> | null
  createdAt?: Date
}

/**
 * Result from semantic search operations.
 */
export interface SemanticSearchResult {
  entity: Entity
  similarity: number
}

/**
 * Type schema for entity generation.
 */
export interface TypeSchema {
  fields: Record<string, { type: string; description?: string }>
}

// ============================================================================
// ID GENERATION
// ============================================================================

/**
 * Generate a unique ID for an entity in the format: type-randomid
 * Uses crypto.randomUUID for better randomness.
 */
export function generateEntityId(type: string): string {
  const randomPart = crypto.randomUUID().split('-')[0]
  return `${type.toLowerCase()}-${randomPart}`
}

/**
 * Generate a unique relationship ID with 'rel-' prefix.
 */
export function generateRelationshipId(): string {
  return `rel-${crypto.randomUUID().split('-')[0]}`
}

// ============================================================================
// ENTITY UTILITIES
// ============================================================================

/**
 * Build a search query string from entity context.
 * Extracts all non-system string fields from the entity.
 */
export function buildSearchQuery(entity: Entity): string {
  const relevantFields: string[] = []
  for (const [key, value] of Object.entries(entity)) {
    if (key.startsWith('$')) continue
    if (typeof value === 'string' && value.length > 0) {
      relevantFields.push(value)
    }
  }
  return relevantFields.join(' ')
}

/**
 * Sort entities by _generatedAt timestamp if available.
 * Entities without timestamp are sorted first (timestamp = 0).
 */
export function sortByGenerationTime(entities: Entity[]): Entity[] {
  return [...entities].sort((a, b) => {
    const aTime = (a._generatedAt as number) ?? 0
    const bTime = (b._generatedAt as number) ?? 0
    return aTime - bTime
  })
}

// ============================================================================
// DEFAULT IMPLEMENTATIONS
// ============================================================================

/**
 * Default entity generator - creates minimal entity with ID and type.
 */
export async function defaultEntityGenerator(type: string): Promise<Entity> {
  return {
    $id: generateEntityId(type),
    $type: type,
  }
}

/**
 * Default semantic search - returns empty results (no matches).
 */
export async function defaultSemanticSearch(): Promise<SemanticSearchResult[]> {
  return []
}

/**
 * Default store function - no-op.
 */
export async function defaultStore(): Promise<void> {}

// ============================================================================
// RELATIONSHIP UTILITIES
// ============================================================================

export interface CreateRelationshipParams {
  from: string
  to: string
  verb: string
  data?: Record<string, unknown> | null
  includeTimestamp?: boolean
}

/**
 * Create a relationship object with consistent structure.
 */
export function createRelationship(params: CreateRelationshipParams): Relationship {
  const relationship: Relationship = {
    id: generateRelationshipId(),
    from: params.from,
    to: params.to,
    verb: params.verb,
  }

  if (params.data !== undefined) {
    relationship.data = params.data
  }

  if (params.includeTimestamp) {
    relationship.createdAt = new Date()
  }

  return relationship
}

/**
 * Build relationship metadata for cascade operations.
 */
export function buildCascadeMetadata(
  operator: string,
  includeMetadata: boolean
): Record<string, unknown> | null {
  if (!includeMetadata) return null
  return {
    cascadeOperator: operator,
    generatedAt: Date.now(),
  }
}
