/**
 * SPIKE: DO Cost Optimization - Columnar Storage in Single Row
 *
 * Problem: Durable Objects charge per row read/written in SQLite
 * Solution: Store multiple records in a single row as JSON to minimize billing
 *
 * Strategies explored:
 * 1. Row-per-record (baseline) - traditional approach
 * 2. Columnar JSON - store columns as JSON arrays in single row
 * 3. Chunked columnar - store N records per chunk row
 * 4. In-memory buffer with batch flush
 * 5. Delta encoding for append-only data
 *
 * DO SQLite billing facts:
 * - Charged per row read
 * - Charged per row written
 * - Max row size: 2MB (but recommended < 100KB for performance)
 * - Reads are billed even for non-existent rows (EXISTS checks)
 */

// ============================================================================
// Types
// ============================================================================

export interface Thing {
  id: string
  type: string
  data: Record<string, unknown>
  embedding?: Float32Array
  createdAt: number
  updatedAt: number
}

export interface ColumnarChunk {
  chunkId: number
  ids: string[]
  types: string[]
  data: Record<string, unknown>[] // Array of data objects
  embeddings: number[][] | null // Array of embedding arrays (null if none)
  createdAts: number[]
  updatedAts: number[]
  recordCount: number
}

export interface StorageStats {
  strategy: string
  recordCount: number
  rowsWritten: number
  rowsRead: number
  bytesStored: number
  writeTimeMs: number
  readTimeMs: number
  costMultiplier: number // relative to baseline
}

// ============================================================================
// Strategy 1: Row-Per-Record (Baseline)
// ============================================================================

export class RowPerRecordStorage {
  private rows: Map<string, string> = new Map()
  private readCount = 0
  private writeCount = 0

  insert(thing: Thing): void {
    const key = `thing:${thing.id}`
    const value = JSON.stringify({
      ...thing,
      embedding: thing.embedding ? Array.from(thing.embedding) : null,
    })
    this.rows.set(key, value)
    this.writeCount++
  }

  get(id: string): Thing | null {
    this.readCount++
    const key = `thing:${id}`
    const value = this.rows.get(key)
    if (!value) return null
    const parsed = JSON.parse(value)
    return {
      ...parsed,
      embedding: parsed.embedding ? new Float32Array(parsed.embedding) : undefined,
    }
  }

  getAll(): Thing[] {
    const things: Thing[] = []
    for (const value of this.rows.values()) {
      this.readCount++
      const parsed = JSON.parse(value)
      things.push({
        ...parsed,
        embedding: parsed.embedding ? new Float32Array(parsed.embedding) : undefined,
      })
    }
    return things
  }

  getByType(type: string): Thing[] {
    // Must scan all rows - expensive!
    const things: Thing[] = []
    for (const value of this.rows.values()) {
      this.readCount++
      const parsed = JSON.parse(value)
      if (parsed.type === type) {
        things.push({
          ...parsed,
          embedding: parsed.embedding ? new Float32Array(parsed.embedding) : undefined,
        })
      }
    }
    return things
  }

  getStats(): { readCount: number; writeCount: number; rowCount: number } {
    return {
      readCount: this.readCount,
      writeCount: this.writeCount,
      rowCount: this.rows.size,
    }
  }

  reset(): void {
    this.rows.clear()
    this.readCount = 0
    this.writeCount = 0
  }
}

// ============================================================================
// Strategy 2: Columnar JSON Storage
// ============================================================================

export class ColumnarStorage {
  private chunk: ColumnarChunk = this.createEmptyChunk()
  private dirty = false
  private readCount = 0
  private writeCount = 0
  private serializedData: string | null = null

  private createEmptyChunk(): ColumnarChunk {
    return {
      chunkId: 0,
      ids: [],
      types: [],
      data: [],
      embeddings: null,
      createdAts: [],
      updatedAts: [],
      recordCount: 0,
    }
  }

  insert(thing: Thing): void {
    this.chunk.ids.push(thing.id)
    this.chunk.types.push(thing.type)
    this.chunk.data.push(thing.data)
    if (thing.embedding) {
      if (!this.chunk.embeddings) {
        this.chunk.embeddings = []
      }
      this.chunk.embeddings.push(Array.from(thing.embedding))
    } else if (this.chunk.embeddings) {
      this.chunk.embeddings.push([])
    }
    this.chunk.createdAts.push(thing.createdAt)
    this.chunk.updatedAts.push(thing.updatedAt)
    this.chunk.recordCount++
    this.dirty = true
  }

  flush(): void {
    if (this.dirty) {
      this.serializedData = JSON.stringify(this.chunk)
      this.writeCount++ // Single row write for all records!
      this.dirty = false
    }
  }

  load(): void {
    if (this.serializedData) {
      this.chunk = JSON.parse(this.serializedData)
      this.readCount++ // Single row read for all records!
    }
  }

  get(id: string): Thing | null {
    // If not loaded, load first
    if (this.chunk.recordCount === 0 && this.serializedData) {
      this.load()
    }

    const index = this.chunk.ids.indexOf(id)
    if (index === -1) return null

    return this.thingAtIndex(index)
  }

