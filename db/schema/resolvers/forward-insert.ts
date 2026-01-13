/**
 * Forward Insert (->) Cascade Resolver
 *
 * The Forward Insert operator (->):
 * - Generates NEW target entities
 * - Links TO them (from=source, to=target)
 * - Persists both entity and relationship to SQLite
 *
 * @see dotdo-j2t7u - [RED] Forward Insert (->) operator tests with real SQLite
 * @see dotdo-tulto - [GREEN] Implement Forward Insert (->) resolver
 *
 * Schema example:
 * ```typescript
 * const schema = DB({
 *   Startup: {
 *     businessModel: '->LeanCanvas',     // Forward insert single
 *     founders: ['->Founder'],           // Forward insert array
 *   },
 * })
 * ```
 */

import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { eq } from 'drizzle-orm'
import type { RelationshipsStore, GraphRelationship } from '../../graph/relationships'
import type { graphThings, GraphThing } from '../../graph/things'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Entity with standard $id and $type fields.
 */
export interface Entity {
  $id: string
  $type: string
  [key: string]: unknown
}

/**
 * Context passed to the generation function.
 */
export interface GenerationContext {
  /** The parent/source entity that triggered this generation */
  parentEntity: Entity
  /** Previously generated entities in this cascade session */
  previousGenerations?: Entity[]
  /** For array generation: previously generated items in this array */
  previousInArray?: Entity[]
}

/**
 * Options passed to the generation function.
 */
export interface GenerateOptions {
  /** Target entity type to generate */
  type: string
  /** Generation prompt/instruction */
  prompt: string
  /** Generation context including parent entity */
  context: GenerationContext
}

/**
 * Options for configuring ForwardInsertResolver.
 */
export interface ForwardInsertOptions {
  /** Drizzle database instance */
  db: BetterSQLite3Database
  /** Relationships store for edge persistence */
  relationshipsStore: RelationshipsStore
  /** Things table reference */
  thingsTable: typeof graphThings
  /** Entity generation function */
  generate: (opts: GenerateOptions) => Promise<Entity>
  /** Custom verb mapping (fieldName -> verb) */
  verbMapping?: Record<string, string>
  /** Whether to include cascade metadata in relationship data */
  includeMetadata?: boolean
}

/**
 * Input for single entity resolution.
 */
export interface ResolveForwardInsertInput {
  /** ID of the source entity */
  sourceId: string
  /** Field name in schema (becomes relationship verb) */
  fieldName: string
  /** Target entity type to generate */
  targetType: string
  /** Generation prompt */
  prompt: string
  /** Whether this field is optional */
  optional?: boolean
}

/**
 * Input for array entity resolution.
 */
export interface ResolveForwardInsertArrayInput extends ResolveForwardInsertInput {
  /** Number of entities to generate */
  count: number
}

/**
 * Result from resolve operation.
 */
export interface ResolveForwardInsertResult {
  /** The generated entity */
  entity: Entity
  /** The created relationship */
  relationship: GraphRelationship
}

// ============================================================================
// FORWARD INSERT RESOLVER
// ============================================================================

/**
 * ForwardInsertResolver handles the -> cascade operator.
 *
 * It generates NEW target entities and creates relationships TO them.
 *
 * Direction: from=source, to=target
 *
 * Features:
 * - Generates entities via provided generate function
 * - Persists entities to graph_things table
 * - Creates relationships in relationships table
 * - Supports single and array resolution
 * - Context propagation for array generation
 * - Custom verb mapping
 * - Optional metadata in relationships
 *
 * @example
 * ```typescript
 * const resolver = new ForwardInsertResolver({
 *   db,
 *   relationshipsStore,
 *   thingsTable: graphThings,
 *   generate: async (opts) => ({
 *     $id: `${opts.type.toLowerCase()}-${Date.now()}`,
 *     $type: opts.type,
 *     ...aiGenerate(opts.prompt),
 *   }),
 * })
 *
 * const result = await resolver.resolve({
 *   sourceId: 'startup-001',
 *   fieldName: 'businessModel',
 *   targetType: 'LeanCanvas',
 *   prompt: 'Generate lean canvas',
 * })
 * ```
 */
export class ForwardInsertResolver {
  private db: BetterSQLite3Database
  private relationshipsStore: RelationshipsStore
  private thingsTable: typeof graphThings
  private generateFn: (opts: GenerateOptions) => Promise<Entity>
  private verbMapping: Record<string, string>
  private includeMetadata: boolean

  constructor(options: ForwardInsertOptions) {
    this.db = options.db
    this.relationshipsStore = options.relationshipsStore
    this.thingsTable = options.thingsTable
    this.generateFn = options.generate
    this.verbMapping = options.verbMapping ?? {}
    this.includeMetadata = options.includeMetadata ?? false
  }

