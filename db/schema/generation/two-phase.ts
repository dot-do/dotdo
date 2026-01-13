/**
 * Two-Phase Generation System
 *
 * Implements a draft->resolve generation pattern where:
 * 1. Draft Phase: AI generates entities with human-readable labels for references
 * 2. Resolve Phase: Labels are converted to $refs via embedding search
 *
 * This allows AI to generate natural, context-aware references without needing
 * to know entity IDs upfront, making generation more natural and accurate.
 *
 * @module db/schema/generation/two-phase
 */

import { generateEntityId, generateRelationshipId } from '../resolvers/shared'
import type { Relationship } from '../resolvers/shared'

// ============================================================================
// INTERFACES
// ============================================================================

/**
 * Draft entity with label placeholders for references.
 * Labels are human-readable strings that will be resolved to entity IDs.
 */
export interface DraftEntity {
  $id: string
  $type: string
  /** Field name to label mapping for reference fields */
  $labels: Record<string, string | string[]>
  /** Entity data with primitive values */
  data: Record<string, unknown>
}

/**
 * Resolved entity with all labels converted to $refs.
 */
export interface ResolvedEntity {
  $id: string
  $type: string
  data: Record<string, unknown | EntityRef | EntityRef[]>
}

/**
 * Reference to another entity.
 */
export interface EntityRef {
  $ref: string
}

/**
 * Result of label resolution.
 */
export interface LabelResolutionResult {
  label: string
  resolvedId: string | null
  similarity: number
  created: boolean
}

/**
 * Batch resolution result.
 */
export interface BatchResolutionResult {
  resolvedEntities: ResolvedEntity[]
  createdEntities: ResolvedEntity[]
  relationships: Relationship[]
  resolutions: LabelResolutionResult[]
  stats: {
    totalLabels: number
    resolved: number
    created: number
    failed: number
  }
}

/**
 * Entity store for looking up entities by type and content.
 */
export interface EntityStore {
  /** Get all entities of a given type */
  getByType(type: string): Promise<Array<{ $id: string; $type: string; [key: string]: unknown }>>
  /** Add a new entity to the store */
  add(entity: { $id: string; $type: string; [key: string]: unknown }): Promise<void>
}

/**
 * Embedding provider for semantic search.
 */
export interface EmbeddingProvider {
  /** Generate embedding for a text string */
  embed(text: string): Promise<number[]>
  /** Generate embeddings for multiple texts in a batch */
  embedBatch(texts: string[]): Promise<number[][]>
  /** Compute similarity between two embeddings */
  similarity(a: number[], b: number[]): number
}

/**
 * Options for draft generation.
 */
export interface DraftGeneratorOptions {
  /** Function to generate entity IDs */
  generateId?: (type: string) => string
  /** Schema for type definitions */
  schema?: Record<string, TypeDefinition>
}

/**
 * Type definition for schema.
 */
export interface TypeDefinition {
  fields: Record<string, FieldDefinition>
}

/**
 * Field definition with reference info.
 */
export interface FieldDefinition {
  type: string
  isReference?: boolean
  referenceType?: string
  isArray?: boolean
  prompt?: string
}

/**
 * Options for label resolution.
 */
export interface LabelResolverOptions {
  /** Minimum similarity threshold for matching (0-1) */
  threshold?: number
  /** Entity store for lookups */
  store: EntityStore
  /** Embedding provider for semantic search */
  embeddings: EmbeddingProvider
  /** Whether to create entities when no match is found */
  createOnMiss?: boolean
  /** Function to generate entity IDs */
  generateId?: (type: string) => string
}

/**
 * Options for batch resolution.
 */
export interface BatchResolverOptions extends LabelResolverOptions {
  /** Maximum concurrent embedding operations */
  concurrency?: number
}

// ============================================================================
// DRAFT GENERATOR
// ============================================================================

