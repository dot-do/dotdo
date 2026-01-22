/**
 * Output Formatters Module
 *
 * Provides ClickHouse-compatible output formatting for query results.
 * Supports JSON, JSONCompact, JSONEachRow, TabSeparated, CSV, and Pretty formats.
 *
 * @module formatters
 */

// ============================================================================
// Types and Interfaces
// ============================================================================

/**
 * Column metadata from query result
 */
export interface ColumnMeta {
  name: string;
  type: string;
}

/**
 * Query result structure that formatters consume
 */
export interface QueryResult {
  meta: ColumnMeta[];
  data: Record<string, unknown>[];
  rows: number;
  statistics?: {
    elapsed?: number;
    rows_read?: number;
    bytes_read?: number;
    [key: string]: unknown;
  };
}

/**
 * Options that can be passed to formatters
 */
export interface FormatterOptions {
  /** Include statistics in output (for JSON formats) */
  includeStatistics?: boolean;
  /** Pretty print JSON output */
  prettyPrint?: boolean;
  /** Additional format-specific options */
  [key: string]: unknown;
}

/**
 * Formatter interface that all formatters implement
 */
export interface Formatter {
  /** Format the query result to string */
  format(result: QueryResult, options?: FormatterOptions): string;
  /** Content-Type header value for this format */
  readonly contentType: string;
}

/**
 * Options for TabSeparated and CSV formatters
 */
export interface DelimitedFormatterOptions {
  /** Include column names header row */
  withNames?: boolean;
}

// ============================================================================
// Content Type Mapping
// ============================================================================

/**
 * Content types for each format
 */
export const FORMAT_CONTENT_TYPES: Record<string, string> = {
  JSON: 'application/json; charset=UTF-8',
  JSONCompact: 'application/json; charset=UTF-8',
  JSONEachRow: 'application/x-ndjson; charset=UTF-8',
  JSONStringsEachRow: 'application/x-ndjson; charset=UTF-8',
  CSV: 'text/csv; charset=UTF-8',
  CSVWithNames: 'text/csv; charset=UTF-8',
  TSV: 'text/tab-separated-values; charset=UTF-8',
  TSVWithNames: 'text/tab-separated-values; charset=UTF-8',
  TabSeparated: 'text/tab-separated-values; charset=UTF-8',
  TabSeparatedWithNames: 'text/tab-separated-values; charset=UTF-8',
  Pretty: 'text/plain; charset=UTF-8',
  PrettyCompact: 'text/plain; charset=UTF-8',
};

// ============================================================================
// JSON Formatter
// ============================================================================

/**
 * JSON formatter - outputs full JSON with meta, data, rows, and statistics
 *
 * @example
 * ```
 * {
 *   "meta": [{"name": "id", "type": "UInt32"}],
 *   "data": [{"id": 1}],
 *   "rows": 1,
 *   "statistics": {"elapsed": 0.001, "rows_read": 1, "bytes_read": 8}
 * }
 * ```
 */
export class JsonFormatter implements Formatter {
  readonly contentType = 'application/json; charset=UTF-8';

  format(result: QueryResult, options?: FormatterOptions): string {
    const output: Record<string, unknown> = {
      meta: result.meta,
      data: result.data,
      rows: result.rows,
    };

    if (result.statistics !== undefined) {
      output.statistics = result.statistics;
    }

    return options?.prettyPrint
      ? JSON.stringify(output, null, 2)
      : JSON.stringify(output);
  }
}

// ============================================================================
// JSONCompact Formatter
// ============================================================================

/**
 * JSONCompact formatter - outputs data as arrays instead of objects
 *
 * @example
 * ```
 * {
 *   "meta": [{"name": "id", "type": "UInt32"}, {"name": "name", "type": "String"}],
 *   "data": [[1, "Alice"], [2, "Bob"]],
 *   "rows": 2,
 *   "statistics": {...}
 * }
 * ```
 */
export class JsonCompactFormatter implements Formatter {
  readonly contentType = 'application/json; charset=UTF-8';

  format(result: QueryResult, options?: FormatterOptions): string {
    // Convert data from objects to arrays based on meta column order
    const compactData = result.data.map(row => {
      return result.meta.map(col => row[col.name]);
    });

    const output: Record<string, unknown> = {
      meta: result.meta,
      data: compactData,
      rows: result.rows,
    };

    if (result.statistics !== undefined) {
      output.statistics = result.statistics;
    }

    return options?.prettyPrint
      ? JSON.stringify(output, null, 2)
      : JSON.stringify(output);
  }
}

// ============================================================================
// JSONEachRow Formatter
// ============================================================================

/**
 * JSONEachRow formatter - outputs one JSON object per line (NDJSON format)
 *
 * @example
 * ```
 * {"id": 1, "name": "Alice"}
 * {"id": 2, "name": "Bob"}
 * ```
 */
