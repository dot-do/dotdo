/**
 * AuditLog Export - JSON and CSV export with streaming support
 *
 * Provides export capabilities for audit logs:
 * - **JSON export**: Full or streaming NDJSON format
 * - **CSV export**: Flattened fields with configurable columns
 * - **Date range filtering**: Filter entries by timestamp
 * - **Streaming**: Memory-efficient export for large datasets
 *
 * @module db/primitives/audit-log/export
 * @see dotdo-anwkg - [REFACTOR] Audit log export (JSON, CSV)
 */

import type { AuditEntry, AuditLog } from './audit-log'

// =============================================================================
// EXPORT OPTIONS
// =============================================================================

/**
 * Date range filter for exports
 */
export interface DateRangeFilter {
  /** Start date (inclusive) */
  from?: Date | string | number
  /** End date (exclusive) */
  to?: Date | string | number
}

/**
 * Base export options
 */
export interface ExportOptions {
  /** Filter entries by date range */
  dateRange?: DateRangeFilter
  /** Fields to include (default: all) */
  fields?: string[]
  /** Fields to exclude */
  excludeFields?: string[]
  /** Pretty print JSON output */
  prettyPrint?: boolean
  /** Batch size for streaming (default: 100) */
  batchSize?: number
}

/**
 * JSON-specific export options
 */
export interface JsonExportOptions extends ExportOptions {
  /** Use NDJSON format (newline-delimited JSON) */
  ndjson?: boolean
  /** Include metadata wrapper */
  includeMetadata?: boolean
}

/**
 * CSV-specific export options
 */
export interface CsvExportOptions extends ExportOptions {
  /** Column delimiter (default: ',') */
  delimiter?: string
  /** Include header row (default: true) */
  includeHeader?: boolean
  /** Quote character (default: '"') */
  quoteChar?: string
  /** Date format for timestamps (default: ISO 8601) */
  dateFormat?: 'iso' | 'epoch' | 'locale'
  /** Custom column mapping */
  columnMapping?: Record<string, string>
  /** Flatten nested objects (default: true) */
  flattenNested?: boolean
  /** Nested field separator (default: '.') */
  nestedSeparator?: string
}

/**
 * Export metadata included in wrapped exports
 */
export interface ExportMetadata {
  /** Export format version */
  version: number
  /** When the export was generated */
  exportedAt: string
  /** Total entries exported */
  entryCount: number
  /** Date range filter applied (if any) */
  dateRange?: {
    from?: string
    to?: string
  }
  /** Fields included in export */
  fields?: string[]
  /** Export format */
  format: 'json' | 'csv' | 'ndjson'
}

/**
 * JSON export result
 */
export interface JsonExportResult {
  /** Export metadata */
  metadata: ExportMetadata
  /** Exported entries */
  entries: AuditEntry[]
}

/**
 * Streaming export chunk
 */
export interface ExportChunk {
  /** Chunk data */
  data: string
  /** Number of entries in this chunk */
  entryCount: number
  /** Whether this is the last chunk */
  isLast: boolean
}

// =============================================================================
// DEFAULT CSV COLUMNS
// =============================================================================

/**
 * Default columns for CSV export
 */
export const DEFAULT_CSV_COLUMNS = [
  'id',
  'createdAt',
  'actor.userId',
  'actor.serviceId',
  'actor.system',
  'action.type',
  'resource.type',
  'resource.id',
  'resource.path',
  'timestamp.iso',
  'timestamp.epochMs',
  'metadata.ipAddress',
  'metadata.userAgent',
  'metadata.requestId',
  'correlation.correlationId',
  'correlation.transactionId',
] as const

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Parse date input to timestamp
 */
function parseDateToTimestamp(input: Date | string | number): number {
  if (typeof input === 'number') {
    return input
  }
  if (input instanceof Date) {
    return input.getTime()
  }
  return new Date(input).getTime()
}

/**
 * Get nested value from object using dot notation
 */
