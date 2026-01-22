/**
 * Relation Operators for Entity Schema
 *
 * Provides CRUD operations for relations defined in IceType schema:
 *   -> Forward exact: auto-populate foreign key
 *   <- Backward: enable reverse lookups
 *   ~> Forward fuzzy: AI-matched semantic reference
 *   <~ Backward fuzzy: AI-matched backlink
 *
 * This module integrates with the relationships store from @dotdo/db
 * to persist and resolve entity relations.
 *
 * @module do/schema/relations
 */

import type {
  RelationshipsStore,
  ThingsStore,
  Thing,
  StorableData,
} from '@dotdo/db'
import type { EntitySchema, RelationDefinition } from './types'

// =============================================================================
// Types
// =============================================================================

/**
 * Configuration for the relations manager
 */
export interface RelationsConfig {
  /** Things store for entity lookups */
  things: ThingsStore
  /** Relationships store for relation persistence */
  relationships: RelationshipsStore
  /** Schema registry for relation definitions */
  schemas: Map<string, EntitySchema>
}

/**
 * Result of resolving a relation
 */
export interface ResolvedRelation<T extends StorableData = StorableData> {
  /** The resolved entity or entities */
  data: Thing<T> | Thing<T>[] | null
  /** Whether the relation is an array */
  isArray: boolean
  /** The relation definition used */
  relation: RelationDefinition
}

/**
 * Options for relation resolution
 */
export interface ResolveOptions {
  /** Depth limit for nested relation resolution (default: 1) */
  depth?: number
  /** Relations to expand on resolved entities */
  expand?: string[]
}

/**
 * Input for creating a relation
 */
export interface CreateRelationInput {
  /** Source entity type */
  sourceType: string
  /** Source entity ID */
  sourceId: string
  /** Relation field name on source entity */
  relationField: string
  /** Target entity ID */
  targetId: string
  /** Optional metadata for the relation */
  metadata?: Record<string, unknown>
}

/**
 * Input for deleting a relation
 */
export interface DeleteRelationInput {
  /** Source entity type */
  sourceType: string
  /** Source entity ID */
  sourceId: string
  /** Relation field name on source entity */
  relationField: string
  /** Target entity ID (optional - if not provided, all relations for this field are deleted) */
  targetId?: string
}

// =============================================================================
// Relations Manager Class
// =============================================================================

/**
 * Manages entity relations with CRUD operations.
 *
 * @example
 * ```ts
 * const manager = new RelationsManager({ things, relationships, schemas })
 *
 * // Create a relation
 * await manager.createRelation({
 *   sourceType: 'Order',
 *   sourceId: 'order-123',
 *   relationField: 'customer',
 *   targetId: 'customer-456'
 * })
 *
 * // Resolve a relation
 * const customer = await manager.resolveRelation('Order', 'order-123', 'customer')
 *
 * // Delete a relation
 * await manager.deleteRelation({
 *   sourceType: 'Order',
 *   sourceId: 'order-123',
 *   relationField: 'customer',
 *   targetId: 'customer-456'
 * })
 * ```
 */
export class RelationsManager {
  private things: ThingsStore
  private relationships: RelationshipsStore
  private schemas: Map<string, EntitySchema>

  constructor(config: RelationsConfig) {
    this.things = config.things
    this.relationships = config.relationships
    this.schemas = config.schemas
  }

  /**
   * Get the relation definition for a field on an entity type
   */
  private getRelationDefinition(
    entityType: string,
    relationField: string
  ): RelationDefinition | undefined {
    const schema = this.schemas.get(entityType)
    if (!schema) {
      return undefined
    }

    // Handle both Map and plain object (workers runtime may serialize Maps as plain objects)
    if (schema.relations instanceof Map) {
      return schema.relations.get(relationField)
    }

    return (schema.relations as Record<string, RelationDefinition>)?.[relationField]
  }

  /**
   * Generate a predicate string for a relation
   * Format: {entityType}.{relationField}
   */
  private getRelationPredicate(entityType: string, relationField: string): string {
    return `${entityType}.${relationField}`
  }

