/**
 * @dotdo/qdrant - Qdrant-compatible vector search SDK
 *
 * In-memory implementation for testing. Production version
 * will use DO SQLite with vector extensions.
 *
 * @see https://qdrant.tech/documentation/
 */
import type {
  QdrantClientConfig,
  Distance,
  VectorParams,
  CollectionConfig,
  CollectionInfo,
  CollectionsResponse,
  PointId,
  Payload,
  PointStruct,
  Record,
  ScoredPoint,
  Filter,
  Condition,
  FieldCondition,
  MatchValue,
  RangeCondition,
  HasIdCondition,
  IsEmptyCondition,
  IsNullCondition,
  SearchRequest,
  RetrieveRequest,
  ScrollRequest,
  ScrollResponse,
  CountRequest,
  CountResponse,
  PointsSelector,
  UpsertRequest,
  OperationResult,
  RecommendRequest,
} from './types'

// ============================================================================
// INTERNAL TYPES
// ============================================================================

interface InternalPoint {
  id: PointId
  vector: number[] | Map<string, number[]>
  payload: Payload
  version: number
}

interface InternalCollection {
  name: string
  config: CollectionConfig
  vectorParams: VectorParams | Map<string, VectorParams>
  points: Map<string, InternalPoint>
  createdAt: number
}

// ============================================================================
// VECTOR MATH UTILITIES
// ============================================================================

/**
 * Calculate cosine similarity between two vectors
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`)
  }

  let dotProd = 0
  let normA = 0
  let normB = 0

  for (let i = 0; i < a.length; i++) {
    dotProd += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB)
  if (denominator === 0) return 0

  return dotProd / denominator
}

/**
 * Calculate Euclidean distance between two vectors
 * Returns negative distance so higher = better (more similar)
 */
function euclideanSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`)
  }

  let sum = 0
  for (let i = 0; i < a.length; i++) {
    const diff = a[i] - b[i]
    sum += diff * diff
  }

  // Convert distance to similarity (1 / (1 + distance))
  return 1 / (1 + Math.sqrt(sum))
}

/**
 * Calculate dot product of two vectors
 */
function dotProduct(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`)
  }

  let sum = 0
  for (let i = 0; i < a.length; i++) {
    sum += a[i] * b[i]
  }
  return sum
}

/**
 * Get similarity function based on distance metric
 */
function getSimilarityFunction(distance: Distance): (a: number[], b: number[]) => number {
  switch (distance) {
    case 'Cosine':
      return cosineSimilarity
    case 'Euclid':
      return euclideanSimilarity
    case 'Dot':
      return dotProduct
    default:
      return cosineSimilarity
  }
}

// ============================================================================
// FILTER EVALUATION
// ============================================================================

/**
 * Get nested value from payload
 */
function getNestedValue(payload: Payload, key: string): unknown {
  const parts = key.split('.')
  let current: unknown = payload

  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined
    }
    if (typeof current === 'object') {
      current = (current as Record<string, unknown>)[part]
    } else {
      return undefined
    }
  }

  return current
}

/**
 * Evaluate match condition
 */
function evaluateMatch(value: unknown, match: MatchValue): boolean {
  if (match.value !== undefined) {
    return value === match.value
  }

  if (match.text !== undefined) {
    return typeof value === 'string' && value.toLowerCase().includes(match.text.toLowerCase())
  }

  if (match.any !== undefined) {
    if (Array.isArray(value)) {
      return value.some((v) => match.any!.includes(v))
    }
    return match.any.includes(value as string | number)
  }

  if (match.except !== undefined) {
    if (Array.isArray(value)) {
      return !value.some((v) => match.except!.includes(v))
    }
    return !match.except.includes(value as string | number)
  }

  return false
}

/**
 * Evaluate range condition
 */
function evaluateRange(value: unknown, range: RangeCondition): boolean {
  if (typeof value !== 'number') return false

  if (range.lt !== undefined && value >= range.lt) return false
  if (range.gt !== undefined && value <= range.gt) return false
  if (range.lte !== undefined && value > range.lte) return false
  if (range.gte !== undefined && value < range.gte) return false

  return true
}

/**
 * Evaluate a single field condition
 */
