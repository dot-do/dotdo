/**
 * Payload Adapter Versioning Operations
 *
 * Implements versioning operations leveraging Things' append-only pattern.
 * Versions are stored as separate Things with a parent reference.
 *
 * @module @dotdo/payload/adapter/operations/versions
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
 * Version record stored as a Thing
 */
export interface VersionRecord {
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
 * Arguments for createVersion operation
 */
export interface CreateVersionArgs {
  collection: string
  id: string
  type?: 'draft' | 'published'
  label?: string
  createdBy?: string
  autosave?: boolean
}

/**
 * Arguments for findVersions operation
 */
export interface FindVersionsArgs {
  collection: string
  id: string
  sort?: string
  page?: number
  limit?: number
  where?: Record<string, unknown>
}

/**
 * Arguments for findVersion operation (single version)
 */
export interface FindVersionArgs {
  collection: string
  id: string
  versionNumber: number
}

/**
 * Arguments for restoreVersion operation
 */
export interface RestoreVersionArgs {
  collection: string
  id: string
  versionNumber: number
}

/**
 * Arguments for deleteVersions operation
 */
export interface DeleteVersionsArgs {
  collection: string
  id: string
  olderThan?: number
  keepMinimum?: number
}

/**
 * Context for version operations
 */
export interface VersionContext {
  namespace: string
  things: ThingsStore
  getDocument: (collection: string, id: string) => Promise<PayloadDocument | null>
  updateDocument: (collection: string, id: string, data: Record<string, unknown>) => Promise<PayloadDocument>
  deleteDocument: (collection: string, id: string) => Promise<PayloadDocument>
}

/**
 * Result of createVersion operation
 */
export interface CreateVersionResult {
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
 * Result of findVersions operation
 */
export interface FindVersionsResult {
  docs: VersionRecord[]
  totalDocs: number
  totalPages: number
  page: number
  hasNextPage: boolean
  hasPrevPage: boolean
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Generate a version Thing ID
 */
function getVersionThingId(namespace: string, collection: string, docId: string, versionNumber: number): string {
  return `${namespace}/${collection}/${docId}:v${versionNumber}`
}

/**
 * Get the version type ($type) for a collection's versions
 */
function getVersionType(namespace: string, collection: string): string {
  return `${namespace}/_versions/${collection}`
}

/**
 * Parse version number from a version Thing ID
 */
function parseVersionNumber(thingId: string): number | null {
  const match = thingId.match(/:v(\d+)$/)
  return match?.[1] ? parseInt(match[1], 10) : null
}

/**
 * Get all versions for a document from the things store
 */
function getVersionThings(things: ThingsStore, versionType: string, parentDocId: string): ThingData[] {
  return things.list({ type: versionType }).filter((t) => {
    const data = t.data as VersionRecord | undefined
    return data?.parent === parentDocId
  })
}

/**
 * Convert a ThingData to a VersionRecord
 */
function thingToVersionRecord(thing: ThingData): VersionRecord {
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
 * Create a version snapshot of a document
 *
 * @param args - The create version arguments
 * @param ctx - The version context with stores
 * @returns The created version record
 */
export async function createVersion(
  args: CreateVersionArgs,
  ctx: VersionContext
): Promise<CreateVersionResult> {
  const { collection, id, type = 'draft', label, createdBy } = args
  const { namespace, things, getDocument } = ctx

  // Get current document
  const doc = await getDocument(collection, id)
  if (!doc) {
    throw new Error(`Document '${id}' not found in collection '${collection}'`)
  }

  // Get version type for this collection
  const versionType = getVersionType(namespace, collection)

  // Get existing versions to determine next version number
  const existingVersions = getVersionThings(things, versionType, id)
  const versionNumber = existingVersions.length + 1

  // Create version Thing ID
  const versionThingId = getVersionThingId(namespace, collection, id, versionNumber)

  // Extract document data (exclude id and timestamps for the snapshot)
  const { id: _docId, createdAt: _createdAt, updatedAt: _updatedAt, ...snapshotData } = doc

  // Create the version Thing
  const now = new Date()
  const versionData: Record<string, unknown> = {
    parent: id,
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
    parent: id,
    versionNumber,
    type,
    label,
    createdBy,
    createdAt: now,
    version: snapshotData,
  }
}

/**
 * Find all versions of a document with pagination
 *
 * @param args - The find versions arguments
 * @param ctx - The version context
 * @returns Paginated list of versions
 */
export async function findVersions(
  args: FindVersionsArgs,
  ctx: VersionContext
): Promise<FindVersionsResult> {
  const { collection, id, sort = '-versionNumber', page = 1, limit = 10, where } = args
  const { namespace, things } = ctx

  // Get version type for this collection
  const versionType = getVersionType(namespace, collection)

  // Get all versions for this document
  let versions = getVersionThings(things, versionType, id).map(thingToVersionRecord)

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
 * Find a specific version by version number
 *
 * @param args - The find version arguments
 * @param ctx - The version context
 * @returns The version record or null if not found
 */
export async function findVersion(
  args: FindVersionArgs,
  ctx: VersionContext
): Promise<VersionRecord | null> {
  const { collection, id, versionNumber } = args
  const { namespace, things } = ctx

  // Get version Thing ID
  const versionThingId = getVersionThingId(namespace, collection, id, versionNumber)

  // Look up the version
  const thing = things.get(versionThingId)
  if (!thing) {
    return null
  }

  return thingToVersionRecord(thing)
}

/**
 * Restore a document to a specific version
 *
 * @param args - The restore version arguments
 * @param ctx - The version context
 * @returns The restored document
 */
export async function restoreVersion(
  args: RestoreVersionArgs,
  ctx: VersionContext
): Promise<PayloadDocument> {
  const { collection, id, versionNumber } = args
  const { namespace, things, updateDocument, getDocument } = ctx

  // Find the version to restore
  const version = await findVersion({ collection, id, versionNumber }, ctx)
  if (!version) {
    throw new Error(`Version ${versionNumber} not found for document '${id}' in collection '${collection}'`)
  }

  // Update the document with the version snapshot data
  const restored = await updateDocument(collection, id, version.version)

  // Create a new version marking the restore
  await createVersion(
    {
      collection,
      id,
      type: 'draft',
      label: `Restored from version ${versionNumber}`,
    },
    ctx
  )

  return restored
}

/**
 * Delete versions based on criteria
 *
 * @param args - The delete versions arguments
 * @param ctx - The version context
 */
export async function deleteVersions(
  args: DeleteVersionsArgs,
  ctx: VersionContext
): Promise<void> {
  const { collection, id, olderThan, keepMinimum } = args
  const { namespace, things } = ctx

  // Get version type for this collection
  const versionType = getVersionType(namespace, collection)

  // Get all versions for this document
  const versions = getVersionThings(things, versionType, id)
    .map(thingToVersionRecord)
    .sort((a, b) => b.versionNumber - a.versionNumber) // Sort descending (newest first)

  let versionsToDelete: VersionRecord[] = []

  if (olderThan !== undefined) {
    // Delete versions older than the specified version number
    versionsToDelete = versions.filter((v) => v.versionNumber < olderThan)
  } else if (keepMinimum !== undefined) {
    // Keep the most recent N versions, delete the rest
    versionsToDelete = versions.slice(keepMinimum)
  }

  // Delete the selected versions
  for (const version of versionsToDelete) {
    things.delete(version.id)
  }
}

/**
 * Delete all versions for a document (called when document is deleted)
 *
 * @param collection - The collection name
 * @param id - The document ID
 * @param ctx - The version context
 */
export async function deleteAllVersions(
  collection: string,
  id: string,
  ctx: VersionContext
): Promise<void> {
  const { namespace, things } = ctx

  // Get version type for this collection
  const versionType = getVersionType(namespace, collection)

  // Get all versions for this document
  const versions = getVersionThings(things, versionType, id)

  // Delete all versions
  for (const version of versions) {
    things.delete(version.$id)
  }
}

/**
 * Throws an error for updateVersion - versions are immutable
 */
export async function updateVersion(): Promise<never> {
  throw new Error('Versions are immutable and cannot be updated')
}