  /**
   * Create a relation between entities
   *
   * @param input - Relation creation input
   * @returns The created relationship record
   * @throws Error if the relation field is not defined in schema
   */
  async createRelation(input: CreateRelationInput): Promise<void> {
    const { sourceType, sourceId, relationField, targetId, metadata } = input

    const relationDef = this.getRelationDefinition(sourceType, relationField)
    if (!relationDef) {
      throw new Error(
        `Relation field "${relationField}" not defined on entity type "${sourceType}"`
      )
    }

    // For forward relations, store subject -> object
    // For backward relations, this is typically handled automatically
    if (relationDef.direction === 'forward') {
      const predicate = this.getRelationPredicate(sourceType, relationField)
      await this.relationships.add({
        subject: sourceId,
        predicate,
        object: targetId,
        ...metadata,
      })
    } else {
      // For backward relations, the relationship is stored from the other side
      // Store as: target (the source of the backward relation) -> source
      const predicate = this.getRelationPredicate(
        relationDef.targetType,
        relationDef.backref ?? relationField
      )
      await this.relationships.add({
        subject: targetId,
        predicate,
        object: sourceId,
        ...metadata,
      })
    }
  }

  /**
   * Resolve a relation to its target entity or entities
   *
   * @param sourceType - The source entity type
   * @param sourceId - The source entity ID
   * @param relationField - The relation field name
   * @param options - Resolution options
   * @returns The resolved relation data
   */
  async resolveRelation<T extends StorableData = StorableData>(
    sourceType: string,
    sourceId: string,
    relationField: string,
    options: ResolveOptions = {}
  ): Promise<ResolvedRelation<T> | null> {
    const relationDef = this.getRelationDefinition(sourceType, relationField)
    if (!relationDef) {
      return null
    }

    const { direction, targetType, backref, array } = relationDef
    const isArray = array ?? false

    if (direction === 'forward') {
      // Forward relation: look up the relationship to find target ID(s)
      const predicate = this.getRelationPredicate(sourceType, relationField)
      const relatedIds = await this.relationships.getRelated(sourceId, predicate)

      if (relatedIds.length === 0) {
        // No relationship in store - check if the foreign key is stored on the entity
        const sourceEntity = await this.things.get(sourceId)
        if (sourceEntity) {
          const foreignKeyField = `${relationField}Id`
          const foreignKey = (sourceEntity as Record<string, unknown>)[foreignKeyField] as string | undefined
            ?? (sourceEntity as Record<string, unknown>)[relationField] as string | undefined

          if (foreignKey && typeof foreignKey === 'string') {
            const targetEntity = await this.things.get(foreignKey)
            return {
              data: (targetEntity ?? null) as Thing<T> | null,
              isArray: false,
              relation: relationDef,
            }
          }
        }

        return {
          data: isArray ? [] : null,
          isArray,
          relation: relationDef,
        }
      }

      if (isArray) {
        const entities = await Promise.all(
          relatedIds.map((id) => this.things.get(id))
        )
        return {
          data: entities.filter((e): e is Thing<StorableData> => e !== null) as Thing<T>[],
          isArray: true,
          relation: relationDef,
        }
      } else {
        const entity = await this.things.get(relatedIds[0]!)
        return {
          data: (entity ?? null) as Thing<T> | null,
          isArray: false,
          relation: relationDef,
        }
      }
    } else {
      // Backward relation: find entities that point to this entity
      // Use the backref field to determine the predicate
      const searchField = backref ?? sourceType.toLowerCase()
      const predicate = this.getRelationPredicate(targetType, searchField)

      // Find relationships where this entity is the object
      const subjectIds = await this.relationships.getRelatedTo(sourceId, predicate)

      if (subjectIds.length === 0) {
        // No explicit relationships - do a query on the target type
        const allTargets = await this.things.list({ type: targetType })
        const matchingEntities = allTargets.filter((entity) => {
          const data = entity as Record<string, unknown>
          // Check both {backref} and {backref}Id fields
          return (
            data[searchField] === sourceId ||
            data[`${searchField}Id`] === sourceId
          )
        })

        return {
          data: (isArray ? matchingEntities : matchingEntities[0] ?? null) as Thing<T>[] | Thing<T> | null,
          isArray,
          relation: relationDef,
        }
      }

      if (isArray) {
        const entities = await Promise.all(
          subjectIds.map((id) => this.things.get(id))
        )
        return {
          data: entities.filter((e): e is Thing<StorableData> => e !== null) as Thing<T>[],
          isArray: true,
          relation: relationDef,
        }
      } else {
        const entity = await this.things.get(subjectIds[0]!)
        return {
          data: (entity ?? null) as Thing<T> | null,
          isArray: false,
          relation: relationDef,
        }
      }
    }
  }

