/**
 * FunctionVersionAdapter - Function versioning with gitx-style content-addressable storage
 *
 * GREEN PHASE: Implements function versioning using the graph store,
 * where functions, versions, blobs, and refs are represented as Things.
 *
 * @see dotdo-61ywm - [GREEN] Function Versioning Implementation
 *
 * Design:
 * - Function -> Thing with type='Function', data={name, namespace, description, runtime}
 * - FunctionVersion -> Thing with type='FunctionVersion', data={sha, message, author, functionId, parentSha}
 * - FunctionBlob -> Thing with type='FunctionBlob', data={size, contentRef, contentType, hash}
 * - FunctionRef -> Thing with type='FunctionRef', data={name, kind, functionId}
 *
 * Relationships (gitx-style):
 * - FunctionVersion `definedIn` Function (version belongs to function)
 * - FunctionVersion `parent` FunctionVersion (version history chain)
 * - FunctionVersion `hasContent` FunctionBlob (code content reference)
 * - FunctionRef `pointsTo` FunctionVersion (named version reference)
 *
 * Content-Addressable Storage:
 * - SHA256 hash of function source determines blob and version IDs
 * - Identical content produces identical SHAs (deduplication)
 * - Similar to git's blob storage model
 */

import type { GraphStore, GraphThing } from '../types'
import { FUNCTION_VERSION_TYPE_IDS } from '../constants'
import { createHash } from 'crypto'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Function Thing data structure
 */
export interface FunctionData {
  name: string
  namespace: string
  description?: string
  runtime?: string // e.g., 'typescript', 'javascript', 'python'
}

/**
 * FunctionVersion Thing data structure (like a git commit)
 */
export interface FunctionVersionData {
  sha: string // Content-addressable hash
  message: string // Version message (like commit message)
  author: {
    name: string
    email: string
    timestamp: number
  }
  functionId: string // Reference to parent Function
  parentSha?: string // Previous version SHA (null for initial version)
}

/**
 * FunctionBlob Thing data structure (like a git blob)
 */
export interface FunctionBlobData {
  size: number
  contentRef: string // External storage reference (e.g., 'r2:functions/sha256-abc')
  contentType: string // 'text/typescript', 'application/javascript', etc.
  hash: string // SHA-256 of content
}

/**
 * FunctionRef Thing data structure (like git branch/tag)
 */
export interface FunctionRefData {
  name: string // 'latest', 'v1.0.0', 'canary', 'stable', etc.
  kind: 'latest' | 'version' | 'tag' | 'channel' // Type of ref
  functionId: string // Which function this ref belongs to
}

// ============================================================================
// TYPE IDS (from centralized db/graph/constants.ts)
// ============================================================================

/**
 * Type IDs for function versioning (gitx-style).
 * Re-exported from db/graph/constants.ts for local use.
 */
const TYPE_IDS = FUNCTION_VERSION_TYPE_IDS

// ============================================================================
// URL BUILDERS
// ============================================================================

function functionUrl(id: string): string {
  return `do://functions/${id}`
}

function versionUrl(sha: string): string {
  return `do://functions/versions/${sha}`
}

function blobUrl(hash: string): string {
  return `do://functions/blobs/${hash}`
}

function refUrl(id: string): string {
  return `do://functions/refs/${id}`
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Generate a unique ID for functions
 */
function generateId(): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 10)
  return `${timestamp}-${random}`
}

/**
 * Compute SHA-256 hash of content for content-addressable storage
 */
function hashContent(content: Uint8Array | string): string {
  const data = typeof content === 'string' ? Buffer.from(content) : content
  return createHash('sha256').update(data).digest('hex').substring(0, 40)
}

/**
 * Get content size in bytes
 */
function getContentSize(content: Uint8Array | string): number {
  if (typeof content === 'string') {
    return Buffer.byteLength(content, 'utf8')
  }
  return content.length
}

/**
 * Detect content type based on content
 */
function detectContentType(content: Uint8Array | string): string {
  if (content instanceof Uint8Array) {
    // Check for WASM magic bytes
    if (content.length >= 4 && content[0] === 0x00 && content[1] === 0x61 && content[2] === 0x73 && content[3] === 0x6d) {
      return 'application/wasm'
    }
    return 'application/octet-stream'
  }
  // Default to TypeScript for string content
  return 'text/typescript'
}

