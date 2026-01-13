/**
 * FacetedSearch - Multi-dimensional aggregation primitive
 *
 * Provides efficient faceted navigation for search results with support for:
 * - Facet counting with bitmap intersection
 * - Hierarchical facets (category > subcategory)
 * - Range facets with automatic bucketing
 * - Multi-select facets with drill-down refinement
 *
 * Designed for Cloudflare Workers with 128MB memory limits.
 *
 * @example Basic Facet Counting
 * ```typescript
 * const facets = createFacetedSearch()
 *
 * // Add facet fields
 * facets.addTermFacet('category', { limit: 10 })
 * facets.addTermFacet('brand')
 * facets.addRangeFacet('price', [
 *   { label: 'Under $25', from: 0, to: 25 },
 *   { label: '$25-$50', from: 25, to: 50 },
 *   { label: 'Over $50', from: 50 }
 * ])
 *
 * // Index documents
 * facets.indexDocument('doc1', {
 *   category: 'Electronics > Phones',
 *   brand: 'Apple',
 *   price: 999
 * })
 *
 * // Count facets for search results
 * const results = facets.countFacets([0, 1, 2, 3, 4])
 * console.log(results.category)
 * // [{ value: 'Electronics', count: 5, children: [{ value: 'Phones', count: 3 }] }]
 * ```
 *
 * @example Multi-select Drill-down
 * ```typescript
 * // Apply filters and re-count
 * const filtered = facets
 *   .filter('category', ['Electronics'])
 *   .filter('brand', ['Apple', 'Samsung'])
 *
 * // Get updated facet counts with multi-select semantics
 * const counts = filtered.countFacets()
 * ```
 *
 * @module search/primitives/faceted-search
 */

// ============================================================================
// Types
// ============================================================================

/**
 * A single facet value with count
 */
export interface FacetValue {
  /** The facet value (term or range label) */
  value: string
  /** Number of documents with this value */
  count: number
  /** Child facet values for hierarchical facets */
  children?: FacetValue[]
  /** Original numeric range for range facets */
  range?: { from?: number; to?: number }
}

/**
 * Result of facet counting for a single field
 */
export interface FacetResult {
  /** Field name */
  field: string
  /** Total document count for this facet */
  totalCount: number
  /** Individual facet values with counts */
  values: FacetValue[]
  /** Whether more values exist beyond the limit */
  hasMore: boolean
}

/**
 * Complete facet results for all configured facets
 */
export type FacetResults = Map<string, FacetResult>

/**
 * Configuration for a term facet
 */
export interface TermFacetConfig {
  /** Maximum number of values to return (default: 10) */
  limit?: number
  /** Minimum count to include in results (default: 1) */
  minCount?: number
  /** Sort order: 'count' (descending) or 'value' (alphabetical) */
  sortBy?: 'count' | 'value'
  /** Hierarchical separator (e.g., ' > ' for 'Electronics > Phones') */
  hierarchySeparator?: string
}

/**
 * A single range bucket definition
 */
export interface RangeBucket {
  /** Display label for this range */
  label: string
  /** Lower bound (inclusive, omit for open-ended) */
  from?: number
  /** Upper bound (exclusive, omit for open-ended) */
  to?: number
}

/**
 * Configuration for a range facet
 */
export interface RangeFacetConfig {
  /** Predefined range buckets */
  ranges?: RangeBucket[]
  /** Auto-generate ranges with this many buckets */
  autoBuckets?: number
  /** Include count of documents with no value */
  includeMissing?: boolean
}

/**
 * Configuration for a date range facet
 */
export interface DateRangeFacetConfig {
  /** Predefined date ranges */
  ranges?: Array<{
    label: string
    from?: Date | number
    to?: Date | number
  }>
  /** Auto-bucket interval: 'year', 'month', 'week', 'day', 'hour' */
  interval?: 'year' | 'month' | 'week' | 'day' | 'hour'
}

/**
 * Filter applied to drill down into facets
 */
