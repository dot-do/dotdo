/**
 * @dotdo/weaviate - Weaviate-compatible vector database
 *
 * In-memory implementation for testing. Production version
 * will use DO SQLite with vector extensions.
 *
 * @see https://weaviate.io/developers/weaviate/client-libraries/typescript
 */
import type {
  WeaviateClientConfig,
  WeaviateClass,
  WeaviateSchema,
  WeaviateObject,
  WeaviateAdditional,
  WeaviateDB,
  InternalClass,
  NearVectorParams,
  NearTextParams,
  NearObjectParams,
  Bm25Params,
  HybridParams,
  WhereFilter,
  SortSpec,
  GraphQLResponse,
  BatchResult,
  BatchDeleteResult,
} from './types'

// ============================================================================
// ID GENERATION
// ============================================================================

let idCounter = 0

function generateUUID(): string {
  // Simple UUID v4 generation
  const hex = () => Math.floor(Math.random() * 16).toString(16)
  const segment = (len: number) => Array.from({ length: len }, hex).join('')
  return `${segment(8)}-${segment(4)}-4${segment(3)}-${hex()}${segment(3)}-${segment(12)}`
}

// ============================================================================
// VECTOR MATH
// ============================================================================

/**
 * Calculate cosine similarity between two vectors
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0

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
 * Calculate L2 (Euclidean) distance squared
 */
function l2SquaredDistance(a: number[], b: number[]): number {
  if (a.length !== b.length) return Infinity

  let sum = 0
  for (let i = 0; i < a.length; i++) {
    const diff = a[i] - b[i]
    sum += diff * diff
  }
  return sum
}

/**
 * Convert distance to certainty (Weaviate uses certainty = 1 - distance for cosine)
 */
function distanceToCertainty(distance: number, metric: string): number {
  if (metric === 'cosine') {
    return 1 - distance
  }
  // For L2, we need to normalize differently
  return 1 / (1 + distance)
}

/**
 * Convert certainty to distance
 */
function certaintyToDistance(certainty: number, metric: string): number {
  if (metric === 'cosine') {
    return 1 - certainty
  }
  return (1 / certainty) - 1
}

// ============================================================================
// TOKENIZATION FOR BM25
// ============================================================================

/**
 * Simple tokenizer for BM25 search
 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 0)
}

/**
 * Calculate BM25 score
 */
function calculateBM25Score(
  queryTerms: string[],
  docTerms: string[],
  avgDocLength: number,
  k1 = 1.2,
  b = 0.75
): number {
  const docLength = docTerms.length
  let score = 0

  const termFreq: Record<string, number> = {}
  for (const term of docTerms) {
    termFreq[term] = (termFreq[term] || 0) + 1
  }

  for (const term of queryTerms) {
    const tf = termFreq[term] || 0
    if (tf === 0) continue

    // Simplified IDF (assuming single document for simplicity)
    const idf = Math.log(1 + 1)
    const numerator = tf * (k1 + 1)
    const denominator = tf + k1 * (1 - b + b * (docLength / avgDocLength))

    score += idf * (numerator / denominator)
  }

  return score
}

// ============================================================================
// WHERE FILTER EVALUATION
// ============================================================================

/**
 * Get value from object by path
 */
function getValueByPath(obj: Record<string, unknown>, path: string[]): unknown {
  let current: unknown = obj
  for (const key of path) {
    if (current === null || current === undefined) return undefined
    current = (current as Record<string, unknown>)[key]
  }
  return current
}

/**
 * Evaluate a where filter against an object
 */
