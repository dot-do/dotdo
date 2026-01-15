/**
 * Fumadocs Search API Route
 *
 * Provides full-text search for documentation pages.
 * Uses the 'advanced' search mode for heading-level results.
 *
 * @see https://fumadocs.dev/docs/headless/search
 * @see https://fumadocs.dev/docs/headless/search/server
 */

import { createSearchAPI } from 'fumadocs-core/search/server'
import { source, type DocsPageData } from '../../lib/source'

/**
 * Search index entry type for type safety.
 */
interface SearchIndex {
  /** Page title */
  title: string
  /** Page description for preview */
  description?: string
  /** Page URL path */
  url: string
  /** Unique identifier (uses URL) */
  id: string
  /** Structured data for heading-level search */
  structuredData?: DocsPageData['structuredData']
}

/**
 * Build search indexes from documentation pages.
 * Includes structured data for advanced search features.
 */
function buildSearchIndexes(): SearchIndex[] {
  return source.getPages().map((page) => ({
    title: page.data.title,
    description: page.data.description,
    url: page.url,
    id: page.url,
    structuredData: page.data.structuredData,
  }))
}

/**
 * GET handler for search requests.
 *
 * Query parameters:
 * - query: Search query string
 * - locale: Optional locale for multi-language support
 *
 * Response format (advanced mode):
 * - Returns matches at page and heading level
 * - Includes URL with heading anchors for deep linking
 *
 * @example
 * GET /api/search?query=workflow
 */
export const { GET } = createSearchAPI('advanced', {
  indexes: buildSearchIndexes(),
})
