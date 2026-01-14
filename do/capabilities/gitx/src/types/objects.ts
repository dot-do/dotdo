/**
 * @fileoverview Git Object Types and Serialization
 *
 * This module defines the core Git object types (blob, tree, commit, tag) and provides
 * functions for serializing and deserializing these objects in the Git format.
 *
 * Git uses a content-addressable storage model where each object is identified by
 * its SHA-1 hash. The format for each object type is:
 * - Header: "{type} {size}\0"
 * - Content: type-specific binary data
 *
 * @module types/objects
 *
 * @example
 * ```typescript
 * import { serializeBlob, parseBlob, isBlob } from './types/objects'
 *
 * // Create and serialize a blob
 * const content = new TextEncoder().encode('Hello, World!')
 * const serialized = serializeBlob(content)
 *
 * // Parse it back
 * const blob = parseBlob(serialized)
 * console.log(blob.type) // 'blob'
 * ```
 */

/**
 * The four Git object types.
 *
 * @description
 * - `blob`: Raw file content
 * - `tree`: Directory listing (contains references to blobs and other trees)
 * - `commit`: A snapshot pointing to a tree with metadata (author, message, parents)
 * - `tag`: An annotated tag pointing to another object with metadata
 */
export type ObjectType = 'blob' | 'tree' | 'commit' | 'tag'

/**
 * Base interface for all Git objects.
 *
 * @description
 * All Git objects share a common structure with a type discriminator
 * and raw binary data. The data field contains the object content
 * WITHOUT the Git header (type and size).
 *
 * @property type - The object type discriminator
 * @property data - Raw binary content of the object (excluding header)
 */
export interface GitObject {
  /** The type of Git object */
  type: ObjectType
  /** Raw binary data of the object content */
  data: Uint8Array
}

/**
 * A Git blob object representing raw file content.
 *
 * @description
 * Blobs are the simplest Git objects - they just store raw file content.
 * The data field contains the file content as-is, without any transformation.
 *
 * @example
 * ```typescript
 * const blob: BlobObject = {
 *   type: 'blob',
 *   data: new TextEncoder().encode('file content')
 * }
 * ```
 */
export interface BlobObject extends GitObject {
  /** Type discriminator - always 'blob' for blob objects */
  type: 'blob'
}

/**
 * A single entry in a Git tree object.
 *
 * @description
 * Tree entries represent files or subdirectories within a directory.
 * Each entry has a file mode, name, and SHA-1 reference to the content.
 *
 * @property mode - Unix file mode as a string
 * @property name - File or directory name (no path separators)
 * @property sha - 40-character hex SHA-1 of the referenced object
 *
 * @example
 * ```typescript
 * const fileEntry: TreeEntry = {
 *   mode: '100644',    // Regular file
 *   name: 'README.md',
 *   sha: 'abc123...'   // SHA-1 of the blob
 * }
 *
 * const dirEntry: TreeEntry = {
 *   mode: '040000',    // Directory
 *   name: 'src',
 *   sha: 'def456...'   // SHA-1 of another tree
 * }
 * ```
 */
export interface TreeEntry {
  /**
   * Unix file mode string.
   * Common values:
   * - '100644': Regular file
   * - '100755': Executable file
   * - '040000': Directory (subdirectory)
   * - '120000': Symbolic link
   * - '160000': Git submodule (gitlink)
   */
  mode: string  // '100644', '100755', '040000', '120000', '160000'
  /** File or directory name */
  name: string
  /** 40-character lowercase hex SHA-1 hash of the referenced object */
  sha: string
}

/**
 * A Git tree object representing a directory.
 *
 * @description
 * Trees are Git's way of representing directories. Each tree contains
 * entries pointing to blobs (files) or other trees (subdirectories).
 * Entries are sorted by name with a special rule for directories.
 *
 * @example
 * ```typescript
 * const tree: TreeObject = {
 *   type: 'tree',
 *   data: rawTreeData,
 *   entries: [
 *     { mode: '100644', name: 'file.txt', sha: '...' },
 *     { mode: '040000', name: 'subdir', sha: '...' }
 *   ]
 * }
 * ```
 */
export interface TreeObject extends GitObject {
  /** Type discriminator - always 'tree' for tree objects */
  type: 'tree'
  /** Parsed tree entries (files and subdirectories) */
  entries: TreeEntry[]
}