  /**
   * Delete a relation between entities
   *
   * @param input - Relation deletion input
   * @throws Error if the relation field is not defined in schema
   */
  async deleteRelation(input: DeleteRelationInput): Promise<void> {
    const { sourceType, sourceId, relationField, targetId } = input

    const relationDef = this.getRelationDefinition(sourceType, relationField)
    if (!relationDef) {
      throw new Error(
        `Relation field "${relationField}" not defined on entity type "${sourceType}"`
      )
    }

    if (relationDef.direction === 'forward') {
      const predicate = this.getRelationPredicate(sourceType, relationField)

      if (targetId) {
        // Delete specific relation
        await this.relationships.remove({
          subject: sourceId,
          predicate,
          object: targetId,
        })
      } else {
        // Delete all relations for this field
        const relatedIds = await this.relationships.getRelated(sourceId, predicate)
        await Promise.all(
          relatedIds.map((id) =>
            this.relationships.remove({
              subject: sourceId,
              predicate,
              object: id,
            })
          )
        )
      }
    } else {
      // Backward relation
      const searchField = relationDef.backref ?? sourceType.toLowerCase()
      const predicate = this.getRelationPredicate(relationDef.targetType, searchField)

      if (targetId) {
        // Delete specific relation (stored from the target's perspective)
        await this.relationships.remove({
          subject: targetId,
          predicate,
          object: sourceId,
        })
      } else {
        // Delete all backward relations pointing to this entity
        const subjectIds = await this.relationships.getRelatedTo(sourceId, predicate)
        await Promise.all(
          subjectIds.map((id) =>
            this.relationships.remove({
              subject: id,
              predicate,
              object: sourceId,
            })
          )
        )
      }
    }
  }

  /**
   * Check if a relation exists between two entities
   */
  async hasRelation(
    sourceType: string,
    sourceId: string,
    relationField: string,
    targetId: string
  ): Promise<boolean> {
    const relationDef = this.getRelationDefinition(sourceType, relationField)
    if (!relationDef) {
      return false
    }

    if (relationDef.direction === 'forward') {
      const predicate = this.getRelationPredicate(sourceType, relationField)
      const relatedIds = await this.relationships.getRelated(sourceId, predicate)
      return relatedIds.includes(targetId)
    } else {
      const searchField = relationDef.backref ?? sourceType.toLowerCase()
      const predicate = this.getRelationPredicate(relationDef.targetType, searchField)
      const subjectIds = await this.relationships.getRelatedTo(sourceId, predicate)
      return subjectIds.includes(targetId)
    }
  }

  /**
   * Get all relations for an entity
   */
  async getAllRelations(
    entityType: string,
    entityId: string
  ): Promise<Map<string, ResolvedRelation>> {
    const schema = this.schemas.get(entityType)
    if (!schema) {
      return new Map()
    }

    const results = new Map<string, ResolvedRelation>()

    // Get relation field names
    const relationFields: string[] =
      schema.relations instanceof Map
        ? Array.from(schema.relations.keys())
        : Object.keys(schema.relations as Record<string, RelationDefinition>)

    for (const fieldName of relationFields) {
      const resolved = await this.resolveRelation(entityType, entityId, fieldName)
      if (resolved) {
        results.set(fieldName, resolved)
      }
    }

    return results
  }
}

// =============================================================================
// Standalone Functions
// =============================================================================

/**
 * Create a relation between entities
 *
 * Standalone function that delegates to RelationsManager.
 *
 * @param config - Relations configuration
 * @param sourceType - Source entity type
 * @param sourceId - Source entity ID
 * @param relationField - Relation field name
 * @param targetId - Target entity ID
 */
export async function createRelation(
  config: RelationsConfig,
  sourceType: string,
  sourceId: string,
  relationField: string,
  targetId: string
): Promise<void> {
  const manager = new RelationsManager(config)
  await manager.createRelation({
    sourceType,
    sourceId,
    relationField,
    targetId,
  })
}

/**
 * Resolve a relation to its target entity or entities
 *
 * Standalone function that delegates to RelationsManager.
 *
 * @param config - Relations configuration
 * @param sourceType - Source entity type
 * @param sourceId - Source entity ID
 * @param relationField - Relation field name
 * @param options - Resolution options
 * @returns The resolved relation data
 */
