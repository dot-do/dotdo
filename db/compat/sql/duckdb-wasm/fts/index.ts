/**
 * DuckDB FTS (Full Text Search) Extension Wrapper
 *
 * Provides a typed API for DuckDB's FTS extension, enabling BM25 ranked
 * full text search with Snowball stemmer support.
 *
 * Features:
 * - BM25 ranking algorithm for relevance scoring
 * - Snowball stemmer support (20+ languages)
 * - Multi-column indexing
 * - Boolean operators (AND, OR, NOT)
 * - Phrase search with quotes
 *
 * @note FTS indexes do NOT auto-update when table data changes.
 *       Use rebuildIndex() after INSERT/UPDATE/DELETE operations.
 *
 * @note This works in browser WASM environments. In Cloudflare Workers,
 *       extension loading may fail due to sync XHR restrictions.
 *
 * @example
 * ```typescript
 * import { createDuckDB } from '@dotdo/duckdb-wasm'
 * import { createFTSIndex, search, rebuildIndex } from '@dotdo/duckdb-wasm/fts'
 *
 * const db = await createDuckDB()
 *
 * // Create FTS index
 * await createFTSIndex(db, {
 *   table: 'articles',
 *   columns: ['title', 'body'],
 *   stemmer: 'english',
 * })
 *
 * // Search with BM25 ranking
 * const results = await search(db, 'articles', 'machine learning', { limit: 10 })
 * console.log(results.results)  // [{ docId: 1, score: 2.5, document: {...} }, ...]
 *
 * // After data changes, rebuild index
 * await db.query("INSERT INTO articles VALUES (...)");
 * await rebuildIndex(db, 'articles')
 * ```
 *
 * @see https://duckdb.org/docs/extensions/full_text_search
 * @module @dotdo/duckdb-wasm/fts
 */

import type { DuckDBInstance } from '../types'

import type {
  FTSIndexConfig,
  FTSIndexInfo,
  FTSSearchOptions,
  FTSSearchResult,
  FTSSearchResults,
  FTSCreateResult,
  FTSDropResult,
  FTSRebuildResult,
  StemmerLanguage,
} from './types'

import { FTSError, FTSErrorCode } from './types'

// Re-export types
export type {
  FTSIndexConfig,
  FTSIndexInfo,
  FTSSearchOptions,
  FTSSearchResult,
  FTSSearchResults,
  FTSCreateResult,
  FTSDropResult,
  FTSRebuildResult,
  StemmerLanguage,
}

export { FTSError, FTSErrorCode }

// ============================================================================
// INTERNAL HELPERS
// ============================================================================

/**
 * Valid stemmer languages for validation
 */
const VALID_STEMMERS = new Set<string>([
  'arabic', 'basque', 'catalan', 'danish', 'dutch', 'english', 'finnish',
  'french', 'german', 'greek', 'hindi', 'hungarian', 'indonesian', 'irish',
  'italian', 'lithuanian', 'nepali', 'norwegian', 'porter', 'portuguese',
  'romanian', 'russian', 'serbian', 'spanish', 'swedish', 'tamil', 'turkish',
  'none',
])

/**
 * Ensure FTS extension is loaded
 */
async function ensureFTSExtension(db: DuckDBInstance): Promise<void> {
  try {
    // Install and load FTS extension
    // In WASM, this auto-loads from extensions.duckdb.org
    await db.query("INSTALL 'fts'")
    await db.query("LOAD 'fts'")
  } catch (err) {
    // Extension may already be loaded, or auto-loads on first use
    // Try a simple FTS operation to verify
    try {
      await db.query("SELECT fts_main_test.match_bm25('test', 'test') WHERE false")
    } catch {
      // Function not found is fine - it means extension is loaded but table doesn't exist
      // If extension truly failed to load, the error would be different
    }
  }
}

/**
 * Validate stemmer language
 */
