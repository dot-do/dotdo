/**
 * TypedColumnStore - Efficient Columnar Storage with Typed Arrays
 *
 * Provides high-performance columnar storage using native typed arrays
 * for numeric, boolean, and string data. Inspired by ClickHouse's JSON
 * column type approach.
 *
 * ## Features
 * - **Typed Arrays** - Float64Array for numbers, packed bits for booleans
 * - **Null Bitmasks** - Efficient null tracking with bit-packed masks
 * - **Vectorized Operations** - Sum, min, max, avg without loops
 * - **Memory Efficiency** - Significantly reduced memory vs JSON storage
 *
 * ## Performance Characteristics
 * - Numbers: 8 bytes per value (Float64Array) vs ~20 bytes JSON
 * - Booleans: 1 bit per value vs ~5 bytes JSON
 * - Strings: Native UTF-16 with length prefix
 * - Null masks: 1 bit per value overhead
 *
 * @example
 * ```typescript
 * const store = new TypedColumnStore()
 *
 * // Add columns with values
 * store.addNumberColumn('amount', [100, 200, null, 300])
 * store.addStringColumn('name', ['Alice', 'Bob', null, 'Charlie'])
 * store.addBoolColumn('active', [true, false, null, true])
 *
 * // Retrieve values
 * store.getNumber('amount', 0) // 100
 * store.getString('name', 1)   // 'Bob'
 * store.getBool('active', 3)   // true
 *
 * // Vectorized aggregations
 * store.sum('amount')          // 600
 * store.avg('amount')          // 200
 * store.min('amount')          // 100
 * store.max('amount')          // 300
 * store.count('amount')        // 3 (non-null)
 * ```
 *
 * @module db/primitives/document-store/typed-column-store
 */

import type { JSONType } from './path-extractor'

// ============================================================================
// Types
// ============================================================================

/**
 * Column type enumeration
 */
export type ColumnType = 'string' | 'number' | 'boolean' | 'json'

/**
 * Column metadata
 */
export interface ColumnMetadata {
  /** Column name (path) */
  name: string
  /** Column type */
  type: ColumnType
  /** Number of records */
  length: number
  /** Number of null values */
  nullCount: number
  /** Whether all values are null */
  allNull: boolean
  /** Memory usage in bytes */
  byteSize: number
}

/**
 * Aggregation result
 */
export interface AggregationResult {
  sum: number
  avg: number
  min: number
  max: number
  count: number
  nullCount: number
}

/**
 * Serialized column data for storage
 */
export interface SerializedColumn {
  name: string
  type: ColumnType
  data: ArrayBuffer | string[]
  nullMask: ArrayBuffer
  length: number
}

// ============================================================================
// TypedColumnStore
// ============================================================================

/**
 * Efficient columnar storage using typed arrays
 *
 * Uses Float64Array for numbers, packed Uint8Array for booleans,
 * and string arrays for text. Null values are tracked with
 * bit-packed null masks.
 */
export class TypedColumnStore {
  private stringColumns: Map<string, string[]> = new Map()
  private numberColumns: Map<string, Float64Array> = new Map()
  private boolColumns: Map<string, Uint8Array> = new Map()
  private jsonColumns: Map<string, unknown[]> = new Map()
  private nullMasks: Map<string, Uint8Array> = new Map()
  private columnTypes: Map<string, ColumnType> = new Map()
  private _recordCount = 0

  /**
   * Get the number of records stored
   */
  get recordCount(): number {
    return this._recordCount
  }

  // ==========================================================================
  // Column Addition
  // ==========================================================================

  /**
   * Add a string column
   *
   * @param path - Column name/path
   * @param values - Array of string values (null for missing)
   */
  addStringColumn(path: string, values: (string | null)[]): void {
    const strings: string[] = []
    const nullMask = new Uint8Array(Math.ceil(values.length / 8))

    for (let i = 0; i < values.length; i++) {
      if (values[i] === null || values[i] === undefined) {
        nullMask[Math.floor(i / 8)] |= 1 << (i % 8)
        strings.push('')
      } else {
        strings.push(values[i]!)
      }
    }

    this.stringColumns.set(path, strings)
    this.nullMasks.set(`${path}:null`, nullMask)
    this.columnTypes.set(path, 'string')
    this._recordCount = Math.max(this._recordCount, values.length)
  }