/**
 * Default author identity
 */
function defaultAuthor(): { name: string; email: string; timestamp: number } {
  return {
    name: 'Anonymous',
    email: 'anonymous@example.com',
    timestamp: Date.now(),
  }
}

// ============================================================================
// FUNCTIONVERSIONADAPTER CLASS
// ============================================================================

/**
 * FunctionVersionAdapter bridges function versioning with GraphStore
 *
 * @example
 * ```typescript
 * const store = new SQLiteGraphStore(':memory:')
 * await store.initialize()
 *
 * const adapter = new FunctionVersionAdapter(store)
 *
 * // Create a function
 * const func = await adapter.createFunction({
 *   name: 'processOrder',
 *   namespace: 'orders'
 * })
 *
 * // Create versions
 * const v1 = await adapter.createVersion({
 *   functionId: func.id,
 *   content: 'export function processOrder() { return true }',
 *   message: 'Initial implementation'
 * })
 *
 * // Create refs
 * await adapter.createRef(func.id, 'latest', 'latest', v1Data.sha)
 *
 * // Resolve refs
 * const resolved = await adapter.resolveRef(func.id, 'latest')
 * ```
 */
export class FunctionVersionAdapter {
  private store: GraphStore
  private refCache: Map<string, string> = new Map() // `${functionId}:${name}` -> ref thing id

  constructor(store: GraphStore) {
    this.store = store
  }

  // ==========================================================================
  // FUNCTION OPERATIONS
  // ==========================================================================

  /**
   * Create a Function Thing
   */
  async createFunction(data: {
    name: string
    namespace: string
    description?: string
    runtime?: string
  }): Promise<GraphThing> {
    const id = generateId()

    const functionData: FunctionData = {
      name: data.name,
      namespace: data.namespace,
      description: data.description,
      runtime: data.runtime,
    }

    const func = await this.store.createThing({
      id,
      typeId: TYPE_IDS.Function,
      typeName: 'Function',
      data: functionData as unknown as Record<string, unknown>,
    })

    return func
  }

  // ==========================================================================
  // VERSION OPERATIONS
  // ==========================================================================

  /**
   * Create a new version of a function (like git commit)
   *
   * Content-addressable: same content produces same SHA
   */
  async createVersion(data: {
    functionId: string
    content: string | Uint8Array
    message: string
    author?: { name: string; email: string }
    parentSha?: string
  }): Promise<GraphThing> {
    // Compute content hash for content-addressable storage
    const contentHash = hashContent(data.content)
    const sha = contentHash // Use content hash as SHA (deterministic)

    // Blob ID is prefixed to differentiate from version ID
    const blobId = `blob-${contentHash}`

    // Check if blob already exists (content-addressable deduplication)
    let blob = await this.store.getThing(blobId)
    if (!blob) {
      // Create FunctionBlob Thing
      const blobData: FunctionBlobData = {
        size: getContentSize(data.content),
        contentRef: `internal:${contentHash}`,
        contentType: detectContentType(data.content),
        hash: contentHash,
      }

      blob = await this.store.createThing({
        id: blobId,
        typeId: TYPE_IDS.FunctionBlob,
        typeName: 'FunctionBlob',
        data: blobData as unknown as Record<string, unknown>,
      })
    }

    // Check if version with this SHA already exists
    const existingVersion = await this.store.getThing(sha)
    if (existingVersion && existingVersion.typeName === 'FunctionVersion') {
      return existingVersion // Return existing (content-addressable)
    }

    // Create FunctionVersion Thing
    const author = data.author
      ? { ...data.author, timestamp: Date.now() }
      : defaultAuthor()

    const versionData: FunctionVersionData = {
      sha,
      message: data.message,
      author,
      functionId: data.functionId,
      parentSha: data.parentSha,
    }

    const version = await this.store.createThing({
      id: sha,
      typeId: TYPE_IDS.FunctionVersion,
      typeName: 'FunctionVersion',
      data: versionData as unknown as Record<string, unknown>,
    })

    // Create definedIn relationship (version -> function)
    await this.store.createRelationship({
      id: `rel-definedIn-${sha}-${data.functionId}`,
      verb: 'definedIn',
      from: versionUrl(sha),
      to: functionUrl(data.functionId),
    })

    // Create hasContent relationship (version -> blob)
    await this.store.createRelationship({
      id: `rel-hasContent-${sha}-${blobId}`,
      verb: 'hasContent',
      from: versionUrl(sha),
      to: blobUrl(blobId),
    })

    // Create parent relationship if parentSha is provided
    if (data.parentSha) {
      await this.store.createRelationship({
        id: `rel-parent-${sha}-${data.parentSha}`,
        verb: 'parent',
        from: versionUrl(sha),
        to: versionUrl(data.parentSha),
      })
    }

    return version
  }

