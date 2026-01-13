/**
 * TermDictionary - FST-based autocomplete primitive
 *
 * Provides efficient prefix matching and fuzzy search for autocomplete:
 * - **Trie-based FST** - Shared prefix compression for memory efficiency
 * - **prefixSearch** - O(k + m) prefix matching where k is prefix length, m is results
 * - **fuzzySearch** - Levenshtein distance-based fuzzy matching
 * - **Serialization** - Binary format with prefix compression
 *
 * ## Features
 * - Generic value types (strings, numbers, objects)
 * - Sorted iteration
 * - Efficient memory usage through prefix sharing
 * - Fast prefix lookups for autocomplete
 * - Fuzzy matching for typo tolerance
 *
 * @module db/primitives/term-dictionary
 */

// =============================================================================
// CONSTANTS
// =============================================================================

/** Magic bytes for dictionary: "TDFS" (Term Dictionary FST) */
export const DICTIONARY_MAGIC = new Uint8Array([0x54, 0x44, 0x46, 0x53])

/** Current format version */
export const FORMAT_VERSION = 1

// =============================================================================
// TYPES
// =============================================================================

/**
 * Configuration options for TermDictionary
 */
export interface TermDictionaryOptions {
  /**
   * Whether searches are case-sensitive.
   * @default true
   */
  caseSensitive?: boolean
}

/**
 * Result from prefix search
 */
export interface SearchResult<T> {
  /** The matched term */
  term: string
  /** Associated value */
  value: T
}

/**
 * Result from fuzzy search with distance
 */
export interface FuzzySearchResult<T> extends SearchResult<T> {
  /** Edit distance from query */
  distance: number
}

/**
 * Options for prefix search
 */
export interface PrefixSearchOptions {
  /** Maximum number of results to return */
  limit?: number
}

/**
 * Options for fuzzy search
 */
export interface FuzzySearchOptions {
  /** Maximum number of results to return */
  limit?: number
}

// =============================================================================
// TRIE NODE
// =============================================================================

/**
 * Trie node for FST implementation
 * @internal
 */
interface TrieNode<T> {
  /** Children nodes indexed by character */
  children: Map<string, TrieNode<T>>
  /** Value stored at this node (if this is an end of a term) */
  value?: T
  /** Whether this node represents end of a term */
  isEnd: boolean
}

/**
 * Create a new trie node
 * @internal
 */
function createNode<T>(): TrieNode<T> {
  return {
    children: new Map(),
    isEnd: false,
  }
}

// =============================================================================
// TERM DICTIONARY
// =============================================================================

/**
 * TermDictionary with FST-like trie for autocomplete
 *
 * Uses a trie (prefix tree) for efficient prefix matching and
 * supports fuzzy search via Levenshtein distance.
 *
 * @typeParam T - Type of values stored in the dictionary
 *
 * @example
 * ```typescript
 * const dict = createTermDictionary<string>()
 *
 * // Add terms with values
 * dict.add('javascript', 'language')
 * dict.add('java', 'language')
 * dict.add('json', 'format')
 *
 * // Prefix search for autocomplete
 * const results = dict.prefixSearch('ja')
 * // [{ term: 'java', value: 'language' }, { term: 'javascript', value: 'language' }]
 *
 * // Fuzzy search for typo tolerance
 * const fuzzy = dict.fuzzySearch('javascritp', 2)
 * // [{ term: 'javascript', value: 'language', distance: 1 }]
 * ```
 */
export class TermDictionary<T> {
  /** Root node of the trie */
  private root: TrieNode<T> = createNode()

  /** Number of terms in the dictionary */
  private _size: number = 0

  /** Configuration options */
  private readonly options: Required<TermDictionaryOptions>

  constructor(options?: TermDictionaryOptions) {
    this.options = {
      caseSensitive: options?.caseSensitive ?? true,
    }
  }

  /**
   * Get the number of terms in the dictionary
   */
  get size(): number {
    return this._size
  }

  /**
   * Add a term with associated value
   *
   * @param term - The term to add
   * @param value - The value to associate
   */
  add(term: string, value: T): void {
    const normalizedTerm = this.normalizeTerm(term)
    let node = this.root

    for (const char of normalizedTerm) {
      let child = node.children.get(char)
      if (!child) {
        child = createNode()
        node.children.set(char, child)
      }
      node = child
    }

    if (!node.isEnd) {
      this._size++
    }

    node.isEnd = true
    node.value = value
  }

  /**
   * Get the value for a term
   *
   * @param term - The term to look up
   * @returns The value or undefined if not found
   */
  get(term: string): T | undefined {
    const normalizedTerm = this.normalizeTerm(term)
    const node = this.findNode(normalizedTerm)
    return node?.isEnd ? node.value : undefined
  }

  /**
   * Check if a term exists in the dictionary
   *
   * @param term - The term to check
   * @returns true if the term exists
   */
  has(term: string): boolean {
    const normalizedTerm = this.normalizeTerm(term)
    const node = this.findNode(normalizedTerm)
    return node?.isEnd ?? false
  }

