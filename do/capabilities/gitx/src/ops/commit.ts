/**
 * @fileoverview Commit Creation Operations
 *
 * Provides functionality for creating, formatting, and amending git commits.
 * Supports author/committer info, parent handling, GPG signing, and message formatting.
 *
 * ## Features
 *
 * - Create new commits with full metadata
 * - Amend existing commits
 * - GPG signature support
 * - Message formatting and validation
 * - Empty commit detection
 * - Author/committer timestamp handling
 *
 * ## Usage Example
 *
 * ```typescript
 * import { createCommit, formatCommitMessage } from './ops/commit'
 *
 * // Create a commit
 * const result = await createCommit(store, {
 *   message: 'Add new feature',
 *   tree: treeHash,
 *   parents: [parentHash],
 *   author: { name: 'John Doe', email: 'john@example.com.ai' }
 * })
 *
 * console.log('Created commit:', result.sha)
 * ```
 *
 * @module ops/commit
 */

import { Author, CommitObject } from '../types/objects'
import type { BasicObjectStore as ObjectStore } from '../types/storage'

// ============================================================================
// Types
// ============================================================================

/**
 * Author/Committer information for creating commits.
 *
 * Represents the identity and timestamp for a commit author or committer.
 * Timestamp and timezone are optional and will be auto-filled if not provided.
 *
 * @interface CommitAuthor
 *
 * @example
 * ```typescript
 * const author: CommitAuthor = {
 *   name: 'Jane Developer',
 *   email: 'jane@example.com.ai',
 *   timestamp: Math.floor(Date.now() / 1000),
 *   timezone: '-0800'
 * }
 * ```
 */
export interface CommitAuthor {
  /** Author's display name */
  name: string

  /** Author's email address */
  email: string

  /**
   * Unix timestamp in seconds.
   * If not provided, current time will be used.
   */
  timestamp?: number

  /**
   * Timezone offset string (e.g., '+0000', '-0500', '+0530').
   * If not provided, local timezone will be used.
   */
  timezone?: string
}

/**
 * Options for GPG signing commits.
 *
 * @interface SigningOptions
 */
export interface SigningOptions {
  /**
   * Whether to sign the commit.
   * Must be true for signing to occur.
   */
  sign: boolean

  /**
   * GPG key ID to use for signing.
   * If not specified, the default key will be used.
   */
  keyId?: string

  /**
   * Callback function that performs the actual signing.
   * Receives the commit data and should return the signature string.
   *
   * @param data - The commit data to sign
   * @returns Promise resolving to the signature string
   */
  signer?: (data: Uint8Array) => Promise<string>
}

/**
 * Options for creating a new commit.
 *
 * @interface CommitOptions
 *
 * @example
 * ```typescript
 * const options: CommitOptions = {
 *   message: 'Fix critical bug\n\nThis fixes issue #123',
 *   tree: 'abc123...', // 40-char SHA
 *   parents: ['def456...'],
 *   author: {
 *     name: 'Developer',
 *     email: 'dev@example.com.ai'
 *   },
 *   allowEmpty: false
 * }
 * ```
 */
export interface CommitOptions {
  /**
   * The commit message (required).
   * Should follow Git conventions: short subject, blank line, body.
   */
  message: string

  /**
   * Tree SHA for the commit (required).
   * This is the root tree object representing the repository state.
   */
  tree: string

  /**
   * Parent commit SHA(s).
   * - Empty array for initial commit
   * - Single SHA for normal commit
   * - Multiple SHAs for merge commit
   */
  parents?: string[]

  /**
   * Author information (required).
   * The person who originally wrote the code.
   */
  author?: CommitAuthor

  /**
   * Committer information.
   * The person who created the commit. Defaults to author if not specified.
   */
  committer?: CommitAuthor

  /** GPG signing options */
  signing?: SigningOptions

  /**
   * Allow creating empty commits (no changes from parent).
   * @default true
   */
  allowEmpty?: boolean

  /**
   * Whether this is an amend of a previous commit.
   * @internal
   */
  amend?: boolean
}

/**
 * Options for amending an existing commit.
 *
 * All fields are optional - only specified fields will be changed.
 *
 * @interface AmendOptions
 *
 * @example
 * ```typescript
 * // Change just the message
 * await amendCommit(store, commitSha, {
 *   message: 'Better commit message'
 * })
 *
 * // Change author and reset date
 * await amendCommit(store, commitSha, {
 *   author: { name: 'New Author', email: 'new@example.com.ai' },
 *   resetAuthorDate: true
 * })
 * ```
 */