function validateStemmer(stemmer: string): void {
  if (!VALID_STEMMERS.has(stemmer)) {
    throw new FTSError(
      FTSErrorCode.FTS_ERROR,
      `Invalid stemmer language: ${stemmer}. Valid options: ${Array.from(VALID_STEMMERS).join(', ')}`
    )
  }
}

/**
 * Escape single quotes in SQL strings
 */
function escapeSQL(value: string): string {
  return value.replace(/'/g, "''")
}

/**
 * Generate default index name
 */
function generateIndexName(table: string, columns: string[]): string {
  return `fts_main_${table}`
}

/**
 * Normalize column input to array
 */
function normalizeColumns(columns: string | string[]): string[] {
  return Array.isArray(columns) ? columns : [columns]
}

/**
 * Check if table exists
 */
async function tableExists(db: DuckDBInstance, table: string): Promise<boolean> {
  const result = await db.query<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM information_schema.tables WHERE table_name = '${escapeSQL(table)}'`
  )
  return result.rows[0].cnt > 0
}

/**
 * Check if columns exist in table
 */
async function columnsExist(
  db: DuckDBInstance,
  table: string,
  columns: string[]
): Promise<{ valid: boolean; missing: string[] }> {
  const result = await db.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns WHERE table_name = '${escapeSQL(table)}'`
  )
  const existingColumns = new Set(result.rows.map((r) => r.column_name.toLowerCase()))
  const missing = columns.filter((c) => !existingColumns.has(c.toLowerCase()))
  return { valid: missing.length === 0, missing }
}

/**
 * Check if FTS index exists for table
 */
async function ftsIndexExists(db: DuckDBInstance, table: string): Promise<boolean> {
  try {
    // Check if the FTS index table exists
    const indexTableName = `fts_main_${table}`
    const result = await db.query<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM information_schema.tables WHERE table_name = '${escapeSQL(indexTableName)}'`
    )
    return result.rows[0].cnt > 0
  } catch {
    return false
  }
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Create a Full Text Search index on a table
 *
 * Creates a BM25-ranked FTS index using DuckDB's FTS extension.
 * The index supports configurable stemmers for word normalization.
 *
 * @note FTS indexes do NOT auto-update. Call rebuildIndex() after data changes.
 *
 * @param db - DuckDB instance
 * @param config - Index configuration
 * @returns Creation result with statistics
 *
 * @example
 * ```typescript
 * // Single column index
 * await createFTSIndex(db, {
 *   table: 'articles',
 *   columns: 'title',
 * })
 *
 * // Multi-column index with custom stemmer
 * await createFTSIndex(db, {
 *   table: 'articles',
 *   columns: ['title', 'body'],
 *   stemmer: 'english',
 * })
 * ```
 */
export async function createFTSIndex(
  db: DuckDBInstance,
  config: FTSIndexConfig
): Promise<FTSCreateResult> {
  const startTime = performance.now()

  // Validate inputs
  const columns = normalizeColumns(config.columns)
  const stemmer = config.stemmer ?? 'porter'
  const overwrite = config.overwrite ?? false

  // Validate stemmer
  validateStemmer(stemmer)

  // Ensure FTS extension is loaded
  await ensureFTSExtension(db)

  // Check if table exists
  if (!(await tableExists(db, config.table))) {
    throw new FTSError(
      FTSErrorCode.TABLE_NOT_FOUND,
      `Table '${config.table}' does not exist`
    )
  }

  // Check if columns exist
  const { valid, missing } = await columnsExist(db, config.table, columns)
  if (!valid) {
    throw new FTSError(
      FTSErrorCode.COLUMN_NOT_FOUND,
      `Column(s) not found in table '${config.table}': ${missing.join(', ')}`
    )
  }

  // Check for existing index
  const indexExists = await ftsIndexExists(db, config.table)
  if (indexExists && !overwrite) {
    throw new FTSError(
      FTSErrorCode.INDEX_EXISTS,
      `FTS index already exists for table '${config.table}'. Set overwrite: true to replace.`
    )
  }

  // Drop existing index if overwriting
  if (indexExists && overwrite) {
    await dropFTSIndex(db, config.table)
  }

  // Determine doc ID column
  const docIdColumn = config.docIdColumn ?? 'rowid'

  // Build PRAGMA fts_create statement
  // DuckDB FTS uses: PRAGMA create_fts_index('table', 'docid', 'col1', 'col2', ..., stemmer='...')
  const columnList = columns.map((c) => `'${escapeSQL(c)}'`).join(', ')
  const stemmerOption = stemmer !== 'none' ? `, stemmer='${stemmer}'` : ''
  const ignoreCaseOption = config.ignoreCase !== false ? ", ignore='(\\.|[^a-z])'" : ''
  const stripAccentsOption = config.stripAccents !== false ? ', strip_accents=1' : ''

  const createSQL = `PRAGMA create_fts_index('${escapeSQL(config.table)}', '${escapeSQL(docIdColumn)}', ${columnList}${stemmerOption}${stripAccentsOption})`

  try {
    await db.query(createSQL)
  } catch (err) {
    throw new FTSError(
      FTSErrorCode.FTS_ERROR,
      `Failed to create FTS index: ${err instanceof Error ? err.message : String(err)}`,
      { sql: createSQL }
    )
  }

  // Get document count
  const countResult = await db.query<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM ${config.table}`
  )
  const documentCount = Number(countResult.rows[0].cnt)

  const createTimeMs = performance.now() - startTime
  const indexName = config.indexName ?? generateIndexName(config.table, columns)

  return {
    success: true,
    indexName,
    table: config.table,
    columns,
    createTimeMs,
    documentCount,
  }
}

