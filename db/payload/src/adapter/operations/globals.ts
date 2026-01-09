/**
 * Payload Adapter Globals Operations
 *
 * Implements operations for Payload CMS Globals - singleton documents that
 * represent one-off content like site settings, navigation, footers, etc.
 *
 * Globals map to fixed-path Things in dotdo:
 * - Global "header" maps to Thing at `{namespace}/globals/header`
 * - Global "footer" maps to Thing at `{namespace}/globals/footer`
 *
 * @module @dotdo/payload/adapter/operations/globals
 */

import type { ThingData } from '../../../../../types/Thing'
import type { PayloadDocument } from '../types'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Store interface for Things (matches harness ThingsStore)
 */
export interface ThingsStore {
  get(id: string): ThingData | undefined
  list(options?: { type?: string }): ThingData[]
  create(data: Partial<ThingData> & { $id: string; $type: string }): ThingData
  update(id: string, data: Partial<ThingData>): ThingData | undefined
  delete(id: string): boolean
  clear(): void
}

/**
 * Store interface for Relationships
 */
export interface RelationshipsStore {
  add(rel: { from: string; to: string; verb: string; data?: Record<string, unknown> }): void
  list(options?: { from?: string; to?: string; verb?: string }): Array<{
    from: string
    to: string
    verb: string
    data?: Record<string, unknown>
  }>
  remove(from: string, to: string, verb: string): boolean
  clear(): void
}

/**
 * Arguments for findGlobal operation
 */
export interface FindGlobalArgs {
  slug: string
  depth?: number
}

/**
 * Arguments for updateGlobal operation
 */
export interface UpdateGlobalArgs {
  slug: string
  data: Record<string, unknown>
  draft?: boolean
}

/**
 * Arguments for createGlobalVersion operation
 */
export interface CreateGlobalVersionArgs {
  slug: string
  type?: 'draft' | 'published'
  label?: string
  createdBy?: string
}

/**
 * Arguments for findGlobalVersions operation
 */
export interface FindGlobalVersionsArgs {
  slug: string
  sort?: string
  page?: number
  limit?: number
  where?: Record<string, unknown>
}

/**
 * Arguments for restoreGlobalVersion operation
 */
export interface RestoreGlobalVersionArgs {
  slug: string
  versionNumber: number
}

/**
 * Global version record
 */
export interface GlobalVersionRecord {
  id: string
  parent: string
  versionNumber: number
  type: 'draft' | 'published'
  label?: string
  createdBy?: string
  createdAt: Date
  version: Record<string, unknown>
}

/**
 * Result of findGlobalVersions operation
 */
export interface FindGlobalVersionsResult {
  docs: GlobalVersionRecord[]
  totalDocs: number
  totalPages: number
  page: number
  hasNextPage: boolean
  hasPrevPage: boolean
}

/**
 * Hooks for global operations
 */
export interface GlobalHooks {
  beforeReadGlobal?: (args: { slug: string }) => Promise<void>
  afterReadGlobal?: (args: { slug: string; doc: Record<string, unknown> }) => Promise<void>
  beforeChangeGlobal?: (args: { slug: string; data: Record<string, unknown> }) => Promise<Record<string, unknown>>
  afterChangeGlobal?: (args: { slug: string; doc: Record<string, unknown> }) => Promise<void>
}

/**
 * Context for global operations
 */