export interface AmendOptions {
  /**
   * New commit message.
   * If not provided, keeps the original message.
   */
  message?: string

  /**
   * New tree SHA.
   * If not provided, keeps the original tree.
   */
  tree?: string

  /**
   * New author information.
   * If not provided, keeps the original author.
   */
  author?: CommitAuthor

  /**
   * New committer information.
   * Defaults to current user with current time if not provided.
   */
  committer?: CommitAuthor

  /**
   * Whether to reset the author timestamp to current time.
   * Only applies if author is not explicitly provided.
   */
  resetAuthorDate?: boolean

  /** GPG signing options */
  signing?: SigningOptions
}

/**
 * Options for formatting commit messages.
 *
 * @interface FormatOptions
 */
export interface FormatOptions {
  /**
   * Strip leading/trailing whitespace from lines.
   * @default true (for most cleanup modes)
   */
  stripWhitespace?: boolean

  /**
   * Strip comment lines (starting with comment character).
   * @default true (for 'strip' mode)
   */
  stripComments?: boolean

  /**
   * Character that starts comment lines.
   * @default '#'
   */
  commentChar?: string

  /**
   * Wrap message body at this column width.
   * Set to 0 to disable wrapping.
   * @default 0
   */
  wrapColumn?: number

  /**
   * Message cleanup mode:
   * - 'verbatim': Keep message exactly as-is
   * - 'whitespace': Collapse whitespace, strip trailing lines
   * - 'strip': Also remove comment lines
   * - 'scissors': Remove everything after scissors line
   * - 'default': Same as 'strip' but preserves initial blank lines
   * @default 'default'
   */
  cleanup?: 'verbatim' | 'whitespace' | 'strip' | 'scissors' | 'default'
}

/**
 * Result of creating a commit.
 *
 * @interface CommitResult
 */
export interface CommitResult {
  /** SHA of the created commit */
  sha: string

  /** The commit object */
  commit: CommitObject

  /**
   * Whether the commit was actually created.
   * Will be false if empty and allowEmpty=false.
   */
  created: boolean
}

/**
 * ObjectStore interface for commit operations.
 * Re-exported from storage types for convenience.
 */
export type { ObjectStore }

/**
 * Internal type for signed commit with gpgsig field.
 * @internal
 */
interface SignedCommitObject extends CommitObject {
  gpgsig?: string
}

// ============================================================================
// Author/Timestamp Utilities
// ============================================================================

/**
 * Gets the current timezone offset string.
 *
 * Returns the local timezone in Git's format (e.g., '+0000', '-0500').
 *
 * @returns Timezone offset string
 *
 * @example
 * ```typescript
 * const tz = getCurrentTimezone()
 * // Returns something like '-0800' for Pacific time
 * ```
 */
export function getCurrentTimezone(): string {
  const offset = new Date().getTimezoneOffset()
  const sign = offset <= 0 ? '+' : '-'
  const absOffset = Math.abs(offset)
  const hours = Math.floor(absOffset / 60)
  const minutes = absOffset % 60
  return `${sign}${String(hours).padStart(2, '0')}${String(minutes).padStart(2, '0')}`
}

/**
 * Formats a timestamp and timezone as git author/committer format.
 *
 * @param timestamp - Unix timestamp in seconds
 * @param timezone - Timezone offset string (e.g., '+0000', '-0500')
 * @returns Formatted string like "1234567890 +0000"
 *
 * @example
 * ```typescript
 * const formatted = formatTimestamp(1609459200, '+0000')
 * // Returns "1609459200 +0000"
 * ```
 */
export function formatTimestamp(timestamp: number, timezone: string): string {
  return `${timestamp} ${timezone}`
}

/**
 * Parses a git timestamp string.
 *
 * @param timestampStr - Timestamp string like "1234567890 +0000"
 * @returns Object with parsed timestamp and timezone
 *
 * @throws {Error} If the format is invalid
 *
 * @example
 * ```typescript
 * const { timestamp, timezone } = parseTimestamp("1609459200 -0500")
 * // timestamp = 1609459200, timezone = "-0500"
 * ```
 */
