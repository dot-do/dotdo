// Digital Objects Integration for @dotdo/db
// Adapts digital-objects provider to @dotdo/db Thing interface

import type { StorableData } from './types'
import type { Thing, ThingsStore, ThingListOptions } from './things'
import type { ThingId } from './branded-types'

// ============================================================================
// Local type definitions (previously from primitives/digital-objects)
// ============================================================================

/**
 * Field definition for noun schemas
 */
export interface ExtendedFieldDefinition {
  type: string
  required?: boolean
  default?: unknown
  description?: string
}

/**
 * Schema definition for a Noun
 */
export type NounSchema = Record<string, string | ExtendedFieldDefinition>

/**
 * Noun definition (type/class of digital object)
 */
export interface Noun {
  name: string
  schema?: NounSchema
  description?: string
  plural?: string
}

/**
 * Digital object (thing instance)
 */
export interface DOThing<T extends StorableData = StorableData> {
  id: string
  noun: string
  data: T
  createdAt: Date
  updatedAt: Date
}

/**
 * Validation options for digital objects operations
 */
export interface DOValidationOptions {
  validate?: boolean
}

/**
 * List options for querying digital objects
 */
export interface DOListOptions {
  limit?: number
  offset?: number
  where?: Record<string, unknown>
  orderBy?: string
  order?: 'asc' | 'desc'
}

/**
 * Digital objects provider interface
 */
export interface DigitalObjectsProvider {
  create<T extends StorableData>(
    noun: string,
    data: T,
    id?: string,
    options?: DOValidationOptions
  ): Promise<DOThing<T>>
  get(id: string): Promise<DOThing | null>
  update(id: string, data: StorableData, options?: DOValidationOptions): Promise<DOThing>
  delete(id: string): Promise<boolean>
  list(noun: string, options?: DOListOptions): Promise<DOThing[]>
  getNoun(name: string): Promise<Noun | null>
  listNouns(): Promise<Noun[]>
}

/**
 * Extended ThingsStore with digital-objects features
 */
export interface DigitalObjectsThingsStore extends ThingsStore {
  // Expose noun management
  getNoun(name: string): Promise<Noun | null>
  listNouns(): Promise<Noun[]>
}

/**
 * Validation options that match @dotdo/db convention
 */
export interface ValidationOptions {
  validate?: boolean | undefined
}

/**
 * Map digital-objects Thing to @dotdo/db Thing
 *
 * Conversions:
 * - id -> $id
 * - noun -> $type
 * - createdAt (Date) -> $createdAt (number)
 * - updatedAt (Date) -> $updatedAt (number)
 * - data.* -> * (flatten data fields to top level)
 */
function mapToDbThing<T extends StorableData>(doThing: DOThing<T>): Thing {
  return {
    $id: doThing.id as ThingId,
    $type: doThing.noun,
    $createdAt: doThing.createdAt.getTime(),
    $updatedAt: doThing.updatedAt.getTime(),
    ...doThing.data,
  }
}

/**
 * Extract data payload from @dotdo/db Thing format
 *
 * Removes metadata fields ($id, $type, $createdAt, $updatedAt)
 * to get the data payload for digital-objects
 */
function extractData<T extends StorableData>(dbThing: Partial<T>): StorableData {
  const { $id, $type, $createdAt, $updatedAt, ...data } = dbThing as any
  return data
}

/**
 * Convert @dotdo/db validation options to digital-objects format
 */
function convertValidationOptions(options?: ValidationOptions): DOValidationOptions | undefined {
  if (!options) return undefined
  // Handle undefined explicitly for exactOptionalPropertyTypes
  if (options.validate === undefined) return undefined
  return { validate: options.validate }
}

/**
 * Create a ThingsStore adapter that uses a digital-objects provider
 *
 * @param provider - DigitalObjectsProvider (MemoryProvider, NS, etc.)
 * @returns ThingsStore compatible with @dotdo/db
 *
 * @example
 * ```typescript
 * import { createMemoryProvider } from 'digital-objects'
 * import { createDigitalObjectsAdapter } from '@dotdo/db'
 *
 * const provider = createMemoryProvider()
 * await provider.defineNoun({
 *   name: 'Customer',
 *   schema: {
 *     name: { type: 'string', required: true },
 *     email: 'string?',
 *   }
 * })
 *
 * const store = createDigitalObjectsAdapter(provider)
 * const customer = await store.create({ $type: 'Customer', name: 'Alice' })
 * ```
 */
