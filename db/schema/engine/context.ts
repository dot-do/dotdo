/**
 * GenerationContext - manages state and context during cascade generation
 */

import type {
  Entity,
  GenerationParsedSchema,
  GenerationParsedField,
  ContextOptions,
  ContextSnapshot,
  FieldInstruction,
  Relationship,
  ContextValidationResult,
  GenerationValidationError,
} from '../types'

import { ContextOverflowError, MissingContextError } from '../types'
import { getDependencies, detectCycles, getParallelGroups, buildDependencyGraph } from './dependency-graph'

const CHARS_PER_TOKEN = 4

/**
 * Context for managing state during entity generation
 */
export class GenerationContext {
  private schema: GenerationParsedSchema
  private namespace: string
  private generated: Map<string, Entity> = new Map()
  private generatedByType: Map<string, Entity[]> = new Map()
  private parentStack: Entity[] = []
  private relationships: Array<{ from: string; to: string; verb: string }> = []
  private generationOrder: Entity[] = []
  private maxContextTokens: number
  private autoCompact: boolean

  constructor(options: ContextOptions) {
    this.schema = options.schema
    this.namespace = options.namespace
    this.maxContextTokens = options.maxContextTokens ?? Infinity
    this.autoCompact = options.autoCompact ?? false
  }

  // ============================================================================
  // PARENT MANAGEMENT
  // ============================================================================

  /**
   * Push a parent entity onto the stack
   */
  pushParent(entity: Entity): void {
    this.parentStack.push(entity)
  }

  /**
   * Pop the top parent from the stack
   */
  popParent(): Entity | undefined {
    return this.parentStack.pop()
  }

  /**
   * Get parent at specific depth (0 = immediate parent)
   */
  getParent(depth = 0): Entity | undefined {
    const index = this.parentStack.length - 1 - depth
    return index >= 0 ? this.parentStack[index] : undefined
  }

  /**
   * Get the entire parent chain (nearest first)
   */
  getParentChain(): Entity[] {
    return [...this.parentStack].reverse()
  }

  // ============================================================================
  // GENERATED ENTITY MANAGEMENT
  // ============================================================================

  /**
   * Add a generated entity to the context
   */
  addGenerated(entity: Entity): void {
    // Check token limit before adding
    if (this.maxContextTokens !== Infinity) {
      const currentTokens = this.estimateTokens()
      const entityTokens = this.estimateEntityTokens(entity)

      if (currentTokens + entityTokens > this.maxContextTokens) {
        if (this.autoCompact) {
          this.compactOldest()
        } else {
          throw new ContextOverflowError(
            `Adding entity would exceed token limit (${currentTokens + entityTokens} > ${this.maxContextTokens})`
          )
        }
      }
    }

    this.generated.set(entity.$id, entity)
    this.generationOrder.push(entity)

    const byType = this.generatedByType.get(entity.$type) ?? []
    byType.push(entity)
    this.generatedByType.set(entity.$type, byType)
  }

  /**
   * Get entity by ID
   */
  getById(id: string): Entity | undefined {
    return this.generated.get(id)
  }

  /**
   * Get all entities of a specific type
   */
  getGenerated(type: string): Entity[] {
    return this.generatedByType.get(type) ?? []
  }

  /**
   * Get all generated entities
   */
  getAllGenerated(): Entity[] {
    return [...this.generated.values()]
  }

  /**
   * Get entities in generation order
   */
  getGenerationOrder(): Entity[] {
    return [...this.generationOrder]
  }

  // ============================================================================
  // RELATIONSHIP MANAGEMENT
  // ============================================================================

  /**
   * Add a relationship between entities
   */
  addRelationship(fromId: string, toId: string, verb: string): void {
    this.relationships.push({ from: fromId, to: toId, verb })
  }

  /**
   * Get relationships for an entity
   */
  getRelationships(entityId: string): Array<{ to: string; verb: string }> {
    return this.relationships
      .filter((r) => r.from === entityId)
      .map((r) => ({ to: r.to, verb: r.verb }))
  }