export function parseTimestamp(timestampStr: string): {
  timestamp: number
  timezone: string
} {
  const match = timestampStr.match(/^(\d+) ([+-]\d{4})$/)
  if (!match) {
    throw new Error(`Invalid timestamp format: ${timestampStr}`)
  }
  return {
    timestamp: parseInt(match[1], 10),
    timezone: match[2]
  }
}

/**
 * Creates an Author object with current timestamp.
 *
 * Convenience function for creating author information with
 * the current time and local timezone.
 *
 * @param name - Author name
 * @param email - Author email
 * @param timezone - Optional timezone (defaults to local timezone)
 * @returns Author object with current timestamp
 *
 * @example
 * ```typescript
 * const author = createAuthor('John Doe', 'john@example.com.ai')
 * // { name: 'John Doe', email: 'john@example.com.ai', timestamp: <now>, timezone: <local> }
 * ```
 */
export function createAuthor(
  name: string,
  email: string,
  timezone?: string
): Author {
  return {
    name,
    email,
    timestamp: Math.floor(Date.now() / 1000),
    timezone: timezone ?? getCurrentTimezone()
  }
}

// ============================================================================
// Message Formatting
// ============================================================================

/**
 * Wraps text at a specified column width.
 * @internal
 */
function wrapText(text: string, column: number): string {
  if (column <= 0) return text

  const words = text.split(/\s+/)
  const lines: string[] = []
  let currentLine = ''

  for (const word of words) {
    if (currentLine.length === 0) {
      currentLine = word
    } else if (currentLine.length + 1 + word.length <= column) {
      currentLine += ' ' + word
    } else {
      lines.push(currentLine)
      currentLine = word
    }
  }

  if (currentLine.length > 0) {
    lines.push(currentLine)
  }

  return lines.join('\n')
}

/**
 * Formats a commit message according to git conventions.
 *
 * Applies various transformations based on the cleanup mode:
 * - Strips comments
 * - Normalizes whitespace
 * - Wraps long lines
 * - Removes scissors markers
 *
 * @param message - The raw commit message
 * @param options - Formatting options
 * @returns The formatted commit message
 *
 * @example
 * ```typescript
 * // Clean up a message
 * const formatted = formatCommitMessage(`
 *   Add feature
 *
 *   # This is a comment
 *   Long description here
 * `, { cleanup: 'strip' })
 * // Returns: "Add feature\n\nLong description here"
 * ```
 */
export function formatCommitMessage(
  message: string,
  options: FormatOptions = {}
): string {
  const { cleanup = 'default', commentChar = '#', wrapColumn = 0 } = options

  // Verbatim mode: return message as-is
  if (cleanup === 'verbatim') {
    return message
  }

  let result = message

  // Scissors mode: remove everything after scissors line
  if (cleanup === 'scissors') {
    const scissorsPattern = new RegExp(`^${commentChar} -+ >8 -+`, 'm')
    const scissorsMatch = result.match(scissorsPattern)
    if (scissorsMatch && scissorsMatch.index !== undefined) {
      result = result.slice(0, scissorsMatch.index)
    }
  }

  // Strip comments if cleanup is 'strip' or 'scissors'
  if (cleanup === 'strip' || cleanup === 'scissors') {
    const lines = result.split('\n')
    result = lines.filter(line => !line.startsWith(commentChar)).join('\n')
  }

  // Strip whitespace (for 'whitespace', 'strip', 'scissors', 'default')
  // Note: verbatim check already handled above, so this always runs
  if (true) {
    // Strip leading/trailing whitespace from each line
    const lines = result.split('\n')
    const trimmedLines = lines.map(line => line.trim())

    // Collapse multiple blank lines into one
    const collapsedLines: string[] = []
    let lastWasBlank = false
    for (const line of trimmedLines) {
      if (line === '') {
        if (!lastWasBlank) {
          collapsedLines.push(line)
        }
        lastWasBlank = true
      } else {
        collapsedLines.push(line)
        lastWasBlank = false
      }
    }

    result = collapsedLines.join('\n')

    // Trim leading/trailing blank lines
    result = result.replace(/^\n+/, '').replace(/\n+$/, '')
  }

  // Wrap body (not subject) if wrapColumn is specified
  if (wrapColumn > 0 && result.length > 0) {
    const lines = result.split('\n')
    if (lines.length > 0) {
      const subject = lines[0]
      const rest = lines.slice(1)

      // Find where body starts (after blank line)
      let bodyStartIndex = 0
      for (let i = 0; i < rest.length; i++) {
        if (rest[i] === '') {
          bodyStartIndex = i + 1
          break
        }
      }

      // Wrap body lines
      const wrappedRest: string[] = []
      for (let i = 0; i < rest.length; i++) {
        if (i >= bodyStartIndex && rest[i] !== '') {
          wrappedRest.push(wrapText(rest[i], wrapColumn))
        } else {
          wrappedRest.push(rest[i])
        }
      }

      result = [subject, ...wrappedRest].join('\n')
    }
  }

  return result
}