  getAll(): Thing[] {
    // Single read to get all records
    if (this.chunk.recordCount === 0 && this.serializedData) {
      this.load()
    }

    const things: Thing[] = []
    for (let i = 0; i < this.chunk.recordCount; i++) {
      things.push(this.thingAtIndex(i))
    }
    return things
  }

  getByType(type: string): Thing[] {
    // Single read, filter in memory
    if (this.chunk.recordCount === 0 && this.serializedData) {
      this.load()
    }

    const things: Thing[] = []
    for (let i = 0; i < this.chunk.recordCount; i++) {
      if (this.chunk.types[i] === type) {
        things.push(this.thingAtIndex(i))
      }
    }
    return things
  }

  private thingAtIndex(index: number): Thing {
    return {
      id: this.chunk.ids[index],
      type: this.chunk.types[index],
      data: this.chunk.data[index],
      embedding:
        this.chunk.embeddings && this.chunk.embeddings[index]?.length
          ? new Float32Array(this.chunk.embeddings[index])
          : undefined,
      createdAt: this.chunk.createdAts[index],
      updatedAt: this.chunk.updatedAts[index],
    }
  }

  getStats(): { readCount: number; writeCount: number; bytesStored: number } {
    return {
      readCount: this.readCount,
      writeCount: this.writeCount,
      bytesStored: this.serializedData?.length ?? 0,
    }
  }

  reset(): void {
    this.chunk = this.createEmptyChunk()
    this.dirty = false
    this.serializedData = null
    this.readCount = 0
    this.writeCount = 0
  }
}

// ============================================================================
// Strategy 3: Chunked Columnar Storage
// ============================================================================

export class ChunkedColumnarStorage {
  private chunks: Map<number, ColumnarChunk> = new Map()
  private serializedChunks: Map<number, string> = new Map()
  private currentChunkId = 0
  private recordsPerChunk: number
  private readCount = 0
  private writeCount = 0
  private idToChunk: Map<string, number> = new Map()

  constructor(recordsPerChunk = 1000) {
    this.recordsPerChunk = recordsPerChunk
    this.chunks.set(0, this.createEmptyChunk(0))
  }

  private createEmptyChunk(chunkId: number): ColumnarChunk {
    return {
      chunkId,
      ids: [],
      types: [],
      data: [],
      embeddings: null,
      createdAts: [],
      updatedAts: [],
      recordCount: 0,
    }
  }

  insert(thing: Thing): void {
    let chunk = this.chunks.get(this.currentChunkId)!

    if (chunk.recordCount >= this.recordsPerChunk) {
      // Flush current chunk and create new one
      this.flushChunk(this.currentChunkId)
      this.currentChunkId++
      chunk = this.createEmptyChunk(this.currentChunkId)
      this.chunks.set(this.currentChunkId, chunk)
    }

    chunk.ids.push(thing.id)
    chunk.types.push(thing.type)
    chunk.data.push(thing.data)
    if (thing.embedding) {
      if (!chunk.embeddings) {
        chunk.embeddings = []
      }
      chunk.embeddings.push(Array.from(thing.embedding))
    } else if (chunk.embeddings) {
      chunk.embeddings.push([])
    }
    chunk.createdAts.push(thing.createdAt)
    chunk.updatedAts.push(thing.updatedAt)
    chunk.recordCount++
    this.idToChunk.set(thing.id, this.currentChunkId)
  }

  private flushChunk(chunkId: number): void {
    const chunk = this.chunks.get(chunkId)
    if (chunk && chunk.recordCount > 0) {
      this.serializedChunks.set(chunkId, JSON.stringify(chunk))
      this.writeCount++
    }
  }

  flush(): void {
    // Flush all dirty chunks
    for (const [chunkId, chunk] of this.chunks) {
      if (chunk.recordCount > 0) {
        this.serializedChunks.set(chunkId, JSON.stringify(chunk))
        this.writeCount++
      }
    }
  }

  private loadChunk(chunkId: number): ColumnarChunk | null {
    if (this.chunks.has(chunkId) && this.chunks.get(chunkId)!.recordCount > 0) {
      return this.chunks.get(chunkId)!
    }
    const serialized = this.serializedChunks.get(chunkId)
    if (!serialized) return null
    this.readCount++
    const chunk = JSON.parse(serialized)
    this.chunks.set(chunkId, chunk)
    return chunk
  }

  get(id: string): Thing | null {
    const chunkId = this.idToChunk.get(id)
    if (chunkId === undefined) return null

    const chunk = this.loadChunk(chunkId)
    if (!chunk) return null

    const index = chunk.ids.indexOf(id)
    if (index === -1) return null

    return this.thingAtIndex(chunk, index)
  }

  getAll(): Thing[] {
    const things: Thing[] = []
    const totalChunks = this.currentChunkId + 1
    for (let i = 0; i < totalChunks; i++) {
      const chunk = this.loadChunk(i)
      if (chunk) {
        for (let j = 0; j < chunk.recordCount; j++) {
          things.push(this.thingAtIndex(chunk, j))
        }
      }
    }
    return things
  }

  getByType(type: string): Thing[] {
    const things: Thing[] = []
    const totalChunks = this.currentChunkId + 1
    for (let i = 0; i < totalChunks; i++) {
      const chunk = this.loadChunk(i)
      if (chunk) {
        for (let j = 0; j < chunk.recordCount; j++) {
          if (chunk.types[j] === type) {
            things.push(this.thingAtIndex(chunk, j))
          }
        }
      }
    }
    return things
  }

