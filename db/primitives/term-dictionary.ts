/**
 * TermDictionary Primitive
 *
 * FST (Finite State Transducer) based term dictionary supporting:
 * - Fast prefix search for autocomplete
 * - Fuzzy matching with Levenshtein distance for typo tolerance
 * - Term suggestions for "did you mean?" functionality
 *
 * The FST implementation uses a trie-like structure with shared prefixes
 * for memory-efficient term storage, combined with sorted maps for
 * fast lookup and range queries.
 *
 * @module db/primitives/term-dictionary
 */

// ============================================================================
// Constants
// ============================================================================

/** Magic bytes for dictionary: "TRMD" (TeRM Dictionary) */
export const TERM_DICTIONARY_MAGIC = new Uint8Array([0x54, 0x52, 0x4d, 0x44])

/** Current format version */
export const TERM_DICTIONARY_VERSION = 1

// ============================================================================
// Types
// ============================================================================

/**
 * Entry in the term dictionary
 */
export interface TermEntry {
  /** The term string */
  term: string
  /** Document frequency (number of docs containing this term) */
  docFreq: number
  /** Byte offset to posting list */
  offset: number
}

/**
 * Internal FST node for trie-based storage
 */
interface FSTNode {
  /** Children nodes keyed by character */
  children: Map<string, FSTNode>
  /** Term entry if this node represents a complete term */
  entry: TermEntry | null
}

// ============================================================================
// Varint Encoding (for serialization)
// ============================================================================

/**
 * Encode a non-negative integer as a variable-length integer
 */
function encodeVarint(value: number): Uint8Array {
  const bytes: number[] = []
  while (value >= 0x80) {
    bytes.push((value & 0x7f) | 0x80)
    value >>>= 7
  }
  bytes.push(value)
  return new Uint8Array(bytes)
}

/**
 * Decode a varint from a byte array
 * @returns [value, bytesRead]
 */
function decodeVarint(bytes: Uint8Array, offset: number): [number, number] {
  let value = 0
  let shift = 0
  let bytesRead = 0

  while (offset + bytesRead < bytes.length) {
    const byte = bytes[offset + bytesRead]
    value |= (byte & 0x7f) << shift
    bytesRead++
    if ((byte & 0x80) === 0) break
    shift += 7
  }

  return [value, bytesRead]
}

// ============================================================================
// TermDictionary
// ============================================================================

/**
 * FST-based term dictionary for autocomplete and fuzzy search
 *
 * Supports:
 * - O(k) prefix lookup where k = prefix length
 * - Efficient prefix search for autocomplete
 * - Fuzzy matching with configurable edit distance
 * - Memory-efficient storage via trie prefix sharing
 */
export class TermDictionary {
  /** Root of the FST trie */
  private root: FSTNode

  /** Total number of terms */
  private termCount: number = 0

  constructor() {
    this.root = this.createNode()
  }

  /**
   * Create a new empty FST node
   */
  private createNode(): FSTNode {
    return {
      children: new Map(),
      entry: null,
    }
  }

  // ==========================================================================
  // Core Operations
  // ==========================================================================

  /**
   * Add a term with its metadata
   */
  add(term: string, docFreq: number, offset: number): void {
    let node = this.root

    // Traverse/create path in trie
    for (const char of term) {
      let child = node.children.get(char)
      if (!child) {
        child = this.createNode()
        node.children.set(char, child)
      }
      node = child
    }

    // Update or set entry
    if (!node.entry) {
      this.termCount++
    }
    node.entry = { term, docFreq, offset }
  }

  /**
   * Lookup a term
   * @returns TermEntry or null if not found
   */
  lookup(term: string): TermEntry | null {
    let node = this.root

    for (const char of term) {
      const child = node.children.get(char)
      if (!child) return null
      node = child
    }

    return node.entry
  }

  /**
   * Get the number of terms in the dictionary
   */
  get size(): number {
    return this.termCount
  }

  // ==========================================================================
  // Prefix Search (Autocomplete)
  // ==========================================================================

  /**
   * Find all terms with a given prefix, sorted by docFreq (descending)
   * @param prefix - The prefix to search for
   * @param limit - Maximum number of results to return
   * @returns Array of TermEntry sorted by docFreq
   */
  prefixSearch(prefix: string, limit: number): TermEntry[] {
    // Navigate to prefix node
    let node = this.root
    for (const char of prefix) {
      const child = node.children.get(char)
      if (!child) return []
      node = child
    }

    // Collect all entries under this node
    const entries: TermEntry[] = []
    this.collectEntries(node, entries)

    // Sort by docFreq descending and limit
    entries.sort((a, b) => b.docFreq - a.docFreq)
    return entries.slice(0, limit)
  }