function evaluateWhereFilter(
  filter: WhereFilter,
  obj: WeaviateObject
): boolean {
  const { operator, operands, path } = filter

  // Boolean operators
  if (operator === 'And' && operands) {
    return operands.every((op) => evaluateWhereFilter(op, obj))
  }
  if (operator === 'Or' && operands) {
    return operands.some((op) => evaluateWhereFilter(op, obj))
  }

  // Value operators need a path
  if (!path || path.length === 0) return true

  const value = getValueByPath(obj.properties, path)
  const filterValue =
    filter.valueInt ??
    filter.valueNumber ??
    filter.valueBoolean ??
    filter.valueString ??
    filter.valueText ??
    filter.valueDate

  switch (operator) {
    case 'Equal':
      return value === filterValue
    case 'NotEqual':
      return value !== filterValue
    case 'GreaterThan':
      return typeof value === 'number' && value > (filterValue as number)
    case 'GreaterThanEqual':
      return typeof value === 'number' && value >= (filterValue as number)
    case 'LessThan':
      return typeof value === 'number' && value < (filterValue as number)
    case 'LessThanEqual':
      return typeof value === 'number' && value <= (filterValue as number)
    case 'Like':
      if (typeof value !== 'string' || typeof filterValue !== 'string') return false
      // Weaviate uses * as wildcard
      const pattern = filterValue.replace(/\*/g, '.*')
      return new RegExp(`^${pattern}$`, 'i').test(value)
    case 'IsNull':
      return value === null || value === undefined
    case 'ContainsAny':
      if (!Array.isArray(value)) return false
      const anyValues = filter.valueStringArray ?? filter.valueIntArray ?? filter.valueNumberArray ?? []
      return anyValues.some((v) => value.includes(v))
    case 'ContainsAll':
      if (!Array.isArray(value)) return false
      const allValues = filter.valueStringArray ?? filter.valueIntArray ?? filter.valueNumberArray ?? []
      return allValues.every((v) => value.includes(v))
    default:
      return true
  }
}

// ============================================================================
// FIELD PARSING
// ============================================================================

/**
 * Parse GraphQL-style field string
 * Example: "name description _additional { id distance vector }"
 */
function parseFields(fieldsStr: string): {
  properties: string[]
  additional: string[]
} {
  const properties: string[] = []
  const additional: string[] = []

  // Extract _additional block
  const additionalMatch = fieldsStr.match(/_additional\s*\{([^}]+)\}/)
  if (additionalMatch) {
    const additionalFields = additionalMatch[1].trim().split(/\s+/)
    additional.push(...additionalFields.filter((f) => f.length > 0))
    fieldsStr = fieldsStr.replace(/_additional\s*\{[^}]+\}/, '')
  }

  // Parse remaining properties
  const propFields = fieldsStr.trim().split(/\s+/)
  properties.push(...propFields.filter((f) => f.length > 0 && f !== '_additional'))

  return { properties, additional }
}

// ============================================================================
// WEAVIATE CLIENT IMPLEMENTATION
// ============================================================================

/**
 * Schema operations builder
 */
class SchemaCreator {
  private db: WeaviateDB
  private classConfig: WeaviateClass | null = null

  constructor(db: WeaviateDB) {
    this.db = db
  }

  withClass(classConfig: WeaviateClass): SchemaCreator {
    this.classConfig = classConfig
    return this
  }

  async do(): Promise<WeaviateClass> {
    if (!this.classConfig) {
      throw new Error('Class configuration required')
    }

    const className = this.classConfig.class
    if (this.db.classes.has(className)) {
      throw new Error(`Class '${className}' already exists`)
    }

    const internalClass: InternalClass = {
      ...this.classConfig,
      properties: this.classConfig.properties ?? [],
      objects: new Map(),
    }

    this.db.classes.set(className, internalClass)
    return this.classConfig
  }
}

class SchemaDeleter {
  private db: WeaviateDB
  private className: string | null = null

  constructor(db: WeaviateDB) {
    this.db = db
  }

  withClassName(name: string): SchemaDeleter {
    this.className = name
    return this
  }

  async do(): Promise<void> {
    if (!this.className) {
      throw new Error('Class name required')
    }

    if (!this.db.classes.has(this.className)) {
      throw new Error(`Class '${this.className}' not found`)
    }

    this.db.classes.delete(this.className)
  }
}

class SchemaGetter {
  private db: WeaviateDB

  constructor(db: WeaviateDB) {
    this.db = db
  }

  async do(): Promise<WeaviateSchema> {
    const classes: WeaviateClass[] = []

    for (const [, internalClass] of this.db.classes) {
      const { objects, ...classConfig } = internalClass
      classes.push(classConfig)
    }

    return { classes }
  }
}