/**
 * Author/committer/tagger information.
 *
 * @description
 * Represents identity information used in commits and tags.
 * Includes name, email, Unix timestamp, and timezone offset.
 *
 * @property name - Full name of the person
 * @property email - Email address
 * @property timestamp - Unix timestamp in seconds
 * @property timezone - Timezone offset string (e.g., '+0530', '-0800')
 *
 * @example
 * ```typescript
 * const author: Author = {
 *   name: 'John Doe',
 *   email: 'john@example.com.ai',
 *   timestamp: 1704067200,  // Unix seconds
 *   timezone: '-0800'       // PST
 * }
 * ```
 */
export interface Author {
  /** Full name of the author */
  name: string
  /** Email address */
  email: string
  /** Unix timestamp in seconds since epoch */
  timestamp: number
  /** Timezone offset in +/-HHMM format (e.g., '+0530', '-0800') */
  timezone: string
}

/**
 * A Git commit object representing a snapshot in history.
 *
 * @description
 * Commits are the core of Git's version control. Each commit points to
 * a tree (representing the project state), has zero or more parent commits,
 * and includes author/committer information with a message.
 *
 * @property tree - SHA-1 of the tree object representing project state
 * @property parents - Array of parent commit SHA-1s (empty for initial commit)
 * @property author - Who created the original changes
 * @property committer - Who created the commit
 * @property message - Commit message describing the changes
 *
 * @example
 * ```typescript
 * const commit: CommitObject = {
 *   type: 'commit',
 *   data: rawCommitData,
 *   tree: 'abc123...',
 *   parents: ['parent1sha...'],
 *   author: { name: 'Alice', email: 'alice@example.com.ai', timestamp: 1704067200, timezone: '+0000' },
 *   committer: { name: 'Alice', email: 'alice@example.com.ai', timestamp: 1704067200, timezone: '+0000' },
 *   message: 'Initial commit\n\nAdd project structure'
 * }
 * ```
 */
export interface CommitObject extends GitObject {
  /** Type discriminator - always 'commit' for commit objects */
  type: 'commit'
  /** 40-character hex SHA-1 of the root tree object */
  tree: string
  /** Array of parent commit SHA-1s (empty for root commit, multiple for merge) */
  parents: string[]
  /** Original author of the changes */
  author: Author
  /** Person who created this commit (may differ from author in cherry-picks, rebases) */
  committer: Author
  /** Commit message including subject line and optional body */
  message: string
}

/**
 * A Git tag object (annotated tag).
 *
 * @description
 * Annotated tags are Git objects that contain metadata about a tag,
 * including who created it, when, and an optional message. They can
 * point to any Git object (usually commits).
 *
 * Note: Lightweight tags are just refs pointing directly to commits,
 * not tag objects.
 *
 * @property object - SHA-1 of the tagged object
 * @property objectType - Type of the tagged object
 * @property tagger - Who created the tag (optional for some tags)
 * @property message - Tag message/annotation
 * @property name - Tag name
 * @property tag - Alternative tag name field (deprecated, use name)
 *
 * @example
 * ```typescript
 * const tag: TagObject = {
 *   type: 'tag',
 *   data: rawTagData,
 *   object: 'commitsha...',
 *   objectType: 'commit',
 *   name: 'v1.0.0',
 *   tagger: { name: 'Bob', email: 'bob@example.com.ai', timestamp: 1704067200, timezone: '+0000' },
 *   message: 'Release version 1.0.0'
 * }
 * ```
 */
export interface TagObject extends GitObject {
  /** Type discriminator - always 'tag' for tag objects */
  type: 'tag'
  /** 40-character hex SHA-1 of the tagged object */
  object: string
  /** Type of the object being tagged */
  objectType: ObjectType
  /** Tag creator information (optional for lightweight-style annotated tags) */
  tagger?: Author
  /** Tag annotation message */
  message: string
  /** Tag name (e.g., 'v1.0.0') */
  name: string
  /** Alternative tag name field (deprecated, prefer 'name') */
  tag?: string
}

// ============================================================================
// Validation Helpers
// ============================================================================

