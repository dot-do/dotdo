/**
 * Reporter tests
 *
 * Tests the ReportGenerator implementation for validation results:
 * - JSON output format
 * - HTML output format
 * - Markdown output format
 * - JUnit XML output format (CI integration)
 * - Summary statistics
 * - Per-rule results
 * - Failed row samples
 * - Trend tracking over time
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  ReportGenerator,
  createReporter,
  generateReport,
  type ReportFormat,
  type ReportOptions,
  type ValidationReportData,
  type FormattedReport,
  type ReportSummary,
  type ExpectationResultDetail,
  type TrendData,
  type TrendEntry,
} from '../reporter'
import { expect as exp } from '../expectation-dsl'
import { runValidation } from '../validation-runner'

// ============================================================================
// TEST FIXTURES
// ============================================================================

function createBasicSuite() {
  return [
    exp('id').toBeNotNull().build(),
    exp('email').toBeNotNull().and().toMatch(/^.+@.+\..+$/).build(),
    exp('age').toBeNumber().and().toBeBetween(0, 150).build(),
  ]
}

function createValidData() {
  return [
    { id: '1', email: 'alice@example.com', age: 30 },
    { id: '2', email: 'bob@example.com', age: 25 },
    { id: '3', email: 'carol@example.com', age: 35 },
  ]
}

function createInvalidData() {
  return [
    { id: null, email: 'alice@example.com', age: 30 },
    { id: '2', email: 'invalid', age: 25 },
    { id: '3', email: 'carol@example.com', age: 200 },
  ]
}

function createMixedData() {
  return [
    { id: '1', email: 'alice@example.com', age: 30 },
    { id: null, email: 'invalid', age: 200 },
    { id: '3', email: 'carol@example.com', age: 35 },
  ]
}

function createValidationReport(data: Record<string, unknown>[]) {
  const suite = createBasicSuite()
  return runValidation(suite, data)
}

// ============================================================================
// REPORT GENERATOR CREATION
// ============================================================================

describe('ReportGenerator', () => {
  describe('creation', () => {
    it('should create a reporter with default options', () => {
      const reporter = new ReportGenerator()
      expect(reporter).toBeInstanceOf(ReportGenerator)
    })

    it('should create a reporter with custom options', () => {
      const reporter = new ReportGenerator({
        suiteName: 'TestSuite',
        maxFailedRowSamples: 5,
      })
      expect(reporter).toBeInstanceOf(ReportGenerator)
    })

    it('should create reporter via factory function', () => {
      const reporter = createReporter({ suiteName: 'MyTests' })
      expect(reporter).toBeInstanceOf(ReportGenerator)
    })
  })

  // ============================================================================
  // REPORT GENERATION
  // ============================================================================

  describe('report generation', () => {
    let reporter: ReportGenerator

    beforeEach(() => {
      reporter = new ReportGenerator({ suiteName: 'TestSuite' })
    })

    it('should generate a report from validation result', () => {
      const validationReport = createValidationReport(createValidData())
      const report = reporter.generate(validationReport)

      expect(report).toBeDefined()
      expect(report.suite).toBe('TestSuite')
      expect(report.passed).toBe(true)
      expect(report.summary).toBeDefined()
    })

    it('should include timestamp in report', () => {
      const validationReport = createValidationReport(createValidData())
      const before = new Date()
      const report = reporter.generate(validationReport)
      const after = new Date()

      expect(report.timestamp).toBeInstanceOf(Date)
      expect(report.timestamp.getTime()).toBeGreaterThanOrEqual(before.getTime())
      expect(report.timestamp.getTime()).toBeLessThanOrEqual(after.getTime())
    })

    it('should include duration in report', () => {
      const validationReport = createValidationReport(createValidData())
      const report = reporter.generate(validationReport)

      expect(report.duration).toBeDefined()
      expect(typeof report.duration).toBe('number')
      expect(report.duration).toBeGreaterThanOrEqual(0)
    })

    it('should generate report via helper function', () => {
      const validationReport = createValidationReport(createValidData())
      const report = generateReport(validationReport, { suiteName: 'Helper' })

      expect(report.suite).toBe('Helper')
      expect(report.passed).toBe(true)
    })
  })

  // ============================================================================
  // SUMMARY STATISTICS
  // ============================================================================

  describe('summary statistics', () => {
    let reporter: ReportGenerator

    beforeEach(() => {
      reporter = new ReportGenerator({ suiteName: 'TestSuite' })
    })

    it('should calculate total records', () => {
      const validationReport = createValidationReport(createValidData())
      const report = reporter.generate(validationReport)

      expect(report.summary.total).toBe(3)
    })

    it('should calculate passed records for valid data', () => {
      const validationReport = createValidationReport(createValidData())
      const report = reporter.generate(validationReport)

      expect(report.summary.passed).toBe(3)
      expect(report.summary.failed).toBe(0)
    })

    it('should calculate failed records for invalid data', () => {
      const validationReport = createValidationReport(createInvalidData())
      const report = reporter.generate(validationReport)

      expect(report.summary.failed).toBeGreaterThan(0)
      expect(report.summary.passed).toBeLessThan(3)
    })

    it('should calculate pass rate percentage', () => {
      const validationReport = createValidationReport(createValidData())
      const report = reporter.generate(validationReport)

      expect(report.summary.passRate).toBe(100)
    })

    it('should calculate partial pass rate', () => {
      const data = [
        { id: '1', email: 'alice@example.com', age: 30 },
        { id: null, email: 'bob@example.com', age: 25 },
      ]
      const validationReport = createValidationReport(data)
      const report = reporter.generate(validationReport)

      expect(report.summary.passRate).toBe(50)
    })

    it('should handle empty data', () => {
      const validationReport = createValidationReport([])
      const report = reporter.generate(validationReport)

      expect(report.summary.total).toBe(0)
      expect(report.summary.passed).toBe(0)
      expect(report.summary.failed).toBe(0)
      expect(report.summary.passRate).toBe(100) // No failures in empty set
    })

    it('should track warned count when available', () => {
      const validationReport = createValidationReport(createValidData())
      const report = reporter.generate(validationReport)

      expect(report.summary.warned).toBeDefined()
      expect(typeof report.summary.warned).toBe('number')
    })
  })

  // ============================================================================
  // PER-RULE RESULTS
  // ============================================================================

  describe('per-rule results', () => {
    let reporter: ReportGenerator

    beforeEach(() => {
      reporter = new ReportGenerator({ suiteName: 'TestSuite' })
    })

    it('should include results for each expectation', () => {
      const validationReport = createValidationReport(createValidData())
      const report = reporter.generate(validationReport)

      expect(report.results).toBeDefined()
      expect(Array.isArray(report.results)).toBe(true)
    })

    it('should include expectation type in results', () => {
      const validationReport = createValidationReport(createValidData())
      const report = reporter.generate(validationReport)

      expect(report.results.length).toBeGreaterThan(0)
      report.results.forEach((result) => {
        expect(result.column).toBeDefined()
        expect(result.passed).toBeDefined()
      })
    })

    it('should include failure details in results', () => {
      const validationReport = createValidationReport(createInvalidData())
      const report = reporter.generate(validationReport)

      const failedResults = report.results.filter((r) => !r.passed)
      expect(failedResults.length).toBeGreaterThan(0)
      failedResults.forEach((result) => {
        expect(result.failureCount).toBeGreaterThan(0)
      })
    })

    it('should include duration per rule when available', () => {
      const validationReport = createValidationReport(createValidData())
      const report = reporter.generate(validationReport)

      report.results.forEach((result) => {
        expect(result.durationMs).toBeDefined()
        expect(typeof result.durationMs).toBe('number')
      })
    })
  })

  // ============================================================================
  // FAILED ROW SAMPLES
  // ============================================================================

  describe('failed row samples', () => {
    let reporter: ReportGenerator

    beforeEach(() => {
      reporter = new ReportGenerator({
        suiteName: 'TestSuite',
        maxFailedRowSamples: 5,
      })
    })

    it('should include failed row samples in report', () => {
      const validationReport = createValidationReport(createInvalidData())
      const report = reporter.generate(validationReport)

      expect(report.failedRows).toBeDefined()
      expect(Array.isArray(report.failedRows)).toBe(true)
    })

    it('should not include failed rows when all pass', () => {
      const validationReport = createValidationReport(createValidData())
      const report = reporter.generate(validationReport)

      expect(report.failedRows).toHaveLength(0)
    })

    it('should include row data in failed samples', () => {
      const validationReport = createValidationReport(createInvalidData())
      const report = reporter.generate(validationReport)

      if (report.failedRows.length > 0) {
        report.failedRows.forEach((row) => {
          expect(row.rowIndex).toBeDefined()
          expect(row.data).toBeDefined()
          expect(row.failures).toBeDefined()
        })
      }
    })

    it('should limit failed row samples', () => {
      const manyInvalidRows = Array.from({ length: 20 }, (_, i) => ({
        id: null,
        email: 'invalid',
        age: 200,
      }))
      const validationReport = createValidationReport(manyInvalidRows)
      const report = reporter.generate(validationReport)

      expect(report.failedRows.length).toBeLessThanOrEqual(5)
    })

    it('should respect custom maxFailedRowSamples', () => {
      const customReporter = new ReportGenerator({
        suiteName: 'TestSuite',
        maxFailedRowSamples: 2,
      })
      const manyInvalidRows = Array.from({ length: 10 }, () => ({
        id: null,
        email: 'invalid',
        age: 200,
      }))
      const validationReport = createValidationReport(manyInvalidRows)
      const report = customReporter.generate(validationReport)

      expect(report.failedRows.length).toBeLessThanOrEqual(2)
    })
  })

  // ============================================================================
  // JSON OUTPUT FORMAT
  // ============================================================================

  describe('JSON output format', () => {
    let reporter: ReportGenerator

    beforeEach(() => {
      reporter = new ReportGenerator({ suiteName: 'TestSuite' })
    })

    it('should format report as JSON', () => {
      const validationReport = createValidationReport(createValidData())
      const report = reporter.generate(validationReport)
      const formatted = reporter.format(report, 'json')

      expect(formatted.format).toBe('json')
      expect(formatted.content).toBeDefined()
      expect(typeof formatted.content).toBe('string')
    })

    it('should produce valid JSON', () => {
      const validationReport = createValidationReport(createValidData())
      const report = reporter.generate(validationReport)
      const formatted = reporter.format(report, 'json')

      expect(() => JSON.parse(formatted.content)).not.toThrow()
    })

    it('should include all report fields in JSON', () => {
      const validationReport = createValidationReport(createValidData())
      const report = reporter.generate(validationReport)
      const formatted = reporter.format(report, 'json')
      const parsed = JSON.parse(formatted.content)

      expect(parsed.suite).toBe('TestSuite')
      expect(parsed.passed).toBe(true)
      expect(parsed.summary).toBeDefined()
      expect(parsed.results).toBeDefined()
    })

    it('should format JSON with pretty printing by default', () => {
      const validationReport = createValidationReport(createValidData())
      const report = reporter.generate(validationReport)
      const formatted = reporter.format(report, 'json')

      expect(formatted.content).toContain('\n')
    })

    it('should support compact JSON option', () => {
      const customReporter = new ReportGenerator({
        suiteName: 'TestSuite',
        prettyPrint: false,
      })
      const validationReport = createValidationReport(createValidData())
      const report = customReporter.generate(validationReport)
      const formatted = customReporter.format(report, 'json')

      expect(formatted.content).not.toContain('\n  ')
    })
  })

  // ============================================================================
  // HTML OUTPUT FORMAT
  // ============================================================================

  describe('HTML output format', () => {
    let reporter: ReportGenerator

    beforeEach(() => {
      reporter = new ReportGenerator({ suiteName: 'TestSuite' })
    })

    it('should format report as HTML', () => {
      const validationReport = createValidationReport(createValidData())
      const report = reporter.generate(validationReport)
      const formatted = reporter.format(report, 'html')

      expect(formatted.format).toBe('html')
      expect(formatted.content).toBeDefined()
    })

    it('should include HTML structure', () => {
      const validationReport = createValidationReport(createValidData())
      const report = reporter.generate(validationReport)
      const formatted = reporter.format(report, 'html')

      expect(formatted.content).toContain('<!DOCTYPE html>')
      expect(formatted.content).toContain('<html')
      expect(formatted.content).toContain('</html>')
    })

    it('should include suite name in HTML title', () => {
      const validationReport = createValidationReport(createValidData())
      const report = reporter.generate(validationReport)
      const formatted = reporter.format(report, 'html')

      expect(formatted.content).toContain('<title>')
      expect(formatted.content).toContain('TestSuite')
    })

    it('should include summary section', () => {
      const validationReport = createValidationReport(createValidData())
      const report = reporter.generate(validationReport)
      const formatted = reporter.format(report, 'html')

      expect(formatted.content).toContain('Summary')
      expect(formatted.content).toContain('Total')
      expect(formatted.content).toContain('Passed')
    })

    it('should include pass/fail styling', () => {
      const validationReport = createValidationReport(createValidData())
      const report = reporter.generate(validationReport)
      const formatted = reporter.format(report, 'html')

      expect(formatted.content).toContain('pass')
    })

    it('should include results table', () => {
      const validationReport = createValidationReport(createValidData())
      const report = reporter.generate(validationReport)
      const formatted = reporter.format(report, 'html')

      expect(formatted.content).toContain('<table')
      expect(formatted.content).toContain('</table>')
    })

    it('should include failed rows section when failures exist', () => {
      const validationReport = createValidationReport(createInvalidData())
      const report = reporter.generate(validationReport)
      const formatted = reporter.format(report, 'html')

      expect(formatted.content).toContain('Failed')
    })
  })

  // ============================================================================
  // MARKDOWN OUTPUT FORMAT
  // ============================================================================

  describe('Markdown output format', () => {
    let reporter: ReportGenerator

    beforeEach(() => {
      reporter = new ReportGenerator({ suiteName: 'TestSuite' })
    })

    it('should format report as Markdown', () => {
      const validationReport = createValidationReport(createValidData())
      const report = reporter.generate(validationReport)
      const formatted = reporter.format(report, 'markdown')

      expect(formatted.format).toBe('markdown')
      expect(formatted.content).toBeDefined()
    })

    it('should include header with suite name', () => {
      const validationReport = createValidationReport(createValidData())
      const report = reporter.generate(validationReport)
      const formatted = reporter.format(report, 'markdown')

      expect(formatted.content).toContain('# ')
      expect(formatted.content).toContain('TestSuite')
    })

    it('should include summary section', () => {
      const validationReport = createValidationReport(createValidData())
      const report = reporter.generate(validationReport)
      const formatted = reporter.format(report, 'markdown')

      expect(formatted.content).toContain('## Summary')
    })

    it('should include results table in Markdown format', () => {
      const validationReport = createValidationReport(createValidData())
      const report = reporter.generate(validationReport)
      const formatted = reporter.format(report, 'markdown')

      expect(formatted.content).toContain('|')
      expect(formatted.content).toContain('---')
    })

    it('should include status indicators', () => {
      const validationReport = createValidationReport(createMixedData())
      const report = reporter.generate(validationReport)
      const formatted = reporter.format(report, 'markdown')

      // Should have pass/fail indicators
      expect(formatted.content).toMatch(/PASS|FAIL/)
    })

    it('should include failed rows section when failures exist', () => {
      const validationReport = createValidationReport(createInvalidData())
      const report = reporter.generate(validationReport)
      const formatted = reporter.format(report, 'markdown')

      expect(formatted.content).toContain('Failed')
    })
  })

  // ============================================================================
  // JUNIT XML OUTPUT FORMAT
  // ============================================================================

  describe('JUnit XML output format', () => {
    let reporter: ReportGenerator

    beforeEach(() => {
      reporter = new ReportGenerator({ suiteName: 'TestSuite' })
    })

    it('should format report as JUnit XML', () => {
      const validationReport = createValidationReport(createValidData())
      const report = reporter.generate(validationReport)
      const formatted = reporter.format(report, 'junit')

      expect(formatted.format).toBe('junit')
      expect(formatted.content).toBeDefined()
    })

    it('should include XML declaration', () => {
      const validationReport = createValidationReport(createValidData())
      const report = reporter.generate(validationReport)
      const formatted = reporter.format(report, 'junit')

      expect(formatted.content).toContain('<?xml version="1.0"')
    })

    it('should include testsuite element', () => {
      const validationReport = createValidationReport(createValidData())
      const report = reporter.generate(validationReport)
      const formatted = reporter.format(report, 'junit')

      expect(formatted.content).toContain('<testsuite')
      expect(formatted.content).toContain('</testsuite>')
    })

    it('should include test count attributes', () => {
      const validationReport = createValidationReport(createValidData())
      const report = reporter.generate(validationReport)
      const formatted = reporter.format(report, 'junit')

      expect(formatted.content).toContain('tests="')
      expect(formatted.content).toContain('failures="')
    })

    it('should include testcase elements', () => {
      const validationReport = createValidationReport(createValidData())
      const report = reporter.generate(validationReport)
      const formatted = reporter.format(report, 'junit')

      expect(formatted.content).toContain('<testcase')
    })

    it('should include failure elements for failed tests', () => {
      const validationReport = createValidationReport(createInvalidData())
      const report = reporter.generate(validationReport)
      const formatted = reporter.format(report, 'junit')

      expect(formatted.content).toContain('<failure')
    })

    it('should include suite name in testsuite', () => {
      const validationReport = createValidationReport(createValidData())
      const report = reporter.generate(validationReport)
      const formatted = reporter.format(report, 'junit')

      expect(formatted.content).toContain('name="TestSuite"')
    })

    it('should include timestamp', () => {
      const validationReport = createValidationReport(createValidData())
      const report = reporter.generate(validationReport)
      const formatted = reporter.format(report, 'junit')

      expect(formatted.content).toContain('timestamp="')
    })

    it('should include time attribute', () => {
      const validationReport = createValidationReport(createValidData())
      const report = reporter.generate(validationReport)
      const formatted = reporter.format(report, 'junit')

      expect(formatted.content).toContain('time="')
    })
  })

  // ============================================================================
  // TREND TRACKING
  // ============================================================================

  describe('trend tracking', () => {
    let reporter: ReportGenerator

    beforeEach(() => {
      reporter = new ReportGenerator({ suiteName: 'TestSuite' })
    })

    it('should track validation runs over time', () => {
      const run1 = createValidationReport(createValidData())
      const run2 = createValidationReport(createMixedData())

      reporter.recordRun(run1)
      reporter.recordRun(run2)

      const trend = reporter.getTrend()

      expect(trend.entries).toHaveLength(2)
    })

    it('should include pass rate in trend entries', () => {
      const run = createValidationReport(createMixedData())
      reporter.recordRun(run)

      const trend = reporter.getTrend()

      expect(trend.entries[0]!.passRate).toBeDefined()
      expect(typeof trend.entries[0]!.passRate).toBe('number')
    })

    it('should include timestamp in trend entries', () => {
      const run = createValidationReport(createValidData())
      reporter.recordRun(run)

      const trend = reporter.getTrend()

      expect(trend.entries[0]!.timestamp).toBeInstanceOf(Date)
    })

    it('should calculate trend direction', () => {
      const validData = createValidData()
      const invalidData = createInvalidData()

      // First run: bad
      reporter.recordRun(createValidationReport(invalidData))
      // Second run: good
      reporter.recordRun(createValidationReport(validData))

      const trend = reporter.getTrend()

      expect(trend.direction).toBe('improving')
    })

    it('should detect declining trend', () => {
      const validData = createValidData()
      const invalidData = createInvalidData()

      // First run: good
      reporter.recordRun(createValidationReport(validData))
      // Second run: bad
      reporter.recordRun(createValidationReport(invalidData))

      const trend = reporter.getTrend()

      expect(trend.direction).toBe('declining')
    })

    it('should detect stable trend', () => {
      const validData = createValidData()

      reporter.recordRun(createValidationReport(validData))
      reporter.recordRun(createValidationReport(validData))

      const trend = reporter.getTrend()

      expect(trend.direction).toBe('stable')
    })

    it('should limit trend history', () => {
      const customReporter = new ReportGenerator({
        suiteName: 'TestSuite',
        maxTrendEntries: 3,
      })

      for (let i = 0; i < 5; i++) {
        customReporter.recordRun(createValidationReport(createValidData()))
      }

      const trend = customReporter.getTrend()

      expect(trend.entries).toHaveLength(3)
    })

    it('should clear trend history', () => {
      reporter.recordRun(createValidationReport(createValidData()))
      reporter.recordRun(createValidationReport(createValidData()))

      reporter.clearTrend()

      const trend = reporter.getTrend()
      expect(trend.entries).toHaveLength(0)
    })
  })

  // ============================================================================
  // DIFF REPORTS
  // ============================================================================

  describe('diff reports', () => {
    let reporter: ReportGenerator

    beforeEach(() => {
      reporter = new ReportGenerator({ suiteName: 'TestSuite' })
    })

    it('should generate diff between two runs', () => {
      const run1 = reporter.generate(createValidationReport(createValidData()))
      const run2 = reporter.generate(createValidationReport(createMixedData()))

      const diff = reporter.diff(run1, run2)

      expect(diff).toBeDefined()
      expect(diff.passedDelta).toBeDefined()
      expect(diff.failedDelta).toBeDefined()
    })

    it('should show positive delta for improvement', () => {
      const run1 = reporter.generate(createValidationReport(createInvalidData()))
      const run2 = reporter.generate(createValidationReport(createValidData()))

      const diff = reporter.diff(run1, run2)

      expect(diff.passedDelta).toBeGreaterThan(0)
    })

    it('should show negative delta for decline', () => {
      const run1 = reporter.generate(createValidationReport(createValidData()))
      const run2 = reporter.generate(createValidationReport(createInvalidData()))

      const diff = reporter.diff(run1, run2)

      expect(diff.passedDelta).toBeLessThan(0)
    })

    it('should include pass rate delta', () => {
      const run1 = reporter.generate(createValidationReport(createValidData()))
      const run2 = reporter.generate(createValidationReport(createMixedData()))

      const diff = reporter.diff(run1, run2)

      expect(diff.passRateDelta).toBeDefined()
      expect(typeof diff.passRateDelta).toBe('number')
    })

    it('should identify new failures', () => {
      // Run 1: only id failures
      const data1 = [{ id: null, email: 'test@test.com', age: 30 }]
      // Run 2: id and email failures
      const data2 = [{ id: null, email: 'invalid', age: 30 }]

      const run1 = reporter.generate(createValidationReport(data1))
      const run2 = reporter.generate(createValidationReport(data2))

      const diff = reporter.diff(run1, run2)

      expect(diff.newFailures).toBeDefined()
    })

    it('should identify resolved failures', () => {
      // Run 1: multiple failures
      const data1 = [{ id: null, email: 'invalid', age: 30 }]
      // Run 2: fewer failures
      const data2 = [{ id: '1', email: 'test@test.com', age: 30 }]

      const run1 = reporter.generate(createValidationReport(data1))
      const run2 = reporter.generate(createValidationReport(data2))

      const diff = reporter.diff(run1, run2)

      expect(diff.resolvedFailures).toBeDefined()
    })
  })

  // ============================================================================
  // OUTPUT HELPERS
  // ============================================================================

  describe('output helpers', () => {
    let reporter: ReportGenerator

    beforeEach(() => {
      reporter = new ReportGenerator({ suiteName: 'TestSuite' })
    })

    it('should provide file extension for format', () => {
      expect(ReportGenerator.getExtension('json')).toBe('.json')
      expect(ReportGenerator.getExtension('html')).toBe('.html')
      expect(ReportGenerator.getExtension('markdown')).toBe('.md')
      expect(ReportGenerator.getExtension('junit')).toBe('.xml')
    })

    it('should provide MIME type for format', () => {
      expect(ReportGenerator.getMimeType('json')).toBe('application/json')
      expect(ReportGenerator.getMimeType('html')).toBe('text/html')
      expect(ReportGenerator.getMimeType('markdown')).toBe('text/markdown')
      expect(ReportGenerator.getMimeType('junit')).toBe('application/xml')
    })

    it('should generate filename with timestamp', () => {
      const validationReport = createValidationReport(createValidData())
      const report = reporter.generate(validationReport)
      const filename = reporter.generateFilename(report, 'json')

      expect(filename.toLowerCase()).toContain('testsuite')
      expect(filename).toContain('.json')
      expect(filename).toMatch(/\d{4}-\d{2}-\d{2}/)
    })
  })

  // ============================================================================
  // EDGE CASES
  // ============================================================================

  describe('edge cases', () => {
    it('should handle default suite name', () => {
      const reporter = new ReportGenerator()
      const validationReport = createValidationReport(createValidData())
      const report = reporter.generate(validationReport)

      expect(report.suite).toBe('Validation Report')
    })

    it('should handle reports with no failures', () => {
      const reporter = new ReportGenerator({ suiteName: 'Clean' })
      const validationReport = createValidationReport(createValidData())
      const report = reporter.generate(validationReport)
      const formatted = reporter.format(report, 'json')

      expect(() => JSON.parse(formatted.content)).not.toThrow()
      const parsed = JSON.parse(formatted.content)
      expect(parsed.failedRows).toHaveLength(0)
    })

    it('should handle reports with all failures', () => {
      const reporter = new ReportGenerator({ suiteName: 'AllFail' })
      const allInvalid = Array.from({ length: 5 }, () => ({
        id: null,
        email: 'invalid',
        age: 200,
      }))
      const validationReport = createValidationReport(allInvalid)
      const report = reporter.generate(validationReport)

      expect(report.passed).toBe(false)
      expect(report.summary.passRate).toBe(0)
    })

    it('should escape special characters in HTML output', () => {
      const reporter = new ReportGenerator({ suiteName: '<script>alert("xss")</script>' })
      const validationReport = createValidationReport(createValidData())
      const report = reporter.generate(validationReport)
      const formatted = reporter.format(report, 'html')

      expect(formatted.content).not.toContain('<script>alert')
      expect(formatted.content).toContain('&lt;')
    })

    it('should escape special characters in XML output', () => {
      const reporter = new ReportGenerator({ suiteName: 'Test & Suite <>' })
      const validationReport = createValidationReport(createValidData())
      const report = reporter.generate(validationReport)
      const formatted = reporter.format(report, 'junit')

      expect(formatted.content).toContain('&amp;')
      expect(formatted.content).toContain('&lt;')
    })
  })
})