/**
 * Parses a commit message into subject and body.
 *
 * The subject is the first line. The body starts after the first
 * blank line following the subject.
 *
 * @param message - The commit message
 * @returns Object with subject (first line) and body (rest)
 *
 * @example
 * ```typescript
 * const { subject, body } = parseCommitMessage(
 *   'Add feature\n\nThis adds the new feature'
 * )
 * // subject = 'Add feature'
 * // body = 'This adds the new feature'
 * ```
 */
export function parseCommitMessage(message: string): {
  subject: string
  body: string
} {
  if (!message) {
    return { subject: '', body: '' }
  }

  const lines = message.split('\n')
  const subject = lines[0] || ''

  // Find the body - it starts after the first blank line (or second line if no blank)
  let bodyStartIndex = 1
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '') {
      bodyStartIndex = i + 1
      break
    }
  }

  const body = lines.slice(bodyStartIndex).join('\n')

  return { subject, body }
}

/**
 * Validates a commit message format.
 *
 * Checks for common issues and provides warnings for style violations.
 * Returns errors for critical issues that would prevent commit creation.
 *
 * @param message - The commit message to validate
 * @returns Object with valid flag and any error/warning messages
 *
 * @example
 * ```typescript
 * const result = validateCommitMessage('Fix bug.')
 * // {
 * //   valid: true,
 * //   errors: [],
 * //   warnings: ['Subject line should not end with a period']
 * // }
 * ```
 */
export function validateCommitMessage(message: string): {
  valid: boolean
  errors: string[]
  warnings: string[]
} {
  const errors: string[] = []
  const warnings: string[] = []

  if (!message || message.trim() === '') {
    errors.push('Commit message is empty')
    return { valid: false, errors, warnings }
  }

  const { subject, body: _body } = parseCommitMessage(message)

  // Check subject line length (72 chars is conventional max)
  if (subject.length > 72) {
    warnings.push('Subject line exceeds 72 characters')
  }

  // Check if subject ends with a period
  if (subject.endsWith('.')) {
    warnings.push('Subject line should not end with a period')
  }

  // Check for missing blank line between subject and body
  const lines = message.split('\n')
  if (lines.length > 1 && lines[1] !== '') {
    warnings.push('Missing blank line between subject and body')
  }

  return { valid: errors.length === 0, errors, warnings }
}

// ============================================================================
// GPG Signing
// ============================================================================

/**
 * Checks if a commit is signed.
 *
 * @param commit - The commit object
 * @returns true if the commit has a GPG signature
 *
 * @example
 * ```typescript
 * if (isCommitSigned(commit)) {
 *   const sig = extractCommitSignature(commit)
 *   // Verify signature...
 * }
 * ```
 */
export function isCommitSigned(commit: CommitObject): boolean {
  const signedCommit = commit as SignedCommitObject
  return signedCommit.gpgsig !== undefined && signedCommit.gpgsig !== null
}

/**
 * Extracts the GPG signature from a signed commit.
 *
 * @param commit - The commit object
 * @returns The signature string if present, null otherwise
 */
export function extractCommitSignature(commit: CommitObject): string | null {
  const signedCommit = commit as SignedCommitObject
  return signedCommit.gpgsig ?? null
}

/**
 * Adds a GPG signature to a commit.
 *
 * Creates a new commit object with the signature attached.
 * Does not modify the original commit object.
 *
 * @param commit - The unsigned commit object
 * @param signature - The GPG signature string
 * @returns The signed commit object
 */
export function addSignatureToCommit(
  commit: CommitObject,
  signature: string
): CommitObject {
  const signedCommit: SignedCommitObject = {
    ...commit,
    gpgsig: signature
  }
  return signedCommit
}

// ============================================================================
// Empty Commit Detection
// ============================================================================

/**
 * Extracts tree SHA from raw commit data.
 * @internal
 */
function extractTreeFromCommitData(data: Uint8Array): string | null {
  const decoder = new TextDecoder()
  const content = decoder.decode(data)
  const match = content.match(/tree ([0-9a-f]{40})/)
  return match ? match[1] : null
}

