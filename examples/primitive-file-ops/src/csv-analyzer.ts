/**
 * CSVAnalyzer - Filesystem-native CSV processing
 *
 * A comprehensive CSV analysis toolkit that demonstrates fsx capabilities:
 * - Parse CSV files with proper quoting and escaping
 * - Analyze column types and statistics
 * - Filter, sort, group, and transform data
 * - Generate reports and save results
 *
 * All operations work seamlessly with the fsx filesystem primitive.
 */

// ============================================================================
// TYPES
// ============================================================================

/**
 * A single record from a CSV file
 */
export type CSVRecord = Record<string, string>

/**
 * Statistics for a single column
 */
export interface ColumnStats {
  /** Column name */
  name: string
  /** Detected data type */
  type: 'string' | 'numeric' | 'boolean' | 'date' | 'mixed'
  /** Number of non-empty values */
  nonEmptyCount: number
  /** Number of unique values */
  uniqueCount: number
  /** Whether column contains email addresses */
  hasEmails: boolean
  /** Minimum value (for numeric columns) */
  min?: number
  /** Maximum value (for numeric columns) */
  max?: number
  /** Sum of values (for numeric columns) */
  sum?: number
  /** Average value (for numeric columns) */
  avg?: number
}

/**
 * Complete analysis result for a CSV file
 */
export interface CSVAnalysisResult {
  /** Number of data rows (excluding header) */
  rowCount: number
  /** Number of columns */
  columnCount: number
  /** Column names in order */
  headers: string[]
  /** Statistics for each column */
  columns: Record<string, ColumnStats>
  /** Analysis timestamp */
  analyzedAt: string
}

/**
 * Validation schema for a column
 */
export interface ColumnValidation {
  /** Column is required (non-empty) */
  required?: boolean
  /** Regex pattern to match */
  pattern?: RegExp
  /** Minimum numeric value */
  min?: number
  /** Maximum numeric value */
  max?: number
  /** Custom validator function */
  custom?: (value: string) => boolean
}

/**
 * Validation error for a single cell
 */
export interface ValidationError {
  /** Row number (1-indexed, excluding header) */
  row: number
  /** Column name */
  column: string
  /** Value that failed validation */
  value: string
  /** Error message */
  message: string
}

/**
 * Validation result
 */
export interface ValidationResult {
  /** Whether all records are valid */
  valid: boolean
  /** List of validation errors */
  errors: ValidationError[]
}

/**
 * Options for saving results
 */
export interface SaveOptions {
  /** Split records into individual files */
  splitRecords?: boolean
  /** Column to use as file ID when splitting */
  idColumn?: string
  /** Include markdown analysis report */
  includeReport?: boolean
  /** Pretty print JSON output */
  pretty?: boolean
}

/**
 * Directory processing result
 */
export interface ProcessDirectoryResult {
  /** Number of files processed */
  processed: number
  /** Number of files skipped */
  skipped: number
  /** Total records across all files */
  totalRecords: number
  /** Processing errors */
  errors: Array<{ file: string; error: string }>
}

/**
 * Aggregate functions for numeric columns
 */
export type AggregateFunction = 'sum' | 'avg' | 'min' | 'max' | 'count'

/**
 * Aggregate result for a group
 */
export interface AggregateResult {
  sum?: number
  avg?: number
  min?: number
  max?: number
  count?: number
}

/**
 * Minimal filesystem capability interface
 */
interface FsCapability {
  read(path: string): Promise<string>
  write(path: string, content: string): Promise<void>
  exists(path: string): Promise<boolean>
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>
  list(path: string): Promise<string[]>
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Check if a string represents a numeric value
 */
function isNumeric(value: string): boolean {
  if (value === '') return false
  const num = Number(value)
  return !isNaN(num) && isFinite(num)
}

/**
 * Check if a string looks like an email address
 */
function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

/**
 * Parse a CSV line handling quoted values
 */
function parseCSVLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        // Escaped quote
        current += '"'
        i++
      } else {
        // Toggle quote mode
        inQuotes = !inQuotes
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }

  // Add the last value
  result.push(current.trim())

  return result
}

// ============================================================================
// CSVANALYZER CLASS
// ============================================================================

