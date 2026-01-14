import { z } from 'zod'
import type { Noun } from '../../nouns/types'
import { DO as DOBase, type Env } from './DOBase'
import type { ThingEntity } from '../../db/stores'

/**
 * Create a Durable Object class from a Noun definition.
 *
 * @example
 * ```typescript
 * import { Startup } from 'dotdo/nouns'
 *
 * // Create a DO class for the Startup noun
 * export class MyStartup extends createDO(Startup) {
 *   // Add custom methods here
 * }
 *
 * // Or use directly
 * const StartupDO = createDO(Startup)
 * ```
 */
export function createDO<T extends Noun>(noun: T) {
  return class NounDO extends DOBase {
    static readonly noun = noun

    /**
     * Get the unique identifier for this noun instance.
     * Returns the DO's internal ID as a string.
     */
    protected get id(): string {
      return this.ctx.id.toString()
    }

    /**
     * Get the data for this noun instance
     */
    async getData(): Promise<z.infer<T['schema']> | null> {
      const thing = await this.things.get(this.id)
      if (!thing) return null
      return noun.schema.parse(thing) as z.infer<T['schema']>
    }

    /**
     * Set/update the data for this noun instance
     */
    async setData(data: Partial<z.infer<T['schema']>>): Promise<z.infer<T['schema']>> {
      const existing = await this.getData()
      const merged = {
        ...(existing as Record<string, unknown> ?? {}),
        ...(data as Record<string, unknown>),
        $type: noun.$type,
      }
      const validated = noun.schema.parse(merged) as z.infer<T['schema']>

      if (existing) {
        await this.things.update(this.id, validated as Partial<ThingEntity>)
      } else {
        await this.things.create({ $id: this.id, ...(validated as Record<string, unknown>) } as Partial<ThingEntity>)
      }

      await this.events.emit({
        verb: `${noun.noun}.updated`,
        source: this.ns || this.id,
        data: { data: validated as Record<string, unknown> },
      })
      return validated
    }

    /**
     * Validate data against the noun schema
     */
    validate(data: unknown): z.infer<T['schema']> {
      return noun.schema.parse(data) as z.infer<T['schema']>
    }

    /**
     * Check if data matches the noun schema
     */
    isValid(data: unknown): data is z.infer<T['schema']> {
      return noun.schema.safeParse(data).success
    }
  }
}

/**
 * Alias for createDO - enables DO(Noun) syntax via function call
 */
export const DO = createDO

/**
 * Create a DO that holds a collection of a noun type
 */
export function createCollectionDO<T extends Noun>(noun: T) {
  return class CollectionNounDO extends DOBase {
    static readonly noun = noun
    static readonly isCollection = true

    /**
     * List all items in the collection
     */
    async list(): Promise<z.infer<T['schema']>[]> {
      const items = await this.things.list({ type: noun.$type })
      return items.map((item) => noun.schema.parse(item)) as z.infer<T['schema']>[]
    }

    /**
     * Get a single item by ID
     */
    async get(id: string): Promise<z.infer<T['schema']> | null> {
      const thing = await this.things.get(id)
      if (!thing || thing.$type !== noun.$type) return null
      return noun.schema.parse(thing) as z.infer<T['schema']>
    }

    /**
     * Create a new item in the collection
     */
    async create(data: Omit<z.infer<T['schema']>, '$id' | '$type'>): Promise<z.infer<T['schema']>> {
      const id = crypto.randomUUID()
      const full = { $id: id, $type: noun.$type, ...(data as Record<string, unknown>) }
      const validated = noun.schema.parse(full) as z.infer<T['schema']>
      await this.things.create(validated as Partial<ThingEntity>)
      await this.events.emit({
        verb: `${noun.noun}.created`,
        source: this.ns || id,
        data: { data: validated as Record<string, unknown> },
      })
      return validated
    }

    /**
     * Update an item in the collection
     */
    async update(
      id: string,
      data: Partial<z.infer<T['schema']>>
    ): Promise<z.infer<T['schema']> | null> {
      const existing = await this.get(id)
      if (!existing) return null
      const merged = { ...(existing as Record<string, unknown>), ...(data as Record<string, unknown>) }
      const validated = noun.schema.parse(merged) as z.infer<T['schema']>
      await this.things.update(id, validated as Partial<ThingEntity>)
      await this.events.emit({
        verb: `${noun.noun}.updated`,
        source: this.ns || id,
        data: { id, data: validated as Record<string, unknown> },
      })
      return validated
    }

    /**
     * Delete an item from the collection
     */
    async delete(id: string): Promise<boolean> {
      const existing = await this.get(id)
      if (!existing) return false
      await this.things.delete(id)
      await this.events.emit({
        verb: `${noun.noun}.deleted`,
        source: this.ns || id,
        data: { id },
      })
      return true
    }

    /**
     * Count items in the collection
     */
    async count(): Promise<number> {
      const items = await this.things.list({ type: noun.$type })
      return items.length
    }
  }
}
