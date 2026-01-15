/**
 * ThingBase - Shared types between Thing.ts and Things.ts
 *
 * This file exists to break the circular dependency between Thing.ts and Things.ts.
 * Both files import from here instead of from each other.
 *
 * @module types/ThingBase
 */

import type { RpcPromise } from './fn'

// ============================================================================
// VISIBILITY - Access control for Things
// ============================================================================

/**
 * Visibility levels for access control on Things
 *
 * - `public`: Visible to everyone
 * - `unlisted`: Visible to anyone with the link
 * - `org`: Visible only to organization members
 * - `user`: Visible only to the owner (default)
 */
export type Visibility = 'public' | 'unlisted' | 'org' | 'user'

/**
 * Actor - Represents the user/org context for access control checks
 */
export interface Actor {
  /** User ID for user-level access checks */
  userId?: string
  /** Organization ID for org-level access checks */
  orgId?: string
}

// ============================================================================
// THING DATA - Base data interface without operations
// ============================================================================

/**
 * ThingData - Base data structure for Things without operations
 *
 * Defines the core fields that every Thing has. This is the stored
 * representation of a Thing, without computed properties or methods.
 *
 * @see {@link ThingIdentity} for parsed identity information
 */
export interface ThingData {
  /** Fully qualified URL identifier (e.g., 'https://startups.studio/headless.ly') */
  $id: string
  /** Fully qualified type URL (e.g., 'https://schema.org.ai/Startup') */
  $type: string

  /** Human-readable name */
  name?: string
  /** Additional data fields */
  data?: Record<string, unknown>
  /** Metadata for system use */
  meta?: Record<string, unknown>
  /** Access control visibility level */
  visibility?: Visibility

  /** Version number for append-only/CRDTs */
  $version?: number

  /**
   * Git provenance information when synced from a repository
   */
  $source?: {
    /** Repository URL (e.g., 'https://github.com/drivly/startups.studio') */
    repo: string
    /** Path within repo (e.g., 'content/blog/hello-world.mdx') */
    path: string
    /** Branch name (e.g., 'main', 'feature/dark-mode') */
    branch: string
    /** Commit SHA this version is from */
    commit: string
  }

  /** When the Thing was created */
  createdAt: Date
  /** When the Thing was last updated */
  updatedAt: Date
  /** When the Thing was soft-deleted (if applicable) */
  deletedAt?: Date
}

/**
 * ThingIdentity - Parsed identity components from a Thing's $id
 *
 * Computed from the $id URL for convenience. Not stored in the database.
 *
 * @example
 * ```typescript
 * const identity = parseThingId('https://startups.studio/acme')
 * // { url: URL, ns: 'https://startups.studio', path: 'acme' }
 * ```
 */
export interface ThingIdentity {
  /** Parsed URL object */
  url: URL
  /** Namespace/DO URL (e.g., 'https://startups.studio') */
  ns: string
  /** Path after namespace (e.g., 'acme') */
  path: string
}

// ============================================================================
// URL PARSING UTILITIES
// ============================================================================

/**
 * Parse a Thing's $id URL into its identity components
 *
 * @param $id - The fully qualified URL identifier
 * @returns Parsed ThingIdentity with url, ns, and path
 *
 * @example
 * ```typescript
 * parseThingId('https://startups.studio/headless.ly')
 * // { url: URL, ns: 'https://startups.studio', path: 'headless.ly' }
 *
 * parseThingId('https://headless.ly/App/main')
 * // { url: URL, ns: 'https://headless.ly', path: 'App/main' }
 *
 * parseThingId('https://startups.studio/Startup')
 * // { url: URL, ns: 'https://startups.studio', path: 'Startup' }
 * ```
 */
export function parseThingId($id: string): ThingIdentity {
  const url = new URL($id)
  const ns = `${url.protocol}//${url.host}`
  const path = url.pathname.slice(1) // Remove leading /

  return { url, ns, path }
}

/**
 * Build a Thing's $id URL from namespace and path
 *
 * @param ns - The namespace URL (e.g., 'https://startups.studio')
 * @param path - The path within the namespace (e.g., 'headless.ly')
 * @returns The full $id URL
 *
 * @example
 * ```typescript
 * buildThingId('https://startups.studio', 'headless.ly')
 * // 'https://startups.studio/headless.ly'
 * ```
 */
export function buildThingId(ns: string, path: string): string {
  return `${ns}/${path}`
}

// ============================================================================
// VISIBILITY HELPERS
// ============================================================================

/**
 * Check if a Thing is publicly visible
 * @param thing - The Thing to check
 * @returns True if visibility is 'public'
 */
export function isPublic(thing: ThingData): boolean {
  return thing.visibility === 'public'
}

/**
 * Check if a Thing is unlisted (visible with link)
 * @param thing - The Thing to check
 * @returns True if visibility is 'unlisted'
 */
export function isUnlisted(thing: ThingData): boolean {
  return thing.visibility === 'unlisted'
}

/**
 * Check if a Thing is organization-visible only
 * @param thing - The Thing to check
 * @returns True if visibility is 'org'
 */
export function isOrgVisible(thing: ThingData): boolean {
  return thing.visibility === 'org'
}