function evaluateFieldCondition(payload: Payload, condition: FieldCondition): boolean {
  const value = getNestedValue(payload, condition.key)

  if (condition.match) {
    return evaluateMatch(value, condition.match)
  }

  if (condition.range) {
    return evaluateRange(value, condition.range)
  }

  // TODO: Add geo conditions support

  return true
}

/**
 * Evaluate a single condition
 */
function evaluateCondition(point: InternalPoint, condition: Condition): boolean {
  // Has ID condition
  if ('has_id' in condition) {
    const hasId = condition as HasIdCondition
    const pointIdStr = String(point.id)
    return hasId.has_id.some((id) => String(id) === pointIdStr)
  }

  // Is empty condition
  if ('is_empty' in condition) {
    const isEmpty = condition as IsEmptyCondition
    const value = getNestedValue(point.payload, isEmpty.is_empty.key)
    return value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0)
  }

  // Is null condition
  if ('is_null' in condition) {
    const isNull = condition as IsNullCondition
    const value = getNestedValue(point.payload, isNull.is_null.key)
    return value === null
  }

  // Nested filter condition
  if ('nested' in condition) {
    // For simplicity, evaluate nested as a regular filter
    const nested = condition as { nested: { key: string; filter: Filter } }
    return evaluateFilter(point, nested.nested.filter)
  }

  // Nested filter
  if ('filter' in condition) {
    return evaluateFilter(point, (condition as { filter: Filter }).filter)
  }

  // Field condition
  if ('key' in condition) {
    return evaluateFieldCondition(point.payload, condition as FieldCondition)
  }

  return true
}

/**
 * Evaluate filter against a point
 */
function evaluateFilter(point: InternalPoint, filter: Filter): boolean {
  // Must conditions (AND)
  if (filter.must && filter.must.length > 0) {
    for (const condition of filter.must) {
      if (!evaluateCondition(point, condition)) {
        return false
      }
    }
  }

  // Must not conditions (NOT)
  if (filter.must_not && filter.must_not.length > 0) {
    for (const condition of filter.must_not) {
      if (evaluateCondition(point, condition)) {
        return false
      }
    }
  }

  // Should conditions (OR)
  if (filter.should && filter.should.length > 0) {
    let anyMatch = false
    for (const condition of filter.should) {
      if (evaluateCondition(point, condition)) {
        anyMatch = true
        break
      }
    }
    if (!anyMatch) {
      return false
    }
  }

  // Min should
  if (filter.min_should) {
    let matchCount = 0
    for (const condition of filter.min_should.conditions) {
      if (evaluateCondition(point, condition)) {
        matchCount++
      }
    }
    if (matchCount < filter.min_should.min_count) {
      return false
    }
  }

  return true
}

// ============================================================================
// PAYLOAD SELECTOR
// ============================================================================

/**
 * Filter payload based on selector
 */
function filterPayload(
  payload: Payload | undefined,
  selector: boolean | string[] | { include?: string[]; exclude?: string[] } | undefined
): Payload | null {
  if (!payload) return null
  if (selector === undefined || selector === false) return null
  if (selector === true) return payload

  if (Array.isArray(selector)) {
    const result: Payload = {}
    for (const key of selector) {
      if (key in payload) {
        result[key] = payload[key]
      }
    }
    return result
  }

  if (typeof selector === 'object') {
    let result: Payload = { ...payload }

    if (selector.include) {
      result = {}
      for (const key of selector.include) {
        if (key in payload) {
          result[key] = payload[key]
        }
      }
    }

    if (selector.exclude) {
      for (const key of selector.exclude) {
        delete result[key]
      }
    }

    return result
  }

  return payload
}

// ============================================================================
// QDRANT CLIENT
// ============================================================================

/**
 * Qdrant client - in-memory implementation
 */
export class QdrantClient {
  private config: QdrantClientConfig
  private collections: Map<string, InternalCollection> = new Map()
  private versionCounter = 0

  constructor(config: QdrantClientConfig = {}) {
    this.config = {
      url: config.url ?? 'http://localhost:6333',
      apiKey: config.apiKey,
      host: config.host,
      port: config.port ?? 6333,
      https: config.https ?? false,
      timeout: config.timeout ?? 30000,
    }
  }