  /**
   * Get a specific version by SHA
   */
  async getVersion(sha: string): Promise<GraphThing | null> {
    const version = await this.store.getThing(sha)
    if (!version || version.typeName !== 'FunctionVersion') {
      return null
    }
    return version
  }

  /**
   * Get all versions of a function
   */
  async getAllVersions(functionId: string): Promise<GraphThing[]> {
    // Query all relationships pointing to this function via definedIn
    const rels = await this.store.queryRelationshipsTo(functionUrl(functionId), {
      verb: 'definedIn',
    })

    // Get the version Things
    const versions: GraphThing[] = []
    for (const rel of rels) {
      const sha = this.extractShaFromUrl(rel.from)
      if (sha) {
        const version = await this.store.getThing(sha)
        if (version && version.typeName === 'FunctionVersion') {
          versions.push(version)
        }
      }
    }

    return versions
  }

  /**
   * Get version history by traversing parent relationships
   */
  async getVersionHistory(
    functionId: string,
    startSha?: string,
    options?: { limit?: number }
  ): Promise<GraphThing[]> {
    const limit = options?.limit ?? 1000

    // If no startSha, try to find the latest version
    let currentSha = startSha
    if (!currentSha) {
      // Get all versions and find one without children (leaf)
      const allVersions = await this.getAllVersions(functionId)
      if (allVersions.length === 0) {
        return []
      }

      // Find versions that are not parents of other versions (leaf nodes)
      const parentShas = new Set<string>()
      for (const v of allVersions) {
        const data = v.data as FunctionVersionData
        if (data.parentSha) {
          parentShas.add(data.parentSha)
        }
      }

      // Find a leaf (version not in parentShas set)
      const leaf = allVersions.find(v => !parentShas.has((v.data as FunctionVersionData).sha))
      if (leaf) {
        currentSha = (leaf.data as FunctionVersionData).sha
      } else {
        // Fallback: use the first version
        currentSha = (allVersions[0].data as FunctionVersionData).sha
      }
    }

    const history: GraphThing[] = []
    const visited = new Set<string>()

    while (currentSha && history.length < limit) {
      if (visited.has(currentSha)) break
      visited.add(currentSha)

      const version = await this.store.getThing(currentSha)
      if (!version || version.typeName !== 'FunctionVersion') break

      history.push(version)

      // Get parent SHA
      const versionData = version.data as FunctionVersionData
      currentSha = versionData.parentSha
    }

    return history
  }

  // ==========================================================================
  // REF OPERATIONS
  // ==========================================================================

