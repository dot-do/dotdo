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
 * Fuzzy operators (~> and <~) use vector search for semantic similarity.
 *
 * @module semantic
 */

import { VectorStore, getVectorStore, resetVectorStore, type VectorStoreConfig } from './vector-store'

// ============================================================================
// CONSTANTS
// ============================================================================

/** Default similarity score for exact match fallbacks in fuzzy search */
const EXACT_MATCH_SIMILARITY_SCORE = 0.95

/** Minimum allowed character count for language patterns */
const MIN_WORD_LENGTH = 3

/** Characters that don't double in CVC pattern (consonant-vowel-consonant) */
const NO_DOUBLE_CONSONANTS = new Set(['w', 'x', 'y'])

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

/** Global vector store for semantic search */
let vectorStore: VectorStore | null = null

/**
 * Get or create the vector store
 */
function getSemanticVectorStore(): VectorStore {
  if (!vectorStore) {
    vectorStore = getVectorStore()
  }
  return vectorStore
}

/**
 * Configure the vector store for semantic operations
 * Call this to set up Vectorize and AI bindings for production use.
 *
 * @param config - VectorStore configuration
 */
export function configureVectorStore(config: VectorStoreConfig): void {
  resetVectorStore()
  vectorStore = new VectorStore(config)
}

/**
 * Reset all internal state (for testing)
 * This clears all registries and stores.
 */