  // ==========================================================================
  // COLLECTION OPERATIONS
  // ==========================================================================

  /**
   * Create a new collection
   */
  async createCollection(
    collectionName: string,
    config: { vectors: VectorParams | Record<string, VectorParams> } & Partial<CollectionConfig>
  ): Promise<OperationResult> {
    if (this.collections.has(collectionName)) {
      throw new Error(`Collection "${collectionName}" already exists`)
    }

    const vectorParams =
      'size' in config.vectors
        ? (config.vectors as VectorParams)
        : new Map(Object.entries(config.vectors as Record<string, VectorParams>))

    const collection: InternalCollection = {
      name: collectionName,
      config: {
        ...config,
        vectors: config.vectors,
      },
      vectorParams,
      points: new Map(),
      createdAt: Date.now(),
    }

    this.collections.set(collectionName, collection)

    return {
      operation_id: ++this.versionCounter,
      status: 'completed',
    }
  }

  /**
   * Delete a collection
   */
  async deleteCollection(collectionName: string): Promise<OperationResult> {
    if (!this.collections.has(collectionName)) {
      throw new Error(`Collection "${collectionName}" not found`)
    }

    this.collections.delete(collectionName)

    return {
      operation_id: ++this.versionCounter,
      status: 'completed',
    }
  }

  /**
   * Get all collections
   */
  async getCollections(): Promise<CollectionsResponse> {
    return {
      collections: Array.from(this.collections.keys()).map((name) => ({ name })),
    }
  }

  /**
   * Get collection info
   */
  async getCollection(collectionName: string): Promise<CollectionInfo> {
    const collection = this.collections.get(collectionName)
    if (!collection) {
      throw new Error(`Collection "${collectionName}" not found`)
    }

    const vectorParams =
      collection.vectorParams instanceof Map
        ? Object.fromEntries(collection.vectorParams)
        : collection.vectorParams

    return {
      status: 'green',
      optimizer_status: 'ok',
      vectors_count: collection.points.size,
      indexed_vectors_count: collection.points.size,
      points_count: collection.points.size,
      segments_count: 1,
      config: {
        ...collection.config,
        params: { vectors: vectorParams },
      },
      payload_schema: {},
    }
  }

  /**
   * Check if collection exists
   */
  async collectionExists(collectionName: string): Promise<boolean> {
    return this.collections.has(collectionName)
  }

  // ==========================================================================
  // POINT OPERATIONS
  // ==========================================================================

  /**
   * Upsert points
   */
  async upsert(collectionName: string, request: UpsertRequest): Promise<OperationResult> {
    const collection = this.collections.get(collectionName)
    if (!collection) {
      throw new Error(`Collection "${collectionName}" not found`)
    }

    for (const point of request.points) {
      const id = String(point.id)

      // Handle vector format
      let vector: number[] | Map<string, number[]>
      if (Array.isArray(point.vector)) {
        vector = point.vector

        // Validate dimensions for single vector
        if (!(collection.vectorParams instanceof Map)) {
          const params = collection.vectorParams as VectorParams
          if (vector.length !== params.size) {
            throw new Error(`Vector dimension mismatch: expected ${params.size}, got ${vector.length}`)
          }
        }
      } else {
        vector = new Map(Object.entries(point.vector))

        // Validate dimensions for named vectors
        if (collection.vectorParams instanceof Map) {
          for (const [name, vec] of vector) {
            const params = collection.vectorParams.get(name)
            if (params && vec.length !== params.size) {
              throw new Error(`Vector "${name}" dimension mismatch: expected ${params.size}, got ${vec.length}`)
            }
          }
        }
      }

      const existing = collection.points.get(id)
      const internalPoint: InternalPoint = {
        id: point.id,
        vector,
        payload: point.payload ?? {},
        version: existing ? existing.version + 1 : 1,
      }

      collection.points.set(id, internalPoint)
    }

    return {
      operation_id: ++this.versionCounter,
      status: 'completed',
    }
  }