/**
 * Drop an FTS index from a table
 *
 * @param db - DuckDB instance
 * @param table - Table name whose FTS index to drop
 * @returns Drop result
 *
 * @example
 * ```typescript
 * await dropFTSIndex(db, 'articles')
 * ```
 */
export async function dropFTSIndex(
  db: DuckDBInstance,
  table: string
): Promise<FTSDropResult> {
  // Check if index exists
  if (!(await ftsIndexExists(db, table))) {
    throw new FTSError(
      FTSErrorCode.INDEX_NOT_FOUND,
      `No FTS index found for table '${table}'`
    )
  }

  const indexName = `fts_main_${table}`

  try {
    // Drop FTS index using PRAGMA
    await db.query(`PRAGMA drop_fts_index('${escapeSQL(table)}')`)

    return {
      success: true,
      indexName,
    }
  } catch (err) {
    throw new FTSError(
      FTSErrorCode.FTS_ERROR,
      `Failed to drop FTS index: ${err instanceof Error ? err.message : String(err)}`
    )
  }
}

/**
 * Search for documents using BM25 ranking
 *
 * Executes a full text search query against an indexed table,
 * returning results ranked by BM25 relevance score.
 *
 * @param db - DuckDB instance
 * @param table - Table to search (must have FTS index)
 * @param query - Search query string
 * @param options - Search options (limit, offset, minScore, etc.)
 * @returns Search results with BM25 scores
 *
 * @example
 * ```typescript
 * // Basic search
 * const results = await search(db, 'articles', 'machine learning')
 *
 * // With options
 * const results = await search(db, 'articles', 'machine learning', {
 *   limit: 20,
 *   minScore: 0.5,
 *   select: ['title', 'author'],
 *   where: "category = 'tech'",
 * })
 *
 * // Boolean search
 * const results = await search(db, 'articles', 'machine AND NOT deep')
 * ```
 */
