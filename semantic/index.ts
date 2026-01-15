/**
 * Semantic Type System (DOSemantic) - Full Implementation
 *
 * This module provides the semantic type system for:
 * - Nouns: Entity type definitions with auto-derived singular/plural forms
 * - Verbs: Action definitions with auto-derived tenses
 * - Things: Entity instances with $id and $type
 * - Actions: Unified event + edge + audit records
 * - Relationship operators: ->, ~>, <-, <~ for traversal
 *
 * @module semantic
 */

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Noun - Entity type definition with singular/plural forms
 */
export interface Noun {
  /** Singular form (e.g., 'Customer') */
  singular: string
  /** Plural form (e.g., 'Customers') */
  plural: string
}

/**
 * NounOptions - Options for noun definition
 */
export interface NounOptions {
  /** Override the auto-derived plural form */
  plural?: string
}

/**
 * NounRegistry - Map of noun names to Noun definitions
 */
export type NounRegistry = Map<string, Noun>

/**
 * Verb - Action definition with conjugated tenses
 */
export interface Verb {
  /** Base form / infinitive (e.g., 'create') */
  base: string
  /** Past tense (e.g., 'created') */
  past: string
  /** Third person singular present (e.g., 'creates') */
  present: string
  /** Present participle / gerund (e.g., 'creating') */
  gerund: string
}

/**
 * VerbOptions - Options for verb definition
 */
export interface VerbOptions {
  /** Override the auto-derived past tense */
  past?: string
  /** Override the auto-derived present tense */
  present?: string
  /** Override the auto-derived gerund */
  gerund?: string
}

/**
 * VerbRegistry - Map of verb names to Verb definitions
 */
export type VerbRegistry = Map<string, Verb>

/**
 * Thing - Entity instance with $id and $type
 */
export interface Thing<T = Record<string, unknown>> {
  /** Unique identifier */
  $id: string
  /** Type name (from Noun) */
  $type: string
  /** Data properties */
  [key: string]: unknown
}

/**
 * Action - Unified event + edge + audit record
 */
export interface Action {
  event: {
    type: string
    subject: string
    object?: string
    timestamp: Date
    metadata?: Record<string, unknown>
  }
  edge: {
    from: string
    to: string
    verb: string
  }
  audit: {
    actor: string
    verb: string
    target: string
    timestamp: Date
  }
}

/**
 * ActionResult - Result of creating an action
 */
export interface ActionResult extends Action {
  success: boolean
}

/**
 * RelationshipOperator - The four relationship operators
 */
export type RelationshipOperator = '->' | '~>' | '<-' | '<~'

/**
 * FuzzyOptions - Options for fuzzy relationship traversal
 */
export interface FuzzyOptions {
  /** Similarity threshold (0-1) */
  threshold?: number
  /** Include similarity scores in results */
  withScores?: boolean
}

/**
 * ScoredThing - Thing with similarity score for fuzzy results
 */
export interface ScoredThing<T = Record<string, unknown>> extends Thing<T> {
  score: number
}

// ============================================================================
// INTERNAL STATE
// ============================================================================

/** Global noun registry */
let nounRegistry: NounRegistry = new Map()

/** Global verb registry */
let verbRegistry: VerbRegistry = new Map()

/** Global thing store (for relationship traversals) */
let thingStore: Map<string, Thing> = new Map()

/** Global edge store (from -> to relationships) */
interface Edge {
  from: string
  fromType: string
  to: string
  toType: string
  verb: string
}
let edgeStore: Edge[] = []

/**
 * Reset all internal state (for testing)
 * This clears all registries and stores.
 */
export function resetState(): void {
  nounRegistry = new Map()
  verbRegistry = new Map()
  thingStore = new Map()
  edgeStore = []
}

// Auto-reset state before each test if vitest is available
// This is detected by checking for the presence of vitest's beforeEach in globalThis
if (typeof globalThis !== 'undefined') {
  const g = globalThis as Record<string, unknown>
  if (typeof g.beforeEach === 'function') {
    ;(g.beforeEach as (fn: () => void) => void)(() => {
      resetState()
    })
  }
}