/**
 * Valid SHA-1 hash pattern (40 lowercase hexadecimal characters).
 *
 * @description
 * Regular expression for validating SHA-1 hashes used in Git.
 * Matches exactly 40 lowercase hexadecimal characters.
 *
 * @example
 * ```typescript
 * if (SHA_PATTERN.test(input)) {
 *   // Valid SHA-1 format
 * }
 * ```
 */
export const SHA_PATTERN = /^[0-9a-f]{40}$/

/**
 * Valid file modes in Git.
 *
 * @description
 * The set of valid mode strings for tree entries:
 * - '100644': Regular file (non-executable)
 * - '100755': Executable file
 * - '040000': Directory (tree)
 * - '120000': Symbolic link
 * - '160000': Git submodule (gitlink)
 */
export const VALID_MODES = new Set(['100644', '100755', '040000', '120000', '160000'])

/**
 * Validate a SHA-1 hash string.
 *
 * @description
 * Checks if a string is a valid Git SHA-1 hash (40 lowercase hex characters).
 * Use this to validate user input or data from external sources.
 *
 * @param sha - The string to validate
 * @returns True if the string is a valid SHA-1 hash
 *
 * @example
 * ```typescript
 * if (isValidSha('abc123')) {
 *   console.log('Invalid SHA') // Too short
 * }
 *
 * if (isValidSha('da39a3ee5e6b4b0d3255bfef95601890afd80709')) {
 *   console.log('Valid SHA')
 * }
 * ```
 */
export function isValidSha(sha: string): boolean {
  return typeof sha === 'string' && SHA_PATTERN.test(sha)
}

/**
 * Validate a Git object type string.
 *
 * @description
 * Checks if a string is one of the four valid Git object types.
 *
 * @param type - The string to validate
 * @returns True if the string is a valid object type
 *
 * @example
 * ```typescript
 * if (isValidObjectType(input)) {
 *   // input is 'blob' | 'tree' | 'commit' | 'tag'
 * }
 * ```
 */
export function isValidObjectType(type: string): type is ObjectType {
  return type === 'blob' || type === 'tree' || type === 'commit' || type === 'tag'
}

/**
 * Validate a tree entry mode string.
 *
 * @description
 * Checks if a string is a valid Git tree entry mode.
 *
 * @param mode - The mode string to validate
 * @returns True if the mode is valid
 *
 * @example
 * ```typescript
 * if (isValidMode('100644')) {
 *   console.log('Valid regular file mode')
 * }
 * ```
 */
export function isValidMode(mode: string): boolean {
  return VALID_MODES.has(mode)
}

/**
 * Validate a tree entry object.
 *
 * @description
 * Validates all fields of a tree entry including mode, name, and SHA.
 * Returns an object with validity status and optional error message.
 *
 * @param entry - The tree entry to validate
 * @returns Validation result with isValid boolean and optional error message
 *
 * @example
 * ```typescript
 * const result = validateTreeEntry({ mode: '100644', name: 'file.txt', sha: 'abc...' })
 * if (!result.isValid) {
 *   console.error(result.error)
 * }
 * ```
 */
export function validateTreeEntry(entry: TreeEntry): { isValid: boolean; error?: string } {
  if (!isValidMode(entry.mode)) {
    return { isValid: false, error: `Invalid mode: ${entry.mode}. Valid modes: ${Array.from(VALID_MODES).join(', ')}` }
  }
  if (!entry.name || typeof entry.name !== 'string') {
    return { isValid: false, error: 'Entry name is required and must be a string' }
  }
  if (entry.name.includes('/') || entry.name.includes('\0')) {
    return { isValid: false, error: 'Entry name cannot contain "/" or null characters' }
  }
  if (!isValidSha(entry.sha)) {
    return { isValid: false, error: `Invalid SHA: ${entry.sha}. Must be 40 lowercase hex characters` }
  }
  return { isValid: true }
}

/**
 * Validate an author object.
 *
 * @description
 * Validates all fields of an Author object including name, email,
 * timestamp, and timezone format.
 *
 * @param author - The author object to validate
 * @returns Validation result with isValid boolean and optional error message
 *
 * @example
 * ```typescript
 * const result = validateAuthor({
 *   name: 'Alice',
 *   email: 'alice@example.com.ai',
 *   timestamp: 1704067200,
 *   timezone: '+0000'
 * })
 * if (!result.isValid) {
 *   console.error(result.error)
 * }
 * ```
 */
