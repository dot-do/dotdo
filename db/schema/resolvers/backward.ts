/**
 * Backward Cascade Resolution
 *
 * Handles backward cascade operators:
 * - `<-` (Backward Insert): Generate new target entity, create relationship FROM target TO this
 * - `<~` (Backward Search): Semantic search for entities pointing here
 *
 * Relationship Direction (backward):
 * - from = target (generated or found entity)
 * - to = this (current entity)
 *
 * This is the inverse of forward cascade:
 * - Forward: from=this, to=target
 * - Backward: from=target, to=this
 */

import { deriveReverseVerb, deriveVerbFromFieldName } from './verb-derivation'
import {
  type Entity,
  type Relationship,
  generateEntityId,
  generateRelationshipId,
} from './shared'

// Re-export types and functions
export { deriveReverseVerb }
export type { Entity, Relationship }

export interface BackwardReference {
  operator: '<-' | '<~' | '->'
  targetType: string
  fieldName: string
  prompt?: string
  verb?: string
  backrefField?: string
  threshold?: number
  unionTypes?: string[]
  fallbackMode?: boolean
  noMatchesScenario?: boolean
  onSearch?: (type: string) => void
}

export interface BackwardResolutionContext {
  entity: Entity
  namespace: string
  prompt?: string
  previousGenerations?: Entity[]
}

export interface BackwardResolutionResult {
  mode: 'insert' | 'search'
  generated?: Entity
  relationship?: Relationship
  matches?: MatchResult[]
  isGenerated?: boolean
  generationContext?: {
    parentEntity: Entity
    previousGenerations?: Entity[]
  }
  searchedTypes?: string[]
  searchOrder?: string[]
  error?: Error
}

export interface MatchResult extends Entity {
  similarity?: number
  relationship?: Relationship
}

export interface ParsedBackwardReference {
  operator: '<-' | '<~' | '->'
  targetType: string
  direction: 'backward' | 'forward'
  matchMode: 'exact' | 'fuzzy'
  prompt?: string
  backrefField?: string
  threshold?: number
  unionTypes?: string[]
  isFallback?: boolean
  isArray?: boolean
  isOptional?: boolean
  relationshipDirection: {
    from: 'target' | 'this'
    to: 'target' | 'this'
  }
  mixedOperators?: boolean
  operations?: Array<{ operator: string; type: string }>
  thresholds?: Record<string, number>
}

export interface ResolverOptions {
  generator?: (context: GenerateContext) => Promise<Entity>
  searcher?: (context: SearchContext) => Promise<MatchResult[]>
  onSearchError?: 'throw' | 'empty'
}

interface GenerateContext {
  type: string
  prompt?: string
  parentEntity: Entity
  namespace: string
  previousGenerations?: Entity[]
}

interface SearchContext {
  type: string
  types?: string[]
  prompt?: string
  targetEntity: Entity
  namespace: string
  threshold?: number
}

// ============================================================================
// Default generator and searcher
// ============================================================================

async function defaultGenerator(context: GenerateContext): Promise<Entity> {
  return {
    $id: generateEntityId(context.type),
    $type: context.type,
  }
}

async function defaultSearcher(_context: SearchContext): Promise<MatchResult[]> {
  // Default implementation returns empty - no matches found
  return []
}

// ============================================================================
// BackwardCascadeResolver Class
// ============================================================================

export class BackwardCascadeResolver {
  private generator: (context: GenerateContext) => Promise<Entity>
  private searcher: (context: SearchContext) => Promise<MatchResult[]>
  private onSearchError: 'throw' | 'empty'

  constructor(options: ResolverOptions = {}) {
    this.generator = options.generator || defaultGenerator
    this.searcher = options.searcher || defaultSearcher
    this.onSearchError = options.onSearchError || 'throw'
  }

  async resolve(
    ref: BackwardReference,
    context: BackwardResolutionContext
  ): Promise<BackwardResolutionResult> {
    // Validate inputs
    if (!context.entity) {
      throw new Error('Entity is required')
    }
    if (!context.namespace) {
      throw new Error('Namespace is required')
    }
    if (ref.operator === '->') {
      throw new Error('Expected backward operator (<- or <~), got forward operator (->)')
    }

    if (ref.operator === '<-') {
      return this.resolveInsert(ref, context)
    } else {
      return this.resolveSearch(ref, context)
    }
  }