/**
 * Checks if a commit would be empty (same tree as parent).
 *
 * A commit is considered empty if its tree SHA is identical to
 * its parent's tree SHA, meaning no files were changed.
 *
 * @param store - The object store for reading objects
 * @param tree - The tree SHA for the new commit
 * @param parent - The parent commit SHA (or null for initial commit)
 * @returns true if the commit would have no changes
 *
 * @example
 * ```typescript
 * const isEmpty = await isEmptyCommit(store, newTreeSha, parentSha)
 * if (isEmpty && !options.allowEmpty) {
 *   throw new Error('Nothing to commit')
 * }
 * ```
 */
export async function isEmptyCommit(
  store: ObjectStore,
  tree: string,
  parent: string | null
): Promise<boolean> {
  // Initial commits are never "empty"
  if (parent === null) {
    return false
  }

  const parentObj = await store.getObject(parent)
  if (!parentObj) {
    return false
  }

  // Extract tree from parent commit
  const parentTree = extractTreeFromCommitData(parentObj.data)

  return parentTree === tree
}

// ============================================================================
// Validation Helpers
// ============================================================================

const SHA_REGEX = /^[0-9a-f]{40}$/

/**
 * Validates a SHA format.
 * @internal
 */
function isValidSha(sha: string): boolean {
  return SHA_REGEX.test(sha)
}

/**
 * Validates an email format.
 * @internal
 */
