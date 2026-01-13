/**
 * Highlighting Primitive - Span-aware text highlighting with fragment extraction
 *
 * A high-performance highlighting engine that extracts and highlights matching
 * text spans from documents. Designed for search result snippets with proper
 * context extraction and multi-term support.
 *
 * Features:
 * - Span-aware fragment extraction
 * - Multi-term highlighting
 * - Configurable pre/post tags
 * - HTML-safe encoding
 * - Phrase matching support
 * - Fragment merging for overlapping matches
 * - Position-based offset tracking
 *
 * @module search/primitives/highlighting
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Options for highlight operations
 */
export interface HighlightOptions {
  /** Opening tag(s) for highlights - multiple for multi-term coloring */
  preTags?: string[]
  /** Closing tag(s) for highlights - multiple for multi-term coloring */
  postTags?: string[]
  /** Target fragment size in characters (default: 150) */
  fragmentSize?: number
  /** Maximum number of fragments to return (default: 3) */
  numberOfFragments?: number
  /** Encoder for output: 'default' (no encoding) or 'html' (HTML entities) */
  encoder?: 'default' | 'html'
  /** Include ellipsis between fragments (default: true) */
  fragmentDelimiter?: string
  /** Break on sentence boundaries when possible (default: true) */
  breakOnSentences?: boolean
  /** Context characters to include before first match (default: 30) */
  contextBefore?: number
  /** Context characters to include after last match (default: 30) */
  contextAfter?: number
  /** Custom tokenizer function for query parsing */
  tokenizer?: (text: string) => string[]
  /** Enable phrase matching for quoted strings (default: true) */
  phraseMatching?: boolean
  /** Case-insensitive matching (default: true) */
  caseInsensitive?: boolean
  /** Require all terms to match (AND mode) or any term (OR mode) */
  matchMode?: 'all' | 'any'
}

/**
 * A single match span within the text
 */
export interface MatchSpan {
  /** Start offset in the original text (bytes) */
  offset: number
  /** Length of the match in bytes */
  length: number
  /** The matched text */
  text: string
  /** Index of the term that matched (for multi-term coloring) */
  termIndex: number
}

/**
 * Result of a highlight operation
 */
export interface HighlightResult {
  /** Array of highlighted fragment strings */
  fragments: string[]
  /** All match positions in the original document */
  matches: MatchSpan[]
  /** Total number of matches found */
  totalMatches: number
  /** The full highlighted text (if fragments requested = 0) */
  highlightedText?: string
}

/**
 * Fragment boundary information
 */
interface FragmentBoundary {
  start: number
  end: number
  matches: MatchSpan[]
  score: number
}

// ============================================================================
// Constants
// ============================================================================

/** Default fragment size in characters */
const DEFAULT_FRAGMENT_SIZE = 150

/** Default number of fragments */
const DEFAULT_NUMBER_OF_FRAGMENTS = 3

/** Default pre-tag for highlights */
const DEFAULT_PRE_TAG = '<em>'

/** Default post-tag for highlights */
const DEFAULT_POST_TAG = '</em>'

/** Default fragment delimiter */
const DEFAULT_FRAGMENT_DELIMITER = ' ... '

/** Default context before matches */
const DEFAULT_CONTEXT_BEFORE = 30

/** Default context after matches */
const DEFAULT_CONTEXT_AFTER = 30

/** Sentence ending characters for boundary detection */
const SENTENCE_ENDINGS = /[.!?]/

/** Word boundary regex */
const WORD_BOUNDARY = /\b/

// ============================================================================
// Utilities
// ============================================================================

/**
 * Default tokenizer - splits on whitespace, handles quotes for phrases
 */
function defaultTokenizer(text: string): string[] {
  const tokens: string[] = []
  const phraseRegex = /"([^"]+)"|'([^']+)'|(\S+)/g
  let match

  while ((match = phraseRegex.exec(text)) !== null) {
    const token = match[1] || match[2] || match[3]
    if (token && token.trim()) {
      tokens.push(token.trim())
    }
  }

  return tokens
}

/**
 * Escape special regex characters
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Encode HTML entities
 */
function encodeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

/**
 * Find the best word boundary near a position
 */