  /**
   * Search for similar vectors
   */
  async search(collectionName: string, request: SearchRequest): Promise<ScoredPoint[]> {
    const collection = this.collections.get(collectionName)
    if (!collection) {
      throw new Error(`Collection "${collectionName}" not found`)
    }

    // Get query vector and vector name
    let queryVector: number[]
    let vectorName: string | undefined

    if (Array.isArray(request.vector)) {
      queryVector = request.vector
    } else {
      queryVector = request.vector.vector
      vectorName = request.vector.name
    }

    // Get distance metric
    let distance: Distance = 'Cosine'
    if (collection.vectorParams instanceof Map) {
      if (vectorName) {
        const params = collection.vectorParams.get(vectorName)
        if (params) {
          distance = params.distance
        }
      } else {
        // Use first vector params
        const first = collection.vectorParams.values().next().value
        if (first) {
          distance = first.distance
        }
      }
    } else {
      distance = collection.vectorParams.distance
    }

    const similarityFn = getSimilarityFunction(distance)

    // Calculate scores
    const results: ScoredPoint[] = []

    for (const point of collection.points.values()) {
      // Apply filter
      if (request.filter && !evaluateFilter(point, request.filter)) {
        continue
      }

      // Get vector to compare
      let pointVector: number[]
      if (point.vector instanceof Map) {
        const name = vectorName ?? point.vector.keys().next().value
        pointVector = point.vector.get(name) ?? []
      } else {
        pointVector = point.vector
      }

      if (pointVector.length === 0) continue

      const score = similarityFn(queryVector, pointVector)

      // Apply score threshold
      if (request.score_threshold !== undefined && score < request.score_threshold) {
        continue
      }

      // Build result
      const scored: ScoredPoint = {
        id: point.id,
        version: point.version,
        score,
        payload: filterPayload(point.payload, request.with_payload),
        vector: undefined,
      }

      // Include vector if requested
      if (request.with_vector) {
        if (point.vector instanceof Map) {
          const vectorObj: Record<string, number[]> = {}
          if (request.with_vector === true) {
            for (const [name, vec] of point.vector) {
              vectorObj[name] = vec
            }
          } else if (Array.isArray(request.with_vector)) {
            for (const name of request.with_vector) {
              const vec = point.vector.get(name)
              if (vec) {
                vectorObj[name] = vec
              }
            }
          }
          scored.vector = vectorObj
        } else {
          scored.vector = point.vector
        }
      }

      results.push(scored)
    }

    // Sort by score descending
    results.sort((a, b) => b.score - a.score)

    // Apply offset and limit
    const offset = request.offset ?? 0
    const limit = request.limit

    return results.slice(offset, offset + limit)
  }

  /**
   * Retrieve points by IDs
   */
  async retrieve(collectionName: string, request: RetrieveRequest): Promise<Record[]> {
    const collection = this.collections.get(collectionName)
    if (!collection) {
      throw new Error(`Collection "${collectionName}" not found`)
    }

    const results: Record[] = []

    for (const id of request.ids) {
      const point = collection.points.get(String(id))
      if (!point) continue

      const record: Record = {
        id: point.id,
        payload: filterPayload(point.payload, request.with_payload),
        vector: undefined,
      }

      // Include vector if requested
      if (request.with_vector) {
        if (point.vector instanceof Map) {
          const vectorObj: Record<string, number[]> = {}
          if (request.with_vector === true) {
            for (const [name, vec] of point.vector) {
              vectorObj[name] = vec
            }
          } else if (Array.isArray(request.with_vector)) {
            for (const name of request.with_vector) {
              const vec = point.vector.get(name)
              if (vec) {
                vectorObj[name] = vec
              }
            }
          }
          record.vector = vectorObj
        } else {
          record.vector = point.vector
        }
      }

      results.push(record)
    }

    return results
  }

  /**
   * Delete points
   */
  async delete(collectionName: string, selector: PointsSelector): Promise<OperationResult> {
    const collection = this.collections.get(collectionName)
    if (!collection) {
      throw new Error(`Collection "${collectionName}" not found`)
    }

    if (selector.points) {
      for (const id of selector.points) {
        collection.points.delete(String(id))
      }
    }

    if (selector.filter) {
      const toDelete: string[] = []
      for (const [id, point] of collection.points) {
        if (evaluateFilter(point, selector.filter)) {
          toDelete.push(id)
        }
      }
      for (const id of toDelete) {
        collection.points.delete(id)
      }
    }

    return {
      operation_id: ++this.versionCounter,
      status: 'completed',
    }
  }