class SchemaClassGetter {
  private db: WeaviateDB
  private className: string | null = null

  constructor(db: WeaviateDB) {
    this.db = db
  }

  withClassName(name: string): SchemaClassGetter {
    this.className = name
    return this
  }

  async do(): Promise<WeaviateClass> {
    if (!this.className) {
      throw new Error('Class name required')
    }

    const internalClass = this.db.classes.get(this.className)
    if (!internalClass) {
      throw new Error(`Class '${this.className}' not found`)
    }

    const { objects, ...classConfig } = internalClass
    return classConfig
  }
}

class SchemaPropertyCreator {
  private db: WeaviateDB
  private className: string | null = null
  private property: import('./types').WeaviateProperty | null = null

  constructor(db: WeaviateDB) {
    this.db = db
  }

  withClassName(name: string): SchemaPropertyCreator {
    this.className = name
    return this
  }

  withProperty(prop: import('./types').WeaviateProperty): SchemaPropertyCreator {
    this.property = prop
    return this
  }

  async do(): Promise<void> {
    if (!this.className || !this.property) {
      throw new Error('Class name and property required')
    }

    const internalClass = this.db.classes.get(this.className)
    if (!internalClass) {
      throw new Error(`Class '${this.className}' not found`)
    }

    if (!internalClass.properties) {
      internalClass.properties = []
    }

    internalClass.properties.push(this.property)
  }
}

/**
 * Schema API
 */
class SchemaAPI {
  private db: WeaviateDB

  constructor(db: WeaviateDB) {
    this.db = db
  }

  classCreator(): SchemaCreator {
    return new SchemaCreator(this.db)
  }

  classDeleter(): SchemaDeleter {
    return new SchemaDeleter(this.db)
  }

  getter(): SchemaGetter {
    return new SchemaGetter(this.db)
  }

  classGetter(): SchemaClassGetter {
    return new SchemaClassGetter(this.db)
  }

  propertyCreator(): SchemaPropertyCreator {
    return new SchemaPropertyCreator(this.db)
  }
}

/**
 * Data creator builder
 */
class DataCreator {
  private db: WeaviateDB
  private className: string | null = null
  private properties: Record<string, unknown> = {}
  private vector: number[] | null = null
  private id: string | null = null
  private tenant: string | null = null

  constructor(db: WeaviateDB) {
    this.db = db
  }

  withClassName(name: string): DataCreator {
    this.className = name
    return this
  }

  withProperties(props: Record<string, unknown>): DataCreator {
    this.properties = props
    return this
  }

  withVector(vec: number[]): DataCreator {
    this.vector = vec
    return this
  }

  withId(id: string): DataCreator {
    this.id = id
    return this
  }

  withTenant(tenant: string): DataCreator {
    this.tenant = tenant
    return this
  }

  async do(): Promise<WeaviateObject> {
    if (!this.className) {
      throw new Error('Class name required')
    }

    const internalClass = this.db.classes.get(this.className)
    if (!internalClass) {
      throw new Error(`Class '${this.className}' not found`)
    }

    const id = this.id ?? generateUUID()
    const now = Date.now()

    const obj: WeaviateObject = {
      id,
      class: this.className,
      properties: this.properties,
      vector: this.vector ?? undefined,
      tenant: this.tenant ?? undefined,
      creationTimeUnix: now,
      lastUpdateTimeUnix: now,
    }

    internalClass.objects.set(id, obj)
    return obj
  }
}

/**
 * Data deleter builder
 */
class DataDeleter {
  private db: WeaviateDB
  private className: string | null = null
  private id: string | null = null

  constructor(db: WeaviateDB) {
    this.db = db
  }

  withClassName(name: string): DataDeleter {
    this.className = name
    return this
  }

  withId(id: string): DataDeleter {
    this.id = id
    return this
  }

  async do(): Promise<void> {
    if (!this.className || !this.id) {
      throw new Error('Class name and ID required')
    }

    const internalClass = this.db.classes.get(this.className)
    if (!internalClass) {
      throw new Error(`Class '${this.className}' not found`)
    }

    if (!internalClass.objects.has(this.id)) {
      throw new Error(`Object '${this.id}' not found in class '${this.className}'`)
    }

    internalClass.objects.delete(this.id)
  }
}