/**
 * CSV Analyzer - Parse, analyze, and transform CSV data
 *
 * @example
 * ```typescript
 * const analyzer = new CSVAnalyzer(csvContent)
 * const records = analyzer.parse()
 * const analysis = analyzer.analyze()
 * const report = analyzer.generateReport()
 * ```
 */
export class CSVAnalyzer {
  private content: string
  private _headers: string[] | null = null
  private _records: CSVRecord[] | null = null

  constructor(content: string) {
    this.content = content.trim()
  }

  // ==========================================================================
  // STATIC FACTORY METHODS
  // ==========================================================================

  /**
   * Create a CSVAnalyzer from a file path using fsx
   *
   * @param path - Path to the CSV file
   * @param fs - Filesystem capability
   * @returns CSVAnalyzer instance
   */
  static async fromFile(path: string, fs: FsCapability): Promise<CSVAnalyzer> {
    const content = await fs.read(path)
    return new CSVAnalyzer(content)
  }

  /**
   * Process all CSV files in a directory
   *
   * @param inputDir - Directory containing CSV files
   * @param outputDir - Directory for output files
   * @param fs - Filesystem capability
   * @returns Processing result
   */
  static async processDirectory(
    inputDir: string,
    outputDir: string,
    fs: FsCapability
  ): Promise<ProcessDirectoryResult> {
    const result: ProcessDirectoryResult = {
      processed: 0,
      skipped: 0,
      totalRecords: 0,
      errors: [],
    }

    const files = await fs.list(inputDir)

    for (const file of files) {
      if (!file.endsWith('.csv')) {
        result.skipped++
        continue
      }

      try {
        const inputPath = `${inputDir}/${file}`
        const baseName = file.replace(/\.csv$/, '')
        const fileOutputDir = `${outputDir}/${baseName}`

        await fs.mkdir(fileOutputDir, { recursive: true })

        const analyzer = await CSVAnalyzer.fromFile(inputPath, fs)
        const records = analyzer.parse()

        result.totalRecords += records.length
        result.processed++

        await analyzer.saveResults(fileOutputDir, fs)
      } catch (error) {
        result.errors.push({
          file,
          error: error instanceof Error ? error.message : 'Unknown error',
        })
      }
    }

    return result
  }

  // ==========================================================================
  // PARSING
  // ==========================================================================

  /**
   * Get column headers
   */
  getHeaders(): string[] {
    if (this._headers !== null) return this._headers

    if (!this.content) {
      this._headers = []
      return this._headers
    }

    const lines = this.content.split(/\r?\n/)
    if (lines.length === 0) {
      this._headers = []
      return this._headers
    }

    this._headers = parseCSVLine(lines[0])
    return this._headers
  }

  /**
   * Parse CSV content into records
   */
  parse(): CSVRecord[] {
    if (this._records !== null) return this._records

    if (!this.content) {
      this._records = []
      return this._records
    }

    const lines = this.content.split(/\r?\n/).filter(line => line.trim())
    if (lines.length <= 1) {
      this._records = []
      return this._records
    }

    const headers = this.getHeaders()
    this._records = []

    for (let i = 1; i < lines.length; i++) {
      const values = parseCSVLine(lines[i])
      const record: CSVRecord = {}

      for (let j = 0; j < headers.length; j++) {
        record[headers[j]] = values[j] ?? ''
      }

      this._records.push(record)
    }

    return this._records
  }

  /**
   * Get the number of data rows
   */
  getRowCount(): number {
    return this.parse().length
  }

  // ==========================================================================
  // ANALYSIS
  // ==========================================================================

