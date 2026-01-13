/**
 * GitGraphAdapter - Bridge gitx objects with GraphStore
 *
 * GREEN PHASE: Implements the adapter interface to pass all tests
 * defined in db/graph/tests/gitx-integration.test.ts.
 *
 * @see dotdo-pf9ui - [GREEN] gitx-as-Things - Implementation
 *
 * Design:
 * - Git objects (commits, trees, blobs, refs) stored as Things
 * - Git relationships (parent, hasTree, contains, pointsTo) as graph edges
 * - Content-addressable storage for blobs (deterministic IDs from hash)
 * - Support for git operations like log, checkout via graph traversal
 *
 * Thing Types:
 * - Commit: { message, author, committer, tree }
 * - Tree: { entries: [{ name, mode, hash }] }
 * - Blob: { size, contentRef, isBinary }
 * - Ref: { name, kind: 'branch' | 'tag' | 'remote' | 'head' }
 *
 * Relationships:
 * - Commit `parent` Commit (history chain)
 * - Commit `hasTree` Tree
 * - Tree `contains` Blob|Tree
 * - Ref `pointsTo` Commit
 */

import type { GraphStore, GraphThing } from '../types'
import { GIT_TYPE_IDS } from '../constants'
import { createHash } from 'crypto'
import { toRecord } from '../../../lib/type-guards'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Git author/committer identity
 */
export interface GitIdentityData {
  name: string
  email: string
  timestamp: number
  timezone: string
}

/**
 * Tree entry structure (stored in Tree.data.entries)
 */
export interface TreeEntryData {
  name: string
  mode: string // '100644' | '100755' | '040000' | '120000' | '160000'
  hash: string // SHA reference to blob/tree Thing
}

/**
 * Commit Thing data structure
 */
export interface CommitData {
  message: string
  author: GitIdentityData
  committer: GitIdentityData
  tree: string
  gpgSignature?: string
}

/**
 * Tree Thing data structure
 */
export interface TreeData {
  entries: TreeEntryData[]
}

/**
 * Blob Thing data structure
 */
export interface BlobData {
  size: number
  contentRef: string
  isBinary?: boolean
}

/**
 * Ref Thing data structure
 */
export interface RefData {
  name: string
  kind: 'branch' | 'tag' | 'remote' | 'head'
  symbolic?: boolean
  target?: string
}

// ============================================================================
// TYPE IDS (from centralized db/graph/constants.ts)
// ============================================================================

/**
 * Type IDs for Git objects.
 * Re-exported from db/graph/constants.ts for local use.
 */
const TYPE_IDS = GIT_TYPE_IDS

// ============================================================================
// URL BUILDERS
// ============================================================================

function commitUrl(id: string): string {
  return `do://git/commits/${id}`
}

function treeUrl(id: string): string {
  return `do://git/trees/${id}`
}

function blobUrl(id: string): string {
  return `do://git/blobs/${id}`
}

function refUrl(id: string): string {
  return `do://git/refs/${id}`
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Generate a unique ID for commits and trees
 */
function generateId(): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 10)
  return `${timestamp}-${random}`
}

/**
 * Generate a content-addressable hash for blobs
 */
function hashContent(content: Uint8Array | string): string {
  const data = typeof content === 'string' ? Buffer.from(content) : content
  return createHash('sha256').update(data).digest('hex').substring(0, 40)
}

/**
 * Detect if content is binary.
 *
 * Content is considered binary if it contains:
 * - Null bytes (0x00)
 * - Non-printable control characters (except tab, newline, carriage return)
 * - High bytes (> 127, i.e. non-ASCII)
 */
function isBinaryContent(content: Uint8Array | string): boolean {
  const bytes = typeof content === 'string' ? Buffer.from(content) : content

  // Check first 8KB (or entire content if smaller) for binary indicators
  const checkLength = Math.min(bytes.length, 8192)

  for (let i = 0; i < checkLength; i++) {
    const byte = bytes[i]!

    // Null byte - definitely binary
    if (byte === 0x00) {
      return true
    }

    // High bytes (non-ASCII) - likely binary
    if (byte > 127) {
      return true
    }

    // Non-printable control characters (except tab, newline, carriage return)
    if (byte < 32 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d) {
      return true
    }
  }

  return false
}

/**
 * Get content size
 */
function getContentSize(content: Uint8Array | string): number {
  if (typeof content === 'string') {
    return Buffer.byteLength(content, 'utf8')
  }
  return content.length
}

/**
 * Default author/committer identity
 */
function defaultIdentity(): GitIdentityData {
  return {
    name: 'Anonymous',
    email: 'anonymous@example.com',
    timestamp: Date.now(),
    timezone: '+0000',
  }
}

// ============================================================================
// GITGRAPHADAPTER CLASS
// ============================================================================