  private thingAtIndex(chunk: ColumnarChunk, index: number): Thing {
    return {
      id: chunk.ids[index],
      type: chunk.types[index],
      data: chunk.data[index],
      embedding:
        chunk.embeddings && chunk.embeddings[index]?.length
          ? new Float32Array(chunk.embeddings[index])
          : undefined,
      createdAt: chunk.createdAts[index],
      updatedAt: chunk.updatedAts[index],
    }
  }

  getStats(): {
    readCount: number
    writeCount: number
    chunkCount: number
    bytesStored: number
  } {
    let bytesStored = 0
    for (const serialized of this.serializedChunks.values()) {
      bytesStored += serialized.length
    }
    return {
      readCount: this.readCount,
      writeCount: this.writeCount,
      chunkCount: this.serializedChunks.size,
      bytesStored,
    }
  }

  reset(): void {
    this.chunks.clear()
    this.serializedChunks.clear()
    this.currentChunkId = 0
    this.chunks.set(0, this.createEmptyChunk(0))
    this.readCount = 0
    this.writeCount = 0
    this.idToChunk.clear()
  }
}

// ============================================================================
// Strategy 4: In-Memory Buffer with Batch Flush
// ============================================================================

export class BufferedStorage {
  private buffer: Thing[] = []
  private flushThreshold: number
  private storage: ColumnarStorage
  private flushCount = 0

  constructor(flushThreshold = 100) {
    this.flushThreshold = flushThreshold
    this.storage = new ColumnarStorage()
  }

  insert(thing: Thing): void {
    this.buffer.push(thing)
    if (this.buffer.length >= this.flushThreshold) {
      this.flush()
    }
  }

  flush(): void {
    if (this.buffer.length === 0) return

    // Insert all buffered items
    for (const thing of this.buffer) {
      this.storage.insert(thing)
    }
    this.storage.flush()
    this.buffer = []
    this.flushCount++
  }

  get(id: string): Thing | null {
    // Check buffer first
    const buffered = this.buffer.find((t) => t.id === id)
    if (buffered) return buffered
    return this.storage.get(id)
  }

  getAll(): Thing[] {
    return [...this.buffer, ...this.storage.getAll()]
  }

  getStats(): {
    bufferedCount: number
    flushCount: number
    storageStats: ReturnType<ColumnarStorage['getStats']>
  } {
    return {
      bufferedCount: this.buffer.length,
      flushCount: this.flushCount,
      storageStats: this.storage.getStats(),
    }
  }

  reset(): void {
    this.buffer = []
    this.flushCount = 0
    this.storage.reset()
  }
}

// ============================================================================
// Strategy 5: Column-Oriented Storage (True Columnar)
// ============================================================================

export interface ColumnStore {
  // Each column stored separately for better compression
  ids: string[]
  types: string[]
  dataJson: string[] // Each data object as JSON string
  embeddings: Float32Array | null // Packed embeddings
  embeddingDim: number
  createdAts: Float64Array
  updatedAts: Float64Array
  count: number
}

export class TrueColumnarStorage {
  private columns: ColumnStore = {
    ids: [],
    types: [],
    dataJson: [],
    embeddings: null,
    embeddingDim: 0,
    createdAts: new Float64Array(0),
    updatedAts: new Float64Array(0),
    count: 0,
  }
  private dirty = false
  private readCount = 0
  private writeCount = 0
  private serializedColumns: Map<string, ArrayBuffer | string> = new Map()
  private idIndex: Map<string, number> = new Map()

  insert(thing: Thing): void {
    const index = this.columns.count

    // Grow arrays if needed
    if (index >= this.columns.createdAts.length) {
      this.growArrays()
    }

    this.columns.ids.push(thing.id)
    this.columns.types.push(thing.type)
    this.columns.dataJson.push(JSON.stringify(thing.data))

    if (thing.embedding) {
      if (!this.columns.embeddings) {
        this.columns.embeddingDim = thing.embedding.length
        this.columns.embeddings = new Float32Array(1024 * this.columns.embeddingDim)
      }
      const offset = index * this.columns.embeddingDim
      this.columns.embeddings.set(thing.embedding, offset)
    }

    this.columns.createdAts[index] = thing.createdAt
    this.columns.updatedAts[index] = thing.updatedAt
    this.columns.count++
    this.idIndex.set(thing.id, index)
    this.dirty = true
  }

  private growArrays(): void {
    const newSize = Math.max(1024, this.columns.createdAts.length * 2)

    const newCreatedAts = new Float64Array(newSize)
    newCreatedAts.set(this.columns.createdAts)
    this.columns.createdAts = newCreatedAts

    const newUpdatedAts = new Float64Array(newSize)
    newUpdatedAts.set(this.columns.updatedAts)
    this.columns.updatedAts = newUpdatedAts

    if (this.columns.embeddings && this.columns.embeddingDim > 0) {
      const newEmbeddings = new Float32Array(newSize * this.columns.embeddingDim)
      newEmbeddings.set(this.columns.embeddings)
      this.columns.embeddings = newEmbeddings
    }
  }

