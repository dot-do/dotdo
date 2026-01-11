/**
 * ThingDO - Heterogeneous Multi-Type Container
 *
 * Unlike Collection<T> which holds a single type (homogeneous),
 * ThingDO can hold multiple types (heterogeneous).
 *
 * Key differences:
 * - Collection<T>: homogeneous, $id = ns/id, itemType = type URL
 * - ThingDO: heterogeneous, $id = ns/type/id, no itemType
 */

import type { Thing, ThingData } from './Thing'

// ============================================================================
// TYPE CONSTANTS
// ============================================================================

/**
 * DO type discriminator for heterogeneous containers
 */
export const THING_DO_TYPE = 'https://schema.org.ai/Thing' as const

/**
 * DO type discriminator for homogeneous containers
 */
export const COLLECTION_TYPE = 'https://schema.org.ai/Collection' as const

/**
 * Union type for DO type discriminators
 */
export type DOType = typeof THING_DO_TYPE | typeof COLLECTION_TYPE

// ============================================================================
// COLLECTION VIEW INTERFACE
// ============================================================================

/**
 * CollectionView provides typed access to items of a specific type
 * within a HeterogeneousThingDO.
 *
 * This allows type-safe operations without requiring type parameter
 * on every method call.
 */
export interface CollectionView<T extends Thing> {
  /**
   * Get a single item by id
   * @param id - The item id (without type prefix)
   * @returns The item or null if not found
   */
  get(id: string): Promise<T | null>

  /**
   * List all items of this type
   * @returns Array of items
   */
  list(): Promise<T[]>

  /**
   * Find items matching a query
   * @param query - Key-value pairs to match against item data
   * @returns Array of matching items
   */
  find(query: Record<string, unknown>): Promise<T[]>
}

// ============================================================================
// HETEROGENEOUS THING DO INTERFACE
// ============================================================================

/**
 * HeterogeneousThingDO is a Durable Object that can hold multiple types.
 *
 * Unlike Collection<T> which is homogeneous (single type), ThingDO can
 * store Contacts, Orders, Products, etc. all in the same DO.
 *
 * Item $id format: ns/type/id (e.g., https://example.com.ai/Contact/john)
 */
export interface HeterogeneousThingDO {
  /**
   * Type discriminator - always 'https://schema.org.ai/Thing' for heterogeneous containers
   */
  readonly $type: 'https://schema.org.ai/Thing'

  /**
   * Namespace URL - the DO's identity
   */
  readonly ns: string

  /**
   * Build a fully qualified item $id
   * @param type - The item type (e.g., 'Contact')
   * @param id - The item id (e.g., 'john')
   * @returns Full $id (e.g., 'https://example.com.ai/Contact/john')
   */
  buildItemId(type: string, id: string): string

  /**
   * Get an item by type and id
   * @param type - The item type
   * @param id - The item id
   * @returns The item or null if not found
   */
  get(type: string, id: string): Promise<Thing | null>

  /**
   * Create a new item
   * @param type - The item type
   * @param id - The item id
   * @param data - The item data
   * @returns The created item
   */
  create(type: string, id: string, data: Partial<ThingData>): Promise<Thing>

  /**
   * Update an existing item
   * @param type - The item type
   * @param id - The item id
   * @param data - The data to update
   * @returns The updated item or null if not found
   */
  update(type: string, id: string, data: Partial<ThingData>): Promise<Thing | null>

  /**
   * Delete an item
   * @param type - The item type
   * @param id - The item id
   */
  delete(type: string, id: string): Promise<void>

  /**
   * List all items of a specific type
   * @param type - The item type
   * @returns Array of items of that type
   */
  list(type: string): Promise<Thing[]>

  /**
   * Get a typed collection view for a specific type
   * @param type - The item type
   * @returns CollectionView for type-safe operations
   */
  collection<T extends Thing>(type: string): CollectionView<T>
}

// ============================================================================
// TYPE GUARDS
// ============================================================================

/**
 * Check if an object is a heterogeneous container (ThingDO)
 *
 * A heterogeneous container has:
 * - $type = 'https://schema.org.ai/Thing'
 * - no itemType property
 */
export function isHeterogeneousContainer(obj: unknown): obj is HeterogeneousThingDO {
  if (!obj || typeof obj !== 'object') {
    return false
  }

  const candidate = obj as Record<string, unknown>

  // Must have $type = THING_DO_TYPE
  if (candidate.$type !== THING_DO_TYPE) {
    return false
  }

  // Must NOT have itemType property (heterogeneous = no single type)
  if ('itemType' in candidate && candidate.itemType !== undefined) {
    return false
  }

  return true
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a HeterogeneousThingDO instance
 *
 * This is a minimal implementation for making tests pass.
 * In production, this would integrate with the DO base class.
 */
export function createThingDO(
  state: DurableObjectState,
  env: unknown,
): HeterogeneousThingDO {
  // Internal storage for items: Map<`${type}/${id}`, Thing>
  const items = new Map<string, Thing>()

  // Namespace - will be set externally in tests
  let ns = ''

  const thingDO: HeterogeneousThingDO = {
    $type: THING_DO_TYPE,

    get ns() {
      return ns
    },

    set ns(value: string) {
      ns = value
    },

    buildItemId(type: string, id: string): string {
      return `${ns}/${type}/${id}`
    },

    async get(type: string, id: string): Promise<Thing | null> {
      const key = `${type}/${id}`
      return items.get(key) ?? null
    },

    async create(type: string, id: string, data: Partial<ThingData>): Promise<Thing> {
      const key = `${type}/${id}`
      const $id = `${ns}/${type}/${id}`
      const $type = `${ns}/${type}`

      const thing: Thing = {
        ...data,
        $id,
        $type,
        createdAt: data.createdAt ?? new Date(),
        updatedAt: data.updatedAt ?? new Date(),
      } as Thing

      items.set(key, thing)
      return thing
    },

    async update(type: string, id: string, data: Partial<ThingData>): Promise<Thing | null> {
      const key = `${type}/${id}`
      const existing = items.get(key)

      if (!existing) {
        return null
      }

      const updated: Thing = {
        ...existing,
        ...data,
        $id: existing.$id,
        $type: existing.$type,
        updatedAt: new Date(),
      } as Thing

      items.set(key, updated)
      return updated
    },

    async delete(type: string, id: string): Promise<void> {
      const key = `${type}/${id}`
      items.delete(key)
    },

    async list(type: string): Promise<Thing[]> {
      const result: Thing[] = []
      const prefix = `${type}/`

      for (const [key, thing] of items) {
        if (key.startsWith(prefix)) {
          result.push(thing)
        }
      }

      return result
    },

    collection<T extends Thing>(type: string): CollectionView<T> {
      return {
        get: async (id: string): Promise<T | null> => {
          return (await thingDO.get(type, id)) as T | null
        },

        list: async (): Promise<T[]> => {
          return (await thingDO.list(type)) as T[]
        },

        find: async (query: Record<string, unknown>): Promise<T[]> => {
          const all = await thingDO.list(type)
          return all.filter((item) => {
            for (const [key, value] of Object.entries(query)) {
              if ((item as unknown as Record<string, unknown>)[key] !== value) {
                return false
              }
            }
            return true
          }) as T[]
        },
      }
    },
  } as HeterogeneousThingDO

  // Allow ns to be set externally
  Object.defineProperty(thingDO, 'ns', {
    get: () => ns,
    set: (value: string) => {
      ns = value
    },
    enumerable: true,
    configurable: true,
  })

  return thingDO
}