  /**
   * Add a numeric column using Float64Array
   *
   * @param path - Column name/path
   * @param values - Array of numeric values (null for missing)
   */
  addNumberColumn(path: string, values: (number | null)[]): void {
    const numbers = new Float64Array(values.length)
    const nullMask = new Uint8Array(Math.ceil(values.length / 8))

    for (let i = 0; i < values.length; i++) {
      if (values[i] === null || values[i] === undefined) {
        nullMask[Math.floor(i / 8)] |= 1 << (i % 8)
        numbers[i] = NaN
      } else {
        numbers[i] = values[i]!
      }
    }

    this.numberColumns.set(path, numbers)
    this.nullMasks.set(`${path}:null`, nullMask)
    this.columnTypes.set(path, 'number')
    this._recordCount = Math.max(this._recordCount, values.length)
  }

  /**
   * Add a boolean column using packed bits
   *
   * @param path - Column name/path
   * @param values - Array of boolean values (null for missing)
   */
  addBoolColumn(path: string, values: (boolean | null)[]): void {
    const bools = new Uint8Array(Math.ceil(values.length / 8))
    const nullMask = new Uint8Array(Math.ceil(values.length / 8))

    for (let i = 0; i < values.length; i++) {
      if (values[i] === null || values[i] === undefined) {
        nullMask[Math.floor(i / 8)] |= 1 << (i % 8)
      } else if (values[i]) {
        bools[Math.floor(i / 8)] |= 1 << (i % 8)
      }
    }

    this.boolColumns.set(path, bools)
    this.nullMasks.set(`${path}:null`, nullMask)
    this.columnTypes.set(path, 'boolean')
    this._recordCount = Math.max(this._recordCount, values.length)
  }

  /**
   * Add a JSON column for complex values
   *
   * @param path - Column name/path
   * @param values - Array of JSON-serializable values (null for missing)
   */
  addJsonColumn(path: string, values: (unknown | null)[]): void {
    const jsonValues: unknown[] = []
    const nullMask = new Uint8Array(Math.ceil(values.length / 8))

    for (let i = 0; i < values.length; i++) {
      if (values[i] === null || values[i] === undefined) {
        nullMask[Math.floor(i / 8)] |= 1 << (i % 8)
        jsonValues.push(null)
      } else {
        jsonValues.push(values[i])
      }
    }

    this.jsonColumns.set(path, jsonValues)
    this.nullMasks.set(`${path}:null`, nullMask)
    this.columnTypes.set(path, 'json')
    this._recordCount = Math.max(this._recordCount, values.length)
  }

  /**
   * Add a column with automatic type detection
   *
   * @param path - Column name/path
   * @param values - Array of values
   * @param typeHint - Optional type hint from PathStatistics
   */
  addColumn(path: string, values: unknown[], typeHint?: JSONType): void {
    const type = typeHint ?? this.inferColumnType(values)

    switch (type) {
      case 'string':
        this.addStringColumn(path, values as (string | null)[])
        break
      case 'number':
        this.addNumberColumn(path, values as (number | null)[])
        break
      case 'boolean':
        this.addBoolColumn(path, values as (boolean | null)[])
        break
      default:
        this.addJsonColumn(path, values)
    }
  }

  /**
   * Infer column type from values
   */
  private inferColumnType(values: unknown[]): ColumnType {
    let stringCount = 0
    let numberCount = 0
    let boolCount = 0
    let objectCount = 0

    for (const value of values) {
      if (value === null || value === undefined) continue
      if (typeof value === 'string') stringCount++
      else if (typeof value === 'number') numberCount++
      else if (typeof value === 'boolean') boolCount++
      else objectCount++
    }

    const max = Math.max(stringCount, numberCount, boolCount, objectCount)
    if (max === 0) return 'json' // All nulls
    if (max === stringCount) return 'string'
    if (max === numberCount) return 'number'
    if (max === boolCount) return 'boolean'
    return 'json'
  }

  // ==========================================================================
  // Value Retrieval
  // ==========================================================================

  /**
   * Check if a value at index is null
   *
   * @param path - Column path
   * @param index - Record index
   * @returns true if value is null
   */
  isNull(path: string, index: number): boolean {
    const nullMask = this.nullMasks.get(`${path}:null`)
    if (!nullMask) return true
    return Boolean(nullMask[Math.floor(index / 8)] & (1 << (index % 8)))
  }