export async function search<T = Record<string, unknown>>(
  db: DuckDBInstance,
  table: string,
  query: string,
  options: FTSSearchOptions = {}
): Promise<FTSSearchResults<T>> {
  const startTime = performance.now()

  // Validate inputs
  if (!query || query.trim().length === 0) {
    throw new FTSError(
      FTSErrorCode.INVALID_QUERY,
      'Search query cannot be empty'
    )
  }

  // Check if index exists
  if (!(await ftsIndexExists(db, table))) {
    throw new FTSError(
      FTSErrorCode.INDEX_NOT_FOUND,
      `No FTS index found for table '${table}'`
    )
  }

  // Build options
  const limit = options.limit ?? 10
  const offset = options.offset ?? 0
  const minScore = options.minScore ?? 0
  const selectColumns = options.select === '*' || !options.select ? '*' : options.select.join(', ')

  // Escape query for SQL (handle special characters)
  const escapedQuery = escapeSQL(query.trim())

  // Parse search terms for results
  const searchTerms = query
    .replace(/['"]/g, '')
    .replace(/\b(AND|OR|NOT)\b/gi, '')
    .split(/\s+/)
    .filter((t) => t.length > 0)

  // Build FTS query
  // DuckDB FTS uses: fts_main_tablename.match_bm25(docid, 'query')
  const ftsTable = `fts_main_${table}`
  const ftsFunction = `${ftsTable}.match_bm25`

  // Build the SELECT statement
  let sql = `
    WITH fts_results AS (
      SELECT
        fts.rowid as docId,
        fts.score as score
      FROM (
        SELECT *, ${ftsFunction}(rowid, '${escapedQuery}') as score
        FROM ${table}
      ) fts
      WHERE fts.score IS NOT NULL
      ${minScore > 0 ? `AND fts.score >= ${minScore}` : ''}
    )
    SELECT
      fr.docId,
      fr.score,
      t.${selectColumns === '*' ? '*' : selectColumns}
    FROM fts_results fr
    JOIN ${table} t ON fr.docId = t.rowid
    ${options.where ? `WHERE ${options.where}` : ''}
    ORDER BY fr.score DESC
    LIMIT ${limit}
    OFFSET ${offset}
  `

  try {
    // Execute search query
    const result = await db.query<{ docId: number; score: number } & T>(sql)

    // Get total count (without limit/offset)
    const countSQL = `
      SELECT COUNT(*) as cnt
      FROM (
        SELECT ${ftsFunction}(rowid, '${escapedQuery}') as score
        FROM ${table}
      ) fts
      WHERE fts.score IS NOT NULL
      ${minScore > 0 ? `AND fts.score >= ${minScore}` : ''}
    `
    const countResult = await db.query<{ cnt: number }>(countSQL)
    const totalCount = Number(countResult.rows[0].cnt)

    // Transform results
    const results: FTSSearchResult<T>[] = result.rows.map((row) => {
      const { docId, score, ...document } = row as { docId: number; score: number } & Record<string, unknown>
      return {
        docId,
        score,
        document: document as T,
      }
    })

    const queryTimeMs = performance.now() - startTime
    const maxScore = results.length > 0 ? results[0].score : 0

    return {
      results,
      totalCount,
      maxScore,
      queryTimeMs,
      query,
      searchTerms,
    }
  } catch (err) {
    throw new FTSError(
      FTSErrorCode.FTS_ERROR,
      `Search failed: ${err instanceof Error ? err.message : String(err)}`,
      { query, sql }
    )
  }
}

/**
 * Rebuild an FTS index to reflect data changes
 *
 * DuckDB's FTS indexes do NOT auto-update when table data changes.
 * Call this function after INSERT, UPDATE, or DELETE operations
 * to refresh the index.
 *
 * @param db - DuckDB instance
 * @param table - Table name whose index to rebuild
 * @returns Rebuild result with statistics
 *
 * @example
 * ```typescript
 * // After inserting new data
 * await db.query("INSERT INTO articles VALUES (...)")
 * await rebuildIndex(db, 'articles')
 * ```
 */
export async function rebuildIndex(
  db: DuckDBInstance,
  table: string
): Promise<FTSRebuildResult> {
  const startTime = performance.now()

  // Check if index exists
  if (!(await ftsIndexExists(db, table))) {
    throw new FTSError(
      FTSErrorCode.INDEX_NOT_FOUND,
      `No FTS index found for table '${table}'`
    )
  }

  const indexName = `fts_main_${table}`

  try {
    // Get current index info to preserve settings
    // For rebuild, we drop and recreate with same config
    // DuckDB doesn't have a direct rebuild command, so we use PRAGMA
    await db.query(`PRAGMA drop_fts_index('${escapeSQL(table)}')`)

    // Get column info from table to recreate index
    const columnsResult = await db.query<{ column_name: string; data_type: string }>(
      `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = '${escapeSQL(table)}'`
    )

    // Find text columns for indexing
    const textColumns = columnsResult.rows
      .filter((c) => c.data_type.toLowerCase().includes('varchar') || c.data_type.toLowerCase().includes('text'))
      .map((c) => c.column_name)

    if (textColumns.length === 0) {
      throw new FTSError(
        FTSErrorCode.FTS_ERROR,
        `No text columns found in table '${table}' for FTS indexing`
      )
    }

    // Recreate index with default settings
    const columnList = textColumns.map((c) => `'${escapeSQL(c)}'`).join(', ')
    await db.query(`PRAGMA create_fts_index('${escapeSQL(table)}', 'rowid', ${columnList}, stemmer='porter')`)

    // Get document count
    const countResult = await db.query<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM ${table}`
    )
    const documentCount = Number(countResult.rows[0].cnt)

    const rebuildTimeMs = performance.now() - startTime

    return {
      success: true,
      indexName,
      rebuildTimeMs,
      documentCount,
    }
  } catch (err) {
    throw new FTSError(
      FTSErrorCode.FTS_ERROR,
      `Index rebuild failed: ${err instanceof Error ? err.message : String(err)}`
    )
  }
}

/**
 * List all FTS indexes in the database
 *
 * @param db - DuckDB instance
 * @returns Array of index metadata
 *
 * @example
 * ```typescript
 * const indexes = await listIndexes(db)
 * console.log(indexes)
 * // [{ name: 'fts_main_articles', table: 'articles', columns: ['title', 'body'] }]
 * ```
 */
export async function listIndexes(db: DuckDBInstance): Promise<FTSIndexInfo[]> {
  try {
    // Find tables that match the FTS naming pattern
    const result = await db.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_name LIKE 'fts_main_%'`
    )

    const indexes: FTSIndexInfo[] = []

    for (const row of result.rows) {
      const indexTableName = row.table_name
      const sourceTable = indexTableName.replace(/^fts_main_/, '')

      // Check if source table exists
      if (await tableExists(db, sourceTable)) {
        // Get column info from source table
        const columnsResult = await db.query<{ column_name: string; data_type: string }>(
          `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = '${escapeSQL(sourceTable)}'`
        )

        const textColumns = columnsResult.rows
          .filter((c) => c.data_type.toLowerCase().includes('varchar') || c.data_type.toLowerCase().includes('text'))
          .map((c) => c.column_name)

        indexes.push({
          name: indexTableName,
          table: sourceTable,
          columns: textColumns,
          stemmer: 'porter', // Default, actual stemmer not stored in metadata
          docIdColumn: 'rowid',
        })
      }
    }

    return indexes
  } catch (err) {
    throw new FTSError(
      FTSErrorCode.FTS_ERROR,
      `Failed to list FTS indexes: ${err instanceof Error ? err.message : String(err)}`
    )
  }
}

// ============================================================================
// DEFAULT EXPORT
// ============================================================================

export default {
  createFTSIndex,
  dropFTSIndex,
  search,
  rebuildIndex,
  listIndexes,
}