/**
 * DraftGenerator creates draft entities with label placeholders.
 *
 * Instead of requiring exact entity IDs for references, the generator
 * accepts human-readable labels that describe the referenced entity.
 *
 * @example
 * ```typescript
 * const generator = new DraftGenerator()
 *
 * const draft = generator.createDraft('Project', {
 *   name: 'E-commerce Platform',
 *   owner: { $label: 'John Smith from Engineering' },
 *   tags: [{ $label: 'web' }, { $label: 'commerce' }]
 * })
 *
 * // Result:
 * // {
 * //   $id: 'project-abc123',
 * //   $type: 'Project',
 * //   $labels: {
 * //     owner: 'John Smith from Engineering',
 * //     tags: ['web', 'commerce']
 * //   },
 * //   data: { name: 'E-commerce Platform' }
 * // }
 * ```
 */
export class DraftGenerator {
  private options: DraftGeneratorOptions
  private generateId: (type: string) => string

  constructor(options: DraftGeneratorOptions = {}) {
    this.options = options
    this.generateId = options.generateId ?? generateEntityId
  }

  /**
   * Create a draft entity from raw data.
   *
   * @param type - Entity type name
   * @param rawData - Raw data that may contain $label placeholders
   * @param existingId - Optional existing ID to preserve
   * @returns DraftEntity with extracted labels
   */
  createDraft(
    type: string,
    rawData: Record<string, unknown>,
    existingId?: string
  ): DraftEntity {
    const labels: Record<string, string | string[]> = {}
    const data: Record<string, unknown> = {}

    for (const [key, value] of Object.entries(rawData)) {
      // Skip system fields
      if (key.startsWith('$')) continue

      const extracted = this.extractLabels(value)
      if (extracted.hasLabels) {
        labels[key] = extracted.labels
        // Don't include labeled references in data - they'll be resolved
      } else {
        data[key] = value
      }
    }

    return {
      $id: existingId ?? this.generateId(type),
      $type: type,
      $labels: labels,
      data,
    }
  }

  /**
   * Create multiple draft entities.
   *
   * @param drafts - Array of type and data pairs
   * @returns Array of draft entities
   */
  createDrafts(drafts: Array<{ type: string; data: Record<string, unknown>; id?: string }>): DraftEntity[] {
    return drafts.map(({ type, data, id }) => this.createDraft(type, data, id))
  }

  /**
   * Extract labels from a value, handling nested $label objects and arrays.
   */
  private extractLabels(value: unknown): { hasLabels: boolean; labels: string | string[] } {
    // Single $label object
    if (this.isLabelObject(value)) {
      return { hasLabels: true, labels: (value as { $label: string }).$label }
    }

    // Array of $label objects
    if (Array.isArray(value)) {
      const labels: string[] = []
      let hasLabels = false

      for (const item of value) {
        if (this.isLabelObject(item)) {
          labels.push((item as { $label: string }).$label)
          hasLabels = true
        }
      }

      if (hasLabels) {
        return { hasLabels: true, labels }
      }
    }

    return { hasLabels: false, labels: '' }
  }

  /**
   * Check if a value is a $label object.
   */
  private isLabelObject(value: unknown): boolean {
    return (
      typeof value === 'object' &&
      value !== null &&
      '$label' in value &&
      typeof (value as { $label: unknown }).$label === 'string'
    )
  }

  /**
   * Parse AI-generated content that may contain natural language references.
   * Converts patterns like "assigned to [John Smith]" into $label format.
   *
   * @param type - Entity type
   * @param content - AI-generated content
   * @param schema - Optional schema for field type info
   * @returns DraftEntity with extracted labels
   */
  parseAIContent(
    type: string,
    content: Record<string, unknown>,
    schema?: TypeDefinition
  ): DraftEntity {
    const processed: Record<string, unknown> = {}

    for (const [key, value] of Object.entries(content)) {
      if (key.startsWith('$')) continue

      // Check if field is a reference type in schema
      const fieldDef = schema?.fields[key]

      if (fieldDef?.isReference) {
        // Convert to $label format
        if (Array.isArray(value)) {
          processed[key] = value.map((v) => ({
            $label: typeof v === 'string' ? v : String(v),
          }))
        } else if (value !== null && value !== undefined) {
          processed[key] = { $label: typeof value === 'string' ? value : String(value) }
        }
      } else if (typeof value === 'string') {
        // Check for bracket notation [Reference Name]
        const bracketMatch = value.match(/\[([^\]]+)\]/)
        if (bracketMatch) {
          processed[key] = { $label: bracketMatch[1] }
        } else {
          processed[key] = value
        }
      } else {
        processed[key] = value
      }
    }

