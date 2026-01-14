/**
 * @fileoverview Tree Builder - builds git tree objects from index entries
 *
 * Provides functionality for creating Git tree objects from a flat list
 * of index entries, handling directory hierarchies, proper sorting,
 * and deduplication.
 *
 * ## Features
 *
 * - File modes (100644 regular, 100755 executable, 040000 directory, 120000 symlink, 160000 submodule)
 * - Proper tree entry format (mode + space + name + null + sha)
 * - Sorted entries (git requires lexicographic ordering)
 * - Nested tree building for directory hierarchies
 * - Tree SHA computation
 * - Tree deduplication for identical subtrees
 *
 * ## Usage Example
 *
 * ```typescript
 * import { buildTreeFromIndex } from './ops/tree-builder'
 *
 * // Build tree from index entries
 * const entries = [
 *   { path: 'src/main.ts', sha: 'abc123...', mode: '100644', ... },
 *   { path: 'src/utils/helper.ts', sha: 'def456...', mode: '100644', ... },
 *   { path: 'README.md', sha: 'ghi789...', mode: '100644', ... }
 * ]
 *
 * const result = await buildTreeFromIndex(store, entries)
 * console.log('Root tree SHA:', result.sha)
 * console.log('Trees created:', result.treeCount)
 * console.log('Deduplicated:', result.deduplicatedCount)
 * ```
 *
 * @module ops/tree-builder
 */

import { TreeEntry } from '../types/objects'
import type { BasicObjectStore as ObjectStore } from '../types/storage'
import { hexToBytes } from '../utils/hash'

/** Valid file modes in git */
const VALID_MODES = new Set(['100644', '100755', '040000', '120000', '160000'])

/** Text encoder for creating tree data */
const encoder = new TextEncoder()

/**
 * Index entry from git index file.
 *
 * Represents a single file entry as stored in the Git index (staging area).
 *
 * @interface IndexEntry
 *
 * @example
 * ```typescript
 * const entry: IndexEntry = {
 *   path: 'src/main.ts',
 *   sha: 'abc123def456...',
 *   mode: '100644',
 *   flags: 0,
 *   size: 1234,
 *   mtime: Date.now(),
 *   ctime: Date.now()
 * }
 * ```
 */
export interface IndexEntry {
  /** File path relative to repository root */
  path: string

  /** SHA of the blob content */
  sha: string

  /**
   * File mode:
   * - '100644': Regular file
   * - '100755': Executable file
   * - '120000': Symbolic link
   * - '160000': Git submodule
   */
  mode: string

  /** Index flags (for merging, assume-unchanged, etc.) */
  flags: number

  /** File size in bytes */
  size: number

  /** Modification time (Unix timestamp or milliseconds) */
  mtime: number

  /** Creation/change time (Unix timestamp or milliseconds) */
  ctime: number
}

/**
 * ObjectStore interface for tree builder operations.
 * Re-exported from storage types for convenience.
 */
export type { ObjectStore }

/**
 * Tree node for building hierarchy.
 *
 * Represents a node in the intermediate tree structure used
 * during the build process.
 *
 * @interface TreeNode
 * @internal
 */
export interface TreeNode {
  /** Name of this node (file or directory name) */
  name: string

  /** Full path from repository root */
  path: string

  /** Whether this node represents a directory */
  isDirectory: boolean

  /** Child nodes (for directories) */
  children: Map<string, TreeNode>

  /** The index entry (only set for files, not directories) */
  entry?: IndexEntry
}

/**
 * Result of building a tree.
 *
 * Contains the root tree SHA, statistics about the build,
 * and optionally detailed information about subtrees.
 *
 * @interface BuildTreeResult
 *
 * @example
 * ```typescript
 * const result = await buildTreeFromIndex(store, entries)
 *
 * console.log(`Root SHA: ${result.sha}`)
 * console.log(`Created ${result.treeCount} tree objects`)
 * console.log(`${result.deduplicatedCount} were deduplicated`)
 *
 * // Access subtree information if available
 * if (result.subtrees) {
 *   for (const [name, subtree] of Object.entries(result.subtrees)) {
 *     console.log(`${name}/: ${subtree.sha}`)
 *   }
 * }
 * ```
 */