  flush(): void {
    if (!this.dirty) return

    // Store each column separately - allows selective loading
    this.serializedColumns.set('ids', JSON.stringify(this.columns.ids))
    this.serializedColumns.set('types', JSON.stringify(this.columns.types))
    this.serializedColumns.set('dataJson', JSON.stringify(this.columns.dataJson))
    this.serializedColumns.set(
      'timestamps',
      JSON.stringify({
        createdAts: Array.from(this.columns.createdAts.slice(0, this.columns.count)),
        updatedAts: Array.from(this.columns.updatedAts.slice(0, this.columns.count)),
      })
    )
    if (this.columns.embeddings) {
      this.serializedColumns.set(
        'embeddings',
        this.columns.embeddings.slice(0, this.columns.count * this.columns.embeddingDim).buffer
      )
      this.serializedColumns.set('embeddingDim', String(this.columns.embeddingDim))
    }
    this.serializedColumns.set('count', String(this.columns.count))

    // Count writes - one per column stored
    this.writeCount += this.serializedColumns.size
    this.dirty = false
  }

  get(id: string): Thing | null {
    const index = this.idIndex.get(id)
    if (index === undefined) return null
    return this.thingAtIndex(index)
  }

  getAll(): Thing[] {
    const things: Thing[] = []
    for (let i = 0; i < this.columns.count; i++) {
      things.push(this.thingAtIndex(i))
    }
    return things
  }

  // Columnar advantage: can load only needed columns
  getIdsOnly(): string[] {
    this.readCount++ // Only read ids column
    return [...this.columns.ids]
  }

  getTypesOnly(): string[] {
    this.readCount++ // Only read types column
    return [...this.columns.types]
  }

  private thingAtIndex(index: number): Thing {
    const embeddingOffset = index * this.columns.embeddingDim
    return {
      id: this.columns.ids[index],
      type: this.columns.types[index],
      data: JSON.parse(this.columns.dataJson[index]),
      embedding:
        this.columns.embeddings && this.columns.embeddingDim > 0
          ? this.columns.embeddings.slice(embeddingOffset, embeddingOffset + this.columns.embeddingDim)
          : undefined,
      createdAt: this.columns.createdAts[index],
      updatedAt: this.columns.updatedAts[index],
    }
  }

  getStats(): {
    readCount: number
    writeCount: number
    columnCount: number
    bytesStored: number
  } {
    let bytesStored = 0
    for (const value of this.serializedColumns.values()) {
      if (typeof value === 'string') {
        bytesStored += value.length
      } else {
        bytesStored += value.byteLength
      }
    }
    return {
      readCount: this.readCount,
      writeCount: this.writeCount,
      columnCount: this.serializedColumns.size,
      bytesStored,
    }
  }

  reset(): void {
    this.columns = {
      ids: [],
      types: [],
      dataJson: [],
      embeddings: null,
      embeddingDim: 0,
      createdAts: new Float64Array(0),
      updatedAts: new Float64Array(0),
      count: 0,
    }
    this.dirty = false
    this.readCount = 0
    this.writeCount = 0
    this.serializedColumns.clear()
    this.idIndex.clear()
  }
}

// ============================================================================
// Strategy 6: ClickHouse-Style Columnar (Column Per Row)
// ============================================================================

/**
 * TRUE ClickHouse columnar model: each column is stored as a separate SQLite row
 *
 * SQLite rows:
 *   | key         | value                                    |
 *   |-------------|------------------------------------------|
 *   | ids         | ["id1", "id2", "id3", ...]               |
 *   | types       | ["user", "order", "user", ...]           |
 *   | data        | [{...}, {...}, {...}, ...]               |
 *   | embeddings  | <binary blob>                            |
 *   | timestamps  | {"created": [...], "updated": [...]}     |
 *   | _meta       | {"count": 10000, "embeddingDim": 128}    |
 *
 * Benefits:
 * - Read only columns needed (SELECT id, type = 2 row reads, not N)
 * - Same-type data compresses better
 * - Matches ClickHouse internal storage model
 * - Projection pushdown: only load required columns
 */
export class ClickHouseColumnarStorage {
  private ids: string[] = []
  private types: string[] = []
  private data: Record<string, unknown>[] = []
  private embeddings: number[][] = []
  private createdAts: number[] = []
  private updatedAts: number[] = []
  private embeddingDim = 0

  // Simulate SQLite row storage
  private rows: Map<string, string | ArrayBuffer> = new Map()
  private dirtyColumns: Set<string> = new Set()
  private readCount = 0
  private writeCount = 0
  private idIndex: Map<string, number> = new Map()

  insert(thing: Thing): void {
    const index = this.ids.length

    this.ids.push(thing.id)
    this.types.push(thing.type)
    this.data.push(thing.data)

    if (thing.embedding) {
      if (this.embeddingDim === 0) {
        this.embeddingDim = thing.embedding.length
      }
      this.embeddings.push(Array.from(thing.embedding))
    } else {
      this.embeddings.push([])
    }

    this.createdAts.push(thing.createdAt)
    this.updatedAts.push(thing.updatedAt)
    this.idIndex.set(thing.id, index)

    // Mark all columns as dirty
    this.dirtyColumns.add('ids')
    this.dirtyColumns.add('types')
    this.dirtyColumns.add('data')
    this.dirtyColumns.add('embeddings')
    this.dirtyColumns.add('timestamps')
    this.dirtyColumns.add('_meta')
  }