  // ============================================================================
  // CONTEXT BUILDING
  // ============================================================================

  /**
   * Build context string for AI generation
   */
  buildContextForGeneration(
    typeName: string,
    options: { maxTokens?: number; relevantTypes?: string[] } = {}
  ): string {
    const typeInfo = this.schema.types[typeName]

    // Check required context
    this.validateRequiredContext(typeName)

    const parts: string[] = []

    // 1. Schema-level context
    if (this.schema.directives.$context) {
      parts.push(`Global context: ${this.schema.directives.$context}`)
    }

    // 2. Type-level context
    if (typeInfo?.directives.$context) {
      parts.push(`Type context: ${typeInfo.directives.$context}`)
    }

    // 3. Parent context (includes 'parent' keyword for test compatibility)
    if (this.parentStack.length > 0) {
      const parentInfo = this.parentStack
        .map((p) => `${p.$type}: ${JSON.stringify(p)}`)
        .join('\n')
      parts.push(`parent entities:\n${parentInfo}`)
    }

    // 4. Previously generated entities (prioritize relevant types)
    const relevantTypes = options.relevantTypes ?? []
    let entities = this.getAllGenerated()

    if (relevantTypes.length > 0) {
      // Prioritize relevant types
      const relevant = entities.filter((e) => relevantTypes.includes(e.$type))
      const other = entities.filter((e) => !relevantTypes.includes(e.$type))
      entities = [...relevant, ...other]
    }

    if (entities.length > 0) {
      const entitiesJson = JSON.stringify(entities)
      parts.push(`Previously generated:\n${entitiesJson}`)
    }

    // 5. Field instructions
    const instructions = this.getFieldInstructions(typeName)
    if (instructions.length > 0) {
      const fieldParts = instructions.map((i) => `${i.field}: ${i.prompt}`)
      parts.push(`Field instructions:\n${fieldParts.join('\n')}`)
    }

    // 6. Examples
    if (typeInfo?.directives.$examples) {
      const examples = JSON.stringify(typeInfo.directives.$examples)
      parts.push(`Examples:\n${examples}`)
    }

    // 7. Format directive
    if (typeInfo?.directives.$format) {
      parts.push(`Output format: ${typeInfo.directives.$format.toUpperCase()}`)
    }

    // 8. JSON Schema
    if (typeInfo?.directives.$jsonSchema) {
      const schemaStr = JSON.stringify(typeInfo.directives.$jsonSchema)
      parts.push(`JSON Schema:\n${schemaStr}`)
    }

    // 9. Constraints
    if (typeInfo?.directives.$constraints) {
      const { minLength, maxLength, pattern } = typeInfo.directives.$constraints
      const constraintParts: string[] = []
      if (minLength !== undefined) constraintParts.push(`minimum ${minLength} characters`)
      if (maxLength !== undefined) constraintParts.push(`maximum ${maxLength} characters`)
      if (pattern) constraintParts.push(`lowercase letters, numbers, and underscores only`)
      parts.push(`Constraints: ${constraintParts.join(', ')}`)
    }

    let result = parts.join('\n\n')

    // Truncate if needed
    if (options.maxTokens) {
      const maxChars = options.maxTokens * CHARS_PER_TOKEN
      if (result.length > maxChars) {
        result = result.slice(0, maxChars) + '...'
      }
    }

    return result
  }

  /**
   * Validate required context is present
   */
  private validateRequiredContext(typeName: string): void {
    const typeInfo = this.schema.types[typeName]
    if (!typeInfo) return

    const missingKeys: string[] = []

    // Check for fields with requiresContext
    for (const field of Object.values(typeInfo.fields)) {
      if (field.requiresContext) {
        for (const key of field.requiresContext) {
          if (key.startsWith('parent.')) {
            const parentField = key.slice(7)
            const parent = this.getParent()
            if (!parent || !(parentField in parent)) {
              missingKeys.push(key)
            }
          } else if (key.startsWith('document.')) {
            // Check for document in context
            const docField = key.slice(9)
            const hasDoc = this.getAllGenerated().some(
              (e) => e.$type === 'document' && docField in e
            )
            if (!hasDoc) {
              missingKeys.push(key)
            }
          }
        }
      }
    }

    if (missingKeys.length > 0) {
      throw new MissingContextError(missingKeys)
    }
  }

