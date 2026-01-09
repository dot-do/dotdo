/**
 * SearchStore - Full-text and semantic search
 *
 * Provides:
 * - Index/remove operations
 * - Text search
 * - Semantic search (with embeddings)
 */

import * as schema from '..'
import type {
  StoreContext,
  SearchStore as ISearchStore,
  SearchEntry,
  SearchResult,
  SearchQueryOptions,
} from './types'

interface AI {
  run(model: string, inputs: { text: string[] }): Promise<{ data: number[][] }>
}

export class SearchStore implements ISearchStore {
  private db: StoreContext['db']
  private ns: string
  private ai?: AI

  constructor(ctx: StoreContext) {
    this.db = ctx.db
    this.ns = ctx.ns
    this.ai = ctx.env.AI as AI | undefined
  }

  async index(entry: {
    $id: string
    $type: string
    content: string
  }): Promise<SearchEntry> {
    const now = new Date()

    // Generate embedding if AI is available
    let embedding: Buffer | null = null
    let embeddingDim: number | undefined

    if (this.ai) {
      try {
        const result = await this.ai.run('@cf/baai/bge-base-en-v1.5', {
          text: [entry.content],
        })
        if (result.data?.[0]) {
          const floatArray = new Float32Array(result.data[0])
          embedding = Buffer.from(floatArray.buffer)
          embeddingDim = result.data[0].length
        }
      } catch {
        // AI embedding failed, continue without it
      }
    }

    // Check if entry already exists
    const existing = await this.db.select().from(schema.search)
    const existingEntry = existing.find((e) => e.thingId === entry.$id)

    if (existingEntry) {
      // Update existing - Note: In production use proper Drizzle update
      // await this.db.update(schema.search)
      //   .set({ content: entry.content, embedding, indexedAt: now })
      //   .where(eq(schema.search.thingId, entry.$id))
    } else {
      await this.db.insert(schema.search).values({
        id: crypto.randomUUID(),
        thingId: entry.$id,
        content: entry.content,
        embedding: embedding as unknown as string | null,
        indexedAt: now,
      })
    }

    return {
      $id: entry.$id,
      $type: entry.$type,
      content: entry.content,
      embedding,
      embeddingDim,
      indexedAt: now,
    }
  }

  async indexMany(
    entries: { $id: string; $type: string; content: string }[]
  ): Promise<SearchEntry[]> {
    const results: SearchEntry[] = []
    for (const entry of entries) {
      results.push(await this.index(entry))
    }
    return results
  }

  async remove(id: string): Promise<void> {
    // Note: In production use proper Drizzle delete
    // await this.db.delete(schema.search).where(eq(schema.search.thingId, id))
  }

  async removeMany(ids: string[]): Promise<number> {
    for (const id of ids) {
      await this.remove(id)
    }
    return ids.length
  }

  async query(text: string, options?: SearchQueryOptions): Promise<SearchResult[]> {
    const limit = options?.limit ?? 10
    const results = await this.db.select().from(schema.search)

    // Simple text matching (in production, use FTS5 or similar)
    const searchTerms = text.toLowerCase().split(/\s+/)
    const scored = results
      .map((r) => {
        const content = r.content.toLowerCase()
        let score = 0
        for (const term of searchTerms) {
          if (content.includes(term)) {
            score += 1
          }
        }
        return { row: r, score }
      })
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)

    return scored.map((s) => ({
      $id: s.row.thingId,
      $type: options?.type ?? 'unknown',
      content: s.row.content,
      embedding: s.row.embedding as unknown as Buffer | null,
      indexedAt: s.row.indexedAt,
      score: s.score,
    }))
  }

  async semantic(text: string, options?: SearchQueryOptions): Promise<SearchResult[]> {
    if (!this.ai) {
      // Fall back to text search if no AI
      return this.query(text, options)
    }

    const limit = options?.limit ?? 10

    // Generate query embedding
    let queryEmbedding: number[]
    try {
      const result = await this.ai.run('@cf/baai/bge-base-en-v1.5', {
        text: [text],
      })
      if (!result.data?.[0]) {
        return this.query(text, options)
      }
      queryEmbedding = result.data[0]
    } catch {
      return this.query(text, options)
    }

    // Get all entries with embeddings
    const results = await this.db.select().from(schema.search)
    const withEmbeddings = results.filter((r) => r.embedding)

    // Calculate cosine similarity
    const scored = withEmbeddings
      .map((r) => {
        const embedding = new Float32Array(
          (r.embedding as unknown as Buffer).buffer
        )
        const score = this.cosineSimilarity(queryEmbedding, Array.from(embedding))
        return { row: r, score }
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)

    return scored.map((s) => ({
      $id: s.row.thingId,
      $type: options?.type ?? 'unknown',
      content: s.row.content,
      embedding: s.row.embedding as unknown as Buffer | null,
      indexedAt: s.row.indexedAt,
      score: s.score,
    }))
  }

  async reindexType(type: string): Promise<number> {
    // This would re-index all things of a given type
    // Implementation would depend on having access to ThingsStore
    return 0
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0

    let dotProduct = 0
    let normA = 0
    let normB = 0

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i]
      normA += a[i] * a[i]
      normB += b[i] * b[i]
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB)
    if (denominator === 0) return 0

    return dotProduct / denominator
  }
}