  /**
   * Analyze the CSV and return comprehensive statistics
   */
  analyze(): CSVAnalysisResult {
    const records = this.parse()
    const headers = this.getHeaders()

    const columns: Record<string, ColumnStats> = {}

    for (const header of headers) {
      const values = records.map(r => r[header])
      const nonEmpty = values.filter(v => v !== '')

      // Determine type
      const numericValues = nonEmpty.filter(isNumeric)
      const allNumeric = nonEmpty.length > 0 && numericValues.length === nonEmpty.length
      const someNumeric = numericValues.length > 0 && numericValues.length < nonEmpty.length

      let type: ColumnStats['type'] = 'string'
      if (allNumeric) type = 'numeric'
      else if (someNumeric) type = 'mixed'

      const stats: ColumnStats = {
        name: header,
        type,
        nonEmptyCount: nonEmpty.length,
        uniqueCount: new Set(values).size,
        hasEmails: nonEmpty.some(isEmail),
      }

      // Calculate numeric statistics if applicable
      if (type === 'numeric' && numericValues.length > 0) {
        const nums = numericValues.map(Number)
        stats.min = Math.min(...nums)
        stats.max = Math.max(...nums)
        stats.sum = nums.reduce((a, b) => a + b, 0)
        stats.avg = stats.sum / nums.length
      }

      columns[header] = stats
    }

    return {
      rowCount: records.length,
      columnCount: headers.length,
      headers,
      columns,
      analyzedAt: new Date().toISOString(),
    }
  }

  /**
   * Get statistics for a specific column
   */
  getColumnStats(column: string): ColumnStats {
    const analysis = this.analyze()
    const stats = analysis.columns[column]

    if (!stats) {
      throw new Error(`Column not found: ${column}`)
    }

    return stats
  }

  // ==========================================================================
  // FILTERING AND TRANSFORMATION
  // ==========================================================================

  /**
   * Filter records by predicate
   */
  filter(predicate: (record: CSVRecord) => boolean): CSVRecord[] {
    return this.parse().filter(predicate)
  }

  /**
   * Group records by column value
   */
  groupBy(column: string): Record<string, CSVRecord[]> {
    const records = this.parse()
    const groups: Record<string, CSVRecord[]> = {}

    for (const record of records) {
      const key = record[column] ?? ''
      if (!groups[key]) groups[key] = []
      groups[key].push(record)
    }

    return groups
  }

  /**
   * Transform records using a mapper function
   */
  transform<T>(mapper: (record: CSVRecord) => T): T[] {
    return this.parse().map(mapper)
  }

  /**
   * Sort records by column
   */
  sort(column: string, order: 'asc' | 'desc' = 'asc'): CSVRecord[] {
    const records = [...this.parse()]
    const stats = this.analyze().columns[column]

    records.sort((a, b) => {
      const aVal = a[column]
      const bVal = b[column]

      let comparison: number

      if (stats?.type === 'numeric') {
        comparison = Number(aVal) - Number(bVal)
      } else {
        comparison = aVal.localeCompare(bVal)
      }

      return order === 'asc' ? comparison : -comparison
    })

    return records
  }

  /**
   * Calculate aggregates by group
   */
  aggregate(
    groupColumn: string,
    valueColumn: string,
    functions: AggregateFunction[]
  ): Record<string, AggregateResult> {
    const groups = this.groupBy(groupColumn)
    const result: Record<string, AggregateResult> = {}

    for (const [key, records] of Object.entries(groups)) {
      const values = records.map(r => Number(r[valueColumn])).filter(n => !isNaN(n))
      const agg: AggregateResult = {}

      for (const fn of functions) {
        switch (fn) {
          case 'sum':
            agg.sum = values.reduce((a, b) => a + b, 0)
            break
          case 'avg':
            agg.avg = values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0
            break
          case 'min':
            agg.min = values.length > 0 ? Math.min(...values) : 0
            break
          case 'max':
            agg.max = values.length > 0 ? Math.max(...values) : 0
            break
          case 'count':
            agg.count = values.length
            break
        }
      }

      result[key] = agg
    }

    return result
  }

  /**
   * Remove duplicate records based on key column
   */
  deduplicate(keyColumn: string, keep: 'first' | 'last' = 'first'): CSVRecord[] {
    const records = this.parse()
    const seen = new Map<string, CSVRecord>()

    if (keep === 'first') {
      for (const record of records) {
        const key = record[keyColumn]
        if (!seen.has(key)) {
          seen.set(key, record)
        }
      }
    } else {
      for (const record of records) {
        const key = record[keyColumn]
        seen.set(key, record)
      }
    }

    return Array.from(seen.values())
  }

  // ==========================================================================
  // VALIDATION
  // ==========================================================================