export function createDigitalObjectsAdapter(
  provider: DigitalObjectsProvider
): DigitalObjectsThingsStore {
  return {
    async create<D extends Partial<StorableData> & { $type: string }>(data: D, options?: ValidationOptions): Promise<Thing & D> {
      const { $type, ...payload } = data as any

      if (!$type) {
        throw new Error('$type is required')
      }

      // Check if noun exists
      const noun = await provider.getNoun($type)
      if (!noun) {
        throw new Error(`Noun not found: ${$type}`)
      }

      const doThing = await provider.create(
        $type,
        payload,
        undefined,
        convertValidationOptions(options)
      )

      return mapToDbThing(doThing) as Thing & D
    },

    async get(id) {
      const doThing = await provider.get(id)
      if (!doThing) return null

      return mapToDbThing(doThing as DOThing<StorableData>)
    },

    async update(id, data, options?: ValidationOptions) {
      const payload = extractData(data)

      const doThing = await provider.update(
        id,
        payload,
        convertValidationOptions(options)
      )

      return mapToDbThing(doThing)
    },

    async delete(id) {
      const result = await provider.delete(id)
      if (!result) {
        throw new Error(`Thing not found: ${id}`)
      }
    },

    async list(listOptions: ThingListOptions & { where?: unknown; orderBy?: string; order?: 'asc' | 'desc' } = {}) {
      const { type, limit, offset, where, orderBy, order } = listOptions

      if (!type) {
        // If no type specified, we need to get all things
        // This is tricky with digital-objects since it's noun-based
        // For now, throw an error requiring type
        throw new Error('type is required for list operation')
      }

      // Build DOListOptions, only including defined properties
      const doOptions: DOListOptions = {}
      if (limit !== undefined) doOptions.limit = limit
      if (offset !== undefined) doOptions.offset = offset
      if (where !== undefined && where !== null) doOptions.where = where as Record<string, unknown>
      if (orderBy !== undefined) doOptions.orderBy = orderBy
      if (order !== undefined) doOptions.order = order

      const doThings = await provider.list(type, doOptions)

      return doThings.map((t) => mapToDbThing(t as DOThing<StorableData>))
    },

    async getMany(ids: string[]): Promise<Map<string, Thing>> {
      const result = new Map<string, Thing>()
      for (const id of ids) {
        const doThing = await provider.get(id)
        if (doThing) {
          result.set(id, mapToDbThing(doThing as DOThing<StorableData>))
        }
      }
      return result
    },

    async listWithCursor(options = {}) {
      // Use basic list since digital-objects doesn't have cursor pagination natively
      const items = await this.list(options)
      return {
        items,
        nextCursor: undefined,
        prevCursor: undefined,
        hasMore: false
      }
    },

    async bulkCreate<D extends Partial<StorableData> & { $type: string }>(items: D[]): Promise<(Thing & D)[]> {
      const results: (Thing & D)[] = []
      for (const data of items) {
        const result = await this.create(data)
        results.push(result as Thing & D)
      }
      return results
    },

    async bulkUpdate(items: Array<{ id: string; data: Record<string, unknown> }>): Promise<Thing[]> {
      const results: Thing[] = []
      for (const { id, data } of items) {
        const result = await this.update(id, data as Partial<Omit<StorableData, '$id' | '$type'>>)
        results.push(result)
      }
      return results
    },

    async bulkDelete(ids: string[]): Promise<void> {
      for (const id of ids) {
        await this.delete(id)
      }
    },

    // Additional digital-objects features
    async getNoun(name: string) {
      return await provider.getNoun(name)
    },

    async listNouns() {
      return await provider.listNouns()
    },
  }
}

/**
 * Type mapping utilities for schema generation
 */
export const TypeMapping = {
  /**
   * Map digital-objects field type to TypeScript type
   */
  toTypeScript(fieldType: string): string {
    // Handle optional marker
    const isOptional = fieldType.endsWith('?')
    const baseType = isOptional ? fieldType.slice(0, -1) : fieldType

    let tsType: string
    switch (baseType) {
      case 'string':
      case 'markdown':
      case 'url':
        tsType = 'string'
        break
      case 'number':
        tsType = 'number'
        break
      case 'boolean':
        tsType = 'boolean'
        break
      case 'date':
      case 'datetime':
        tsType = 'Date | string' // Accept both
        break
      case 'json':
        tsType = 'unknown'
        break
      case 'object':
        tsType = 'StorableData'
        break
      case 'array':
        tsType = 'unknown[]'
        break
      default:
        // Might be a relation like 'Author.posts'
        if (baseType.includes('.')) {
          tsType = 'string' // Relation ID
        } else {
          tsType = 'unknown'
        }
    }

    return isOptional ? `${tsType} | undefined` : tsType
  },

  /**
   * Generate TypeScript interface from Noun schema
   */
  generateInterface(noun: Noun): string {
    if (!noun.schema) {
      return `export interface ${noun.name} {\n  [key: string]: unknown\n}`
    }

    const fields: string[] = []

    for (const [fieldName, fieldDef] of Object.entries(noun.schema)) {
      let fieldType: string

      if (typeof fieldDef === 'string') {
        fieldType = TypeMapping.toTypeScript(fieldDef)
      } else {
        // ExtendedFieldDefinition
        const baseType = TypeMapping.toTypeScript(fieldDef.type)
        fieldType = fieldDef.required ? baseType : `${baseType} | undefined`
      }

      fields.push(`  ${fieldName}: ${fieldType}`)
    }

    return `export interface ${noun.name} {\n${fields.join('\n')}\n}`
  },
}

/**
 * Schema validation helper
 *
 * Validates data against a noun's schema without creating the thing
 */
export async function validateSchema(
  provider: DigitalObjectsProvider,
  nounName: string,
  data: StorableData
): Promise<{ valid: boolean; errors: Array<{ field: string; message: string }> }> {
  const noun = await provider.getNoun(nounName)
  if (!noun) {
    return {
      valid: false,
      errors: [{ field: '$type', message: `Noun not found: ${nounName}` }],
    }
  }

  if (!noun.schema) {
    return { valid: true, errors: [] }
  }

  // Simple schema validation - check required fields and types
  const errors: Array<{ field: string; message: string }> = []

  for (const [fieldName, fieldDef] of Object.entries(noun.schema)) {
    const isRequired = typeof fieldDef === 'object'
      ? fieldDef.required === true
      : !fieldDef.endsWith('?')

    const value = (data as Record<string, unknown>)[fieldName]

    if (isRequired && (value === undefined || value === null)) {
      errors.push({ field: fieldName, message: `${fieldName} is required` })
    }
  }

  return {
    valid: errors.length === 0,
    errors
  }
}

// Note: Noun and DOValidationOptions are now exported from the local type definitions above