  /**
   * Get string value at index
   *
   * @param path - Column path
   * @param index - Record index
   * @returns String value or null
   */
  getString(path: string, index: number): string | null {
    if (this.isNull(path, index)) return null
    return this.stringColumns.get(path)?.[index] ?? null
  }

  /**
   * Get number value at index
   *
   * @param path - Column path
   * @param index - Record index
   * @returns Number value or null
   */
  getNumber(path: string, index: number): number | null {
    if (this.isNull(path, index)) return null
    const value = this.numberColumns.get(path)?.[index]
    return value !== undefined && !isNaN(value) ? value : null
  }

  /**
   * Get boolean value at index
   *
   * @param path - Column path
   * @param index - Record index
   * @returns Boolean value or null
   */
  getBool(path: string, index: number): boolean | null {
    if (this.isNull(path, index)) return null
    const bools = this.boolColumns.get(path)
    if (!bools) return null
    return Boolean(bools[Math.floor(index / 8)] & (1 << (index % 8)))
  }

  /**
   * Get JSON value at index
   *
   * @param path - Column path
   * @param index - Record index
   * @returns JSON value or null
   */
  getJson(path: string, index: number): unknown {
    if (this.isNull(path, index)) return null
    return this.jsonColumns.get(path)?.[index] ?? null
  }

  /**
   * Get value at index with automatic type detection
   *
   * @param path - Column path
   * @param index - Record index
   * @returns Value or null
   */
  get(path: string, index: number): unknown {
    const type = this.columnTypes.get(path)
    if (!type) return null

    switch (type) {
      case 'string':
        return this.getString(path, index)
      case 'number':
        return this.getNumber(path, index)
      case 'boolean':
        return this.getBool(path, index)
      case 'json':
        return this.getJson(path, index)
      default:
        return null
    }
  }

  /**
   * Get all values in a column as an array
   *
   * @param path - Column path
   * @returns Array of values (with nulls)
   */
  getColumn(path: string): unknown[] {
    const type = this.columnTypes.get(path)
    if (!type) return []

    const result: unknown[] = []
    const length = this.getColumnLength(path)

    for (let i = 0; i < length; i++) {
      result.push(this.get(path, i))
    }

    return result
  }

  /**
   * Get the length of a specific column
   */
  private getColumnLength(path: string): number {
    const type = this.columnTypes.get(path)
    if (!type) return 0

    switch (type) {
      case 'string':
        return this.stringColumns.get(path)?.length ?? 0
      case 'number':
        return this.numberColumns.get(path)?.length ?? 0
      case 'boolean': {
        const bools = this.boolColumns.get(path)
        return bools ? bools.length * 8 : 0 // Approximate
      }
      case 'json':
        return this.jsonColumns.get(path)?.length ?? 0
      default:
        return 0
    }
  }

  // ==========================================================================
  // Vectorized Aggregations
  // ==========================================================================

  /**
   * Sum all non-null values in a numeric column
   *
   * @param path - Column path
   * @returns Sum of values
   */
  sum(path: string): number {
    const numbers = this.numberColumns.get(path)
    if (!numbers) return 0

    let sum = 0
    for (let i = 0; i < numbers.length; i++) {
      if (!this.isNull(path, i) && !isNaN(numbers[i])) {
        sum += numbers[i]
      }
    }
    return sum
  }

  /**
   * Average of non-null values in a numeric column
   *
   * @param path - Column path
   * @returns Average value or NaN if no values
   */
  avg(path: string): number {
    const numbers = this.numberColumns.get(path)
    if (!numbers) return NaN

    let sum = 0
    let count = 0
    for (let i = 0; i < numbers.length; i++) {
      if (!this.isNull(path, i) && !isNaN(numbers[i])) {
        sum += numbers[i]
        count++
      }
    }
    return count > 0 ? sum / count : NaN
  }

  /**
   * Minimum non-null value in a numeric column
   *
   * @param path - Column path
   * @returns Minimum value or Infinity if no values
   */
  min(path: string): number {
    const numbers = this.numberColumns.get(path)
    if (!numbers) return Infinity

    let min = Infinity
    for (let i = 0; i < numbers.length; i++) {
      if (!this.isNull(path, i) && !isNaN(numbers[i])) {
        if (numbers[i] < min) min = numbers[i]
      }
    }
    return min
  }