    return this.createDraft(type, processed)
  }
}

// ============================================================================
// LABEL RESOLVER
// ============================================================================

/**
 * LabelResolver converts human-readable labels to entity $refs.
 *
 * Uses embedding-based semantic search to find matching entities,
 * with configurable similarity thresholds and miss handling.
 *
 * @example
 * ```typescript
 * const resolver = new LabelResolver({
 *   threshold: 0.8,
 *   store: myEntityStore,
 *   embeddings: myEmbeddingProvider,
 *   createOnMiss: true
 * })
 *
 * const result = await resolver.resolveLabel('User', 'John Smith from Engineering')
 * // { resolvedId: 'user-123', similarity: 0.92, created: false }
 * ```
 */
export class LabelResolver {
  private threshold: number
  private store: EntityStore
  private embeddings: EmbeddingProvider
  private createOnMiss: boolean
  private generateId: (type: string) => string

  constructor(options: LabelResolverOptions) {
    this.threshold = options.threshold ?? 0.8
    this.store = options.store
    this.embeddings = options.embeddings
    this.createOnMiss = options.createOnMiss ?? false
    this.generateId = options.generateId ?? generateEntityId
  }

  /**
   * Resolve a single label to an entity ID.
   *
   * @param targetType - Type of entity to search for
   * @param label - Human-readable label to match
   * @returns Resolution result with entity ID and metadata
   */
  async resolveLabel(targetType: string, label: string): Promise<LabelResolutionResult> {
    // Get all entities of the target type
    const candidates = await this.store.getByType(targetType)

    if (candidates.length === 0) {
      // No candidates - create if allowed
      if (this.createOnMiss) {
        const newEntity = await this.createEntityFromLabel(targetType, label)
        return {
          label,
          resolvedId: newEntity.$id,
          similarity: 1.0,
          created: true,
        }
      }
      return { label, resolvedId: null, similarity: 0, created: false }
    }

    // Generate embedding for the label
    const labelEmbedding = await this.embeddings.embed(label)

    // Generate embeddings for candidates and find best match
    const candidateTexts = candidates.map((c) => this.entityToSearchText(c))
    const candidateEmbeddings = await this.embeddings.embedBatch(candidateTexts)

    let bestMatch: { entity: (typeof candidates)[0]; similarity: number } | null = null

    for (let i = 0; i < candidates.length; i++) {
      const similarity = this.embeddings.similarity(labelEmbedding, candidateEmbeddings[i]!)
      if (!bestMatch || similarity > bestMatch.similarity) {
        bestMatch = { entity: candidates[i]!, similarity }
      }
    }

    // Check threshold
    if (bestMatch && bestMatch.similarity >= this.threshold) {
      return {
        label,
        resolvedId: bestMatch.entity.$id,
        similarity: bestMatch.similarity,
        created: false,
      }
    }

    // Below threshold - create if allowed
    if (this.createOnMiss) {
      const newEntity = await this.createEntityFromLabel(targetType, label)
      return {
        label,
        resolvedId: newEntity.$id,
        similarity: 1.0,
        created: true,
      }
    }

    return {
      label,
      resolvedId: bestMatch?.entity.$id ?? null,
      similarity: bestMatch?.similarity ?? 0,
      created: false,
    }
  }

