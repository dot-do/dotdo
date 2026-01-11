/**
 * SearchDO - Algolia-compatible full-text search Durable Object
 *
 * Drop-in replacement for Algolia backed by SQLite FTS5.
 * Provides persistent full-text search within a Durable Object.
 *
 * Features:
 * - Full-text search with FTS5 (typo tolerance via prefix matching)
 * - Faceted navigation
 * - Highlighting
 * - Pagination
 * - Persistent storage across DO restarts
 */

import { DurableObject } from 'cloudflare:workers'

// ============================================================================
// TYPES
// ============================================================================

export interface Product {
  objectID: string
  name: string
  description?: string
  category: string
  brand: string
  price: number
  inStock?: boolean
  tags?: string[]
  rating?: number
  reviews?: number
}

interface Env {
  ENVIRONMENT?: string
}

interface Settings {
  searchableAttributes?: string[]
  attributesForFaceting?: string[]
  hitsPerPage?: number
  attributesToHighlight?: string[]
  highlightPreTag?: string
  highlightPostTag?: string
}

interface SearchHit<T> extends T {
  objectID: string
  _highlightResult?: Record<string, { value: string; matchLevel: string; matchedWords: string[] }>
}

interface SearchResponse<T> {
  hits: SearchHit<T>[]
  nbHits: number
  page: number
  nbPages: number
  hitsPerPage: number
  exhaustiveNbHits: boolean
  facets?: Record<string, Record<string, number>>
  query: string
  params: string
  processingTimeMS: number
}

// SqlStorage type for DO SQLite access
interface SqlStorage {
  exec(query: string, ...params: unknown[]): SqlStorageResult
}

interface SqlStorageResult {
  one(): Record<string, unknown> | undefined
  toArray(): Record<string, unknown>[]
  raw(): unknown[][]
}

// ============================================================================
// SEARCH DO CLASS
// ============================================================================