export function validateAuthor(author: Author): { isValid: boolean; error?: string } {
  if (!author.name || typeof author.name !== 'string') {
    return { isValid: false, error: 'Author name is required and must be a string' }
  }
  if (!author.email || typeof author.email !== 'string') {
    return { isValid: false, error: 'Author email is required and must be a string' }
  }
  if (typeof author.timestamp !== 'number' || !Number.isInteger(author.timestamp) || author.timestamp < 0) {
    return { isValid: false, error: 'Timestamp must be a non-negative integer (Unix seconds)' }
  }
  if (!/^[+-]\d{4}$/.test(author.timezone)) {
    return { isValid: false, error: `Invalid timezone format: ${author.timezone}. Expected +/-HHMM (e.g., +0530, -0800)` }
  }
  return { isValid: true }
}

/**
 * Validate a commit object (excluding type and data fields).
 *
 * @description
 * Validates the structure and content of commit fields.
 * Checks tree SHA, parent SHAs, author, committer, and message.
 *
 * @param commit - The commit data to validate
 * @returns Validation result with isValid boolean and optional error message
 *
 * @example
 * ```typescript
 * const result = validateCommit({
 *   tree: 'abc123...',
 *   parents: ['parent1...'],
 *   author: { ... },
 *   committer: { ... },
 *   message: 'Initial commit'
 * })
 * ```
 */
export function validateCommit(commit: Omit<CommitObject, 'type' | 'data'>): { isValid: boolean; error?: string } {
  if (!isValidSha(commit.tree)) {
    return { isValid: false, error: `Invalid tree SHA: ${commit.tree}` }
  }
  for (let i = 0; i < commit.parents.length; i++) {
    if (!isValidSha(commit.parents[i])) {
      return { isValid: false, error: `Invalid parent SHA at index ${i}: ${commit.parents[i]}` }
    }
  }
  const authorResult = validateAuthor(commit.author)
  if (!authorResult.isValid) {
    return { isValid: false, error: `Invalid author: ${authorResult.error}` }
  }
  const committerResult = validateAuthor(commit.committer)
  if (!committerResult.isValid) {
    return { isValid: false, error: `Invalid committer: ${committerResult.error}` }
  }
  if (typeof commit.message !== 'string') {
    return { isValid: false, error: 'Commit message must be a string' }
  }
  return { isValid: true }
}

/**
 * Validate a tag object (excluding type and data fields).
 *
 * @description
 * Validates the structure and content of tag fields.
 * Checks object SHA, object type, name, tagger, and message.
 *
 * @param tag - The tag data to validate
 * @returns Validation result with isValid boolean and optional error message
 *
 * @example
 * ```typescript
 * const result = validateTag({
 *   object: 'commitsha...',
 *   objectType: 'commit',
 *   name: 'v1.0.0',
 *   tagger: { ... },
 *   message: 'Release v1.0.0'
 * })
 * ```
 */