export interface BuildTreeResult {
  /** SHA of the root tree object */
  sha: string

  /** Tree entries at this level */
  entries: TreeEntry[]

  /** Total number of tree objects processed */
  treeCount: number

  /** Number of unique tree objects created */
  uniqueTreeCount: number

  /** Number of trees that were deduplicated (reused existing) */
  deduplicatedCount: number

  /**
   * Nested subtree results.
   * Keys are directory names, values are their BuildTreeResult.
   */
  subtrees?: Record<string, BuildTreeResult>
}

/**
 * Validate an index entry
 */
function validateEntry(entry: IndexEntry): void {
  // Check mode
  if (!VALID_MODES.has(entry.mode)) {
    throw new Error(`Invalid file mode: ${entry.mode}`)
  }

  // Check SHA format (40 hex characters)
  if (!/^[0-9a-f]{40}$/.test(entry.sha)) {
    throw new Error(`Invalid SHA format: ${entry.sha}`)
  }

  // Check path
  if (!entry.path || entry.path.length === 0) {
    throw new Error('Empty path not allowed')
  }

  if (entry.path.startsWith('/')) {
    throw new Error('Path must not start with /')
  }

  if (entry.path.includes('//')) {
    throw new Error('Path must not contain double slashes')
  }

  // Check for . or .. components
  const parts = entry.path.split('/')
  for (const part of parts) {
    if (part === '.' || part === '..') {
      throw new Error(`Path must not contain . or .. components: ${entry.path}`)
    }
  }
}

/**
 * Build a tree hierarchy from index entries
 */
export function buildTreeHierarchy(entries: IndexEntry[]): TreeNode {
  const root: TreeNode = {
    name: '',
    path: '',
    isDirectory: true,
    children: new Map()
  }

  for (const entry of entries) {
    const parts = entry.path.split('/')
    let current = root

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      const isLast = i === parts.length - 1
      const currentPath = parts.slice(0, i + 1).join('/')

      if (!current.children.has(part)) {
        const node: TreeNode = {
          name: part,
          path: currentPath,
          isDirectory: !isLast,
          children: new Map(),
          entry: isLast ? entry : undefined
        }
        current.children.set(part, node)
      } else if (isLast) {
        // Update entry for duplicate paths (last one wins)
        const existing = current.children.get(part)!
        existing.entry = entry
        existing.isDirectory = false
      }

      current = current.children.get(part)!
    }
  }

  return root
}

/**
 * Sort tree entries according to git conventions
 * Directories are sorted as if they have a trailing slash
 */
export function sortTreeEntries(entries: TreeEntry[]): TreeEntry[] {
  return [...entries].sort((a, b) => {
    // Directories sort as if they have trailing slash
    const aName = a.mode === '040000' ? a.name + '/' : a.name
    const bName = b.mode === '040000' ? b.name + '/' : b.name
    // Use byte-wise comparison (localeCompare with raw mode)
    if (aName < bName) return -1
    if (aName > bName) return 1
    return 0
  })
}

/**
 * Create tree object data from entries
 */
function createTreeData(entries: TreeEntry[]): Uint8Array {
  // Sort entries
  const sorted = sortTreeEntries(entries)

  // Build entry content
  const entryParts: Uint8Array[] = []
  for (const entry of sorted) {
    const modeName = encoder.encode(`${entry.mode} ${entry.name}\0`)
    const sha20 = hexToBytes(entry.sha)
    const entryData = new Uint8Array(modeName.length + 20)
    entryData.set(modeName)
    entryData.set(sha20, modeName.length)
    entryParts.push(entryData)
  }

  // Combine all parts
  const totalLength = entryParts.reduce((sum, part) => sum + part.length, 0)
  const content = new Uint8Array(totalLength)
  let offset = 0
  for (const part of entryParts) {
    content.set(part, offset)
    offset += part.length
  }

  return content
}

/**
 * Create a tree object and store it
 */
