/**
 * Git Commit Object
 *
 * Represents a Git commit object with tree reference, parents,
 * author/committer info, and commit message.
 *
 * Format:
 * tree <sha>
 * parent <sha> (zero or more)
 * author <name> <email> <timestamp> <timezone>
 * committer <name> <email> <timestamp> <timezone>
 * gpgsig -----BEGIN PGP SIGNATURE-----
 *  <signature lines>
 *  -----END PGP SIGNATURE-----
 *
 * <message>
 */

import { calculateObjectHash, createObjectHeader, parseObjectHeader } from './hash'
import { type GitIdentity, type CommitData, isValidSha } from './types'

// =============================================================================
// Text Encoding Utilities
// =============================================================================

const encoder = new TextEncoder()
const decoder = new TextDecoder()

// =============================================================================
// Identity Parsing Utilities
// =============================================================================

/**
 * Parses a Git identity line (author/committer/tagger)
 * Format: "prefix Name <email> timestamp timezone"
 */
export function parseIdentity(line: string): GitIdentity {
  // Format: author/committer/tagger Name <email> timestamp timezone
  // Example: "author John Doe <john@example.com.ai> 1704067200 +0530"

  // Find email boundaries
  const emailStart = line.indexOf('<')
  const emailEnd = line.indexOf('>')

  if (emailStart === -1 || emailEnd === -1) {
    throw new Error(`Invalid identity line: ${line}`)
  }

  // Skip prefix (author/committer/tagger)
  const prefixEnd = line.indexOf(' ')
  const name = line.slice(prefixEnd + 1, emailStart).trim()
  const email = line.slice(emailStart + 1, emailEnd)

  // Parse timestamp and timezone
  const afterEmail = line.slice(emailEnd + 1).trim()
  const parts = afterEmail.split(' ')

  if (parts.length < 2) {
    throw new Error(`Invalid identity line: missing timestamp/timezone: ${line}`)
  }

  const timestamp = parseInt(parts[0], 10)
  const timezone = parts[1]

  return { name, email, timestamp, timezone }
}

/**
 * Formats a Git identity for serialization
 * @param prefix - The line prefix (author, committer, tagger)
 * @param identity - The identity to format
 */
export function formatIdentity(prefix: string, identity: GitIdentity): string {
  return `${prefix} ${identity.name} <${identity.email}> ${identity.timestamp} ${identity.timezone}`
}

// =============================================================================
// GPG Signature Utilities
// =============================================================================

/**
 * Checks if a commit has a GPG signature
 */
export function hasGpgSignature(commit: GitCommit): boolean {
  return commit.gpgSignature !== undefined && commit.gpgSignature !== ''
}

/**
 * Parses GPG signature from a commit
 */
export function parseGpgSignature(commit: GitCommit): string | undefined {
  return commit.gpgSignature
}

// =============================================================================
// GitCommit Class
// =============================================================================

/**
 * Git commit object
 */
export class GitCommit {
  readonly type = 'commit' as const
  readonly tree: string
  readonly parents: readonly string[]
  readonly author: GitIdentity
  readonly committer: GitIdentity
  readonly message: string
  readonly gpgSignature?: string

  /**
   * Creates a new GitCommit
   * @throws Error if tree or any parent SHA is invalid
   */
  constructor(data: CommitData) {
    if (!isValidSha(data.tree)) {
      throw new Error(`Invalid tree SHA: ${data.tree}`)
    }

    const parents = data.parents ?? []
    for (const parent of parents) {
      if (!isValidSha(parent)) {
        throw new Error(`Invalid parent SHA: ${parent}`)
      }
    }

    this.tree = data.tree
    this.parents = parents
    this.author = data.author
    this.committer = data.committer
    this.message = data.message
    this.gpgSignature = data.gpgSignature
  }

  /**
   * Creates a GitCommit from raw commit content (without header)
   */
  static fromContent(content: string): GitCommit {
    return parseCommitContent(content)
  }

  /**
   * Parses a GitCommit from serialized Git object format
   * @param data - The serialized data including header
   * @throws Error if the header is invalid or type is not commit
   */
  static parse(data: Uint8Array): GitCommit {
    const { type, size, headerLength } = parseObjectHeader(data)

    if (type !== 'commit') {
      throw new Error(`Invalid commit header: expected 'commit', got '${type}'`)
    }

    const content = data.slice(headerLength)

    // Validate size matches actual content length
    if (content.length !== size) {
      throw new Error(`Size mismatch: header says ${size} bytes, but content is ${content.length} bytes`)
    }

    const contentStr = decoder.decode(content)
    return parseCommitContent(contentStr)
  }