function findWordBoundary(text: string, pos: number, direction: 'before' | 'after'): number {
  if (direction === 'before') {
    // Look backward for whitespace or punctuation
    for (let i = pos; i >= 0; i--) {
      if (/\s/.test(text[i])) {
        return i + 1
      }
    }
    return 0
  } else {
    // Look forward for whitespace or punctuation
    for (let i = pos; i < text.length; i++) {
      if (/\s/.test(text[i])) {
        return i
      }
    }
    return text.length
  }
}

/**
 * Find a sentence boundary near a position
 */
function findSentenceBoundary(text: string, pos: number, direction: 'before' | 'after', maxSearch: number = 50): number {
  if (direction === 'before') {
    for (let i = pos; i >= Math.max(0, pos - maxSearch); i--) {
      if (SENTENCE_ENDINGS.test(text[i]) && i < pos - 1) {
        return i + 2 // After period and space
      }
    }
    return findWordBoundary(text, pos, direction)
  } else {
    for (let i = pos; i < Math.min(text.length, pos + maxSearch); i++) {
      if (SENTENCE_ENDINGS.test(text[i])) {
        return i + 1
      }
    }
    return findWordBoundary(text, pos, direction)
  }
}

// ============================================================================
// Core Implementation
// ============================================================================

/**
 * Find all matches for query terms in the text
 */
function findMatches(
  text: string,
  terms: string[],
  options: Required<Pick<HighlightOptions, 'caseInsensitive' | 'phraseMatching'>>
): MatchSpan[] {
  const matches: MatchSpan[] = []
  const flags = options.caseInsensitive ? 'gi' : 'g'

  for (let termIndex = 0; termIndex < terms.length; termIndex++) {
    const term = terms[termIndex]

    // Handle phrase matching (multi-word terms from quotes)
    const isPhrase = term.includes(' ')

    // Build regex pattern
    let pattern: string
    if (isPhrase && options.phraseMatching) {
      // For phrases, match the whole phrase with flexible whitespace
      pattern = term.split(/\s+/).map(escapeRegex).join('\\s+')
    } else {
      // For single words, match word boundaries
      pattern = `\\b${escapeRegex(term)}\\b`
    }

    try {
      const regex = new RegExp(pattern, flags)
      let match

      while ((match = regex.exec(text)) !== null) {
        matches.push({
          offset: match.index,
          length: match[0].length,
          text: match[0],
          termIndex,
        })

        // Prevent infinite loop on zero-length matches
        if (match[0].length === 0) {
          regex.lastIndex++
        }
      }
    } catch {
      // Invalid regex - try simple substring match
      const searchText = options.caseInsensitive ? text.toLowerCase() : text
      const searchTerm = options.caseInsensitive ? term.toLowerCase() : term
      let pos = 0

      while ((pos = searchText.indexOf(searchTerm, pos)) !== -1) {
        matches.push({
          offset: pos,
          length: term.length,
          text: text.substring(pos, pos + term.length),
          termIndex,
        })
        pos += 1
      }
    }
  }

  // Sort matches by offset, then by length (longer matches first for overlaps)
  matches.sort((a, b) => a.offset - b.offset || b.length - a.length)

  return matches
}

/**
 * Merge overlapping matches to avoid double-highlighting
 */
function mergeOverlappingMatches(matches: MatchSpan[]): MatchSpan[] {
  if (matches.length === 0) return []

  const merged: MatchSpan[] = []
  let current = { ...matches[0] }

  for (let i = 1; i < matches.length; i++) {
    const next = matches[i]

    // Check for overlap
    if (next.offset <= current.offset + current.length) {
      // Extend current match if needed
      const newEnd = Math.max(current.offset + current.length, next.offset + next.length)
      current.length = newEnd - current.offset
      current.text = current.text.substring(0, current.length) // Will be fixed when highlighting
      // Keep the earlier term index for coloring
    } else {
      merged.push(current)
      current = { ...next }
    }
  }

  merged.push(current)
  return merged
}

/**
 * Select best fragments containing matches
 */