function getNestedValue(obj: unknown, path: string): unknown {
  if (obj === null || obj === undefined) {
    return undefined
  }

  const parts = path.split('.')
  let current: unknown = obj

  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined
    }
    current = (current as Record<string, unknown>)[part]
  }

  return current
}

/**
 * Flatten nested object into dot-notation keys
 */
function flattenObject(
  obj: unknown,
  prefix: string = '',
  separator: string = '.'
): Record<string, unknown> {
  const result: Record<string, unknown> = {}

  if (obj === null || obj === undefined || typeof obj !== 'object') {
    return result
  }

  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const newKey = prefix ? `${prefix}${separator}${key}` : key

    if (value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
      Object.assign(result, flattenObject(value, newKey, separator))
    } else {
      result[newKey] = value
    }
  }

  return result
}

/**
 * Escape CSV value
 */
function escapeCsvValue(value: unknown, quoteChar: string, delimiter: string): string {
  if (value === null || value === undefined) {
    return ''
  }

  let str: string
  if (value instanceof Date) {
    str = value.toISOString()
  } else if (typeof value === 'object') {
    str = JSON.stringify(value)
  } else {
    str = String(value)
  }

  // Check if value needs quoting
  const needsQuoting =
    str.includes(quoteChar) ||
    str.includes(delimiter) ||
    str.includes('\n') ||
    str.includes('\r')

  if (needsQuoting) {
    // Escape quote characters by doubling them
    const escaped = str.replace(new RegExp(quoteChar, 'g'), quoteChar + quoteChar)
    return `${quoteChar}${escaped}${quoteChar}`
  }

  return str
}

/**
 * Format timestamp based on format option
 */
function formatTimestamp(timestamp: { iso: string; epochMs: number }, format: 'iso' | 'epoch' | 'locale'): string {
  switch (format) {
    case 'epoch':
      return String(timestamp.epochMs)
    case 'locale':
      return new Date(timestamp.iso).toLocaleString()
    case 'iso':
    default:
      return timestamp.iso
  }
}

/**
 * Filter entry by date range
 */
function isInDateRange(entry: AuditEntry, dateRange?: DateRangeFilter): boolean {
  if (!dateRange) {
    return true
  }

  const entryTimestamp = entry.timestamp?.epochMs ?? new Date(entry.createdAt).getTime()

  if (dateRange.from !== undefined) {
    const fromTimestamp = parseDateToTimestamp(dateRange.from)
    if (entryTimestamp < fromTimestamp) {
      return false
    }
  }

  if (dateRange.to !== undefined) {
    const toTimestamp = parseDateToTimestamp(dateRange.to)
    if (entryTimestamp >= toTimestamp) {
      return false
    }
  }

  return true
}

/**
 * Check if a flattened key should be excluded
 * Handles both exact matches and prefix matches for nested fields
 */
function shouldExcludeField(key: string, excludeFields: string[]): boolean {
  for (const excluded of excludeFields) {
    // Exact match
    if (key === excluded) {
      return true
    }
    // Prefix match (e.g., 'metadata' excludes 'metadata.ipAddress')
    if (key.startsWith(excluded + '.')) {
      return true
    }
  }
  return false
}

/**
 * Filter entry fields based on include/exclude options
 */
function filterEntryFields(
  entry: AuditEntry,
  fields?: string[],
  excludeFields?: string[]
): Partial<AuditEntry> {
  // If no filtering, return full entry
  if (!fields && !excludeFields) {
    return entry
  }

  const flat = flattenObject(entry)
  const result: Record<string, unknown> = {}

  // If specific fields are requested, only include those
  if (fields && fields.length > 0) {
    for (const field of fields) {
      if (flat[field] !== undefined) {
        result[field] = flat[field]
      } else {
        // Try getting nested value directly
        const value = getNestedValue(entry, field)
        if (value !== undefined) {
          result[field] = value
        }
      }
    }
    return unflattenObject(result) as Partial<AuditEntry>
  }

  // Otherwise, include all except excluded
  if (excludeFields && excludeFields.length > 0) {
    for (const [key, value] of Object.entries(flat)) {
      if (!shouldExcludeField(key, excludeFields)) {
        result[key] = value
      }
    }
    return unflattenObject(result) as Partial<AuditEntry>
  }

  return entry
}

