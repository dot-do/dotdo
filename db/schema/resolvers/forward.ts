/**
 * Forward Cascade Resolver
 *
 * Handles forward cascade operators:
 * - `->` (Forward Insert): Generate NEW target entity, link TO it
 * - `~>` (Forward Search): Semantic search first, generate if not found, link TO result
 *
 * Schema example:
 * ```typescript
 * const schema = DB({
 *   Startup: {
 *     idea: 'What is the startup idea?',
 *     businessModel: '->LeanCanvas',        // Generate new LeanCanvas, link TO it
 *     customer: '~>IdealCustomerProfile',   // Search for existing ICP, generate if not found
 *     founders: ['->Founder'],              // Generate array of new Founders
 *   },
 * })
 * ```
 */

import {
  type Entity,
  type Relationship,
  type SemanticSearchResult,
  type TypeSchema,
  generateEntityId,
  generateRelationshipId,
  buildSearchQuery,
  sortByGenerationTime,
  buildCascadeMetadata,
} from './shared'

// Re-export shared types
export type { Entity, Relationship, SemanticSearchResult, TypeSchema }

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export interface ParsedReference {
  direction: 'forward' | 'backward'
  mode: 'insert' | 'fuzzy'
  operator: '->' | '~>' | '<-' | '<~'
  target: string
  fieldName: string
  prompt: string
  optional: boolean
  isArray?: boolean
  count?: number
}

export interface GenerationContext {
  entity: Entity
  previousGenerations: Entity[]
  db: unknown
  ai: unknown
}

export interface GenerateOptions {
  type: string
  prompt: string
  context: {
    parentEntity: Entity
    previousGenerations?: Entity[]
    previousInArray?: Entity[]
  }
  schema?: TypeSchema
}

export interface SemanticSearchOptions {
  type: string
  query: string
  context: {
    parentEntity: Entity
  }
}

export interface CreateRelationshipOptions {
  id?: string
  from: string
  to: string
  verb: string
  data?: Record<string, unknown> | null
  createdAt: Date
}

export interface ForwardCascadeResolverOptions {
  generate?: (opts: GenerateOptions) => Promise<Entity | null>
  semanticSearch?: (opts: SemanticSearchOptions) => Promise<SemanticSearchResult[]>
  createRelationship?: (opts: CreateRelationshipOptions) => Promise<Relationship>
  store?: (entity: Entity) => Promise<void>
  similarityThreshold?: number
  typeSchemas?: Record<string, TypeSchema>
  verbMapping?: Record<string, string>
  includeMetadata?: boolean
  contextFilter?: (prev: Entity[], target: string) => Entity[]
  db?: unknown
}

// ============================================================================
// FORWARD CASCADE RESOLVER
// ============================================================================

export class ForwardCascadeResolver {
  private generate: (opts: GenerateOptions) => Promise<Entity | null>
  private semanticSearch: (opts: SemanticSearchOptions) => Promise<SemanticSearchResult[]>
  private createRelationship: (opts: CreateRelationshipOptions) => Promise<Relationship>
  private store: (entity: Entity) => Promise<void>
  private similarityThreshold: number
  private typeSchemas: Record<string, TypeSchema>
  private verbMapping: Record<string, string>
  private includeMetadata: boolean
  private contextFilter?: (prev: Entity[], target: string) => Entity[]
  private db: unknown

  constructor(options: ForwardCascadeResolverOptions = {}) {
    // Default generate function
    this.generate = options.generate ?? (async (opts) => ({
      $id: generateEntityId(opts.type),
      $type: opts.type,
    }))

    // Default semantic search function (returns empty - no matches)
    this.semanticSearch = options.semanticSearch ?? (async () => [])

    // Default relationship creation function
    this.createRelationship = options.createRelationship ?? (async (opts) => ({
      id: generateRelationshipId(),
      ...opts,
    }))

    // Default store function (no-op)
    this.store = options.store ?? (async () => {})

    this.similarityThreshold = options.similarityThreshold ?? 0.80
    this.typeSchemas = options.typeSchemas ?? {}
    this.verbMapping = options.verbMapping ?? {}
    this.includeMetadata = options.includeMetadata ?? false
    this.contextFilter = options.contextFilter
    this.db = options.db
  }