export function validateTag(tag: Omit<TagObject, 'type' | 'data'>): { isValid: boolean; error?: string } {
  if (!isValidSha(tag.object)) {
    return { isValid: false, error: `Invalid object SHA: ${tag.object}` }
  }
  if (!isValidObjectType(tag.objectType)) {
    return { isValid: false, error: `Invalid object type: ${tag.objectType}` }
  }
  if (!tag.name || typeof tag.name !== 'string') {
    return { isValid: false, error: 'Tag name is required and must be a string' }
  }
  if (tag.tagger) {
    const taggerResult = validateAuthor(tag.tagger)
    if (!taggerResult.isValid) {
      return { isValid: false, error: `Invalid tagger: ${taggerResult.error}` }
    }
  }
  if (typeof tag.message !== 'string') {
    return { isValid: false, error: 'Tag message must be a string' }
  }
  return { isValid: true }
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Type guard to check if a GitObject is a BlobObject.
 *
 * @description
 * Narrows the type of a GitObject to BlobObject based on the type field.
 *
 * @param obj - The Git object to check
 * @returns True if the object is a blob, false otherwise
 *
 * @example
 * ```typescript
 * const obj: GitObject = getObject(sha)
 * if (isBlob(obj)) {
 *   // obj is now typed as BlobObject
 *   const content = new TextDecoder().decode(obj.data)
 * }
 * ```
 */
export function isBlob(obj: GitObject): obj is BlobObject {
  return obj.type === 'blob'
}

/**
 * Type guard to check if a GitObject is a TreeObject.
 *
 * @description
 * Narrows the type of a GitObject to TreeObject based on the type field.
 *
 * @param obj - The Git object to check
 * @returns True if the object is a tree, false otherwise
 *
 * @example
 * ```typescript
 * const obj: GitObject = getObject(sha)
 * if (isTree(obj)) {
 *   // obj is now typed as TreeObject
 *   for (const entry of obj.entries) {
 *     console.log(entry.name, entry.mode)
 *   }
 * }
 * ```
 */
export function isTree(obj: GitObject): obj is TreeObject {
  return obj.type === 'tree'
}

/**
 * Type guard to check if a GitObject is a CommitObject.
 *
 * @description
 * Narrows the type of a GitObject to CommitObject based on the type field.
 *
 * @param obj - The Git object to check
 * @returns True if the object is a commit, false otherwise
 *
 * @example
 * ```typescript
 * const obj: GitObject = getObject(sha)
 * if (isCommit(obj)) {
 *   // obj is now typed as CommitObject
 *   console.log(obj.message, obj.author.name)
 * }
 * ```
 */
export function isCommit(obj: GitObject): obj is CommitObject {
  return obj.type === 'commit'
}

/**
 * Type guard to check if a GitObject is a TagObject.
 *
 * @description
 * Narrows the type of a GitObject to TagObject based on the type field.
 *
 * @param obj - The Git object to check
 * @returns True if the object is a tag, false otherwise
 *
 * @example
 * ```typescript
 * const obj: GitObject = getObject(sha)
 * if (isTag(obj)) {
 *   // obj is now typed as TagObject
 *   console.log(obj.name, obj.message)
 * }
 * ```
 */
export function isTag(obj: GitObject): obj is TagObject {
  return obj.type === 'tag'
}

// ============================================================================
// Helper Functions (internal)
// ============================================================================

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/**
 * Convert a hexadecimal string to a Uint8Array.
 *
 * @param hex - Hexadecimal string (must have even length)
 * @returns Binary representation as Uint8Array
 * @internal
 */
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16)
  }
  return bytes
}

/**
 * Convert a Uint8Array to a lowercase hexadecimal string.
 *
 * @param bytes - Binary data to convert
 * @returns Lowercase hexadecimal string
 * @internal
 */
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Format an Author object as a Git author/committer/tagger line.
 *
 * @param prefix - Line prefix ('author', 'committer', or 'tagger')
 * @param author - Author information
 * @returns Formatted line string
 * @internal
 */
function formatAuthor(prefix: string, author: Author): string {
  return `${prefix} ${author.name} <${author.email}> ${author.timestamp} ${author.timezone}`
}

/**
 * Parse a Git author/committer/tagger line into an Author object.
 *
 * @param line - The full line including prefix
 * @returns Parsed Author object
 * @throws Error if the line format is invalid
 * @internal
 */
function parseAuthorLine(line: string): Author {
  // Format: "author Name <email> timestamp timezone"
  // or "committer Name <email> timestamp timezone"
  // or "tagger Name <email> timestamp timezone"
  const match = line.match(/^(?:author|committer|tagger) (.+) <(.+)> (\d+) ([+-]\d{4})$/)
  if (!match) {
    throw new Error(`Invalid author line: ${line}`)
  }
  return {
    name: match[1],
    email: match[2],
    timestamp: parseInt(match[3], 10),
    timezone: match[4]
  }
}

// ============================================================================
// Serialization Functions
// ============================================================================

/**
 * Serialize raw blob data into Git blob object format.
 *
 * @description
 * Creates a complete Git blob object with header: "blob {size}\0{content}"
 * This format is used for hashing and storage.
 *
 * @param data - Raw file content as binary data
 * @returns Complete blob object with Git header
 *
 * @example
 * ```typescript
 * const content = new TextEncoder().encode('Hello, World!')
 * const blob = serializeBlob(content)
 * // blob contains: "blob 13\0Hello, World!"
 *
 * // Hash it to get the SHA
 * const sha = await sha1(blob)
 * ```
 */
export function serializeBlob(data: Uint8Array): Uint8Array {
  // Git format: "blob <size>\0<content>"
  const header = encoder.encode(`blob ${data.length}\0`)
  const result = new Uint8Array(header.length + data.length)
  result.set(header)
  result.set(data, header.length)
  return result
}

