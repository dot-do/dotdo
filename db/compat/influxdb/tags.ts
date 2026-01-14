/**
 * @dotdo/influxdb - Tag Index using InvertedIndex
 *
 * Fast tag-based series lookup using the TagIndex primitive from inverted-index.
 * Supports efficient queries like:
 * - Find all series with host=server01
 * - Find all series with host=server01 AND region=us-west
 * - Find all series with region=us-west OR region=us-east
 */

import { TagIndex, type Tags } from '../../primitives/inverted-index'

// ============================================================================
// SeriesTagIndex
// ============================================================================

/**
 * Index for fast tag-based series lookups
 *
 * Wraps the TagIndex primitive to provide InfluxDB-specific functionality
 * like measurement filtering and series key management.
 */
export class SeriesTagIndex {
  private tagIndex: TagIndex
  private seriesIdMap: Map<string, number> = new Map()
  private idSeriesMap: Map<number, string> = new Map()
  private measurementIndex: Map<string, Set<string>> = new Map()
  private nextId = 0

  constructor() {
    this.tagIndex = new TagIndex()
  }

  /**
   * Add a series with its tags to the index
   *
   * @param seriesKey - The full series key (measurement:tag1=val1,tag2=val2)
   * @param tags - The tag key-value pairs
   */
  add(seriesKey: string, tags: Tags): void {
    // Remove existing entry if present
    if (this.seriesIdMap.has(seriesKey)) {
      this.remove(seriesKey)
    }

    // Assign a numeric ID for the TagIndex
    const id = this.nextId++
    this.seriesIdMap.set(seriesKey, id)
    this.idSeriesMap.set(id, seriesKey)

    // Add to tag index
    this.tagIndex.add(id, tags)

    // Index by measurement
    const measurement = this.extractMeasurement(seriesKey)
    if (!this.measurementIndex.has(measurement)) {
      this.measurementIndex.set(measurement, new Set())
    }
    this.measurementIndex.get(measurement)!.add(seriesKey)
  }

  /**
   * Remove a series from the index
   */
  remove(seriesKey: string): void {
    const id = this.seriesIdMap.get(seriesKey)
    if (id === undefined) return

    // Remove from tag index
    this.tagIndex.remove(id)

    // Remove from measurement index
    const measurement = this.extractMeasurement(seriesKey)
    this.measurementIndex.get(measurement)?.delete(seriesKey)
    if (this.measurementIndex.get(measurement)?.size === 0) {
      this.measurementIndex.delete(measurement)
    }

    // Remove from ID maps
    this.seriesIdMap.delete(seriesKey)
    this.idSeriesMap.delete(id)
  }

  /**
   * Find series matching the given tags (AND semantics)
   *
   * @param tags - Tags to match
   * @param measurement - Optional measurement filter
   */
  findSeries(tags: Tags, measurement?: string): string[] {
    // Query tag index
    const matchingIds = this.tagIndex.query(tags)

    // Convert IDs to series keys
    let series = matchingIds
      .map((id) => this.idSeriesMap.get(id))
      .filter((key): key is string => key !== undefined)

    // Apply measurement filter if specified
    if (measurement) {
      const measurementSeries = this.measurementIndex.get(measurement)
      if (!measurementSeries) return []
      series = series.filter((s) => measurementSeries.has(s))
    }

    return series.sort()
  }

  /**
   * Find series matching any of the given tag sets (OR semantics)
   */
  findSeriesOr(tagSets: Tags[]): string[] {
    const matchingIds = this.tagIndex.queryOr(tagSets)

    return matchingIds
      .map((id) => this.idSeriesMap.get(id))
      .filter((key): key is string => key !== undefined)
      .sort()
  }

  /**
   * Find all series for a given measurement
   */
  findSeriesByMeasurement(measurement: string): string[] {
    const series = this.measurementIndex.get(measurement)
    return series ? Array.from(series).sort() : []
  }