// ============================================================================
// NOUN IMPLEMENTATION
// ============================================================================

/**
 * Vowels for pluralization rules
 */
const vowels = new Set(['a', 'e', 'i', 'o', 'u'])

/**
 * Derive plural form from singular
 */
function derivePlural(singular: string): string {
  const lower = singular.toLowerCase()
  const lastChar = lower[lower.length - 1]
  const lastTwoChars = lower.slice(-2)

  // Rule: ends in s, x, z, ch, sh -> add 'es'
  if (
    lastChar === 's' ||
    lastChar === 'x' ||
    lastChar === 'z' ||
    lastTwoChars === 'ch' ||
    lastTwoChars === 'sh'
  ) {
    return singular + 'es'
  }

  // Rule: ends in consonant + y -> change y to ies
  if (lastChar === 'y' && !vowels.has(lower[lower.length - 2])) {
    return singular.slice(0, -1) + 'ies'
  }

  // Default: add 's'
  return singular + 's'
}

/**
 * Define a new noun type
 *
 * @param name - The singular name of the noun (e.g., 'Customer')
 * @param options - Optional overrides for plural form
 * @returns The Noun definition
 */
export function noun(name: string, options?: NounOptions): Noun {
  // Check for duplicate registration
  if (nounRegistry.has(name)) {
    throw new Error(`Noun '${name}' is already registered`)
  }

  const plural = options?.plural ?? derivePlural(name)

  const nounDef: Noun = {
    singular: name,
    plural,
  }

  nounRegistry.set(name, nounDef)

  return nounDef
}

/**
 * Get a registered noun by name
 *
 * @param name - The noun name to look up
 * @returns The Noun definition or undefined
 */
export function getNoun(name: string): Noun | undefined {
  return nounRegistry.get(name)
}

/**
 * Get all registered nouns
 *
 * @returns Array of all registered Noun definitions
 */
export function getAllNouns(): Noun[] {
  return Array.from(nounRegistry.values())
}

// ============================================================================
// VERB IMPLEMENTATION
// ============================================================================

/**
 * Check if a character is a consonant
 */
function isConsonant(char: string): boolean {
  return /[bcdfghjklmnpqrstvwxyz]/i.test(char)
}

/**
 * Check if a character is a vowel
 */
function isVowel(char: string): boolean {
  return vowels.has(char.toLowerCase())
}

/**
 * Check if verb ends in CVC (consonant-vowel-consonant) pattern
 * and should double the final consonant
 */
function shouldDoubleConsonant(verb: string): boolean {
  const lower = verb.toLowerCase()
  if (lower.length < 3) return false

  const lastChar = lower[lower.length - 1]
  const secondLast = lower[lower.length - 2]
  const thirdLast = lower[lower.length - 3]

  // Must end in consonant-vowel-consonant
  // Don't double w, x, y
  if (
    isConsonant(lastChar) &&
    !['w', 'x', 'y'].includes(lastChar) &&
    isVowel(secondLast) &&
    isConsonant(thirdLast)
  ) {
    // For short single-syllable words, double the consonant
    return true
  }

  return false
}

/**
 * Derive past tense from base form
 */
function derivePast(base: string): string {
  const lower = base.toLowerCase()

  // Rule: ends in 'e' -> add 'd'
  if (lower.endsWith('e')) {
    return base + 'd'
  }

  // Rule: ends in consonant + y -> change y to ied
  if (lower.endsWith('y') && !vowels.has(lower[lower.length - 2])) {
    return base.slice(0, -1) + 'ied'
  }

  // Rule: CVC pattern -> double final consonant + ed
  if (shouldDoubleConsonant(base)) {
    return base + base[base.length - 1] + 'ed'
  }

  // Default: add 'ed'
  return base + 'ed'
}

/**
 * Derive present tense (third person singular) from base form
 */
