/**
 * @dotdo/influxdb - Columnar Storage with Gorilla Compression
 *
 * Time-series storage optimized for InfluxDB workloads using TypedColumnStore
 * with Gorilla XOR compression for floats and Delta encoding for timestamps.
 */

import { createColumnStore, type TypedColumnStore } from '../../primitives/typed-column-store'

// ============================================================================
// Types
// ============================================================================

/**
 * A stored point in the time-series database
 */
export interface StoredPoint {
  measurement: string
  tags: Record<string, string>
  fields: Record<string, number | string | boolean>
  timestamp: number
}

/**
 * Compression statistics for a series
 */
export interface CompressionStats {
  /** Ratio of uncompressed to compressed size for field data */
  compressionRatio: number
  /** Ratio of uncompressed to compressed size for timestamps */
  timestampCompressionRatio: number
  /** Per-field compression stats */
  fieldStats: Record<string, { rawBytes: number; compressedBytes: number }>
  /** Total points stored */
  pointCount: number
}

// ============================================================================
// Internal Types
// ============================================================================

interface SeriesData {
  measurement: string
  tags: Record<string, string>
  /** Raw uncompressed points (write buffer) */
  buffer: StoredPoint[]
  /** Compressed timestamp column */
  compressedTimestamps: Uint8Array | null
  /** Compressed field columns by field name */
  compressedFields: Map<string, Uint8Array>
  /** Column store for compression operations */
  columnStore: TypedColumnStore
  /** Track raw sizes for compression stats */
  rawTimestampBytes: number
  rawFieldBytes: Map<string, number>
}

// Buffer size threshold before flushing to compressed storage
const BUFFER_THRESHOLD = 1000

// ============================================================================
// TimeSeriesStorage
// ============================================================================

/**
 * Columnar time-series storage with Gorilla compression
 *
 * Data flows:
 * 1. write() -> buffer (uncompressed)
 * 2. When buffer > threshold, flush to compressed columnar storage
 * 3. read() merges buffer + compressed data
 */
export class TimeSeriesStorage {
  private series: Map<string, SeriesData> = new Map()

  /**
   * Write a point to a series
   *
   * @param seriesKey - Unique key for the series (measurement:tags)
   * @param point - The data point to store
   */
  write(seriesKey: string, point: StoredPoint): void {
    let data = this.series.get(seriesKey)

    if (!data) {
      data = {
        measurement: point.measurement,
        tags: { ...point.tags },
        buffer: [],
        compressedTimestamps: null,
        compressedFields: new Map(),
        columnStore: createColumnStore(),
        rawTimestampBytes: 0,
        rawFieldBytes: new Map(),
      }
      this.series.set(seriesKey, data)
    }

    data.buffer.push({ ...point })

    // Auto-flush when buffer gets large
    if (data.buffer.length >= BUFFER_THRESHOLD) {
      this.flushInternal(data)
    }
  }

  /**
   * Read all points from a series
   */
  read(seriesKey: string): StoredPoint[] {
    const data = this.series.get(seriesKey)
    if (!data) return []

    const compressed = this.readCompressed(data)
    const buffered = data.buffer

    // Merge and sort by timestamp
    return [...compressed, ...buffered].sort((a, b) => a.timestamp - b.timestamp)
  }

  /**
   * Read points within a time range
   */
  readRange(seriesKey: string, start?: number, end?: number): StoredPoint[] {
    const allPoints = this.read(seriesKey)

    return allPoints.filter((p) => {
      if (start !== undefined && p.timestamp < start) return false
      if (end !== undefined && p.timestamp > end) return false
      return true
    })
  }

  /**
   * Flush buffer to compressed storage
   */
  flush(seriesKey: string): void {
    const data = this.series.get(seriesKey)
    if (!data || data.buffer.length === 0) return
    this.flushInternal(data)
  }