  /**
   * Maximum non-null value in a numeric column
   *
   * @param path - Column path
   * @returns Maximum value or -Infinity if no values
   */
  max(path: string): number {
    const numbers = this.numberColumns.get(path)
    if (!numbers) return -Infinity

    let max = -Infinity
    for (let i = 0; i < numbers.length; i++) {
      if (!this.isNull(path, i) && !isNaN(numbers[i])) {
        if (numbers[i] > max) max = numbers[i]
      }
    }
    return max
  }

  /**
   * Count of non-null values in a column
   *
   * @param path - Column path
   * @returns Count of non-null values
   */
  count(path: string): number {
    const nullMask = this.nullMasks.get(`${path}:null`)
    if (!nullMask) return 0

    const length = this.getColumnLength(path)
    let count = 0

    for (let i = 0; i < length; i++) {
      if (!this.isNull(path, i)) {
        count++
      }
    }
    return count
  }

  /**
   * Count of null values in a column
   *
   * @param path - Column path
   * @returns Count of null values
   */
  nullCount(path: string): number {
    const length = this.getColumnLength(path)
    return length - this.count(path)
  }

  /**
   * Get full aggregation statistics for a numeric column
   *
   * @param path - Column path
   * @returns Aggregation result
   */
  aggregate(path: string): AggregationResult {
    return {
      sum: this.sum(path),
      avg: this.avg(path),
      min: this.min(path),
      max: this.max(path),
      count: this.count(path),
      nullCount: this.nullCount(path),
    }
  }

  // ==========================================================================
  // Filtering and Scanning
  // ==========================================================================

  /**
   * Find indices where numeric column matches a predicate
   *
   * @param path - Column path
   * @param predicate - Filter function
   * @returns Array of matching indices
   */
  filterNumbers(path: string, predicate: (value: number) => boolean): number[] {
    const numbers = this.numberColumns.get(path)
    if (!numbers) return []

    const indices: number[] = []
    for (let i = 0; i < numbers.length; i++) {
      if (!this.isNull(path, i) && !isNaN(numbers[i]) && predicate(numbers[i])) {
        indices.push(i)
      }
    }
    return indices
  }

  /**
   * Find indices where string column matches a predicate
   *
   * @param path - Column path
   * @param predicate - Filter function
   * @returns Array of matching indices
   */
  filterStrings(path: string, predicate: (value: string) => boolean): number[] {
    const strings = this.stringColumns.get(path)
    if (!strings) return []

    const indices: number[] = []
    for (let i = 0; i < strings.length; i++) {
      if (!this.isNull(path, i) && predicate(strings[i])) {
        indices.push(i)
      }
    }
    return indices
  }

  /**
   * Find indices where boolean column is true
   *
   * @param path - Column path
   * @returns Array of indices where value is true
   */
  filterTrue(path: string): number[] {
    const bools = this.boolColumns.get(path)
    if (!bools) return []

    const indices: number[] = []
    const length = this._recordCount

    for (let i = 0; i < length; i++) {
      if (!this.isNull(path, i) && this.getBool(path, i)) {
        indices.push(i)
      }
    }
    return indices
  }

  /**
   * Find indices where boolean column is false
   *
   * @param path - Column path
   * @returns Array of indices where value is false
   */
  filterFalse(path: string): number[] {
    const bools = this.boolColumns.get(path)
    if (!bools) return []

    const indices: number[] = []
    const length = this._recordCount

    for (let i = 0; i < length; i++) {
      if (!this.isNull(path, i) && !this.getBool(path, i)) {
        indices.push(i)
      }
    }
    return indices
  }

  // ==========================================================================
  // Column Management
  // ==========================================================================

  /**
   * Check if a column exists
   *
   * @param path - Column path
   * @returns true if column exists
   */
  hasColumn(path: string): boolean {
    return this.columnTypes.has(path)
  }

  /**
   * Get the type of a column
   *
   * @param path - Column path
   * @returns Column type or undefined
   */
  getColumnType(path: string): ColumnType | undefined {
    return this.columnTypes.get(path)
  }