  /**
   * Recursively collect all entries from a node and its descendants
   */
  private collectEntries(node: FSTNode, results: TermEntry[]): void {
    if (node.entry) {
      results.push(node.entry)
    }

    for (const child of node.children.values()) {
      this.collectEntries(child, results)
    }
  }

  // ==========================================================================
  // Fuzzy Search (Levenshtein Automaton)
  // ==========================================================================

  /**
   * Find terms within a given edit distance of the query
   * Uses a Levenshtein automaton approach with incremental distance calculation
   * @param query - The search term (potentially misspelled)
   * @param maxEdits - Maximum edit distance (1-2 recommended)
   * @returns Array of TermEntry sorted by distance, then docFreq
   */
  fuzzySearch(query: string, maxEdits: number): TermEntry[] {
    const results: Array<{ entry: TermEntry; distance: number }> = []

    // Initialize the first row of the Levenshtein matrix
    // row[i] represents the edit distance from empty string to query[0..i]
    const initialRow: number[] = []
    for (let i = 0; i <= query.length; i++) {
      initialRow.push(i)
    }

    // DFS with incremental Levenshtein calculation
    this.fuzzySearchWithRow(this.root, '', query, maxEdits, initialRow, results)

    // Sort by distance first, then by docFreq descending
    results.sort((a, b) => {
      if (a.distance !== b.distance) return a.distance - b.distance
      return b.entry.docFreq - a.entry.docFreq
    })

    return results.map((r) => r.entry)
  }

  /**
   * DFS traversal for fuzzy search with incremental Levenshtein row updates
   * This is more efficient than recalculating the full distance at each node
   */
  private fuzzySearchWithRow(
    node: FSTNode,
    currentTerm: string,
    query: string,
    maxEdits: number,
    prevRow: number[],
    results: Array<{ entry: TermEntry; distance: number }>
  ): void {
    // Check if current node has a complete term
    if (node.entry) {
      // The edit distance is the last element of prevRow
      const distance = prevRow[query.length]
      if (distance <= maxEdits) {
        results.push({ entry: node.entry, distance })
      }
    }

    // Explore children with updated Levenshtein row
    for (const [char, child] of node.children) {
      // Calculate new row for this character
      const currentRow: number[] = [prevRow[0] + 1]

      for (let i = 1; i <= query.length; i++) {
        const cost = query[i - 1] === char ? 0 : 1
        currentRow.push(
          Math.min(
            currentRow[i - 1] + 1, // insertion
            prevRow[i] + 1, // deletion
            prevRow[i - 1] + cost // substitution
          )
        )
      }

      // Pruning: only continue if minimum value in row is within maxEdits
      // This is the key optimization - we can prune branches that can never
      // lead to a valid match
      const minInRow = Math.min(...currentRow)
      if (minInRow <= maxEdits) {
        this.fuzzySearchWithRow(child, currentTerm + char, query, maxEdits, currentRow, results)
      }
    }
  }

  /**
   * Calculate Levenshtein (edit) distance between two strings
   * Uses dynamic programming with O(min(m,n)) space
   */
  static levenshteinDistance(a: string, b: string): number {
    // Ensure a is the shorter string for space optimization
    if (a.length > b.length) {
      ;[a, b] = [b, a]
    }

    const m = a.length
    const n = b.length

    // Early exit for empty strings
    if (m === 0) return n
    if (n === 0) return m

    // Use two rows for space optimization
    let prevRow = new Array(m + 1)
    let currRow = new Array(m + 1)

    // Initialize first row
    for (let j = 0; j <= m; j++) {
      prevRow[j] = j
    }

    // Fill in the matrix
    for (let i = 1; i <= n; i++) {
      currRow[0] = i

      for (let j = 1; j <= m; j++) {
        const cost = a[j - 1] === b[i - 1] ? 0 : 1
        currRow[j] = Math.min(
          prevRow[j] + 1, // deletion
          currRow[j - 1] + 1, // insertion
          prevRow[j - 1] + cost // substitution
        )
      }

      // Swap rows
      ;[prevRow, currRow] = [currRow, prevRow]
    }

    return prevRow[m]
  }

  // ==========================================================================
  // Term Suggestions ("Did You Mean?")
  // ==========================================================================

  /**
   * Suggest similar terms for a potentially misspelled query
   * Combines fuzzy matching with frequency ranking
   * @param query - The query term (potentially misspelled)
   * @param limit - Maximum number of suggestions
   * @returns Array of TermEntry suggestions
   */
  suggest(query: string, limit: number): TermEntry[] {
    // First check if it's an exact match
    const exact = this.lookup(query)

    // Get fuzzy matches
    const fuzzyResults = this.fuzzySearch(query, 2)

    // If exact match exists and is only result, return it
    if (exact && fuzzyResults.length === 1 && fuzzyResults[0].term === query) {
      return [exact]
    }

    // Filter out exact match from suggestions (we don't need to suggest what they typed)
    const suggestions = fuzzyResults.filter((e) => e.term !== query)

    // Score suggestions by combining distance and frequency
    const scored = suggestions.map((entry) => {
      const distance = TermDictionary.levenshteinDistance(entry.term, query)
      // Score: lower distance is better, higher docFreq is better
      // Normalize and combine
      const distanceScore = 1 / (1 + distance)
      const freqScore = Math.log10(entry.docFreq + 1)
      return { entry, score: distanceScore * freqScore }
    })

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score)

