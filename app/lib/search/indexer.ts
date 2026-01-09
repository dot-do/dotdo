/**
 * Search Index Generator
 *
 * Generates search indexes from documentation content:
 * - Content extraction from documents
 * - Index serialization for static export
 * - Build-time index generation
 */

export interface IndexDocument {
  id: string
  title: string
  url: string
  description: string
  content: string
}

export interface SearchIndex {
  documents: IndexDocument[]
  version: string
  generatedAt: string
}

/**
 * Generate a search index from content documents
 *
 * @param content - Array of documents to index
 * @returns Search index object
 */
export async function generateSearchIndex(content: IndexDocument[]): Promise<SearchIndex> {
  const documents = content.map((doc) => ({
    id: doc.id,
    title: doc.title,
    url: doc.url,
    description: doc.description || '',
    content: doc.content || '',
  }))

  return {
    documents,
    version: '1.0.0',
    generatedAt: new Date().toISOString(),
  }
}

/**
 * Serialize search index to JSON string
 *
 * @param index - Search index to serialize
 * @returns JSON string representation
 */
export function serializeIndex(index: SearchIndex): string {
  return JSON.stringify(index)
}

/**
 * Deserialize JSON string to search index
 *
 * @param json - JSON string to deserialize
 * @returns Search index object
 */
export function deserializeIndex(json: string): SearchIndex {
  return JSON.parse(json) as SearchIndex
}

export default generateSearchIndex
