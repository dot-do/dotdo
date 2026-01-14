/**
 * POSIX Compliance Report Generator
 *
 * Generates compliance reports in various formats from test results.
 * Supports Markdown, JSON, and console output.
 *
 * @module tests/posix/report
 */

import type { ComplianceResults, CommandTestResults } from './runner.js'
import type { TestResult, TestStatus } from './helpers.js'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Report format options
 */
export type ReportFormat = 'markdown' | 'json' | 'console' | 'summary'

/**
 * Options for report generation
 */
export interface ReportOptions {
  /** Report format */
  format?: ReportFormat
  /** Include individual test results */
  includeDetails?: boolean
  /** Include timing information */
  includeTiming?: boolean
  /** Title for the report */
  title?: string
  /** Include timestamp */
  includeTimestamp?: boolean
}

// ============================================================================
// REPORT GENERATORS
// ============================================================================

/**
 * Generate a compliance report
 */
export function generateReport(
  results: ComplianceResults,
  options: ReportOptions = {}
): string {
  const format = options.format ?? 'markdown'

  switch (format) {
    case 'markdown':
      return generateMarkdownReport(results, options)
    case 'json':
      return generateJsonReport(results, options)
    case 'console':
      return generateConsoleReport(results, options)
    case 'summary':
      return generateSummaryReport(results, options)
    default:
      throw new Error(`Unknown report format: ${format}`)
  }
}

/**
 * Generate a Markdown compliance report
 */
export function generateMarkdownReport(
  results: ComplianceResults,
  options: ReportOptions = {}
): string {
  const lines: string[] = []
  const title = options.title ?? 'POSIX Compliance Report'
  const includeDetails = options.includeDetails ?? true
  const includeTiming = options.includeTiming ?? true
  const includeTimestamp = options.includeTimestamp ?? true

  // Header
  lines.push(`# ${title}`)
  lines.push('')

  if (includeTimestamp) {
    lines.push(`Generated: ${results.timestamp.toISOString()}`)
    lines.push('')
  }

  // Summary
  lines.push('## Summary')
  lines.push('')
  lines.push(`| Metric | Value |`)
  lines.push(`| ------ | ----- |`)
  lines.push(`| Total Tests | ${results.totalTests} |`)
  lines.push(`| Passed | ${results.totalPassed} |`)
  lines.push(`| Failed | ${results.totalFailed} |`)
  lines.push(`| Skipped | ${results.totalSkipped} |`)
  lines.push(`| **Compliance** | **${results.compliancePercentage}%** |`)

  if (includeTiming) {
    lines.push(`| Duration | ${formatDuration(results.duration)} |`)
  }

  lines.push('')

  // Command summary table
  lines.push('## Results by Command')
  lines.push('')
  lines.push('| Command | Total | Pass | Fail | Skip | Compliance |')
  lines.push('| ------- | ----: | ---: | ---: | ---: | ---------: |')

  for (const cmd of results.commands) {
    const countedTests = cmd.total - cmd.skipped
    const compliance = countedTests > 0
      ? Math.round((cmd.passed / countedTests) * 100)
      : 0
    const statusIcon = getStatusIcon(compliance)

    lines.push(
      `| ${cmd.command} | ${cmd.total} | ${cmd.passed} | ${cmd.failed} | ${cmd.skipped} | ${statusIcon} ${compliance}% |`
    )
  }

  lines.push('')

  // Detailed results per command
  if (includeDetails) {
    lines.push('## Detailed Results')
    lines.push('')

    for (const cmd of results.commands) {
      lines.push(`### ${cmd.command}`)
      lines.push('')

      if (cmd.results.length === 0) {
        lines.push('_No tests defined._')
        lines.push('')
        continue
      }

      lines.push('| Test | Status | Details |')
      lines.push('| ---- | :----: | ------- |')

      for (const test of cmd.results) {
        const statusEmoji = getStatusEmoji(test.status)
        const details = test.error
          ? escapeMarkdown(test.error.substring(0, 50) + (test.error.length > 50 ? '...' : ''))
          : '-'
        lines.push(`| ${escapeMarkdown(test.name)} | ${statusEmoji} | ${details} |`)
      }

      lines.push('')
    }
  }

  // Failed tests summary
  const failedTests = results.commands
    .flatMap(cmd => cmd.results.filter(r => r.status === 'fail').map(r => ({ ...r, command: cmd.command })))

  if (failedTests.length > 0) {
    lines.push('## Failed Tests')
    lines.push('')

    for (const test of failedTests) {
      lines.push(`### ${test.command}: ${test.name}`)
      lines.push('')
      lines.push(`**Command:** \`${test.command}\``)
      lines.push('')
      if (test.expected !== undefined) {
        lines.push(`**Expected:**`)
        lines.push('```')
        lines.push(test.expected)
        lines.push('```')
      }
      if (test.actual !== undefined) {
        lines.push(`**Actual:**`)
        lines.push('```')
        lines.push(test.actual)
        lines.push('```')
      }
      if (test.error) {
        lines.push(`**Error:** ${test.error}`)
      }
      lines.push('')
    }
  }

  return lines.join('\n')
}