/**
 * Unflatten dot-notation keys back to nested object
 */
function unflattenObject(flat: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(flat)) {
    const parts = key.split('.')
    let current = result

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i]!
      if (!(part in current)) {
        current[part] = {}
      }
      current = current[part] as Record<string, unknown>
    }

    current[parts[parts.length - 1]!] = value
  }

  return result
}

// =============================================================================
// AUDIT LOG EXPORTER CLASS
// =============================================================================

/**
 * AuditLogExporter - Export audit log entries in various formats
 */
export class AuditLogExporter {
  private readonly auditLog: AuditLog

  constructor(auditLog: AuditLog) {
    this.auditLog = auditLog
  }

  /**
   * Export to JSON format
   *
   * @example
   * ```typescript
   * const exporter = new AuditLogExporter(auditLog)
   * const json = exporter.toJSON({
   *   dateRange: { from: '2024-01-01', to: '2024-02-01' },
   *   prettyPrint: true,
   * })
   * ```
   */
  toJSON(options?: JsonExportOptions): string {
    const entries = this.getFilteredEntries(options)
    const metadata = this.createMetadata(entries.length, 'json', options)

    if (options?.ndjson) {
      return this.toNDJSON(options)
    }

    if (options?.includeMetadata) {
      const result: JsonExportResult = {
        metadata,
        entries: entries.map((e) => filterEntryFields(e, options?.fields, options?.excludeFields) as AuditEntry),
      }
      return options?.prettyPrint
        ? JSON.stringify(result, null, 2)
        : JSON.stringify(result)
    }

    const filteredEntries = entries.map((e) =>
      filterEntryFields(e, options?.fields, options?.excludeFields)
    )
    return options?.prettyPrint
      ? JSON.stringify(filteredEntries, null, 2)
      : JSON.stringify(filteredEntries)
  }

  /**
   * Export to NDJSON (newline-delimited JSON) format
   *
   * @example
   * ```typescript
   * const ndjson = exporter.toNDJSON({ dateRange: { from: yesterday } })
   * // Each line is a separate JSON object
   * ```
   */
  toNDJSON(options?: JsonExportOptions): string {
    const entries = this.getFilteredEntries(options)
    const lines: string[] = []

    for (const entry of entries) {
      const filtered = filterEntryFields(entry, options?.fields, options?.excludeFields)
      lines.push(JSON.stringify(filtered))
    }

    return lines.join('\n')
  }

  /**
   * Export to CSV format
   *
   * @example
   * ```typescript
   * const csv = exporter.toCSV({
   *   includeHeader: true,
   *   delimiter: ',',
   *   dateFormat: 'iso',
   * })
   * ```
   */
  toCSV(options?: CsvExportOptions): string {
    const {
      delimiter = ',',
      includeHeader = true,
      quoteChar = '"',
      dateFormat = 'iso',
      columnMapping = {},
      flattenNested = true,
      nestedSeparator = '.',
    } = options ?? {}

    const entries = this.getFilteredEntries(options)
    const lines: string[] = []

    // Determine columns to export
    const columns = this.determineColumns(entries, options)

    // Add header row
    if (includeHeader) {
      const headerRow = columns
        .map((col) => escapeCsvValue(columnMapping[col] ?? col, quoteChar, delimiter))
        .join(delimiter)
      lines.push(headerRow)
    }

    // Add data rows
    for (const entry of entries) {
      const flat = flattenNested ? flattenObject(entry, '', nestedSeparator) : entry
      const row = columns
        .map((col) => {
          let value = flattenNested ? flat[col] : getNestedValue(entry, col)

          // Special handling for timestamp fields
          if (col.endsWith('.iso') || col.endsWith('.epochMs')) {
            const timestampPath = col.replace(/\.(iso|epochMs)$/, '')
            const timestamp = getNestedValue(entry, timestampPath) as { iso: string; epochMs: number } | undefined
            if (timestamp && typeof timestamp === 'object' && 'iso' in timestamp) {
              value = formatTimestamp(timestamp, dateFormat)
            }
          }

          return escapeCsvValue(value, quoteChar, delimiter)
        })
        .join(delimiter)
      lines.push(row)
    }

    return lines.join('\n')
  }