  flush(): void {
    // Only write dirty columns
    if (this.dirtyColumns.has('ids')) {
      this.rows.set('ids', JSON.stringify(this.ids))
      this.writeCount++
    }
    if (this.dirtyColumns.has('types')) {
      this.rows.set('types', JSON.stringify(this.types))
      this.writeCount++
    }
    if (this.dirtyColumns.has('data')) {
      this.rows.set('data', JSON.stringify(this.data))
      this.writeCount++
    }
    if (this.dirtyColumns.has('embeddings') && this.embeddings.some((e) => e.length > 0)) {
      // Pack embeddings into a flat Float32Array for efficient storage
      const packedEmbeddings = new Float32Array(this.ids.length * this.embeddingDim)
      for (let i = 0; i < this.embeddings.length; i++) {
        if (this.embeddings[i].length > 0) {
          packedEmbeddings.set(this.embeddings[i], i * this.embeddingDim)
        }
      }
      this.rows.set('embeddings', packedEmbeddings.buffer)
      this.writeCount++
    }
    if (this.dirtyColumns.has('timestamps')) {
      this.rows.set(
        'timestamps',
        JSON.stringify({
          created: this.createdAts,
          updated: this.updatedAts,
        })
      )
      this.writeCount++
    }
    if (this.dirtyColumns.has('_meta')) {
      this.rows.set(
        '_meta',
        JSON.stringify({
          count: this.ids.length,
          embeddingDim: this.embeddingDim,
        })
      )
      this.writeCount++
    }

    this.dirtyColumns.clear()
  }

  // Load specific columns only - key optimization!
  private loadColumn(name: string): void {
    const value = this.rows.get(name)
    if (!value) return
    this.readCount++

    switch (name) {
      case 'ids':
        this.ids = JSON.parse(value as string)
        // Rebuild index
        this.idIndex.clear()
        for (let i = 0; i < this.ids.length; i++) {
          this.idIndex.set(this.ids[i], i)
        }
        break
      case 'types':
        this.types = JSON.parse(value as string)
        break
      case 'data':
        this.data = JSON.parse(value as string)
        break
      case 'embeddings': {
        const meta = JSON.parse(this.rows.get('_meta') as string)
        this.embeddingDim = meta.embeddingDim
        if (value instanceof ArrayBuffer) {
          const flat = new Float32Array(value)
          this.embeddings = []
          for (let i = 0; i < meta.count; i++) {
            const offset = i * this.embeddingDim
            this.embeddings.push(Array.from(flat.slice(offset, offset + this.embeddingDim)))
          }
        }
        break
      }
      case 'timestamps': {
        const ts = JSON.parse(value as string)
        this.createdAts = ts.created
        this.updatedAts = ts.updated
        break
      }
    }
  }

  // Projection pushdown: only load columns needed for query
  get(id: string, columns: ('id' | 'type' | 'data' | 'embedding' | 'timestamps')[] = ['id', 'type', 'data', 'embedding', 'timestamps']): Partial<Thing> | null {
    // Always need ids to find the record
    if (this.ids.length === 0 && this.rows.has('ids')) {
      this.loadColumn('ids')
    }

    const index = this.idIndex.get(id)
    if (index === undefined) return null

    const result: Partial<Thing> = { id }

    if (columns.includes('type')) {
      if (this.types.length === 0 && this.rows.has('types')) {
        this.loadColumn('types')
      }
      result.type = this.types[index]
    }

    if (columns.includes('data')) {
      if (this.data.length === 0 && this.rows.has('data')) {
        this.loadColumn('data')
      }
      result.data = this.data[index]
    }

    if (columns.includes('embedding')) {
      if (this.embeddings.length === 0 && this.rows.has('embeddings')) {
        this.loadColumn('embeddings')
      }
      if (this.embeddings[index]?.length > 0) {
        result.embedding = new Float32Array(this.embeddings[index])
      }
    }

    if (columns.includes('timestamps')) {
      if (this.createdAts.length === 0 && this.rows.has('timestamps')) {
        this.loadColumn('timestamps')
      }
      result.createdAt = this.createdAts[index]
      result.updatedAt = this.updatedAts[index]
    }

    return result
  }

  // Count query: only reads _meta row (1 row read!)
  count(): number {
    if (this.ids.length > 0) return this.ids.length
    const meta = this.rows.get('_meta')
    if (meta) {
      this.readCount++
      return JSON.parse(meta as string).count
    }
    return 0
  }

  // Get all IDs: only reads ids row (1 row read!)
  getAllIds(): string[] {
    if (this.ids.length === 0 && this.rows.has('ids')) {
      this.loadColumn('ids')
    }
    return [...this.ids]
  }

  // Get all types: only reads types row (1 row read!)
  getAllTypes(): string[] {
    if (this.types.length === 0 && this.rows.has('types')) {
      this.loadColumn('types')
    }
    return [...this.types]
  }