  /**
   * Resolve a draft entity's labels to create a resolved entity.
   *
   * @param draft - Draft entity with labels
   * @param typeMapping - Maps field names to target entity types
   * @returns Resolved entity and resolution metadata
   */
  async resolveDraft(
    draft: DraftEntity,
    typeMapping: Record<string, string>
  ): Promise<{ entity: ResolvedEntity; resolutions: LabelResolutionResult[] }> {
    const resolutions: LabelResolutionResult[] = []
    const resolvedData: Record<string, unknown> = { ...draft.data }

    for (const [field, labelOrLabels] of Object.entries(draft.$labels)) {
      const targetType = typeMapping[field]
      if (!targetType) continue

      if (Array.isArray(labelOrLabels)) {
        // Resolve array of labels
        const refs: EntityRef[] = []
        for (const label of labelOrLabels) {
          const result = await this.resolveLabel(targetType, label)
          resolutions.push(result)
          if (result.resolvedId) {
            refs.push({ $ref: result.resolvedId })
          }
        }
        resolvedData[field] = refs
      } else {
        // Resolve single label
        const result = await this.resolveLabel(targetType, labelOrLabels)
        resolutions.push(result)
        if (result.resolvedId) {
          resolvedData[field] = { $ref: result.resolvedId }
        }
      }
    }

    return {
      entity: {
        $id: draft.$id,
        $type: draft.$type,
        data: resolvedData,
      },
      resolutions,
    }
  }

  /**
   * Convert an entity to searchable text for embedding.
   */
  private entityToSearchText(entity: Record<string, unknown>): string {
    const parts: string[] = []

    for (const [key, value] of Object.entries(entity)) {
      if (key.startsWith('$')) continue
      if (typeof value === 'string') {
        parts.push(value)
      } else if (typeof value === 'number' || typeof value === 'boolean') {
        parts.push(String(value))
      }
    }

    return parts.join(' ')
  }

  /**
   * Create a new entity from a label when no match is found.
   */
  private async createEntityFromLabel(
    type: string,
    label: string
  ): Promise<{ $id: string; $type: string; name: string }> {
    const entity = {
      $id: this.generateId(type),
      $type: type,
      name: label,
    }

    await this.store.add(entity)
    return entity
  }
}

// ============================================================================
// BATCH RESOLVER
// ============================================================================

/**
 * BatchResolver efficiently resolves labels across multiple draft entities.
 *
 * Optimizes by:
 * 1. Collecting all unique labels from all drafts
 * 2. Embedding all labels in a single batch
 * 3. Embedding all candidate entities once
 * 4. Computing similarity matrix
 * 5. Applying assignments in bulk
 *
 * @example
 * ```typescript
 * const resolver = new BatchResolver({
 *   threshold: 0.8,
 *   store: myEntityStore,
 *   embeddings: myEmbeddingProvider,
 *   createOnMiss: true
 * })
 *
 * const drafts = [
 *   { $id: 'p1', $type: 'Project', $labels: { owner: 'John' }, data: { name: 'P1' } },
 *   { $id: 'p2', $type: 'Project', $labels: { owner: 'Jane' }, data: { name: 'P2' } }
 * ]
 *
 * const result = await resolver.resolveBatch(drafts, { owner: 'User' })
 * ```
 */
export class BatchResolver {
  private options: BatchResolverOptions
  private threshold: number
  private store: EntityStore
  private embeddings: EmbeddingProvider
  private createOnMiss: boolean
  private generateId: (type: string) => string

  constructor(options: BatchResolverOptions) {
    this.options = options
    this.threshold = options.threshold ?? 0.8
    this.store = options.store
    this.embeddings = options.embeddings
    this.createOnMiss = options.createOnMiss ?? false
    this.generateId = options.generateId ?? generateEntityId
  }