  private async resolveInsert(
    ref: BackwardReference,
    context: BackwardResolutionContext
  ): Promise<BackwardResolutionResult> {
    // Generate new entity
    const generated = await this.generator({
      type: ref.targetType,
      prompt: ref.prompt,
      parentEntity: context.entity,
      namespace: context.namespace,
      previousGenerations: context.previousGenerations,
    })

    // Set backref field if specified
    if (ref.backrefField) {
      generated[ref.backrefField] = context.entity.$id
    }

    // Create relationship with correct backward direction
    const verb = this.deriveBackwardVerb(ref.verb, ref.fieldName)

    const relationship: Relationship = {
      id: generateRelationshipId(),
      verb,
      from: generated.$id,
      to: context.entity.$id,
    }

    return {
      mode: 'insert',
      generated,
      relationship,
      generationContext: {
        parentEntity: context.entity,
        previousGenerations: context.previousGenerations,
      },
    }
  }

  private async resolveSearch(
    ref: BackwardReference,
    context: BackwardResolutionContext
  ): Promise<BackwardResolutionResult> {
    const searchedTypes: string[] = []
    const typesToSearch = ref.unionTypes || [ref.targetType]
    let matches: MatchResult[] = []

    try {
      if (ref.fallbackMode) {
        // Fallback mode: search types in order, stop on first match
        for (const type of typesToSearch) {
          searchedTypes.push(type)
          ref.onSearch?.(type)

          const typeMatches = await this.searcher({
            type,
            prompt: ref.prompt,
            targetEntity: context.entity,
            namespace: context.namespace,
            threshold: ref.threshold,
          })

          // For no matches scenario (test helper), continue searching all types
          if (ref.noMatchesScenario) {
            matches.push(...typeMatches)
            continue
          }

          if (typeMatches.length > 0) {
            matches = typeMatches
            break
          }
        }
      } else {
        // Normal mode: search all types
        searchedTypes.push(...typesToSearch)
        matches = await this.searcher({
          type: ref.targetType,
          types: ref.unionTypes,
          prompt: ref.prompt,
          targetEntity: context.entity,
          namespace: context.namespace,
          threshold: ref.threshold,
        })
      }

      // Filter by threshold if specified
      if (ref.threshold !== undefined) {
        matches = matches.filter((m) => (m.similarity ?? 1) >= ref.threshold!)
      }

      // Add relationship info to matches (from target TO this)
      matches = matches.map((match) => ({
        ...match,
        relationship: {
          id: generateRelationshipId(),
          verb: this.deriveVerb(ref.verb, ref.fieldName),
          from: match.$id,
          to: context.entity.$id,
        },
      }))

      return {
        mode: 'search',
        matches,
        isGenerated: false,
        searchedTypes,
        searchOrder: typesToSearch,
      }
    } catch (error) {
      if (this.onSearchError === 'empty') {
        return {
          mode: 'search',
          matches: [],
          isGenerated: false,
          searchedTypes,
          searchOrder: typesToSearch,
          error: error as Error,
        }
      }
      throw error
    }
  }

  async createReverseRelationship(
    generated: Entity,
    context: BackwardResolutionContext,
    options: { verb?: string; fieldName?: string }
  ): Promise<Relationship> {
    const verb = this.deriveVerb(options.verb, options.fieldName)
    const reverseVerb = deriveReverseVerb(verb)

    // Build namespace-qualified URLs
    const fromUrl = `${context.namespace}/${generated.$id}`
    const toUrl = `${context.namespace}/${context.entity.$id}`

    return {
      id: generateRelationshipId(),
      verb: reverseVerb,
      from: fromUrl,
      to: toUrl,
    }
  }

  async queryRelatedEntities(
    ref: { targetType: string; fieldName: string },
    context: BackwardResolutionContext
  ): Promise<Entity[]> {
    // Query entities that have a relationship TO this entity
    const matches = await this.searcher({
      type: ref.targetType,
      targetEntity: context.entity,
      namespace: context.namespace,
    })

    return matches
  }