/**
 * GitGraphAdapter bridges gitx objects with GraphStore
 *
 * @example
 * ```typescript
 * const store = new SQLiteGraphStore(':memory:')
 * await store.initialize()
 *
 * const adapter = new GitGraphAdapter(store)
 *
 * // Create a tree and commit
 * const blob = await adapter.createBlob({ content: 'Hello World' })
 * const tree = await adapter.createTree([
 *   { name: 'readme.md', mode: '100644', hash: blob.id }
 * ])
 * const commit = await adapter.createCommit({
 *   message: 'Initial commit',
 *   tree: tree.id
 * })
 *
 * // Create a branch
 * await adapter.createRef('main', 'branch', commit.id)
 *
 * // Checkout
 * const files = await adapter.checkout('main')
 * ```
 */
export class GitGraphAdapter {
  private store: GraphStore
  private refCache: Map<string, string> = new Map() // name -> thing id

  constructor(store: GraphStore) {
    this.store = store
  }

  // ==========================================================================
  // COMMIT OPERATIONS
  // ==========================================================================

  /**
   * Create a Commit Thing with parent relationships
   */
  async createCommit(data: {
    message: string
    tree: string
    author?: GitIdentityData
    parent?: string
    parents?: string[]
  }): Promise<GraphThing> {
    const id = generateId()
    const author = data.author ?? defaultIdentity()
    const committer = data.author ?? defaultIdentity()

    const commitData: CommitData = {
      message: data.message,
      author,
      committer,
      tree: data.tree,
    }

    // Create the Commit Thing
    const commit = await this.store.createThing({
      id,
      typeId: TYPE_IDS.Commit,
      typeName: 'Commit',
      data: toRecord(commitData),
    })

    // Create hasTree relationship
    await this.store.createRelationship({
      id: `rel-hasTree-${id}-${data.tree}`,
      verb: 'hasTree',
      from: commitUrl(id),
      to: treeUrl(data.tree),
    })

    // Create parent relationships
    const parents = data.parents ?? (data.parent ? [data.parent] : [])
    for (const parentId of parents) {
      await this.store.createRelationship({
        id: `rel-parent-${id}-${parentId}`,
        verb: 'parent',
        from: commitUrl(id),
        to: commitUrl(parentId),
      })
    }

    return commit
  }

  /**
   * Get commit history by traversing parent relationships
   */
  async getCommitHistory(
    startCommitId: string,
    options?: { limit?: number }
  ): Promise<GraphThing[]> {
    const limit = options?.limit ?? 1000
    const history: GraphThing[] = []
    const visited = new Set<string>()
    const queue: string[] = [startCommitId]

    while (queue.length > 0 && history.length < limit) {
      const currentId = queue.shift()!

      if (visited.has(currentId)) continue
      visited.add(currentId)

      const commit = await this.store.getThing(currentId)
      if (!commit || commit.typeName !== 'Commit') continue

      history.push(commit)

      // Get parent relationships (follow first parent primarily for standard log)
      const parentRels = await this.store.queryRelationshipsFrom(commitUrl(currentId), {
        verb: 'parent',
      })

      // Add parents to queue (first parent first for chronological order)
      for (const rel of parentRels) {
        const parentId = this.extractIdFromUrl(rel.to)
        if (parentId && !visited.has(parentId)) {
          queue.push(parentId)
        }
      }
    }

    return history
  }

  // ==========================================================================
  // TREE OPERATIONS
  // ==========================================================================

  /**
   * Create a Tree Thing with contains relationships to entries
   */
  async createTree(entries: TreeEntryData[]): Promise<GraphThing> {
    const id = generateId()

    const treeData: TreeData = {
      entries: [...entries],
    }

    // Create the Tree Thing
    const tree = await this.store.createThing({
      id,
      typeId: TYPE_IDS.Tree,
      typeName: 'Tree',
      data: toRecord(treeData),
    })

    // Create contains relationships for each entry
    // Track already-created relationships to handle multiple entries pointing to same blob
    const createdRelationships = new Set<string>()
    for (const entry of entries) {
      const targetUrl = entry.mode === '040000' ? treeUrl(entry.hash) : blobUrl(entry.hash)
      const relKey = `${treeUrl(id)}->${targetUrl}`

      // Only create one relationship per (tree, blob) pair
      // The tree's data.entries array stores the actual file names
      if (createdRelationships.has(relKey)) {
        continue
      }
      createdRelationships.add(relKey)

      await this.store.createRelationship({
        id: `rel-contains-${id}-${entry.hash}`,
        verb: 'contains',
        from: treeUrl(id),
        to: targetUrl,
        data: { name: entry.name, mode: entry.mode },
      })
    }

    return tree
  }

  /**
   * Get tree entries with their associated Things
   */
  async getTreeEntries(
    treeId: string
  ): Promise<Array<{ thing: GraphThing; entry: TreeEntryData }>> {
    const tree = await this.store.getThing(treeId)
    if (!tree || tree.typeName !== 'Tree') {
      return []
    }

    const treeData = tree.data as TreeData
    const results: Array<{ thing: GraphThing; entry: TreeEntryData }> = []

    for (const entry of treeData.entries) {
      const thing = await this.store.getThing(entry.hash)
      if (thing) {
        results.push({ thing, entry })
      }
    }

    return results
  }

