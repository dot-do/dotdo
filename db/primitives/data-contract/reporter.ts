/**
 * Report Generator - Human-readable validation reports
 *
 * Generates reports from validation results in multiple formats:
 * - JSON (programmatic use)
 * - HTML (human-readable, styled)
 * - Markdown (documentation, PRs)
 * - JUnit XML (CI integration)
 *
 * Features:
 * - Summary statistics (total, passed, failed, warned)
 * - Per-rule detailed results
 * - Failed row samples (configurable limit)
 * - Trend tracking over time
 * - Diff reports for comparing runs
 *
 * @example
 * ```typescript
 * import { ReportGenerator, createReporter } from 'dotdo/data-contract'
 * import { runValidation } from './validation-runner'
 *
 * const reporter = createReporter({ suiteName: 'Customer Data' })
 * const validationResult = runValidation(suite, data)
 * const report = reporter.generate(validationResult)
 *
 * // Format for different outputs
 * const json = reporter.format(report, 'json')
 * const html = reporter.format(report, 'html')
 * const markdown = reporter.format(report, 'markdown')
 * const junit = reporter.format(report, 'junit')
 *
 * // Track trends
 * reporter.recordRun(validationResult)
 * const trend = reporter.getTrend()
 * ```
 */

import type { ValidationReport, RowValidationResult } from './validation-runner'
import type { ExpectationFailure, ExpectationType } from './expectation-dsl'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Supported output formats
 */
export type ReportFormat = 'json' | 'html' | 'markdown' | 'junit'

/**
 * Report generator options
 */
export interface ReportOptions {
  /** Suite name displayed in reports */
  suiteName?: string
  /** Maximum failed row samples to include (default: 10) */
  maxFailedRowSamples?: number
  /** Maximum trend history entries (default: 100) */
  maxTrendEntries?: number
  /** Pretty print JSON output (default: true) */
  prettyPrint?: boolean
}

/**
 * Report summary statistics
 */
export interface ReportSummary {
  /** Total records validated */
  total: number
  /** Records that passed all expectations */
  passed: number
  /** Records that failed one or more expectations */
  failed: number
  /** Records with warnings (if applicable) */
  warned: number
  /** Pass rate as percentage (0-100) */
  passRate: number
}

/**
 * Detailed result for a single expectation
 */
export interface ExpectationResultDetail {
  /** Column being validated */
  column: string
  /** Expectation type */
  type: ExpectationType
  /** Whether expectation passed overall */
  passed: boolean
  /** Number of failures for this expectation */
  failureCount: number
  /** Duration in milliseconds */
  durationMs: number
  /** Sample failure messages */
  sampleFailures: string[]
}

/**
 * Failed row sample data
 */
export interface FailedRowSample {
  /** Row index in original data */
  rowIndex: number
  /** The original row data */
  data: Record<string, unknown>
  /** Failures for this row */
  failures: ExpectationFailure[]
}

/**
 * Validation report data structure
 */
export interface ValidationReportData {
  /** Suite name */
  suite: string
  /** When the validation ran */
  timestamp: Date
  /** Total duration in milliseconds */
  duration: number
  /** Overall pass/fail */
  passed: boolean
  /** Summary statistics */
  summary: ReportSummary
  /** Per-expectation results */
  results: ExpectationResultDetail[]
  /** Sample of failed rows */
  failedRows: FailedRowSample[]
}

/**
 * Formatted report output
 */
export interface FormattedReport {
  /** Format type */
  format: ReportFormat
  /** Formatted content string */
  content: string
}

/**
 * Single trend entry
 */
export interface TrendEntry {
  /** When the run occurred */
  timestamp: Date
  /** Pass rate percentage */
  passRate: number
  /** Total records */
  total: number
  /** Failed records */
  failed: number
  /** Duration in milliseconds */
  duration: number
}

/**
 * Trend direction
 */
export type TrendDirection = 'improving' | 'declining' | 'stable'

/**
 * Trend data over time
 */
export interface TrendData {
  /** Historical entries */
  entries: TrendEntry[]
  /** Overall direction */
  direction: TrendDirection
}

/**
 * Diff between two validation runs
 */
export interface ReportDiff {
  /** Change in passed count */
  passedDelta: number
  /** Change in failed count */
  failedDelta: number
  /** Change in pass rate percentage */
  passRateDelta: number
  /** Newly introduced failures */
  newFailures: string[]
  /** Resolved failures from previous run */
  resolvedFailures: string[]
}

