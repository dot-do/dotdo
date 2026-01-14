/**
 * Tag/Label Index for Exact Match Queries
 *
 * Efficient indexing for tag/label data like time-series labels
 * (metric_name, host, region) or document metadata (category, author, status).
 *
 * @module db/primitives/inverted-index/tag-index
 */

import { encodeVarint, decodeVarint } from './posting-list'

// ============================================================================
// Types
// ============================================================================

/**
 * Tag set for a document
 */
export type Tags = Record<string, string>

/**
 * Statistics for a single tag key
 */
export interface TagKeyStats {
  /** Number of unique values for this key */
  cardinality: number
  /** Map of value -> count of documents with that value */
  valueCounts: Map<string, number>
}

// ============================================================================
// Magic bytes for serialization
// ============================================================================

const TAG_INDEX_MAGIC = new Uint8Array([0x54, 0x41, 0x47, 0x58]) // "TAGX"

// ============================================================================
// TagIndex
// ============================================================================

/**
 * Tag index for exact match queries on key-value labels
 *
 * Supports fast queries like:
 * - Single tag: { region: 'us-east' }
 * - Multiple tags (AND): { region: 'us-east', host: 'server1' }
 * - OR across tag sets: [{ region: 'us-east' }, { region: 'us-west' }]
 */
export class TagIndex {
  /** Map of (key, value) -> Set of document IDs */
  private tagIndex: Map<string, Map<string, Set<number>>> = new Map()

  /** Map of document ID -> tags */
  private docTags: Map<number, Tags> = new Map()

  /** Set of all keys */
  private keys: Set<string> = new Set()

  /**
   * Get the number of indexed documents
   */
  get documentCount(): number {
    return this.docTags.size
  }

  /**
   * Add a document with tags to the index
   *
   * If the document already exists, its tags are replaced.
   */
  add(docId: number, tags: Tags): void {
    // Remove existing tags if document exists
    if (this.docTags.has(docId)) {
      this.remove(docId)
    }

    // Store document tags
    this.docTags.set(docId, { ...tags })

    // Index each tag
    for (const [key, value] of Object.entries(tags)) {
      this.keys.add(key)

      let keyIndex = this.tagIndex.get(key)
      if (!keyIndex) {
        keyIndex = new Map()
        this.tagIndex.set(key, keyIndex)
      }

      let valueSet = keyIndex.get(value)
      if (!valueSet) {
        valueSet = new Set()
        keyIndex.set(value, valueSet)
      }

      valueSet.add(docId)
    }
  }

  /**
   * Remove a document from the index
   */
  remove(docId: number): void {
    const tags = this.docTags.get(docId)
    if (!tags) return

    // Remove from tag index
    for (const [key, value] of Object.entries(tags)) {
      const keyIndex = this.tagIndex.get(key)
      if (keyIndex) {
        const valueSet = keyIndex.get(value)
        if (valueSet) {
          valueSet.delete(docId)
          if (valueSet.size === 0) {
            keyIndex.delete(value)
          }
        }
        if (keyIndex.size === 0) {
          this.tagIndex.delete(key)
          this.keys.delete(key)
        }
      }
    }

    this.docTags.delete(docId)
  }

  /**
   * Query documents by exact tag match (AND semantics)
   *
   * All specified tags must match exactly.
   *
   * @param tags - Tags to match (empty object returns all documents)
   * @returns Array of matching document IDs
   */
  query(tags: Tags): number[] {
    const entries = Object.entries(tags)

    // Empty query returns all documents
    if (entries.length === 0) {
      return Array.from(this.docTags.keys()).sort((a, b) => a - b)
    }

    // Start with first tag's matches
    const [firstKey, firstValue] = entries[0]!
    const keyIndex = this.tagIndex.get(firstKey)
    if (!keyIndex) return []

    const valueSet = keyIndex.get(firstValue)
    if (!valueSet || valueSet.size === 0) return []

    let result = new Set(valueSet)

    // Intersect with remaining tags
    for (let i = 1; i < entries.length && result.size > 0; i++) {
      const [key, value] = entries[i]!
      const ki = this.tagIndex.get(key)
      if (!ki) return []

      const vs = ki.get(value)
      if (!vs || vs.size === 0) return []

      result = new Set([...result].filter((d) => vs.has(d)))
    }

    return Array.from(result).sort((a, b) => a - b)
  }

  /**
   * Query with OR semantics across tag sets
   *
   * Each tag set uses AND semantics internally.
   * Results from all tag sets are combined with OR.
   *
   * @param tagSets - Array of tag sets to match
   * @returns Array of matching document IDs
   */
  queryOr(tagSets: Tags[]): number[] {
    if (tagSets.length === 0) {
      return []
    }

    const result = new Set<number>()

    for (const tags of tagSets) {
      const matches = this.query(tags)
      for (const docId of matches) {
        result.add(docId)
      }
    }

    return Array.from(result).sort((a, b) => a - b)
  }

  // ==========================================================================
  // Tag Enumeration
  // ==========================================================================

  /**
   * Get all unique tag keys in sorted order
   */
  getKeys(): string[] {
    return Array.from(this.keys).sort()
  }

  /**
   * Get all unique values for a tag key in sorted order
   */
  getValues(key: string): string[] {
    const keyIndex = this.tagIndex.get(key)
    if (!keyIndex) return []
    return Array.from(keyIndex.keys()).sort()
  }

  /**
   * Get the cardinality (number of unique values) for a tag key
   */
  getCardinality(key: string): number {
    const keyIndex = this.tagIndex.get(key)
    return keyIndex ? keyIndex.size : 0
  }

