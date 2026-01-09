/**
 * Search Module
 *
 * Provides search functionality for documentation:
 * - Full-text search across all docs
 * - Fuzzy matching support
 * - Result highlighting
 * - Snippet generation
 */

import { getSearchIndex, type SearchDocument } from './search-index'

/**
 * Search result structure
 */
export interface SearchResult {
  title: string
  url: string
  snippet: string
  score: number
  description?: string
}

/**
 * Normalize text for search
 */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Calculate relevance score
 */
function calculateScore(doc: SearchDocument, terms: string[]): number {
  let score = 0
  const normalizedTitle = normalize(doc.title)
  const normalizedContent = normalize(doc.content)
  const normalizedDescription = doc.description ? normalize(doc.description) : ''

  for (const term of terms) {
    const normalizedTerm = normalize(term)

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
    }

    // Description match (medium priority)
    if (normalizedDescription.includes(normalizedTerm)) {
      score += 5
    }

    // Content match (lower priority but still important)
    if (normalizedContent.includes(normalizedTerm)) {
      score += 2
      // Count occurrences (capped)
      const regex = new RegExp(normalizedTerm, 'gi')
      const matches = normalizedContent.match(regex)
      if (matches) {
        score += Math.min(matches.length, 10) * 0.5
      }
    }

    // Heading match
    if (doc.headings) {
      for (const heading of doc.headings) {
        if (normalize(heading).includes(normalizedTerm)) {
          score += 3
        }
      }
    }

    // Tag match
    if (doc.tags) {
      for (const tag of doc.tags) {
        if (normalize(tag) === normalizedTerm) {
          score += 8
        }
      }
    }
  }

  return score
}

/**
 * Generate snippet with highlighted terms
 */
function generateSnippet(content: string, terms: string[], maxLength: number = 150): string {
  if (!content) return ''

  const normalizedContent = content.toLowerCase()
  let bestStart = 0
  let bestScore = 0

  // Find the best starting position for the snippet
  for (const term of terms) {
    const normalizedTerm = term.toLowerCase()
    let index = normalizedContent.indexOf(normalizedTerm)

    while (index !== -1) {
      // Score this position based on proximity to term
      const score = 1 / (index + 1)
      if (score > bestScore) {
        bestScore = score
        bestStart = Math.max(0, index - 30)
      }
      index = normalizedContent.indexOf(normalizedTerm, index + 1)
    }
  }

  // Extract snippet around the best position
  let start = bestStart
  let end = Math.min(content.length, start + maxLength)

  // Adjust to word boundaries
  if (start > 0) {
    const spaceIndex = content.indexOf(' ', start)
    if (spaceIndex !== -1 && spaceIndex - start < 20) {
      start = spaceIndex + 1
    }
  }

  const lastSpace = content.lastIndexOf(' ', end)
  if (lastSpace > start && end - lastSpace < 20) {
    end = lastSpace
  }

  let snippet = content.slice(start, end)

  // Add ellipsis
  if (start > 0) {
    snippet = '...' + snippet
  }
  if (end < content.length) {
    snippet = snippet + '...'
  }

  // Highlight matching terms
  for (const term of terms) {
    const regex = new RegExp(`(${escapeRegExp(term)})`, 'gi')
    snippet = snippet.replace(regex, '<mark>$1</mark>')
  }

  return snippet
}

/**
 * Escape special regex characters
 */
function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Search documentation
 */
export function searchDocs(query: string, limit: number = 10): SearchResult[] {
  if (!query || query.trim().length === 0) {
    return []
  }

  const index = getSearchIndex()
  const terms = query.trim().split(/\s+/).filter(t => t.length > 0)

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
  return scoredDocs.slice(0, limit).map(({ doc, score }) => ({
    title: doc.title,
    url: doc.url,
    snippet: generateSnippet(doc.content, terms),
    score,
    description: doc.description,
  }))
}

/**
 * Get search suggestions based on query
 */
export function getSearchSuggestions(query: string, limit: number = 5): string[] {
  if (!query || query.trim().length < 2) {
    return []
  }

  const index = getSearchIndex()
  const normalizedQuery = normalize(query)
  const suggestions: Set<string> = new Set()

  // Collect titles and headings that match
  for (const doc of index.documents) {
    if (suggestions.size >= limit) break

    // Check title
    if (normalize(doc.title).includes(normalizedQuery)) {
      suggestions.add(doc.title)
    }

    // Check headings
    if (doc.headings) {
      for (const heading of doc.headings) {
        if (suggestions.size >= limit) break
        if (normalize(heading).includes(normalizedQuery)) {
          suggestions.add(heading)
        }
      }
    }
  }

  return Array.from(suggestions).slice(0, limit)
}