// ============================================================================
// REPORT GENERATOR CLASS
// ============================================================================

/**
 * Generates human-readable validation reports in multiple formats
 */
export class ReportGenerator {
  private options: Required<ReportOptions>
  private trendHistory: TrendEntry[] = []

  constructor(options?: ReportOptions) {
    this.options = {
      suiteName: options?.suiteName ?? 'Validation Report',
      maxFailedRowSamples: options?.maxFailedRowSamples ?? 10,
      maxTrendEntries: options?.maxTrendEntries ?? 100,
      prettyPrint: options?.prettyPrint ?? true,
    }
  }

  // ============================================================================
  // REPORT GENERATION
  // ============================================================================

  /**
   * Generate a structured report from validation results
   */
  generate(validationReport: ValidationReport): ValidationReportData {
    const timestamp = new Date()
    const duration = validationReport.timing.totalMs

    // Calculate summary
    const summary = this.calculateSummary(validationReport)

    // Build per-expectation results
    const results = this.buildExpectationResults(validationReport)

    // Collect failed row samples
    const failedRows = this.collectFailedRows(validationReport)

    return {
      suite: this.options.suiteName,
      timestamp,
      duration,
      passed: validationReport.passed,
      summary,
      results,
      failedRows,
    }
  }

  /**
   * Format a report into the specified output format
   */
  format(report: ValidationReportData, format: ReportFormat): FormattedReport {
    let content: string

    switch (format) {
      case 'json':
        content = this.formatJSON(report)
        break
      case 'html':
        content = this.formatHTML(report)
        break
      case 'markdown':
        content = this.formatMarkdown(report)
        break
      case 'junit':
        content = this.formatJUnit(report)
        break
      default:
        throw new Error(`Unsupported format: ${format}`)
    }

    return { format, content }
  }

  // ============================================================================
  // TREND TRACKING
  // ============================================================================

  /**
   * Record a validation run for trend tracking
   */
  recordRun(validationReport: ValidationReport): void {
    const entry: TrendEntry = {
      timestamp: new Date(),
      passRate: validationReport.totalRecords > 0
        ? (validationReport.passedRecords / validationReport.totalRecords) * 100
        : 100,
      total: validationReport.totalRecords,
      failed: validationReport.failedRecords,
      duration: validationReport.timing.totalMs,
    }

    this.trendHistory.push(entry)

    // Trim history if exceeds max
    if (this.trendHistory.length > this.options.maxTrendEntries) {
      this.trendHistory = this.trendHistory.slice(-this.options.maxTrendEntries)
    }
  }

  /**
   * Get trend data from recorded runs
   */
  getTrend(): TrendData {
    const direction = this.calculateTrendDirection()
    return {
      entries: [...this.trendHistory],
      direction,
    }
  }

  /**
   * Clear trend history
   */
  clearTrend(): void {
    this.trendHistory = []
  }

  // ============================================================================
  // DIFF REPORTS
  // ============================================================================

  /**
   * Generate a diff between two validation runs
   */
  diff(previous: ValidationReportData, current: ValidationReportData): ReportDiff {
    const passedDelta = current.summary.passed - previous.summary.passed
    const failedDelta = current.summary.failed - previous.summary.failed
    const passRateDelta = current.summary.passRate - previous.summary.passRate

    // Identify new and resolved failures
    const previousFailures = new Set(
      previous.failedRows.flatMap((row) =>
        row.failures.map((f) => `${f.column}:${f.expectationType}`)
      )
    )
    const currentFailures = new Set(
      current.failedRows.flatMap((row) =>
        row.failures.map((f) => `${f.column}:${f.expectationType}`)
      )
    )

    const newFailures = Array.from(currentFailures).filter((f) => !previousFailures.has(f))
    const resolvedFailures = Array.from(previousFailures).filter((f) => !currentFailures.has(f))

    return {
      passedDelta,
      failedDelta,
      passRateDelta,
      newFailures,
      resolvedFailures,
    }
  }

  // ============================================================================
  // STATIC HELPERS
  // ============================================================================

  /**
   * Get file extension for a format
   */
  static getExtension(format: ReportFormat): string {
    const extensions: Record<ReportFormat, string> = {
      json: '.json',
      html: '.html',
      markdown: '.md',
      junit: '.xml',
    }
    return extensions[format]
  }