  /**
   * Stream export as an async generator (JSON chunks)
   *
   * @example
   * ```typescript
   * for await (const chunk of exporter.streamJSON({ batchSize: 100 })) {
   *   await writeToFile(chunk.data)
   * }
   * ```
   */
  async *streamJSON(options?: JsonExportOptions): AsyncGenerator<ExportChunk> {
    const { batchSize = 100, ndjson = true } = options ?? {}
    const entries = this.getFilteredEntries(options)
    const totalEntries = entries.length

    let offset = 0
    while (offset < totalEntries) {
      const batch = entries.slice(offset, offset + batchSize)
      const isLast = offset + batch.length >= totalEntries

      let data: string
      if (ndjson) {
        data = batch
          .map((e) => JSON.stringify(filterEntryFields(e, options?.fields, options?.excludeFields)))
          .join('\n')
        if (!isLast) {
          data += '\n'
        }
      } else {
        // For regular JSON streaming, output array items
        const items = batch.map((e) =>
          JSON.stringify(filterEntryFields(e, options?.fields, options?.excludeFields))
        )
        if (offset === 0) {
          data = '[' + items.join(',')
        } else {
          data = ',' + items.join(',')
        }
        if (isLast) {
          data += ']'
        }
      }

      yield {
        data,
        entryCount: batch.length,
        isLast,
      }

      offset += batchSize
    }

    // Handle empty case
    if (totalEntries === 0) {
      yield {
        data: ndjson ? '' : '[]',
        entryCount: 0,
        isLast: true,
      }
    }
  }

  /**
   * Stream export as an async generator (CSV chunks)
   *
   * @example
   * ```typescript
   * for await (const chunk of exporter.streamCSV({ batchSize: 100 })) {
   *   await writeToFile(chunk.data)
   * }
   * ```
   */
  async *streamCSV(options?: CsvExportOptions): AsyncGenerator<ExportChunk> {
    const {
      batchSize = 100,
      delimiter = ',',
      includeHeader = true,
      quoteChar = '"',
      dateFormat = 'iso',
      columnMapping = {},
      flattenNested = true,
      nestedSeparator = '.',
    } = options ?? {}

    const entries = this.getFilteredEntries(options)
    const totalEntries = entries.length
    const columns = this.determineColumns(entries, options)

    let offset = 0
    let headerEmitted = false

    while (offset < totalEntries) {
      const batch = entries.slice(offset, offset + batchSize)
      const isLast = offset + batch.length >= totalEntries
      const lines: string[] = []

      // Add header on first chunk
      if (!headerEmitted && includeHeader) {
        const headerRow = columns
          .map((col) => escapeCsvValue(columnMapping[col] ?? col, quoteChar, delimiter))
          .join(delimiter)
        lines.push(headerRow)
        headerEmitted = true
      }

      // Add data rows
      for (const entry of batch) {
        const flat = flattenNested ? flattenObject(entry, '', nestedSeparator) : entry
        const row = columns
          .map((col) => {
            let value = flattenNested ? flat[col] : getNestedValue(entry, col)

            if (col.endsWith('.iso') || col.endsWith('.epochMs')) {
              const timestampPath = col.replace(/\.(iso|epochMs)$/, '')
              const timestamp = getNestedValue(entry, timestampPath) as { iso: string; epochMs: number } | undefined
              if (timestamp && typeof timestamp === 'object' && 'iso' in timestamp) {
                value = formatTimestamp(timestamp, dateFormat)
              }
            }

            return escapeCsvValue(value, quoteChar, delimiter)
          })
          .join(delimiter)
        lines.push(row)
      }

      yield {
        data: lines.join('\n') + (isLast ? '' : '\n'),
        entryCount: batch.length,
        isLast,
      }

      offset += batchSize
    }

    // Handle empty case
    if (totalEntries === 0) {
      if (includeHeader) {
        const headerRow = columns
          .map((col) => escapeCsvValue(columnMapping[col] ?? col, quoteChar, delimiter))
          .join(delimiter)
        yield {
          data: headerRow,
          entryCount: 0,
          isLast: true,
        }
      } else {
        yield {
          data: '',
          entryCount: 0,
          isLast: true,
        }
      }
    }
  }

