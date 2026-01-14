import { z } from 'zod'

/**
 * Noun definition - a type that can be instantiated as a Thing or promoted to a DO
 */
export interface Noun<T extends z.ZodType = z.ZodType> {
  /** Singular name (e.g., 'Startup') */
  noun: string
  /** Plural name (e.g., 'Startups') */
  plural: string
  /** JSON-LD type URL */
  $type: string
  /** Zod schema for validation */
  schema: T
  /** Parent Noun this extends (for inheritance) */
  extends?: string
  /** OKRs this Noun tracks (for business entities) */
  okrs?: string[]
  /** Default values */
  defaults?: Partial<z.infer<T>>
}

/**
 * Create a Noun definition
 */
export function defineNoun<T extends z.ZodType>(config: Noun<T>): Noun<T> {
  return config
}

/**
 * AnyNoun - A Noun with any schema type.
 *
 * Use this type when you need to allow subclasses to override static noun
 * properties with different schema types (e.g., Worker -> Agent, Business -> SaaS).
 * The base class declares `static readonly noun: AnyNoun = ...` so subclasses
 * can override with their own schema without type conflicts.
 */
export type AnyNoun = Noun<z.ZodType>

/**
 * Collection wrapper - represents a collection of Nouns
 */
export function Collection<T extends Noun>(noun: T): Noun<z.ZodArray<T['schema']>> & { itemType: T } {
  return {
    noun: noun.plural,
    plural: noun.plural,
    $type: 'https://schema.org.ai/Collection',
    schema: z.array(noun.schema),
    itemType: noun
  } as Noun<z.ZodArray<T['schema']>> & { itemType: T }
}