export async function createTreeObject(
  store: ObjectStore,
  entries: TreeEntry[]
): Promise<{ sha: string; type: 'tree'; data: Uint8Array }> {
  const data = createTreeData(entries)
  const sha = await store.storeObject('tree', data)
  return { sha, type: 'tree', data }
}

/**
 * Deduplicate trees based on their content hash
 * Returns a map of canonical tree content to path, and mapping of paths to canonical paths
 */
export function deduplicateTrees(
  trees: Map<string, TreeEntry[]>
): { deduplicated: Map<string, TreeEntry[]>; mapping: Map<string, string> } {
  const contentToPath = new Map<string, string>()
  const deduplicated = new Map<string, TreeEntry[]>()
  const mapping = new Map<string, string>()

  for (const [path, entries] of trees) {
    // Create a content key from sorted entries
    const sorted = sortTreeEntries(entries)
    const key = sorted.map(e => `${e.mode}:${e.name}:${e.sha}`).join('|')

    if (contentToPath.has(key)) {
      // Duplicate - map to existing path
      mapping.set(path, contentToPath.get(key)!)
    } else {
      // New unique tree
      contentToPath.set(key, path)
      deduplicated.set(path, entries)
      mapping.set(path, path)
    }
  }

  return { deduplicated, mapping }
}

/**
 * Build tree from index entries
 * This is the main entry point for tree building
 */
export async function buildTreeFromIndex(
  store: ObjectStore,
  entries: IndexEntry[]
): Promise<BuildTreeResult> {
  // Validate all entries first
  for (const entry of entries) {
    validateEntry(entry)
  }

  // Build hierarchy
  const hierarchy = buildTreeHierarchy(entries)

  // Track stats
  let treeCount = 0
  let uniqueTreeCount = 0
  const treeContentToSha = new Map<string, string>()

  // Store subtree results during build
  interface BuildResult {
    sha: string
    entries: TreeEntry[]
    subtrees: Record<string, BuildResult>
  }

  /**
   * Recursively build tree for a node
   */
  async function buildNode(node: TreeNode): Promise<BuildResult> {
    const treeEntries: TreeEntry[] = []
    const nodeSubtrees: Record<string, BuildResult> = {}

    // Process children
    const children = Array.from(node.children.values())

    for (const child of children) {
      if (child.isDirectory) {
        // Recursively build subtree
        const subtreeResult = await buildNode(child)
        nodeSubtrees[child.name] = subtreeResult
        treeEntries.push({
          mode: '040000',
          name: child.name,
          sha: subtreeResult.sha
        })
      } else if (child.entry) {
        // File entry
        treeEntries.push({
          mode: child.entry.mode,
          name: child.name,
          sha: child.entry.sha
        })
      }
    }

    // Sort entries
    const sortedEntries = sortTreeEntries(treeEntries)
    treeCount++

    // Check for deduplication
    const contentKey = sortedEntries.map(e => `${e.mode}:${e.name}:${e.sha}`).join('|')
    let sha: string

    if (treeContentToSha.has(contentKey)) {
      // Reuse existing tree SHA
      sha = treeContentToSha.get(contentKey)!
    } else {
      // Create new tree object
      const treeObj = await createTreeObject(store, sortedEntries)
      sha = treeObj.sha
      treeContentToSha.set(contentKey, sha)
      uniqueTreeCount++
    }

    return {
      sha,
      entries: sortedEntries,
      subtrees: nodeSubtrees
    }
  }

  // Build from root
  const result = await buildNode(hierarchy)

  // Convert BuildResult to BuildTreeResult format
  function convertToResult(br: BuildResult): BuildTreeResult {
    const subtreesConverted: Record<string, BuildTreeResult> = {}
    for (const [name, sub] of Object.entries(br.subtrees)) {
      subtreesConverted[name] = convertToResult(sub)
    }

    return {
      sha: br.sha,
      entries: br.entries,
      treeCount,
      uniqueTreeCount,
      deduplicatedCount: treeCount - uniqueTreeCount,
      subtrees: Object.keys(subtreesConverted).length > 0 ? subtreesConverted : undefined
    }
  }

  return convertToResult(result)
}