  /**
   * Get export statistics
   */
  getExportStats(options?: DateRangeFilter): {
    totalEntries: number
    filteredEntries: number
    dateRange?: { from?: string; to?: string }
  } {
    const allEntries = this.auditLog.list()
    const filtered = options
      ? allEntries.filter((entry: AuditEntry) => isInDateRange(entry, options))
      : allEntries

    return {
      totalEntries: allEntries.length,
      filteredEntries: filtered.length,
      dateRange: options
        ? {
            from: options.from
              ? new Date(parseDateToTimestamp(options.from)).toISOString()
              : undefined,
            to: options.to
              ? new Date(parseDateToTimestamp(options.to)).toISOString()
              : undefined,
          }
        : undefined,
    }
  }

  // ===========================================================================
  // PRIVATE HELPERS
  // ===========================================================================

  private getFilteredEntries(options?: ExportOptions): AuditEntry[] {
    const allEntries = this.auditLog.list()
    return allEntries.filter((entry: AuditEntry) => isInDateRange(entry, options?.dateRange))
  }

  private createMetadata(
    entryCount: number,
    format: 'json' | 'csv' | 'ndjson',
    options?: ExportOptions
  ): ExportMetadata {
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      entryCount,
      format,
      dateRange: options?.dateRange
        ? {
            from: options.dateRange.from
              ? new Date(parseDateToTimestamp(options.dateRange.from)).toISOString()
              : undefined,
            to: options.dateRange.to
              ? new Date(parseDateToTimestamp(options.dateRange.to)).toISOString()
              : undefined,
          }
        : undefined,
      fields: options?.fields,
    }
  }

  private determineColumns(entries: AuditEntry[], options?: CsvExportOptions): string[] {
    // If specific fields are requested, use those
    if (options?.fields && options.fields.length > 0) {
      return options.fields
    }

    // If we have entries, collect all unique keys
    if (entries.length > 0) {
      const allKeys = new Set<string>()
      for (const entry of entries) {
        const flat = flattenObject(entry, '', options?.nestedSeparator ?? '.')
        for (const key of Object.keys(flat)) {
          // Skip excluded fields
          if (options?.excludeFields?.includes(key)) {
            continue
          }
          allKeys.add(key)
        }
      }

      // Sort keys for consistent output
      return Array.from(allKeys).sort()
    }

    // Fall back to default columns
    return [...DEFAULT_CSV_COLUMNS]
  }
}

// =============================================================================
// FACTORY FUNCTION
// =============================================================================