export class SearchDO extends DurableObject<Env> {
  private initialized = false
  private settings: Settings = {}
  private taskCounter = 0

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
  }

  /**
   * Get the SQLite storage interface
   */
  private get sql(): SqlStorage {
    return (this.ctx.storage as unknown as { sql: SqlStorage }).sql
  }

  /**
   * Initialize the database schema
   */
  private async initialize(): Promise<void> {
    if (this.initialized) return

    // Create objects table for storing documents
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS objects (
        object_id TEXT PRIMARY KEY,
        index_name TEXT NOT NULL DEFAULT 'products',
        data TEXT NOT NULL,
        searchable_text TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `)

    // Create FTS5 virtual table for full-text search
    this.sql.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS objects_fts USING fts5(
        object_id,
        searchable_text,
        content='objects',
        content_rowid='rowid'
      )
    `)

    // Create triggers to keep FTS in sync
    this.sql.exec(`
      CREATE TRIGGER IF NOT EXISTS objects_ai AFTER INSERT ON objects BEGIN
        INSERT INTO objects_fts(rowid, object_id, searchable_text)
        VALUES (new.rowid, new.object_id, new.searchable_text);
      END
    `)

    this.sql.exec(`
      CREATE TRIGGER IF NOT EXISTS objects_ad AFTER DELETE ON objects BEGIN
        INSERT INTO objects_fts(objects_fts, rowid, object_id, searchable_text)
        VALUES ('delete', old.rowid, old.object_id, old.searchable_text);
      END
    `)

    this.sql.exec(`
      CREATE TRIGGER IF NOT EXISTS objects_au AFTER UPDATE ON objects BEGIN
        INSERT INTO objects_fts(objects_fts, rowid, object_id, searchable_text)
        VALUES ('delete', old.rowid, old.object_id, old.searchable_text);
        INSERT INTO objects_fts(rowid, object_id, searchable_text)
        VALUES (new.rowid, new.object_id, new.searchable_text);
      END
    `)

    // Create settings table
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        index_name TEXT PRIMARY KEY,
        data TEXT NOT NULL
      )
    `)

    // Load existing settings
    const settingsRow = this.sql.exec(
      `SELECT data FROM settings WHERE index_name = ?`,
      'products'
    ).one()

    if (settingsRow) {
      this.settings = JSON.parse(settingsRow.data as string)
    } else {
      // Set default settings
      this.settings = {
        searchableAttributes: ['name', 'description', 'brand', 'category', 'tags'],
        attributesForFaceting: ['category', 'brand', 'tags'],
        hitsPerPage: 20,
        attributesToHighlight: ['name', 'description'],
        highlightPreTag: '<em>',
        highlightPostTag: '</em>'
      }
      await this.saveSettings()
    }

    this.initialized = true
  }

  /**
   * Save settings to database
   */
  private async saveSettings(): Promise<void> {
    this.sql.exec(
      `INSERT OR REPLACE INTO settings (index_name, data) VALUES (?, ?)`,
      'products',
      JSON.stringify(this.settings)
    )
  }

  /**
   * Extract searchable text from an object
   */
  private extractSearchableText(obj: Record<string, unknown>): string {
    const texts: string[] = []
    const attrs = this.settings.searchableAttributes || Object.keys(obj)

    for (const attr of attrs) {
      const value = obj[attr]
      if (typeof value === 'string') {
        texts.push(value)
      } else if (Array.isArray(value)) {
        texts.push(value.filter(v => typeof v === 'string').join(' '))
      } else if (value !== null && value !== undefined) {
        texts.push(String(value))
      }
    }

    return texts.join(' ')
  }

  /**
   * Generate task ID
   */
  private generateTaskID(): number {
    return ++this.taskCounter
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // INDEXING METHODS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Index a single product
   */
  async indexProduct(product: Product): Promise<{ objectID: string; taskID: number }> {
    await this.initialize()

    const now = Date.now()
    const searchableText = this.extractSearchableText(product as unknown as Record<string, unknown>)

    this.sql.exec(
      `INSERT OR REPLACE INTO objects (object_id, index_name, data, searchable_text, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      product.objectID,
      'products',
      JSON.stringify(product),
      searchableText,
      now,
      now
    )

    return { objectID: product.objectID, taskID: this.generateTaskID() }
  }

  /**
   * Index multiple products
   */
  async indexProducts(products: Product[]): Promise<{ objectIDs: string[]; taskID: number }> {
    await this.initialize()

    const now = Date.now()
    const objectIDs: string[] = []

    for (const product of products) {
      const searchableText = this.extractSearchableText(product as unknown as Record<string, unknown>)

      this.sql.exec(
        `INSERT OR REPLACE INTO objects (object_id, index_name, data, searchable_text, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        product.objectID,
        'products',
        JSON.stringify(product),
        searchableText,
        now,
        now
      )

      objectIDs.push(product.objectID)
    }

    return { objectIDs, taskID: this.generateTaskID() }
  }

  /**
   * Partial update a product (merge fields)
   */
  async updateProduct(
    objectID: string,
    updates: Partial<Omit<Product, 'objectID'>>
  ): Promise<{ objectID: string; taskID: number }> {
    await this.initialize()

    const existing = await this.getProduct(objectID)
    if (!existing) {
      throw new Error(`Object ${objectID} not found`)
    }

    const updated = { ...existing, ...updates, objectID }
    return this.indexProduct(updated as Product)
  }

  /**
   * Delete a product
   */
  async deleteProduct(objectID: string): Promise<{ objectID: string; taskID: number }> {
    await this.initialize()

    this.sql.exec(`DELETE FROM objects WHERE object_id = ?`, objectID)

    return { objectID, taskID: this.generateTaskID() }
  }

  /**
   * Delete multiple products
   */
  async deleteProducts(objectIDs: string[]): Promise<{ objectIDs: string[]; taskID: number }> {
    await this.initialize()

    for (const objectID of objectIDs) {
      this.sql.exec(`DELETE FROM objects WHERE object_id = ?`, objectID)
    }

    return { objectIDs, taskID: this.generateTaskID() }
  }

  /**
   * Clear all products from the index
   */
  async clearProducts(): Promise<{ taskID: number }> {
    await this.initialize()

    this.sql.exec(`DELETE FROM objects WHERE index_name = ?`, 'products')

    return { taskID: this.generateTaskID() }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SEARCH METHODS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Search products with full Algolia-like options
   */
  async search(
    query: string,
    options?: {
      filters?: string
      facetFilters?: string | string[] | string[][]
      facets?: string[]
      hitsPerPage?: number
      page?: number
      attributesToRetrieve?: string[]
      attributesToHighlight?: string[]
      highlightPreTag?: string
      highlightPostTag?: string
    }
  ): Promise<SearchResponse<Product>> {
    await this.initialize()

    const startTime = performance.now()
    const page = options?.page ?? 0
    const hitsPerPage = options?.hitsPerPage ?? this.settings.hitsPerPage ?? 20
    const offset = page * hitsPerPage

    let rows: Record<string, unknown>[]

    if (query && query.trim()) {
      // Use FTS5 search with prefix matching for typo tolerance
      const ftsQuery = query
        .trim()
        .split(/\s+/)
        .map(term => `${term}*`)
        .join(' ')

      rows = this.sql.exec(
        `SELECT o.object_id, o.data
         FROM objects o
         JOIN objects_fts fts ON o.object_id = fts.object_id
         WHERE fts.searchable_text MATCH ?
         AND o.index_name = ?
         ORDER BY rank
         LIMIT ? OFFSET ?`,
        ftsQuery,
        'products',
        hitsPerPage,
        offset
      ).toArray()
    } else {
      // No query - return all objects
      rows = this.sql.exec(
        `SELECT object_id, data FROM objects
         WHERE index_name = ?
         ORDER BY updated_at DESC
         LIMIT ? OFFSET ?`,
        'products',
        hitsPerPage,
        offset
      ).toArray()
    }

    // Get total count
    let totalCount: number
    if (query && query.trim()) {
      const ftsQuery = query
        .trim()
        .split(/\s+/)
        .map(term => `${term}*`)
        .join(' ')

      const countResult = this.sql.exec(
        `SELECT COUNT(*) as count
         FROM objects o
         JOIN objects_fts fts ON o.object_id = fts.object_id
         WHERE fts.searchable_text MATCH ?
         AND o.index_name = ?`,
        ftsQuery,
        'products'
      ).one()
      totalCount = (countResult?.count as number) ?? 0
    } else {
      const countResult = this.sql.exec(
        `SELECT COUNT(*) as count FROM objects WHERE index_name = ?`,
        'products'
      ).one()
      totalCount = (countResult?.count as number) ?? 0
    }

    // Parse and filter results
    let hits = rows.map(row => {
      const data = JSON.parse(row.data as string) as Product
      return { ...data, objectID: row.object_id as string }
    })

    // Apply filters if provided
    if (options?.filters) {
      hits = this.applyFilters(hits, options.filters)
    }
    if (options?.facetFilters) {
      hits = this.applyFacetFilters(hits, options.facetFilters)
    }

    // Calculate facets if requested
    let facets: Record<string, Record<string, number>> | undefined
    if (options?.facets && options.facets.length > 0) {
      facets = this.calculateFacets(hits, options.facets)
    }

    // Add highlighting
    const preTag = options?.highlightPreTag ?? this.settings.highlightPreTag ?? '<em>'
    const postTag = options?.highlightPostTag ?? this.settings.highlightPostTag ?? '</em>'
    const attrsToHighlight = options?.attributesToHighlight ?? this.settings.attributesToHighlight ?? []

    const searchHits: SearchHit<Product>[] = hits.map(hit => {
      const highlighted: Record<string, { value: string; matchLevel: string; matchedWords: string[] }> = {}

      if (query && attrsToHighlight.length > 0) {
        for (const attr of attrsToHighlight) {
          const value = (hit as unknown as Record<string, unknown>)[attr]
          if (typeof value === 'string') {
            const { highlightedValue, matchedWords } = this.highlightText(value, query, preTag, postTag)
            highlighted[attr] = {
              value: highlightedValue,
              matchLevel: matchedWords.length > 0 ? 'full' : 'none',
              matchedWords
            }
          }
        }
      }

      return {
        ...hit,
        _highlightResult: Object.keys(highlighted).length > 0 ? highlighted : undefined
      }
    })

    const processingTimeMS = Math.round(performance.now() - startTime)

    return {
      hits: searchHits,
      nbHits: totalCount,
      page,
      nbPages: Math.ceil(totalCount / hitsPerPage),
      hitsPerPage,
      exhaustiveNbHits: true,
      facets,
      query,
      params: this.buildParamsString(options),
      processingTimeMS
    }
  }

  /**
   * Highlight query terms in text
   */
  private highlightText(
    text: string,
    query: string,
    preTag: string,
    postTag: string
  ): { highlightedValue: string; matchedWords: string[] } {
    const queryTerms = query.toLowerCase().split(/\s+/).filter(t => t.length > 0)
    const matchedWords: string[] = []
    let highlightedValue = text

    for (const term of queryTerms) {
      const regex = new RegExp(`(${this.escapeRegex(term)})`, 'gi')
      if (regex.test(text)) {
        highlightedValue = highlightedValue.replace(regex, `${preTag}$1${postTag}`)
        matchedWords.push(term)
      }
    }

    return { highlightedValue, matchedWords }
  }

  /**
   * Escape regex special characters
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }

  /**
   * Apply filter string to hits
   */
  private applyFilters(hits: Product[], filters: string): Product[] {
    // Simple filter parser supporting: field:value, field>value, field<value, AND, OR
    const conditions = filters.split(/\s+AND\s+/i)

    return hits.filter(hit => {
      return conditions.every(condition => {
        // Handle OR
        const orParts = condition.split(/\s+OR\s+/i)
        return orParts.some(part => this.evaluateCondition(hit, part.trim()))
      })
    })
  }

  /**
   * Evaluate a single filter condition
   */
  private evaluateCondition(hit: Product, condition: string): boolean {
    // Match patterns like: field:value, field>value, field>=value, field<value, field<=value
    const match = condition.match(/^(\w+)\s*(:|>=|<=|>|<|=)\s*(.+)$/)
    if (!match) return true

    const [, field, operator, valueStr] = match
    const hitValue = (hit as unknown as Record<string, unknown>)[field]
    const filterValue = this.parseValue(valueStr)

    if (hitValue === undefined || hitValue === null) {
      return operator === '!='
    }

    switch (operator) {
      case ':':
      case '=':
        if (Array.isArray(hitValue)) {
          return hitValue.includes(filterValue)
        }
        return String(hitValue) === String(filterValue)
      case '>':
        return Number(hitValue) > Number(filterValue)
      case '>=':
        return Number(hitValue) >= Number(filterValue)
      case '<':
        return Number(hitValue) < Number(filterValue)
      case '<=':
        return Number(hitValue) <= Number(filterValue)
      default:
        return true
    }
  }

  /**
   * Parse filter value
   */
  private parseValue(str: string): string | number | boolean {
    str = str.trim().replace(/^["']|["']$/g, '')
    const num = Number(str)
    if (!isNaN(num) && str !== '') return num
    if (str === 'true') return true
    if (str === 'false') return false
    return str
  }

  /**
   * Apply facet filters to hits
   */
  private applyFacetFilters(
    hits: Product[],
    facetFilters: string | string[] | string[][]
  ): Product[] {
    // Normalize to array of arrays
    let normalized: string[][]
    if (typeof facetFilters === 'string') {
      normalized = [[facetFilters]]
    } else if (Array.isArray(facetFilters)) {
      normalized = facetFilters.map(f =>
        typeof f === 'string' ? [f] : f
      )
    } else {
      return hits
    }

    return hits.filter(hit => {
      // All groups must match (AND)
      return normalized.every(orGroup => {
        // At least one in group must match (OR)
        return orGroup.some(filter => {
          const [field, ...valueParts] = filter.split(':')
          const value = valueParts.join(':')
          const isNegation = field.startsWith('-')
          const actualField = isNegation ? field.slice(1) : field
          const hitValue = (hit as unknown as Record<string, unknown>)[actualField]

          if (Array.isArray(hitValue)) {
            const matches = hitValue.includes(value)
            return isNegation ? !matches : matches
          }

          const matches = String(hitValue) === value
          return isNegation ? !matches : matches
        })
      })
    })
  }

  /**
   * Calculate facet counts
   */
  private calculateFacets(
    hits: Product[],
    facetNames: string[]
  ): Record<string, Record<string, number>> {
    const facets: Record<string, Record<string, number>> = {}

    for (const facetName of facetNames) {
      facets[facetName] = {}

      for (const hit of hits) {
        const value = (hit as unknown as Record<string, unknown>)[facetName]

        if (Array.isArray(value)) {
          for (const v of value) {
            const key = String(v)
            facets[facetName][key] = (facets[facetName][key] ?? 0) + 1
          }
        } else if (value !== undefined && value !== null) {
          const key = String(value)
          facets[facetName][key] = (facets[facetName][key] ?? 0) + 1
        }
      }
    }

    return facets
  }

  /**
   * Build params string for response
   */
  private buildParamsString(options?: Record<string, unknown>): string {
    if (!options) return ''
    const params: string[] = []
    for (const [key, value] of Object.entries(options)) {
      if (value !== undefined) {
        params.push(`${key}=${encodeURIComponent(JSON.stringify(value))}`)
      }
    }
    return params.join('&')
  }

  /**
   * Search with common e-commerce patterns
   */
  async searchProducts(
    query: string,
    options?: {
      category?: string
      brand?: string
      minPrice?: number
      maxPrice?: number
      inStockOnly?: boolean
      page?: number
      hitsPerPage?: number
    }
  ): Promise<SearchResponse<Product>> {
    const filters: string[] = []

    if (options?.category) {
      filters.push(`category:${options.category}`)
    }
    if (options?.brand) {
      filters.push(`brand:${options.brand}`)
    }
    if (options?.minPrice !== undefined) {
      filters.push(`price>=${options.minPrice}`)
    }
    if (options?.maxPrice !== undefined) {
      filters.push(`price<=${options.maxPrice}`)
    }
    if (options?.inStockOnly) {
      filters.push('inStock:true')
    }

    return this.search(query, {
      filters: filters.length > 0 ? filters.join(' AND ') : undefined,
      facets: ['category', 'brand'],
      hitsPerPage: options?.hitsPerPage ?? 20,
      page: options?.page ?? 0
    })
  }

  /**
   * Get faceted navigation data
   */
  async getFacets(
    query: string = '',
    facets: string[] = ['category', 'brand']
  ): Promise<{
    facets: Record<string, Record<string, number>>
    nbHits: number
  }> {
    const response = await this.search(query, {
      facets,
      hitsPerPage: 0
    })

    return {
      facets: response.facets ?? {},
      nbHits: response.nbHits
    }
  }

  /**
   * Instant search (autocomplete/suggestions)
   */
  async instantSearch(
    query: string,
    options?: {
      hitsPerPage?: number
      attributesToRetrieve?: string[]
    }
  ): Promise<{
    hits: Array<{ objectID: string; name: string; category: string; brand: string }>
    nbHits: number
    processingTimeMS: number
  }> {
    const response = await this.search(query, {
      hitsPerPage: options?.hitsPerPage ?? 5,
      attributesToRetrieve: options?.attributesToRetrieve ?? ['objectID', 'name', 'category', 'brand'],
      attributesToHighlight: ['name']
    })

    return {
      hits: response.hits.map(hit => ({
        objectID: hit.objectID,
        name: hit.name,
        category: hit.category,
        brand: hit.brand
      })),
      nbHits: response.nbHits,
      processingTimeMS: response.processingTimeMS
    }
  }

  /**
   * Search for facet values
   */
  async searchFacetValues(
    facetName: string,
    facetQuery: string,
    options?: {
      filters?: string
      maxFacetHits?: number
    }
  ): Promise<Array<{ value: string; highlighted: string; count: number }>> {
    await this.initialize()

    // Get all products and calculate facet values
    const allProducts = this.sql.exec(
      `SELECT data FROM objects WHERE index_name = ?`,
      'products'
    ).toArray()

    const products = allProducts.map(row => JSON.parse(row.data as string) as Product)
    const facetCounts: Record<string, number> = {}

    for (const product of products) {
      const value = (product as unknown as Record<string, unknown>)[facetName]
      if (value !== undefined && value !== null) {
        const key = String(value)
        facetCounts[key] = (facetCounts[key] ?? 0) + 1
      }
    }

    // Filter by query and highlight
    const queryLower = facetQuery.toLowerCase()
    const maxHits = options?.maxFacetHits ?? 10

    return Object.entries(facetCounts)
      .filter(([value]) => value.toLowerCase().includes(queryLower))
      .map(([value, count]) => ({
        value,
        highlighted: value.replace(
          new RegExp(`(${this.escapeRegex(facetQuery)})`, 'gi'),
          '<em>$1</em>'
        ),
        count
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, maxHits)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RETRIEVAL METHODS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get a single product by ID
   */
  async getProduct(objectID: string): Promise<Product | null> {
    await this.initialize()

    const row = this.sql.exec(
      `SELECT data FROM objects WHERE object_id = ? AND index_name = ?`,
      objectID,
      'products'
    ).one()

    if (!row) return null

    return JSON.parse(row.data as string) as Product
  }

  /**
   * Get multiple products by IDs
   */
  async getProducts(objectIDs: string[]): Promise<Array<Product | null>> {
    await this.initialize()

    const results: Array<Product | null> = []

    for (const objectID of objectIDs) {
      const product = await this.getProduct(objectID)
      results.push(product)
    }

    return results
  }

  /**
   * Browse all products
   */
  async browseProducts(
    options?: {
      filters?: string
      hitsPerPage?: number
    }
  ): Promise<Product[]> {
    await this.initialize()

    const rows = this.sql.exec(
      `SELECT data FROM objects WHERE index_name = ?`,
      'products'
    ).toArray()

    let products = rows.map(row => JSON.parse(row.data as string) as Product)

    if (options?.filters) {
      products = this.applyFilters(products, options.filters)
    }

    return products
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SETTINGS METHODS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Update index settings
   */
  async updateSettings(settings: Settings): Promise<{ taskID: number }> {
    await this.initialize()

    this.settings = { ...this.settings, ...settings }
    await this.saveSettings()

    return { taskID: this.generateTaskID() }
  }

  /**
   * Get current index settings
   */
  async getSettings(): Promise<Settings> {
    await this.initialize()
    return { ...this.settings }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ANALYTICS METHODS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get index statistics
   */
  async getStats(): Promise<{
    entries: number
    indices: number
  }> {
    await this.initialize()

    const countResult = this.sql.exec(
      `SELECT COUNT(*) as count FROM objects WHERE index_name = ?`,
      'products'
    ).one()

    return {
      entries: (countResult?.count as number) ?? 0,
      indices: 1
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HTTP HANDLER
  // ═══════════════════════════════════════════════════════════════════════════

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const method = request.method

    try {
      // POST /index - Index products
      if (url.pathname === '/index' && method === 'POST') {
        const body = await request.json() as { products?: Product[]; product?: Product }

        if (body.products) {
          const result = await this.indexProducts(body.products)
          return Response.json(result)
        } else if (body.product) {
          const result = await this.indexProduct(body.product)
          return Response.json(result)
        }

        return Response.json({ error: 'Missing products or product in body' }, { status: 400 })
      }

      // GET /search - Search products
      if (url.pathname === '/search' && method === 'GET') {
        const query = url.searchParams.get('q') ?? ''
        const facets = url.searchParams.get('facets')?.split(',')
        const filters = url.searchParams.get('filters') ?? undefined
        const page = parseInt(url.searchParams.get('page') ?? '0')
        const hitsPerPage = parseInt(url.searchParams.get('hitsPerPage') ?? '20')

        const results = await this.search(query, {
          filters,
          facets: facets ?? ['category', 'brand'],
          page,
          hitsPerPage
        })

        return Response.json(results)
      }

      // GET /instant - Instant search (autocomplete)
      if (url.pathname === '/instant' && method === 'GET') {
        const query = url.searchParams.get('q') ?? ''
        const results = await this.instantSearch(query)
        return Response.json(results)
      }

      // GET /facets - Get facet values
      if (url.pathname === '/facets' && method === 'GET') {
        const query = url.searchParams.get('q') ?? ''
        const facets = url.searchParams.get('facets')?.split(',') ?? ['category', 'brand']
        const results = await this.getFacets(query, facets)
        return Response.json(results)
      }

      // GET /products/:id - Get single product
      if (url.pathname.startsWith('/products/') && method === 'GET') {
        const objectID = url.pathname.split('/products/')[1]
        const product = await this.getProduct(objectID)

        if (!product) {
          return Response.json({ error: 'Product not found' }, { status: 404 })
        }

        return Response.json(product)
      }

      // DELETE /products/:id - Delete product
      if (url.pathname.startsWith('/products/') && method === 'DELETE') {
        const objectID = url.pathname.split('/products/')[1]
        const result = await this.deleteProduct(objectID)
        return Response.json(result)
      }

      // POST /settings - Update settings
      if (url.pathname === '/settings' && method === 'POST') {
        const settings = await request.json() as Settings
        const result = await this.updateSettings(settings)
        return Response.json(result)
      }

      // GET /settings - Get settings
      if (url.pathname === '/settings' && method === 'GET') {
        const settings = await this.getSettings()
        return Response.json(settings)
      }

      // GET /stats - Get statistics
      if (url.pathname === '/stats' && method === 'GET') {
        const stats = await this.getStats()
        return Response.json(stats)
      }

      // POST /rpc - JSON-RPC endpoint
      if (url.pathname === '/rpc' && method === 'POST') {
        const body = await request.json() as {
          jsonrpc: string
          id: number
          method: string
          params?: unknown[]
        }
        const { method: rpcMethod, params = [], id } = body

        // Call the method on this DO
        const methodFn = (this as unknown as Record<string, (...args: unknown[]) => unknown>)[rpcMethod]
        if (typeof methodFn !== 'function') {
          return Response.json(
            {
              jsonrpc: '2.0',
              id,
              error: { code: -32601, message: `Method '${rpcMethod}' not found` }
            },
            { status: 400 }
          )
        }

        const result = await methodFn.apply(this, params)
        return Response.json({ jsonrpc: '2.0', id, result })
      }

      return Response.json({ error: 'Not found' }, { status: 404 })
    } catch (error) {
      return Response.json(
        { error: String(error) },
        { status: 500 }
      )
    }
  }
}

export default SearchDO