/**
 * Data getter by ID builder
 */
class DataGetterById {
  private db: WeaviateDB
  private className: string | null = null
  private id: string | null = null
  private additionalFields: string[] = []

  constructor(db: WeaviateDB) {
    this.db = db
  }

  withClassName(name: string): DataGetterById {
    this.className = name
    return this
  }

  withId(id: string): DataGetterById {
    this.id = id
    return this
  }

  withAdditional(fields: string | string[]): DataGetterById {
    if (Array.isArray(fields)) {
      this.additionalFields.push(...fields)
    } else {
      this.additionalFields.push(fields)
    }
    return this
  }

  async do(): Promise<WeaviateObject | null> {
    if (!this.className || !this.id) {
      throw new Error('Class name and ID required')
    }

    const internalClass = this.db.classes.get(this.className)
    if (!internalClass) {
      throw new Error(`Class '${this.className}' not found`)
    }

    const obj = internalClass.objects.get(this.id)
    if (!obj) {
      return null
    }

    // Build additional fields
    const additional: WeaviateAdditional = {}
    for (const field of this.additionalFields) {
      switch (field) {
        case 'id':
          additional.id = obj.id
          break
        case 'vector':
          additional.vector = obj.vector
          break
        case 'creationTimeUnix':
          additional.creationTimeUnix = obj.creationTimeUnix
          break
        case 'lastUpdateTimeUnix':
          additional.lastUpdateTimeUnix = obj.lastUpdateTimeUnix
          break
      }
    }

    return {
      ...obj,
      additional: Object.keys(additional).length > 0 ? additional : undefined,
    }
  }
}

/**
 * Data updater builder
 */
class DataUpdater {
  private db: WeaviateDB
  private className: string | null = null
  private id: string | null = null
  private properties: Record<string, unknown> | null = null
  private vector: number[] | null = null

  constructor(db: WeaviateDB) {
    this.db = db
  }

  withClassName(name: string): DataUpdater {
    this.className = name
    return this
  }

  withId(id: string): DataUpdater {
    this.id = id
    return this
  }

  withProperties(props: Record<string, unknown>): DataUpdater {
    this.properties = props
    return this
  }

  withVector(vec: number[]): DataUpdater {
    this.vector = vec
    return this
  }

  async do(): Promise<void> {
    if (!this.className || !this.id) {
      throw new Error('Class name and ID required')
    }

    const internalClass = this.db.classes.get(this.className)
    if (!internalClass) {
      throw new Error(`Class '${this.className}' not found`)
    }

    const obj = internalClass.objects.get(this.id)
    if (!obj) {
      throw new Error(`Object '${this.id}' not found`)
    }

    if (this.properties) {
      obj.properties = { ...obj.properties, ...this.properties }
    }
    if (this.vector) {
      obj.vector = this.vector
    }
    obj.lastUpdateTimeUnix = Date.now()
  }
}

/**
 * Data merger builder (for PATCH operations)
 */
class DataMerger {
  private db: WeaviateDB
  private className: string | null = null
  private id: string | null = null
  private properties: Record<string, unknown> | null = null
  private vector: number[] | null = null

  constructor(db: WeaviateDB) {
    this.db = db
  }

  withClassName(name: string): DataMerger {
    this.className = name
    return this
  }

  withId(id: string): DataMerger {
    this.id = id
    return this
  }

  withProperties(props: Record<string, unknown>): DataMerger {
    this.properties = props
    return this
  }

  withVector(vec: number[]): DataMerger {
    this.vector = vec
    return this
  }

  async do(): Promise<void> {
    if (!this.className || !this.id) {
      throw new Error('Class name and ID required')
    }

    const internalClass = this.db.classes.get(this.className)
    if (!internalClass) {
      throw new Error(`Class '${this.className}' not found`)
    }

    const obj = internalClass.objects.get(this.id)
    if (!obj) {
      throw new Error(`Object '${this.id}' not found`)
    }

    // Merge properties (shallow merge)
    if (this.properties) {
      obj.properties = { ...obj.properties, ...this.properties }
    }
    if (this.vector) {
      obj.vector = this.vector
    }
    obj.lastUpdateTimeUnix = Date.now()
  }
}

