/**
 * Git Tree Object
 *
 * Represents a Git tree object which stores directory structure.
 * Format: "tree <size>\0<entries>"
 * Entry format: "<mode> <name>\0<20-byte-sha>"
 */

import { calculateObjectHash, createObjectHeader, parseObjectHeader, bytesToHex, hexToBytes } from './hash'
import { type TreeEntry, isValidSha, isValidMode } from './types'

// =============================================================================
// Text Encoding Utilities
// =============================================================================

const encoder = new TextEncoder()
const decoder = new TextDecoder()

// =============================================================================
// Tree Entry Utilities
// =============================================================================

/**
 * Sorts tree entries according to Git's sorting rules.
 * Directories are sorted as if they have a trailing slash.
 */
export function sortTreeEntries(entries: TreeEntry[]): TreeEntry[] {
  return [...entries].sort((a, b) => {
    // For comparison, append '/' to directory names
    const nameA = a.mode === '040000' ? a.name + '/' : a.name
    const nameB = b.mode === '040000' ? b.name + '/' : b.name
    return nameA.localeCompare(nameB)
  })
}

/**
 * Parses tree entries from raw content (after header)
 * @param content - The raw tree content (without header)
 */
export function parseTreeEntries(content: Uint8Array): TreeEntry[] {
  const entries: TreeEntry[] = []
  let offset = 0

  while (offset < content.length) {
    // Find the space after mode
    let spaceIdx = offset
    while (spaceIdx < content.length && content[spaceIdx] !== 0x20) {
      spaceIdx++
    }
    if (spaceIdx >= content.length) break

    // Find the null byte after name
    let nullIdx = spaceIdx + 1
    while (nullIdx < content.length && content[nullIdx] !== 0) {
      nullIdx++
    }
    if (nullIdx >= content.length) break

    // Parse mode and name
    const mode = decoder.decode(content.slice(offset, spaceIdx))
    const name = decoder.decode(content.slice(spaceIdx + 1, nullIdx))

    // Parse 20-byte SHA
    const sha20 = content.slice(nullIdx + 1, nullIdx + 21)
    if (sha20.length !== 20) break

    const sha = bytesToHex(sha20)

    entries.push({ mode, name, sha })
    offset = nullIdx + 21
  }

  return entries
}

/**
 * Serializes tree entries to raw content (without header)
 */
export function serializeTreeEntries(entries: TreeEntry[]): Uint8Array {
  // Calculate total size
  let totalSize = 0
  for (const entry of entries) {
    // mode + space + name + null + 20 bytes sha
    totalSize += encoder.encode(`${entry.mode} ${entry.name}`).length + 1 + 20
  }

  const result = new Uint8Array(totalSize)
  let offset = 0

  for (const entry of entries) {
    // Write "mode name\0"
    const modeAndName = encoder.encode(`${entry.mode} ${entry.name}`)
    result.set(modeAndName, offset)
    offset += modeAndName.length
    result[offset] = 0 // null byte
    offset += 1

    // Write 20-byte SHA
    const sha20 = hexToBytes(entry.sha)
    result.set(sha20, offset)
    offset += 20
  }

  return result
}

// =============================================================================
// GitTree Class
// =============================================================================

/**
 * Git tree object - stores directory structure
 */
export class GitTree {
  readonly type = 'tree' as const
  readonly entries: readonly TreeEntry[]

  /**
   * Creates a new GitTree with the given entries
   * @param entries - The tree entries (will be sorted)
   * @throws Error if any entry has invalid mode, SHA, or name
   */
  constructor(entries: TreeEntry[]) {
    // Validate all entries
    for (const entry of entries) {
      if (!isValidMode(entry.mode)) {
        throw new Error(`Invalid mode: ${entry.mode}`)
      }
      if (!isValidSha(entry.sha)) {
        throw new Error(`Invalid SHA: ${entry.sha}`)
      }
      // Submodules (160000) may have paths with slashes for display purposes
      if (entry.name.includes('/') && entry.mode !== '160000') {
        throw new Error(`Invalid entry name: contains path separator: ${entry.name}`)
      }
      if (entry.name.includes('\0')) {
        throw new Error(`Invalid entry name: contains null byte: ${entry.name}`)
      }
    }

    // Sort entries according to Git rules
    this.entries = sortTreeEntries(entries)
  }

  /**
   * Parses a GitTree from serialized Git object format
   * @param data - The serialized data including header
   * @throws Error if the header is invalid or type is not tree
   */
  static parse(data: Uint8Array): GitTree {
    const { type, size, headerLength } = parseObjectHeader(data)

    if (type !== 'tree') {
      throw new Error(`Invalid tree header: expected 'tree', got '${type}'`)
    }

    const content = data.slice(headerLength)

    // Validate size matches actual content length
    if (content.length !== size) {
      throw new Error(`Size mismatch: header says ${size} bytes, but content is ${content.length} bytes`)
    }

    // Parse entries (empty tree has no entries)
    if (content.length === 0) {
      return new GitTree([])
    }

    const entries = parseTreeEntries(content)

    // Create tree without re-sorting (entries from Git are already sorted)
    const tree = Object.create(GitTree.prototype) as GitTree
    Object.defineProperty(tree, 'entries', { value: entries, writable: false })
    Object.defineProperty(tree, 'type', { value: 'tree', writable: false })

    return tree
  }

  /**
   * Checks if the tree is empty
   */
  isEmpty(): boolean {
    return this.entries.length === 0
  }

  /**
   * Gets an entry by name
   */
  getEntry(name: string): TreeEntry | undefined {
    return this.entries.find((e) => e.name === name)
  }

  /**
   * Checks if an entry is a directory
   */
  isDirectory(name: string): boolean {
    const entry = this.getEntry(name)
    return entry?.mode === '040000'
  }

  /**
   * Checks if an entry is an executable file
   */
  isExecutable(name: string): boolean {
    const entry = this.getEntry(name)
    return entry?.mode === '100755'
  }

  /**
   * Checks if an entry is a symbolic link
   */
  isSymlink(name: string): boolean {
    const entry = this.getEntry(name)
    return entry?.mode === '120000'
  }

  /**
   * Checks if an entry is a submodule
   */
  isSubmodule(name: string): boolean {
    const entry = this.getEntry(name)
    return entry?.mode === '160000'
  }

  /**
   * Serializes the tree to Git object format
   * Format: "tree <size>\0<entries>"
   */
  serialize(): Uint8Array {
    const content = serializeTreeEntries(this.entries as TreeEntry[])
    const header = createObjectHeader('tree', content.length)
    const result = new Uint8Array(header.length + content.length)
    result.set(header)
    result.set(content, header.length)
    return result
  }

  /**
   * Calculates the SHA-1 hash of this tree object
   * @returns Promise resolving to 40-character hex string
   */
  async hash(): Promise<string> {
    const content = serializeTreeEntries(this.entries as TreeEntry[])
    return calculateObjectHash('tree', content)
  }
}

// Re-export TreeEntry type
export type { TreeEntry }
