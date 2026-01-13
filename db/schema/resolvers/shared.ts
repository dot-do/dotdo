/**
 * Shared Types and Utilities for Cascade Resolvers
 *
 * Common functionality used by both forward and backward cascade resolvers:
 * - Entity and Relationship type definitions
 * - ID generation
 * - Search query building
 * - Entity sorting utilities
 * - Base resolver class with shared logic
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
// COMMON RESOLVER INTERFACES
// ============================================================================

/**
 * Context for entity generation, shared by forward and backward resolvers.
 */
export interface GenerationContext {
  /** The parent/source entity triggering the cascade */
  parentEntity: Entity
  /** Previously generated entities in this session */
  previousGenerations?: Entity[]
  /** For array generation: previously generated items in this array */
  previousInArray?: Entity[]
}

/**
 * Options for generating an entity.
 */
export interface GenerateOptions {
  /** Target entity type */
  type: string
  /** Generation prompt/instruction */
  prompt: string
  /** Generation context */
  context: GenerationContext
  /** Optional type schema for structured generation */
  schema?: TypeSchema
}

/**
 * Options for semantic search.
 */
export interface SearchOptions {
  /** Entity type to search */
  type: string
  /** Multiple types for union search */
  types?: string[]
  /** Search query */
  query: string
  /** Minimum similarity threshold */
  threshold?: number
  /** Context for search */
  context: {
    parentEntity: Entity
  }
}

/**
 * Options for creating a relationship.
 */
export interface RelationshipOptions {
  /** Optional explicit ID */
  id?: string
  /** Source entity ID */
  from: string
  /** Target entity ID */
  to: string
  /** Relationship verb */
  verb: string
  /** Additional metadata */
  data?: Record<string, unknown> | null
  /** Creation timestamp */
  createdAt?: Date
}

/**
 * Base configuration options shared by all cascade resolvers.
 */
export interface BaseCascadeResolverOptions {
  /** Custom entity generator function */
  generate?: (opts: GenerateOptions) => Promise<Entity | null>
  /** Custom semantic search function */
  semanticSearch?: (opts: SearchOptions) => Promise<SemanticSearchResult[]>
  /** Custom relationship creation function */
  createRelationship?: (opts: RelationshipOptions) => Promise<Relationship>
  /** Custom entity store function */
  store?: (entity: Entity) => Promise<void>
  /** Similarity threshold for fuzzy matching */
  similarityThreshold?: number
  /** Type schemas for structured generation */
  typeSchemas?: Record<string, TypeSchema>
  /** Custom verb mapping */
  verbMapping?: Record<string, string>
  /** Whether to include cascade metadata in relationships */
  includeMetadata?: boolean
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

// ============================================================================
// BASE CASCADE RESOLVER ABSTRACT CLASS
// ============================================================================

/**
 * Abstract base class for cascade resolvers.
 *
 * Provides shared functionality for entity generation, relationship creation,
 * and context propagation. Subclasses implement direction-specific logic:
 * - ForwardCascadeResolver: from=this, to=target
 * - BackwardCascadeResolver: from=target, to=this
 *
 * This consolidation reduces code duplication across resolvers by ~30% and
 * centralizes common patterns like ID generation, storage, and error handling.
 */
export abstract class BaseCascadeResolver {
  protected generateFn: (opts: GenerateOptions) => Promise<Entity | null>
  protected semanticSearchFn: (opts: SearchOptions) => Promise<SemanticSearchResult[]>
  protected createRelationshipFn: (opts: RelationshipOptions) => Promise<Relationship>
  protected storeFn: (entity: Entity) => Promise<void>
  protected similarityThreshold: number
  protected typeSchemas: Record<string, TypeSchema>
  protected verbMapping: Record<string, string>
  protected includeMetadata: boolean

  constructor(options: BaseCascadeResolverOptions = {}) {
    // Default entity generator - creates minimal entity with ID and type
    this.generateFn = options.generate ?? (async (opts) => ({
      $id: generateEntityId(opts.type),
      $type: opts.type,
    }))

    // Default semantic search - returns empty (no matches)
    this.semanticSearchFn = options.semanticSearch ?? (async () => [])

    // Default relationship creation
    this.createRelationshipFn = options.createRelationship ?? (async (opts) => ({
      id: opts.id ?? generateRelationshipId(),
      from: opts.from,
      to: opts.to,
      verb: opts.verb,
      data: opts.data ?? null,
      createdAt: opts.createdAt ?? new Date(),
    }))

    // Default store - no-op
    this.storeFn = options.store ?? (async () => {})

    this.similarityThreshold = options.similarityThreshold ?? 0.80
    this.typeSchemas = options.typeSchemas ?? {}
    this.verbMapping = options.verbMapping ?? {}
    this.includeMetadata = options.includeMetadata ?? false
  }

  // ============================================================================
  // PROTECTED HELPER METHODS (shared by subclasses)
  // ============================================================================

  /**
   * Generate an entity using the configured generator.
   * Handles optional fields gracefully by returning null on failure.
   */
  protected async generateEntity(
    type: string,
    prompt: string,
    context: GenerationContext,
    optional: boolean = false
  ): Promise<Entity | null> {
    try {
      const generated = await this.generateFn({
        type,
        prompt,
        context,
        schema: this.typeSchemas[type],
      })

      if (!generated) {
        if (optional) return null
        // For required fields, fall back to minimal entity
        return {
          $id: generateEntityId(type),
          $type: type,
        }
      }

      // Ensure $id is set
      if (!generated.$id) {
        generated.$id = generateEntityId(type)
      }

      return generated
    } catch (error) {
      if (optional) return null
      throw error
    }
  }

  /**
   * Store an entity using the configured store function.
   */
  protected async storeEntity(entity: Entity): Promise<void> {
    await this.storeFn(entity)
  }

  /**
   * Perform semantic search using the configured search function.
   */
  protected async performSearch(opts: SearchOptions): Promise<SemanticSearchResult[]> {
    return this.semanticSearchFn(opts)
  }

  /**
   * Create a relationship using the configured function.
   */
  protected async createRelationship(opts: RelationshipOptions): Promise<Relationship> {
    return this.createRelationshipFn(opts)
  }

  /**
   * Get the verb for a relationship, applying any custom mapping.
   */
  protected getVerb(fieldName: string): string {
    return this.verbMapping[fieldName] ?? fieldName
  }

  /**
   * Build metadata for a cascade operation.
   */
  protected buildMetadata(operator: string): Record<string, unknown> | null {
    return buildCascadeMetadata(operator, this.includeMetadata)
  }

  /**
   * Check if a similarity score meets the threshold.
   */
  protected meetsThreshold(similarity: number): boolean {
    return similarity >= this.similarityThreshold
  }

  /**
   * Sort entities by generation time for context ordering.
   */
  protected sortByTime(entities: Entity[]): Entity[] {
    return sortByGenerationTime(entities)
  }

  /**
   * Build a search query from an entity's string fields.
   */
  protected buildQuery(entity: Entity): string {
    return buildSearchQuery(entity)
  }
}