export function resetState(): void {
  nounRegistry = new Map()
  verbRegistry = new Map()
  thingStore = new Map()
  edgeStore = []
  vectorStore = null
  resetVectorStore()
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
 * Define a new noun type with singular/plural forms
 *
 * Automatically derives the plural form following English grammar rules:
 * - Regular plurals: add "s" (book -> books)
 * - Words ending in s, x, z, ch, sh: add "es" (box -> boxes)
 * - Words ending in consonant+y: change to "ies" (city -> cities)
 *
 * @param name - The singular name of the noun (e.g., 'Customer')
 * @param options - Optional overrides for plural form
 * @returns The Noun definition
 * @throws Error if the noun is already registered with this name
 *
 * @example
 * const Customer = noun('Customer')
 * // => { singular: 'Customer', plural: 'Customers' }
 *
 * const Person = noun('Person', { plural: 'People' })
 * // => { singular: 'Person', plural: 'People' }
 */
export function noun(name: string, options?: NounOptions): Noun {
  // Check for duplicate registration
  if (nounRegistry.has(name)) {
    throw new Error(
      `Noun '${name}' is already registered. Each noun name must be unique. ` +
      `Use resetState() to clear registries if you need to re-register.`
    )
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
 *
 * Follows English grammar rules where single-syllable words with CVC pattern
 * double the final consonant before adding suffixes (e.g., "stop" -> "stopped")
 */
function shouldDoubleConsonant(verb: string): boolean {
  const lower = verb.toLowerCase()
  if (lower.length < MIN_WORD_LENGTH) return false

  const lastChar = lower[lower.length - 1]
  const secondLast = lower[lower.length - 2]
  const thirdLast = lower[lower.length - 3]

  // Must end in consonant-vowel-consonant pattern
  // Don't double w, x, y (letters that rarely follow the doubling rule)
  if (
    isConsonant(lastChar) &&
    !NO_DOUBLE_CONSONANTS.has(lastChar) &&
    isVowel(secondLast) &&
    isConsonant(thirdLast)
  ) {
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
 * Define a new verb with conjugated tenses
 *
 * Automatically derives all tenses following English grammar rules:
 * - Past tense: regular "-ed" suffix, or consonant doubling (run -> ran)
 * - Present (3rd person): "creates", "passes", "tries"
 * - Gerund: "creating", "passing", "trying"
 *
 * @param name - The base form of the verb (e.g., 'create')
 * @param options - Optional overrides for conjugated forms (for irregular verbs)
 * @returns The Verb definition
 *
 * @example
 * const Create = verb('create')
 * // => { base: 'create', past: 'created', present: 'creates', gerund: 'creating' }
 *
 * const Buy = verb('buy', { past: 'bought' })
 * // => { base: 'buy', past: 'bought', present: 'buys', gerund: 'buying' }
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
 * Create a Thing instance of a given noun type
 *
 * Flexible constructor supporting three patterns:
 * 1. `thing(Noun, data)` - Auto-generate UUID for $id
 * 2. `thing(Noun, id)` - Create reference with explicit id (no data)
 * 3. `thing(Noun, id, data)` - Create with explicit id and properties
 *
 * All Things are automatically stored in the global thing registry for
 * use in relationship traversals and edge creation.
 *
 * @template T - The data type for this Thing's properties
 * @param noun - The Noun definition (singular type)
 * @param idOrData - Either a string ID or data object
 * @param data - Optional data properties (used when idOrData is string ID)
 * @returns A new Thing instance with $id and $type set
 *
 * @example
 * const Customer = noun('Customer')
 *
 * // Auto-generate ID
 * const alice = thing(Customer, { name: 'Alice', email: 'alice@example.com' })
 *
 * // Explicit ID
 * const bob = thing(Customer, 'bob-123', { name: 'Bob' })
 *
 * // Reference only
 * const ref = thing(Customer, 'charlie-id')
 */
export function thing<T = Record<string, unknown>>(noun: Noun, idOrData?: string | T, data?: T): Thing<T> {
  let id: string
  let thingData: T | undefined

  // Determine if idOrData is a string ID or data object
  if (typeof idOrData === 'string') {
    // Patterns: thing(Noun, id) or thing(Noun, id, data)
    id = idOrData
    thingData = data
  } else {
    // Pattern: thing(Noun, data) - auto-generate id
    id = generateId()
    thingData = idOrData
  }

  const thingInstance: Thing<T> = {
    $id: id,
    $type: noun.singular,
    ...(thingData ?? {}),
  } as Thing<T>

  // Store the thing in the global registry for relationship traversals
  thingStore.set(id, thingInstance)

  return thingInstance
}

// ============================================================================
// ACTION IMPLEMENTATION
// ============================================================================

/**
 * Create an action representing subject.verb(object)
 *
 * Creates a unified record containing three perspectives on an action:
 * - **Event**: What happened (type, subject, object, timestamp, metadata)
 * - **Edge**: The graph relationship created (from -> to -> verb)
 * - **Audit**: Who did what to whom (actor, verb, target, timestamp)
 *
 * Automatically creates relationships in the edge store for graph traversal.
 * Works with both transitive verbs (subject.verb(object)) and intransitive
 * verbs (subject.verb() without object).
 *
 * @param subject - The Thing performing the action (the actor)
 * @param verbDef - The Verb definition being performed
 * @param object - The Thing being acted upon (optional for intransitive verbs)
 * @param metadata - Additional contextual metadata (price, currency, etc.)
 * @returns ActionResult containing event, edge, and audit records
 *
 * @example
 * const Customer = noun('Customer')
 * const Product = noun('Product')
 * const Purchase = verb('purchase')
 *
 * const alice = thing(Customer, 'alice', { name: 'Alice' })
 * const macbook = thing(Product, 'macbook', { name: 'MacBook Pro' })
 *
 * const result = action(alice, Purchase, macbook, { price: 2499.99 })
 * // Creates event: "purchased", edge: alice -> macbook, audit: alice purchased macbook
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
 * Convert vector search results to Thing[] or ScoredThing[] based on withScores flag
 *
 * Helper function to reduce code duplication in fuzzy operators.
 * Handles conversion of scored results to either raw Things or ScoredThings.
 *
 * @internal
 */
function formatFuzzyResults(
  scored: ScoredThing[],
  withScores: boolean
): Thing[] | ScoredThing[] {
  if (withScores) {
    return scored
  }
  // Remove score property from results
  return scored.map(({ score: _score, ...rest }) => rest as Thing)
}

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
 * Find semantically related things of the target type using vector search.
 * Uses embeddings to find items that are semantically similar to the source thing.
 *
 * Behavior:
 * - When vector store has indexed items: performs true semantic search
 * - Fallback: returns exact graph matches with high confidence score
 * - Returns either Things or ScoredThings based on withScores option
 *
 * @param from - The source Thing to find similar items for
 * @param targetType - The target type name to filter results by
 * @param options - Search options (threshold, withScores, topK)
 * @returns Promise resolving to Things (or ScoredThings if withScores: true)
 */
export async function forwardFuzzy(
  from: Thing,
  targetType: string,
  options?: FuzzyOptions & { topK?: number }
): Promise<Thing[] | ScoredThing[]> {
  const threshold = options?.threshold ?? 0
  const withScores = options?.withScores ?? false
  const topK = (options as { topK?: number } | undefined)?.topK

  // Try semantic vector search first
  const store = getSemanticVectorStore()
  const vectorResults = await store.findSimilar(from, targetType, {
    threshold,
    withScores: true,
    topK,
  }) as ScoredThing[]

  // If we have vector results, use them
  if (vectorResults.length > 0) {
    return formatFuzzyResults(vectorResults, withScores)
  }

  // Fallback: Get exact graph matches and add high confidence scores
  const exactMatches = forward(from, targetType)
  const scoredResults: ScoredThing[] = exactMatches.map((thing) => ({
    ...thing,
    score: EXACT_MATCH_SIMILARITY_SCORE, // High similarity for exact graph matches
  }))

  // Filter by threshold
  const filtered = scoredResults.filter((r) => r.score >= threshold)
  return formatFuzzyResults(filtered, withScores)
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
 * Find semantically related things of the source type using vector search.
 * Uses embeddings to find items that are semantically related to the target thing.
 *
 * Behavior:
 * - When vector store has indexed items: performs true semantic search
 * - Fallback: returns exact graph matches with high confidence score
 * - Returns either Things or ScoredThings based on withScores option
 *
 * Note: In embedding space, forward and backward similarity is symmetric,
 * so this operation searches for items related to the target.
 *
 * @param to - The target Thing to find related items for
 * @param sourceType - The source type name to filter results by
 * @param options - Search options (threshold, withScores, topK)
 * @returns Promise resolving to Things (or ScoredThings if withScores: true)
 */
export async function backwardFuzzy(
  to: Thing,
  sourceType: string,
  options?: FuzzyOptions & { topK?: number }
): Promise<Thing[] | ScoredThing[]> {
  const threshold = options?.threshold ?? 0
  const withScores = options?.withScores ?? false
  const topK = (options as { topK?: number } | undefined)?.topK

  // Try semantic vector search first (backward search in vector space)
  const store = getSemanticVectorStore()
  const vectorResults = await store.findRelatedTo(to, sourceType, {
    threshold,
    withScores: true,
    topK,
  }) as ScoredThing[]

  // If we have vector results, use them
  if (vectorResults.length > 0) {
    return formatFuzzyResults(vectorResults, withScores)
  }

  // Fallback: Get exact graph matches and add high confidence scores
  const exactMatches = backward(to, sourceType)
  const scoredResults: ScoredThing[] = exactMatches.map((thing) => ({
    ...thing,
    score: EXACT_MATCH_SIMILARITY_SCORE, // High similarity for exact graph matches
  }))

  // Filter by threshold
  const filtered = scoredResults.filter((r) => r.score >= threshold)
  return formatFuzzyResults(filtered, withScores)
}

// ============================================================================
// VECTOR INDEXING
// ============================================================================

/**
 * Index a Thing for semantic search
 *
 * This makes the Thing findable via fuzzy operators (~> and <~).
 *
 * @param thingToIndex - The Thing to index
 * @returns Promise that resolves when indexed
 */
export async function indexThing(thingToIndex: Thing): Promise<void> {
  const store = getSemanticVectorStore()
  await store.index(thingToIndex)
}

/**
 * Index multiple Things for semantic search
 *
 * @param things - Array of Things to index
 * @returns Promise that resolves when all indexed
 */
export async function indexThings(things: Thing[]): Promise<void> {
  const store = getSemanticVectorStore()
  await store.indexBatch(things)
}

/**
 * Remove a Thing from the semantic search index
 *
 * @param thingId - ID of the Thing to remove
 * @returns Promise that resolves when removed
 */
export async function unindexThing(thingId: string): Promise<void> {
  const store = getSemanticVectorStore()
  await store.remove(thingId)
}

/**
 * Perform a semantic text search across all indexed Things
 *
 * @param query - Text query
 * @param targetType - Optional type filter
 * @param options - Search options
 * @returns Promise of matching Things
 */
export async function semanticSearch(
  query: string,
  targetType?: string,
  options?: FuzzyOptions & { topK?: number }
): Promise<Thing[] | ScoredThing[]> {
  const store = getSemanticVectorStore()
  return store.search(query, targetType, options)
}

// ============================================================================
// RE-EXPORTS
// ============================================================================

// Re-export VectorStore types and classes for advanced usage
export {
  VectorStore,
  type VectorStoreConfig,
  type VectorizeIndex,
  type WorkersAI,
  type EmbeddingProvider,
  InMemoryVectorIndex,
  MockEmbeddingProvider,
  WorkersAIEmbeddingProvider,
} from './vector-store'
