/**
 * Orama Search Client
 *
 * Provides a client-side search interface using Orama for full-text search:
 * - Client initialization from search index
 * - Full-text search with fuzzy matching
 * - Result highlighting
 * - Faceted search support
 * - Search options (limit, offset, boost)
 */

import { getSearchIndex, type SearchDocument } from '../docs/search-index'

/**
 * Search result structure
 */
export interface SearchResult {
  id: string
  title: string
  url: string
  description: string
  score: number
  highlights?: {
    title?: string
    description?: string
  }
}

/**
 * Search options
 */
export interface SearchOptions {
  limit?: number
  offset?: number
  boost?: Record<string, number>
  facets?: Record<string, boolean>
}

/**
 * Search response with facets
 */
export interface SearchResponse {
  results: SearchResult[]
  facets?: Record<string, Record<string, number>>
}

/**
 * Escape special regex characters
 */
function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Calculate Levenshtein distance for fuzzy matching
 */
function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = []

  // Initialize matrix
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i]
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j
  }

  // Fill matrix
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1]
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1, // insertion
          matrix[i - 1][j] + 1 // deletion
        )
      }
    }
  }

  return matrix[b.length][a.length]
}

/**
 * Check if a term matches with typo tolerance
 */
function fuzzyMatch(term: string, text: string, tolerance: number = 2): boolean {
  const normalizedTerm = term.toLowerCase()
  const normalizedText = text.toLowerCase()

  // Exact match
  if (normalizedText.includes(normalizedTerm)) {
    return true
  }

  // Check each word in the text
  const words = normalizedText.split(/\s+/)
  for (const word of words) {
    // Only check words of similar length
    if (Math.abs(word.length - normalizedTerm.length) <= tolerance) {
      const distance = levenshteinDistance(normalizedTerm, word)
      if (distance <= tolerance) {
        return true
      }
    }
  }

  return false
}

/**
 * Calculate relevance score
 */
function calculateScore(
  doc: SearchDocument,
  terms: string[],
  boost: Record<string, number> = {}
): number {
  let score = 0
  const titleBoost = boost.title ?? 2
  const descriptionBoost = boost.description ?? 1
  const contentBoost = boost.content ?? 0.5

  const normalizedTitle = doc.title.toLowerCase()
  const normalizedDescription = doc.description?.toLowerCase() || ''
  const normalizedContent = doc.content?.toLowerCase() || ''

  for (const term of terms) {
    const normalizedTerm = term.toLowerCase()

    // Title match (highest priority)
    if (normalizedTitle.includes(normalizedTerm)) {
      score += 10 * titleBoost
      // Exact title match
      if (normalizedTitle === normalizedTerm) {
        score += 20 * titleBoost
      }
      // Title starts with term
      if (normalizedTitle.startsWith(normalizedTerm)) {
        score += 5 * titleBoost
      }
    } else if (fuzzyMatch(normalizedTerm, normalizedTitle)) {
      score += 5 * titleBoost
    }

    // Description match (medium priority)
    if (normalizedDescription.includes(normalizedTerm)) {
      score += 5 * descriptionBoost
    } else if (fuzzyMatch(normalizedTerm, normalizedDescription)) {
      score += 2 * descriptionBoost
    }

    // Content match (lower priority but still important)
    if (normalizedContent.includes(normalizedTerm)) {
      score += 2 * contentBoost
      // Count occurrences (capped)
      const regex = new RegExp(escapeRegExp(normalizedTerm), 'gi')
      const matches = normalizedContent.match(regex)
      if (matches) {
        score += Math.min(matches.length, 10) * 0.5 * contentBoost
      }
    } else if (fuzzyMatch(normalizedTerm, normalizedContent)) {
      score += 1 * contentBoost
    }

    // Heading match
    if (doc.headings) {
      for (const heading of doc.headings) {
        if (heading.toLowerCase().includes(normalizedTerm)) {
          score += 3
        }
      }
    }

    // Tag match
    if (doc.tags) {
      for (const tag of doc.tags) {
        if (tag.toLowerCase() === normalizedTerm) {
          score += 8
        }
      }
    }
  }

  return score
}

/**
 * Highlight matching terms in text
 */
function highlightTerms(text: string, terms: string[]): string {
  if (!text) return ''

  let highlighted = text
  for (const term of terms) {
    const regex = new RegExp(`(${escapeRegExp(term)})`, 'gi')
    highlighted = highlighted.replace(regex, '<mark>$1</mark>')
  }
  return highlighted
}

/**
 * Generate facets from results
 */
function generateFacets(
  docs: SearchDocument[],
  facetConfig: Record<string, boolean>
): Record<string, Record<string, number>> {
  const facets: Record<string, Record<string, number>> = {}

  if (facetConfig.category) {
    facets.category = {}
    for (const doc of docs) {
      // Extract category from URL path
      const match = doc.url.match(/^\/docs\/([^/]+)/)
      const category = match ? match[1] : 'other'
      facets.category[category] = (facets.category[category] || 0) + 1
    }
  }

  return facets
}

/**
 * Search client interface
 */
export interface SearchClient {
  search(query: string, options?: SearchOptions): Promise<SearchResult[] | SearchResponse>
}

/**
 * Create a search client instance
 */
export async function createSearchClient(): Promise<SearchClient> {
  const index = getSearchIndex()

  return {
    async search(query: string, options: SearchOptions = {}): Promise<SearchResult[] | SearchResponse> {
      const { limit = 20, offset = 0, boost = {}, facets: facetConfig } = options

      if (!query || query.trim().length === 0) {
        return facetConfig ? { results: [], facets: {} } : []
      }

      const terms = query.trim().split(/\s+/).filter((t) => t.length > 0)

      // Score all documents
      const scoredDocs: Array<{ doc: SearchDocument; score: number }> = []

      for (const doc of index.documents) {
        const score = calculateScore(doc, terms, boost)
        if (score > 0) {
          scoredDocs.push({ doc, score })
        }
      }

      // Sort by score descending
      scoredDocs.sort((a, b) => b.score - a.score)

      // Apply pagination
      const paginatedDocs = scoredDocs.slice(offset, offset + limit)

      // Convert to search results
      const results: SearchResult[] = paginatedDocs.map(({ doc, score }) => ({
        id: doc.id,
        title: doc.title,
        url: doc.url,
        description: doc.description || '',
        score,
        highlights: {
          title: highlightTerms(doc.title, terms),
          description: highlightTerms(doc.description || '', terms),
        },
      }))

      // Return with facets if requested
      if (facetConfig) {
        const matchedDocs = scoredDocs.map((sd) => sd.doc)
        return {
          results,
          facets: generateFacets(matchedDocs, facetConfig),
        }
      }

      return results
    },
  }
}

export default createSearchClient