/**
 * Serialize tree entries into Git tree object format.
 *
 * @description
 * Creates a complete Git tree object with header and sorted entries.
 * Each entry format: "{mode} {name}\0{20-byte-sha}"
 * Entries are sorted by name with directories treated as having trailing slashes.
 *
 * @param entries - Array of tree entries to serialize
 * @returns Complete tree object with Git header
 *
 * @example
 * ```typescript
 * const entries: TreeEntry[] = [
 *   { mode: '100644', name: 'file.txt', sha: 'abc...' },
 *   { mode: '040000', name: 'src', sha: 'def...' }
 * ]
 * const tree = serializeTree(entries)
 * const sha = await sha1(tree)
 * ```
 */
export function serializeTree(entries: TreeEntry[]): Uint8Array {
  // Git format: "tree <size>\0<entries>"
  // Each entry: "<mode> <name>\0<20-byte-sha>"

  // Sort entries by name (Git sorts directories as if they have trailing /)
  const sortedEntries = [...entries].sort((a, b) => {
    const aName = a.mode === '040000' ? a.name + '/' : a.name
    const bName = b.mode === '040000' ? b.name + '/' : b.name
    return aName.localeCompare(bName)
  })

  // Build entry content
  const entryParts: Uint8Array[] = []
  for (const entry of sortedEntries) {
    const modeName = encoder.encode(`${entry.mode} ${entry.name}\0`)
    const sha20 = hexToBytes(entry.sha)
    const entryData = new Uint8Array(modeName.length + 20)
    entryData.set(modeName)
    entryData.set(sha20, modeName.length)
    entryParts.push(entryData)
  }

  // Calculate total content length
  const contentLength = entryParts.reduce((sum, part) => sum + part.length, 0)
  const content = new Uint8Array(contentLength)
  let offset = 0
  for (const part of entryParts) {
    content.set(part, offset)
    offset += part.length
  }

  // Add header
  const header = encoder.encode(`tree ${contentLength}\0`)
  const result = new Uint8Array(header.length + contentLength)
  result.set(header)
  result.set(content, header.length)
  return result
}

/**
 * Serialize commit data into Git commit object format.
 *
 * @description
 * Creates a complete Git commit object with header and formatted content.
 * The content includes tree SHA, parent SHAs, author, committer, and message.
 *
 * @param commit - Commit data (without 'type' and 'data' fields)
 * @returns Complete commit object with Git header
 *
 * @example
 * ```typescript
 * const commit = serializeCommit({
 *   tree: 'abc123...',
 *   parents: ['parent1...'],
 *   author: { name: 'Alice', email: 'alice@example.com.ai', timestamp: 1704067200, timezone: '+0000' },
 *   committer: { name: 'Alice', email: 'alice@example.com.ai', timestamp: 1704067200, timezone: '+0000' },
 *   message: 'Initial commit'
 * })
 * const sha = await sha1(commit)
 * ```
 */
export function serializeCommit(commit: Omit<CommitObject, 'type' | 'data'>): Uint8Array {
  // Git format: "commit <size>\0<content>"
  // Content:
  // tree <sha>\n
  // parent <sha>\n (for each parent)
  // author <name> <email> <timestamp> <timezone>\n
  // committer <name> <email> <timestamp> <timezone>\n
  // \n
  // <message>

  const lines: string[] = []
  lines.push(`tree ${commit.tree}`)
  for (const parent of commit.parents) {
    lines.push(`parent ${parent}`)
  }
  lines.push(formatAuthor('author', commit.author))
  lines.push(formatAuthor('committer', commit.committer))
  lines.push('')
  lines.push(commit.message)

  const content = lines.join('\n')
  const header = `commit ${encoder.encode(content).length}\0`
  return encoder.encode(header + content)
}

/**
 * Serialize tag data into Git tag object format.
 *
 * @description
 * Creates a complete Git tag object with header and formatted content.
 * The content includes object SHA, object type, tag name, tagger (optional), and message.
 *
 * @param tag - Tag data (without 'type' and 'data' fields)
 * @returns Complete tag object with Git header
 *
 * @example
 * ```typescript
 * const tag = serializeTag({
 *   object: 'commitsha...',
 *   objectType: 'commit',
 *   name: 'v1.0.0',
 *   tagger: { name: 'Bob', email: 'bob@example.com.ai', timestamp: 1704067200, timezone: '+0000' },
 *   message: 'Release v1.0.0'
 * })
 * const sha = await sha1(tag)
 * ```
 */