  /**
   * Resolve a single forward insert reference.
   *
   * Implementation:
   * 1. Load source entity from database
   * 2. Generate new target entity via generate function
   * 3. Persist generated entity to things table
   * 4. Create relationship (from=source, to=generated)
   * 5. Return generated entity and relationship
   */
  async resolve(input: ResolveForwardInsertInput): Promise<ResolveForwardInsertResult | null> {
    // 1. Load source entity from database
    const sourceRows = this.db
      .select()
      .from(this.thingsTable)
      .where(eq(this.thingsTable.id, input.sourceId))
      .all()

    if (sourceRows.length === 0) {
      throw new Error(`Source entity not found: ${input.sourceId}`)
    }

    const sourceRow = sourceRows[0]
    const parentEntity: Entity = {
      $id: sourceRow.id,
      $type: sourceRow.typeName,
      ...(sourceRow.data as Record<string, unknown> || {}),
    }

    // 2. Generate new target entity via generate function
    let generatedEntity: Entity
    try {
      generatedEntity = await this.generateFn({
        type: input.targetType,
        prompt: input.prompt,
        context: {
          parentEntity,
          previousGenerations: [],
          previousInArray: [],
        },
      })
    } catch (error) {
      // For optional fields, return null on generation failure
      if (input.optional) {
        return null
      }
      throw error
    }

    // If generation returned null for optional field
    if (generatedEntity === null && input.optional) {
      return null
    }

    // Always generate a unique ID to ensure consistency and uniqueness
    // The generate function may provide an ID but we override it for reliability
    generatedEntity.$id = this.generateEntityId(input.targetType)

    // Ensure $type is set
    generatedEntity.$type = input.targetType

    // 3. Persist generated entity to things table
    const now = Date.now()
    const entityData = { ...generatedEntity }
    delete entityData.$id
    delete entityData.$type

    this.db
      .insert(this.thingsTable)
      .values({
        id: generatedEntity.$id,
        typeId: 1, // Default typeId
        typeName: generatedEntity.$type,
        data: entityData,
        createdAt: now,
        updatedAt: now,
      })
      .run()

    // 4. Create relationship (from=source, to=generated)
    const verb = this.getVerb(input.fieldName)
    const relationshipId = `rel-${crypto.randomUUID().split('-')[0]}`
    const metadata = this.buildMetadata()

    const relationship = await this.relationshipsStore.create({
      id: relationshipId,
      verb,
      from: input.sourceId,
      to: generatedEntity.$id,
      data: metadata ?? undefined,
    })

    // 5. Return generated entity and relationship
    return {
      entity: generatedEntity,
      relationship,
    }
  }

  /**
   * Resolve an array of forward insert references.
   *
   * Implementation:
   * 1. Load source entity from database
   * 2. For each item in count:
   *    a. Generate new target entity (with previous items in context)
   *    b. Persist generated entity
   *    c. Create relationship
   * 3. Return all generated entities and relationships
   */
  async resolveArray(input: ResolveForwardInsertArrayInput): Promise<ResolveForwardInsertResult[]> {
    // 1. Load source entity from database
    const sourceRows = this.db
      .select()
      .from(this.thingsTable)
      .where(eq(this.thingsTable.id, input.sourceId))
      .all()

    if (sourceRows.length === 0) {
      throw new Error(`Source entity not found: ${input.sourceId}`)
    }

    const sourceRow = sourceRows[0]
    const parentEntity: Entity = {
      $id: sourceRow.id,
      $type: sourceRow.typeName,
      ...(sourceRow.data as Record<string, unknown> || {}),
    }

    const results: ResolveForwardInsertResult[] = []
    const generatedEntities: Entity[] = []

    // 2. For each item in count
    for (let i = 0; i < input.count; i++) {
      // a. Generate new target entity (with previous items in context)
      let generatedEntity: Entity
      try {
        generatedEntity = await this.generateFn({
          type: input.targetType,
          prompt: input.prompt,
          context: {
            parentEntity,
            previousGenerations: [],
            previousInArray: [...generatedEntities], // Pass previously generated items
          },
        })
      } catch (error) {
        // For optional fields, skip this item on generation failure
        if (input.optional) {
          continue
        }
        throw error
      }

      // If generation returned null for optional field
      if (generatedEntity === null && input.optional) {
        continue
      }

      // Always generate a unique ID to ensure consistency and uniqueness
      generatedEntity.$id = this.generateEntityId(input.targetType)

      // Ensure $type is set
      generatedEntity.$type = input.targetType

      // b. Persist generated entity to things table
      const now = Date.now()
      const entityData = { ...generatedEntity }
      delete entityData.$id
      delete entityData.$type

      this.db
        .insert(this.thingsTable)
        .values({
          id: generatedEntity.$id,
          typeId: 1, // Default typeId
          typeName: generatedEntity.$type,
          data: entityData,
          createdAt: now,
          updatedAt: now,
        })
        .run()

      // c. Create relationship (from=source, to=generated)
      const verb = this.getVerb(input.fieldName)
      const relationshipId = `rel-${crypto.randomUUID().split('-')[0]}`
      const metadata = this.buildMetadata()

      const relationship = await this.relationshipsStore.create({
        id: relationshipId,
        verb,
        from: input.sourceId,
        to: generatedEntity.$id,
        data: metadata ?? undefined,
      })

      // Track generated entity for context propagation
      generatedEntities.push(generatedEntity)

      results.push({
        entity: generatedEntity,
        relationship,
      })
    }

    // 3. Return all generated entities and relationships
    return results
  }

  /**
   * Get the verb for a relationship, applying custom mapping if defined.
   */
  protected getVerb(fieldName: string): string {
    return this.verbMapping[fieldName] ?? fieldName
  }

  /**
   * Generate unique entity ID in format: type-randomid
   */
  protected generateEntityId(type: string): string {
    const randomPart = crypto.randomUUID().split('-')[0]
    return `${type.toLowerCase()}-${randomPart}`
  }

  /**
   * Build cascade metadata for relationship data field.
   */
  protected buildMetadata(): Record<string, unknown> | null {
    if (!this.includeMetadata) return null
    return {
      cascadeOperator: '->',
      generatedAt: Date.now(),
    }
  }
}