export class JsonEachRowFormatter implements Formatter {
  readonly contentType = 'application/x-ndjson; charset=UTF-8';

  format(result: QueryResult, _options?: FormatterOptions): string {
    if (result.data.length === 0) {
      return '';
    }

    return result.data.map(row => JSON.stringify(row)).join('\n') + '\n';
  }
}

// ============================================================================
// TabSeparated Formatter
// ============================================================================

/**
 * TabSeparated (TSV) formatter - outputs tab-separated values
 *
 * @example
 * ```
 * 1	Alice	10.5
 * 2	Bob	20.3
 * ```
 */
export class TabSeparatedFormatter implements Formatter {
  readonly contentType = 'text/tab-separated-values; charset=UTF-8';
  private withNames: boolean;

  constructor(options?: DelimitedFormatterOptions) {
    this.withNames = options?.withNames ?? false;
  }

  format(result: QueryResult, _options?: FormatterOptions): string {
    if (result.data.length === 0 && !this.withNames) {
      return '';
    }

    const lines: string[] = [];

    // Add header row if withNames
    if (this.withNames) {
      lines.push(result.meta.map(col => col.name).join('\t'));
    }

    // Add data rows
    for (const row of result.data) {
      const values = result.meta.map(col => {
        const value = row[col.name];
        if (value === null || value === undefined) {
          return '';
        }
        // Escape tabs and newlines
        return String(value)
          .replace(/\t/g, '\\t')
          .replace(/\n/g, '\\n');
      });
      lines.push(values.join('\t'));
    }

    if (lines.length === 0) {
      return '';
    }

    return lines.join('\n') + '\n';
  }
}

// ============================================================================
// CSV Formatter
// ============================================================================

/**
 * CSV formatter - outputs comma-separated values with proper escaping
 *
 * @example
 * ```
 * 1,Alice,10.5
 * 2,"Bob, Jr.",20.3
 * ```
 */
export class CsvFormatter implements Formatter {
  readonly contentType = 'text/csv; charset=UTF-8';
  private withNames: boolean;

  constructor(options?: DelimitedFormatterOptions) {
    this.withNames = options?.withNames ?? false;
  }

  format(result: QueryResult, _options?: FormatterOptions): string {
    if (result.data.length === 0 && !this.withNames) {
      return '';
    }

    const lines: string[] = [];

    // Add header row if withNames (headers are always quoted)
    if (this.withNames) {
      lines.push(result.meta.map(col => `"${col.name}"`).join(','));
    }

    // Add data rows
    for (const row of result.data) {
      const values = result.meta.map(col => {
        const value = row[col.name];
        if (value === null || value === undefined) {
          return '';
        }
        return this.formatCsvValue(value);
      });
      lines.push(values.join(','));
    }

    if (lines.length === 0) {
      return '';
    }

    return lines.join('\n') + '\n';
  }

  /**
   * Format a single value for CSV output with proper escaping
   */
  private formatCsvValue(value: unknown): string {
    const str = String(value);

    // Check if quoting is needed
    if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
      // Escape quotes by doubling them and wrap in quotes
      return `"${str.replace(/"/g, '""')}"`;
    }

    return str;
  }
}

// ============================================================================
// Pretty Formatter
// ============================================================================

/**
 * Pretty formatter - outputs human-readable ASCII table
 *
 * @example
 * ```
 * +----+-------+-------+
 * | id | name  | value |
 * +----+-------+-------+
 * |  1 | Alice |  10.5 |
 * |  2 | Bob   |  20.3 |
 * +----+-------+-------+
 * ```
 */
export class PrettyFormatter implements Formatter {
  readonly contentType = 'text/plain; charset=UTF-8';

  format(result: QueryResult, _options?: FormatterOptions): string {
    const { meta, data } = result;

    if (meta.length === 0) {
      return '';
    }

    // Calculate column widths
    const colWidths = meta.map(col => {
      let maxWidth = col.name.length;
      for (const row of data) {
        const value = row[col.name];
        const strValue = value === null || value === undefined ? 'NULL' : String(value);
        maxWidth = Math.max(maxWidth, strValue.length);
      }
      return maxWidth;
    });

    // Build separator line
    const separator = '+' + colWidths.map(w => '-'.repeat(w + 2)).join('+') + '+';

    // Build header row
    const headerRow = '|' + meta.map((col, i) => {
      return ' ' + col.name.padEnd(colWidths[i]) + ' ';
    }).join('|') + '|';

    const lines: string[] = [separator, headerRow, separator];

    // Build data rows
    for (const row of data) {
      const dataRow = '|' + meta.map((col, i) => {
        const value = row[col.name];
        const strValue = value === null || value === undefined ? 'NULL' : String(value);
        // Right-align numbers, left-align everything else
        const isNumeric = typeof value === 'number' ||
          (typeof value === 'string' && !isNaN(Number(value)) && value !== '');
        const padded = isNumeric
          ? strValue.padStart(colWidths[i])
          : strValue.padEnd(colWidths[i]);
        return ' ' + padded + ' ';
      }).join('|') + '|';
      lines.push(dataRow);
    }

    lines.push(separator);

    return lines.join('\n') + '\n';
  }
}

