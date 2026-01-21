// Digital Objects Integration for @dotdo/db
// Adapts digital-objects provider to @dotdo/db Thing interface

import type {
  DigitalObjectsProvider,
  Thing as DOThing,
  Noun,
  ValidationOptions as DOValidationOptions,
  ListOptions as DOListOptions,
} from '../primitives/packages/digital-objects/src/types.js'
import type { Thing, ThingsStore } from './things'
import { toThingId } from './branded-types'

/**
 * Extended ThingsStore with digital-objects features.
 * Overrides create signature since digital-objects may transform data.
 */
export interface DigitalObjectsThingsStore extends Omit<ThingsStore, 'create'> {
  // Override create with simplified return type
  create(data: { $type: string } & Record<string, unknown>, options?: ValidationOptions): Promise<Thing>
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
function mapToDbThing(doThing: DOThing<unknown>): Thing {
  const data = doThing.data as Record<string, unknown> | null
  return {
    $id: toThingId(doThing.id),
    $type: doThing.noun,
    $createdAt: doThing.createdAt.getTime(),
    $updatedAt: doThing.updatedAt.getTime(),
    ...(data ?? {}),
  }
}

/**
 * Extract data payload from @dotdo/db Thing format
 *
 * Removes metadata fields ($id, $type, $createdAt, $updatedAt)
 * to get the data payload for digital-objects
 */
function extractData<T extends Record<string, unknown>>(dbThing: Partial<T>): Record<string, unknown> {
  const { $id, $type, $createdAt, $updatedAt, ...data } = dbThing as any
  return data
}

/**
 * Convert @dotdo/db validation options to digital-objects format
 */
function convertValidationOptions(options?: ValidationOptions): DOValidationOptions | undefined {
  if (!options) return undefined
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
    async create(data, options?: ValidationOptions) {
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

      return mapToDbThing(doThing)
    },

    async get(id) {
      const doThing = await provider.get(id)
      if (!doThing) return null

      return mapToDbThing(doThing)
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

    async list(listOptions: { type?: string; limit?: number; offset?: number; where?: Record<string, unknown>; orderBy?: string; order?: 'asc' | 'desc' } = {}) {
      const { type, limit, offset, where, orderBy, order } = listOptions

      if (!type) {
        // If no type specified, we need to get all things
        // This is tricky with digital-objects since it's noun-based
        // For now, throw an error requiring type
        throw new Error('type is required for list operation')
      }

      const doOptions: DOListOptions = {
        limit,
        offset,
        where,
        orderBy,
        order,
      }

      const doThings = await provider.list(type, doOptions)

      return doThings.map(mapToDbThing)
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
        tsType = 'Record<string, unknown>'
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
  data: Record<string, unknown>
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

  try {
    // Use digital-objects validation
    const { validateOnly } = await import('../primitives/packages/digital-objects/src/schema-validation.js')
    const result = validateOnly(data, noun.schema)

    return {
      valid: result.valid,
      errors: result.errors.map(e => ({
        field: e.field,
        message: e.message,
      })),
    }
  } catch (error) {
    return {
      valid: false,
      errors: [{ field: 'unknown', message: String(error) }],
    }
  }
}

/**
 * Re-export digital-objects types for convenience
 */
export type { Noun, ValidationOptions as DOValidationOptions } from '../primitives/packages/digital-objects/src/types.js'