function isValidEmail(email: string): boolean {
  // Basic email validation - must contain @ and have something before and after
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

/**
 * Validates an author name.
 * @internal
 */
function validateAuthorName(name: string): void {
  if (name.includes('<') || name.includes('>')) {
    throw new Error('Author name cannot contain angle brackets')
  }
  if (name.includes('\n')) {
    throw new Error('Author name cannot contain newlines')
  }
}

/**
 * Validates commit options.
 * @internal
 */
function validateCommitOptions(options: CommitOptions): void {
  // Validate tree
  if (!options.tree) {
    throw new Error('Tree SHA is required')
  }
  if (!isValidSha(options.tree)) {
    throw new Error('Invalid tree SHA format')
  }

  // Validate author
  if (!options.author) {
    throw new Error('Author is required')
  }
  validateAuthorName(options.author.name)
  if (!isValidEmail(options.author.email)) {
    throw new Error('Invalid author email format')
  }

  // Validate committer if provided
  if (options.committer) {
    validateAuthorName(options.committer.name)
    if (!isValidEmail(options.committer.email)) {
      throw new Error('Invalid committer email format')
    }
  }

  // Validate message
  if (!options.message || options.message.trim() === '') {
    throw new Error('Commit message is required')
  }

  // Validate parents
  if (options.parents) {
    for (const parent of options.parents) {
      if (!isValidSha(parent)) {
        throw new Error('Invalid parent SHA format')
      }
    }
  }

  // Validate timestamp if provided
  if (options.author.timestamp !== undefined && options.author.timestamp < 0) {
    throw new Error('Timestamp cannot be negative')
  }
  if (options.committer?.timestamp !== undefined && options.committer.timestamp < 0) {
    throw new Error('Timestamp cannot be negative')
  }
}

// ============================================================================
// Commit Creation
// ============================================================================

/**
 * Resolves a CommitAuthor to a full Author with timestamp and timezone.
 * @internal
 */
function resolveAuthor(commitAuthor: CommitAuthor): Author {
  return {
    name: commitAuthor.name,
    email: commitAuthor.email,
    timestamp: commitAuthor.timestamp ?? Math.floor(Date.now() / 1000),
    timezone: commitAuthor.timezone ?? getCurrentTimezone()
  }
}

/**
 * Serializes commit content to bytes (without the header).
 * @internal
 */
function serializeCommitContent(commit: {
  tree: string
  parents: string[]
  author: Author
  committer: Author
  message: string
  gpgsig?: string
}): Uint8Array {
  const encoder = new TextEncoder()
  const lines: string[] = []

  lines.push(`tree ${commit.tree}`)
  for (const parent of commit.parents) {
    lines.push(`parent ${parent}`)
  }
  lines.push(`author ${commit.author.name} <${commit.author.email}> ${commit.author.timestamp} ${commit.author.timezone}`)
  lines.push(`committer ${commit.committer.name} <${commit.committer.email}> ${commit.committer.timestamp} ${commit.committer.timezone}`)

  // Add gpgsig if present
  if (commit.gpgsig) {
    const sigLines = commit.gpgsig.split('\n')
    lines.push(`gpgsig ${sigLines[0]}`)
    for (let i = 1; i < sigLines.length; i++) {
      lines.push(` ${sigLines[i]}`)
    }
  }

  lines.push('')
  lines.push(commit.message)

  return encoder.encode(lines.join('\n'))
}

/**
 * Builds a commit object from options without storing it.
 *
 * Useful for creating commit objects for inspection or testing
 * without actually persisting them to the object store.
 *
 * @param options - Commit creation options
 * @returns The commit object (not stored)
 *
 * @example
 * ```typescript
 * const commit = buildCommitObject({
 *   message: 'Test commit',
 *   tree: treeSha,
 *   parents: [parentSha],
 *   author: { name: 'Test', email: 'test@example.com.ai' }
 * })
 *
 * console.log(commit.message) // 'Test commit'
 * ```
 */
export function buildCommitObject(options: CommitOptions): CommitObject {
  const author = resolveAuthor(options.author!)
  const committer = options.committer ? resolveAuthor(options.committer) : author
  const parents = options.parents ?? []

  const commit: CommitObject = {
    type: 'commit',
    data: new Uint8Array(),
    tree: options.tree,
    parents,
    author,
    committer,
    message: options.message
  }

  // Set the data field
  commit.data = serializeCommitContent({
    tree: commit.tree,
    parents: commit.parents,
    author: commit.author,
    committer: commit.committer,
    message: commit.message
  })

  return commit
}

/**
 * Creates a new commit.
 *
 * Creates a commit object with the specified options and stores it
 * in the object store. Handles validation, empty commit detection,
 * and optional GPG signing.
 *
 * @param store - The object store for reading/writing objects
 * @param options - Commit creation options
 * @returns The created commit result with SHA and commit object
 *
 * @throws {Error} If tree SHA is missing or invalid
 * @throws {Error} If author is missing or invalid
 * @throws {Error} If commit message is empty
 * @throws {Error} If commit would be empty and allowEmpty is false
 *
 * @example
 * ```typescript
 * // Basic commit
 * const result = await createCommit(store, {
 *   message: 'Add new feature',
 *   tree: treeSha,
 *   parents: [headSha],
 *   author: { name: 'John', email: 'john@example.com.ai' }
 * })
 *
 * // Signed commit
 * const signedResult = await createCommit(store, {
 *   message: 'Signed commit',
 *   tree: treeSha,
 *   parents: [headSha],
 *   author: { name: 'John', email: 'john@example.com.ai' },
 *   signing: {
 *     sign: true,
 *     signer: async (data) => myGpgSign(data)
 *   }
 * })
 *
 * // Initial commit (no parents)
 * const initialResult = await createCommit(store, {
 *   message: 'Initial commit',
 *   tree: treeSha,
 *   parents: [],
 *   author: { name: 'John', email: 'john@example.com.ai' }
 * })
 * ```
 */
export async function createCommit(
  store: ObjectStore,
  options: CommitOptions
): Promise<CommitResult> {
  // Validate options
  validateCommitOptions(options)

  const parents = options.parents ?? []

  // Check for empty commit
  if (options.allowEmpty === false && parents.length > 0) {
    const isEmpty = await isEmptyCommit(store, options.tree, parents[0])
    if (isEmpty) {
      throw new Error('Nothing to commit (empty commit not allowed)')
    }
  }

  // Build the commit object
  let commit = buildCommitObject(options)

  // Sign if requested
  if (options.signing?.sign && options.signing.signer) {
    const commitData = serializeCommitContent({
      tree: commit.tree,
      parents: commit.parents,
      author: commit.author,
      committer: commit.committer,
      message: commit.message
    })

    const signature = await options.signing.signer(commitData)
    commit = addSignatureToCommit(commit, signature) as CommitObject

    // Update commit data with signature
    const signedCommit = commit as SignedCommitObject
    commit.data = serializeCommitContent({
      tree: commit.tree,
      parents: commit.parents,
      author: commit.author,
      committer: commit.committer,
      message: commit.message,
      gpgsig: signedCommit.gpgsig
    })
  }

  // Store the commit
  const sha = await store.storeObject('commit', commit.data)

  return {
    sha,
    commit,
    created: true
  }
}

// ============================================================================
// Commit Amendment
// ============================================================================

/**
 * Parses a stored commit object from raw data.
 * Supports both git text format and JSON format (for testing).
 * @internal
 */
function parseStoredCommit(data: Uint8Array): {
  tree: string
  parents: string[]
  author: Author
  committer: Author
  message: string
} {
  const decoder = new TextDecoder()
  const content = decoder.decode(data)

  // Try to parse as JSON first (for test compatibility)
  if (content.startsWith('{')) {
    try {
      const parsed = JSON.parse(content)
      return {
        tree: parsed.tree,
        parents: parsed.parents || [],
        author: parsed.author,
        committer: parsed.committer || parsed.author,
        message: parsed.message
      }
    } catch {
      // Not JSON, fall through to git format parsing
    }
  }

  // Parse git text format
  const lines = content.split('\n')

  let tree = ''
  const parents: string[] = []
  let author: Author | null = null
  let committer: Author | null = null
  let messageStartIndex = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line === '') {
      messageStartIndex = i + 1
      break
    }

    if (line.startsWith('tree ')) {
      tree = line.slice(5)
    } else if (line.startsWith('parent ')) {
      parents.push(line.slice(7))
    } else if (line.startsWith('author ')) {
      const match = line.match(/^author (.+) <(.+)> (\d+) ([+-]\d{4})$/)
      if (match) {
        author = {
          name: match[1],
          email: match[2],
          timestamp: parseInt(match[3], 10),
          timezone: match[4]
        }
      }
    } else if (line.startsWith('committer ')) {
      const match = line.match(/^committer (.+) <(.+)> (\d+) ([+-]\d{4})$/)
      if (match) {
        committer = {
          name: match[1],
          email: match[2],
          timestamp: parseInt(match[3], 10),
          timezone: match[4]
        }
      }
    }
  }

  const message = lines.slice(messageStartIndex).join('\n')

  if (!author) {
    author = { name: 'Unknown', email: 'unknown@example.com.ai', timestamp: 0, timezone: '+0000' }
  }
  if (!committer) {
    committer = author
  }

  return { tree, parents, author, committer, message }
}