function selectFragments(
  text: string,
  matches: MatchSpan[],
  options: Required<Pick<HighlightOptions, 'fragmentSize' | 'numberOfFragments' | 'breakOnSentences' | 'contextBefore' | 'contextAfter'>>
): FragmentBoundary[] {
  if (matches.length === 0) {
    return []
  }

  const { fragmentSize, numberOfFragments, breakOnSentences, contextBefore, contextAfter } = options
  const fragments: FragmentBoundary[] = []

  // Group matches that are close together
  const groups: MatchSpan[][] = []
  let currentGroup: MatchSpan[] = [matches[0]]

  for (let i = 1; i < matches.length; i++) {
    const prevEnd = currentGroup[currentGroup.length - 1].offset + currentGroup[currentGroup.length - 1].length
    const nextStart = matches[i].offset

    // If next match is within fragment size, add to current group
    if (nextStart - prevEnd < fragmentSize / 2) {
      currentGroup.push(matches[i])
    } else {
      groups.push(currentGroup)
      currentGroup = [matches[i]]
    }
  }
  groups.push(currentGroup)

  // Create fragment boundaries for each group
  for (const group of groups) {
    const firstMatch = group[0]
    const lastMatch = group[group.length - 1]

    // Calculate ideal fragment boundaries
    const matchCenter = (firstMatch.offset + lastMatch.offset + lastMatch.length) / 2
    let idealStart = Math.max(0, firstMatch.offset - contextBefore)
    let idealEnd = Math.min(text.length, lastMatch.offset + lastMatch.length + contextAfter)

    // Expand to fill fragment size if needed
    const currentSize = idealEnd - idealStart
    if (currentSize < fragmentSize) {
      const expand = (fragmentSize - currentSize) / 2
      idealStart = Math.max(0, idealStart - expand)
      idealEnd = Math.min(text.length, idealEnd + expand)
    }

    // Adjust to boundaries
    let start: number
    let end: number

    if (breakOnSentences) {
      start = findSentenceBoundary(text, idealStart, 'before')
      end = findSentenceBoundary(text, idealEnd, 'after')
    } else {
      start = findWordBoundary(text, idealStart, 'before')
      end = findWordBoundary(text, idealEnd, 'after')
    }

    // Ensure we don't exceed fragment size too much
    if (end - start > fragmentSize * 1.5) {
      start = findWordBoundary(text, Math.max(0, firstMatch.offset - contextBefore), 'before')
      end = findWordBoundary(text, Math.min(text.length, lastMatch.offset + lastMatch.length + contextAfter), 'after')
    }

    // Calculate score based on match density and uniqueness
    const matchedTerms = new Set(group.map(m => m.termIndex))
    const score = group.length * 10 + matchedTerms.size * 5

    fragments.push({ start, end, matches: group, score })
  }

  // Sort by score and take top N
  fragments.sort((a, b) => b.score - a.score)
  return fragments.slice(0, numberOfFragments)
}

/**
 * Apply highlighting to a text segment
 */
function applyHighlighting(
  text: string,
  textOffset: number,
  matches: MatchSpan[],
  preTags: string[],
  postTags: string[],
  encoder: 'default' | 'html'
): string {
  // Filter matches to those within this text segment
  const relevantMatches = matches.filter(
    m => m.offset >= textOffset && m.offset + m.length <= textOffset + text.length
  )

  if (relevantMatches.length === 0) {
    return encoder === 'html' ? encodeHtml(text) : text
  }

  // Build highlighted text
  let result = ''
  let lastEnd = 0

  for (const match of relevantMatches) {
    const localOffset = match.offset - textOffset

    // Add text before this match
    const beforeText = text.substring(lastEnd, localOffset)
    result += encoder === 'html' ? encodeHtml(beforeText) : beforeText

    // Add highlighted match with appropriate tag
    const tagIndex = match.termIndex % preTags.length
    const preTag = preTags[tagIndex]
    const postTag = postTags[tagIndex]
    const matchText = text.substring(localOffset, localOffset + match.length)
    const encodedMatch = encoder === 'html' ? encodeHtml(matchText) : matchText
    result += `${preTag}${encodedMatch}${postTag}`

    lastEnd = localOffset + match.length
  }

  // Add remaining text
  const afterText = text.substring(lastEnd)
  result += encoder === 'html' ? encodeHtml(afterText) : afterText

  return result
}

// ============================================================================
// Main API
// ============================================================================