// ============================================================================
// Format Detection
// ============================================================================

/**
 * Options for format detection
 */
export interface FormatDetectionOptions {
  /** SQL query string (may contain FORMAT clause) */
  sql: string;
  /** HTTP headers (may contain X-ClickHouse-Format) */
  headers?: Record<string, string | null>;
  /** Query parameters (may contain default_format) */
  params?: Record<string, string>;
  /** If true, returns object with cleaned SQL and format */
  returnCleanSql?: boolean;
}

/**
 * Format name normalization map (handles aliases and case variations)
 */
const FORMAT_ALIASES: Record<string, string> = {
  json: 'JSON',
  jsoncompact: 'JSONCompact',
  jsoneachrow: 'JSONEachRow',
  jsonstringsrow: 'JSONStringsEachRow',
  jsonstrings: 'JSONStringsEachRow',
  csv: 'CSV',
  csvwithnames: 'CSVWithNames',
  tsv: 'TabSeparated',
  tsvwithnames: 'TabSeparatedWithNames',
  tabseparated: 'TabSeparated',
  tabseparatedwithnames: 'TabSeparatedWithNames',
  pretty: 'Pretty',
  prettycompact: 'PrettyCompact',
};

/**
 * Normalize format name (handle aliases and case)
 */
function normalizeFormat(format: string): string {
  const lower = format.toLowerCase();
  return FORMAT_ALIASES[lower] || format;
}

/**
 * Extract FORMAT clause from SQL and return cleaned SQL
 */
function extractFormatFromSql(sql: string): { sql: string; format: string | null } {
  // Match FORMAT at the end of query, with optional whitespace
  const formatMatch = sql.match(/\s+FORMAT\s+(\w+)\s*$/i);

  if (formatMatch) {
    const format = normalizeFormat(formatMatch[1]);
    const cleanSql = sql.slice(0, formatMatch.index).trim();
    return { sql: cleanSql, format };
  }

  return { sql, format: null };
}

/**
 * Detect output format from SQL, headers, and query parameters
 *
 * Priority order:
 * 1. FORMAT clause in SQL query
 * 2. X-ClickHouse-Format header
 * 3. default_format query parameter
 * 4. Default: TabSeparated
 */
export function detectFormat(options: FormatDetectionOptions): string | { sql: string; format: string } {
  const { sql, headers, params, returnCleanSql } = options;

  // Extract from SQL FORMAT clause
  const { sql: cleanSql, format: sqlFormat } = extractFormatFromSql(sql);

  // Priority: SQL FORMAT > Header > Param > Default
  let format: string;

  if (sqlFormat) {
    format = sqlFormat;
  } else if (headers?.['X-ClickHouse-Format']) {
    format = normalizeFormat(headers['X-ClickHouse-Format']);
  } else if (params?.default_format) {
    format = normalizeFormat(params.default_format);
  } else {
    format = 'TabSeparated';
  }

  if (returnCleanSql) {
    return { sql: cleanSql, format };
  }

  return format;
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Get content type for a format
 */
export function getContentType(format: string): string {
  const normalized = normalizeFormat(format);
  return FORMAT_CONTENT_TYPES[normalized] || 'text/plain; charset=UTF-8';
}

/**
 * Get a formatter instance for the specified format
 */
export function getFormatter(format: string): Formatter {
  const normalized = normalizeFormat(format);

  switch (normalized) {
    case 'JSON':
      return new JsonFormatter();

    case 'JSONCompact':
      return new JsonCompactFormatter();

    case 'JSONEachRow':
    case 'JSONStringsEachRow':
      return new JsonEachRowFormatter();

    case 'TabSeparated':
    case 'TSV':
      return new TabSeparatedFormatter();

    case 'TabSeparatedWithNames':
    case 'TSVWithNames':
      return new TabSeparatedFormatter({ withNames: true });

    case 'CSV':
      return new CsvFormatter();

    case 'CSVWithNames':
      return new CsvFormatter({ withNames: true });

    case 'Pretty':
    case 'PrettyCompact':
      return new PrettyFormatter();

    default:
      // Fall back to JSON for unknown formats
      return new JsonFormatter();
  }
}

/**
 * Format a query result using the specified format
 *
 * @param result - The query result to format
 * @param format - The output format (default: 'JSON')
 * @param options - Additional formatter options
 * @returns Formatted string
 */
export function formatResult(
  result: QueryResult,
  format: string = 'JSON',
  options?: FormatterOptions
): string {
  const formatter = getFormatter(format);
  return formatter.format(result, options);
}