export interface FacetFilter {
  /** Field name */
  field: string
  /** Selected values (OR within, AND across fields) */
  values: string[]
  /** Whether to exclude these values instead of include */
  exclude?: boolean
}

/**
 * Document fields for indexing
 */
export type DocumentFields = Record<string, unknown>

/**
 * Indexed document with internal ID
 */
interface IndexedDocument {
  /** Internal numeric ID for efficient storage */
  numericId: number
  /** Original document ID */
  docId: string
  /** Indexed field values */
  fields: DocumentFields
}

/**
 * Bitmap implementation using TypedArrays for efficiency
 */
class Bitmap {
  private words: Uint32Array
  private size: number

  constructor(initialCapacity: number = 1024) {
    this.size = Math.max(initialCapacity, 32)
    const wordCount = Math.ceil(this.size / 32)
    this.words = new Uint32Array(wordCount)
  }

  /**
   * Ensure capacity for the given bit index
   */
  private ensureCapacity(bit: number): void {
    if (bit >= this.size) {
      const newSize = Math.max(this.size * 2, bit + 32)
      const newWordCount = Math.ceil(newSize / 32)
      const newWords = new Uint32Array(newWordCount)
      newWords.set(this.words)
      this.words = newWords
      this.size = newSize
    }
  }

  /**
   * Set a bit
   */
  set(bit: number): void {
    this.ensureCapacity(bit)
    const wordIndex = Math.floor(bit / 32)
    const bitIndex = bit % 32
    this.words[wordIndex] |= 1 << bitIndex
  }

  /**
   * Clear a bit
   */
  clear(bit: number): void {
    if (bit >= this.size) return
    const wordIndex = Math.floor(bit / 32)
    const bitIndex = bit % 32
    this.words[wordIndex] &= ~(1 << bitIndex)
  }

  /**
   * Test if a bit is set
   */
  get(bit: number): boolean {
    if (bit >= this.size) return false
    const wordIndex = Math.floor(bit / 32)
    const bitIndex = bit % 32
    return (this.words[wordIndex] & (1 << bitIndex)) !== 0
  }

  /**
   * Count set bits (popcount)
   */
  cardinality(): number {
    let count = 0
    for (let i = 0; i < this.words.length; i++) {
      let word = this.words[i]
      // Brian Kernighan's algorithm
      while (word) {
        word &= word - 1
        count++
      }
    }
    return count
  }

  /**
   * Intersect with another bitmap in-place
   */
  and(other: Bitmap): void {
    const minLen = Math.min(this.words.length, other.words.length)
    for (let i = 0; i < minLen; i++) {
      this.words[i] &= other.words[i]
    }
    // Clear remaining words
    for (let i = minLen; i < this.words.length; i++) {
      this.words[i] = 0
    }
  }

  /**
   * Union with another bitmap in-place
   */
  or(other: Bitmap): void {
    this.ensureCapacity(other.size - 1)
    for (let i = 0; i < other.words.length; i++) {
      this.words[i] |= other.words[i]
    }
  }

  /**
   * Create a copy of this bitmap
   */
  clone(): Bitmap {
    const copy = new Bitmap(this.size)
    copy.words.set(this.words)
    return copy
  }

  /**
   * Iterate over set bits
   */
  *[Symbol.iterator](): Generator<number> {
    for (let wordIndex = 0; wordIndex < this.words.length; wordIndex++) {
      let word = this.words[wordIndex]
      while (word) {
        const bitIndex = 31 - Math.clz32(word & -word)
        yield wordIndex * 32 + bitIndex
        word &= word - 1
      }
    }
  }

  /**
   * Get all set bits as array
   */
  toArray(): number[] {
    const result: number[] = []
    for (const bit of this) {
      result.push(bit)
    }
    return result
  }