/**
 * Check if a Thing is user-only (private)
 * @param thing - The Thing to check
 * @returns True if visibility is 'user' or undefined (default)
 */
export function isUserOnly(thing: ThingData): boolean {
  return thing.visibility === 'user' || thing.visibility === undefined
}

/**
 * Check if an actor can view a Thing based on visibility rules
 *
 * Rules:
 * - Public/unlisted: Anyone can view
 * - Org: Requires matching orgId
 * - User/undefined: Requires matching ownerId
 *
 * @param thing - The Thing to check
 * @param actor - The actor (user/org context) requesting access
 * @returns True if the actor can view the Thing
 *
 * @example
 * ```typescript
 * const thing = { visibility: 'org', meta: { orgId: 'org-123' } }
 * const actor = { userId: 'user-1', orgId: 'org-123' }
 *
 * canView(thing, actor) // true - matching orgId
 * canView(thing, { userId: 'user-2' }) // false - no orgId match
 * ```
 */
export function canView(thing: ThingData, actor: Actor): boolean {
  // Public and unlisted things are viewable by anyone
  if (thing.visibility === 'public' || thing.visibility === 'unlisted') {
    return true
  }

  // Org visibility requires matching orgId
  if (thing.visibility === 'org') {
    const thingOrgId = thing.meta?.orgId as string | undefined
    return !!actor.orgId && actor.orgId === thingOrgId
  }

  // User visibility (or undefined = default private) requires matching ownerId
  const thingOwnerId = thing.meta?.ownerId as string | undefined
  return !!actor.userId && actor.userId === thingOwnerId
}

// ============================================================================
// THINGS DATA - Base data for collections
// ============================================================================

/**
 * ThingsData - Base data structure for Things collections
 *
 * Represents a collection of Things of a specific type within a namespace.
 */
export interface ThingsData {
  /** Fully qualified URL for the collection (e.g., 'https://startups.studio') */
  $id: string
  /** Meta-type URL (e.g., 'https://schema.org.ai/Things') */
  $type: string
  /** Type URL of contained items (e.g., 'https://schema.org.ai/Startup') */
  itemType: string

  /** Human-readable name for the collection */
  name?: string
  /** Description of the collection */
  description?: string
  /** When the collection was created */
  createdAt: Date
  /** When the collection was last updated */
  updatedAt: Date
}

/**
 * CreateOptions - Options for creating Things with cascade generation
 *
 * When cascade is enabled, related entities are automatically generated
 * based on the schema relationships.
 */
export interface CreateOptions {
  /** Enable cascade generation of related entities */
  cascade?: boolean
  /** Maximum depth for cascade generation */
  maxDepth?: number
  /** Limit cascade to specific types */
  cascadeTypes?: string[]
  /** Progress callback during cascade generation */
  onProgress?: (progress: CascadeProgress) => void
}

/**
 * CascadeProgress - Progress information during cascade generation
 */
export interface CascadeProgress {
  /** Current phase of cascade generation */
  phase: 'generating' | 'resolving' | 'complete'
  /** Type currently being generated */
  currentType: string
  /** Current depth in the cascade */
  currentDepth: number
  /** Total entities created so far */
  totalEntitiesCreated: number
  /** Types that have been generated */
  typesGenerated: string[]
}

/**
 * ForEachOptions - Options for batch operations on Things
 */
export interface ForEachOptions {
  /** Number of concurrent operations */
  concurrency?: number
  /** Maximum retry attempts for failed operations */
  maxRetries?: number
  /** Delay between retries in milliseconds */
  retryDelay?: number
  /** Progress callback */
  onProgress?: (progress: ForEachProgress) => void
  /** Error handler with action selection */
  onError?: (error: Error, item: unknown) => 'skip' | 'retry' | 'abort'
  /** Whether to persist progress for resumption */
  persist?: boolean
  /** Resume token from a previous run */
  resume?: string
}

/**
 * ForEachProgress - Progress information for batch operations
 */
export interface ForEachProgress {
  /** Total items to process */
  total: number
  /** Successfully completed items */
  completed: number
  /** Failed items */
  failed: number
  /** Skipped items */
  skipped: number
}

/**
 * Query - Query options for finding Things
 */
export interface Query {
  /** Filter conditions */
  where?: Record<string, unknown>
  /** Sort order (field name or array of fields) */
  orderBy?: string | string[]
  /** Maximum number of results */
  limit?: number
  /** Number of results to skip */
  offset?: number
}

// ============================================================================
// THINGS INTERFACE - Forward declaration to break circular dependency
// ============================================================================

/**
 * Minimal interface for Things collection.
 * This is a forward declaration used by ThingDO.collection() to avoid
 * the circular dependency between Thing.ts and Things.ts.
 * The full implementation is in Things.ts.
 */
export interface ThingsInterface<T = unknown> extends ThingsData {
  readonly isDO: boolean
  get(id: string): Promise<T>
  create(data: Partial<T>, options?: CreateOptions): Promise<T>
  update(id: string, data: Partial<T>): Promise<T>
  delete(id: string): Promise<void>
  list(): Promise<T[]>
  find(query: Query): Promise<T[]>
  first(query?: Query): Promise<T | null>
  count(query?: Query): Promise<number>
}