  /**
   * Get MIME type for a format
   */
  static getMimeType(format: ReportFormat): string {
    const mimeTypes: Record<ReportFormat, string> = {
      json: 'application/json',
      html: 'text/html',
      markdown: 'text/markdown',
      junit: 'application/xml',
    }
    return mimeTypes[format]
  }

  /**
   * Generate a filename for the report
   */
  generateFilename(report: ValidationReportData, format: ReportFormat): string {
    const safeName = report.suite.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()
    const dateStr = report.timestamp.toISOString().split('T')[0]
    const ext = ReportGenerator.getExtension(format)
    return `${safeName}-${dateStr}${ext}`
  }

  // ============================================================================
  // PRIVATE: SUMMARY CALCULATION
  // ============================================================================

  private calculateSummary(validationReport: ValidationReport): ReportSummary {
    const total = validationReport.totalRecords
    const passed = validationReport.passedRecords
    const failed = validationReport.failedRecords
    const warned = validationReport.skippedRecords // Use skipped as warned proxy
    const passRate = total > 0 ? Math.round((passed / total) * 100) : 100

    return { total, passed, failed, warned, passRate }
  }

  // ============================================================================
  // PRIVATE: EXPECTATION RESULTS
  // ============================================================================

  private buildExpectationResults(validationReport: ValidationReport): ExpectationResultDetail[] {
    // Group failures by column and type
    const failureGroups = new Map<string, ExpectationFailure[]>()

    for (const failure of validationReport.failures) {
      const key = `${failure.column}:${failure.expectationType}`
      const group = failureGroups.get(key) ?? []
      group.push(failure)
      failureGroups.set(key, group)
    }

    // Build results - we need to infer expectations from failures
    // Since we don't have direct access to the original suite, we build from failures
    const results: ExpectationResultDetail[] = []
    const seenColumns = new Set<string>()

    // Add results from failures
    for (const [key, failures] of Array.from(failureGroups)) {
      const [column, type] = key.split(':') as [string, ExpectationType]
      seenColumns.add(column)

      results.push({
        column,
        type,
        passed: false,
        failureCount: failures.length,
        durationMs: 0, // Not tracked per-expectation in ValidationReport
        sampleFailures: failures.slice(0, 3).map((f) => f.message),
      })
    }

    // Add passing rows (inferred from row results)
    for (const rowResult of validationReport.rowResults) {
      if (rowResult.passed) {
        // Mark any columns we've seen as having some passes
        // This is a heuristic since we don't have full expectation info
      }
    }

    // If no failures, create placeholder results showing all passed
    if (results.length === 0 && validationReport.expectationsChecked > 0) {
      // We know expectations were checked but have no failures
      // Create a generic "all passed" result
      results.push({
        column: '*',
        type: 'not_null' as ExpectationType, // placeholder
        passed: true,
        failureCount: 0,
        durationMs: validationReport.timing.totalMs / validationReport.expectationsChecked,
        sampleFailures: [],
      })
    }

    // Ensure all results have duration estimate
    const avgDuration = validationReport.timing.totalMs / Math.max(results.length, 1)
    for (const result of results) {
      if (result.durationMs === 0) {
        result.durationMs = avgDuration
      }
    }

    return results
  }

  // ============================================================================
  // PRIVATE: FAILED ROW COLLECTION
  // ============================================================================

  private collectFailedRows(validationReport: ValidationReport): FailedRowSample[] {
    const failedRows: FailedRowSample[] = []

    for (const rowResult of validationReport.rowResults) {
      if (!rowResult.passed && failedRows.length < this.options.maxFailedRowSamples) {
        failedRows.push({
          rowIndex: rowResult.index,
          data: rowResult.data ?? {},
          failures: rowResult.failures,
        })
      }
    }

    return failedRows
  }

  // ============================================================================
  // PRIVATE: TREND CALCULATION
  // ============================================================================

  private calculateTrendDirection(): TrendDirection {
    if (this.trendHistory.length < 2) {
      return 'stable'
    }

    const recent = this.trendHistory.slice(-5) // Look at last 5 entries
    if (recent.length < 2) {
      return 'stable'
    }

    const first = recent[0]!.passRate
    const last = recent[recent.length - 1]!.passRate
    const delta = last - first

    if (delta > 5) {
      return 'improving'
    } else if (delta < -5) {
      return 'declining'
    }
    return 'stable'
  }