  // Filter by type: reads ids + types (2 row reads!)
  getByType(type: string): string[] {
    if (this.ids.length === 0 && this.rows.has('ids')) {
      this.loadColumn('ids')
    }
    if (this.types.length === 0 && this.rows.has('types')) {
      this.loadColumn('types')
    }

    const matchingIds: string[] = []
    for (let i = 0; i < this.types.length; i++) {
      if (this.types[i] === type) {
        matchingIds.push(this.ids[i])
      }
    }
    return matchingIds
  }

  // Get embeddings only: reads embeddings + _meta (2 row reads!)
  getAllEmbeddings(): Map<string, Float32Array> {
    if (this.ids.length === 0 && this.rows.has('ids')) {
      this.loadColumn('ids')
    }
    if (this.embeddings.length === 0 && this.rows.has('embeddings')) {
      this.loadColumn('embeddings')
    }

    const result = new Map<string, Float32Array>()
    for (let i = 0; i < this.ids.length; i++) {
      if (this.embeddings[i]?.length > 0) {
        result.set(this.ids[i], new Float32Array(this.embeddings[i]))
      }
    }
    return result
  }

  // Full scan: reads all columns (6 row reads for N records!)
  getAll(): Thing[] {
    const columns = ['ids', 'types', 'data', 'embeddings', 'timestamps'] as const
    for (const col of columns) {
      if (this.rows.has(col)) {
        this.loadColumn(col)
      }
    }

    const things: Thing[] = []
    for (let i = 0; i < this.ids.length; i++) {
      things.push({
        id: this.ids[i],
        type: this.types[i],
        data: this.data[i],
        embedding: this.embeddings[i]?.length > 0 ? new Float32Array(this.embeddings[i]) : undefined,
        createdAt: this.createdAts[i],
        updatedAt: this.updatedAts[i],
      })
    }
    return things
  }

  getStats(): {
    readCount: number
    writeCount: number
    columnCount: number
    bytesStored: number
    recordCount: number
  } {
    let bytesStored = 0
    for (const value of this.rows.values()) {
      if (typeof value === 'string') {
        bytesStored += value.length
      } else {
        bytesStored += value.byteLength
      }
    }
    return {
      readCount: this.readCount,
      writeCount: this.writeCount,
      columnCount: this.rows.size,
      bytesStored,
      recordCount: this.ids.length,
    }
  }

  reset(): void {
    this.ids = []
    this.types = []
    this.data = []
    this.embeddings = []
    this.createdAts = []
    this.updatedAts = []
    this.embeddingDim = 0
    this.rows.clear()
    this.dirtyColumns.clear()
    this.readCount = 0
    this.writeCount = 0
    this.idIndex.clear()
  }

  /**
   * Generate SQL for DO SQLite - each column is a row!
   */
  static createTableSQL(tableName: string): string {
    return `
      CREATE TABLE IF NOT EXISTS ${tableName} (
        column_name TEXT PRIMARY KEY,
        column_data BLOB NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `
  }

  /**
   * Cost comparison for various query patterns
   */
  static queryCostComparison(recordCount: number): {
    query: string
    rowPerRecord: number
    columnar: number
    savings: string
  }[] {
    return [
      {
        query: 'SELECT COUNT(*)',
        rowPerRecord: recordCount, // Must scan all rows
        columnar: 1, // Just read _meta
        savings: `${Math.round((1 - 1 / recordCount) * 100)}%`,
      },
      {
        query: 'SELECT id FROM things',
        rowPerRecord: recordCount,
        columnar: 1, // Just read ids column
        savings: `${Math.round((1 - 1 / recordCount) * 100)}%`,
      },
      {
        query: 'SELECT id, type FROM things',
        rowPerRecord: recordCount,
        columnar: 2, // Read ids + types
        savings: `${Math.round((1 - 2 / recordCount) * 100)}%`,
      },
      {
        query: "SELECT id FROM things WHERE type = 'user'",
        rowPerRecord: recordCount,
        columnar: 2, // Read ids + types
        savings: `${Math.round((1 - 2 / recordCount) * 100)}%`,
      },
      {
        query: 'SELECT * FROM things',
        rowPerRecord: recordCount,
        columnar: 6, // All columns
        savings: `${Math.round((1 - 6 / recordCount) * 100)}%`,
      },
      {
        query: 'SELECT embedding FROM things',
        rowPerRecord: recordCount,
        columnar: 2, // ids + embeddings
        savings: `${Math.round((1 - 2 / recordCount) * 100)}%`,
      },
      {
        query: 'INSERT 1000 records',
        rowPerRecord: 1000, // 1000 row writes
        columnar: 6, // 6 column writes
        savings: `${Math.round((1 - 6 / 1000) * 100)}%`,
      },
    ]
  }
}

// ============================================================================
// Benchmark Utilities
// ============================================================================

export function generateTestThings(count: number, withEmbeddings = false, embeddingDim = 128): Thing[] {
  const things: Thing[] = []
  const types = ['user', 'order', 'product', 'event', 'session']

  for (let i = 0; i < count; i++) {
    things.push({
      id: `thing-${i}`,
      type: types[i % types.length],
      data: {
        name: `Item ${i}`,
        value: Math.random() * 1000,
        tags: ['tag1', 'tag2', 'tag3'].slice(0, (i % 3) + 1),
        nested: {
          level1: {
            level2: `deep-${i}`,
          },
        },
      },
      embedding: withEmbeddings ? new Float32Array(embeddingDim).map(() => Math.random()) : undefined,
      createdAt: Date.now() - i * 1000,
      updatedAt: Date.now(),
    })
  }
  return things
}