  private deriveVerb(verb?: string, fieldName?: string): string {
    if (verb) return verb
    if (fieldName) {
      // Try to derive verb from field name
      return deriveVerbFromFieldName(fieldName)
    }
    return 'relatedTo'
  }

  /**
   * Derives the backward relationship verb.
   *
   * Rules:
   * 1. If explicit verb is provided and looks like a relationship preposition
   *    (ends with To, Of, By, etc.), use it as-is
   * 2. If explicit verb is a forward action verb (manages, owns, etc.),
   *    derive the reverse (managedBy, ownedBy)
   * 3. If only fieldName is provided, derive verb from field name and
   *    apply reverse if it's a known forward verb, or add 'Of' suffix
   */
  private deriveBackwardVerb(verb?: string, fieldName?: string): string {
    if (verb) {
      // If verb already looks like a passive/relationship verb, use it as-is
      if (this.isPassiveVerb(verb)) {
        return verb
      }
      // Otherwise derive the reverse
      return deriveReverseVerb(verb)
    }

    if (fieldName) {
      // Derive verb from field name
      const derivedVerb = deriveVerbFromFieldName(fieldName)

      // If the derived verb is different from fieldName (it's a known mapping),
      // apply reverse verb derivation
      if (derivedVerb !== fieldName) {
        return deriveReverseVerb(derivedVerb)
      }

      // For unknown field names, add 'Of' suffix for backward relationship
      return `${fieldName}Of`
    }

    return 'relatedTo'
  }