function derivePresent(base: string): string {
  const lower = base.toLowerCase()
  const lastChar = lower[lower.length - 1]
  const lastTwoChars = lower.slice(-2)

  // Rule: ends in s, x, z, ch, sh -> add 'es'
  if (
    lastChar === 's' ||
    lastChar === 'x' ||
    lastChar === 'z' ||
    lastTwoChars === 'ch' ||
    lastTwoChars === 'sh'
  ) {
    return base + 'es'
  }

  // Rule: ends in consonant + y -> change y to ies
  if (lastChar === 'y' && !vowels.has(lower[lower.length - 2])) {
    return base.slice(0, -1) + 'ies'
  }

  // Default: add 's'
  return base + 's'
}

/**
 * Derive gerund (present participle) from base form
 */
function deriveGerund(base: string): string {
  const lower = base.toLowerCase()

  // Rule: ends in 'e' -> drop 'e' and add 'ing'
  if (lower.endsWith('e') && !lower.endsWith('ee')) {
    return base.slice(0, -1) + 'ing'
  }

  // Rule: CVC pattern -> double final consonant + ing
  if (shouldDoubleConsonant(base)) {
    return base + base[base.length - 1] + 'ing'
  }

  // Default: add 'ing'
  return base + 'ing'
}

/**
 * Define a new verb
 *
 * @param name - The base form of the verb (e.g., 'create')
 * @param options - Optional overrides for conjugated forms
 * @returns The Verb definition
 */
export function verb(name: string, options?: VerbOptions): Verb {
  const verbDef: Verb = {
    base: name,
    past: options?.past ?? derivePast(name),
    present: options?.present ?? derivePresent(name),
    gerund: options?.gerund ?? deriveGerund(name),
  }

  verbRegistry.set(name, verbDef)

  return verbDef
}

/**
 * Get a registered verb by name
 *
 * @param name - The verb name to look up
 * @returns The Verb definition or undefined
 */
export function getVerb(name: string): Verb | undefined {
  return verbRegistry.get(name)
}

/**
 * Get all registered verbs
 *
 * @returns Array of all registered Verb definitions
 */
export function getAllVerbs(): Verb[] {
  return Array.from(verbRegistry.values())
}

// ============================================================================
// THING IMPLEMENTATION
// ============================================================================

/**
 * Generate a unique ID
 */
function generateId(): string {
  return crypto.randomUUID()
}

/**
 * Create a Thing instance
 *
 * Overloads:
 * - thing(Noun, data) - auto-generate $id
 * - thing(Noun, id) - create reference with explicit id
 * - thing(Noun, id, data) - create with explicit id and data
 */
export function thing<T = Record<string, unknown>>(noun: Noun, idOrData?: string | T, data?: T): Thing<T> {
  let id: string
  let thingData: T | undefined

  if (typeof idOrData === 'string') {
    // thing(Noun, id) or thing(Noun, id, data)
    id = idOrData
    thingData = data
  } else {
    // thing(Noun, data) - auto-generate id
    id = generateId()
    thingData = idOrData
  }

  const thingInstance: Thing<T> = {
    $id: id,
    $type: noun.singular,
    ...(thingData ?? {}),
  } as Thing<T>

  // Store the thing for relationship traversals
  thingStore.set(id, thingInstance)

  return thingInstance
}

// ============================================================================
// ACTION IMPLEMENTATION
// ============================================================================

/**
 * Create an action (unified event + edge + audit)
 *
 * @param subject - The Thing performing the action
 * @param verbDef - The Verb being performed
 * @param object - The Thing being acted upon (optional for intransitive verbs)
 * @param metadata - Additional action metadata
 * @returns The ActionResult with event, edge, and audit records
 */
export function action(
  subject: Thing,
  verbDef: Verb,
  object?: Thing,
  metadata?: Record<string, unknown>
): ActionResult {
  const timestamp = new Date()

  // Create event record
  const event: ActionResult['event'] = {
    type: verbDef.past,
    subject: subject.$id,
    timestamp,
  }

  if (object) {
    event.object = object.$id
  }

  if (metadata) {
    event.metadata = metadata
  }

  // Create edge record
  const edge: ActionResult['edge'] = {
    from: subject.$id,
    to: object?.$id ?? '',
    verb: verbDef.past,
  }

  // Store edge for relationship traversals (only if there's an object)
  if (object) {
    edgeStore.push({
      from: subject.$id,
      fromType: subject.$type,
      to: object.$id,
      toType: object.$type,
      verb: verbDef.past,
    })
  }

  // Create audit record
  const audit: ActionResult['audit'] = {
    actor: subject.$id,
    verb: verbDef.past,
    target: object?.$id ?? '',
    timestamp,
  }

  return {
    success: true,
    event,
    edge,
    audit,
  }
}