export interface BenchmarkResult {
  strategy: string
  recordCount: number
  insertTimeMs: number
  getAllTimeMs: number
  getByTypeTimeMs: number
  getSingleTimeMs: number
  rowsWritten: number
  rowsRead: number
  bytesStored: number
  costSavingsPercent: number // vs row-per-record
}

export function runBenchmark(
  recordCount: number,
  withEmbeddings = false
): {
  baseline: BenchmarkResult
  columnar: BenchmarkResult
  chunked: BenchmarkResult
  buffered: BenchmarkResult
  trueColumnar: BenchmarkResult
} {
  const things = generateTestThings(recordCount, withEmbeddings)

  // Strategy 1: Row-per-record (baseline)
  const rowStorage = new RowPerRecordStorage()
  let start = performance.now()
  for (const thing of things) {
    rowStorage.insert(thing)
  }
  const baselineInsertTime = performance.now() - start

  start = performance.now()
  rowStorage.getAll()
  const baselineGetAllTime = performance.now() - start

  start = performance.now()
  rowStorage.getByType('user')
  const baselineGetByTypeTime = performance.now() - start

  start = performance.now()
  rowStorage.get(things[Math.floor(recordCount / 2)].id)
  const baselineGetSingleTime = performance.now() - start

  const baselineStats = rowStorage.getStats()

  // Strategy 2: Columnar JSON
  const columnarStorage = new ColumnarStorage()
  start = performance.now()
  for (const thing of things) {
    columnarStorage.insert(thing)
  }
  columnarStorage.flush()
  const columnarInsertTime = performance.now() - start

  start = performance.now()
  columnarStorage.getAll()
  const columnarGetAllTime = performance.now() - start

  // Reset read count for accurate measurement
  columnarStorage.reset()
  for (const thing of things) {
    columnarStorage.insert(thing)
  }
  columnarStorage.flush()
  columnarStorage['chunk'] = columnarStorage['createEmptyChunk']() // Force reload

  start = performance.now()
  columnarStorage.getByType('user')
  const columnarGetByTypeTime = performance.now() - start

  start = performance.now()
  columnarStorage.get(things[Math.floor(recordCount / 2)].id)
  const columnarGetSingleTime = performance.now() - start

  const columnarStats = columnarStorage.getStats()

  // Strategy 3: Chunked columnar (1000 records per chunk)
  const chunkedStorage = new ChunkedColumnarStorage(1000)
  start = performance.now()
  for (const thing of things) {
    chunkedStorage.insert(thing)
  }
  chunkedStorage.flush()
  const chunkedInsertTime = performance.now() - start

  start = performance.now()
  chunkedStorage.getAll()
  const chunkedGetAllTime = performance.now() - start

  start = performance.now()
  chunkedStorage.getByType('user')
  const chunkedGetByTypeTime = performance.now() - start

  start = performance.now()
  chunkedStorage.get(things[Math.floor(recordCount / 2)].id)
  const chunkedGetSingleTime = performance.now() - start

  const chunkedStats = chunkedStorage.getStats()

  // Strategy 4: Buffered storage (100 record buffer)
  const bufferedStorage = new BufferedStorage(100)
  start = performance.now()
  for (const thing of things) {
    bufferedStorage.insert(thing)
  }
  bufferedStorage.flush()
  const bufferedInsertTime = performance.now() - start

  start = performance.now()
  bufferedStorage.getAll()
  const bufferedGetAllTime = performance.now() - start

  const bufferedStats = bufferedStorage.getStats()

  // Strategy 5: True columnar
  const trueColumnarStorage = new TrueColumnarStorage()
  start = performance.now()
  for (const thing of things) {
    trueColumnarStorage.insert(thing)
  }
  trueColumnarStorage.flush()
  const trueColumnarInsertTime = performance.now() - start

  start = performance.now()
  trueColumnarStorage.getAll()
  const trueColumnarGetAllTime = performance.now() - start

  start = performance.now()
  trueColumnarStorage.getIdsOnly()
  const trueColumnarGetSingleTime = performance.now() - start

  const trueColumnarStats = trueColumnarStorage.getStats()

  // Calculate cost savings
  const baselineRowOps = baselineStats.writeCount + baselineStats.readCount
  const columnarRowOps = columnarStats.writeCount + columnarStats.readCount
  const chunkedRowOps = chunkedStats.writeCount + chunkedStats.readCount

  return {
    baseline: {
      strategy: 'row-per-record',
      recordCount,
      insertTimeMs: baselineInsertTime,
      getAllTimeMs: baselineGetAllTime,
      getByTypeTimeMs: baselineGetByTypeTime,
      getSingleTimeMs: baselineGetSingleTime,
      rowsWritten: baselineStats.writeCount,
      rowsRead: baselineStats.readCount,
      bytesStored: 0, // Not tracked for baseline
      costSavingsPercent: 0,
    },
    columnar: {
      strategy: 'columnar-json',
      recordCount,
      insertTimeMs: columnarInsertTime,
      getAllTimeMs: columnarGetAllTime,
      getByTypeTimeMs: columnarGetByTypeTime,
      getSingleTimeMs: columnarGetSingleTime,
      rowsWritten: columnarStats.writeCount,
      rowsRead: columnarStats.readCount,
      bytesStored: columnarStats.bytesStored,
      costSavingsPercent: Math.round((1 - columnarRowOps / baselineRowOps) * 100),
    },
    chunked: {
      strategy: 'chunked-columnar',
      recordCount,
      insertTimeMs: chunkedInsertTime,
      getAllTimeMs: chunkedGetAllTime,
      getByTypeTimeMs: chunkedGetByTypeTime,
      getSingleTimeMs: chunkedGetSingleTime,
      rowsWritten: chunkedStats.writeCount,
      rowsRead: chunkedStats.readCount,
      bytesStored: chunkedStats.bytesStored,
      costSavingsPercent: Math.round((1 - chunkedRowOps / baselineRowOps) * 100),
    },
    buffered: {
      strategy: 'buffered',
      recordCount,
      insertTimeMs: bufferedInsertTime,
      getAllTimeMs: bufferedGetAllTime,
      getByTypeTimeMs: 0, // Not implemented
      getSingleTimeMs: 0, // Not meaningful
      rowsWritten: bufferedStats.storageStats.writeCount,
      rowsRead: bufferedStats.storageStats.readCount,
      bytesStored: bufferedStats.storageStats.bytesStored,
      costSavingsPercent: Math.round(
        (1 - (bufferedStats.storageStats.writeCount + bufferedStats.storageStats.readCount) / baselineRowOps) * 100
      ),
    },
    trueColumnar: {
      strategy: 'true-columnar',
      recordCount,
      insertTimeMs: trueColumnarInsertTime,
      getAllTimeMs: trueColumnarGetAllTime,
      getByTypeTimeMs: 0,
      getSingleTimeMs: trueColumnarGetSingleTime,
      rowsWritten: trueColumnarStats.writeCount,
      rowsRead: trueColumnarStats.readCount,
      bytesStored: trueColumnarStats.bytesStored,
      costSavingsPercent: Math.round(
        (1 - (trueColumnarStats.writeCount + trueColumnarStats.readCount) / baselineRowOps) * 100
      ),
    },
  }
}