  /**
   * Create bitmap from array of bits
   */
  static fromArray(bits: number[]): Bitmap {
    if (bits.length === 0) return new Bitmap(32)
    const maxBit = Math.max(...bits)
    const bitmap = new Bitmap(maxBit + 1)
    for (const bit of bits) {
      bitmap.set(bit)
    }
    return bitmap
  }
}

/**
 * Internal facet index for a single field
 */
interface FacetIndex {
  /** Facet type */
  type: 'term' | 'range' | 'date'
  /** Configuration */
  config: TermFacetConfig | RangeFacetConfig | DateRangeFacetConfig
  /** Value to bitmap mapping */
  valueBitmaps: Map<string, Bitmap>
  /** For hierarchical facets: parent to children mapping */
  hierarchy?: Map<string, Set<string>>
  /** For range facets: computed range buckets */
  rangeBuckets?: RangeBucket[]
  /** Statistics for auto-bucketing */
  stats?: { min: number; max: number; count: number; sum: number }
}

/**
 * FacetedSearch interface
 */
export interface FacetedSearch {
  // Configuration
  addTermFacet(field: string, config?: TermFacetConfig): void
  addRangeFacet(field: string, config: RangeFacetConfig): void
  addDateRangeFacet(field: string, config: DateRangeFacetConfig): void
  removeFacet(field: string): void

  // Indexing
  indexDocument(docId: string, fields: DocumentFields): void
  updateDocument(docId: string, fields: DocumentFields): void
  removeDocument(docId: string): void

  // Counting
  countFacets(docIds?: number[]): FacetResults
  countFacetsForBitmap(bitmap: Bitmap): FacetResults

  // Filtering (returns new instance with filters applied)
  filter(field: string, values: string[]): FacetedSearch
  exclude(field: string, values: string[]): FacetedSearch
  clearFilters(): FacetedSearch

  // Query helpers
  getFilteredDocIds(): number[]
  getFilteredBitmap(): Bitmap

  // Statistics
  getDocumentCount(): number
  getFacetFields(): string[]
  getFacetConfig(field: string): TermFacetConfig | RangeFacetConfig | DateRangeFacetConfig | undefined
}

// ============================================================================
// Implementation
// ============================================================================

class FacetedSearchImpl implements FacetedSearch {
  /** All indexed documents */
  private documents: Map<string, IndexedDocument> = new Map()

  /** Numeric ID to doc ID mapping */
  private numericToDocId: Map<number, string> = new Map()

  /** Next numeric ID */
  private nextNumericId: number = 0

  /** Facet indexes by field */
  private facetIndexes: Map<string, FacetIndex> = new Map()

  /** Currently applied filters */
  private activeFilters: FacetFilter[] = []

  /** Cached filtered bitmap */
  private filteredBitmapCache: Bitmap | null = null

  /** Reference to parent for filter chains */
  private parent: FacetedSearchImpl | null = null

  // ==========================================================================
  // Configuration
  // ==========================================================================

  addTermFacet(field: string, config: TermFacetConfig = {}): void {
    const facetConfig: TermFacetConfig = {
      limit: config.limit ?? 10,
      minCount: config.minCount ?? 1,
      sortBy: config.sortBy ?? 'count',
      hierarchySeparator: config.hierarchySeparator,
    }

    this.facetIndexes.set(field, {
      type: 'term',
      config: facetConfig,
      valueBitmaps: new Map(),
      hierarchy: config.hierarchySeparator ? new Map() : undefined,
    })
  }

  addRangeFacet(field: string, config: RangeFacetConfig): void {
    const facetConfig: RangeFacetConfig = {
      ranges: config.ranges,
      autoBuckets: config.autoBuckets,
      includeMissing: config.includeMissing ?? false,
    }

    this.facetIndexes.set(field, {
      type: 'range',
      config: facetConfig,
      valueBitmaps: new Map(),
      rangeBuckets: config.ranges ? [...config.ranges] : undefined,
      stats: config.autoBuckets ? { min: Infinity, max: -Infinity, count: 0, sum: 0 } : undefined,
    })
  }