/**
 * Generate a JSON compliance report
 */
export function generateJsonReport(
  results: ComplianceResults,
  options: ReportOptions = {}
): string {
  const includeDetails = options.includeDetails ?? true

  const report = {
    title: options.title ?? 'POSIX Compliance Report',
    timestamp: results.timestamp.toISOString(),
    summary: {
      totalTests: results.totalTests,
      passed: results.totalPassed,
      failed: results.totalFailed,
      skipped: results.totalSkipped,
      compliancePercentage: results.compliancePercentage,
      durationMs: results.duration,
    },
    commands: results.commands.map(cmd => ({
      command: cmd.command,
      total: cmd.total,
      passed: cmd.passed,
      failed: cmd.failed,
      skipped: cmd.skipped,
      compliancePercentage: calculateCompliance(cmd),
      durationMs: cmd.duration,
      ...(includeDetails ? { tests: cmd.results } : {}),
    })),
  }

  return JSON.stringify(report, null, 2)
}

/**
 * Generate a console-friendly report
 */
export function generateConsoleReport(
  results: ComplianceResults,
  options: ReportOptions = {}
): string {
  const lines: string[] = []
  const title = options.title ?? 'POSIX Compliance Report'
  const includeDetails = options.includeDetails ?? false
  const includeTiming = options.includeTiming ?? true

  // Header
  lines.push('='.repeat(60))
  lines.push(title.toUpperCase())
  lines.push('='.repeat(60))
  lines.push('')

  // Summary
  lines.push(`Total:      ${results.totalTests}`)
  lines.push(`Passed:     ${results.totalPassed} (${getPercentage(results.totalPassed, results.totalTests)})`)
  lines.push(`Failed:     ${results.totalFailed} (${getPercentage(results.totalFailed, results.totalTests)})`)
  lines.push(`Skipped:    ${results.totalSkipped} (${getPercentage(results.totalSkipped, results.totalTests)})`)
  lines.push('')
  lines.push(`COMPLIANCE: ${results.compliancePercentage}%`)

  if (includeTiming) {
    lines.push(`Duration:   ${formatDuration(results.duration)}`)
  }

  lines.push('')
  lines.push('-'.repeat(60))
  lines.push('')

  // Command results
  for (const cmd of results.commands) {
    const compliance = calculateCompliance(cmd)
    const statusBar = getStatusBar(compliance)
    lines.push(`${cmd.command.padEnd(15)} ${statusBar} ${compliance}%`)

    if (includeDetails) {
      for (const test of cmd.results) {
        const statusChar = test.status === 'pass' ? '+' : test.status === 'fail' ? 'X' : '-'
        lines.push(`  [${statusChar}] ${test.name}`)
        if (test.status === 'fail' && test.error) {
          lines.push(`      Error: ${test.error}`)
        }
      }
    }
  }

  lines.push('')
  lines.push('='.repeat(60))

  return lines.join('\n')
}