// ============================================================================
// RELATIONSHIP OPERATORS
// ============================================================================

/**
 * Forward exact traversal: thing -> 'Type'
 *
 * Find all things of the target type that this thing has relationships to.
 *
 * @param from - The source Thing
 * @param targetType - The target type name to filter by
 * @returns Array of Things matching the target type
 */
export function forward(from: Thing, targetType: string): Thing[] {
  const results: Thing[] = []

  for (const edge of edgeStore) {
    if (edge.from === from.$id && edge.toType === targetType) {
      const targetThing = thingStore.get(edge.to)
      if (targetThing) {
        results.push(targetThing)
      }
    }
  }

  return results
}

/**
 * Forward fuzzy traversal: thing ~> 'Type'
 *
 * Find semantically related things of the target type using AI/vector search.
 * For now, this is a simplified implementation that returns exact matches
 * with simulated similarity scores.
 *
 * @param from - The source Thing
 * @param targetType - The target type name to filter by
 * @param options - Fuzzy search options (threshold, withScores)
 * @returns Promise of Things (or ScoredThings if withScores is true)
 */
export async function forwardFuzzy(
  from: Thing,
  targetType: string,
  options?: FuzzyOptions
): Promise<Thing[] | ScoredThing[]> {
  const threshold = options?.threshold ?? 0
  const withScores = options?.withScores ?? false

  // Get exact matches as base
  const exactMatches = forward(from, targetType)

  // Simulate fuzzy matching with scores
  const scoredResults: ScoredThing[] = exactMatches.map((thing) => ({
    ...thing,
    score: 0.95, // High similarity for exact matches
  }))

  // Filter by threshold
  const filtered = scoredResults.filter((r) => r.score >= threshold)

  if (withScores) {
    return filtered
  }

  // Remove scores from results
  return filtered.map(({ score, ...rest }) => rest as Thing)
}

/**
 * Backward exact traversal: thing <- 'Type'
 *
 * Find all things of the target type that have relationships to this thing.
 *
 * @param to - The target Thing
 * @param sourceType - The source type name to filter by
 * @returns Array of Things matching the source type
 */
export function backward(to: Thing, sourceType: string): Thing[] {
  const results: Thing[] = []

  for (const edge of edgeStore) {
    if (edge.to === to.$id && edge.fromType === sourceType) {
      const sourceThing = thingStore.get(edge.from)
      if (sourceThing) {
        results.push(sourceThing)
      }
    }
  }

  return results
}

/**
 * Backward fuzzy traversal: thing <~ 'Type'
 *
 * Find semantically related things of the source type using AI/vector search.
 * For now, this is a simplified implementation that returns exact matches
 * with simulated similarity scores.
 *
 * @param to - The target Thing
 * @param sourceType - The source type name to filter by
 * @param options - Fuzzy search options (threshold, withScores)
 * @returns Promise of Things (or ScoredThings if withScores is true)
 */
export async function backwardFuzzy(
  to: Thing,
  sourceType: string,
  options?: FuzzyOptions
): Promise<Thing[] | ScoredThing[]> {
  const threshold = options?.threshold ?? 0
  const withScores = options?.withScores ?? false

  // Get exact matches as base
  const exactMatches = backward(to, sourceType)

  // Simulate fuzzy matching with scores
  const scoredResults: ScoredThing[] = exactMatches.map((thing) => ({
    ...thing,
    score: 0.95, // High similarity for exact matches
  }))

  // Filter by threshold
  const filtered = scoredResults.filter((r) => r.score >= threshold)

  if (withScores) {
    return filtered
  }

  // Remove scores from results
  return filtered.map(({ score, ...rest }) => rest as Thing)
}