export function serializeTag(tag: Omit<TagObject, 'type' | 'data'>): Uint8Array {
  // Git format: "tag <size>\0<content>"
  // Content:
  // object <sha>\n
  // type <objecttype>\n
  // tag <name>\n
  // tagger <name> <email> <timestamp> <timezone>\n
  // \n
  // <message>

  const lines: string[] = []
  lines.push(`object ${tag.object}`)
  lines.push(`type ${tag.objectType}`)
  lines.push(`tag ${tag.name}`)
  if (tag.tagger) {
    lines.push(formatAuthor('tagger', tag.tagger))
  }
  lines.push('')
  lines.push(tag.message)

  const content = lines.join('\n')
  const header = `tag ${encoder.encode(content).length}\0`
  return encoder.encode(header + content)
}

// ============================================================================
// Deserialization (Parsing) Functions
// ============================================================================

/**
 * Parse a Git blob object from its serialized format.
 *
 * @description
 * Parses a complete Git blob object (with header) back into a BlobObject.
 * Validates the header format and extracts the content.
 *
 * @param data - Complete blob object data including Git header
 * @returns Parsed BlobObject
 * @throws Error if the data is not a valid blob object (missing null byte or invalid header)
 *
 * @example
 * ```typescript
 * const rawBlob = await storage.getObject(sha)
 * const blob = parseBlob(rawBlob)
 * const content = new TextDecoder().decode(blob.data)
 * ```
 */
export function parseBlob(data: Uint8Array): BlobObject {
  // Git format: "blob <size>\0<content>"
  // Find the null byte to separate header from content
  const nullIndex = data.indexOf(0)
  if (nullIndex === -1) {
    throw new Error('Invalid blob: no null byte found')
  }

  const header = decoder.decode(data.slice(0, nullIndex))
  const match = header.match(/^blob (\d+)$/)
  if (!match) {
    throw new Error(`Invalid blob header: ${header}`)
  }

  const content = data.slice(nullIndex + 1)
  return {
    type: 'blob',
    data: content
  }
}

/**
 * Parse a Git tree object from its serialized format.
 *
 * @description
 * Parses a complete Git tree object (with header) back into a TreeObject.
 * Extracts all tree entries with their modes, names, and SHA references.
 *
 * @param data - Complete tree object data including Git header
 * @returns Parsed TreeObject with entries array
 * @throws Error if the data is not a valid tree object (missing null byte or invalid header)
 *
 * @example
 * ```typescript
 * const rawTree = await storage.getObject(sha)
 * const tree = parseTree(rawTree)
 * for (const entry of tree.entries) {
 *   console.log(`${entry.mode} ${entry.name} ${entry.sha}`)
 * }
 * ```
 */
export function parseTree(data: Uint8Array): TreeObject {
  // Git format: "tree <size>\0<entries>"
  // Each entry: "<mode> <name>\0<20-byte-sha>"

  const nullIndex = data.indexOf(0)
  if (nullIndex === -1) {
    throw new Error('Invalid tree: no null byte found')
  }

  const header = decoder.decode(data.slice(0, nullIndex))
  const match = header.match(/^tree (\d+)$/)
  if (!match) {
    throw new Error(`Invalid tree header: ${header}`)
  }

  const entries: TreeEntry[] = []
  let offset = nullIndex + 1

  while (offset < data.length) {
    // Find the null byte after mode+name
    let entryNullIndex = offset
    while (entryNullIndex < data.length && data[entryNullIndex] !== 0) {
      entryNullIndex++
    }

    const modeNameStr = decoder.decode(data.slice(offset, entryNullIndex))
    const spaceIndex = modeNameStr.indexOf(' ')
    const mode = modeNameStr.slice(0, spaceIndex)
    const name = modeNameStr.slice(spaceIndex + 1)

    // Read 20-byte SHA
    const sha20 = data.slice(entryNullIndex + 1, entryNullIndex + 21)
    const sha = bytesToHex(sha20)

    entries.push({ mode, name, sha })
    offset = entryNullIndex + 21
  }

  return {
    type: 'tree',
    data: data.slice(nullIndex + 1),
    entries
  }
}

