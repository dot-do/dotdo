/**
 * @fileoverview FSx CLI Adapter for Git Repository Operations
 *
 * This module provides a CLI adapter that uses the FSxStorageAdapter for Git
 * repository operations. It bridges the CLI interface (FSAdapter-compatible)
 * with the fsx-backed storage, allowing the CLI to work with any fsx storage.
 *
 * **Features**:
 * - Compatible with FSAdapter interface from fs-adapter.ts
 * - Uses FSxStorageAdapter for underlying storage operations
 * - Provides object retrieval, ref resolution, and listing operations
 * - Handles both loose objects and references
 *
 * **Note**: Pack file operations are not implemented as fsx uses CAS storage.
 * For pack file reading, use the standard fs-adapter.ts instead.
 *
 * @module cli/fsx-cli-adapter
 *
 * @example
 * ```typescript
 * import { createFSxCLIAdapter } from './fsx-cli-adapter'
 *
 * const adapter = await createFSxCLIAdapter('/path/to/repo')
 * const head = await adapter.getHead()
 * const commit = await adapter.getObject(head.target)
 * ```
 */

import * as path from 'path'
import * as fs from 'fs/promises'
import { createFSxAdapter } from '../storage/fsx-adapter'
import type { StorageBackend } from '../storage/backend'
import type { ObjectType } from '../types/objects'

// ============================================================================
// Types (compatible with fs-adapter.ts)
// ============================================================================

/**
 * Type of git reference.
 */
export type FSRefType = 'direct' | 'symbolic'

/**
 * A git reference.
 */
export interface FSRef {
  /** Full ref name (e.g., 'refs/heads/main') */
  name: string
  /** Target - SHA (direct) or ref name (symbolic) */
  target: string
  /** Type of reference */
  type: FSRefType
}

/**
 * A stored git object with metadata.
 */
export interface FSObject {
  /** SHA-1 hash of the object */
  sha: string
  /** Object type: blob, tree, commit, tag */
  type: ObjectType
  /** Size of the object data in bytes */
  size: number
  /** Raw object data (uncompressed) */
  data: Uint8Array
  /** Source location: 'loose' or 'pack' */
  source: 'loose' | 'pack'
  /** If from a pack, the pack file name */
  packFile?: string
}

/**
 * Resolved reference with SHA.
 */
export interface FSResolvedRef {
  /** The original ref */
  ref: FSRef
  /** Final SHA after resolving symbolic refs */
  sha: string
  /** Chain of refs followed */
  chain: FSRef[]
}

/**
 * A single entry in the git index (staging area).
 */
export interface IndexEntry {
  /** File path relative to repo root */
  path: string
  /** SHA of the blob */
  sha: string
  /** File mode */
  mode: number
  /** File size */
  size: number
  /** Modification time */
  mtime: Date
  /** Creation time */
  ctime: Date
  /** Stage number (0 for normal, 1-3 for conflicts) */
  stage: number
  /** Various flags */
  flags: {
    assumeValid: boolean
    extended: boolean
    skipWorktree: boolean
    intentToAdd: boolean
  }
}

/**
 * Tree entry from a tree object.
 */
export interface TreeEntry {
  /** File/directory mode */
  mode: number
  /** Name of the entry */
  name: string
  /** SHA-1 hash of the referenced object */
  sha: string
  /** Whether this is a tree (directory) or blob (file) */
  type: 'tree' | 'blob'
}

/**
 * Parsed commit object.
 */
export interface ParsedCommit {
  /** Tree SHA referenced by this commit */
  tree: string
  /** Parent commit SHAs */
  parents: string[]
  /** Author information */
  author: {
    name: string
    email: string
    timestamp: number
    timezone: string
  }
  /** Committer information */
  committer: {
    name: string
    email: string
    timestamp: number
    timezone: string
  }
  /** Commit message */
  message: string
  /** GPG signature if present */
  gpgSig?: string
}

// ============================================================================
// Errors
// ============================================================================

/**
 * Error codes for FSx CLI adapter operations.
 */
export type FSxCLIAdapterErrorCode =
  | 'NOT_A_GIT_REPO'
  | 'OBJECT_NOT_FOUND'
  | 'REF_NOT_FOUND'
  | 'CORRUPT_OBJECT'
  | 'INVALID_SHA'
  | 'READ_ERROR'
  | 'NOT_IMPLEMENTED'

/**
 * Error thrown by FSx CLI adapter operations.
 */
