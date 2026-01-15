/**
 * Thing - Core entity type for the dotdo runtime
 *
 * Things are the fundamental data entities in dotdo. Each Thing has:
 * - A unique `$id` (URL-style identifier)
 * - A `$type` (schema.org.ai type URL)
 * - Versioning with `$version` and `$head`
 * - Relationships to other Things
 *
 * Things can be promoted to their own Durable Object (ThingDO) when they
 * need independent storage and behavior.
 *
 * @module types/Thing
 *
 * @example
 * ```typescript
 * import type { Thing, ThingDO } from 'dotdo/types'
 *
 * // A Thing is a data entity
 * const startup: Thing = {
 *   $id: 'https://startups.studio/acme',
 *   $type: 'https://schema.org.ai/Startup',
 *   $version: 1,
 *   name: 'Acme Inc',
 *   stage: 'seed',
 *   relationships: {},
 *   references: {}
 * }
 *
 * // Check if a Thing is also a DO
 * if (startup.isDO) {
 *   // This Thing has been promoted to its own Durable Object
 * }
 * ```
 */

import type { RpcPromise } from './fn'

// Re-export base types from ThingBase (breaks circular dependency with Things.ts)
export {
  type Visibility,
  type Actor,
  type ThingData,
  type ThingIdentity,
  type ThingsInterface,
  parseThingId,
  buildThingId,
  isPublic,
  isUnlisted,
  isOrgVisible,
  isUserOnly,
  canView,
} from './ThingBase'

import type { ThingData, ThingIdentity, Actor, ThingsInterface } from './ThingBase'

/**
 * Thing - Core entity interface with operations
 *
 * Extends ThingData with computed properties, relationships, and CRUD operations.
 * Things are the primary data type in dotdo, representing domain entities
 * with full versioning and relationship tracking.
 *
 * @see {@link ThingData} for the base data structure
 * @see {@link ThingDO} for Things promoted to their own Durable Object
 */
export interface Thing extends ThingData {
  // ═══════════════════════════════════════════════════════════════════════════
  // IDENTITY (computed from $id)
  // ═══════════════════════════════════════════════════════════════════════════

  /** Parsed identity components from the $id URL */
  readonly identity: ThingIdentity

  /** Whether this Thing is also a Durable Object (its $id matches its namespace) */
  readonly isDO: boolean

  // ═══════════════════════════════════════════════════════════════════════════
  // RELATIONSHIPS (merged from relationships table)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Outbound edges by verb (camelCase)
   * @example { manages: { $type: 'https://schema.org/Person', $id: '...', name: 'John' } }
   */
  relationships: Record<string, Thing | Thing[]>

  /**
   * Inbound edges by reverse verb
   * @example { managedBy: { $type: 'https://startups.studio/Business', $id: '...', name: 'Acme' } }
   */
  references: Record<string, Thing | Thing[]>

  // ═══════════════════════════════════════════════════════════════════════════
  // OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Update this Thing with new data
   * @param data - Partial data to merge into the Thing
   * @returns The updated Thing
   */
  update(data: Partial<ThingData>): RpcPromise<Thing>

  /**
   * Delete this Thing
   * @returns Promise that resolves when deletion is complete
   */
  delete(): RpcPromise<void>

  /**
   * Promote this Thing to its own Durable Object
   * The Thing's $id becomes the namespace for the new DO
   * @returns The promoted ThingDO
   */
  promote(): RpcPromise<ThingDO>

  /**
   * Create a relationship to another Thing or URL
   * @param verb - The relationship verb (e.g., 'manages', 'owns')
   * @param to - The target Thing or its URL
   */
  relate(verb: string, to: string | Thing): RpcPromise<void>

  /**
   * Remove a relationship to another Thing or URL
   * @param verb - The relationship verb to remove
   * @param to - The target Thing or its URL
   */
  unrelate(verb: string, to: string | Thing): RpcPromise<void>
}

// ============================================================================
// THING DO - A Thing that has been promoted to its own Durable Object
// ============================================================================

/**
 * ThingDO - A Thing that has been promoted to its own Durable Object
 *
 * When a Thing is promoted, it becomes a namespace that can contain
 * its own collections of Things. ThingDOs can also be linked to
 * git repositories for version control synchronization.
 *
 * @see {@link Thing} for the base Thing interface
 * @see {@link Thing.promote} for promoting a Thing to ThingDO
 *
 * @example
 * ```typescript
 * // Promote a Thing to its own DO
 * const thingDO = await thing.promote()
 *
 * // Access collections within the ThingDO
 * const customers = thingDO.collection<Customer>('Customer')
 * await customers.create({ name: 'Alice' })
 * ```
 */
export interface ThingDO extends Thing {
  /** This Thing IS a Durable Object (always true for ThingDO) */
  readonly isDO: true

  /**
   * Get a typed collection of Things within this DO
   * @param noun - The noun name for the collection type
   * @returns A ThingsInterface for the specified type
   */
  collection<T extends Thing = Thing>(noun: string): ThingsInterface<T>

  /**
   * Git binding for repository synchronization
   * Links this DO to a git repository for version control
   */
  $git?: {
    /** Repository URL (e.g., 'https://github.com/drivly/startups.studio') */
    repo: string
    /** Path within the repository ('' for root, 'packages/core' for monorepo) */
    path: string
    /** Current branch context */
    branch: string
    /** Current synced commit hash */
    commit: string
    /** Synchronization mode */
    syncMode: 'pull' | 'push' | 'mirror'
    /** Last synchronization timestamp */
    lastSyncAt: Date
  }

  /** Parent DO relationship for hierarchical DOs */
  $parent?: ThingDO

  /** Child DOs (branches, shards, etc.) */
  $children?: ThingDO[]
}

// ═══════════════════════════════════════════════════════════════════════════
// THING-SPECIFIC UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

import { parseThingId } from './ThingBase'

/**
 * Check if a Thing is also a Durable Object
 *
 * A Thing is a DO when its $id matches its namespace (no path component).
 * This indicates the Thing has been promoted to its own Durable Object.
 *
 * @param thing - The Thing to check
 * @returns True if the Thing is a Durable Object
 *
 * @example
 * ```typescript
 * const thing1 = { $id: 'https://startups.studio', ... }
 * const thing2 = { $id: 'https://startups.studio/acme', ... }
 *
 * isThingADO(thing1) // true - $id IS the namespace
 * isThingADO(thing2) // false - $id has a path component
 * ```
 */
export function isThingADO(thing: Thing): boolean {
  // A Thing is a DO when its $id IS the namespace (no path)
  const { path } = parseThingId(thing.$id)
  return path === '' || thing.$id === thing.identity.ns
}