  /**
   * Get compression statistics for a series
   */
  getCompressionStats(seriesKey: string): CompressionStats | null {
    const data = this.series.get(seriesKey)
    if (!data) return null

    // Flush to get accurate stats
    if (data.buffer.length > 0) {
      this.flushInternal(data)
    }

    const fieldStats: Record<string, { rawBytes: number; compressedBytes: number }> = {}

    for (const [fieldName, compressed] of data.compressedFields) {
      const rawBytes = data.rawFieldBytes.get(fieldName) ?? 0
      fieldStats[fieldName] = {
        rawBytes,
        compressedBytes: compressed.length,
      }
    }

    const totalRawFieldBytes = Array.from(data.rawFieldBytes.values()).reduce((a, b) => a + b, 0)
    const totalCompressedFieldBytes = Array.from(data.compressedFields.values()).reduce(
      (a, b) => a + b.length,
      0
    )

    const compressedTimestampBytes = data.compressedTimestamps?.length ?? 0

    return {
      compressionRatio:
        totalCompressedFieldBytes > 0 ? totalRawFieldBytes / totalCompressedFieldBytes : 0,
      timestampCompressionRatio:
        compressedTimestampBytes > 0 ? data.rawTimestampBytes / compressedTimestampBytes : 0,
      fieldStats,
      pointCount: this.getPointCount(data),
    }
  }

  /**
   * Get total memory usage estimate
   */
  getMemoryUsage(): number {
    let total = 0

    for (const data of this.series.values()) {
      // Buffer points (rough estimate)
      total += data.buffer.length * 200 // ~200 bytes per point

      // Compressed data
      if (data.compressedTimestamps) {
        total += data.compressedTimestamps.length
      }
      for (const compressed of data.compressedFields.values()) {
        total += compressed.length
      }
    }

    return total
  }

  /**
   * List all series keys
   */
  listSeries(): string[] {
    return Array.from(this.series.keys())
  }

  /**
   * Drop all data for a series
   */
  drop(seriesKey: string): void {
    this.series.delete(seriesKey)
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private flushInternal(data: SeriesData): void {
    if (data.buffer.length === 0) return

    // Extract existing compressed data
    const existingPoints = this.readCompressed(data)

    // Merge with buffer
    const allPoints = [...existingPoints, ...data.buffer].sort((a, b) => a.timestamp - b.timestamp)

    // Extract timestamps
    const timestamps = allPoints.map((p) => p.timestamp)

    // Extract all field names
    const fieldNames = new Set<string>()
    allPoints.forEach((p) => Object.keys(p.fields).forEach((f) => fieldNames.add(f)))

    // Extract field values (use NaN for missing values)
    const fieldValues = new Map<string, number[]>()
    for (const fieldName of fieldNames) {
      const values: number[] = []
      for (const point of allPoints) {
        const val = point.fields[fieldName]
        if (typeof val === 'number') {
          values.push(val)
        } else if (typeof val === 'boolean') {
          values.push(val ? 1 : 0)
        } else {
          values.push(NaN) // String fields or missing
        }
      }
      fieldValues.set(fieldName, values)
    }

    // Compress timestamps using delta encoding
    data.rawTimestampBytes = timestamps.length * 8
    data.compressedTimestamps = data.columnStore.encode(timestamps, 'delta')

    // Compress each field using Gorilla encoding
    data.compressedFields.clear()
    data.rawFieldBytes.clear()

    for (const [fieldName, values] of fieldValues) {
      data.rawFieldBytes.set(fieldName, values.length * 8)
      data.compressedFields.set(fieldName, data.columnStore.encode(values, 'gorilla'))
    }

    // Clear the buffer
    data.buffer = []
  }

  private readCompressed(data: SeriesData): StoredPoint[] {
    if (!data.compressedTimestamps || data.compressedFields.size === 0) {
      return []
    }

    // Decompress timestamps
    const timestamps = data.columnStore.decode(data.compressedTimestamps, 'delta')

    // Decompress fields
    const fieldValues = new Map<string, number[]>()
    for (const [fieldName, compressed] of data.compressedFields) {
      fieldValues.set(fieldName, data.columnStore.decode(compressed, 'gorilla'))
    }

    // Reconstruct points
    const points: StoredPoint[] = []
    for (let i = 0; i < timestamps.length; i++) {
      const fields: Record<string, number | string | boolean> = {}

      for (const [fieldName, values] of fieldValues) {
        const val = values[i]
        if (!isNaN(val)) {
          fields[fieldName] = val
        }
      }

      points.push({
        measurement: data.measurement,
        tags: { ...data.tags },
        fields,
        timestamp: timestamps[i],
      })
    }

    return points
  }

  private getPointCount(data: SeriesData): number {
    let compressed = 0
    if (data.compressedTimestamps) {
      const timestamps = data.columnStore.decode(data.compressedTimestamps, 'delta')
      compressed = timestamps.length
    }
    return compressed + data.buffer.length
  }
}