/**
 * Data API
 */
class DataAPI {
  private db: WeaviateDB

  constructor(db: WeaviateDB) {
    this.db = db
  }

  creator(): DataCreator {
    return new DataCreator(this.db)
  }

  deleter(): DataDeleter {
    return new DataDeleter(this.db)
  }

  getterById(): DataGetterById {
    return new DataGetterById(this.db)
  }

  updater(): DataUpdater {
    return new DataUpdater(this.db)
  }

  merger(): DataMerger {
    return new DataMerger(this.db)
  }
}

/**
 * Batch object creator
 */
class BatchObjectCreator {
  private db: WeaviateDB
  private objects: WeaviateObject[] = []
  private className: string | null = null

  constructor(db: WeaviateDB) {
    this.db = db
  }

  withClassName(name: string): BatchObjectCreator {
    this.className = name
    return this
  }

  withObjects(objs: Array<Omit<WeaviateObject, 'class'> & { class?: string }>): BatchObjectCreator {
    this.objects = objs.map((obj) => ({
      ...obj,
      class: obj.class ?? this.className ?? '',
    })) as WeaviateObject[]
    return this
  }

  async do(): Promise<BatchResult[]> {
    const results: BatchResult[] = []

    for (const obj of this.objects) {
      const className = obj.class || this.className
      if (!className) {
        results.push({
          id: obj.id || generateUUID(),
          status: 'FAILED',
          errors: [{ message: 'Class name required' }],
        })
        continue
      }

      const internalClass = this.db.classes.get(className)
      if (!internalClass) {
        results.push({
          id: obj.id || generateUUID(),
          status: 'FAILED',
          errors: [{ message: `Class '${className}' not found` }],
        })
        continue
      }

      const id = obj.id ?? generateUUID()
      const now = Date.now()

      const newObj: WeaviateObject = {
        id,
        class: className,
        properties: obj.properties,
        vector: obj.vector,
        creationTimeUnix: now,
        lastUpdateTimeUnix: now,
      }

      internalClass.objects.set(id, newObj)
      results.push({ id, status: 'SUCCESS' })
    }

    return results
  }
}

/**
 * Batch object deleter
 */
class BatchObjectDeleter {
  private db: WeaviateDB
  private className: string | null = null
  private whereFilter: WhereFilter | null = null

  constructor(db: WeaviateDB) {
    this.db = db
  }

  withClassName(name: string): BatchObjectDeleter {
    this.className = name
    return this
  }

  withWhere(filter: WhereFilter): BatchObjectDeleter {
    this.whereFilter = filter
    return this
  }

  async do(): Promise<BatchDeleteResult> {
    if (!this.className) {
      throw new Error('Class name required')
    }

    const internalClass = this.db.classes.get(this.className)
    if (!internalClass) {
      throw new Error(`Class '${this.className}' not found`)
    }

    const toDelete: string[] = []

    for (const [id, obj] of internalClass.objects) {
      if (!this.whereFilter || evaluateWhereFilter(this.whereFilter, obj)) {
        toDelete.push(id)
      }
    }

    const objects: BatchDeleteResult['objects'] = []
    for (const id of toDelete) {
      internalClass.objects.delete(id)
      objects.push({ id, status: 'SUCCESS' })
    }

    return {
      matches: toDelete.length,
      limit: toDelete.length,
      successful: toDelete.length,
      failed: 0,
      objects,
    }
  }
}

/**
 * Batch API
 */
class BatchAPI {
  private db: WeaviateDB

  constructor(db: WeaviateDB) {
    this.db = db
  }

  objectsBatcher(): BatchObjectCreator {
    return new BatchObjectCreator(this.db)
  }

  objectsDeleter(): BatchObjectDeleter {
    return new BatchObjectDeleter(this.db)
  }
}

/**
 * GraphQL Get query builder
 */