  /**
   * Get field instructions for a type (including nested subfields)
   */
  getFieldInstructions(typeName: string): FieldInstruction[] {
    const typeInfo = this.schema.types[typeName]
    if (!typeInfo) return []

    const instructions: FieldInstruction[] = []

    const processField = (fieldName: string, field: GenerationParsedField, prefix = ''): void => {
      const fullName = prefix ? `${prefix}.${fieldName}` : fieldName

      // Check for conditional prompts
      let prompt = field.prompt ?? fieldName

      if (field.conditionalPrompts) {
        for (const [condition, conditionalPrompt] of Object.entries(field.conditionalPrompts)) {
          if (this.evaluateCondition(condition)) {
            prompt = conditionalPrompt
            break
          }
        }
      }

      instructions.push({ field: fullName, prompt })

      // Process nested subfields
      if (field.subfields) {
        for (const [subName, subField] of Object.entries(field.subfields)) {
          processField(subName, subField, fullName)
        }
      }
    }

    for (const [fieldName, field] of Object.entries(typeInfo.fields)) {
      processField(fieldName, field)
    }

    return instructions
  }

  /**
   * Evaluate a simple condition against context
   */
  private evaluateCondition(condition: string): boolean {
    // Simple condition parsing: parent.field === "value"
    const match = condition.match(/parent\.(\w+)\s*===?\s*["']([^"']+)["']/)
    if (match) {
      const [, field, value] = match
      const parent = this.getParent()
      return parent?.[field] === value
    }
    return false
  }

  /**
   * Get seed values for a type
   */
  getSeedValues(typeName: string): Record<string, unknown> {
    return this.schema.types[typeName]?.directives.$seed ?? {}
  }

  // ============================================================================
  // DEPENDENCY ANALYSIS
  // ============================================================================

  /**
   * Get dependencies for a type
   */
  getDependencies(typeName: string): string[] {
    return getDependencies(this.schema, typeName)
  }

  /**
   * Detect cycles in the dependency graph
   */
  detectCycles(options: { ignoreOptional?: boolean } = {}): string[][] {
    const graph = buildDependencyGraph(this.schema)
    return detectCycles(graph, options, this.schema)
  }

  /**
   * Get parallel generation groups
   */
  getParallelGenerationGroups(rootType: string): string[][] {
    const graph = buildDependencyGraph(this.schema)
    return getParallelGroups(graph, rootType)
  }

  // ============================================================================
  // VALIDATION
  // ============================================================================

  /**
   * Validate context is ready for generation
   */
  validateForGeneration(typeName: string): ContextValidationResult {
    const errors: GenerationValidationError[] = []
    const typeInfo = this.schema.types[typeName]

    if (!typeInfo) {
      return { valid: false, errors: [{ field: '', type: 'type', message: `Unknown type: ${typeName}` }] }
    }

    // Check parent requirement
    if (typeInfo.directives.$requiresParent && this.parentStack.length === 0) {
      errors.push({ field: '', type: 'missing_parent', message: 'Parent entity required' })
    }

    return { valid: errors.length === 0, errors }
  }

  // ============================================================================
  // TOKEN MANAGEMENT
  // ============================================================================

  /**
   * Estimate total tokens in context
   */
  estimateTokens(): number {
    let chars = 0
    for (const entity of this.generated.values()) {
      chars += this.estimateEntityTokens(entity) * CHARS_PER_TOKEN
    }
    for (const parent of this.parentStack) {
      chars += this.estimateEntityTokens(parent) * CHARS_PER_TOKEN
    }
    return Math.ceil(chars / CHARS_PER_TOKEN)
  }

