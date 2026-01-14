/**
 * Git Tag Object
 *
 * Represents a Git annotated tag object.
 *
 * Format:
 * object <sha>
 * type <object-type>
 * tag <name>
 * tagger <name> <email> <timestamp> <timezone> (optional)
 *
 * <message>
 */

import { calculateObjectHash, createObjectHeader, parseObjectHeader } from './hash'
import { type GitIdentity, type ObjectType, type TagData, isValidSha, isValidObjectType } from './types'
import { parseIdentity, formatIdentity } from './commit'

// =============================================================================
// Text Encoding Utilities
// =============================================================================

const encoder = new TextEncoder()
const decoder = new TextDecoder()

// =============================================================================
// GitTag Class
// =============================================================================

/**
 * Git annotated tag object
 */
export class GitTag {
  readonly type = 'tag' as const
  readonly object: string
  readonly objectType: ObjectType
  readonly name: string
  readonly tagger?: GitIdentity
  readonly message: string

  /**
   * Creates a new GitTag
   * @throws Error if object SHA or type is invalid
   */
  constructor(data: TagData) {
    if (!isValidSha(data.object)) {
      throw new Error(`Invalid object SHA: ${data.object}`)
    }

    if (!isValidObjectType(data.objectType)) {
      throw new Error(`Invalid object type: ${data.objectType}`)
    }

    this.object = data.object
    this.objectType = data.objectType
    this.name = data.name
    this.tagger = data.tagger
    this.message = data.message
  }

  /**
   * Creates a GitTag from raw tag content (without header)
   */
  static fromContent(content: string): GitTag {
    return parseTagContent(content)
  }

  /**
   * Parses a GitTag from serialized Git object format
   * @param data - The serialized data including header
   * @throws Error if the header is invalid or type is not tag
   */
  static parse(data: Uint8Array): GitTag {
    const { type, size, headerLength } = parseObjectHeader(data)

    if (type !== 'tag') {
      throw new Error(`Invalid tag header: expected 'tag', got '${type}'`)
    }

    const content = data.slice(headerLength)

    // Validate size matches actual content length
    if (content.length !== size) {
      throw new Error(`Size mismatch: header says ${size} bytes, but content is ${content.length} bytes`)
    }

    const contentStr = decoder.decode(content)
    return parseTagContent(contentStr)
  }

  /**
   * Checks if this tag has a GPG signature (in the message)
   */
  hasSignature(): boolean {
    return this.message.includes('-----BEGIN PGP SIGNATURE-----')
  }

  /**
   * Serializes the tag to Git object format
   */
  serialize(): Uint8Array {
    const content = this.serializeContent()
    const contentBytes = encoder.encode(content)
    const header = createObjectHeader('tag', contentBytes.length)
    const result = new Uint8Array(header.length + contentBytes.length)
    result.set(header)
    result.set(contentBytes, header.length)
    return result
  }

  /**
   * Serializes just the tag content (without header)
   */
  private serializeContent(): string {
    const lines: string[] = []

    // Object line
    lines.push(`object ${this.object}`)

    // Type line
    lines.push(`type ${this.objectType}`)

    // Tag name line
    lines.push(`tag ${this.name}`)

    // Tagger line (optional)
    if (this.tagger) {
      lines.push(formatIdentity('tagger', this.tagger))
    }

    // Blank line before message
    lines.push('')

    // Message
    lines.push(this.message)

    return lines.join('\n')
  }

  /**
   * Calculates the SHA-1 hash of this tag object
   * @returns Promise resolving to 40-character hex string
   */
  async hash(): Promise<string> {
    const content = this.serializeContent()
    const contentBytes = encoder.encode(content)
    return calculateObjectHash('tag', contentBytes)
  }
}

// =============================================================================
// Tag Content Parser
// =============================================================================

function parseTagContent(content: string): GitTag {
  const lines = content.split('\n')
  let object: string | undefined
  let objectType: ObjectType | undefined
  let name: string | undefined
  let tagger: GitIdentity | undefined
  let messageStartIdx = -1

  let i = 0
  while (i < lines.length) {
    const line = lines[i]

    // Empty line marks start of message
    if (line === '') {
      messageStartIdx = i + 1
      break
    }

    if (line.startsWith('object ')) {
      object = line.slice(7)
    } else if (line.startsWith('type ')) {
      const typeStr = line.slice(5)
      if (isValidObjectType(typeStr)) {
        objectType = typeStr
      }
    } else if (line.startsWith('tag ')) {
      name = line.slice(4)
    } else if (line.startsWith('tagger ')) {
      tagger = parseIdentity(line)
    }

    i++
  }

  // Validate required fields
  if (!object) {
    throw new Error('Invalid tag: missing object')
  }
  if (!objectType) {
    throw new Error('Invalid tag: missing type')
  }
  if (!name) {
    throw new Error('Invalid tag: missing tag name')
  }

  // Extract message
  const message = messageStartIdx >= 0 ? lines.slice(messageStartIdx).join('\n') : ''

  return new GitTag({
    object,
    objectType,
    name,
    tagger,
    message,
  })
}