  /**
   * Delete a term from the dictionary
   *
   * @param term - The term to delete
   * @returns true if the term was deleted
   */
  delete(term: string): boolean {
    const normalizedTerm = this.normalizeTerm(term)
    const node = this.findNode(normalizedTerm)

    if (!node?.isEnd) {
      return false
    }

    node.isEnd = false
    node.value = undefined
    this._size--
    return true
  }

  /**
   * Clear all terms from the dictionary
   */
  clear(): void {
    this.root = createNode()
    this._size = 0
  }

  /**
   * Find all terms with a given prefix
   *
   * @param prefix - The prefix to search for
   * @param options - Search options
   * @returns Array of matching terms with values, sorted alphabetically
   */
  prefixSearch(prefix: string, options?: PrefixSearchOptions): SearchResult<T>[] {
    const normalizedPrefix = this.normalizeTerm(prefix)
    const results: SearchResult<T>[] = []
    const limit = options?.limit

    // Find the node for the prefix
    const prefixNode = this.findNode(normalizedPrefix)
    if (!prefixNode) {
      return results
    }

    // Collect all terms under this node
    this.collectTerms(prefixNode, normalizedPrefix, results, limit)

    // Sort alphabetically
    results.sort((a, b) => a.term.localeCompare(b.term))

    return limit ? results.slice(0, limit) : results
  }

  /**
   * Find terms within a given edit distance (Levenshtein)
   *
   * @param term - The term to search for
   * @param maxDistance - Maximum edit distance
   * @param options - Search options
   * @returns Array of matching terms with values and distances
   */
  fuzzySearch(
    term: string,
    maxDistance: number,
    options?: FuzzySearchOptions
  ): FuzzySearchResult<T>[] {
    const normalizedTerm = this.normalizeTerm(term)
    const results: FuzzySearchResult<T>[] = []
    const limit = options?.limit

    // Use iterative approach with early termination
    this.fuzzySearchRecursive(
      this.root,
      '',
      normalizedTerm,
      this.initLevenshteinRow(normalizedTerm.length),
      maxDistance,
      results
    )

    // Sort by distance, then alphabetically
    results.sort((a, b) => {
      if (a.distance !== b.distance) {
        return a.distance - b.distance
      }
      return a.term.localeCompare(b.term)
    })

    return limit ? results.slice(0, limit) : results
  }

  /**
   * Iterate over all entries in sorted order
   */
  *entries(): IterableIterator<SearchResult<T>> {
    const allResults: SearchResult<T>[] = []
    this.collectTerms(this.root, '', allResults)
    allResults.sort((a, b) => a.term.localeCompare(b.term))
    yield* allResults
  }

  /**
   * Iterate over all terms in sorted order
   */
  *keys(): IterableIterator<string> {
    for (const entry of this.entries()) {
      yield entry.term
    }
  }

  /**
   * Iterate over all values (in term-sorted order)
   */
  *values(): IterableIterator<T> {
    for (const entry of this.entries()) {
      yield entry.value
    }
  }

  /**
   * Serialize the dictionary to bytes
   *
   * Format:
   * - Header (6 bytes): magic (4) + version (2)
   * - term_count: uint32
   * - For each term (sorted):
   *   - prefix_length: uint16 (shared with previous)
   *   - suffix_length: uint16
   *   - suffix: suffix_length bytes (UTF-8)
   *   - value_length: uint32
   *   - value: value_length bytes (JSON)
   */
  serialize(): Uint8Array {
    const entries = [...this.entries()]
    const parts: Uint8Array[] = []
    const encoder = new TextEncoder()

    // Header: magic + version
    const header = new Uint8Array(6)
    header.set(DICTIONARY_MAGIC, 0)
    new DataView(header.buffer).setUint16(4, FORMAT_VERSION, true)
    parts.push(header)

    // Term count
    const countBuf = new Uint8Array(4)
    new DataView(countBuf.buffer).setUint32(0, entries.length, true)
    parts.push(countBuf)

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
      const valueBytes = encoder.encode(JSON.stringify(entry.value))

      // prefix_length (2) + suffix_length (2) + suffix + value_length (4) + value
      const entryBuf = new Uint8Array(8 + suffixBytes.length + valueBytes.length)
      const entryView = new DataView(entryBuf.buffer)

      entryView.setUint16(0, prefixLen, true)
      entryView.setUint16(2, suffixBytes.length, true)
      entryBuf.set(suffixBytes, 4)
      entryView.setUint32(4 + suffixBytes.length, valueBytes.length, true)
      entryBuf.set(valueBytes, 8 + suffixBytes.length)

      parts.push(entryBuf)
      prevTerm = entry.term
    }

