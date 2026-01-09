/**
 * Search API Handler
 *
 * Handles search requests for documentation:
 * - Full-text search with fuzzy matching
 * - Result ranking and highlighting
 * - Typo tolerance
 * - Pagination support
 */

import { getSearchIndex, type SearchDocument } from '../lib/docs/search-index'

/**
 * Search result structure
 */
export interface SearchResult {
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
 * Search response structure
 */
export interface SearchResponse {
  results: SearchResult[]
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

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i]
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1]
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
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

  // Exact substring match
  if (normalizedText.includes(normalizedTerm)) {
    return true
  }

  // Prefix match
  const words = normalizedText.split(/\s+/)
  for (const word of words) {
    if (word.startsWith(normalizedTerm)) {
      return true
    }
  }

  // Fuzzy match with Levenshtein distance
  for (const word of words) {
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
 * Calculate relevance score for a document
 */
function calculateScore(doc: SearchDocument, terms: string[]): number {
  let score = 0
  const normalizedTitle = doc.title.toLowerCase()
  const normalizedDescription = doc.description?.toLowerCase() || ''
  const normalizedContent = doc.content?.toLowerCase() || ''

  for (const term of terms) {
    const normalizedTerm = term.toLowerCase()

    // Title match (highest priority)
    if (normalizedTitle.includes(normalizedTerm)) {
      score += 10
      // Exact title match
      if (normalizedTitle === normalizedTerm) {
        score += 20
      }
      // Title starts with term
      if (normalizedTitle.startsWith(normalizedTerm)) {
        score += 5
      }
    } else if (fuzzyMatch(normalizedTerm, normalizedTitle)) {
      score += 5
    }

    // Description match (medium priority)
    if (normalizedDescription.includes(normalizedTerm)) {
      score += 5
    } else if (fuzzyMatch(normalizedTerm, normalizedDescription)) {
      score += 2
    }

    // Content match (lower priority but still important)
    if (normalizedContent.includes(normalizedTerm)) {
      score += 2
      const regex = new RegExp(escapeRegExp(normalizedTerm), 'gi')
      const matches = normalizedContent.match(regex)
      if (matches) {
        score += Math.min(matches.length, 10) * 0.5
      }
    } else if (fuzzyMatch(normalizedTerm, normalizedContent)) {
      score += 1
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
 * Handle search requests
 */
export async function searchHandler(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const query = url.searchParams.get('q') || ''

  // Empty query returns empty results
  if (!query || query.trim().length === 0) {
    return new Response(JSON.stringify({ results: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const index = getSearchIndex()
  const terms = query.trim().split(/\s+/).filter((t) => t.length > 0)

  // Score all documents
  const scoredDocs: Array<{ doc: SearchDocument; score: number }> = []

  for (const doc of index.documents) {
    const score = calculateScore(doc, terms)
    if (score > 0) {
      scoredDocs.push({ doc, score })
    }
  }

  // Sort by score descending
  scoredDocs.sort((a, b) => b.score - a.score)

  // Convert to search results
  const results: SearchResult[] = scoredDocs.map(({ doc, score }) => ({
    title: doc.title,
    url: doc.url,
    description: doc.description || '',
    score,
    highlights: {
      title: highlightTerms(doc.title, terms),
      description: highlightTerms(doc.description || '', terms),
    },
  }))

  return new Response(JSON.stringify({ results }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

export default searchHandler