/**
 * Create a new AuditLogExporter instance
 *
 * @param auditLog - The audit log to export from
 * @returns A new AuditLogExporter instance
 *
 * @example
 * ```typescript
 * const exporter = createAuditLogExporter(auditLog)
 *
 * // Export all entries as JSON
 * const json = exporter.toJSON({ prettyPrint: true })
 *
 * // Export with date range filter
 * const filtered = exporter.toJSON({
 *   dateRange: {
 *     from: '2024-01-01',
 *     to: '2024-02-01',
 *   },
 * })
 *
 * // Export as CSV
 * const csv = exporter.toCSV({
 *   includeHeader: true,
 *   delimiter: ',',
 * })
 *
 * // Streaming export for large datasets
 * for await (const chunk of exporter.streamJSON({ batchSize: 1000 })) {
 *   await file.write(chunk.data)
 * }
 * ```
 */
export function createAuditLogExporter(auditLog: AuditLog): AuditLogExporter {
  return new AuditLogExporter(auditLog)
}

// =============================================================================
// STANDALONE EXPORT FUNCTIONS
// =============================================================================

/**
 * Export entries directly to JSON string
 */
export function exportToJSON(entries: AuditEntry[], options?: JsonExportOptions): string {
  const filtered = options?.dateRange
    ? entries.filter((e) => isInDateRange(e, options.dateRange))
    : entries

  if (options?.ndjson) {
    return filtered
      .map((e) => JSON.stringify(filterEntryFields(e, options?.fields, options?.excludeFields)))
      .join('\n')
  }

  const result = filtered.map((e) =>
    filterEntryFields(e, options?.fields, options?.excludeFields)
  )

  return options?.prettyPrint ? JSON.stringify(result, null, 2) : JSON.stringify(result)
}

/**
 * Export entries directly to CSV string
 */
export function exportToCSV(entries: AuditEntry[], options?: CsvExportOptions): string {
  const {
    delimiter = ',',
    includeHeader = true,
    quoteChar = '"',
    dateFormat = 'iso',
    columnMapping = {},
    flattenNested = true,
    nestedSeparator = '.',
  } = options ?? {}

  const filtered = options?.dateRange
    ? entries.filter((e) => isInDateRange(e, options.dateRange))
    : entries

  const lines: string[] = []

  // Determine columns
  const columns = options?.fields?.length
    ? options.fields
    : filtered.length > 0
      ? Array.from(
          new Set(
            filtered.flatMap((e) =>
              Object.keys(flattenObject(e, '', nestedSeparator))
            )
          )
        ).sort()
      : [...DEFAULT_CSV_COLUMNS]

  // Filter out excluded fields
  const finalColumns = options?.excludeFields
    ? columns.filter((c) => !options.excludeFields!.includes(c))
    : columns

  // Add header
  if (includeHeader) {
    const headerRow = finalColumns
      .map((col) => escapeCsvValue(columnMapping[col] ?? col, quoteChar, delimiter))
      .join(delimiter)
    lines.push(headerRow)
  }

  // Add data rows
  for (const entry of filtered) {
    const flat = flattenNested ? flattenObject(entry, '', nestedSeparator) : entry
    const row = finalColumns
      .map((col) => {
        let value = flattenNested ? flat[col] : getNestedValue(entry, col)

        if (col.endsWith('.iso') || col.endsWith('.epochMs')) {
          const timestampPath = col.replace(/\.(iso|epochMs)$/, '')
          const timestamp = getNestedValue(entry, timestampPath) as { iso: string; epochMs: number } | undefined
          if (timestamp && typeof timestamp === 'object' && 'iso' in timestamp) {
            value = formatTimestamp(timestamp, dateFormat)
          }
        }

        return escapeCsvValue(value, quoteChar, delimiter)
      })
      .join(delimiter)
    lines.push(row)
  }

  return lines.join('\n')
}

/**
 * Create a streaming JSON exporter from entries array
 */