// ============================================================================
// SQL-Compatible Wrapper for DO SQLite
// ============================================================================

export interface DOSQLiteRow {
  key: string
  value: string // JSON-encoded columnar data
  metadata: string // JSON-encoded metadata (count, types, etc.)
}

/**
 * Wraps columnar storage for use with actual DO SQLite
 * Design principle: minimize row count while maintaining query capability
 */
export class DOColumnarWrapper {
  private tableName: string
  private chunkSize: number

  constructor(tableName: string, chunkSize = 10000) {
    this.tableName = tableName
    this.chunkSize = chunkSize
  }

  /**
   * Generate SQL to create the columnar storage table
   * Uses just 2 columns: key (chunk identifier) and value (JSON blob)
   */
  createTableSQL(): string {
    return `
      CREATE TABLE IF NOT EXISTS ${this.tableName} (
        chunk_id INTEGER PRIMARY KEY,
        data TEXT NOT NULL,
        record_count INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `
  }

  /**
   * Generate SQL to upsert a chunk
   */
  upsertChunkSQL(chunk: ColumnarChunk): { sql: string; params: unknown[] } {
    const data = JSON.stringify({
      ids: chunk.ids,
      types: chunk.types,
      data: chunk.data,
      embeddings: chunk.embeddings,
      createdAts: chunk.createdAts,
      updatedAts: chunk.updatedAts,
    })

    return {
      sql: `
        INSERT INTO ${this.tableName} (chunk_id, data, record_count, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(chunk_id) DO UPDATE SET
          data = excluded.data,
          record_count = excluded.record_count,
          updated_at = excluded.updated_at
      `,
      params: [chunk.chunkId, data, chunk.recordCount, Date.now(), Date.now()],
    }
  }

  /**
   * Generate SQL to read a single chunk
   * Cost: 1 row read for up to chunkSize records
   */
  readChunkSQL(chunkId: number): { sql: string; params: unknown[] } {
    return {
      sql: `SELECT data FROM ${this.tableName} WHERE chunk_id = ?`,
      params: [chunkId],
    }
  }

  /**
   * Generate SQL to get chunk metadata (without loading full data)
   * Useful for query planning
   */
  getChunkMetadataSQL(): string {
    return `SELECT chunk_id, record_count FROM ${this.tableName} ORDER BY chunk_id`
  }

  /**
   * Calculate cost savings
   */
  calculateCostSavings(recordCount: number): {
    rowPerRecord: { writes: number; reads: number }
    columnar: { writes: number; reads: number }
    savingsPercent: number
  } {
    const chunkCount = Math.ceil(recordCount / this.chunkSize)

    return {
      rowPerRecord: {
        writes: recordCount, // One write per record
        reads: recordCount, // One read per record (full scan)
      },
      columnar: {
        writes: chunkCount, // One write per chunk
        reads: chunkCount, // One read per chunk (full scan)
      },
      savingsPercent: Math.round((1 - chunkCount / recordCount) * 100),
    }
  }
}