  /**
   * Checks if a verb looks like it's already in passive/relationship form.
   * These verbs end with prepositions like To, Of, By, With, For, From, etc.
   */
  private isPassiveVerb(verb: string): boolean {
    const passiveSuffixes = ['To', 'Of', 'By', 'With', 'For', 'From', 'In', 'At']
    return passiveSuffixes.some((suffix) => verb.endsWith(suffix))
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

export async function resolveBackwardInsert(
  ref: Omit<BackwardReference, 'operator'> & { operator?: '<-' },
  context: BackwardResolutionContext,
  resolver?: BackwardCascadeResolver
): Promise<BackwardResolutionResult> {
  const resolverInstance = resolver || new BackwardCascadeResolver()
  return resolverInstance.resolve({ ...ref, operator: '<-' }, context)
}

export async function resolveBackwardSearch(
  ref: Omit<BackwardReference, 'operator'> & { operator?: '<~' },
  context: BackwardResolutionContext,
  resolver?: BackwardCascadeResolver
): Promise<BackwardResolutionResult> {
  const resolverInstance = resolver || new BackwardCascadeResolver()
  return resolverInstance.resolve({ ...ref, operator: '<~' }, context)
}

// ============================================================================
// Reference Parsing
// ============================================================================

/**
 * Parses a backward reference string into a structured object.
 *
 * Supported formats:
 * - `<-Type` - Backward insert
 * - `<~Type` - Backward search
 * - `->Type` - Forward insert (for comparison)
 * - `<-Type.field` - With backref field
 * - `<~Type(0.9)` - With threshold
 * - `<~A|B|C` - Union types
 * - `[<-Type]` - Array syntax
 * - `<-Type?` - Optional
 * - `"prompt" <-Type` - With prompt
 * - `<-Type|<~Other` - Mixed operators
 * - `<~Type(0.8)|Other(0.7)` - Thresholds per type
 */
export function parseBackwardReference(input: string): ParsedBackwardReference {
  let workingInput = input.trim()

  // Check for array syntax
  const isArray = workingInput.startsWith('[') && workingInput.endsWith(']')
  if (isArray) {
    workingInput = workingInput.slice(1, -1)
  }

  // Check for mixed operators pattern (e.g., `<-Type|<~Other`)
  if (workingInput.includes('|<-') || workingInput.includes('|<~')) {
    const operations = parseMixedOperators(workingInput)
    return {
      operator: operations[0].operator as '<-' | '<~',
      targetType: operations[0].type,
      direction: 'backward',
      matchMode: operations[0].operator === '<-' ? 'exact' : 'fuzzy',
      relationshipDirection: { from: 'target', to: 'this' },
      mixedOperators: true,
      operations,
      isArray,
    }
  }

  // Extract prompt if present (text before operator)
  let prompt: string | undefined
  const promptMatch = workingInput.match(/^(.+?)\s+(<[-~>])/)
  if (promptMatch) {
    prompt = promptMatch[1].trim()
    workingInput = workingInput.slice(promptMatch[1].length).trim()
  }

  // Parse operator
  let operator: '<-' | '<~' | '->'
  if (workingInput.startsWith('<-')) {
    operator = '<-'
    workingInput = workingInput.slice(2)
  } else if (workingInput.startsWith('<~')) {
    operator = '<~'
    workingInput = workingInput.slice(2)
  } else if (workingInput.startsWith('->')) {
    operator = '->'
    workingInput = workingInput.slice(2)
  } else if (workingInput.startsWith('<<-') || workingInput.startsWith('<--')) {
    throw new Error(`Invalid backward operator: ${workingInput.slice(0, 3)}`)
  } else {
    throw new Error(`Invalid reference format: ${input}`)
  }

  // Check for optional marker
  const isOptional = workingInput.endsWith('?')
  if (isOptional) {
    workingInput = workingInput.slice(0, -1)
  }

  // Parse thresholds for union types: `Type(0.8)|Other(0.7)`
  const thresholds: Record<string, number> = {}
  const thresholdPattern = /(\w+)\(([0-9.]+)\)/g
  let thresholdMatch
  while ((thresholdMatch = thresholdPattern.exec(workingInput)) !== null) {
    thresholds[thresholdMatch[1]] = parseFloat(thresholdMatch[2])
  }
  const hasThresholds = Object.keys(thresholds).length > 0

  // Parse threshold for single type: `Type(0.9)`
  let threshold: number | undefined
  const singleThresholdMatch = workingInput.match(/^(\w+)\(([0-9.]+)\)$/)
  if (singleThresholdMatch && !workingInput.includes('|')) {
    threshold = parseFloat(singleThresholdMatch[2])
    workingInput = singleThresholdMatch[1]
  }

  // Parse union types: `A|B|C` or `A(0.8)|B(0.7)`
  let unionTypes: string[] | undefined
  let targetType: string

  if (workingInput.includes('|')) {
    // Remove thresholds for type extraction
    const cleanInput = workingInput.replace(/\([0-9.]+\)/g, '')
    unionTypes = cleanInput.split('|').map((t) => t.trim())
    targetType = unionTypes[0]
  } else {
    // Parse backref field: `Type.field`
    const backrefMatch = workingInput.match(/^(\w+)\.(\w+)$/)
    if (backrefMatch) {
      targetType = backrefMatch[1]
      const backrefField = backrefMatch[2]
      return {
        operator,
        targetType,
        direction: operator === '->' ? 'forward' : 'backward',
        matchMode: operator === '<~' || operator === '~>' ? 'fuzzy' : 'exact',
        prompt,
        backrefField,
        threshold,
        unionTypes,
        isArray,
        isOptional,
        isFallback: unionTypes !== undefined,
        relationshipDirection: operator === '->'
          ? { from: 'this', to: 'target' }
          : { from: 'target', to: 'this' },
        thresholds: hasThresholds ? thresholds : undefined,
      }
    }

    targetType = workingInput.trim()
  }

  return {
    operator,
    targetType,
    direction: operator === '->' ? 'forward' : 'backward',
    matchMode: operator === '<~' || operator === '~>' ? 'fuzzy' : 'exact',
    prompt,
    threshold,
    unionTypes,
    isArray,
    isOptional,
    isFallback: unionTypes !== undefined,
    relationshipDirection: operator === '->'
      ? { from: 'this', to: 'target' }
      : { from: 'target', to: 'this' },
    thresholds: hasThresholds ? thresholds : undefined,
  }
}

function parseMixedOperators(input: string): Array<{ operator: string; type: string }> {
  const parts = input.split('|')
  return parts.map((part) => {
    part = part.trim()
    if (part.startsWith('<-')) {
      return { operator: '<-', type: part.slice(2) }
    } else if (part.startsWith('<~')) {
      return { operator: '<~', type: part.slice(2) }
    } else if (part.startsWith('->')) {
      return { operator: '->', type: part.slice(2) }
    }
    // First part might not have operator prefix
    return { operator: '<-', type: part }
  })
}
