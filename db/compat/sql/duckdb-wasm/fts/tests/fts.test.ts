/**
 * DuckDB FTS (Full Text Search) Extension Tests
 *
 * TDD RED phase tests for the FTS wrapper. These tests define the API contract
 * for full text search functionality using DuckDB's FTS extension.
 *
 * Test Categories:
 * 1. Index Creation - Create FTS indexes on tables
 * 2. Basic Search - BM25 ranking text search
 * 3. Multi-Column Search - Search across multiple columns
 * 4. Stemmer Support - Different language stemmers
 * 5. Index Rebuild - Manual reindex after data changes
 * 6. Error Handling - Extension loading, invalid queries
 *
 * @see https://duckdb.org/docs/extensions/full_text_search
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'

import {
  createDuckDB,
  type DuckDBInstance,
} from '../../index'

import {
  createFTSIndex,
  dropFTSIndex,
  search,
  rebuildIndex,
  listIndexes,
  type FTSIndexConfig,
  type FTSSearchOptions,
  type FTSSearchResult,
  type FTSCreateResult,
  type StemmerLanguage,
} from '../index'

// ============================================================================
// TEST SETUP
// ============================================================================

describe('DuckDB FTS (Full Text Search) Extension', () => {
  let db: DuckDBInstance

  beforeAll(async () => {
    db = await createDuckDB()

    // Create test tables
    await db.query(`
      CREATE TABLE articles (
        id INTEGER PRIMARY KEY,
        title VARCHAR NOT NULL,
        body TEXT,
        author VARCHAR,
        category VARCHAR,
        published_at TIMESTAMP
      )
    `)

    await db.query(`
      INSERT INTO articles VALUES
        (1, 'Introduction to Machine Learning', 'Machine learning is a subset of artificial intelligence that enables systems to learn and improve from experience.', 'Alice', 'tech', '2024-01-01'),
        (2, 'Deep Learning Fundamentals', 'Deep learning uses neural networks with multiple layers to model complex patterns in data.', 'Bob', 'tech', '2024-01-02'),
        (3, 'Natural Language Processing', 'NLP combines linguistics and machine learning to help computers understand human language.', 'Alice', 'tech', '2024-01-03'),
        (4, 'Cooking with Mediterranean Spices', 'Mediterranean cuisine features aromatic spices like oregano, thyme, and rosemary.', 'Charlie', 'food', '2024-01-04'),
        (5, 'The Art of French Cooking', 'French cuisine emphasizes technique and quality ingredients in creating delicious meals.', 'Diana', 'food', '2024-01-05'),
        (6, 'Running for Beginners', 'Starting a running routine requires proper shoes, gradual progression, and rest days.', 'Eve', 'fitness', '2024-01-06'),
        (7, 'Weight Training Basics', 'Strength training builds muscle and improves metabolism through resistance exercises.', 'Frank', 'fitness', '2024-01-07'),
        (8, 'The Future of AI', 'Artificial intelligence will transform industries from healthcare to transportation.', 'Alice', 'tech', '2024-01-08')
    `)
  })

  afterAll(async () => {
    if (db) {
      await db.query('DROP TABLE IF EXISTS articles')
      await db.close()
    }
  })

  // ============================================================================
  // 1. INDEX CREATION
  // ============================================================================

  describe('Index Creation', () => {
    afterEach(async () => {
      // Clean up any created indexes
      try {
        await dropFTSIndex(db, 'articles')
      } catch {
        // Ignore if index doesn't exist
      }
    })

    it('should create FTS index on single column', async () => {
      const result = await createFTSIndex(db, {
        table: 'articles',
        columns: 'title',
      })

      expect(result.success).toBe(true)
      expect(result.table).toBe('articles')
      expect(result.columns).toEqual(['title'])
      expect(result.documentCount).toBe(8)
      expect(result.createTimeMs).toBeGreaterThan(0)
    })

    it('should create FTS index on multiple columns', async () => {
      const result = await createFTSIndex(db, {
        table: 'articles',
        columns: ['title', 'body'],
      })

      expect(result.success).toBe(true)
      expect(result.columns).toEqual(['title', 'body'])
    })

    it('should create FTS index with custom name', async () => {
      const result = await createFTSIndex(db, {
        table: 'articles',
        columns: 'title',
        indexName: 'articles_title_search',
      })

      expect(result.success).toBe(true)
      expect(result.indexName).toBe('articles_title_search')
    })

    it('should create FTS index with custom stemmer', async () => {
      const result = await createFTSIndex(db, {
        table: 'articles',
        columns: 'title',
        stemmer: 'english',
      })

      expect(result.success).toBe(true)
    })

    it('should create FTS index with porter stemmer', async () => {
      const result = await createFTSIndex(db, {
        table: 'articles',
        columns: 'title',
        stemmer: 'porter',
      })

      expect(result.success).toBe(true)
    })

    it('should create FTS index without stemming', async () => {
      const result = await createFTSIndex(db, {
        table: 'articles',
        columns: 'title',
        stemmer: 'none',
      })

      expect(result.success).toBe(true)
    })

    it('should fail to create duplicate index without overwrite', async () => {
      await createFTSIndex(db, { table: 'articles', columns: 'title' })

      await expect(
        createFTSIndex(db, { table: 'articles', columns: 'title', overwrite: false })
      ).rejects.toThrow()
    })

    it('should overwrite existing index when overwrite=true', async () => {
      await createFTSIndex(db, { table: 'articles', columns: 'title' })

      const result = await createFTSIndex(db, {
        table: 'articles',
        columns: ['title', 'body'],
        overwrite: true,
      })

      expect(result.success).toBe(true)
      expect(result.columns).toEqual(['title', 'body'])
    })

    it('should fail for non-existent table', async () => {
      await expect(
        createFTSIndex(db, { table: 'nonexistent_table', columns: 'title' })
      ).rejects.toThrow()
    })

    it('should fail for non-existent column', async () => {
      await expect(
        createFTSIndex(db, { table: 'articles', columns: 'nonexistent_column' })
      ).rejects.toThrow()
    })

    it('should create FTS index with custom doc ID column', async () => {
      const result = await createFTSIndex(db, {
        table: 'articles',
        columns: 'title',
        docIdColumn: 'id',
      })

      expect(result.success).toBe(true)
    })
  })

  // ============================================================================
  // 2. BASIC TEXT SEARCH WITH BM25 RANKING
  // ============================================================================

  describe('Basic Text Search', () => {
    beforeAll(async () => {
      await createFTSIndex(db, {
        table: 'articles',
        columns: ['title', 'body'],
        stemmer: 'porter',
      })
    })

    afterAll(async () => {
      await dropFTSIndex(db, 'articles')
    })

    it('should search for single term', async () => {
      const results = await search(db, 'articles', 'learning')

      expect(results.results.length).toBeGreaterThan(0)
      expect(results.totalCount).toBeGreaterThan(0)
      expect(results.query).toBe('learning')
    })

    it('should return results with BM25 scores', async () => {
      const results = await search(db, 'articles', 'machine learning')

      expect(results.results.length).toBeGreaterThan(0)
      results.results.forEach((result) => {
        expect(result.score).toBeGreaterThan(0)
        expect(typeof result.docId).toBe('number')
        expect(result.document).toBeDefined()
      })
    })

    it('should order results by relevance (highest score first)', async () => {
      const results = await search(db, 'articles', 'machine learning')

      const scores = results.results.map((r) => r.score)
      const sortedScores = [...scores].sort((a, b) => b - a)
      expect(scores).toEqual(sortedScores)
    })

    it('should search for multiple terms', async () => {
      const results = await search(db, 'articles', 'artificial intelligence')

      expect(results.results.length).toBeGreaterThan(0)
      expect(results.searchTerms).toContain('artificial')
      expect(results.searchTerms).toContain('intelligence')
    })

    it('should respect limit option', async () => {
      const results = await search(db, 'articles', 'learning', { limit: 2 })

      expect(results.results.length).toBeLessThanOrEqual(2)
    })

    it('should support pagination with offset', async () => {
      const firstPage = await search(db, 'articles', 'learning', { limit: 2, offset: 0 })
      const secondPage = await search(db, 'articles', 'learning', { limit: 2, offset: 2 })

      // Results should be different (unless there are fewer than 3 results)
      if (firstPage.totalCount > 2) {
        expect(firstPage.results[0].docId).not.toBe(secondPage.results[0]?.docId)
      }
    })

    it('should filter results by minimum score', async () => {
      const allResults = await search(db, 'articles', 'learning')
      const filteredResults = await search(db, 'articles', 'learning', { minScore: 0.5 })

      filteredResults.results.forEach((result) => {
        expect(result.score).toBeGreaterThanOrEqual(0.5)
      })
    })

    it('should return empty results for no matches', async () => {
      const results = await search(db, 'articles', 'xyznonexistentterm123')

      expect(results.results).toHaveLength(0)
      expect(results.totalCount).toBe(0)
    })

    it('should include query execution time', async () => {
      const results = await search(db, 'articles', 'learning')

      expect(results.queryTimeMs).toBeGreaterThanOrEqual(0)
    })

    it('should return maxScore in results', async () => {
      const results = await search(db, 'articles', 'machine learning')

      expect(results.maxScore).toBeGreaterThan(0)
      expect(results.maxScore).toBe(results.results[0]?.score || 0)
    })

    it('should handle quoted phrases', async () => {
      const results = await search(db, 'articles', '"machine learning"')

      // Phrase search should find documents with exact phrase
      expect(results.results.length).toBeGreaterThan(0)
    })

    it('should handle boolean AND operator', async () => {
      const results = await search(db, 'articles', 'machine AND intelligence')

      // Should only return docs containing both terms
      results.results.forEach((result) => {
        const text = JSON.stringify(result.document).toLowerCase()
        expect(text).toContain('machine')
        expect(text).toContain('intelligen') // May be stemmed
      })
    })

    it('should handle boolean OR operator', async () => {
      const results = await search(db, 'articles', 'cooking OR fitness')

      expect(results.results.length).toBeGreaterThan(0)
    })

    it('should handle boolean NOT operator', async () => {
      const results = await search(db, 'articles', 'learning NOT deep')

      // Should return learning docs but not deep learning
      results.results.forEach((result) => {
        const title = (result.document as { title?: string }).title?.toLowerCase() || ''
        expect(title).not.toContain('deep')
      })
    })
  })

  // ============================================================================
  // 3. MULTI-COLUMN SEARCH
  // ============================================================================

  describe('Multi-Column Search', () => {
    beforeAll(async () => {
      await createFTSIndex(db, {
        table: 'articles',
        columns: ['title', 'body', 'author'],
      })
    })

    afterAll(async () => {
      await dropFTSIndex(db, 'articles')
    })

    it('should search across multiple columns', async () => {
      // 'Alice' appears in author column
      const results = await search(db, 'articles', 'Alice')

      expect(results.results.length).toBeGreaterThan(0)
      const authorAlice = results.results.some(
        (r) => (r.document as { author?: string }).author === 'Alice'
      )
      expect(authorAlice).toBe(true)
    })

    it('should find matches in body column', async () => {
      // 'neural networks' appears only in body
      const results = await search(db, 'articles', 'neural networks')

      expect(results.results.length).toBeGreaterThan(0)
    })

    it('should find matches in title column', async () => {
      // 'Mediterranean' appears only in title
      const results = await search(db, 'articles', 'Mediterranean')

      expect(results.results.length).toBeGreaterThan(0)
    })

    it('should return selected columns in results', async () => {
      const results = await search(db, 'articles', 'learning', {
        select: ['title', 'author'],
      })

      results.results.forEach((result) => {
        expect(result.document).toHaveProperty('title')
        expect(result.document).toHaveProperty('author')
      })
    })

    it('should apply additional WHERE clause', async () => {
      const results = await search(db, 'articles', 'learning', {
        where: "category = 'tech'",
      })

      results.results.forEach((result) => {
        expect((result.document as { category?: string }).category).toBe('tech')
      })
    })

    it('should support column boosting', async () => {
      const results = await search(db, 'articles', 'learning', {
        boosts: { title: 2.0, body: 1.0 },
      })

      // Title matches should score higher than body-only matches
      expect(results.results.length).toBeGreaterThan(0)
    })
  })

  // ============================================================================
  // 4. STEMMER LANGUAGE SUPPORT
  // ============================================================================

  describe('Stemmer Language Support', () => {
    afterEach(async () => {
      await dropFTSIndex(db, 'articles')
    })

    it('should stem English words with porter stemmer', async () => {
      await createFTSIndex(db, {
        table: 'articles',
        columns: 'body',
        stemmer: 'porter',
      })

      // 'running' should match 'run', 'runs', 'running'
      const results = await search(db, 'articles', 'running')

      // Should find the fitness article about running
      expect(results.results.length).toBeGreaterThan(0)
    })

    it('should match stemmed variants', async () => {
      await createFTSIndex(db, {
        table: 'articles',
        columns: 'body',
        stemmer: 'english',
      })

      // These should all match due to stemming
      const learning = await search(db, 'articles', 'learn')
      const learns = await search(db, 'articles', 'learns')
      const learned = await search(db, 'articles', 'learned')

      // All should find similar results
      expect(learning.totalCount).toBeGreaterThan(0)
      expect(learns.totalCount).toBe(learning.totalCount)
      expect(learned.totalCount).toBe(learning.totalCount)
    })

    it('should use German stemmer', async () => {
      // Create German test data
      await db.query(`
        CREATE TABLE german_docs (
          id INTEGER PRIMARY KEY,
          content TEXT
        )
      `)
      await db.query(`
        INSERT INTO german_docs VALUES
          (1, 'Der schnelle braune Fuchs springt uber den faulen Hund'),
          (2, 'Die Katze lauft schnell nach Hause')
      `)

      await createFTSIndex(db, {
        table: 'german_docs',
        columns: 'content',
        stemmer: 'german',
      })

      const results = await search(db, 'german_docs', 'schnell')
      expect(results.results.length).toBeGreaterThan(0)

      await db.query('DROP TABLE german_docs')
      await dropFTSIndex(db, 'german_docs')
    })

    it('should use French stemmer', async () => {
      await db.query(`
        CREATE TABLE french_docs (
          id INTEGER PRIMARY KEY,
          content TEXT
        )
      `)
      await db.query(`
        INSERT INTO french_docs VALUES
          (1, 'Le petit chat mange la souris'),
          (2, 'Les chats mangent les souris')
      `)

      await createFTSIndex(db, {
        table: 'french_docs',
        columns: 'content',
        stemmer: 'french',
      })

      // 'chat' and 'chats' should match due to stemming
      const results = await search(db, 'french_docs', 'chat')
      expect(results.results.length).toBe(2)

      await db.query('DROP TABLE french_docs')
      await dropFTSIndex(db, 'french_docs')
    })

    it('should match exact terms only with no stemmer', async () => {
      await createFTSIndex(db, {
        table: 'articles',
        columns: 'body',
        stemmer: 'none',
      })

      // Without stemming, 'learn' should NOT match 'learning'
      const exactResults = await search(db, 'articles', 'learn')
      const fullWord = await search(db, 'articles', 'learning')

      // 'learning' appears in text, 'learn' doesn't
      expect(fullWord.totalCount).toBeGreaterThan(exactResults.totalCount)
    })

    it('should support Spanish stemmer', async () => {
      await db.query(`
        CREATE TABLE spanish_docs (
          id INTEGER PRIMARY KEY,
          content TEXT
        )
      `)
      await db.query(`
        INSERT INTO spanish_docs VALUES
          (1, 'El gato negro corre rapido'),
          (2, 'Los gatos negros corren')
      `)

      await createFTSIndex(db, {
        table: 'spanish_docs',
        columns: 'content',
        stemmer: 'spanish',
      })

      const results = await search(db, 'spanish_docs', 'gato')
      expect(results.results.length).toBe(2)

      await db.query('DROP TABLE spanish_docs')
      await dropFTSIndex(db, 'spanish_docs')
    })
  })

  // ============================================================================
  // 5. INDEX REBUILD AFTER DATA CHANGES
  // ============================================================================

  describe('Index Rebuild', () => {
    beforeEach(async () => {
      await createFTSIndex(db, {
        table: 'articles',
        columns: ['title', 'body'],
      })
    })

    afterEach(async () => {
      // Clean up test data
      await db.query('DELETE FROM articles WHERE id > 100')
      await dropFTSIndex(db, 'articles')
    })

    it('should not find newly inserted data without rebuild', async () => {
      // Insert new article
      await db.query(`
        INSERT INTO articles VALUES
          (101, 'Quantum Computing Revolution', 'Quantum computers use qubits to solve complex problems.', 'Grace', 'tech', '2024-02-01')
      `)

      // Search without rebuild - should NOT find new data
      const results = await search(db, 'articles', 'quantum')

      // FTS index doesn't auto-update, so new data won't be found
      expect(results.totalCount).toBe(0)
    })

    it('should find newly inserted data after rebuild', async () => {
      // Insert new article
      await db.query(`
        INSERT INTO articles VALUES
          (102, 'Blockchain Technology', 'Blockchain enables decentralized and secure transactions.', 'Henry', 'tech', '2024-02-02')
      `)

      // Rebuild index
      const rebuildResult = await rebuildIndex(db, 'articles')
      expect(rebuildResult.success).toBe(true)
      expect(rebuildResult.rebuildTimeMs).toBeGreaterThan(0)

      // Search after rebuild - should find new data
      const results = await search(db, 'articles', 'blockchain')
      expect(results.totalCount).toBeGreaterThan(0)
    })

    it('should reflect deletions after rebuild', async () => {
      // First rebuild to ensure all data is indexed
      await rebuildIndex(db, 'articles')

      // Find existing article
      const before = await search(db, 'articles', 'machine learning')
      const countBefore = before.totalCount

      // Delete an article
      await db.query('DELETE FROM articles WHERE id = 1')

      // Rebuild index
      await rebuildIndex(db, 'articles')

      // Search after rebuild
      const after = await search(db, 'articles', 'machine learning')
      expect(after.totalCount).toBe(countBefore - 1)

      // Restore deleted article for other tests
      await db.query(`
        INSERT INTO articles VALUES
          (1, 'Introduction to Machine Learning', 'Machine learning is a subset of artificial intelligence that enables systems to learn and improve from experience.', 'Alice', 'tech', '2024-01-01')
      `)
    })

    it('should reflect updates after rebuild', async () => {
      // First rebuild to ensure all data is indexed
      await rebuildIndex(db, 'articles')

      // Update an article title
      await db.query("UPDATE articles SET title = 'Quantum Machine Learning' WHERE id = 1")

      // Rebuild index
      await rebuildIndex(db, 'articles')

      // Search for new title
      const results = await search(db, 'articles', 'quantum')
      expect(results.totalCount).toBeGreaterThan(0)

      // Restore original title
      await db.query("UPDATE articles SET title = 'Introduction to Machine Learning' WHERE id = 1")
      await rebuildIndex(db, 'articles')
    })

    it('should return rebuild statistics', async () => {
      const result = await rebuildIndex(db, 'articles')

      expect(result.success).toBe(true)
      expect(result.indexName).toBeDefined()
      expect(result.rebuildTimeMs).toBeGreaterThanOrEqual(0)
      expect(result.documentCount).toBe(8)
    })
  })

  // ============================================================================
  // 6. ERROR HANDLING
  // ============================================================================

  describe('Error Handling', () => {
    it('should throw for search on non-indexed table', async () => {
      await expect(
        search(db, 'nonexistent_table', 'test')
      ).rejects.toThrow()
    })

    it('should throw for empty search query', async () => {
      await createFTSIndex(db, { table: 'articles', columns: 'title' })

      await expect(
        search(db, 'articles', '')
      ).rejects.toThrow()

      await dropFTSIndex(db, 'articles')
    })

    it('should throw for invalid stemmer language', async () => {
      await expect(
        createFTSIndex(db, {
          table: 'articles',
          columns: 'title',
          stemmer: 'invalid_language' as StemmerLanguage,
        })
      ).rejects.toThrow()
    })

    it('should throw for drop of non-existent index', async () => {
      await expect(
        dropFTSIndex(db, 'nonexistent_index')
      ).rejects.toThrow()
    })

    it('should throw for rebuild of non-existent index', async () => {
      await expect(
        rebuildIndex(db, 'nonexistent_table')
      ).rejects.toThrow()
    })

    it('should handle special characters in search query', async () => {
      await createFTSIndex(db, { table: 'articles', columns: 'title' })

      // Should not throw, should return empty or handle gracefully
      const results = await search(db, 'articles', "test's \"query\" with <special> chars")
      expect(results).toBeDefined()
      expect(Array.isArray(results.results)).toBe(true)

      await dropFTSIndex(db, 'articles')
    })

    it('should handle SQL injection attempts in search query', async () => {
      await createFTSIndex(db, { table: 'articles', columns: 'title' })

      // Should not execute injected SQL
      const results = await search(db, 'articles', "'; DROP TABLE articles; --")
      expect(results).toBeDefined()

      // Table should still exist
      const tableCheck = await db.query('SELECT COUNT(*) as cnt FROM articles')
      expect((tableCheck.rows[0] as { cnt: number }).cnt).toBeGreaterThan(0)

      await dropFTSIndex(db, 'articles')
    })
  })

  // ============================================================================
  // 7. INDEX LISTING
  // ============================================================================

  describe('Index Listing', () => {
    beforeAll(async () => {
      await createFTSIndex(db, {
        table: 'articles',
        columns: ['title', 'body'],
        indexName: 'fts_articles_content',
      })
    })

    afterAll(async () => {
      await dropFTSIndex(db, 'articles')
    })

    it('should list all FTS indexes', async () => {
      const indexes = await listIndexes(db)

      expect(indexes.length).toBeGreaterThan(0)
      const articleIndex = indexes.find((i) => i.table === 'articles')
      expect(articleIndex).toBeDefined()
    })

    it('should return index metadata', async () => {
      const indexes = await listIndexes(db)
      const articleIndex = indexes.find((i) => i.table === 'articles')

      expect(articleIndex?.name).toBe('fts_articles_content')
      expect(articleIndex?.columns).toEqual(['title', 'body'])
    })
  })

  // ============================================================================
  // PERFORMANCE TESTS
  // ============================================================================

  describe('Performance', () => {
    beforeAll(async () => {
      // Create larger test dataset
      await db.query(`
        CREATE TABLE perf_docs AS
        SELECT
          i as id,
          'Document title number ' || i as title,
          'This is the body content for document ' || i || '. It contains various words for testing full text search performance.' as body
        FROM generate_series(1, 10000) as t(i)
      `)

      await createFTSIndex(db, {
        table: 'perf_docs',
        columns: ['title', 'body'],
      })
    })

    afterAll(async () => {
      await dropFTSIndex(db, 'perf_docs')
      await db.query('DROP TABLE IF EXISTS perf_docs')
    })

    it('should search 10K documents in under 100ms', async () => {
      const start = performance.now()
      const results = await search(db, 'perf_docs', 'document content')
      const elapsed = performance.now() - start

      console.log(`FTS search on 10K docs: ${elapsed.toFixed(2)}ms`)

      expect(results.results.length).toBeGreaterThan(0)
      expect(elapsed).toBeLessThan(100)
    })

    it('should create index on 10K documents in under 1 second', async () => {
      // Drop and recreate to measure
      await dropFTSIndex(db, 'perf_docs')

      const start = performance.now()
      await createFTSIndex(db, {
        table: 'perf_docs',
        columns: ['title', 'body'],
      })
      const elapsed = performance.now() - start

      console.log(`FTS index creation on 10K docs: ${elapsed.toFixed(2)}ms`)

      expect(elapsed).toBeLessThan(1000)
    })

    it('should rebuild index on 10K documents in under 1 second', async () => {
      const start = performance.now()
      const result = await rebuildIndex(db, 'perf_docs')
      const elapsed = performance.now() - start

      console.log(`FTS index rebuild on 10K docs: ${elapsed.toFixed(2)}ms`)

      expect(result.success).toBe(true)
      expect(elapsed).toBeLessThan(1000)
    })
  })
})