  /**
   * Scroll through points
   */
  async scroll(collectionName: string, request: ScrollRequest = {}): Promise<ScrollResponse> {
    const collection = this.collections.get(collectionName)
    if (!collection) {
      throw new Error(`Collection "${collectionName}" not found`)
    }

    const limit = request.limit ?? 10
    const offset = request.offset

    // Get all points that match filter
    const allPoints: InternalPoint[] = []

    for (const point of collection.points.values()) {
      if (request.filter && !evaluateFilter(point, request.filter)) {
        continue
      }
      allPoints.push(point)
    }

    // Sort by ID for consistent pagination
    allPoints.sort((a, b) => {
      const aId = String(a.id)
      const bId = String(b.id)
      return aId.localeCompare(bId)
    })

    // Find start index based on offset
    let startIndex = 0
    if (offset !== null && offset !== undefined) {
      const offsetStr = String(offset)
      startIndex = allPoints.findIndex((p) => String(p.id) > offsetStr)
      if (startIndex === -1) {
        startIndex = allPoints.length
      }
    }

    // Get page of results
    const pagePoints = allPoints.slice(startIndex, startIndex + limit)

    // Build response
    const points: Record[] = pagePoints.map((point) => ({
      id: point.id,
      payload: filterPayload(point.payload, request.with_payload),
      vector:
        request.with_vector === true
          ? point.vector instanceof Map
            ? Object.fromEntries(point.vector)
            : point.vector
          : undefined,
    }))

    // Determine next page offset
    const nextPageOffset =
      startIndex + limit < allPoints.length ? allPoints[startIndex + limit - 1]?.id ?? null : null

    return {
      points,
      next_page_offset: nextPageOffset,
    }
  }

  /**
   * Count points
   */
  async count(collectionName: string, request: CountRequest = {}): Promise<CountResponse> {
    const collection = this.collections.get(collectionName)
    if (!collection) {
      throw new Error(`Collection "${collectionName}" not found`)
    }

    if (!request.filter) {
      return { count: collection.points.size }
    }

    let count = 0
    for (const point of collection.points.values()) {
      if (evaluateFilter(point, request.filter)) {
        count++
      }
    }

    return { count }
  }

  /**
   * Update payload for points
   */
  async setPayload(
    collectionName: string,
    payload: Payload,
    selector: PointsSelector
  ): Promise<OperationResult> {
    const collection = this.collections.get(collectionName)
    if (!collection) {
      throw new Error(`Collection "${collectionName}" not found`)
    }

    const pointsToUpdate: InternalPoint[] = []

    if (selector.points) {
      for (const id of selector.points) {
        const point = collection.points.get(String(id))
        if (point) {
          pointsToUpdate.push(point)
        }
      }
    }

    if (selector.filter) {
      for (const point of collection.points.values()) {
        if (evaluateFilter(point, selector.filter)) {
          pointsToUpdate.push(point)
        }
      }
    }

    for (const point of pointsToUpdate) {
      point.payload = { ...point.payload, ...payload }
      point.version++
    }

    return {
      operation_id: ++this.versionCounter,
      status: 'completed',
    }
  }

  /**
   * Overwrite payload for points
   */
  async overwritePayload(
    collectionName: string,
    payload: Payload,
    selector: PointsSelector
  ): Promise<OperationResult> {
    const collection = this.collections.get(collectionName)
    if (!collection) {
      throw new Error(`Collection "${collectionName}" not found`)
    }

    const pointsToUpdate: InternalPoint[] = []

    if (selector.points) {
      for (const id of selector.points) {
        const point = collection.points.get(String(id))
        if (point) {
          pointsToUpdate.push(point)
        }
      }
    }

    if (selector.filter) {
      for (const point of collection.points.values()) {
        if (evaluateFilter(point, selector.filter)) {
          pointsToUpdate.push(point)
        }
      }
    }

    for (const point of pointsToUpdate) {
      point.payload = payload
      point.version++
    }

    return {
      operation_id: ++this.versionCounter,
      status: 'completed',
    }
  }