  /**
   * Resolve all labels in a batch of draft entities.
   *
   * @param drafts - Array of draft entities
   * @param typeMapping - Maps field names to target entity types
   * @returns Batch resolution result with all entities and relationships
   */
  async resolveBatch(
    drafts: DraftEntity[],
    typeMapping: Record<string, string>
  ): Promise<BatchResolutionResult> {
    // Step 1: Collect all unique labels by target type
    const labelsByType = new Map<string, Set<string>>()

    for (const draft of drafts) {
      for (const [field, labelOrLabels] of Object.entries(draft.$labels)) {
        const targetType = typeMapping[field]
        if (!targetType) continue

        if (!labelsByType.has(targetType)) {
          labelsByType.set(targetType, new Set())
        }

        const labels = Array.isArray(labelOrLabels) ? labelOrLabels : [labelOrLabels]
        for (const label of labels) {
          labelsByType.get(targetType)!.add(label)
        }
      }
    }

    // Step 2: For each type, embed all labels and candidates in batches
    const labelResolutions = new Map<string, Map<string, LabelResolutionResult>>()
    const createdEntities: ResolvedEntity[] = []
    const allResolutions: LabelResolutionResult[] = []

    for (const [targetType, labels] of labelsByType) {
      const labelsArray = Array.from(labels)
      const typeResolutions = new Map<string, LabelResolutionResult>()

      // Get candidates
      const candidates = await this.store.getByType(targetType)

      if (candidates.length === 0 && labelsArray.length > 0) {
        // No candidates - create all if allowed
        for (const label of labelsArray) {
          let result: LabelResolutionResult

          if (this.createOnMiss) {
            const newEntity = await this.createEntityFromLabel(targetType, label)
            createdEntities.push(newEntity)
            result = { label, resolvedId: newEntity.$id, similarity: 1.0, created: true }
          } else {
            result = { label, resolvedId: null, similarity: 0, created: false }
          }

          typeResolutions.set(label, result)
          allResolutions.push(result)
        }
      } else if (labelsArray.length > 0) {
        // Batch embed labels and candidates
        const labelEmbeddings = await this.embeddings.embedBatch(labelsArray)
        const candidateTexts = candidates.map((c) => this.entityToSearchText(c))
        const candidateEmbeddings = await this.embeddings.embedBatch(candidateTexts)

        // Compute similarity and assign
        for (let i = 0; i < labelsArray.length; i++) {
          const label = labelsArray[i]!
          const labelEmbed = labelEmbeddings[i]!

          let bestMatch: { entity: (typeof candidates)[0]; similarity: number } | null = null

          for (let j = 0; j < candidates.length; j++) {
            const similarity = this.embeddings.similarity(labelEmbed, candidateEmbeddings[j]!)
            if (!bestMatch || similarity > bestMatch.similarity) {
              bestMatch = { entity: candidates[j]!, similarity }
            }
          }

          let result: LabelResolutionResult

          if (bestMatch && bestMatch.similarity >= this.threshold) {
            result = {
              label,
              resolvedId: bestMatch.entity.$id,
              similarity: bestMatch.similarity,
              created: false,
            }
          } else if (this.createOnMiss) {
            const newEntity = await this.createEntityFromLabel(targetType, label)
            createdEntities.push(newEntity)
            result = { label, resolvedId: newEntity.$id, similarity: 1.0, created: true }
          } else {
            result = {
              label,
              resolvedId: bestMatch?.entity.$id ?? null,
              similarity: bestMatch?.similarity ?? 0,
              created: false,
            }
          }

          typeResolutions.set(label, result)
          allResolutions.push(result)
        }
      }

      labelResolutions.set(targetType, typeResolutions)
    }

    // Step 3: Apply resolutions to drafts
    const resolvedEntities: ResolvedEntity[] = []
    const relationships: Relationship[] = []

    for (const draft of drafts) {
      const resolvedData: Record<string, unknown> = { ...draft.data }

      for (const [field, labelOrLabels] of Object.entries(draft.$labels)) {
        const targetType = typeMapping[field]
        if (!targetType) continue

        const typeRes = labelResolutions.get(targetType)
        if (!typeRes) continue

        if (Array.isArray(labelOrLabels)) {
          const refs: EntityRef[] = []
          for (const label of labelOrLabels) {
            const result = typeRes.get(label)
            if (result?.resolvedId) {
              refs.push({ $ref: result.resolvedId })
              // Create relationship
              relationships.push({
                id: generateRelationshipId(),
                from: draft.$id,
                to: result.resolvedId,
                verb: field,
                data: { resolution: result.created ? 'created' : 'found' },
                createdAt: new Date(),
              })
            }
          }
          resolvedData[field] = refs
        } else {
          const result = typeRes.get(labelOrLabels)
          if (result?.resolvedId) {
            resolvedData[field] = { $ref: result.resolvedId }
            // Create relationship
            relationships.push({
              id: generateRelationshipId(),
              from: draft.$id,
              to: result.resolvedId,
              verb: field,
              data: { resolution: result.created ? 'created' : 'found' },
              createdAt: new Date(),
            })
          }
        }
      }

      resolvedEntities.push({
        $id: draft.$id,
        $type: draft.$type,
        data: resolvedData,
      })
    }

    // Compute stats
    const stats = {
      totalLabels: allResolutions.length,
      resolved: allResolutions.filter((r) => r.resolvedId && !r.created).length,
      created: allResolutions.filter((r) => r.created).length,
      failed: allResolutions.filter((r) => !r.resolvedId).length,
    }

    return {
      resolvedEntities,
      createdEntities,
      relationships,
      resolutions: allResolutions,
      stats,
    }
  }