/**
 * Parse a Git commit object from its serialized format.
 *
 * @description
 * Parses a complete Git commit object (with header) back into a CommitObject.
 * Extracts tree SHA, parent SHAs, author, committer, and message.
 *
 * @param data - Complete commit object data including Git header
 * @returns Parsed CommitObject
 * @throws Error if the data is not a valid commit object (missing null byte, invalid header, or missing author/committer)
 *
 * @example
 * ```typescript
 * const rawCommit = await storage.getObject(sha)
 * const commit = parseCommit(rawCommit)
 * console.log(`Author: ${commit.author.name}`)
 * console.log(`Message: ${commit.message}`)
 * console.log(`Parents: ${commit.parents.length}`)
 * ```
 */
export function parseCommit(data: Uint8Array): CommitObject {
  // Git format: "commit <size>\0<content>"
  const nullIndex = data.indexOf(0)
  if (nullIndex === -1) {
    throw new Error('Invalid commit: no null byte found')
  }

  const header = decoder.decode(data.slice(0, nullIndex))
  const match = header.match(/^commit (\d+)$/)
  if (!match) {
    throw new Error(`Invalid commit header: ${header}`)
  }

  const content = decoder.decode(data.slice(nullIndex + 1))
  const lines = content.split('\n')

  let tree = ''
  const parents: string[] = []
  let author: Author | null = null
  let committer: Author | null = null
  let messageStartIndex = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line === '') {
      // Empty line separates headers from message
      messageStartIndex = i + 1
      break
    }

    if (line.startsWith('tree ')) {
      tree = line.slice(5)
    } else if (line.startsWith('parent ')) {
      parents.push(line.slice(7))
    } else if (line.startsWith('author ')) {
      author = parseAuthorLine(line)
    } else if (line.startsWith('committer ')) {
      committer = parseAuthorLine(line)
    }
  }

  if (!author || !committer) {
    throw new Error('Invalid commit: missing author or committer')
  }

  const message = lines.slice(messageStartIndex).join('\n')

  return {
    type: 'commit',
    data: data.slice(nullIndex + 1),
    tree,
    parents,
    author,
    committer,
    message
  }
}

/**
 * Parse a Git tag object from its serialized format.
 *
 * @description
 * Parses a complete Git tag object (with header) back into a TagObject.
 * Extracts object SHA, object type, tag name, tagger, and message.
 *
 * @param data - Complete tag object data including Git header
 * @returns Parsed TagObject
 * @throws Error if the data is not a valid tag object (missing null byte, invalid header, or missing tagger)
 *
 * @example
 * ```typescript
 * const rawTag = await storage.getObject(sha)
 * const tag = parseTag(rawTag)
 * console.log(`Tag: ${tag.name}`)
 * console.log(`Points to: ${tag.object} (${tag.objectType})`)
 * console.log(`Message: ${tag.message}`)
 * ```
 */
export function parseTag(data: Uint8Array): TagObject {
  // Git format: "tag <size>\0<content>"
  const nullIndex = data.indexOf(0)
  if (nullIndex === -1) {
    throw new Error('Invalid tag: no null byte found')
  }

  const header = decoder.decode(data.slice(0, nullIndex))
  const match = header.match(/^tag (\d+)$/)
  if (!match) {
    throw new Error(`Invalid tag header: ${header}`)
  }

  const content = decoder.decode(data.slice(nullIndex + 1))
  const lines = content.split('\n')

  let object = ''
  let objectType: ObjectType = 'commit'
  let name = ''
  let tagger: Author | null = null
  let messageStartIndex = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line === '') {
      // Empty line separates headers from message
      messageStartIndex = i + 1
      break
    }

    if (line.startsWith('object ')) {
      object = line.slice(7)
    } else if (line.startsWith('type ')) {
      objectType = line.slice(5) as ObjectType
    } else if (line.startsWith('tag ')) {
      name = line.slice(4)
    } else if (line.startsWith('tagger ')) {
      tagger = parseAuthorLine(line)
    }
  }

  const message = lines.slice(messageStartIndex).join('\n')

  return {
    type: 'tag',
    data: data.slice(nullIndex + 1),
    object,
    objectType,
    name,
    tagger: tagger ?? undefined,
    message
  }
}