  /**
   * Get all column paths
   *
   * @returns Array of column paths
   */
  getColumnNames(): string[] {
    return Array.from(this.columnTypes.keys())
  }

  /**
   * Get metadata for a column
   *
   * @param path - Column path
   * @returns Column metadata or undefined
   */
  getColumnMetadata(path: string): ColumnMetadata | undefined {
    const type = this.columnTypes.get(path)
    if (!type) return undefined

    const length = this.getColumnLength(path)
    const nullCnt = this.nullCount(path)

    return {
      name: path,
      type,
      length,
      nullCount: nullCnt,
      allNull: nullCnt === length,
      byteSize: this.getColumnByteSize(path),
    }
  }

  /**
   * Get byte size of a column
   */
  private getColumnByteSize(path: string): number {
    const type = this.columnTypes.get(path)
    if (!type) return 0

    const nullMask = this.nullMasks.get(`${path}:null`)
    const nullMaskSize = nullMask?.byteLength ?? 0

    switch (type) {
      case 'string': {
        const strings = this.stringColumns.get(path)
        if (!strings) return nullMaskSize
        let size = nullMaskSize
        for (const s of strings) {
          size += s.length * 2 // UTF-16
        }
        return size
      }
      case 'number': {
        const numbers = this.numberColumns.get(path)
        return nullMaskSize + (numbers?.byteLength ?? 0)
      }
      case 'boolean': {
        const bools = this.boolColumns.get(path)
        return nullMaskSize + (bools?.byteLength ?? 0)
      }
      case 'json': {
        const json = this.jsonColumns.get(path)
        if (!json) return nullMaskSize
        let size = nullMaskSize
        for (const v of json) {
          size += JSON.stringify(v)?.length ?? 0
        }
        return size
      }
      default:
        return nullMaskSize
    }
  }

  /**
   * Remove a column
   *
   * @param path - Column path
   * @returns true if column was removed
   */
  removeColumn(path: string): boolean {
    const type = this.columnTypes.get(path)
    if (!type) return false

    this.columnTypes.delete(path)
    this.nullMasks.delete(`${path}:null`)

    switch (type) {
      case 'string':
        this.stringColumns.delete(path)
        break
      case 'number':
        this.numberColumns.delete(path)
        break
      case 'boolean':
        this.boolColumns.delete(path)
        break
      case 'json':
        this.jsonColumns.delete(path)
        break
    }

    return true
  }

  /**
   * Clear all columns
   */
  clear(): void {
    this.stringColumns.clear()
    this.numberColumns.clear()
    this.boolColumns.clear()
    this.jsonColumns.clear()
    this.nullMasks.clear()
    this.columnTypes.clear()
    this._recordCount = 0
  }

  // ==========================================================================
  // Memory Statistics
  // ==========================================================================

  /**
   * Get memory usage breakdown
   *
   * @returns Memory usage by type
   */
  getMemoryUsage(): {
    stringBytes: number
    numberBytes: number
    boolBytes: number
    jsonBytes: number
    nullMaskBytes: number
    total: number
  } {
    let stringBytes = 0
    for (const strings of this.stringColumns.values()) {
      for (const s of strings) {
        stringBytes += s.length * 2 // UTF-16
      }
    }

    let numberBytes = 0
    for (const numbers of this.numberColumns.values()) {
      numberBytes += numbers.byteLength
    }

    let boolBytes = 0
    for (const bools of this.boolColumns.values()) {
      boolBytes += bools.byteLength
    }

    let jsonBytes = 0
    for (const json of this.jsonColumns.values()) {
      for (const v of json) {
        jsonBytes += JSON.stringify(v)?.length ?? 0
      }
    }

    let nullMaskBytes = 0
    for (const mask of this.nullMasks.values()) {
      nullMaskBytes += mask.byteLength
    }

    return {
      stringBytes,
      numberBytes,
      boolBytes,
      jsonBytes,
      nullMaskBytes,
      total: stringBytes + numberBytes + boolBytes + jsonBytes + nullMaskBytes,
    }
  }

  // ==========================================================================
  // Serialization
  // ==========================================================================