/**
 * Amends an existing commit.
 *
 * Creates a new commit that replaces the specified commit.
 * The original commit is not modified. Only specified fields
 * in options will be changed from the original.
 *
 * Note: This does not update any refs. The caller is responsible
 * for updating HEAD or branch refs to point to the new commit.
 *
 * @param store - The object store for reading/writing objects
 * @param commitSha - SHA of the commit to amend
 * @param options - Amendment options (only specified fields are changed)
 * @returns The new commit result (original commit is not modified)
 *
 * @throws {Error} If the commit doesn't exist
 *
 * @example
 * ```typescript
 * // Change just the message
 * const newCommit = await amendCommit(store, headSha, {
 *   message: 'Better commit message'
 * })
 *
 * // Update tree and committer
 * const newCommit = await amendCommit(store, headSha, {
 *   tree: newTreeSha,
 *   committer: { name: 'New Name', email: 'new@example.com.ai' }
 * })
 * ```
 */
export async function amendCommit(
  store: ObjectStore,
  commitSha: string,
  options: AmendOptions
): Promise<CommitResult> {
  // Get the original commit
  const originalObj = await store.getObject(commitSha)
  if (!originalObj) {
    throw new Error(`Commit not found: ${commitSha}`)
  }

  // Parse the original commit
  const original = parseStoredCommit(originalObj.data)

  // Build new author
  let newAuthor = original.author
  if (options.author) {
    newAuthor = resolveAuthor(options.author)
  } else if (options.resetAuthorDate) {
    newAuthor = {
      ...original.author,
      timestamp: Math.floor(Date.now() / 1000)
    }
  }

  // Build new committer (defaults to current time)
  let newCommitter: Author
  if (options.committer) {
    newCommitter = resolveAuthor(options.committer)
  } else {
    newCommitter = {
      ...original.committer,
      timestamp: Math.floor(Date.now() / 1000),
      timezone: getCurrentTimezone()
    }
  }

  // Build new commit
  const newCommitOptions: CommitOptions = {
    message: options.message ?? original.message,
    tree: options.tree ?? original.tree,
    parents: original.parents,
    author: newAuthor,
    committer: newCommitter,
    signing: options.signing,
    allowEmpty: true
  }

  return createCommit(store, newCommitOptions)
}