export async function resolveRelation<T extends StorableData = StorableData>(
  config: RelationsConfig,
  sourceType: string,
  sourceId: string,
  relationField: string,
  options?: ResolveOptions
): Promise<ResolvedRelation<T> | null> {
  const manager = new RelationsManager(config)
  return manager.resolveRelation<T>(sourceType, sourceId, relationField, options)
}

/**
 * Delete a relation between entities
 *
 * Standalone function that delegates to RelationsManager.
 *
 * @param config - Relations configuration
 * @param sourceType - Source entity type
 * @param sourceId - Source entity ID
 * @param relationField - Relation field name
 * @param targetId - Optional target ID (if not provided, all relations for this field are deleted)
 */
export async function deleteRelation(
  config: RelationsConfig,
  sourceType: string,
  sourceId: string,
  relationField: string,
  targetId?: string
): Promise<void> {
  const manager = new RelationsManager(config)
  await manager.deleteRelation({
    sourceType,
    sourceId,
    relationField,
    targetId,
  })
}

// =============================================================================
// Entity Integration Helpers
// =============================================================================

/**
 * Extract foreign keys from entity data based on relation definitions.
 *
 * When creating an entity with relation fields, this function extracts
 * the foreign key values that need to be stored.
 *
 * @param data - Entity data
 * @param entityType - Entity type name
 * @param schemas - Schema registry
 * @returns Map of relation field name to target ID
 */
export function extractForeignKeys(
  data: Record<string, unknown>,
  entityType: string,
  schemas: Map<string, EntitySchema>
): Map<string, string> {
  const foreignKeys = new Map<string, string>()
  const schema = schemas.get(entityType)

  if (!schema) {
    return foreignKeys
  }

  // Get relation definitions
  const relations: Map<string, RelationDefinition> =
    schema.relations instanceof Map
      ? schema.relations
      : new Map(Object.entries(schema.relations as Record<string, RelationDefinition>))

  for (const [fieldName, relationDef] of relations) {
    // Only process forward relations (which have foreign keys)
    if (relationDef.direction !== 'forward') {
      continue
    }

    const fieldValue = data[fieldName]

    // Extract ID from string value
    if (typeof fieldValue === 'string') {
      foreignKeys.set(fieldName, fieldValue)
    }
    // Extract ID from object with $id
    else if (fieldValue && typeof fieldValue === 'object' && '$id' in fieldValue) {
      const refId = (fieldValue as { $id: string }).$id
      if (typeof refId === 'string') {
        foreignKeys.set(fieldName, refId)
      }
    }
    // Check for {fieldName}Id convention
    const idFieldValue = data[`${fieldName}Id`]
    if (typeof idFieldValue === 'string') {
      foreignKeys.set(fieldName, idFieldValue)
    }
  }

  return foreignKeys
}

/**
 * Auto-create relations when an entity is created.
 *
 * This should be called after entity creation to persist the
 * forward relations in the relationships store.
 *
 * @param config - Relations configuration
 * @param entityType - Entity type name
 * @param entityId - Created entity ID
 * @param foreignKeys - Map of relation field name to target ID
 */
export async function autoCreateRelations(
  config: RelationsConfig,
  entityType: string,
  entityId: string,
  foreignKeys: Map<string, string>
): Promise<void> {
  const manager = new RelationsManager(config)

  for (const [fieldName, targetId] of foreignKeys) {
    try {
      await manager.createRelation({
        sourceType: entityType,
        sourceId: entityId,
        relationField: fieldName,
        targetId,
      })
    } catch (error) {
      // Relation may already exist, which is fine
      if (error instanceof Error && !error.message.includes('already exists')) {
        throw error
      }
    }
  }
}

/**
 * Expand relations on an entity by fetching related data.
 *
 * @param config - Relations configuration
 * @param entity - The entity to expand
 * @param entityType - Entity type name
 * @param relationFields - Array of relation field names to expand
 * @returns Entity with expanded relations
 */
export async function expandEntityRelations<T extends StorableData>(
  config: RelationsConfig,
  entity: Thing<T>,
  entityType: string,
  relationFields: string[]
): Promise<Thing<T>> {
  const manager = new RelationsManager(config)
  const expanded: Record<string, unknown> = { ...entity }

  for (const fieldName of relationFields) {
    const resolved = await manager.resolveRelation(entityType, entity.$id, fieldName)
    if (resolved) {
      expanded[fieldName] = resolved.data
    }
  }

  return expanded as Thing<T>
}