  /**
   * Checks if this is an initial commit (no parents)
   */
  isInitialCommit(): boolean {
    return this.parents.length === 0
  }

  /**
   * Checks if this is a merge commit (2+ parents)
   */
  isMergeCommit(): boolean {
    return this.parents.length >= 2
  }

  /**
   * Checks if this commit has a GPG signature
   */
  hasSignature(): boolean {
    return hasGpgSignature(this)
  }

  /**
   * Gets the subject line (first line) of the commit message
   */
  getSubject(): string {
    const newlineIdx = this.message.indexOf('\n')
    if (newlineIdx === -1) {
      return this.message
    }
    return this.message.slice(0, newlineIdx)
  }

  /**
   * Gets the body of the commit message (after subject and blank line)
   */
  getBody(): string {
    const newlineIdx = this.message.indexOf('\n\n')
    if (newlineIdx === -1) {
      return ''
    }
    return this.message.slice(newlineIdx + 2)
  }

  /**
   * Serializes the commit to Git object format
   */
  serialize(): Uint8Array {
    const content = this.serializeContent()
    const contentBytes = encoder.encode(content)
    const header = createObjectHeader('commit', contentBytes.length)
    const result = new Uint8Array(header.length + contentBytes.length)
    result.set(header)
    result.set(contentBytes, header.length)
    return result
  }

  /**
   * Serializes just the commit content (without header)
   */
  private serializeContent(): string {
    const lines: string[] = []

    // Tree line
    lines.push(`tree ${this.tree}`)

    // Parent lines
    for (const parent of this.parents) {
      lines.push(`parent ${parent}`)
    }

    // Author line
    lines.push(formatIdentity('author', this.author))

    // Committer line
    lines.push(formatIdentity('committer', this.committer))

    // GPG signature (if present)
    if (this.gpgSignature) {
      lines.push(`gpgsig ${this.gpgSignature}`)
    }

    // Blank line before message
    lines.push('')

    // Message
    lines.push(this.message)

    return lines.join('\n')
  }

  /**
   * Calculates the SHA-1 hash of this commit object
   * @returns Promise resolving to 40-character hex string
   */
  async hash(): Promise<string> {
    const content = this.serializeContent()
    const contentBytes = encoder.encode(content)
    return calculateObjectHash('commit', contentBytes)
  }
}

// =============================================================================
// Commit Content Parser
// =============================================================================

function parseCommitContent(content: string): GitCommit {
  const lines = content.split('\n')
  let tree: string | undefined
  const parents: string[] = []
  let author: GitIdentity | undefined
  let committer: GitIdentity | undefined
  let gpgSignature: string | undefined
  let messageStartIdx = -1

  let i = 0
  while (i < lines.length) {
    const line = lines[i]

    // Empty line marks start of message
    if (line === '') {
      messageStartIdx = i + 1
      break
    }

    if (line.startsWith('tree ')) {
      tree = line.slice(5)
    } else if (line.startsWith('parent ')) {
      parents.push(line.slice(7))
    } else if (line.startsWith('author ')) {
      author = parseIdentity(line)
    } else if (line.startsWith('committer ')) {
      committer = parseIdentity(line)
    } else if (line.startsWith('gpgsig ')) {
      // GPG signature spans multiple lines until -----END PGP SIGNATURE-----
      const sigLines: string[] = [line.slice(7)]
      i++
      while (i < lines.length && !lines[i].includes('-----END PGP SIGNATURE-----')) {
        // Lines in signature may start with space
        sigLines.push(lines[i].startsWith(' ') ? lines[i].slice(1) : lines[i])
        i++
      }
      if (i < lines.length) {
        sigLines.push(lines[i].startsWith(' ') ? lines[i].slice(1) : lines[i])
      }
      gpgSignature = sigLines.join('\n')
    }

    i++
  }

  // Validate required fields
  if (!tree) {
    throw new Error('Invalid commit: missing tree')
  }
  if (!author) {
    throw new Error('Invalid commit: missing author')
  }
  if (!committer) {
    throw new Error('Invalid commit: missing committer')
  }

  // Extract message
  const message = messageStartIdx >= 0 ? lines.slice(messageStartIdx).join('\n') : ''

  return new GitCommit({
    tree,
    parents: parents.length > 0 ? parents : undefined,
    author,
    committer,
    message,
    gpgSignature,
  })
}

// Re-export GitIdentity type
export type { GitIdentity }