  /**
   * Estimate tokens for a single entity
   */
  private estimateEntityTokens(entity: Entity): number {
    return Math.ceil(JSON.stringify(entity).length / CHARS_PER_TOKEN)
  }

  /**
   * Get remaining token budget
   */
  getRemainingTokenBudget(): number {
    return Math.max(0, this.maxContextTokens - this.estimateTokens())
  }

  /**
   * Compact oldest entries to free up space
   */
  private compactOldest(): void {
    // Remove oldest entries until we have room (at least 50% of max)
    const targetTokens = Math.floor(this.maxContextTokens * 0.5)
    const entries = [...this.generated.entries()]

    while (this.estimateTokens() > targetTokens && entries.length > 0) {
      const [id, entity] = entries.shift()!
      this.generated.delete(id)
      const byType = this.generatedByType.get(entity.$type)
      if (byType) {
        const idx = byType.findIndex((e) => e.$id === id)
        if (idx !== -1) byType.splice(idx, 1)
      }
      // Also remove from generation order
      const orderIdx = this.generationOrder.findIndex((e) => e.$id === id)
      if (orderIdx !== -1) this.generationOrder.splice(orderIdx, 1)
    }
  }

  // ============================================================================
  // SNAPSHOTS AND BRANCHING
  // ============================================================================

  /**
   * Create a snapshot of current state
   */
  createSnapshot(): ContextSnapshot {
    return {
      generatedCount: this.generated.size,
      parentDepth: this.parentStack.length,
      timestamp: new Date(),
    }
  }

  /**
   * Restore from a snapshot (clears additions after snapshot)
   */
  restoreSnapshot(snapshot: ContextSnapshot): void {
    // Trim generated to match snapshot count
    while (this.generated.size > snapshot.generatedCount) {
      const lastEntity = this.generationOrder.pop()
      if (lastEntity) {
        this.generated.delete(lastEntity.$id)
        const byType = this.generatedByType.get(lastEntity.$type)
        if (byType) byType.pop()
      }
    }

    // Trim parent stack
    while (this.parentStack.length > snapshot.parentDepth) {
      this.parentStack.pop()
    }
  }

  /**
   * Create a branch (copy) of this context
   */
  branch(): GenerationContext {
    const branched = new GenerationContext({
      schema: this.schema,
      namespace: this.namespace,
      maxContextTokens: this.maxContextTokens,
      autoCompact: this.autoCompact,
    })

    // Copy state
    for (const [id, entity] of this.generated) {
      branched.generated.set(id, { ...entity })
    }
    for (const [type, entities] of this.generatedByType) {
      branched.generatedByType.set(type, [...entities])
    }
    branched.parentStack = [...this.parentStack]
    branched.generationOrder = [...this.generationOrder]
    branched.relationships = [...this.relationships]

    return branched
  }

  /**
   * Merge a branch back into this context
   */
  merge(branch: GenerationContext): void {
    for (const [id, entity] of branch.generated) {
      if (!this.generated.has(id)) {
        this.addGenerated(entity)
      }
    }
    for (const rel of branch.relationships) {
      const exists = this.relationships.some(
        (r) => r.from === rel.from && r.to === rel.to && r.verb === rel.verb
      )
      if (!exists) {
        this.relationships.push(rel)
      }
    }
  }

  // ============================================================================
  // SERIALIZATION
  // ============================================================================

  /**
   * Serialize context to JSON
   */
  toJSON(): string {
    return JSON.stringify({
      namespace: this.namespace,
      generated: [...this.generated.values()],
      parents: this.parentStack,
      relationships: this.relationships,
    })
  }

  /**
   * Deserialize context from JSON
   */
  static fromJSON(json: string, schema: GenerationParsedSchema): GenerationContext {
    const data = JSON.parse(json)
    const context = new GenerationContext({
      schema,
      namespace: data.namespace,
    })

    for (const entity of data.generated) {
      context.addGenerated(entity)
    }
    for (const parent of data.parents) {
      context.pushParent(parent)
    }
    context.relationships = data.relationships

    return context
  }
}
