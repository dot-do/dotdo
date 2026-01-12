/**
 * Phrase Query with Positional Information
 *
 * Supports exact phrase matching and proximity queries using
 * positional posting lists that store term positions within documents.
 *
 * @module db/primitives/inverted-index/phrase-query
 */

import { encodeVarint, decodeVarint, varintSize } from './posting-list'

// ============================================================================
// Types
// ============================================================================

/**
 * A posting with positional information
 */
export interface PositionalPosting {
  /** Document ID */
  docId: number
  /** Term positions within the document (0-indexed) */
  positions: number[]
}

/**
 * Result of a phrase search
 */
export interface PhraseQueryResult {
  /** Document IDs containing the phrase */
  docIds: number[]
}

/**
 * Result with position information for scoring
 */
export interface PhraseMatchResult {
  /** Document ID */
  docId: number
  /** Starting positions of phrase matches */
  matchPositions: number[]
  /** Minimum distance between terms (for proximity scoring) */
  minDistance: number
}

// ============================================================================
// Magic bytes for serialization
// ============================================================================

const POSITIONAL_POSTING_MAGIC = new Uint8Array([0x50, 0x50, 0x4c, 0x53]) // "PPLS"

// ============================================================================
// PositionalPostingList
// ============================================================================

/**
 * Posting list with position information
 *
 * Stores document IDs along with the positions where a term occurs
 * within each document. Uses delta encoding for efficient serialization.
 */
export class PositionalPostingList {
  /** Map from docId to sorted positions array */
  private postings: Map<number, Set<number>> = new Map()

  /**
   * Add a term occurrence at a position in a document
   */
  add(docId: number, position: number): void {
    let positions = this.postings.get(docId)
    if (!positions) {
      positions = new Set()
      this.postings.set(docId, positions)
    }
    positions.add(position)
  }

  /**
   * Check if a document contains this term
   */
  contains(docId: number): boolean {
    return this.postings.has(docId)
  }

  /**
   * Get all positions for a document
   */
  getPositions(docId: number): number[] {
    const positions = this.postings.get(docId)
    if (!positions) return []
    return Array.from(positions).sort((a, b) => a - b)
  }

  /**
   * Get number of documents containing this term
   */
  get cardinality(): number {
    return this.postings.size
  }

  /**
   * Get all postings sorted by docId
   */
  getPostings(): PositionalPosting[] {
    const docIds = Array.from(this.postings.keys()).sort((a, b) => a - b)
    return docIds.map((docId) => ({
      docId,
      positions: this.getPositions(docId),
    }))
  }