  /**
   * Create or update a ref pointing to a version
   */
  async createRef(
    functionId: string,
    name: string,
    kind: FunctionRefData['kind'],
    versionSha: string
  ): Promise<GraphThing> {
    const cacheKey = `${functionId}:${name}`

    // Check if ref already exists
    let existingRefId = this.refCache.get(cacheKey)

    if (!existingRefId) {
      // Search for existing ref
      const refs = await this.store.getThingsByType({ typeName: 'FunctionRef' })
      const existingRef = refs.find(r => {
        const data = r.data as FunctionRefData
        return data.functionId === functionId && data.name === name
      })

      if (existingRef) {
        existingRefId = existingRef.id
        this.refCache.set(cacheKey, existingRefId)
      }
    }

    if (existingRefId) {
      // Update existing ref: delete old pointsTo relationship, create new one
      const existingRels = await this.store.queryRelationshipsFrom(refUrl(existingRefId), {
        verb: 'pointsTo',
      })

      for (const rel of existingRels) {
        await this.store.deleteRelationship(rel.id)
      }

      // Create new pointsTo relationship
      await this.store.createRelationship({
        id: `rel-pointsTo-${existingRefId}-${versionSha}-${Date.now()}`,
        verb: 'pointsTo',
        from: refUrl(existingRefId),
        to: versionUrl(versionSha),
      })

      const existing = await this.store.getThing(existingRefId)
      return existing!
    }

    // Create new ref
    const id = generateId()

    const refData: FunctionRefData = {
      name,
      kind,
      functionId,
    }

    const ref = await this.store.createThing({
      id,
      typeId: TYPE_IDS.FunctionRef,
      typeName: 'FunctionRef',
      data: refData as unknown as Record<string, unknown>,
    })

    // Cache the ref
    this.refCache.set(cacheKey, id)

    // Create pointsTo relationship
    await this.store.createRelationship({
      id: `rel-pointsTo-${id}-${versionSha}`,
      verb: 'pointsTo',
      from: refUrl(id),
      to: versionUrl(versionSha),
    })

    return ref
  }

  /**
   * Resolve a ref name to its target version Thing
   */
  async resolveRef(functionId: string, refName: string): Promise<GraphThing | null> {
    const cacheKey = `${functionId}:${refName}`

    // Check cache first
    let refId = this.refCache.get(cacheKey)

    // If not in cache, search for refs
    if (!refId) {
      const refs = await this.store.getThingsByType({ typeName: 'FunctionRef' })
      const matchingRef = refs.find(r => {
        const data = r.data as FunctionRefData
        return data.functionId === functionId && data.name === refName
      })

      if (matchingRef) {
        refId = matchingRef.id
        this.refCache.set(cacheKey, refId)
      }
    }

    if (!refId) {
      return null
    }

    // Get the pointsTo relationship
    const rels = await this.store.queryRelationshipsFrom(refUrl(refId), {
      verb: 'pointsTo',
    })

    if (rels.length === 0) {
      return null
    }

    const versionSha = this.extractShaFromUrl(rels[0]!.to)
    if (!versionSha) {
      return null
    }

    const version = await this.store.getThing(versionSha)
    return version
  }

  /**
   * Get all refs for a function
   */
  async getRefs(functionId: string): Promise<GraphThing[]> {
    const refs = await this.store.getThingsByType({ typeName: 'FunctionRef' })
    return refs.filter(r => {
      const data = r.data as FunctionRefData
      return data.functionId === functionId
    })
  }

  /**
   * Rollback: update ref to point to an older version
   */
  async rollback(functionId: string, refName: string, targetSha: string): Promise<GraphThing> {
    // Get the ref's kind
    const cacheKey = `${functionId}:${refName}`
    let refId = this.refCache.get(cacheKey)
    let kind: FunctionRefData['kind'] = 'latest'

    if (!refId) {
      const refs = await this.store.getThingsByType({ typeName: 'FunctionRef' })
      const matchingRef = refs.find(r => {
        const data = r.data as FunctionRefData
        return data.functionId === functionId && data.name === refName
      })

      if (matchingRef) {
        refId = matchingRef.id
        kind = (matchingRef.data as FunctionRefData).kind
        this.refCache.set(cacheKey, refId)
      }
    } else {
      const existingRef = await this.store.getThing(refId)
      if (existingRef) {
        kind = (existingRef.data as FunctionRefData).kind
      }
    }

    // Update the ref to point to the target version
    return this.createRef(functionId, refName, kind, targetSha)
  }

  // ==========================================================================
  // PRIVATE HELPERS
  // ==========================================================================

  /**
   * Extract SHA from a version URL
   */
  private extractShaFromUrl(url: string): string | null {
    const match = url.match(/do:\/\/functions\/versions\/(.+)$/)
    return match?.[1] ?? null
  }
}