  /**
   * Get all unique tag keys
   */
  getTagKeys(): string[] {
    return this.tagIndex.getKeys()
  }

  /**
   * Get all unique values for a tag key
   */
  getTagValues(key: string): string[] {
    return this.tagIndex.getValues(key)
  }

  /**
   * Get the cardinality (number of unique values) for a tag key
   */
  getCardinality(key: string): number {
    return this.tagIndex.getCardinality(key)
  }

  /**
   * Get all unique measurements
   */
  getMeasurements(): string[] {
    return Array.from(this.measurementIndex.keys()).sort()
  }

  /**
   * Get the total number of indexed series
   */
  get seriesCount(): number {
    return this.seriesIdMap.size
  }

  /**
   * Serialize the index to bytes
   */
  serialize(): Uint8Array {
    // Serialize: [tagIndex bytes] + [measurement index] + [series key map]
    const encoder = new TextEncoder()
    const parts: Uint8Array[] = []

    // 1. Serialize TagIndex
    const tagIndexBytes = this.tagIndex.serialize()
    const tagIndexLengthBytes = new Uint8Array(4)
    new DataView(tagIndexLengthBytes.buffer).setUint32(0, tagIndexBytes.length, true)
    parts.push(tagIndexLengthBytes)
    parts.push(tagIndexBytes)

    // 2. Serialize series key map (id -> key)
    const seriesMapData: Array<[number, string]> = Array.from(this.idSeriesMap.entries())
    const seriesMapJson = JSON.stringify(seriesMapData)
    const seriesMapBytes = encoder.encode(seriesMapJson)
    const seriesMapLengthBytes = new Uint8Array(4)
    new DataView(seriesMapLengthBytes.buffer).setUint32(0, seriesMapBytes.length, true)
    parts.push(seriesMapLengthBytes)
    parts.push(seriesMapBytes)

    // 3. Serialize nextId
    const nextIdBytes = new Uint8Array(4)
    new DataView(nextIdBytes.buffer).setUint32(0, this.nextId, true)
    parts.push(nextIdBytes)

    // Concatenate
    const totalLength = parts.reduce((sum, p) => sum + p.length, 0)
    const result = new Uint8Array(totalLength)
    let offset = 0
    for (const part of parts) {
      result.set(part, offset)
      offset += part.length
    }

    return result
  }

  /**
   * Deserialize from bytes
   */
  static deserialize(bytes: Uint8Array): SeriesTagIndex {
    const decoder = new TextDecoder()
    const index = new SeriesTagIndex()
    let offset = 0

    // 1. Read TagIndex length and data
    const tagIndexLength = new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(
      0,
      true
    )
    offset += 4
    const tagIndexBytes = bytes.slice(offset, offset + tagIndexLength)
    offset += tagIndexLength
    index.tagIndex = TagIndex.deserialize(tagIndexBytes)

    // 2. Read series map length and data
    const seriesMapLength = new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(
      0,
      true
    )
    offset += 4
    const seriesMapJson = decoder.decode(bytes.slice(offset, offset + seriesMapLength))
    offset += seriesMapLength
    const seriesMapData: Array<[number, string]> = JSON.parse(seriesMapJson)

    // Rebuild maps
    for (const [id, key] of seriesMapData) {
      index.idSeriesMap.set(id, key)
      index.seriesIdMap.set(key, id)

      // Rebuild measurement index
      const measurement = index.extractMeasurement(key)
      if (!index.measurementIndex.has(measurement)) {
        index.measurementIndex.set(measurement, new Set())
      }
      index.measurementIndex.get(measurement)!.add(key)
    }

    // 3. Read nextId
    index.nextId = new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true)

    return index
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private extractMeasurement(seriesKey: string): string {
    const colonIndex = seriesKey.indexOf(':')
    return colonIndex >= 0 ? seriesKey.substring(0, colonIndex) : seriesKey
  }
}