  /**
   * Validate records against a schema
   */
  validate(schema: Record<string, ColumnValidation>): ValidationResult {
    const records = this.parse()
    const errors: ValidationError[] = []

    records.forEach((record, index) => {
      const rowNum = index + 1 // 1-indexed

      for (const [column, rules] of Object.entries(schema)) {
        const value = record[column] ?? ''

        // Required check
        if (rules.required && value === '') {
          errors.push({
            row: rowNum,
            column,
            value,
            message: `${column} is required`,
          })
          continue
        }

        // Pattern check
        if (rules.pattern && value && !rules.pattern.test(value)) {
          errors.push({
            row: rowNum,
            column,
            value,
            message: `${column} does not match required pattern`,
          })
        }

        // Min/max checks for numeric values
        if (value && isNumeric(value)) {
          const numValue = Number(value)

          if (rules.min !== undefined && numValue < rules.min) {
            errors.push({
              row: rowNum,
              column,
              value,
              message: `${column} must be at least ${rules.min}`,
            })
          }

          if (rules.max !== undefined && numValue > rules.max) {
            errors.push({
              row: rowNum,
              column,
              value,
              message: `${column} must be at most ${rules.max}`,
            })
          }
        }

        // Custom validator
        if (rules.custom && value && !rules.custom(value)) {
          errors.push({
            row: rowNum,
            column,
            value,
            message: `${column} failed custom validation`,
          })
        }
      }
    })

    return {
      valid: errors.length === 0,
      errors,
    }
  }

  // ==========================================================================
  // OUTPUT
  // ==========================================================================

  /**
   * Convert records to JSON string
   */
  toJSON(options?: { pretty?: boolean }): string {
    const records = this.parse()
    return options?.pretty
      ? JSON.stringify(records, null, 2)
      : JSON.stringify(records)
  }

  /**
   * Generate markdown analysis report
   */
  generateReport(): string {
    const analysis = this.analyze()
    const lines: string[] = []

    lines.push('# CSV Analysis Report')
    lines.push('')
    lines.push('## Summary')
    lines.push(`- **Rows**: ${analysis.rowCount}`)
    lines.push(`- **Columns**: ${analysis.columnCount}`)
    lines.push(`- **Headers**: ${analysis.headers.join(', ')}`)
    lines.push(`- **Analyzed at**: ${analysis.analyzedAt}`)
    lines.push('')
    lines.push('## Column Details')
    lines.push('')

    for (const [name, stats] of Object.entries(analysis.columns)) {
      lines.push(`### ${name}`)
      lines.push(`- **Type**: ${stats.type}`)
      lines.push(`- **Non-empty values**: ${stats.nonEmptyCount}`)
      lines.push(`- **Unique values**: ${stats.uniqueCount}`)

      if (stats.hasEmails) {
        lines.push(`- **Contains emails**: Yes`)
      }

      if (stats.type === 'numeric') {
        lines.push(`- **Min**: ${stats.min}`)
        lines.push(`- **Max**: ${stats.max}`)
        lines.push(`- **Sum**: ${stats.sum}`)
        lines.push(`- **Average**: ${stats.avg?.toFixed(2)}`)
      }

      lines.push('')
    }

    lines.push('---')
    lines.push(`*Generated by CSVAnalyzer*`)

    return lines.join('\n')
  }

  /**
   * Save results to filesystem
   */
  async saveResults(
    outputDir: string,
    fs: FsCapability,
    options?: SaveOptions
  ): Promise<void> {
    const records = this.parse()
    const pretty = options?.pretty ?? true

    // Always save combined records
    await fs.write(
      `${outputDir}/records.json`,
      pretty ? JSON.stringify(records, null, 2) : JSON.stringify(records)
    )

    // Split into individual files if requested
    if (options?.splitRecords) {
      const idColumn = options.idColumn || 'id'

      for (const record of records) {
        const id = record[idColumn] || records.indexOf(record).toString()
        await fs.write(
          `${outputDir}/${id}.json`,
          pretty ? JSON.stringify(record, null, 2) : JSON.stringify(record)
        )
      }
    }

    // Generate report if requested
    if (options?.includeReport) {
      const report = this.generateReport()
      await fs.write(`${outputDir}/report.md`, report)
    }
  }
}