class GraphQLGetBuilder {
  private db: WeaviateDB
  private className: string | null = null
  private fieldsStr: string = ''
  private limitValue: number | null = null
  private offsetValue: number | null = null
  private nearVectorParams: NearVectorParams | null = null
  private nearTextParams: NearTextParams | null = null
  private nearObjectParams: NearObjectParams | null = null
  private bm25Params: Bm25Params | null = null
  private hybridParams: HybridParams | null = null
  private whereFilterValue: WhereFilter | null = null
  private sortSpecs: SortSpec[] = []
  private groupByValue: { path: string[]; groups: number; objectsPerGroup: number } | null = null

  constructor(db: WeaviateDB) {
    this.db = db
  }

  withClassName(name: string): GraphQLGetBuilder {
    this.className = name
    return this
  }

  withFields(fields: string): GraphQLGetBuilder {
    this.fieldsStr = fields
    return this
  }

  withLimit(limit: number): GraphQLGetBuilder {
    this.limitValue = limit
    return this
  }

  withOffset(offset: number): GraphQLGetBuilder {
    this.offsetValue = offset
    return this
  }

  withNearVector(params: NearVectorParams): GraphQLGetBuilder {
    this.nearVectorParams = params
    return this
  }

  withNearText(params: NearTextParams): GraphQLGetBuilder {
    this.nearTextParams = params
    return this
  }

  withNearObject(params: NearObjectParams): GraphQLGetBuilder {
    this.nearObjectParams = params
    return this
  }

  withBm25(params: Bm25Params): GraphQLGetBuilder {
    this.bm25Params = params
    return this
  }

  withHybrid(params: HybridParams): GraphQLGetBuilder {
    this.hybridParams = params
    return this
  }

  withWhere(filter: WhereFilter): GraphQLGetBuilder {
    this.whereFilterValue = filter
    return this
  }

  withSort(specs: SortSpec | SortSpec[]): GraphQLGetBuilder {
    this.sortSpecs = Array.isArray(specs) ? specs : [specs]
    return this
  }

  withGroupBy(params: { path: string[]; groups: number; objectsPerGroup: number }): GraphQLGetBuilder {
    this.groupByValue = params
    return this
  }