export class FSxCLIAdapterError extends Error {
  constructor(
    message: string,
    public readonly code: FSxCLIAdapterErrorCode,
    public readonly path?: string
  ) {
    super(message)
    this.name = 'FSxCLIAdapterError'
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

const decoder = new TextDecoder()

function isValidSha(sha: string): boolean {
  return /^[0-9a-f]{40}$/i.test(sha)
}

/**
 * Parse a tree object's binary content into entries.
 */
function parseTreeContent(data: Uint8Array): TreeEntry[] {
  const entries: TreeEntry[] = []
  let offset = 0

  while (offset < data.length) {
    // Format: "<mode> <name>\0<20-byte-sha>"

    // Find the space between mode and name
    let spaceIndex = offset
    while (spaceIndex < data.length && data[spaceIndex] !== 0x20) {
      spaceIndex++
    }

    const mode = parseInt(decoder.decode(data.subarray(offset, spaceIndex)), 8)
    offset = spaceIndex + 1

    // Find the null terminator after the name
    let nullIndex = offset
    while (nullIndex < data.length && data[nullIndex] !== 0) {
      nullIndex++
    }

    const name = decoder.decode(data.subarray(offset, nullIndex))
    offset = nullIndex + 1

    // Read 20-byte SHA
    const shaBytes = data.subarray(offset, offset + 20)
    const sha = Array.from(shaBytes).map(b => b.toString(16).padStart(2, '0')).join('')
    offset += 20

    // Determine type from mode
    const type = (mode & 0o170000) === 0o040000 ? 'tree' : 'blob'

    entries.push({ mode, name, sha, type })
  }

  return entries
}

/**
 * Parse author/committer line.
 */
function parseIdentityLine(line: string): { name: string; email: string; timestamp: number; timezone: string } {
  // Format: "Name <email> timestamp timezone"
  const match = line.match(/^(.+) <(.+)> (\d+) ([+-]\d{4})$/)
  if (!match) {
    return { name: '', email: '', timestamp: 0, timezone: '+0000' }
  }

  return {
    name: match[1],
    email: match[2],
    timestamp: parseInt(match[3], 10),
    timezone: match[4]
  }
}

/**
 * Parse a commit object's content.
 */
function parseCommitContent(data: Uint8Array): ParsedCommit {
  const content = decoder.decode(data)
  const lines = content.split('\n')

  let tree = ''
  const parents: string[] = []
  let author = { name: '', email: '', timestamp: 0, timezone: '+0000' }
  let committer = { name: '', email: '', timestamp: 0, timezone: '+0000' }
  let gpgSig: string | undefined
  let messageStart = 0
  let inGpgSig = false
  let gpgSigLines: string[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    if (inGpgSig) {
      gpgSigLines.push(line)
      if (line.includes('-----END')) {
        inGpgSig = false
        gpgSig = gpgSigLines.join('\n')
      }
      continue
    }

    if (line === '') {
      // Empty line marks start of message
      messageStart = i + 1
      break
    }

    if (line.startsWith('tree ')) {
      tree = line.slice(5)
    } else if (line.startsWith('parent ')) {
      parents.push(line.slice(7))
    } else if (line.startsWith('author ')) {
      author = parseIdentityLine(line.slice(7))
    } else if (line.startsWith('committer ')) {
      committer = parseIdentityLine(line.slice(10))
    } else if (line.startsWith('gpgsig ')) {
      inGpgSig = true
      gpgSigLines = [line.slice(7)]
    }
  }

  const message = lines.slice(messageStart).join('\n')

  return {
    tree,
    parents,
    author,
    committer,
    message,
    gpgSig
  }
}

// ============================================================================
// FSxCLIAdapter Implementation
// ============================================================================

/**
 * CLI adapter that uses fsx for Git repository operations.
 *
 * @description
 * This adapter wraps FSxStorageAdapter to provide a CLI-friendly interface
 * compatible with the FSAdapter interface from fs-adapter.ts. It allows
 * the CLI to work with any fsx-backed storage.
 *
 * @example
 * ```typescript
 * const adapter = await createFSxCLIAdapter('/path/to/repo')
 *
 * // Get HEAD reference
 * const head = await adapter.getHead()
 *
 * // Resolve to SHA
 * const resolved = await adapter.resolveRef('HEAD')
 * console.log(`Current commit: ${resolved.sha}`)
 *
 * // Get commit object
 * const commit = await adapter.getCommit(resolved.sha)
 * console.log(`Message: ${commit.message}`)
 * ```
 */
export class FSxCLIAdapter {
  private backend: StorageBackend
  private gitDir: string
  private repoPath: string

  /**
   * Create a new FSxCLIAdapter.
   *
   * @param repoPath - Path to the repository root
   * @param options - Optional configuration
   */
  constructor(repoPath: string, options?: { gitDir?: string }) {
    this.repoPath = repoPath
    this.gitDir = options?.gitDir ?? path.join(repoPath, '.git')
    this.backend = createFSxAdapter(this.gitDir)
  }

  // ==========================================================================
  // Object Operations
  // ==========================================================================

  /**
   * Get a git object by its SHA.
   *
   * @param sha - 40-character SHA-1 hash
   * @returns The object if found, null otherwise
   */
  async getObject(sha: string): Promise<FSObject | null> {
    if (!sha || sha.length !== 40) {
      throw new FSxCLIAdapterError(`Invalid SHA: ${sha}`, 'INVALID_SHA')
    }

    if (!isValidSha(sha)) {
      return null
    }

    const normalizedSha = sha.toLowerCase()
    const result = await this.backend.getObject(normalizedSha)

    if (!result) {
      return null
    }

    return {
      sha: normalizedSha,
      type: result.type,
      size: result.content.length,
      data: result.content,
      source: 'loose'
    }
  }

  /**
   * Check if an object exists.
   *
   * @param sha - 40-character SHA-1 hash
   * @returns true if the object exists
   */
  async hasObject(sha: string): Promise<boolean> {
    if (!isValidSha(sha)) {
      return false
    }
    return this.backend.hasObject(sha.toLowerCase())
  }

  /**
   * Get object type without loading full data.
   *
   * @param sha - 40-character SHA-1 hash
   * @returns The object type if found, null otherwise
   */
  async getObjectType(sha: string): Promise<ObjectType | null> {
    const obj = await this.getObject(sha)
    return obj ? obj.type : null
  }

  /**
   * Get object size without loading full data.
   *
   * @param sha - 40-character SHA-1 hash
   * @returns The object size in bytes if found, null otherwise
   */
  async getObjectSize(sha: string): Promise<number | null> {
    const obj = await this.getObject(sha)
    return obj ? obj.size : null
  }

  /**
   * Read a blob object's content.
   *
   * @param sha - 40-character SHA-1 hash of a blob
   * @returns The blob content as Uint8Array
   */
  async readBlob(sha: string): Promise<Uint8Array> {
    const obj = await this.getObject(sha)
    if (!obj) {
      throw new FSxCLIAdapterError(`Blob not found: ${sha}`, 'OBJECT_NOT_FOUND')
    }
    if (obj.type !== 'blob') {
      throw new FSxCLIAdapterError(`Object is not a blob: ${sha}`, 'CORRUPT_OBJECT')
    }
    return obj.data
  }

  /**
   * Read a tree object's entries.
   *
   * @param sha - 40-character SHA-1 hash of a tree
   * @returns Array of tree entries
   */
  async readTree(sha: string): Promise<TreeEntry[]> {
    const obj = await this.getObject(sha)
    if (!obj) {
      throw new FSxCLIAdapterError(`Tree not found: ${sha}`, 'OBJECT_NOT_FOUND')
    }
    if (obj.type !== 'tree') {
      throw new FSxCLIAdapterError(`Object is not a tree: ${sha}`, 'CORRUPT_OBJECT')
    }
    return parseTreeContent(obj.data)
  }

  /**
   * Get a parsed commit object.
   *
   * @param sha - 40-character SHA-1 hash of a commit
   * @returns Parsed commit object
   */
  async getCommit(sha: string): Promise<ParsedCommit> {
    const obj = await this.getObject(sha)
    if (!obj) {
      throw new FSxCLIAdapterError(`Commit not found: ${sha}`, 'OBJECT_NOT_FOUND')
    }
    if (obj.type !== 'commit') {
      throw new FSxCLIAdapterError(`Object is not a commit: ${sha}`, 'CORRUPT_OBJECT')
    }
    return parseCommitContent(obj.data)
  }

  // ==========================================================================
  // Reference Operations
  // ==========================================================================

  /**
   * Get HEAD reference.
   *
   * @returns HEAD reference (symbolic or direct), or null if not found
   */
  async getHead(): Promise<FSRef | null> {
    const ref = await this.backend.getRef('HEAD')
    if (!ref) {
      return null
    }
    return {
      name: ref.name,
      target: ref.target,
      type: ref.type as FSRefType
    }
  }

  /**
   * Get a reference by name.
   *
   * @param name - Full ref name (e.g., 'refs/heads/main', 'HEAD')
   * @returns The ref if found, null otherwise
   */
  async getRef(name: string): Promise<FSRef | null> {
    const ref = await this.backend.getRef(name)
    if (!ref) {
      return null
    }
    return {
      name: ref.name,
      target: ref.target,
      type: ref.type as FSRefType
    }
  }

  /**
   * Resolve a reference to its final SHA.
   *
   * @param name - Ref name to resolve
   * @returns Resolved ref with SHA and resolution chain, or null if not found
   */
  async resolveRef(name: string): Promise<FSResolvedRef | null> {
    const chain: FSRef[] = []
    let current = name
    const visited = new Set<string>()

    while (true) {
      if (visited.has(current)) {
        throw new FSxCLIAdapterError(`Circular ref: ${current}`, 'CORRUPT_OBJECT')
      }
      visited.add(current)

      const ref = await this.getRef(current)
      if (!ref) {
        return null
      }

      chain.push(ref)

      if (ref.type === 'direct') {
        return {
          ref,
          sha: ref.target,
          chain
        }
      }

      current = ref.target
    }
  }

  /**
   * Check if HEAD is detached (pointing directly to a SHA).
   *
   * @returns true if HEAD points directly to a SHA
   */
  async isHeadDetached(): Promise<boolean> {
    const head = await this.getHead()
    return head ? head.type === 'direct' : false
  }

  /**
   * List all branches.
   *
   * @returns Array of branch names (without 'refs/heads/' prefix)
   */
  async listBranches(): Promise<string[]> {
    const refs = await this.backend.listRefs('refs/heads/')
    return refs.map(ref => ref.name.replace(/^refs\/heads\//, ''))
  }

  /**
   * List all tags.
   *
   * @returns Array of tag names (without 'refs/tags/' prefix)
   */
  async listTags(): Promise<string[]> {
    const refs = await this.backend.listRefs('refs/tags/')
    return refs.map(ref => ref.name.replace(/^refs\/tags\//, ''))
  }

  /**
   * List all refs matching an optional prefix.
   *
   * @param prefix - Optional prefix to filter refs
   * @returns Array of refs
   */
  async listRefs(prefix?: string): Promise<FSRef[]> {
    const refs = await this.backend.listRefs(prefix)
    return refs.map(ref => ({
      name: ref.name,
      target: ref.target,
      type: ref.type as FSRefType
    }))
  }

  // ==========================================================================
  // Repository Information
  // ==========================================================================

  /**
   * Get the repository path.
   */
  getRepoPath(): string {
    return this.repoPath
  }

  /**
   * Get the git directory path.
   */
  getGitDir(): string {
    return this.gitDir
  }

  /**
   * Check if this is a valid git repository.
   *
   * @returns true if valid git repository structure exists
   */
  async isGitRepository(): Promise<boolean> {
    const headExists = await this.backend.exists('HEAD')
    const objectsExists = await this.backend.exists('objects')
    const refsExists = await this.backend.exists('refs')
    return headExists && objectsExists && refsExists
  }

  /**
   * Get repository description.
   *
   * @returns Contents of .git/description file, or null
   */
  async getDescription(): Promise<string | null> {
    const data = await this.backend.readFile('description')
    if (!data) {
      return null
    }
    return decoder.decode(data).trim()
  }

  // ==========================================================================
  // Index Operations (Not Implemented)
  // ==========================================================================

  /**
   * Get index entries.
   *
   * @description Index operations are not implemented in the fsx adapter.
   * Use the standard fs-adapter for index operations.
   */
  async getIndexEntries(): Promise<IndexEntry[]> {
    throw new FSxCLIAdapterError(
      'Index operations not implemented in fsx adapter',
      'NOT_IMPLEMENTED'
    )
  }

  // ==========================================================================
  // Pack Operations (Not Implemented)
  // ==========================================================================

  /**
   * List pack files.
   *
   * @description Pack file operations are not implemented in the fsx adapter.
   * fsx uses CAS storage instead of pack files.
   */
  async listPackFiles(): Promise<string[]> {
    // fsx doesn't use pack files - return empty array
    return []
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Check if a directory is a git repository.
 *
 * @description Validates whether the given path is a valid git repository
 * by checking for the presence of .git directory and required git files.
 *
 * @param repoPath - Path to check
 * @returns true if the path is a valid git repository
 *
 * @example
 * ```typescript
 * if (await isGitRepository('/path/to/repo')) {
 *   console.log('Valid git repository')
 * }
 * ```
 */
export async function isGitRepository(repoPath: string): Promise<boolean> {
  try {
    const gitPath = path.join(repoPath, '.git')

    // Check if .git exists (file or directory)
    try {
      const stat = await fs.stat(gitPath)

      if (stat.isFile()) {
        // .git file (worktree) - read the actual gitdir path
        const content = await fs.readFile(gitPath, 'utf8')
        const match = content.match(/^gitdir:\s*(.+)$/m)
        if (match) {
          const actualGitDir = path.resolve(repoPath, match[1].trim())
          return await isValidGitDir(actualGitDir)
        }
        return false
      } else if (stat.isDirectory()) {
        return await isValidGitDir(gitPath)
      }
    } catch {
      // .git doesn't exist, check if repoPath itself is a bare repo
    }

    // Check if repoPath itself is a bare repo
    return await isValidGitDir(repoPath)
  } catch {
    return false
  }
}

/**
 * Check if a directory is a valid git directory.
 */
async function isValidGitDir(gitDir: string): Promise<boolean> {
  try {
    const [headExists, objectsExists, refsExists] = await Promise.all([
      fs.access(path.join(gitDir, 'HEAD')).then(() => true).catch(() => false),
      fs.stat(path.join(gitDir, 'objects')).then(s => s.isDirectory()).catch(() => false),
      fs.stat(path.join(gitDir, 'refs')).then(s => s.isDirectory()).catch(() => false)
    ])
    return headExists && objectsExists && refsExists
  } catch {
    return false
  }
}

/**
 * Create an FSx CLI adapter for a local git repository.
 *
 * @description Factory function that creates an FSxCLIAdapter for a git repository.
 * Uses fsx storage backend for all operations.
 *
 * @param repoPath - Path to the repository root
 * @param options - Optional configuration
 * @returns A fully initialized FSxCLIAdapter instance
 *
 * @throws {FSxCLIAdapterError} With code 'NOT_A_GIT_REPO' if the path is not a valid git repository
 *
 * @example
 * ```typescript
 * // Create adapter for a regular repository
 * const adapter = await createFSxCLIAdapter('/path/to/repo')
 *
 * // Create adapter with custom git directory
 * const adapter = await createFSxCLIAdapter('/path/to/repo', {
 *   gitDir: '/path/to/custom/.git'
 * })
 * ```
 */
export async function createFSxCLIAdapter(
  repoPath: string,
  options?: { gitDir?: string }
): Promise<FSxCLIAdapter> {
  // Check if path exists
  try {
    await fs.access(repoPath)
  } catch {
    throw new FSxCLIAdapterError(
      `Path does not exist: ${repoPath}`,
      'NOT_A_GIT_REPO',
      repoPath
    )
  }

  let gitDir: string

  if (options?.gitDir) {
    gitDir = options.gitDir
  } else {
    // Detect git directory
    const gitPath = path.join(repoPath, '.git')

    try {
      const stat = await fs.stat(gitPath)

      if (stat.isFile()) {
        // .git file (worktree)
        const content = await fs.readFile(gitPath, 'utf8')
        const match = content.match(/^gitdir:\s*(.+)$/m)
        if (match) {
          gitDir = path.resolve(repoPath, match[1].trim())
        } else {
          throw new FSxCLIAdapterError(
            `Invalid .git file: ${gitPath}`,
            'NOT_A_GIT_REPO',
            gitPath
          )
        }
      } else if (stat.isDirectory()) {
        gitDir = gitPath
      } else {
        throw new FSxCLIAdapterError(
          `Not a git repository: ${repoPath}`,
          'NOT_A_GIT_REPO',
          repoPath
        )
      }
    } catch (error) {
      if (error instanceof FSxCLIAdapterError) {
        throw error
      }
      // .git doesn't exist, check if repoPath is a bare repo
      if (await isValidGitDir(repoPath)) {
        gitDir = repoPath
      } else {
        throw new FSxCLIAdapterError(
          `Not a git repository: ${repoPath}`,
          'NOT_A_GIT_REPO',
          repoPath
        )
      }
    }
  }

  // Validate the git directory
  if (!await isValidGitDir(gitDir)) {
    throw new FSxCLIAdapterError(
      `Invalid git directory: ${gitDir}`,
      'NOT_A_GIT_REPO',
      gitDir
    )
  }

  return new FSxCLIAdapter(repoPath, { gitDir })
}