/**
 * Highlighting engine for search result snippets
 *
 * @example
 * ```typescript
 * const highlighter = createHighlighting()
 *
 * const result = highlighter.highlight(
 *   'The quick brown fox jumps over the lazy dog',
 *   'quick fox',
 *   { preTags: ['<mark>'], postTags: ['</mark>'] }
 * )
 *
 * console.log(result.fragments[0])
 * // 'The <mark>quick</mark> brown <mark>fox</mark> jumps over the lazy dog'
 * ```
 */
export interface Highlighting {
  /**
   * Highlight matching terms in a document
   *
   * @param doc - The document text to highlight
   * @param query - The search query (space-separated terms, quotes for phrases)
   * @param options - Highlight options
   * @returns Highlight result with fragments and match positions
   */
  highlight(doc: string, query: string, options?: HighlightOptions): HighlightResult

  /**
   * Highlight multiple fields of a document
   *
   * @param doc - Object containing text fields
   * @param query - The search query
   * @param fields - Array of field names to highlight
   * @param options - Highlight options
   * @returns Map of field names to highlight results
   */
  highlightFields(
    doc: Record<string, string>,
    query: string,
    fields: string[],
    options?: HighlightOptions
  ): Record<string, HighlightResult>

  /**
   * Get match positions without generating highlighted text
   *
   * @param doc - The document text
   * @param query - The search query
   * @param options - Match options (tokenizer, caseInsensitive, phraseMatching)
   * @returns Array of match spans
   */
  getMatches(
    doc: string,
    query: string,
    options?: Pick<HighlightOptions, 'tokenizer' | 'caseInsensitive' | 'phraseMatching'>
  ): MatchSpan[]

  /**
   * Extract the best fragment from a document without highlighting
   *
   * @param doc - The document text
   * @param query - The search query
   * @param options - Fragment options
   * @returns Best matching fragment or null if no matches
   */
  extractFragment(
    doc: string,
    query: string,
    options?: Pick<HighlightOptions, 'fragmentSize' | 'breakOnSentences' | 'contextBefore' | 'contextAfter' | 'tokenizer' | 'caseInsensitive'>
  ): string | null
}

/**
 * Create a new Highlighting instance
 */