  async do(): Promise<GraphQLResponse> {
    if (!this.className) {
      return { errors: [{ message: 'Class name required' }] }
    }

    const internalClass = this.db.classes.get(this.className)
    if (!internalClass) {
      return { errors: [{ message: `Class '${this.className}' not found` }] }
    }

    const { properties, additional } = parseFields(this.fieldsStr)
    const distanceMetric = internalClass.vectorIndexConfig?.distance ?? 'cosine'

    // Collect all objects
    let results: Array<{ obj: WeaviateObject; score: number; distance?: number }> = []

    for (const [, obj] of internalClass.objects) {
      // Apply where filter
      if (this.whereFilterValue && !evaluateWhereFilter(this.whereFilterValue, obj)) {
        continue
      }

      let score = 0
      let distance: number | undefined

      // Vector search
      if (this.nearVectorParams && obj.vector) {
        if (distanceMetric === 'cosine') {
          const similarity = cosineSimilarity(this.nearVectorParams.vector, obj.vector)
          distance = 1 - similarity
          score = similarity
        } else {
          distance = l2SquaredDistance(this.nearVectorParams.vector, obj.vector)
          score = 1 / (1 + distance)
        }

        // Filter by certainty or distance
        if (this.nearVectorParams.certainty !== undefined) {
          const certainty = distanceToCertainty(distance, distanceMetric)
          if (certainty < this.nearVectorParams.certainty) continue
        }
        if (this.nearVectorParams.distance !== undefined) {
          if (distance > this.nearVectorParams.distance) continue
        }
      }

      // Near object search
      if (this.nearObjectParams && obj.vector) {
        const refObj = internalClass.objects.get(this.nearObjectParams.id)
        if (refObj?.vector) {
          if (distanceMetric === 'cosine') {
            const similarity = cosineSimilarity(refObj.vector, obj.vector)
            distance = 1 - similarity
            score = similarity
          } else {
            distance = l2SquaredDistance(refObj.vector, obj.vector)
            score = 1 / (1 + distance)
          }

          // Filter by certainty or distance
          if (this.nearObjectParams.certainty !== undefined) {
            const certainty = distanceToCertainty(distance, distanceMetric)
            if (certainty < this.nearObjectParams.certainty) continue
          }
          if (this.nearObjectParams.distance !== undefined) {
            if (distance > this.nearObjectParams.distance) continue
          }
        }
      }

      // BM25 keyword search
      if (this.bm25Params) {
        const queryTerms = tokenize(this.bm25Params.query)
        const searchProps = this.bm25Params.properties ?? Object.keys(obj.properties)

        let docText = ''
        for (const prop of searchProps) {
          const val = obj.properties[prop]
          if (typeof val === 'string') {
            docText += ' ' + val
          } else if (Array.isArray(val)) {
            docText += ' ' + val.filter((v) => typeof v === 'string').join(' ')
          }
        }

        const docTerms = tokenize(docText)
        score = calculateBM25Score(queryTerms, docTerms, 100) // avg doc length placeholder

        if (score === 0) continue
      }

      // Hybrid search (combines vector and BM25)
      if (this.hybridParams) {
        const alpha = this.hybridParams.alpha ?? 0.5
        let vectorScore = 0
        let keywordScore = 0

        // Vector part
        if (obj.vector && this.hybridParams.vector) {
          if (distanceMetric === 'cosine') {
            vectorScore = cosineSimilarity(this.hybridParams.vector, obj.vector)
            distance = 1 - vectorScore
          } else {
            const dist = l2SquaredDistance(this.hybridParams.vector, obj.vector)
            vectorScore = 1 / (1 + dist)
            distance = dist
          }
        }

        // Keyword part
        const queryTerms = tokenize(this.hybridParams.query)
        const searchProps = this.hybridParams.properties ?? Object.keys(obj.properties)

        let docText = ''
        for (const prop of searchProps) {
          const val = obj.properties[prop]
          if (typeof val === 'string') {
            docText += ' ' + val
          }
        }

        const docTerms = tokenize(docText)
        keywordScore = calculateBM25Score(queryTerms, docTerms, 100)

        // Normalize keyword score (0-1 range)
        keywordScore = Math.min(keywordScore / 10, 1)

        // Combine scores
        score = alpha * vectorScore + (1 - alpha) * keywordScore

        if (score === 0) continue
      }

      // Near text search (simplified - would need embeddings in production)
      if (this.nearTextParams && obj.vector) {
        // In production, this would embed the concepts and do vector search
        // For testing, we do keyword matching
        const concepts = this.nearTextParams.concepts.join(' ').toLowerCase()
        const docText = Object.values(obj.properties)
          .filter((v) => typeof v === 'string')
          .join(' ')
          .toLowerCase()

        const queryTerms = tokenize(concepts)
        const docTerms = tokenize(docText)

        score = calculateBM25Score(queryTerms, docTerms, 100)
        if (score === 0) continue
      }

      // If no search params, include all (for simple gets)
      if (
        !this.nearVectorParams &&
        !this.nearTextParams &&
        !this.nearObjectParams &&
        !this.bm25Params &&
        !this.hybridParams
      ) {
        score = 1
      }

      results.push({ obj, score, distance })
    }

    // Sort by score (descending) or by sort specs
    if (this.sortSpecs.length > 0) {
      results.sort((a, b) => {
        for (const spec of this.sortSpecs) {
          const aVal = getValueByPath(a.obj.properties as Record<string, unknown>, spec.path)
          const bVal = getValueByPath(b.obj.properties as Record<string, unknown>, spec.path)

          let cmp = 0
          if (typeof aVal === 'string' && typeof bVal === 'string') {
            cmp = aVal.localeCompare(bVal)
          } else if (typeof aVal === 'number' && typeof bVal === 'number') {
            cmp = aVal - bVal
          }

          if (cmp !== 0) {
            return spec.order === 'desc' ? -cmp : cmp
          }
        }
        return 0
      })
    } else {
      results.sort((a, b) => b.score - a.score)
    }

    // Apply pagination
    const offset = this.offsetValue ?? 0
    const limit = this.limitValue ?? 10
    results = results.slice(offset, offset + limit)

    // Build response
    const responseObjects: Record<string, unknown>[] = results.map(({ obj, score, distance }) => {
      const result: Record<string, unknown> = {}

      // Include requested properties
      for (const prop of properties) {
        if (prop in obj.properties) {
          result[prop] = obj.properties[prop]
        }
      }

      // Include _additional fields
      if (additional.length > 0) {
        const additionalData: WeaviateAdditional = {}

        for (const field of additional) {
          switch (field) {
            case 'id':
              additionalData.id = obj.id
              break
            case 'vector':
              additionalData.vector = obj.vector
              break
            case 'distance':
              additionalData.distance = distance
              break
            case 'certainty':
              additionalData.certainty =
                distance !== undefined ? distanceToCertainty(distance, distanceMetric) : undefined
              break
            case 'score':
              additionalData.score = score
              break
            case 'creationTimeUnix':
              additionalData.creationTimeUnix = obj.creationTimeUnix
              break
            case 'lastUpdateTimeUnix':
              additionalData.lastUpdateTimeUnix = obj.lastUpdateTimeUnix
              break
          }
        }

        result._additional = additionalData
      }

      return result
    })

    return {
      data: {
        Get: {
          [this.className]: responseObjects,
        },
      },
    }
  }
}