export async function* streamJSONExport(
  entries: AuditEntry[],
  options?: JsonExportOptions
): AsyncGenerator<ExportChunk> {
  const { batchSize = 100, ndjson = true } = options ?? {}

  const filtered = options?.dateRange
    ? entries.filter((e) => isInDateRange(e, options.dateRange))
    : entries

  const totalEntries = filtered.length

  let offset = 0
  while (offset < totalEntries) {
    const batch = filtered.slice(offset, offset + batchSize)
    const isLast = offset + batch.length >= totalEntries

    let data: string
    if (ndjson) {
      data = batch
        .map((e) => JSON.stringify(filterEntryFields(e, options?.fields, options?.excludeFields)))
        .join('\n')
      if (!isLast) {
        data += '\n'
      }
    } else {
      const items = batch.map((e) =>
        JSON.stringify(filterEntryFields(e, options?.fields, options?.excludeFields))
      )
      if (offset === 0) {
        data = '[' + items.join(',')
      } else {
        data = ',' + items.join(',')
      }
      if (isLast) {
        data += ']'
      }
    }

    yield {
      data,
      entryCount: batch.length,
      isLast,
    }

    offset += batchSize
  }

  if (totalEntries === 0) {
    yield {
      data: ndjson ? '' : '[]',
      entryCount: 0,
      isLast: true,
    }
  }
}

/**
 * Create a streaming CSV exporter from entries array
 */
export async function* streamCSVExport(
  entries: AuditEntry[],
  options?: CsvExportOptions
): AsyncGenerator<ExportChunk> {
  const {
    batchSize = 100,
    delimiter = ',',
    includeHeader = true,
    quoteChar = '"',
    dateFormat = 'iso',
    columnMapping = {},
    flattenNested = true,
    nestedSeparator = '.',
  } = options ?? {}

  const filtered = options?.dateRange
    ? entries.filter((e) => isInDateRange(e, options.dateRange))
    : entries

  const totalEntries = filtered.length

  // Determine columns
  const columns = options?.fields?.length
    ? options.fields
    : filtered.length > 0
      ? Array.from(
          new Set(
            filtered.flatMap((e) =>
              Object.keys(flattenObject(e, '', nestedSeparator))
            )
          )
        ).sort()
      : [...DEFAULT_CSV_COLUMNS]

  const finalColumns = options?.excludeFields
    ? columns.filter((c) => !options.excludeFields!.includes(c))
    : columns

  let offset = 0
  let headerEmitted = false

  while (offset < totalEntries) {
    const batch = filtered.slice(offset, offset + batchSize)
    const isLast = offset + batch.length >= totalEntries
    const lines: string[] = []

    if (!headerEmitted && includeHeader) {
      const headerRow = finalColumns
        .map((col) => escapeCsvValue(columnMapping[col] ?? col, quoteChar, delimiter))
        .join(delimiter)
      lines.push(headerRow)
      headerEmitted = true
    }

    for (const entry of batch) {
      const flat = flattenNested ? flattenObject(entry, '', nestedSeparator) : entry
      const row = finalColumns
        .map((col) => {
          let value = flattenNested ? flat[col] : getNestedValue(entry, col)

          if (col.endsWith('.iso') || col.endsWith('.epochMs')) {
            const timestampPath = col.replace(/\.(iso|epochMs)$/, '')
            const timestamp = getNestedValue(entry, timestampPath) as { iso: string; epochMs: number } | undefined
            if (timestamp && typeof timestamp === 'object' && 'iso' in timestamp) {
              value = formatTimestamp(timestamp, dateFormat)
            }
          }

          return escapeCsvValue(value, quoteChar, delimiter)
        })
        .join(delimiter)
      lines.push(row)
    }

    yield {
      data: lines.join('\n') + (isLast ? '' : '\n'),
      entryCount: batch.length,
      isLast,
    }

    offset += batchSize
  }

  if (totalEntries === 0) {
    if (includeHeader) {
      const headerRow = finalColumns
        .map((col) => escapeCsvValue(columnMapping[col] ?? col, quoteChar, delimiter))
        .join(delimiter)
      yield {
        data: headerRow,
        entryCount: 0,
        isLast: true,
      }
    } else {
      yield {
        data: '',
        entryCount: 0,
        isLast: true,
      }
    }
  }
}
