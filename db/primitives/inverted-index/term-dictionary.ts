/**
 * Term Dictionary with FST-like Prefix Compression
 *
 * Stores term metadata (posting offset, length) with efficient
 * prefix compression and support for prefix/range queries.
 *
 * @module db/primitives/inverted-index/term-dictionary
 */

import { encodeVarint, decodeVarint, varintSize } from './posting-list'

// ============================================================================
// Constants
// ============================================================================

/** Magic bytes for dictionary: "FXDI" (Full-text Dictionary Index) */
export const DICTIONARY_MAGIC = new Uint8Array([0x46, 0x58, 0x44, 0x49])

/** Current format version */
export const FORMAT_VERSION = 1

// ============================================================================
// Types
// ============================================================================

/**
 * Metadata for adding a term to the dictionary
 */
export interface DictionaryEntryInput {
  /** Document frequency (number of docs containing this term) */
  df: number
  /** Byte offset to posting list in postings file */
  offset: number
  /** Byte length of the posting list */
  length: number
}

/**
 * Full dictionary entry with term
 */
export interface DictionaryEntry extends DictionaryEntryInput {
  /** The term string */
  term: string
}

/**
 * Search result entry from prefix/range search
 */
export interface SearchEntry {
  term: string
  df: number
  offset: number
  length: number
}

// ============================================================================
// TermDictionary
// ============================================================================

/**
 * Term dictionary with prefix compression
 *
 * Stores terms with their metadata (df, offset, length) and supports
 * efficient prefix and range queries. Uses a sorted map internally
 * for simplicity, with prefix compression in serialization.
 */
export class TermDictionary {
  /** Sorted map of term -> metadata */
  private terms: Map<string, DictionaryEntryInput> = new Map()

  /**
   * Add or update a term with its metadata
   */
  add(term: string, entry: DictionaryEntryInput): void {
    this.terms.set(term, { ...entry })
  }

  /**
   * Get metadata for a term
   * @returns Full entry or null if not found
   */
  get(term: string): DictionaryEntry | null {
    const entry = this.terms.get(term)
    if (!entry) return null
    return { term, ...entry }
  }

  /**
   * Check if a term exists
   */
  contains(term: string): boolean {
    return this.terms.has(term)
  }

  /**
   * Get number of terms
   */
  get termCount(): number {
    return this.terms.size
  }

  /**
   * Find all terms with a given prefix
   */
  prefixSearch(prefix: string): SearchEntry[] {
    const results: SearchEntry[] = []

    // Get sorted terms
    const sortedTerms = Array.from(this.terms.keys()).sort()

    for (const term of sortedTerms) {
      if (term.startsWith(prefix)) {
        const entry = this.terms.get(term)!
        results.push({ term, ...entry })
      }
    }

    return results
  }

  /**
   * Find all terms in a lexicographic range (inclusive)
   * @param start - Start of range (null for open start)
   * @param end - End of range (null for open end)
   */
  rangeSearch(start: string | null, end: string | null): SearchEntry[] {
    // Handle impossible range
    if (start !== null && end !== null && start > end) {
      return []
    }

    const results: SearchEntry[] = []
    const sortedTerms = Array.from(this.terms.keys()).sort()

    for (const term of sortedTerms) {
      const afterStart = start === null || term >= start
      const beforeEnd = end === null || term <= end

      if (afterStart && beforeEnd) {
        const entry = this.terms.get(term)!
        results.push({ term, ...entry })
      }
    }

    return results
  }

  /**
   * Get all terms in sorted order
   */
  getAllTerms(): string[] {
    return Array.from(this.terms.keys()).sort()
  }

  /**
   * Get all entries in sorted order
   */
  getAllEntries(): DictionaryEntry[] {
    return this.getAllTerms().map((term) => ({
      term,
      ...this.terms.get(term)!,
    }))
  }

  /**
   * Serialize the dictionary with prefix compression
   *
   * Format:
   * - Header (6 bytes):
   *   - magic: 4 bytes "FXDI"
   *   - version: 2 bytes
   *
   * - term_count: varint
   *
   * - Term entries (prefix-compressed):
   *   - prefix_length: varint (shared chars with previous term)
   *   - suffix_length: varint
   *   - suffix: suffix_length bytes
   *   - df: varint
   *   - offset: varint
   *   - length: varint
   */
  serialize(): Uint8Array {
    const encoder = new TextEncoder()
    const sortedTerms = this.getAllTerms()
    const parts: Uint8Array[] = []

    // Header (magic + version)
    const header = new Uint8Array(6)
    header.set(DICTIONARY_MAGIC, 0)
    const headerView = new DataView(header.buffer)
    headerView.setUint16(4, FORMAT_VERSION, true)
    parts.push(header)

    // Term count as varint
    parts.push(encodeVarint(sortedTerms.length))

    // Term entries with prefix compression
    let prevTerm = ''

    for (const term of sortedTerms) {
      const entry = this.terms.get(term)!

      // Calculate shared prefix length
      let prefixLen = 0
      const minLen = Math.min(prevTerm.length, term.length)
      while (prefixLen < minLen && prevTerm[prefixLen] === term[prefixLen]) {
        prefixLen++
      }

      // Encode suffix
      const suffix = term.slice(prefixLen)
      const suffixBytes = encoder.encode(suffix)

      // Entry with varints: prefix_len + suffix_len + suffix + df + offset + length
      parts.push(encodeVarint(prefixLen))
      parts.push(encodeVarint(suffixBytes.length))
      parts.push(suffixBytes)
      parts.push(encodeVarint(entry.df))
      parts.push(encodeVarint(entry.offset))
      parts.push(encodeVarint(entry.length))

      prevTerm = term
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
   * Deserialize dictionary from bytes
   */
  static deserialize(bytes: Uint8Array): TermDictionary {
    const decoder = new TextDecoder()
    const dict = new TermDictionary()

    if (bytes.length < 4) {
      throw new Error('Invalid dictionary: magic mismatch - too short')
    }

    // Validate magic
    for (let i = 0; i < DICTIONARY_MAGIC.length; i++) {
      if (bytes[i] !== DICTIONARY_MAGIC[i]) {
        throw new Error('Invalid dictionary: magic mismatch')
      }
    }

    if (bytes.length < 6) {
      throw new Error('Invalid dictionary: header too short')
    }

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const version = view.getUint16(4, true)
    if (version !== FORMAT_VERSION) {
      throw new Error(`Unsupported dictionary version: ${version}`)
    }

    let offset = 6

    // Read term count as varint
    const [termCount, termCountBytes] = decodeVarint(bytes, offset)
    offset += termCountBytes

    let prevTerm = ''

    for (let i = 0; i < termCount; i++) {
      // Read prefix length
      const [prefixLen, prefixBytes] = decodeVarint(bytes, offset)
      offset += prefixBytes

      // Read suffix length
      const [suffixLen, suffixLenBytes] = decodeVarint(bytes, offset)
      offset += suffixLenBytes

      // Read suffix
      const suffix = decoder.decode(bytes.slice(offset, offset + suffixLen))
      offset += suffixLen

      // Reconstruct term from prefix + suffix
      const term = prevTerm.slice(0, prefixLen) + suffix

      // Read metadata
      const [df, dfBytes] = decodeVarint(bytes, offset)
      offset += dfBytes

      const [postingOffset, postingOffsetBytes] = decodeVarint(bytes, offset)
      offset += postingOffsetBytes

      const [length, lengthBytes] = decodeVarint(bytes, offset)
      offset += lengthBytes

      dict.add(term, { df, offset: postingOffset, length })
      prevTerm = term
    }

    return dict
  }
}