/**
 * GraphQL Aggregate query builder
 */
class GraphQLAggregateBuilder {
  private db: WeaviateDB
  private className: string | null = null
  private fieldsStr: string = ''
  private whereFilterValue: WhereFilter | null = null

  constructor(db: WeaviateDB) {
    this.db = db
  }

  withClassName(name: string): GraphQLAggregateBuilder {
    this.className = name
    return this
  }

  withFields(fields: string): GraphQLAggregateBuilder {
    this.fieldsStr = fields
    return this
  }

  withWhere(filter: WhereFilter): GraphQLAggregateBuilder {
    this.whereFilterValue = filter
    return this
  }

  async do(): Promise<GraphQLResponse> {
    if (!this.className) {
      return { errors: [{ message: 'Class name required' }] }
    }

    const internalClass = this.db.classes.get(this.className)
    if (!internalClass) {
      return { errors: [{ message: `Class '${this.className}' not found` }] }
    }

    // Count matching objects
    let count = 0
    for (const [, obj] of internalClass.objects) {
      if (!this.whereFilterValue || evaluateWhereFilter(this.whereFilterValue, obj)) {
        count++
      }
    }

    return {
      data: {
        Aggregate: {
          [this.className]: [
            {
              meta: { count },
            },
          ],
        },
      },
    }
  }
}

/**
 * GraphQL API
 */
class GraphQLAPI {
  private db: WeaviateDB

  constructor(db: WeaviateDB) {
    this.db = db
  }

  get(): GraphQLGetBuilder {
    return new GraphQLGetBuilder(this.db)
  }

  aggregate(): GraphQLAggregateBuilder {
    return new GraphQLAggregateBuilder(this.db)
  }
}

/**
 * Weaviate Client
 */
export class WeaviateClient {
  readonly schema: SchemaAPI
  readonly data: DataAPI
  readonly batch: BatchAPI
  readonly graphql: GraphQLAPI
  private db: WeaviateDB

  constructor(config: WeaviateClientConfig) {
    this.db = {
      classes: new Map(),
      config,
    }

    this.schema = new SchemaAPI(this.db)
    this.data = new DataAPI(this.db)
    this.batch = new BatchAPI(this.db)
    this.graphql = new GraphQLAPI(this.db)
  }

  /**
   * Check if connection is ready
   */
  async isReady(): Promise<boolean> {
    return true
  }

  /**
   * Get cluster info
   */
  async getMeta(): Promise<{
    hostname: string
    version: string
    modules: Record<string, unknown>
  }> {
    return {
      hostname: this.db.config.host,
      version: '1.24.0-dotdo',
      modules: {},
    }
  }
}

// ============================================================================
// CLIENT FACTORY
// ============================================================================

/**
 * Create a Weaviate client
 */
export const weaviate = {
  client(config: WeaviateClientConfig): WeaviateClient {
    return new WeaviateClient(config)
  },
}

export default weaviate