/**
 * Generate a brief summary report
 */
export function generateSummaryReport(
  results: ComplianceResults,
  options: ReportOptions = {}
): string {
  const lines: string[] = []

  lines.push(`POSIX Compliance: ${results.compliancePercentage}%`)
  lines.push(`Tests: ${results.totalPassed}/${results.totalTests - results.totalSkipped} passed`)

  if (results.totalFailed > 0) {
    lines.push(`Failed commands: ${results.commands.filter(c => c.failed > 0).map(c => c.command).join(', ')}`)
  }

  return lines.join('\n')
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Calculate compliance percentage for a command
 */
function calculateCompliance(cmd: CommandTestResults): number {
  const countedTests = cmd.total - cmd.skipped
  return countedTests > 0
    ? Math.round((cmd.passed / countedTests) * 100)
    : 0
}

/**
 * Format duration in human-readable format
 */
function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`
  }
  if (ms < 60000) {
    return `${(ms / 1000).toFixed(2)}s`
  }
  const minutes = Math.floor(ms / 60000)
  const seconds = ((ms % 60000) / 1000).toFixed(0)
  return `${minutes}m ${seconds}s`
}

/**
 * Get percentage string
 */
function getPercentage(value: number, total: number): string {
  if (total === 0) return '0%'
  return `${Math.round((value / total) * 100)}%`
}

/**
 * Get status icon for markdown
 */
function getStatusIcon(compliance: number): string {
  if (compliance >= 90) return ':white_check_mark:'
  if (compliance >= 70) return ':large_orange_diamond:'
  if (compliance >= 50) return ':warning:'
  return ':x:'
}

/**
 * Get status emoji for markdown table
 */
function getStatusEmoji(status: TestStatus): string {
  switch (status) {
    case 'pass':
      return ':white_check_mark:'
    case 'fail':
      return ':x:'
    case 'skip':
      return ':fast_forward:'
  }
}

/**
 * Get ASCII status bar for console output
 */
function getStatusBar(percentage: number): string {
  const width = 20
  const filled = Math.round((percentage / 100) * width)
  const empty = width - filled
  return `[${'#'.repeat(filled)}${'.'.repeat(empty)}]`
}

/**
 * Escape special markdown characters
 */
function escapeMarkdown(text: string): string {
  return text
    .replace(/\|/g, '\\|')
    .replace(/\n/g, ' ')
    .replace(/`/g, "'")
}

// ============================================================================
// WRITE FUNCTIONS
// ============================================================================

/**
 * Print report to console
 */
export function printReport(
  results: ComplianceResults,
  options: ReportOptions = {}
): void {
  const format = options.format ?? 'console'
  const report = generateReport(results, { ...options, format })
  console.log(report)
}

/**
 * Get compliance status as a simple object
 */
export function getComplianceStatus(results: ComplianceResults): {
  passing: boolean
  percentage: number
  passed: number
  failed: number
  skipped: number
  total: number
} {
  return {
    passing: results.totalFailed === 0,
    percentage: results.compliancePercentage,
    passed: results.totalPassed,
    failed: results.totalFailed,
    skipped: results.totalSkipped,
    total: results.totalTests,
  }
}

/**
 * Check if compliance meets a threshold
 */
export function meetsThreshold(
  results: ComplianceResults,
  threshold: number = 100
): boolean {
  return results.compliancePercentage >= threshold
}

/**
 * Get list of failing commands
 */
export function getFailingCommands(results: ComplianceResults): string[] {
  return results.commands
    .filter(cmd => cmd.failed > 0)
    .map(cmd => cmd.command)
}

/**
 * Get list of fully compliant commands
 */
export function getCompliantCommands(results: ComplianceResults): string[] {
  return results.commands
    .filter(cmd => cmd.failed === 0 && cmd.passed > 0)
    .map(cmd => cmd.command)
}