  /**
   * Convert an entity to searchable text for embedding.
   */
  private entityToSearchText(entity: Record<string, unknown>): string {
    const parts: string[] = []

    for (const [key, value] of Object.entries(entity)) {
      if (key.startsWith('$')) continue
      if (typeof value === 'string') {
        parts.push(value)
      } else if (typeof value === 'number' || typeof value === 'boolean') {
        parts.push(String(value))
      }
    }

    return parts.join(' ')
  }

  /**
   * Create a new entity from a label when no match is found.
   */
  private async createEntityFromLabel(
    type: string,
    label: string
  ): Promise<ResolvedEntity> {
    const entity = {
      $id: this.generateId(type),
      $type: type,
      data: { name: label },
    }

    await this.store.add({
      $id: entity.$id,
      $type: entity.$type,
      name: label,
    })

    return entity
  }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Simple cosine similarity implementation for embeddings.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error('Vectors must have same length')
  }

  let dotProduct = 0
  let normA = 0
  let normB = 0

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i]! * b[i]!
    normA += a[i]! * a[i]!
    normB += b[i]! * b[i]!
  }

  if (normA === 0 || normB === 0) return 0
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB))
}

/**
 * Create a simple in-memory entity store.
 */
export function createMemoryStore(): EntityStore {
  const entities = new Map<string, Map<string, Record<string, unknown>>>()

  return {
    async getByType(type: string) {
      const typeEntities = entities.get(type)
      if (!typeEntities) return []
      return Array.from(typeEntities.values()) as Array<{
        $id: string
        $type: string
        [key: string]: unknown
      }>
    },

    async add(entity) {
      if (!entities.has(entity.$type)) {
        entities.set(entity.$type, new Map())
      }
      entities.get(entity.$type)!.set(entity.$id, entity)
    },
  }
}

/**
 * Create a mock embedding provider for testing.
 * Uses simple string matching heuristics instead of real embeddings.
 */
export function createMockEmbeddingProvider(): EmbeddingProvider {
  const cache = new Map<string, number[]>()

  // Simple hash-based embedding for consistent results
  const hashEmbed = (text: string): number[] => {
    if (cache.has(text)) return cache.get(text)!

    const dims = 64
    const embedding = new Array(dims).fill(0)
    const normalized = text.toLowerCase().trim()

    // Create deterministic embedding based on character codes
    for (let i = 0; i < normalized.length; i++) {
      const charCode = normalized.charCodeAt(i)
      const idx = (charCode * (i + 1)) % dims
      embedding[idx] += Math.sin(charCode + i) * 0.5 + 0.5
    }

    // Add word-level features
    const words = normalized.split(/\s+/)
    for (let w = 0; w < words.length; w++) {
      const word = words[w]!
      for (let i = 0; i < word.length && i < 8; i++) {
        const idx = (word.charCodeAt(i) + w * 7) % dims
        embedding[idx] += 0.3
      }
    }

    // Normalize
    const norm = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0))
    if (norm > 0) {
      for (let i = 0; i < dims; i++) {
        embedding[i] /= norm
      }
    }

    cache.set(text, embedding)
    return embedding
  }

  return {
    async embed(text: string) {
      return hashEmbed(text)
    },

    async embedBatch(texts: string[]) {
      return texts.map(hashEmbed)
    },

    similarity: cosineSimilarity,
  }
}
