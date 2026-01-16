/**
 * Fumadocs Search API Route
 *
 * Provides full-text search for documentation pages.
 * Uses the 'advanced' search mode for heading-level results.
 *
 * @see https://fumadocs.dev/docs/headless/search
 * @see https://fumadocs.dev/docs/headless/search/server
 */

import { createSearchAPI, type AdvancedIndex } from 'fumadocs-core/search/server'
import { source } from '../../lib/source'

/**
 * Build search indexes from documentation pages.
 * Includes structured data for advanced search features.
 */
function buildSearchIndexes(): AdvancedIndex[] {
  return source.getPages().map((page) => {
    // Convert our StructuredData format to fumadocs AdvancedIndex format
    const sourceData = page.data.structuredData
    const structuredData = {
      headings: sourceData?.headings ?? [],
      contents: typeof sourceData?.contents === 'string'
        ? [{ heading: undefined, content: sourceData.contents }]
        : [],
    }

    return {
      title: page.data.title,
      description: page.data.description,
      url: page.url,
      id: page.url,
      structuredData,
    }
  })
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
