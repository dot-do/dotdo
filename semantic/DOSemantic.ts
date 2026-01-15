/**
 * DOSemantic - Extends DOCore with semantic types (~20KB)
 *
 * Adds:
 * - Noun definitions with auto-derived singular/plural forms
 * - Verb definitions with auto-derived tenses
 * - Thing instances with $id and $type
 * - Actions (unified event + edge + audit records)
 * - Relationship operators: forward, backward, forwardFuzzy, backwardFuzzy
 */

import { DOCore, type DOCoreEnv } from '../core/DOCore'
import { Hono } from 'hono'

// Import canonical types from types/index.ts
import type {
  Noun,
  NounOptions,
  Verb,
  VerbOptions,
  Thing,
  ActionResult,
} from '../types'

// Re-export for backwards compatibility
export type { Noun, NounOptions, Verb, VerbOptions, Thing, ActionResult }

// ============================================================================
// Types
// ============================================================================

export interface DOSemanticEnv extends Omit<DOCoreEnv, 'DOSemantic'> {
  DOSemantic: DurableObjectNamespace<DOSemantic>
}

interface Edge {
  from: string
  fromType: string
  to: string
  toType: string
  verb: string
}

// ============================================================================
// Helper Functions
// ============================================================================

const vowels = new Set(['a', 'e', 'i', 'o', 'u'])

function derivePlural(singular: string): string {
  const lower = singular.toLowerCase()
  const lastChar = lower[lower.length - 1]
  const lastTwoChars = lower.slice(-2)

  if (
    lastChar === 's' ||
    lastChar === 'x' ||
    lastChar === 'z' ||
    lastTwoChars === 'ch' ||
    lastTwoChars === 'sh'
  ) {
    return singular + 'es'
  }

  if (lastChar === 'y' && !vowels.has(lower[lower.length - 2])) {
    return singular.slice(0, -1) + 'ies'
  }

  return singular + 's'
}

function isConsonant(char: string): boolean {
  return /[bcdfghjklmnpqrstvwxyz]/i.test(char)
}

function isVowel(char: string): boolean {
  return vowels.has(char.toLowerCase())
}

function shouldDoubleConsonant(verb: string): boolean {
  const lower = verb.toLowerCase()
  if (lower.length < 3) return false

  const lastChar = lower[lower.length - 1]
  const secondLast = lower[lower.length - 2]
  const thirdLast = lower[lower.length - 3]

  if (
    isConsonant(lastChar) &&
    !['w', 'x', 'y'].includes(lastChar) &&
    isVowel(secondLast) &&
    isConsonant(thirdLast)
  ) {
    return true
  }

  return false
}

function derivePast(base: string): string {
  const lower = base.toLowerCase()

  if (lower.endsWith('e')) {
    return base + 'd'
  }

  if (lower.endsWith('y') && !vowels.has(lower[lower.length - 2])) {
    return base.slice(0, -1) + 'ied'
  }

  if (shouldDoubleConsonant(base)) {
    return base + base[base.length - 1] + 'ed'
  }

  return base + 'ed'
}

function derivePresent(base: string): string {
  const lower = base.toLowerCase()
  const lastChar = lower[lower.length - 1]
  const lastTwoChars = lower.slice(-2)

  if (
    lastChar === 's' ||
    lastChar === 'x' ||
    lastChar === 'z' ||
    lastTwoChars === 'ch' ||
    lastTwoChars === 'sh'
  ) {
    return base + 'es'
  }

  if (lastChar === 'y' && !vowels.has(lower[lower.length - 2])) {
    return base.slice(0, -1) + 'ies'
  }

  return base + 's'
}

function deriveGerund(base: string): string {
  const lower = base.toLowerCase()

  if (lower.endsWith('e') && !lower.endsWith('ee')) {
    return base.slice(0, -1) + 'ing'
  }

  if (shouldDoubleConsonant(base)) {
    return base + base[base.length - 1] + 'ing'
  }

  return base + 'ing'
}

// ============================================================================
// DOSemantic Class
// ============================================================================

export class DOSemantic extends DOCore {
  protected nouns: Map<string, Noun> = new Map()
  protected verbs: Map<string, Verb> = new Map()
  protected semanticThings: Map<string, Thing> = new Map()
  protected edges: Edge[] = []