    // Concatenate all parts
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
   * Deserialize a dictionary from bytes
   *
   * @param bytes - Serialized dictionary data
   * @returns New TermDictionary instance
   */
  static deserialize<T>(bytes: Uint8Array): TermDictionary<T> {
    const decoder = new TextDecoder()
    const dict = new TermDictionary<T>()

    if (bytes.length < 6) {
      throw new Error('Invalid dictionary: too short')
    }

    // Validate magic
    for (let i = 0; i < DICTIONARY_MAGIC.length; i++) {
      if (bytes[i] !== DICTIONARY_MAGIC[i]) {
        throw new Error('Invalid dictionary: magic mismatch')
      }
    }

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const version = view.getUint16(4, true)
    if (version !== FORMAT_VERSION) {
      throw new Error(`Unsupported dictionary version: ${version}`)
    }

    if (bytes.length < 10) {
      throw new Error('Invalid dictionary: missing term count')
    }

    const termCount = view.getUint32(6, true)
    let offset = 10
    let prevTerm = ''

    for (let i = 0; i < termCount; i++) {
      if (offset + 4 > bytes.length) {
        throw new Error('Invalid dictionary: truncated entry header')
      }

      const prefixLen = view.getUint16(offset, true)
      const suffixLen = view.getUint16(offset + 2, true)
      offset += 4

      if (offset + suffixLen > bytes.length) {
        throw new Error('Invalid dictionary: truncated suffix')
      }

      const suffix = decoder.decode(bytes.slice(offset, offset + suffixLen))
      offset += suffixLen

      if (offset + 4 > bytes.length) {
        throw new Error('Invalid dictionary: truncated value length')
      }

      const valueLen = view.getUint32(offset, true)
      offset += 4

      if (offset + valueLen > bytes.length) {
        throw new Error('Invalid dictionary: truncated value')
      }

      const valueJson = decoder.decode(bytes.slice(offset, offset + valueLen))
      offset += valueLen

      const term = prevTerm.slice(0, prefixLen) + suffix
      const value = JSON.parse(valueJson) as T

      dict.add(term, value)
      prevTerm = term
    }

    return dict
  }

  // ===========================================================================
  // PRIVATE HELPERS
  // ===========================================================================

  /**
   * Normalize a term based on options
   */
  private normalizeTerm(term: string): string {
    return this.options.caseSensitive ? term : term.toLowerCase()
  }

  /**
   * Find the node for a given term
   */
  private findNode(term: string): TrieNode<T> | undefined {
    let node = this.root
    for (const char of term) {
      const child = node.children.get(char)
      if (!child) {
        return undefined
      }
      node = child
    }
    return node
  }

  /**
   * Collect all terms under a node
   */
  private collectTerms(
    node: TrieNode<T>,
    prefix: string,
    results: SearchResult<T>[],
    limit?: number
  ): void {
    if (limit && results.length >= limit) {
      return
    }

    if (node.isEnd && node.value !== undefined) {
      results.push({ term: prefix, value: node.value })
    }

    // Sort children for deterministic order
    const sortedChildren = [...node.children.entries()].sort((a, b) =>
      a[0].localeCompare(b[0])
    )

    for (const [char, child] of sortedChildren) {
      if (limit && results.length >= limit) {
        return
      }
      this.collectTerms(child, prefix + char, results, limit)
    }
  }

  /**
   * Initialize Levenshtein row for dynamic programming
   */
  private initLevenshteinRow(length: number): number[] {
    const row = new Array(length + 1)
    for (let i = 0; i <= length; i++) {
      row[i] = i
    }
    return row
  }

  /**
   * Recursive fuzzy search with Levenshtein distance pruning
   */
  private fuzzySearchRecursive(
    node: TrieNode<T>,
    currentTerm: string,
    target: string,
    previousRow: number[],
    maxDistance: number,
    results: FuzzySearchResult<T>[]
  ): void {
    const columns = target.length + 1

    // If this node is a complete term, check distance
    if (node.isEnd && node.value !== undefined) {
      const distance = previousRow[columns - 1]!
      if (distance <= maxDistance) {
        results.push({
          term: currentTerm,
          value: node.value,
          distance,
        })
      }
    }

    // Explore children
    for (const [char, child] of node.children) {
      const currentRow = new Array(columns)
      currentRow[0] = previousRow[0]! + 1

      let minDistance = currentRow[0]

      for (let j = 1; j < columns; j++) {
        const insertCost = currentRow[j - 1]! + 1
        const deleteCost = previousRow[j]! + 1
        const replaceCost = previousRow[j - 1]! + (target[j - 1] === char ? 0 : 1)

        currentRow[j] = Math.min(insertCost, deleteCost, replaceCost)
        minDistance = Math.min(minDistance, currentRow[j])
      }

      // Prune if minimum possible distance exceeds max
      if (minDistance <= maxDistance) {
        this.fuzzySearchRecursive(
          child,
          currentTerm + char,
          target,
          currentRow,
          maxDistance,
          results
        )
      }
    }
  }
}

// =============================================================================
// FACTORY FUNCTION
// =============================================================================

/**
 * Create a new TermDictionary instance
 *
 * @typeParam T - Type of values to store
 * @param options - Configuration options
 * @returns New TermDictionary instance
 *
 * @example
 * ```typescript
 * // Basic usage
 * const dict = createTermDictionary<string>()
 * dict.add('hello', 'greeting')
 *
 * // With options
 * const caseInsensitive = createTermDictionary<number>({
 *   caseSensitive: false,
 * })
 * ```
 */
export function createTermDictionary<T>(options?: TermDictionaryOptions): TermDictionary<T> {
  return new TermDictionary<T>(options)
}