  /**
   * Get statistics for all tag keys
   */
  getTagStats(): Map<string, TagKeyStats> {
    const stats = new Map<string, TagKeyStats>()

    for (const [key, keyIndex] of this.tagIndex) {
      const valueCounts = new Map<string, number>()
      for (const [value, docIds] of keyIndex) {
        valueCounts.set(value, docIds.size)
      }

      stats.set(key, {
        cardinality: keyIndex.size,
        valueCounts,
      })
    }

    return stats
  }

  // ==========================================================================
  // Serialization
  // ==========================================================================

  /**
   * Serialize the tag index to bytes
   *
   * Format:
   * - magic: 4 bytes
   * - doc_count: varint
   * - For each document:
   *   - doc_id: varint
   *   - tag_count: varint
   *   - For each tag:
   *     - key_len: varint
   *     - key: bytes
   *     - value_len: varint
   *     - value: bytes
   */
  serialize(): Uint8Array {
    const encoder = new TextEncoder()
    const parts: Uint8Array[] = []

    // Magic
    parts.push(TAG_INDEX_MAGIC)

    // Document count
    parts.push(encodeVarint(this.docTags.size))

    // Each document with its tags
    for (const [docId, tags] of this.docTags) {
      parts.push(encodeVarint(docId))

      const entries = Object.entries(tags)
      parts.push(encodeVarint(entries.length))

      for (const [key, value] of entries) {
        const keyBytes = encoder.encode(key)
        parts.push(encodeVarint(keyBytes.length))
        parts.push(keyBytes)

        const valueBytes = encoder.encode(value)
        parts.push(encodeVarint(valueBytes.length))
        parts.push(valueBytes)
      }
    }

    // Concatenate
    const totalLength = parts.reduce((sum, p) => sum + p.length, 0)
    const result = new Uint8Array(totalLength)
    let offset = 0
    for (const part of parts) {
      result.set(part, offset)
      offset += part.length
    }

    return result
  }

  /**
   * Deserialize from bytes
   */
  static deserialize(bytes: Uint8Array): TagIndex {
    const decoder = new TextDecoder()
    const index = new TagIndex()

    if (bytes.length === 0) {
      return index
    }

    // Validate magic
    for (let i = 0; i < TAG_INDEX_MAGIC.length; i++) {
      if (bytes[i] !== TAG_INDEX_MAGIC[i]) {
        throw new Error('Invalid tag index: magic mismatch')
      }
    }

    let offset = 4

    // Document count
    const [docCount, docCountBytes] = decodeVarint(bytes, offset)
    offset += docCountBytes

    // Each document
    for (let i = 0; i < docCount; i++) {
      const [docId, docIdBytes] = decodeVarint(bytes, offset)
      offset += docIdBytes

      const [tagCount, tagCountBytes] = decodeVarint(bytes, offset)
      offset += tagCountBytes

      const tags: Tags = {}

      for (let j = 0; j < tagCount; j++) {
        const [keyLen, keyLenBytes] = decodeVarint(bytes, offset)
        offset += keyLenBytes

        const key = decoder.decode(bytes.slice(offset, offset + keyLen))
        offset += keyLen

        const [valueLen, valueLenBytes] = decodeVarint(bytes, offset)
        offset += valueLenBytes

        const value = decoder.decode(bytes.slice(offset, offset + valueLen))
        offset += valueLen

        tags[key] = value
      }

      index.add(docId, tags)
    }

    return index
  }
}

// ============================================================================
// TagQuery - Fluent Query Builder
// ============================================================================

/**
 * Fluent query builder for tag queries
 */
export class TagQuery {
  private index: TagIndex
  private andConstraints: Tags = {}
  private orConstraints: Tags[] = []

  constructor(index: TagIndex) {
    this.index = index
  }

  /**
   * Add an AND constraint
   */
  where(key: string, value: string): this {
    this.andConstraints[key] = value
    return this
  }

  /**
   * Add an OR constraint (creates a new branch)
   */
  orWhere(key: string, value: string): this {
    this.orConstraints.push({ [key]: value })
    return this
  }

  /**
   * Execute the query and return matching document IDs
   */
  execute(): number[] {
    const hasAnd = Object.keys(this.andConstraints).length > 0
    const hasOr = this.orConstraints.length > 0

    if (!hasAnd && !hasOr) {
      return this.index.query({})
    }

    if (hasAnd && !hasOr) {
      return this.index.query(this.andConstraints)
    }

    if (!hasAnd && hasOr) {
      return this.index.queryOr(this.orConstraints)
    }

    // Both AND and OR: combine them
    // Result = docs matching AND OR docs matching any OR constraint
    const andResults = new Set(this.index.query(this.andConstraints))
    for (const orTags of this.orConstraints) {
      for (const docId of this.index.query(orTags)) {
        andResults.add(docId)
      }
    }

    return Array.from(andResults).sort((a, b) => a - b)
  }

  /**
   * Count matching documents without returning IDs
   */
  count(): number {
    return this.execute().length
  }

  /**
   * Check if any documents match
   */
  exists(): boolean {
    return this.count() > 0
  }
}

// ============================================================================
// TagMatcher - For filtering/matching (exported but may not be tested)
// ============================================================================

/**
 * Tag matcher for in-memory filtering
 */
export class TagMatcher {
  private constraints: Tags

  constructor(constraints: Tags) {
    this.constraints = { ...constraints }
  }

  /**
   * Check if tags match all constraints
   */
  matches(tags: Tags): boolean {
    for (const [key, value] of Object.entries(this.constraints)) {
      if (tags[key] !== value) {
        return false
      }
    }
    return true
  }
}