    return scored.slice(0, limit).map((s) => s.entry)
  }

  // ==========================================================================
  // Serialization
  // ==========================================================================

  /**
   * Serialize the dictionary to bytes
   *
   * Format:
   * - Header (6 bytes):
   *   - magic: 4 bytes "TRMD"
   *   - version: 2 bytes (little endian)
   * - termCount: varint
   * - Terms (prefix-compressed, sorted):
   *   - For each term:
   *     - prefixLen: varint (shared chars with previous term)
   *     - suffixLen: varint
   *     - suffix: suffixLen bytes (UTF-8)
   *     - docFreq: varint
   *     - offset: varint
   */
  serialize(): Uint8Array {
    const encoder = new TextEncoder()
    const parts: Uint8Array[] = []

    // Header
    const header = new Uint8Array(6)
    header.set(TERM_DICTIONARY_MAGIC, 0)
    const headerView = new DataView(header.buffer)
    headerView.setUint16(TERM_DICTIONARY_MAGIC.length, TERM_DICTIONARY_VERSION, true)
    parts.push(header)

    // Collect all terms in sorted order
    const entries: TermEntry[] = []
    this.collectEntries(this.root, entries)
    entries.sort((a, b) => a.term.localeCompare(b.term))

    // Term count
    parts.push(encodeVarint(entries.length))

    // Terms with prefix compression
    let prevTerm = ''
    for (const entry of entries) {
      // Calculate shared prefix length
      let prefixLen = 0
      const minLen = Math.min(prevTerm.length, entry.term.length)
      while (prefixLen < minLen && prevTerm[prefixLen] === entry.term[prefixLen]) {
        prefixLen++
      }

      const suffix = entry.term.slice(prefixLen)
      const suffixBytes = encoder.encode(suffix)

      parts.push(encodeVarint(prefixLen))
      parts.push(encodeVarint(suffixBytes.length))
      parts.push(suffixBytes)
      parts.push(encodeVarint(entry.docFreq))
      parts.push(encodeVarint(entry.offset))

      prevTerm = entry.term
    }

    // Concatenate all parts
    const totalLen = parts.reduce((sum, p) => sum + p.length, 0)
    const result = new Uint8Array(totalLen)
    let offset = 0
    for (const part of parts) {
      result.set(part, offset)
      offset += part.length
    }

    return result
  }

  /**
   * Deserialize dictionary from bytes
   */
  static deserialize(bytes: Uint8Array): TermDictionary {
    const decoder = new TextDecoder()
    const dict = new TermDictionary()

    // Validate magic
    if (bytes.length < TERM_DICTIONARY_MAGIC.length) {
      throw new Error('Invalid term dictionary: too short for magic bytes')
    }
    for (let i = 0; i < TERM_DICTIONARY_MAGIC.length; i++) {
      if (bytes[i] !== TERM_DICTIONARY_MAGIC[i]) {
        throw new Error('Invalid term dictionary: magic bytes mismatch')
      }
    }

    // Validate version
    if (bytes.length < 6) {
      throw new Error('Invalid term dictionary: too short for header')
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const version = view.getUint16(TERM_DICTIONARY_MAGIC.length, true)
    if (version !== TERM_DICTIONARY_VERSION) {
      throw new Error(`Unsupported term dictionary version: ${version}`)
    }

    let offset = 6

    // Read term count
    const [termCount, termCountBytes] = decodeVarint(bytes, offset)
    offset += termCountBytes

    // Read terms
    let prevTerm = ''
    for (let i = 0; i < termCount; i++) {
      const [prefixLen, prefixLenBytes] = decodeVarint(bytes, offset)
      offset += prefixLenBytes

      const [suffixLen, suffixLenBytes] = decodeVarint(bytes, offset)
      offset += suffixLenBytes

      const suffix = decoder.decode(bytes.slice(offset, offset + suffixLen))
      offset += suffixLen

      const term = prevTerm.slice(0, prefixLen) + suffix

      const [docFreq, docFreqBytes] = decodeVarint(bytes, offset)
      offset += docFreqBytes

      const [postingOffset, postingOffsetBytes] = decodeVarint(bytes, offset)
      offset += postingOffsetBytes

      dict.add(term, docFreq, postingOffset)
      prevTerm = term
    }

    return dict
  }
}