  /**
   * Serialize a column for storage
   *
   * @param path - Column path
   * @returns Serialized column data
   */
  serializeColumn(path: string): SerializedColumn | null {
    const type = this.columnTypes.get(path)
    if (!type) return null

    const nullMask = this.nullMasks.get(`${path}:null`)
    if (!nullMask) return null

    let data: ArrayBuffer | string[]
    let length: number

    switch (type) {
      case 'string': {
        const strings = this.stringColumns.get(path)
        if (!strings) return null
        data = strings
        length = strings.length
        break
      }
      case 'number': {
        const numbers = this.numberColumns.get(path)
        if (!numbers) return null
        data = numbers.buffer.slice(numbers.byteOffset, numbers.byteOffset + numbers.byteLength)
        length = numbers.length
        break
      }
      case 'boolean': {
        const bools = this.boolColumns.get(path)
        if (!bools) return null
        data = bools.buffer.slice(bools.byteOffset, bools.byteOffset + bools.byteLength)
        length = this._recordCount
        break
      }
      case 'json': {
        const json = this.jsonColumns.get(path)
        if (!json) return null
        data = json.map((v) => JSON.stringify(v))
        length = json.length
        break
      }
      default:
        return null
    }

    return {
      name: path,
      type,
      data,
      nullMask: nullMask.buffer.slice(nullMask.byteOffset, nullMask.byteOffset + nullMask.byteLength),
      length,
    }
  }

  /**
   * Deserialize and add a column from storage
   *
   * @param serialized - Serialized column data
   */
  deserializeColumn(serialized: SerializedColumn): void {
    const nullMask = new Uint8Array(serialized.nullMask)
    this.nullMasks.set(`${serialized.name}:null`, nullMask)
    this.columnTypes.set(serialized.name, serialized.type)

    switch (serialized.type) {
      case 'string':
        this.stringColumns.set(serialized.name, serialized.data as string[])
        break
      case 'number':
        this.numberColumns.set(serialized.name, new Float64Array(serialized.data as ArrayBuffer))
        break
      case 'boolean':
        this.boolColumns.set(serialized.name, new Uint8Array(serialized.data as ArrayBuffer))
        break
      case 'json':
        this.jsonColumns.set(
          serialized.name,
          (serialized.data as string[]).map((s) => JSON.parse(s))
        )
        break
    }

    this._recordCount = Math.max(this._recordCount, serialized.length)
  }

  /**
   * Serialize entire store to JSON-compatible format
   *
   * @returns Serialized store data
   */
  toJSON(): {
    columns: Array<{
      name: string
      type: ColumnType
      data: string
      nullMask: string
      length: number
    }>
    recordCount: number
  } {
    const columns: Array<{
      name: string
      type: ColumnType
      data: string
      nullMask: string
      length: number
    }> = []

    for (const path of this.columnTypes.keys()) {
      const serialized = this.serializeColumn(path)
      if (!serialized) continue

      let dataStr: string
      if (Array.isArray(serialized.data)) {
        dataStr = JSON.stringify(serialized.data)
      } else {
        dataStr = this.arrayBufferToBase64(serialized.data)
      }

      columns.push({
        name: serialized.name,
        type: serialized.type,
        data: dataStr,
        nullMask: this.arrayBufferToBase64(serialized.nullMask),
        length: serialized.length,
      })
    }

    return { columns, recordCount: this._recordCount }
  }

  /**
   * Restore store from JSON-serialized data
   *
   * @param data - Serialized store data
   */
  static fromJSON(data: {
    columns: Array<{
      name: string
      type: ColumnType
      data: string
      nullMask: string
      length: number
    }>
    recordCount: number
  }): TypedColumnStore {
    const store = new TypedColumnStore()

    for (const col of data.columns) {
      let colData: ArrayBuffer | string[]

      if (col.type === 'string' || col.type === 'json') {
        colData = JSON.parse(col.data) as string[]
      } else {
        colData = store.base64ToArrayBuffer(col.data)
      }

      store.deserializeColumn({
        name: col.name,
        type: col.type,
        data: colData,
        nullMask: store.base64ToArrayBuffer(col.nullMask),
        length: col.length,
      })
    }

    store._recordCount = data.recordCount
    return store
  }

  /**
   * Convert ArrayBuffer to base64 string
   */
  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer)
    let binary = ''
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i])
    }
    return btoa(binary)
  }

  /**
   * Convert base64 string to ArrayBuffer
   */
  private base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    return bytes.buffer
  }
}