  addDateRangeFacet(field: string, config: DateRangeFacetConfig): void {
    this.facetIndexes.set(field, {
      type: 'date',
      config,
      valueBitmaps: new Map(),
      rangeBuckets: config.ranges?.map((r) => ({
        label: r.label,
        from: r.from ? (r.from instanceof Date ? r.from.getTime() : r.from) : undefined,
        to: r.to ? (r.to instanceof Date ? r.to.getTime() : r.to) : undefined,
      })),
      stats: config.interval ? { min: Infinity, max: -Infinity, count: 0, sum: 0 } : undefined,
    })
  }

  removeFacet(field: string): void {
    this.facetIndexes.delete(field)
  }

  // ==========================================================================
  // Indexing
  // ==========================================================================

  indexDocument(docId: string, fields: DocumentFields): void {
    // Remove existing if present
    if (this.documents.has(docId)) {
      this.removeDocument(docId)
    }

    // Assign numeric ID
    const numericId = this.nextNumericId++

    // Store document
    const doc: IndexedDocument = { numericId, docId, fields }
    this.documents.set(docId, doc)
    this.numericToDocId.set(numericId, docId)

    // Index into facets
    for (const [field, index] of this.facetIndexes) {
      const value = fields[field]
      if (value === undefined || value === null) continue

      this.indexFieldValue(index, numericId, value)
    }

    // Invalidate cache
    this.filteredBitmapCache = null
  }

  private indexFieldValue(index: FacetIndex, numericId: number, value: unknown): void {
    if (index.type === 'term') {
      this.indexTermValue(index, numericId, value)
    } else if (index.type === 'range' || index.type === 'date') {
      this.indexRangeValue(index, numericId, value)
    }
  }

  private indexTermValue(index: FacetIndex, numericId: number, value: unknown): void {
    const config = index.config as TermFacetConfig
    const values = Array.isArray(value) ? value : [value]

    for (const v of values) {
      const strValue = String(v)

      // Get or create bitmap for this value
      let bitmap = index.valueBitmaps.get(strValue)
      if (!bitmap) {
        bitmap = new Bitmap()
        index.valueBitmaps.set(strValue, bitmap)
      }
      bitmap.set(numericId)

      // Handle hierarchical facets
      if (config.hierarchySeparator && index.hierarchy) {
        this.indexHierarchicalValue(index, numericId, strValue, config.hierarchySeparator)
      }
    }
  }