export function createHighlighting(): Highlighting {
  return {
    highlight(doc: string, query: string, options?: HighlightOptions): HighlightResult {
      const opts = {
        preTags: options?.preTags ?? [DEFAULT_PRE_TAG],
        postTags: options?.postTags ?? [DEFAULT_POST_TAG],
        fragmentSize: options?.fragmentSize ?? DEFAULT_FRAGMENT_SIZE,
        numberOfFragments: options?.numberOfFragments ?? DEFAULT_NUMBER_OF_FRAGMENTS,
        encoder: options?.encoder ?? 'default',
        fragmentDelimiter: options?.fragmentDelimiter ?? DEFAULT_FRAGMENT_DELIMITER,
        breakOnSentences: options?.breakOnSentences ?? true,
        contextBefore: options?.contextBefore ?? DEFAULT_CONTEXT_BEFORE,
        contextAfter: options?.contextAfter ?? DEFAULT_CONTEXT_AFTER,
        tokenizer: options?.tokenizer ?? defaultTokenizer,
        phraseMatching: options?.phraseMatching ?? true,
        caseInsensitive: options?.caseInsensitive ?? true,
        matchMode: options?.matchMode ?? 'any',
      }

      // Parse query into terms
      const terms = opts.tokenizer(query)
      if (terms.length === 0) {
        return {
          fragments: [],
          matches: [],
          totalMatches: 0,
        }
      }

      // Find all matches
      const allMatches = findMatches(doc, terms, {
        caseInsensitive: opts.caseInsensitive,
        phraseMatching: opts.phraseMatching,
      })

      // Check match mode (all terms must match)
      if (opts.matchMode === 'all') {
        const matchedTerms = new Set(allMatches.map(m => m.termIndex))
        if (matchedTerms.size < terms.length) {
          return {
            fragments: [],
            matches: [],
            totalMatches: 0,
          }
        }
      }

      // Merge overlapping matches
      const mergedMatches = mergeOverlappingMatches(allMatches)

      // Return full highlighted text if numberOfFragments is 0
      if (opts.numberOfFragments === 0) {
        const highlightedText = applyHighlighting(
          doc,
          0,
          mergedMatches,
          opts.preTags,
          opts.postTags,
          opts.encoder
        )

        return {
          fragments: [],
          matches: allMatches,
          totalMatches: allMatches.length,
          highlightedText,
        }
      }

      // Select best fragments
      const fragmentBoundaries = selectFragments(doc, mergedMatches, {
        fragmentSize: opts.fragmentSize,
        numberOfFragments: opts.numberOfFragments,
        breakOnSentences: opts.breakOnSentences,
        contextBefore: opts.contextBefore,
        contextAfter: opts.contextAfter,
      })

      // Sort fragments by document order for output
      fragmentBoundaries.sort((a, b) => a.start - b.start)

      // Generate highlighted fragments
      const fragments: string[] = []
      for (const boundary of fragmentBoundaries) {
        const fragmentText = doc.substring(boundary.start, boundary.end)

        // Apply highlighting to this fragment
        const highlighted = applyHighlighting(
          fragmentText,
          boundary.start,
          mergedMatches.filter(m =>
            m.offset >= boundary.start && m.offset + m.length <= boundary.end
          ),
          opts.preTags,
          opts.postTags,
          opts.encoder
        )

        // Add ellipsis if fragment doesn't start/end at document boundaries
        let fragment = highlighted
        if (boundary.start > 0) {
          fragment = '...' + fragment
        }
        if (boundary.end < doc.length) {
          fragment = fragment + '...'
        }

        fragments.push(fragment)
      }

      return {
        fragments,
        matches: allMatches,
        totalMatches: allMatches.length,
      }
    },

    highlightFields(
      doc: Record<string, string>,
      query: string,
      fields: string[],
      options?: HighlightOptions
    ): Record<string, HighlightResult> {
      const results: Record<string, HighlightResult> = {}

      for (const field of fields) {
        const value = doc[field]
        if (typeof value === 'string') {
          results[field] = this.highlight(value, query, options)
        } else {
          results[field] = {
            fragments: [],
            matches: [],
            totalMatches: 0,
          }
        }
      }

      return results
    },

    getMatches(
      doc: string,
      query: string,
      options?: Pick<HighlightOptions, 'tokenizer' | 'caseInsensitive' | 'phraseMatching'>
    ): MatchSpan[] {
      const tokenizer = options?.tokenizer ?? defaultTokenizer
      const caseInsensitive = options?.caseInsensitive ?? true
      const phraseMatching = options?.phraseMatching ?? true

      const terms = tokenizer(query)
      if (terms.length === 0) {
        return []
      }

      return findMatches(doc, terms, { caseInsensitive, phraseMatching })
    },

    extractFragment(
      doc: string,
      query: string,
      options?: Pick<HighlightOptions, 'fragmentSize' | 'breakOnSentences' | 'contextBefore' | 'contextAfter' | 'tokenizer' | 'caseInsensitive'>
    ): string | null {
      const tokenizer = options?.tokenizer ?? defaultTokenizer
      const caseInsensitive = options?.caseInsensitive ?? true
      const fragmentSize = options?.fragmentSize ?? DEFAULT_FRAGMENT_SIZE
      const breakOnSentences = options?.breakOnSentences ?? true
      const contextBefore = options?.contextBefore ?? DEFAULT_CONTEXT_BEFORE
      const contextAfter = options?.contextAfter ?? DEFAULT_CONTEXT_AFTER

      const terms = tokenizer(query)
      if (terms.length === 0) {
        return null
      }

      const matches = findMatches(doc, terms, { caseInsensitive, phraseMatching: true })
      if (matches.length === 0) {
        return null
      }

      const mergedMatches = mergeOverlappingMatches(matches)
      const fragments = selectFragments(doc, mergedMatches, {
        fragmentSize,
        numberOfFragments: 1,
        breakOnSentences,
        contextBefore,
        contextAfter,
      })

      if (fragments.length === 0) {
        return null
      }

      const boundary = fragments[0]
      let fragment = doc.substring(boundary.start, boundary.end)

      if (boundary.start > 0) {
        fragment = '...' + fragment
      }
      if (boundary.end < doc.length) {
        fragment = fragment + '...'
      }

      return fragment
    },
  }
}

// ============================================================================
// Factory Export
// ============================================================================

/**
 * Default export - create highlighting instance
 */
export default createHighlighting

// Re-export types
export type { HighlightOptions, MatchSpan, HighlightResult }