  // ==========================================================================
  // BLOB OPERATIONS
  // ==========================================================================

  /**
   * Create a Blob Thing with content-addressable ID
   */
  async createBlob(data: { content: Uint8Array | string; contentRef?: string }): Promise<GraphThing> {
    // Generate deterministic ID from content hash
    const id = hashContent(data.content)
    const size = getContentSize(data.content)
    const binary = isBinaryContent(data.content)

    const blobData: BlobData = {
      size,
      contentRef: data.contentRef ?? `internal:${id}`,
      isBinary: binary,
    }

    // Check if blob already exists (content-addressable)
    const existing = await this.store.getThing(id)
    if (existing) {
      return existing
    }

    // Create the Blob Thing
    const blob = await this.store.createThing({
      id,
      typeId: TYPE_IDS.Blob,
      typeName: 'Blob',
      data: toRecord(blobData),
    })

    return blob
  }

  // ==========================================================================
  // REF OPERATIONS
  // ==========================================================================

  /**
   * Create or update a Ref (branch/tag) pointing to a commit
   */
  async createRef(
    name: string,
    kind: RefData['kind'],
    commitId: string
  ): Promise<GraphThing> {
    const normalizedName = this.normalizeRefName(name)

    // Check if ref already exists
    const existingRefId = this.refCache.get(normalizedName)
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
        id: `rel-pointsTo-${existingRefId}-${commitId}-${Date.now()}`,
        verb: 'pointsTo',
        from: refUrl(existingRefId),
        to: commitUrl(commitId),
      })

      const existing = await this.store.getThing(existingRefId)
      return existing!
    }

    // Create new ref
    const id = generateId()

    const refData: RefData = {
      name: normalizedName,
      kind,
    }

    const ref = await this.store.createThing({
      id,
      typeId: TYPE_IDS.Ref,
      typeName: 'Ref',
      data: toRecord(refData),
    })

    // Cache the ref
    this.refCache.set(normalizedName, id)

    // Create pointsTo relationship
    await this.store.createRelationship({
      id: `rel-pointsTo-${id}-${commitId}`,
      verb: 'pointsTo',
      from: refUrl(id),
      to: commitUrl(commitId),
    })

    return ref
  }

  /**
   * Resolve a ref name to its target commit Thing
   */
  async resolveRef(refName: string): Promise<GraphThing | null> {
    const normalizedName = this.normalizeRefName(refName)

    // Check cache first
    let refId = this.refCache.get(normalizedName)

    // If not in cache, search for refs with this name
    if (!refId) {
      const refs = await this.store.getThingsByType({ typeName: 'Ref' })
      const matchingRef = refs.find((r) => {
        const data = r.data as RefData
        return data.name === normalizedName
      })

      if (matchingRef) {
        refId = matchingRef.id
        this.refCache.set(normalizedName, refId)
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

    const commitId = this.extractIdFromUrl(rels[0]!.to)
    if (!commitId) {
      return null
    }

    const commit = await this.store.getThing(commitId)
    return commit
  }

  // ==========================================================================
  // CHECKOUT OPERATIONS
  // ==========================================================================

  /**
   * Checkout: resolve ref -> commit -> tree -> files
   * Returns a Map of file paths to their blob Things
   */
  async checkout(refName: string): Promise<Map<string, GraphThing>> {
    const commit = await this.resolveRef(refName)
    if (!commit) {
      throw new Error(`Ref '${refName}' not found`)
    }

    const commitData = commit.data as CommitData
    const files = new Map<string, GraphThing>()

    // Recursively collect files from tree
    await this.collectTreeFiles(commitData.tree, '', files)

    return files
  }

  // ==========================================================================
  // PRIVATE HELPERS
  // ==========================================================================

  /**
   * Extract the ID from a DO URL (do://git/commits/abc -> abc)
   */
  private extractIdFromUrl(url: string): string | null {
    const match = url.match(/do:\/\/git\/\w+\/(.+)$/)
    return match?.[1] ?? null
  }

  /**
   * Normalize ref name to handle both short and full forms
   * 'main' -> 'main'
   * 'refs/heads/main' -> 'main'
   */
  private normalizeRefName(name: string): string {
    if (name.startsWith('refs/heads/')) {
      return name.substring('refs/heads/'.length)
    }
    if (name.startsWith('refs/tags/')) {
      return name.substring('refs/tags/'.length)
    }
    return name
  }

  /**
   * Recursively collect files from a tree
   */
  private async collectTreeFiles(
    treeId: string,
    prefix: string,
    files: Map<string, GraphThing>
  ): Promise<void> {
    const tree = await this.store.getThing(treeId)
    if (!tree || tree.typeName !== 'Tree') {
      return
    }

    const treeData = tree.data as TreeData

    for (const entry of treeData.entries) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name

      if (entry.mode === '040000') {
        // Directory - recurse into subtree
        await this.collectTreeFiles(entry.hash, path, files)
      } else {
        // File - get blob
        const blob = await this.store.getThing(entry.hash)
        if (blob) {
          files.set(path, blob)
        }
      }
    }
  }
}