  private indexHierarchicalValue(
    index: FacetIndex,
    numericId: number,
    value: string,
    separator: string
  ): void {
    const parts = value.split(separator).map((p) => p.trim())
    let currentPath = ''

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      const newPath = currentPath ? `${currentPath}${separator}${part}` : part

      // Add to parent-child hierarchy
      if (currentPath && index.hierarchy) {
        let children = index.hierarchy.get(currentPath)
        if (!children) {
          children = new Set()
          index.hierarchy.set(currentPath, children)
        }
        children.add(newPath)
      }

      // Also index the partial path
      if (i < parts.length - 1) {
        let bitmap = index.valueBitmaps.get(newPath)
        if (!bitmap) {
          bitmap = new Bitmap()
          index.valueBitmaps.set(newPath, bitmap)
        }
        bitmap.set(numericId)
      }

      currentPath = newPath
    }
  }

  private indexRangeValue(index: FacetIndex, numericId: number, value: unknown): void {
    const numValue = typeof value === 'number' ? value : Number(value)
    if (isNaN(numValue)) return

    // Update stats for auto-bucketing
    if (index.stats) {
      index.stats.min = Math.min(index.stats.min, numValue)
      index.stats.max = Math.max(index.stats.max, numValue)
      index.stats.count++
      index.stats.sum += numValue
    }

    // For predefined ranges, find matching bucket
    if (index.rangeBuckets) {
      for (const bucket of index.rangeBuckets) {
        if (this.valueInRange(numValue, bucket)) {
          let bitmap = index.valueBitmaps.get(bucket.label)
          if (!bitmap) {
            bitmap = new Bitmap()
            index.valueBitmaps.set(bucket.label, bitmap)
          }
          bitmap.set(numericId)
          // Continue to check other buckets (overlapping ranges allowed)
        }
      }
    }
  }

  private valueInRange(value: number, bucket: RangeBucket): boolean {
    if (bucket.from !== undefined && value < bucket.from) return false
    if (bucket.to !== undefined && value >= bucket.to) return false
    return true
  }

  updateDocument(docId: string, fields: DocumentFields): void {
    this.indexDocument(docId, fields)
  }

  removeDocument(docId: string): void {
    const doc = this.documents.get(docId)
    if (!doc) return

    // Remove from all facet indexes
    for (const index of this.facetIndexes.values()) {
      for (const bitmap of index.valueBitmaps.values()) {
        bitmap.clear(doc.numericId)
      }
    }

    // Remove from document maps
    this.documents.delete(docId)
    this.numericToDocId.delete(doc.numericId)

    // Invalidate cache
    this.filteredBitmapCache = null
  }

  // ==========================================================================
  // Counting
  // ==========================================================================

  countFacets(docIds?: number[]): FacetResults {
    // Create bitmap from doc IDs or use all documents
    let bitmap: Bitmap
    if (docIds !== undefined) {
      bitmap = Bitmap.fromArray(docIds)
    } else {
      bitmap = this.getFilteredBitmap()
    }

    return this.countFacetsForBitmap(bitmap)
  }

  countFacetsForBitmap(bitmap: Bitmap): FacetResults {
    const results: FacetResults = new Map()

    for (const [field, index] of this.facetIndexes) {
      const result = this.countFacetField(field, index, bitmap)
      results.set(field, result)
    }

    return results
  }

  private countFacetField(field: string, index: FacetIndex, docBitmap: Bitmap): FacetResult {
    const config = index.config

    // Generate auto-buckets if needed
    if (index.type === 'range' && (config as RangeFacetConfig).autoBuckets && index.stats) {
      this.generateAutoBuckets(index)
    }

    // Handle multi-select: for this field, use parent bitmap (without this field's filter)
    let effectiveBitmap = docBitmap
    const fieldFilter = this.activeFilters.find((f) => f.field === field)
    if (fieldFilter && this.parent) {
      // Re-compute bitmap without this field's filter for multi-select semantics
      effectiveBitmap = this.computeBitmapExcludingFilter(field)
    }

    // Count each value
    const valueCounts: Array<{ value: string; count: number; range?: RangeBucket }> = []
    let totalCount = 0

    for (const [value, valueBitmap] of index.valueBitmaps) {
      // Intersect with document bitmap
      const intersection = effectiveBitmap.clone()
      intersection.and(valueBitmap)
      const count = intersection.cardinality()

      if (count > 0) {
        const bucket = index.rangeBuckets?.find((b) => b.label === value)
        valueCounts.push({
          value,
          count,
          range: bucket ? { from: bucket.from, to: bucket.to } : undefined,
        })
        totalCount += count
      }
    }

    // Apply sorting and limiting for term facets
    const termConfig = config as TermFacetConfig
    const minCount = termConfig.minCount ?? 1
    const limit = termConfig.limit ?? 10

    let filteredCounts = valueCounts.filter((v) => v.count >= minCount)

    // Sort
    if (termConfig.sortBy === 'value') {
      filteredCounts.sort((a, b) => a.value.localeCompare(b.value))
    } else {
      // Default: sort by count descending, then by value
      filteredCounts.sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
    }

    const hasMore = filteredCounts.length > limit
    filteredCounts = filteredCounts.slice(0, limit)

    // Build hierarchical structure if needed
    let values: FacetValue[]
    if (index.hierarchy && termConfig.hierarchySeparator) {
      values = this.buildHierarchy(filteredCounts, index.hierarchy, termConfig.hierarchySeparator)
    } else {
      values = filteredCounts.map((v) => ({
        value: v.value,
        count: v.count,
        range: v.range,
      }))
    }

    return {
      field,
      totalCount,
      values,
      hasMore,
    }
  }

  private generateAutoBuckets(index: FacetIndex): void {
    const config = index.config as RangeFacetConfig
    const stats = index.stats!
    const numBuckets = config.autoBuckets!

    if (stats.count === 0 || stats.min === Infinity) return

    // Clear existing buckets
    index.rangeBuckets = []
    index.valueBitmaps.clear()

    // Generate equal-width buckets
    const range = stats.max - stats.min
    const bucketWidth = range / numBuckets

    for (let i = 0; i < numBuckets; i++) {
      const from = stats.min + i * bucketWidth
      const to = i === numBuckets - 1 ? stats.max + 1 : stats.min + (i + 1) * bucketWidth

      const label = this.formatRangeLabel(from, to, i === numBuckets - 1)
      index.rangeBuckets.push({ label, from, to: i === numBuckets - 1 ? undefined : to })
    }

    // Re-index all documents into new buckets
    for (const doc of this.documents.values()) {
      const value = doc.fields[this.getFieldName(index)]
      if (value !== undefined && value !== null) {
        this.indexRangeValue(index, doc.numericId, value)
      }
    }
  }

  private getFieldName(index: FacetIndex): string {
    for (const [field, idx] of this.facetIndexes) {
      if (idx === index) return field
    }
    return ''
  }

  private formatRangeLabel(from: number, to: number | undefined, isLast: boolean): string {
    const formatNum = (n: number) => {
      if (Number.isInteger(n)) return n.toString()
      return n.toFixed(2)
    }

    if (to === undefined || isLast) {
      return `${formatNum(from)}+`
    }
    return `${formatNum(from)} - ${formatNum(to)}`
  }

  private buildHierarchy(
    counts: Array<{ value: string; count: number; range?: RangeBucket }>,
    hierarchy: Map<string, Set<string>>,
    separator: string
  ): FacetValue[] {
    // Build a map of all values
    const valueMap = new Map<string, FacetValue>()
    for (const { value, count, range } of counts) {
      valueMap.set(value, { value, count, range })
    }

    // Find root values (no parent)
    const roots: FacetValue[] = []
    const allValues = new Set(counts.map((c) => c.value))

    for (const { value, count, range } of counts) {
      const parts = value.split(separator).map((p) => p.trim())

      // Check if this is a root (first level)
      if (parts.length === 1) {
        const facetValue: FacetValue = { value, count, range }

        // Find children
        const children = hierarchy.get(value)
        if (children) {
          facetValue.children = []
          for (const childPath of children) {
            const childValue = valueMap.get(childPath)
            if (childValue) {
              // Extract just the last part as the displayed value
              const childParts = childPath.split(separator).map((p) => p.trim())
              facetValue.children.push({
                ...childValue,
                value: childParts[childParts.length - 1],
              })
            }
          }
          // Sort children by count
          facetValue.children.sort((a, b) => b.count - a.count)
        }

        roots.push(facetValue)
      }
    }

    return roots
  }

  private computeBitmapExcludingFilter(excludeField: string): Bitmap {
    // Start with all documents
    const bitmap = new Bitmap(this.nextNumericId)
    for (const doc of this.documents.values()) {
      bitmap.set(doc.numericId)
    }

    // Apply all filters except the excluded one
    for (const filter of this.activeFilters) {
      if (filter.field === excludeField) continue

      const index = this.facetIndexes.get(filter.field)
      if (!index) continue

      this.applyFilterToBitmap(bitmap, index, filter)
    }

    return bitmap
  }

  private applyFilterToBitmap(bitmap: Bitmap, index: FacetIndex, filter: FacetFilter): void {
    // Collect all matching doc IDs for this filter (OR within values)
    const matchingBitmap = new Bitmap()

    for (const value of filter.values) {
      const valueBitmap = index.valueBitmaps.get(value)
      if (valueBitmap) {
        matchingBitmap.or(valueBitmap)
      }
    }

    if (filter.exclude) {
      // XOR to exclude
      for (const docId of matchingBitmap) {
        bitmap.clear(docId)
      }
    } else {
      // AND to include
      bitmap.and(matchingBitmap)
    }
  }

  // ==========================================================================
  // Filtering
  // ==========================================================================

  filter(field: string, values: string[]): FacetedSearch {
    const copy = this.createFilteredCopy()
    copy.activeFilters.push({ field, values, exclude: false })
    copy.filteredBitmapCache = null
    return copy
  }

  exclude(field: string, values: string[]): FacetedSearch {
    const copy = this.createFilteredCopy()
    copy.activeFilters.push({ field, values, exclude: true })
    copy.filteredBitmapCache = null
    return copy
  }

  clearFilters(): FacetedSearch {
    const copy = this.createFilteredCopy()
    copy.activeFilters = []
    copy.filteredBitmapCache = null
    return copy
  }

  private createFilteredCopy(): FacetedSearchImpl {
    const copy = new FacetedSearchImpl()
    // Share underlying data structures
    copy.documents = this.documents
    copy.numericToDocId = this.numericToDocId
    copy.nextNumericId = this.nextNumericId
    copy.facetIndexes = this.facetIndexes
    // Copy filters
    copy.activeFilters = [...this.activeFilters]
    // Set parent reference for multi-select semantics
    copy.parent = this
    return copy
  }

  // ==========================================================================
  // Query Helpers
  // ==========================================================================

  getFilteredDocIds(): number[] {
    return this.getFilteredBitmap().toArray()
  }

  getFilteredBitmap(): Bitmap {
    if (this.filteredBitmapCache) {
      return this.filteredBitmapCache
    }

    // Start with all documents
    const bitmap = new Bitmap(this.nextNumericId)
    for (const doc of this.documents.values()) {
      bitmap.set(doc.numericId)
    }

    // Apply all filters
    for (const filter of this.activeFilters) {
      const index = this.facetIndexes.get(filter.field)
      if (!index) continue

      this.applyFilterToBitmap(bitmap, index, filter)
    }

    this.filteredBitmapCache = bitmap
    return bitmap
  }

  // ==========================================================================
  // Statistics
  // ==========================================================================

  getDocumentCount(): number {
    return this.documents.size
  }

  getFacetFields(): string[] {
    return Array.from(this.facetIndexes.keys())
  }

  getFacetConfig(
    field: string
  ): TermFacetConfig | RangeFacetConfig | DateRangeFacetConfig | undefined {
    return this.facetIndexes.get(field)?.config
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a new FacetedSearch instance
 */
export function createFacetedSearch(): FacetedSearch {
  return new FacetedSearchImpl()
}

/**
 * Create faceted search from existing documents
 */
export function createFacetedSearchFromDocuments(
  documents: Array<{ id: string; fields: DocumentFields }>,
  facetConfigs: Array<
    | { field: string; type: 'term'; config?: TermFacetConfig }
    | { field: string; type: 'range'; config: RangeFacetConfig }
    | { field: string; type: 'date'; config: DateRangeFacetConfig }
  >
): FacetedSearch {
  const search = createFacetedSearch()

  // Add facet configurations
  for (const facetConfig of facetConfigs) {
    if (facetConfig.type === 'term') {
      search.addTermFacet(facetConfig.field, facetConfig.config)
    } else if (facetConfig.type === 'range') {
      search.addRangeFacet(facetConfig.field, facetConfig.config)
    } else if (facetConfig.type === 'date') {
      search.addDateRangeFacet(facetConfig.field, facetConfig.config)
    }
  }

  // Index all documents
  for (const doc of documents) {
    search.indexDocument(doc.id, doc.fields)
  }

  return search
}

// ============================================================================
// Exports
// ============================================================================

export { Bitmap }