  // ============================================================================
  // PRIVATE: JSON FORMATTING
  // ============================================================================

  private formatJSON(report: ValidationReportData): string {
    const data = {
      suite: report.suite,
      timestamp: report.timestamp.toISOString(),
      duration: report.duration,
      passed: report.passed,
      summary: report.summary,
      results: report.results,
      failedRows: report.failedRows.map((row) => ({
        rowIndex: row.rowIndex,
        data: row.data,
        failures: row.failures.map((f) => ({
          column: f.column,
          type: f.expectationType,
          message: f.message,
          rowIndex: f.rowIndex,
          actualValue: f.actualValue,
        })),
      })),
    }

    if (this.options.prettyPrint) {
      return JSON.stringify(data, null, 2)
    }
    return JSON.stringify(data)
  }

  // ============================================================================
  // PRIVATE: HTML FORMATTING
  // ============================================================================

  private formatHTML(report: ValidationReportData): string {
    const statusClass = report.passed ? 'pass' : 'fail'
    const statusText = report.passed ? 'PASSED' : 'FAILED'

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${this.escapeHtml(report.suite)} - Validation Report</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 40px; }
    h1 { margin-bottom: 10px; }
    .status { padding: 4px 12px; border-radius: 4px; font-weight: bold; }
    .status.pass { background: #d4edda; color: #155724; }
    .status.fail { background: #f8d7da; color: #721c24; }
    .summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px; margin: 20px 0; }
    .summary-card { padding: 20px; border-radius: 8px; background: #f8f9fa; }
    .summary-card h3 { margin: 0 0 8px 0; font-size: 14px; color: #6c757d; }
    .summary-card .value { font-size: 32px; font-weight: bold; }
    table { width: 100%; border-collapse: collapse; margin: 20px 0; }
    th, td { padding: 12px; text-align: left; border-bottom: 1px solid #dee2e6; }
    th { background: #f8f9fa; font-weight: 600; }
    .badge { padding: 2px 8px; border-radius: 4px; font-size: 12px; }
    .badge.pass { background: #d4edda; color: #155724; }
    .badge.fail { background: #f8d7da; color: #721c24; }
    .failed-row { background: #fff5f5; padding: 15px; margin: 10px 0; border-radius: 8px; border-left: 4px solid #dc3545; }
    .failed-row h4 { margin: 0 0 10px 0; }
    .failure-list { margin: 0; padding-left: 20px; }
    pre { background: #f8f9fa; padding: 10px; border-radius: 4px; overflow-x: auto; }
    .meta { color: #6c757d; font-size: 14px; margin-bottom: 20px; }
  </style>
</head>
<body>
  <h1>${this.escapeHtml(report.suite)}</h1>
  <p class="meta">
    <span class="status ${statusClass}">${statusText}</span>
    Generated: ${report.timestamp.toISOString()} | Duration: ${report.duration.toFixed(2)}ms
  </p>

  <h2>Summary</h2>
  <div class="summary">
    <div class="summary-card">
      <h3>Total Records</h3>
      <div class="value">${report.summary.total}</div>
    </div>
    <div class="summary-card">
      <h3>Passed</h3>
      <div class="value" style="color: #28a745">${report.summary.passed}</div>
    </div>
    <div class="summary-card">
      <h3>Failed</h3>
      <div class="value" style="color: #dc3545">${report.summary.failed}</div>
    </div>
    <div class="summary-card">
      <h3>Pass Rate</h3>
      <div class="value">${report.summary.passRate}%</div>
    </div>
  </div>

  <h2>Expectation Results</h2>
  <table>
    <thead>
      <tr>
        <th>Column</th>
        <th>Type</th>
        <th>Status</th>
        <th>Failures</th>
        <th>Duration</th>
      </tr>
    </thead>
    <tbody>
      ${report.results.map((r) => `
      <tr>
        <td><code>${this.escapeHtml(r.column)}</code></td>
        <td>${this.escapeHtml(r.type)}</td>
        <td><span class="badge ${r.passed ? 'pass' : 'fail'}">${r.passed ? 'PASS' : 'FAIL'}</span></td>
        <td>${r.failureCount}</td>
        <td>${r.durationMs.toFixed(2)}ms</td>
      </tr>
      `).join('')}
    </tbody>
  </table>

  ${report.failedRows.length > 0 ? `
  <h2>Failed Rows (Sample)</h2>
  ${report.failedRows.map((row) => `
  <div class="failed-row">
    <h4>Row ${row.rowIndex}</h4>
    <pre>${this.escapeHtml(JSON.stringify(row.data, null, 2))}</pre>
    <ul class="failure-list">
      ${row.failures.map((f) => `<li><strong>${this.escapeHtml(f.column)}</strong>: ${this.escapeHtml(f.message)}</li>`).join('')}
    </ul>
  </div>
  `).join('')}
  ` : ''}
</body>
</html>`
  }

  // ============================================================================
  // PRIVATE: MARKDOWN FORMATTING
  // ============================================================================

  private formatMarkdown(report: ValidationReportData): string {
    const status = report.passed ? 'PASS' : 'FAIL'
    const statusEmoji = report.passed ? '' : '' // Keeping plain per guidelines

    let md = `# ${report.suite}\n\n`
    md += `**Status:** ${status}  \n`
    md += `**Generated:** ${report.timestamp.toISOString()}  \n`
    md += `**Duration:** ${report.duration.toFixed(2)}ms\n\n`

    md += `## Summary\n\n`
    md += `| Metric | Value |\n`
    md += `|--------|-------|\n`
    md += `| Total Records | ${report.summary.total} |\n`
    md += `| Passed | ${report.summary.passed} |\n`
    md += `| Failed | ${report.summary.failed} |\n`
    md += `| Pass Rate | ${report.summary.passRate}% |\n\n`

    md += `## Expectation Results\n\n`
    md += `| Column | Type | Status | Failures | Duration |\n`
    md += `|--------|------|--------|----------|----------|\n`
    for (const r of report.results) {
      const statusBadge = r.passed ? 'PASS' : 'FAIL'
      md += `| \`${r.column}\` | ${r.type} | ${statusBadge} | ${r.failureCount} | ${r.durationMs.toFixed(2)}ms |\n`
    }
    md += '\n'

    if (report.failedRows.length > 0) {
      md += `## Failed Rows (Sample)\n\n`
      for (const row of report.failedRows) {
        md += `### Row ${row.rowIndex}\n\n`
        md += `\`\`\`json\n${JSON.stringify(row.data, null, 2)}\n\`\`\`\n\n`
        md += `**Failures:**\n`
        for (const f of row.failures) {
          md += `- **${f.column}**: ${f.message}\n`
        }
        md += '\n'
      }
    }

    return md
  }

  // ============================================================================
  // PRIVATE: JUNIT XML FORMATTING
  // ============================================================================

  private formatJUnit(report: ValidationReportData): string {
    const testCount = report.results.length
    const failureCount = report.results.filter((r) => !r.passed).length
    const time = (report.duration / 1000).toFixed(3) // Convert to seconds
    const timestamp = report.timestamp.toISOString()

    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`
    xml += `<testsuite name="${this.escapeXml(report.suite)}" tests="${testCount}" failures="${failureCount}" errors="0" time="${time}" timestamp="${timestamp}">\n`

    for (const result of report.results) {
      const testTime = (result.durationMs / 1000).toFixed(3)
      const testName = `${result.column}:${result.type}`

      if (result.passed) {
        xml += `  <testcase name="${this.escapeXml(testName)}" classname="${this.escapeXml(report.suite)}" time="${testTime}"/>\n`
      } else {
        xml += `  <testcase name="${this.escapeXml(testName)}" classname="${this.escapeXml(report.suite)}" time="${testTime}">\n`
        xml += `    <failure message="${this.escapeXml(result.sampleFailures[0] ?? 'Validation failed')}" type="ValidationFailure">\n`
        xml += `      ${result.sampleFailures.map((m) => this.escapeXml(m)).join('\n      ')}\n`
        xml += `    </failure>\n`
        xml += `  </testcase>\n`
      }
    }

    xml += `</testsuite>\n`
    return xml
  }

  // ============================================================================
  // PRIVATE: ESCAPING
  // ============================================================================

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;')
  }

  private escapeXml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;')
  }
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Create a report generator
 */
export function createReporter(options?: ReportOptions): ReportGenerator {
  return new ReportGenerator(options)
}

/**
 * Quick helper to generate a report from validation results
 */
export function generateReport(
  validationReport: ValidationReport,
  options?: ReportOptions
): ValidationReportData {
  const reporter = createReporter(options)
  return reporter.generate(validationReport)
}