export interface GlobalContext {
  namespace: string
  things: ThingsStore
  relationships: RelationshipsStore
  hooks?: GlobalHooks
  /** Schemas map for relationship population */
  schemas?: Map<string, any[]>
  /** Function to get a document for population */
  getDocument?: (collection: string, id: string) => Promise<PayloadDocument | null>
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Generate the Thing ID for a global
 */
function getGlobalThingId(namespace: string, slug: string): string {
  return `${namespace}/globals/${slug}`
}

/**
 * Get the type URL for globals
 */
function getGlobalsType(namespace: string): string {
  return `${namespace}/globals`
}

/**
 * Get the version type URL for a global's versions
 */
function getGlobalVersionType(namespace: string): string {
  return `${namespace}/_versions/globals`
}

/**
 * Generate the version Thing ID for a global version
 */
function getGlobalVersionThingId(namespace: string, slug: string, versionNumber: number): string {
  return `${namespace}/globals/${slug}:v${versionNumber}`
}

/**
 * Get all versions for a global from the things store
 */
function getGlobalVersionThings(things: ThingsStore, versionType: string, slug: string): ThingData[] {
  return things.list({ type: versionType }).filter((t) => {
    const data = t.data as GlobalVersionRecord | undefined
    return data?.parent === slug
  })
}

/**
 * Convert ThingData to GlobalVersionRecord
 */
function thingToVersionRecord(thing: ThingData): GlobalVersionRecord {
  const data = thing.data as Record<string, unknown>
  return {
    id: thing.$id,
    parent: data.parent as string,
    versionNumber: data.versionNumber as number,
    type: (data.type as 'draft' | 'published') || 'draft',
    label: data.label as string | undefined,
    createdBy: data.createdBy as string | undefined,
    createdAt: thing.createdAt,
    version: data.version as Record<string, unknown>,
  }
}

// ============================================================================
// OPERATIONS
// ============================================================================

/**
 * Find a global document by slug
 *
 * @param args - The find global arguments
 * @param ctx - The global context
 * @returns The global document or empty object if not found
 */
export async function findGlobal(
  args: FindGlobalArgs,
  ctx: GlobalContext
): Promise<Record<string, unknown>> {
  const { slug, depth = 1 } = args
  const { namespace, things, hooks, relationships, schemas, getDocument } = ctx

  // Call beforeRead hook
  if (hooks?.beforeReadGlobal) {
    await hooks.beforeReadGlobal({ slug })
  }

  // Get the global Thing
  const thingId = getGlobalThingId(namespace, slug)
  const thing = things.get(thingId)

  // Return empty object if not found
  if (!thing) {
    const emptyDoc: Record<string, unknown> = {}

    // Call afterRead hook even for empty
    if (hooks?.afterReadGlobal) {
      await hooks.afterReadGlobal({ slug, doc: emptyDoc })
    }

    return emptyDoc
  }

  // Transform Thing to global document format
  const doc: Record<string, unknown> = {
    ...(thing.data as Record<string, unknown>),
    createdAt: thing.createdAt instanceof Date ? thing.createdAt.toISOString() : thing.createdAt,
    updatedAt: thing.updatedAt instanceof Date ? thing.updatedAt.toISOString() : thing.updatedAt,
  }

  // Handle relationship population if depth > 0
  if (depth > 0 && getDocument) {
    const populatedDoc = await populateGlobalRelationships(doc, depth, ctx)

    // Call afterRead hook
    if (hooks?.afterReadGlobal) {
      await hooks.afterReadGlobal({ slug, doc: populatedDoc })
    }

    return populatedDoc
  }

  // Call afterRead hook
  if (hooks?.afterReadGlobal) {
    await hooks.afterReadGlobal({ slug, doc })
  }

  return doc
}

/**
 * Populate relationships in a global document
 */
async function populateGlobalRelationships(
  doc: Record<string, unknown>,
  depth: number,
  ctx: GlobalContext
): Promise<Record<string, unknown>> {
  if (depth <= 0 || !ctx.getDocument) return doc

  const result = { ...doc }

  // Look for relationship fields by checking if values look like IDs
  for (const [key, value] of Object.entries(doc)) {
    // Skip system fields
    if (key === 'createdAt' || key === 'updatedAt') continue

    // Check if value looks like a relationship ID (string that could be an ID)
    if (typeof value === 'string' && !value.includes(' ') && value.length < 100) {
      // Try to resolve as a media relationship (common for logo, favicon, etc.)
      const mediaDoc = await ctx.getDocument('media', value)
      if (mediaDoc) {
        result[key] = mediaDoc
      }
    }
  }

  return result
}

/**
 * Update or create a global document
 *
 * @param args - The update global arguments
 * @param ctx - The global context
 * @returns The updated global document
 */
export async function updateGlobal(
  args: UpdateGlobalArgs,
  ctx: GlobalContext
): Promise<Record<string, unknown>> {
  const { slug, data } = args
  const { namespace, things, hooks } = ctx

  // Call beforeChange hook
  let processedData = { ...data }
  if (hooks?.beforeChangeGlobal) {
    processedData = await hooks.beforeChangeGlobal({ slug, data: processedData })
  }

  const thingId = getGlobalThingId(namespace, slug)
  const globalsType = getGlobalsType(namespace)
  const now = new Date()

  // Check if global already exists
  const existing = things.get(thingId)

  let resultDoc: Record<string, unknown>
  let createdAt: Date

  if (existing) {
    // Merge with existing data (partial update)
    const existingData = existing.data as Record<string, unknown> || {}
    const mergedData = { ...existingData, ...processedData }

    // Update the Thing
    things.update(thingId, {
      data: mergedData,
      updatedAt: now,
    })

    createdAt = existing.createdAt
    resultDoc = {
      ...mergedData,
      createdAt: createdAt instanceof Date ? createdAt.toISOString() : createdAt,
      updatedAt: now.toISOString(),
    }
  } else {
    // Create new global
    things.create({
      $id: thingId,
      $type: globalsType,
      name: slug,
      data: processedData,
      createdAt: now,
      updatedAt: now,
    })

    createdAt = now
    resultDoc = {
      ...processedData,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    }
  }

  // Call afterChange hook
  if (hooks?.afterChangeGlobal) {
    await hooks.afterChangeGlobal({ slug, doc: resultDoc })
  }

  return resultDoc
}

/**
 * Create a version snapshot of a global
 *
 * @param args - The create global version arguments
 * @param ctx - The global context
 * @returns The created version record
 */
export async function createGlobalVersion(
  args: CreateGlobalVersionArgs,
  ctx: GlobalContext
): Promise<GlobalVersionRecord> {
  const { slug, type = 'draft', label, createdBy } = args
  const { namespace, things } = ctx

  // Get current global data
  const thingId = getGlobalThingId(namespace, slug)
  const globalThing = things.get(thingId)

  if (!globalThing) {
    throw new Error(`Global '${slug}' not found`)
  }

  const versionType = getGlobalVersionType(namespace)

  // Get existing versions to determine next version number
  const existingVersions = getGlobalVersionThings(things, versionType, slug)
  const versionNumber = existingVersions.length + 1

  // Create version Thing ID
  const versionThingId = getGlobalVersionThingId(namespace, slug, versionNumber)

  // Extract snapshot data (exclude system timestamps)
  const globalData = globalThing.data as Record<string, unknown> || {}
  const snapshotData = { ...globalData }

  // Create the version Thing
  const now = new Date()
  const versionData: Record<string, unknown> = {
    parent: slug,
    versionNumber,
    type,
    version: snapshotData,
  }

  if (label) {
    versionData.label = label
  }

  if (createdBy) {
    versionData.createdBy = createdBy
  }

  things.create({
    $id: versionThingId,
    $type: versionType,
    data: versionData,
    createdAt: now,
    updatedAt: now,
  })

  return {
    id: versionThingId,
    parent: slug,
    versionNumber,
    type,
    label,
    createdBy,
    createdAt: now,
    version: snapshotData,
  }
}

/**
 * Find all versions of a global with pagination
 *
 * @param args - The find global versions arguments
 * @param ctx - The global context
 * @returns Paginated list of versions
 */
export async function findGlobalVersions(
  args: FindGlobalVersionsArgs,
  ctx: GlobalContext
): Promise<FindGlobalVersionsResult> {
  const { slug, sort = '-versionNumber', page = 1, limit = 10, where } = args
  const { namespace, things } = ctx

  const versionType = getGlobalVersionType(namespace)

  // Get all versions for this global
  let versions = getGlobalVersionThings(things, versionType, slug).map(thingToVersionRecord)

  // Apply where filters
  if (where) {
    versions = versions.filter((v) => {
      for (const [key, condition] of Object.entries(where)) {
        if (typeof condition === 'object' && condition !== null && 'equals' in condition) {
          const expectedValue = (condition as { equals: unknown }).equals
          const actualValue = key === 'type' ? v.type : key === 'label' ? v.label : (v as any)[key]
          if (actualValue !== expectedValue) {
            return false
          }
        }
      }
      return true
    })
  }

  // Sort versions
  const sortKey = sort.startsWith('-') ? sort.slice(1) : sort
  const sortDir = sort.startsWith('-') ? -1 : 1

  versions.sort((a, b) => {
    const aVal = (a as any)[sortKey]
    const bVal = (b as any)[sortKey]
    if (typeof aVal === 'number' && typeof bVal === 'number') {
      return (aVal - bVal) * sortDir
    }
    if (typeof aVal === 'string' && typeof bVal === 'string') {
      return aVal.localeCompare(bVal) * sortDir
    }
    if (aVal instanceof Date && bVal instanceof Date) {
      return (aVal.getTime() - bVal.getTime()) * sortDir
    }
    return 0
  })

  // Calculate pagination
  const totalDocs = versions.length
  const totalPages = Math.ceil(totalDocs / limit) || 1
  const hasNextPage = page < totalPages
  const hasPrevPage = page > 1

  // Apply pagination
  const start = (page - 1) * limit
  const paginatedDocs = versions.slice(start, start + limit)

  return {
    docs: paginatedDocs,
    totalDocs,
    totalPages,
    page,
    hasNextPage,
    hasPrevPage,
  }
}

/**
 * Restore a global to a specific version
 *
 * @param args - The restore global version arguments
 * @param ctx - The global context
 * @returns The restored global document
 */
export async function restoreGlobalVersion(
  args: RestoreGlobalVersionArgs,
  ctx: GlobalContext
): Promise<Record<string, unknown>> {
  const { slug, versionNumber } = args
  const { namespace, things } = ctx

  // Find the version to restore
  const versionThingId = getGlobalVersionThingId(namespace, slug, versionNumber)
  const versionThing = things.get(versionThingId)

  if (!versionThing) {
    throw new Error(`Version ${versionNumber} not found for global '${slug}'`)
  }

  const versionData = versionThing.data as Record<string, unknown>
  const snapshotData = versionData.version as Record<string, unknown>

  // Update the global with the version snapshot data
  const thingId = getGlobalThingId(namespace, slug)
  const existing = things.get(thingId)

  if (!existing) {
    throw new Error(`Global '${slug}' not found`)
  }

  const now = new Date()

  // Restore the global data
  things.update(thingId, {
    data: snapshotData,
    updatedAt: now,
  })

  // Create a new version marking the restore
  await createGlobalVersion(
    {
      slug,
      type: 'draft',
      label: `Restored from version ${versionNumber}`,
    },
    ctx
  )

  return {
    ...snapshotData,
    createdAt: existing.createdAt instanceof Date ? existing.createdAt.toISOString() : existing.createdAt,
    updatedAt: now.toISOString(),
  }
}

/**
 * Get all globals
 *
 * @param ctx - The global context
 * @returns Array of global slugs and data
 */
export async function getGlobals(
  ctx: GlobalContext
): Promise<Array<{ slug: string } & Record<string, unknown>>> {
  const { namespace, things } = ctx
  const globalsType = getGlobalsType(namespace)

  const globalThings = things.list({ type: globalsType })

  return globalThings.map((thing) => {
    const slug = thing.name || thing.$id.split('/').pop() || ''
    return {
      slug,
      ...(thing.data as Record<string, unknown>),
      createdAt: thing.createdAt instanceof Date ? thing.createdAt.toISOString() : thing.createdAt,
      updatedAt: thing.updatedAt instanceof Date ? thing.updatedAt.toISOString() : thing.updatedAt,
    }
  })
}