  /**
   * Delete payload keys from points
   */
  async deletePayload(
    collectionName: string,
    keys: string[],
    selector: PointsSelector
  ): Promise<OperationResult> {
    const collection = this.collections.get(collectionName)
    if (!collection) {
      throw new Error(`Collection "${collectionName}" not found`)
    }

    const pointsToUpdate: InternalPoint[] = []

    if (selector.points) {
      for (const id of selector.points) {
        const point = collection.points.get(String(id))
        if (point) {
          pointsToUpdate.push(point)
        }
      }
    }

    if (selector.filter) {
      for (const point of collection.points.values()) {
        if (evaluateFilter(point, selector.filter)) {
          pointsToUpdate.push(point)
        }
      }
    }

    for (const point of pointsToUpdate) {
      for (const key of keys) {
        delete point.payload[key]
      }
      point.version++
    }

    return {
      operation_id: ++this.versionCounter,
      status: 'completed',
    }
  }

  /**
   * Clear payload for points
   */
  async clearPayload(collectionName: string, selector: PointsSelector): Promise<OperationResult> {
    const collection = this.collections.get(collectionName)
    if (!collection) {
      throw new Error(`Collection "${collectionName}" not found`)
    }

    const pointsToUpdate: InternalPoint[] = []

    if (selector.points) {
      for (const id of selector.points) {
        const point = collection.points.get(String(id))
        if (point) {
          pointsToUpdate.push(point)
        }
      }
    }

    if (selector.filter) {
      for (const point of collection.points.values()) {
        if (evaluateFilter(point, selector.filter)) {
          pointsToUpdate.push(point)
        }
      }
    }

    for (const point of pointsToUpdate) {
      point.payload = {}
      point.version++
    }

    return {
      operation_id: ++this.versionCounter,
      status: 'completed',
    }
  }

  /**
   * Recommend similar points based on examples
   */
  async recommend(collectionName: string, request: RecommendRequest): Promise<ScoredPoint[]> {
    const collection = this.collections.get(collectionName)
    if (!collection) {
      throw new Error(`Collection "${collectionName}" not found`)
    }

    // Get positive example vectors
    const positiveVectors: number[][] = []
    for (const id of request.positive) {
      const point = collection.points.get(String(id))
      if (point) {
        const vec = point.vector instanceof Map ? point.vector.values().next().value : point.vector
        if (vec) {
          positiveVectors.push(vec)
        }
      }
    }

    if (positiveVectors.length === 0) {
      return []
    }

    // Get negative example vectors
    const negativeVectors: number[][] = []
    if (request.negative) {
      for (const id of request.negative) {
        const point = collection.points.get(String(id))
        if (point) {
          const vec = point.vector instanceof Map ? point.vector.values().next().value : point.vector
          if (vec) {
            negativeVectors.push(vec)
          }
        }
      }
    }

    // Calculate average positive vector
    const dimensions = positiveVectors[0].length
    const avgPositive = new Array(dimensions).fill(0)
    for (const vec of positiveVectors) {
      for (let i = 0; i < dimensions; i++) {
        avgPositive[i] += vec[i] / positiveVectors.length
      }
    }

    // Subtract negative vectors if present
    if (negativeVectors.length > 0) {
      for (const vec of negativeVectors) {
        for (let i = 0; i < dimensions; i++) {
          avgPositive[i] -= vec[i] / negativeVectors.length
        }
      }
    }

    // Search with averaged vector
    const searchRequest: SearchRequest = {
      vector: avgPositive,
      filter: request.filter,
      limit: request.limit + request.positive.length + (request.negative?.length ?? 0),
      offset: request.offset,
      with_payload: request.with_payload,
      with_vector: request.with_vector,
      score_threshold: request.score_threshold,
    }

    const results = await this.search(collectionName, searchRequest)

    // Filter out positive and negative examples
    const exampleIds = new Set([
      ...request.positive.map(String),
      ...(request.negative ?? []).map(String),
    ])

    return results.filter((r) => !exampleIds.has(String(r.id))).slice(0, request.limit)
  }

  /**
   * Batch search
   */
  async searchBatch(
    collectionName: string,
    searches: SearchRequest[]
  ): Promise<ScoredPoint[][]> {
    const results: ScoredPoint[][] = []

    for (const search of searches) {
      const result = await this.search(collectionName, search)
      results.push(result)
    }

    return results
  }
}