  /**
   * Resolve a forward reference to an entity
   */
  async resolve(ref: ParsedReference, context: GenerationContext): Promise<Entity | null> {
    // For fuzzy mode (~>), perform semantic search first
    if (ref.mode === 'fuzzy') {
      const searchQuery = buildSearchQuery(context.entity)

      const searchResults = await this.semanticSearch({
        type: ref.target,
        query: searchQuery,
        context: {
          parentEntity: context.entity,
        },
      })

      // Check if any result exceeds similarity threshold
      const matchingResult = searchResults.find(
        (result) => result.similarity >= this.similarityThreshold
      )

      if (matchingResult) {
        // Found existing entity - create relationship and return
        await this.createRelationship({
          id: generateRelationshipId(),
          from: context.entity.$id,
          to: matchingResult.entity.$id,
          verb: this.getVerb(ref.fieldName),
          data: buildCascadeMetadata(ref.operator, this.includeMetadata),
          createdAt: new Date(),
        })
        return matchingResult.entity
      }
    }

    // Generate new entity
    let generated: Entity | null = null
    try {
      // Prepare previous generations, sorted and filtered if needed
      let previousGenerations = sortByGenerationTime(context.previousGenerations)
      if (this.contextFilter) {
        previousGenerations = this.contextFilter(previousGenerations, ref.target)
      }

      generated = await this.generate({
        type: ref.target,
        prompt: ref.prompt,
        context: {
          parentEntity: context.entity,
          previousGenerations,
        },
        schema: this.typeSchemas[ref.target],
      })
    } catch (error) {
      // For optional fields, return null on generation failure
      if (ref.optional) {
        return null
      }
      throw error
    }

    // If generation returned null
    if (!generated) {
      if (ref.optional) {
        return null
      }
      // For required fields, this should not happen with default generator
      generated = {
        $id: generateEntityId(ref.target),
        $type: ref.target,
      }
    }

    // Ensure $id is set
    if (!generated.$id) {
      generated.$id = generateEntityId(ref.target)
    }

    // Store the generated entity
    await this.store(generated)

    // Handle db insert if db option provided with insert method
    if (this.db && typeof (this.db as any).insert === 'function') {
      const db = this.db as { insert: (table: string) => { values: (data: unknown) => { returning: () => Promise<unknown[]> } } }
      await db.insert('relationships').values({
        from: context.entity.$id,
        to: generated.$id,
        verb: this.getVerb(ref.fieldName),
        data: buildCascadeMetadata(ref.operator, this.includeMetadata),
        createdAt: new Date(),
      }).returning()
    } else {
      // Create relationship using the configured function
      await this.createRelationship({
        id: generateRelationshipId(),
        from: context.entity.$id,
        to: generated.$id,
        verb: this.getVerb(ref.fieldName),
        data: buildCascadeMetadata(ref.operator, this.includeMetadata),
        createdAt: new Date(),
      })
    }

    return generated
  }

  /**
   * Resolve an array of forward references
   */
  async resolveArray(ref: ParsedReference, context: GenerationContext): Promise<Entity[]> {
    const count = ref.count ?? 1
    const results: Entity[] = []

    for (let i = 0; i < count; i++) {
      // Create a modified generate function that includes previous array items
      const previousInArray = [...results]

      const originalGenerate = this.generate
      const wrappedGenerate = async (opts: GenerateOptions): Promise<Entity | null> => {
        return originalGenerate({
          ...opts,
          context: {
            ...opts.context,
            previousInArray,
          },
        })
      }

      // Temporarily replace generate
      this.generate = wrappedGenerate

      try {
        const entity = await this.resolve(ref, context)
        if (entity) {
          results.push(entity)
        }
      } finally {
        // Restore original generate
        this.generate = originalGenerate
      }

      // Small delay between iterations to ensure unique timestamps for relationship ids
      // This ensures Date.now() returns different values for each relationship
      if (i < count - 1) {
        await new Promise(resolve => setTimeout(resolve, 1))
      }
    }

    return results
  }

  /**
   * Get the verb for a relationship, applying any custom mapping
   */
  private getVerb(fieldName: string): string {
    return this.verbMapping[fieldName] ?? fieldName
  }
}

// ============================================================================
// SHORTHAND HELPER FUNCTIONS
// ============================================================================

export interface ShorthandReference {
  target: string
  fieldName: string
  prompt: string
}

/**
 * Shorthand for resolving a forward insert (->) reference
 */
export async function resolveForwardInsert(
  ref: ShorthandReference,
  context: GenerationContext,
  resolver: ForwardCascadeResolver
): Promise<Entity> {
  const parsedRef: ParsedReference = {
    direction: 'forward',
    mode: 'insert',
    operator: '->',
    target: ref.target,
    fieldName: ref.fieldName,
    prompt: ref.prompt,
    optional: false,
  }

  const result = await resolver.resolve(parsedRef, context)
  return result!
}

/**
 * Shorthand for resolving a forward search (~>) reference
 */
export async function resolveForwardSearch(
  ref: ShorthandReference,
  context: GenerationContext,
  resolver: ForwardCascadeResolver
): Promise<Entity> {
  const parsedRef: ParsedReference = {
    direction: 'forward',
    mode: 'fuzzy',
    operator: '~>',
    target: ref.target,
    fieldName: ref.fieldName,
    prompt: ref.prompt,
    optional: false,
  }

  const result = await resolver.resolve(parsedRef, context)
  return result!
}