  /**
   * Serialize with delta encoding
   *
   * Format:
   * - magic: 4 bytes
   * - doc_count: varint
   * - For each document:
   *   - doc_id_delta: varint
   *   - position_count: varint
   *   - For each position:
   *     - position_delta: varint
   */
  serialize(): Uint8Array {
    const postings = this.getPostings()
    const parts: Uint8Array[] = []

    // Magic
    parts.push(POSITIONAL_POSTING_MAGIC)

    // Document count
    parts.push(encodeVarint(postings.length))

    // Documents with positions
    let prevDocId = 0
    for (const posting of postings) {
      // Doc ID delta
      parts.push(encodeVarint(posting.docId - prevDocId))
      prevDocId = posting.docId

      // Position count
      parts.push(encodeVarint(posting.positions.length))

      // Positions with delta encoding
      let prevPos = 0
      for (const pos of posting.positions) {
        parts.push(encodeVarint(pos - prevPos))
        prevPos = pos
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
  static deserialize(bytes: Uint8Array): PositionalPostingList {
    const list = new PositionalPostingList()

    if (bytes.length === 0) {
      return list
    }

    // Validate magic
    for (let i = 0; i < POSITIONAL_POSTING_MAGIC.length; i++) {
      if (bytes[i] !== POSITIONAL_POSTING_MAGIC[i]) {
        throw new Error('Invalid positional posting list: magic mismatch')
      }
    }

    let offset = 4

    // Read document count
    const [docCount, docCountBytes] = decodeVarint(bytes, offset)
    offset += docCountBytes

    let prevDocId = 0

    for (let i = 0; i < docCount; i++) {
      // Read doc ID delta
      const [docIdDelta, docIdBytes] = decodeVarint(bytes, offset)
      offset += docIdBytes
      const docId = prevDocId + docIdDelta
      prevDocId = docId

      // Read position count
      const [posCount, posCountBytes] = decodeVarint(bytes, offset)
      offset += posCountBytes

      // Read positions
      let prevPos = 0
      for (let j = 0; j < posCount; j++) {
        const [posDelta, posBytes] = decodeVarint(bytes, offset)
        offset += posBytes
        const pos = prevPos + posDelta
        prevPos = pos
        list.add(docId, pos)
      }
    }

    return list
  }
}

// ============================================================================
// PhraseQuery
// ============================================================================

/**
 * Phrase query for exact or proximity phrase matching
 *
 * Matches documents where terms occur in sequence with optional slop.
 */
export class PhraseQuery {
  /** Ordered terms with their positional posting lists */
  private terms: Array<{ term: string; postings: PositionalPostingList }> = []

  /**
   * Add a term to the phrase (in order)
   */
  addTerm(term: string, postings: PositionalPostingList): this {
    this.terms.push({ term, postings })
    return this
  }

  /**
   * Search for documents containing the phrase
   *
   * @param slop - Maximum gap allowed between terms (default: 0 for exact match)
   * @returns Result with matching document IDs
   */
  search(slop: number = 0): PhraseQueryResult {
    if (this.terms.length === 0) {
      return { docIds: [] }
    }

    if (this.terms.length === 1) {
      // Single term - just return all docs containing it
      const docIds = this.terms[0].postings.getPostings().map((p) => p.docId)
      return { docIds }
    }

    // Find documents containing all terms
    const allDocIds = this.findCommonDocuments()
    if (allDocIds.length === 0) {
      return { docIds: [] }
    }

    // Check each document for phrase match
    const matchingDocs: number[] = []

    for (const docId of allDocIds) {
      if (this.checkPhraseMatch(docId, slop)) {
        matchingDocs.push(docId)
      }
    }

    return { docIds: matchingDocs }
  }

  /**
   * Search with position information for scoring
   */
  searchWithPositions(slop: number = 0): PhraseMatchResult[] {
    if (this.terms.length === 0) {
      return []
    }

    if (this.terms.length === 1) {
      // Single term - return all positions
      return this.terms[0].postings.getPostings().map((p) => ({
        docId: p.docId,
        matchPositions: p.positions,
        minDistance: 1,
      }))
    }

    // Find documents containing all terms
    const allDocIds = this.findCommonDocuments()
    if (allDocIds.length === 0) {
      return []
    }

    // Check each document and collect match info
    const results: PhraseMatchResult[] = []

    for (const docId of allDocIds) {
      const matchInfo = this.findPhraseMatches(docId, slop)
      if (matchInfo.matchPositions.length > 0) {
        results.push({
          docId,
          matchPositions: matchInfo.matchPositions,
          minDistance: matchInfo.minDistance,
        })
      }
    }

    return results
  }

  /**
   * Find documents that contain all terms
   */
  private findCommonDocuments(): number[] {
    if (this.terms.length === 0) return []

    // Start with smallest posting list for efficiency
    const sortedTerms = this.terms.slice().sort((a, b) => a.postings.cardinality - b.postings.cardinality)

    let commonDocs = new Set(sortedTerms[0].postings.getPostings().map((p) => p.docId))

    for (let i = 1; i < sortedTerms.length && commonDocs.size > 0; i++) {
      const otherDocs = new Set(sortedTerms[i].postings.getPostings().map((p) => p.docId))
      commonDocs = new Set([...commonDocs].filter((d) => otherDocs.has(d)))
    }

    return Array.from(commonDocs).sort((a, b) => a - b)
  }

  /**
   * Check if a document contains the phrase
   */
  private checkPhraseMatch(docId: number, slop: number): boolean {
    return this.findPhraseMatches(docId, slop).matchPositions.length > 0
  }

  /**
   * Find all phrase matches in a document
   */
  private findPhraseMatches(docId: number, slop: number): { matchPositions: number[]; minDistance: number } {
    const matchPositions: number[] = []
    let minDistance = Infinity

    // Get positions for first term
    const firstPositions = this.terms[0].postings.getPositions(docId)
    if (firstPositions.length === 0) {
      return { matchPositions: [], minDistance: this.terms.length }
    }

    // For each starting position, try to find a complete match
    for (const startPos of firstPositions) {
      let currentPosition = startPos
      let matched = true
      let totalDistance = 0

      for (let i = 1; i < this.terms.length; i++) {
        const termPositions = this.terms[i].postings.getPositions(docId)
        const expectedPos = currentPosition + 1 // Next term should be at current + 1

        // Find the best matching position for this term
        let foundPos = -1
        let bestGap = Infinity

        for (const pos of termPositions) {
          const gap = pos - expectedPos
          if (gap >= 0 && gap <= slop) {
            // Valid position within slop
            if (gap < bestGap) {
              bestGap = gap
              foundPos = pos
            }
          }
        }

        if (foundPos === -1) {
          matched = false
          break
        }

        totalDistance += foundPos - currentPosition
        currentPosition = foundPos
      }

      if (matched) {
        matchPositions.push(startPos)
        minDistance = Math.min(minDistance, totalDistance)
      }
    }

    if (matchPositions.length === 0) {
      minDistance = this.terms.length // Default for no match
    }

    return { matchPositions, minDistance }
  }

  /**
   * Create a phrase query from an array of terms
   *
   * @param terms - Ordered terms in the phrase
   * @param termPostings - Map of term to positional posting list
   * @throws Error if any term is missing from the postings map
   */
  static fromTerms(terms: string[], termPostings: Map<string, PositionalPostingList>): PhraseQuery {
    const query = new PhraseQuery()

    for (const term of terms) {
      const postings = termPostings.get(term)
      if (!postings) {
        throw new Error(`Term '${term}' not found in postings - missing term`)
      }
      query.addTerm(term, postings)
    }

    return query
  }
}