  constructor(ctx: DurableObjectState, env: DOSemanticEnv) {
    // Cast through unknown because DOSemanticEnv omits DOSemantic from DOCoreEnv
    super(ctx, env as unknown as DOCoreEnv)

    // Initialize semantic tables
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS nouns (
        name TEXT PRIMARY KEY,
        singular TEXT,
        plural TEXT
      )
    `)

    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS verbs (
        name TEXT PRIMARY KEY,
        base TEXT,
        past TEXT,
        present TEXT,
        gerund TEXT
      )
    `)

    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS things (
        id TEXT PRIMARY KEY,
        type TEXT,
        version INTEGER DEFAULT 1,
        data TEXT
      )
    `)

    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS edges (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        from_id TEXT,
        from_type TEXT,
        to_id TEXT,
        to_type TEXT,
        verb TEXT
      )
    `)

    // Load existing data
    this.loadSemanticData()
  }

  private loadSemanticData(): void {
    // Load nouns
    const nouns = this.ctx.storage.sql.exec('SELECT * FROM nouns').toArray()
    for (const row of nouns) {
      this.nouns.set(row.name as string, {
        singular: row.singular as string,
        plural: row.plural as string,
      })
    }

    // Load verbs
    const verbs = this.ctx.storage.sql.exec('SELECT * FROM verbs').toArray()
    for (const row of verbs) {
      this.verbs.set(row.name as string, {
        base: row.base as string,
        past: row.past as string,
        present: row.present as string,
        gerund: row.gerund as string,
      })
    }

    // Load things
    const things = this.ctx.storage.sql.exec('SELECT * FROM things').toArray()
    for (const row of things) {
      const data = JSON.parse(row.data as string)
      this.semanticThings.set(row.id as string, {
        $id: row.id as string,
        $type: row.type as string,
        $version: row.version as number,
        ...data,
      })
    }

    // Load edges
    const edges = this.ctx.storage.sql.exec('SELECT * FROM edges').toArray()
    for (const row of edges) {
      this.edges.push({
        from: row.from_id as string,
        fromType: row.from_type as string,
        to: row.to_id as string,
        toType: row.to_type as string,
        verb: row.verb as string,
      })
    }
  }

  // =========================================================================
  // NOUN OPERATIONS
  // =========================================================================

  defineNoun(name: string, options?: NounOptions): Noun {
    if (this.nouns.has(name)) {
      return this.nouns.get(name)!
    }

    const plural = options?.plural ?? derivePlural(name)
    const noun: Noun = { singular: name, plural }

    // Store in memory and SQLite
    this.nouns.set(name, noun)
    this.ctx.storage.sql.exec(
      'INSERT OR REPLACE INTO nouns (name, singular, plural) VALUES (?, ?, ?)',
      name,
      name,
      plural
    )

    return noun
  }

  getNoun(name: string): Noun | undefined {
    return this.nouns.get(name)
  }

  getAllNouns(): Noun[] {
    return Array.from(this.nouns.values())
  }

  // =========================================================================
  // VERB OPERATIONS
  // =========================================================================

  defineVerb(name: string, options?: VerbOptions): Verb {
    if (this.verbs.has(name)) {
      return this.verbs.get(name)!
    }

    const verb: Verb = {
      base: name,
      past: options?.past ?? derivePast(name),
      present: options?.present ?? derivePresent(name),
      gerund: options?.gerund ?? deriveGerund(name),
    }

    // Store in memory and SQLite
    this.verbs.set(name, verb)
    this.ctx.storage.sql.exec(
      'INSERT OR REPLACE INTO verbs (name, base, past, present, gerund) VALUES (?, ?, ?, ?, ?)',
      name,
      verb.base,
      verb.past,
      verb.present,
      verb.gerund
    )

    return verb
  }

  getVerb(name: string): Verb | undefined {
    return this.verbs.get(name)
  }

  getAllVerbs(): Verb[] {
    return Array.from(this.verbs.values())
  }

  // =========================================================================
  // THING OPERATIONS (semantic versions - different signatures than DOCore)
  // =========================================================================

  createSemanticThing<T = Record<string, unknown>>(
    typeName: string,
    data?: T,
    id?: string
  ): Thing<T> {
    const $id = id ?? `${typeName.toLowerCase()}_${crypto.randomUUID().slice(0, 8)}`
    const $type = typeName
    const $version = 1
    const now = new Date().toISOString()

    const thing: Thing<T> = {
      $id,
      $type,
      $version,
      $createdAt: now,
      $updatedAt: now,
      ...(data ?? {} as T),
    } as Thing<T>

    // Store in memory and SQLite
    this.semanticThings.set($id, thing)
    this.ctx.storage.sql.exec(
      'INSERT OR REPLACE INTO things (id, type, version, data) VALUES (?, ?, ?, ?)',
      $id,
      $type,
      $version,
      JSON.stringify(data ?? {})
    )

    return thing
  }

  getSemanticThing(id: string): Thing | undefined {
    return this.semanticThings.get(id)
  }

  updateSemanticThing(id: string, data: Record<string, unknown>): Thing | undefined {
    const existing = this.semanticThings.get(id)
    if (!existing) return undefined

    const now = new Date().toISOString()
    const updated: Thing = {
      ...existing,
      ...data,
      $id: existing.$id,
      $type: existing.$type,
      $version: (existing.$version ?? 0) + 1,
      $updatedAt: now,
    }

    this.semanticThings.set(id, updated)
    this.ctx.storage.sql.exec(
      'UPDATE things SET version = ?, data = ? WHERE id = ?',
      updated.$version,
      JSON.stringify(data),
      id
    )

    return updated
  }

  deleteSemanticThing(id: string): boolean {
    const existed = this.semanticThings.has(id)
    this.semanticThings.delete(id)
    this.ctx.storage.sql.exec('DELETE FROM things WHERE id = ?', id)
    return existed
  }

  // =========================================================================
  // ACTION OPERATIONS
  // =========================================================================

  createAction(
    subjectId: string,
    verbName: string,
    objectId?: string,
    metadata?: Record<string, unknown>
  ): ActionResult {
    const subject = this.semanticThings.get(subjectId)
    const verb = this.verbs.get(verbName)
    const object = objectId ? this.semanticThings.get(objectId) : undefined

    if (!subject) {
      throw new Error(`Subject thing not found: ${subjectId}`)
    }

    if (!verb) {
      throw new Error(`Verb not found: ${verbName}`)
    }

    const timestamp = new Date()

    // Create event record
    const event: ActionResult['event'] = {
      type: verb.past,
      subject: subjectId,
      timestamp,
    }

    if (object) {
      event.object = objectId
    }

    if (metadata) {
      event.metadata = metadata
    }

    // Create edge record
    const edge: ActionResult['edge'] = {
      from: subjectId,
      to: objectId ?? '',
      verb: verb.past,
    }

    // Store edge in memory and SQLite
    if (object) {
      const edgeRecord: Edge = {
        from: subjectId,
        fromType: subject.$type,
        to: objectId!,
        toType: object.$type,
        verb: verb.past,
      }
      this.edges.push(edgeRecord)
      this.ctx.storage.sql.exec(
        'INSERT INTO edges (from_id, from_type, to_id, to_type, verb) VALUES (?, ?, ?, ?, ?)',
        edgeRecord.from,
        edgeRecord.fromType,
        edgeRecord.to,
        edgeRecord.toType,
        edgeRecord.verb
      )
    }

    // Create audit record
    const audit: ActionResult['audit'] = {
      actor: subjectId,
      verb: verb.past,
      target: objectId ?? '',
      timestamp,
    }

    return {
      success: true,
      event,
      edge,
      audit,
    }
  }

  // =========================================================================
  // RELATIONSHIP TRAVERSAL
  // =========================================================================

  forward(fromId: string, targetType: string): Thing[] {
    const results: Thing[] = []

    for (const edge of this.edges) {
      if (edge.from === fromId && edge.toType === targetType) {
        const targetThing = this.semanticThings.get(edge.to)
        if (targetThing) {
          results.push(targetThing)
        }
      }
    }

    return results
  }

  backward(toId: string, sourceType: string): Thing[] {
    const results: Thing[] = []

    for (const edge of this.edges) {
      if (edge.to === toId && edge.fromType === sourceType) {
        const sourceThing = this.semanticThings.get(edge.from)
        if (sourceThing) {
          results.push(sourceThing)
        }
      }
    }

    return results
  }

  async forwardFuzzy(
    fromId: string,
    targetType: string,
    options?: { threshold?: number; withScores?: boolean }
  ): Promise<Thing[] | Array<Thing & { score: number }>> {
    const exactMatches = this.forward(fromId, targetType)
    const threshold = options?.threshold ?? 0
    const withScores = options?.withScores ?? false

    // Simulate fuzzy matching with scores
    const scoredResults = exactMatches.map((thing) => ({
      ...thing,
      score: 0.95,
    }))

    const filtered = scoredResults.filter((r) => r.score >= threshold)

    if (withScores) {
      return filtered
    }

    return filtered.map(({ score, ...rest }) => rest as Thing)
  }

  async backwardFuzzy(
    toId: string,
    sourceType: string,
    options?: { threshold?: number; withScores?: boolean }
  ): Promise<Thing[] | Array<Thing & { score: number }>> {
    const exactMatches = this.backward(toId, sourceType)
    const threshold = options?.threshold ?? 0
    const withScores = options?.withScores ?? false

    const scoredResults = exactMatches.map((thing) => ({
      ...thing,
      score: 0.95,
    }))

    const filtered = scoredResults.filter((r) => r.score >= threshold)

    if (withScores) {
      return filtered
    }

    return filtered.map(({ score, ...rest }) => rest as Thing)
  }
}

// ============================================================================
// Default Worker Export
// ============================================================================

export default {
  async fetch(request: Request, env: DOSemanticEnv): Promise<Response> {
    const url = new URL(request.url)
    const hostParts = url.hostname.split('.')
    const ns = hostParts.length > 2 ? hostParts[0] : 'default'

    const id = env.DOSemantic.idFromName(ns)
    const stub = env.DOSemantic.get(id)

    return stub.fetch(request)
  },
}
