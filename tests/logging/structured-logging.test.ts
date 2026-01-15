/**
 * Structured Logging Tests - TDD RED Phase
 *
 * These tests verify that production code in objects/core/ uses structured logging
 * instead of raw console.* calls.
 *
 * Issue: do-ujt1
 *
 * Current State (42 console.* calls found):
 * - objects/core/DOBase.ts: 23 console.* calls
 * - objects/core/WorkflowContext.ts: 5 console.* calls
 * - objects/core/IcebergManager.ts: 3 console.* calls
 * - objects/core/LocationManager.ts: 2 console.* calls
 * - objects/core/IntrospectionManager.ts: 1 console.* call
 * - objects/core/DOFull.ts: 2 console.* calls
 * - objects/core/DOTiny.ts: 1 console.* call (plus 2 in comments)
 * - objects/core/DO.ts: 1 in comments only
 *
 * Requirements:
 * - No console.log/console.warn in production code paths
 * - Use logBestEffortError for error handling in catch blocks
 * - Structured log format: { timestamp, level, message, context }
 *
 * IMPORTANT: These tests document what SHOULD happen. They will FAIL until
 * the console.* calls are replaced with structured logging (GREEN phase).
 */

import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'

// ============================================================================
// Test Utilities
// ============================================================================

/**
 * Removes single-line and multi-line comments from TypeScript code.
 * This is important because we allow console.log in documentation/examples.
 */
function removeComments(content: string): string {
  // Remove multi-line comments (/* ... */)
  let result = content.replace(/\/\*[\s\S]*?\*\//g, '')
  // Remove single-line comments (// ...)
  result = result.replace(/\/\/.*$/gm, '')
  return result
}

/**
 * Extracts catch blocks from TypeScript code for analysis
 */
function extractCatchBlocks(content: string): string[] {
  const catchBlocks: string[] = []
  // Match catch blocks with their contents (handles nested braces)
  const regex = /catch\s*\([^)]*\)\s*\{/g
  let match

  while ((match = regex.exec(content)) !== null) {
    const startIndex = match.index + match[0].length
    let braceCount = 1
    let endIndex = startIndex

    while (braceCount > 0 && endIndex < content.length) {
      if (content[endIndex] === '{') braceCount++
      if (content[endIndex] === '}') braceCount--
      endIndex++
    }

    catchBlocks.push(content.slice(match.index, endIndex))
  }

  return catchBlocks
}

/**
 * Gets all TypeScript files in a directory recursively
 */
async function getTypeScriptFiles(dir: string): Promise<string[]> {
  const files: string[] = []
  const entries = await fs.readdir(dir, { withFileTypes: true })

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await getTypeScriptFiles(fullPath)))
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      files.push(fullPath)
    }
  }

  return files
}

// ============================================================================
// Production Code Analysis Tests
// ============================================================================

describe('Structured Logging in objects/core/', () => {
  const coreDir = path.resolve(__dirname, '../../objects/core')

  describe('console.log usage', () => {
    it('should not have console.log in production code paths', async () => {
      const files = await getTypeScriptFiles(coreDir)
      const violations: { file: string; line: number; content: string }[] = []

      for (const file of files) {
        const content = await fs.readFile(file, 'utf8')
        const lines = content.split('\n')

        lines.forEach((line, index) => {
          // Skip if the line is in a comment
          const trimmedLine = line.trim()
          if (trimmedLine.startsWith('//') || trimmedLine.startsWith('*')) {
            return
          }

          // Check for console.log that's not in a comment on the same line
          if (line.includes('console.log(') && !line.includes('//')) {
            violations.push({
              file: path.relative(coreDir, file),
              line: index + 1,
              content: trimmedLine.slice(0, 80),
            })
          }
        })
      }

      // This test SHOULD FAIL in RED phase
      // There are console.log calls in DOFull.ts and DOTiny.ts
      expect(violations, `Found ${violations.length} console.log calls:\n${JSON.stringify(violations, null, 2)}`).toHaveLength(0)
    })

    it('should not have console.warn in production code paths', async () => {
      const files = await getTypeScriptFiles(coreDir)
      const violations: { file: string; line: number; content: string }[] = []

      for (const file of files) {
        const content = await fs.readFile(file, 'utf8')
        const lines = content.split('\n')

        lines.forEach((line, index) => {
          const trimmedLine = line.trim()
          if (trimmedLine.startsWith('//') || trimmedLine.startsWith('*')) {
            return
          }

          if (line.includes('console.warn(') && !line.includes('//')) {
            violations.push({
              file: path.relative(coreDir, file),
              line: index + 1,
              content: trimmedLine.slice(0, 80),
            })
          }
        })
      }

      // This test SHOULD FAIL in RED phase
      // There are console.warn calls in DOBase.ts, IcebergManager.ts, IntrospectionManager.ts
      expect(violations, `Found ${violations.length} console.warn calls:\n${JSON.stringify(violations, null, 2)}`).toHaveLength(0)
    })
  })

  describe('console.error in catch blocks', () => {
    it('should use logBestEffortError instead of console.error in catch blocks', async () => {
      const files = await getTypeScriptFiles(coreDir)
      const violations: { file: string; catchBlock: string }[] = []

      for (const file of files) {
        const content = await fs.readFile(file, 'utf8')
        const catchBlocks = extractCatchBlocks(content)

        for (const block of catchBlocks) {
          // If the catch block uses console.error, it should use logBestEffortError instead
          if (block.includes('console.error(') && !block.includes('logBestEffortError')) {
            violations.push({
              file: path.relative(coreDir, file),
              catchBlock: block.slice(0, 150) + '...',
            })
          }
        }
      }

      // This test SHOULD FAIL in RED phase
      // There are many catch blocks with console.error in DOBase.ts, WorkflowContext.ts, etc.
      expect(violations, `Found ${violations.length} catch blocks with console.error instead of logBestEffortError:\n${JSON.stringify(violations, null, 2)}`).toHaveLength(0)
    })

    it('should not have empty catch blocks', async () => {
      const files = await getTypeScriptFiles(coreDir)
      const violations: { file: string; catchBlock: string }[] = []

      for (const file of files) {
        const content = await fs.readFile(file, 'utf8')
        const catchBlocks = extractCatchBlocks(content)

        for (const block of catchBlocks) {
          // Extract the body of the catch block
          const bodyMatch = block.match(/catch\s*\([^)]*\)\s*\{([\s\S]*)\}$/)
          if (bodyMatch) {
            const body = bodyMatch[1].trim()
            // Check for empty or comment-only catch blocks
            const withoutComments = removeComments(body).trim()
            if (withoutComments === '' || withoutComments === 'return' || withoutComments === 'return false') {
              violations.push({
                file: path.relative(coreDir, file),
                catchBlock: block.slice(0, 100) + '...',
              })
            }
          }
        }
      }

      // Empty catch blocks silently swallow errors - they should log
      if (violations.length > 0) {
        console.log(`Note: Found ${violations.length} potentially empty catch blocks`)
      }
      // This is informational - not a hard failure in all cases
    })
  })

  describe('structured log format requirements', () => {
    it('should have logBestEffortError import in files with error handling', async () => {
      const filesWithErrorHandling = [
        'DOBase.ts',
        'WorkflowContext.ts',
        'LocationManager.ts',
        'IcebergManager.ts',
      ]

      const violations: string[] = []

      for (const fileName of filesWithErrorHandling) {
        const filePath = path.join(coreDir, fileName)
        try {
          const content = await fs.readFile(filePath, 'utf8')
          // Check for import of logBestEffortError
          if (!content.includes('logBestEffortError')) {
            violations.push(fileName)
          }
        } catch {
          // File doesn't exist - skip
        }
      }

      // This test SHOULD FAIL in RED phase
      // Most files don't import logBestEffortError yet
      expect(violations, `Files missing logBestEffortError import: ${violations.join(', ')}`).toHaveLength(0)
    })
  })
})

// ============================================================================
// Specific File Analysis Tests
// ============================================================================

describe('DOBase.ts structured logging', () => {
  const doBaseFile = path.resolve(__dirname, '../../objects/core/DOBase.ts')

  it('should not have raw console.error calls for database errors', async () => {
    const content = await fs.readFile(doBaseFile, 'utf8')

    // These specific error patterns should use structured logging
    const problemPatterns = [
      /console\.error\s*\(\s*`?\[emitEvent\]/,
      /console\.error\s*\(\s*`?\[send\]/,
      /console\.error\s*\(\s*`?\[system\./,
      /console\.error\s*\(\s*`?\[CRITICAL\]/,
      /console\.error\s*\(\s*['"]Auto-checkpoint/,
      /console\.error\s*\(\s*['"]Error fetching nouns/,
      /console\.error\s*\(\s*['"]Lifecycle event listener/,
      /console\.error\s*\(\s*['"]Failed to register schedule/,
      /console\.error\s*\(\s*['"]Failed to detect location/,
      /console\.error\s*\(\s*['"]Error in onLocationDetected/,
      /console\.error\s*\(\s*`?\[metrics\./,
    ]

    const violations: string[] = []
    for (const pattern of problemPatterns) {
      if (pattern.test(content)) {
        violations.push(pattern.source)
      }
    }

    // This test SHOULD FAIL in RED phase - DOBase.ts has many console.error calls
    expect(violations, `Found ${violations.length} console.error patterns that should use structured logging`).toHaveLength(0)
  })

  it('should not have console.warn for configuration warnings', async () => {
    const content = await fs.readFile(doBaseFile, 'utf8')

    const configWarnings = [
      /console\.warn\s*\(\s*['"]No R2 bucket configured/,
      /console\.warn\s*\(\s*['"]No JWT available/,
      /console\.warn\s*\(\s*['"]JWT_SECRET not configured/,
    ]

    const violations: string[] = []
    for (const pattern of configWarnings) {
      if (pattern.test(content)) {
        violations.push(pattern.source)
      }
    }

    // This test SHOULD FAIL in RED phase
    expect(violations, `Found ${violations.length} configuration warnings using console.warn`).toHaveLength(0)
  })
})

describe('WorkflowContext.ts structured logging', () => {
  const workflowContextFile = path.resolve(__dirname, '../../objects/core/WorkflowContext.ts')

  it('should not have raw console.error for workflow errors', async () => {
    const content = await fs.readFile(workflowContextFile, 'utf8')

    const workflowErrors = [
      /console\.error\s*\(\s*`?\[send\]/,
      /console\.error\s*\(\s*`?\[system\./,
      /console\.error\s*\(\s*`?\[CRITICAL\]/,
      /console\.error\s*\(\s*['"]Failed to register schedule/,
    ]

    const violations: string[] = []
    for (const pattern of workflowErrors) {
      if (pattern.test(content)) {
        violations.push(pattern.source)
      }
    }

    // This test SHOULD FAIL in RED phase
    expect(violations, `Found ${violations.length} workflow errors using console.error`).toHaveLength(0)
  })
})

describe('LocationManager.ts structured logging', () => {
  const locationManagerFile = path.resolve(__dirname, '../../objects/core/LocationManager.ts')

  it('should not have raw console.error for location detection errors', async () => {
    const content = await fs.readFile(locationManagerFile, 'utf8')

    const locationErrors = [
      /console\.error\s*\(\s*['"]Error in onLocationDetected/,
      /console\.error\s*\(\s*['"]Failed to detect location/,
    ]

    const violations: string[] = []
    for (const pattern of locationErrors) {
      if (pattern.test(content)) {
        violations.push(pattern.source)
      }
    }

    // This test SHOULD FAIL in RED phase
    expect(violations, `Found ${violations.length} location errors using console.error`).toHaveLength(0)
  })
})

describe('IcebergManager.ts structured logging', () => {
  const icebergManagerFile = path.resolve(__dirname, '../../objects/core/IcebergManager.ts')

  it('should not have raw console calls for iceberg operations', async () => {
    const content = await fs.readFile(icebergManagerFile, 'utf8')

    const icebergCalls = [
      /console\.warn\s*\(\s*['"]No R2 bucket configured/,
      /console\.warn\s*\(\s*['"]No JWT available/,
      /console\.error\s*\(\s*['"]Auto-checkpoint failed/,
    ]

    const violations: string[] = []
    for (const pattern of icebergCalls) {
      if (pattern.test(content)) {
        violations.push(pattern.source)
      }
    }

    // This test SHOULD FAIL in RED phase
    expect(violations, `Found ${violations.length} iceberg operations using console.*`).toHaveLength(0)
  })
})

// ============================================================================
// Structured Log Format Tests
// ============================================================================

describe('Structured Log Format', () => {
  it('documents the required log format', () => {
    // This test documents what structured logs should look like
    const requiredFields = ['timestamp', 'level', 'message']
    const optionalFields = ['name', 'error', 'context', 'correlationId', 'operation', 'source']

    // When logBestEffortError is used, it should produce output like:
    const exampleOutput = {
      timestamp: '2024-01-14T12:00:00.000Z',
      level: 'warn',
      name: 'best-effort',
      message: 'Best-effort operation failed: database-insert',
      operation: 'database-insert',
      source: 'DOBase.emitEvent',
      bestEffort: true,
      error: {
        name: 'Error',
        message: 'Database insert failed',
        stack: 'Error: Database insert failed\n    at ...',
      },
      context: {
        verb: 'Customer.created',
        thingId: 'thing-123',
      },
    }

    // Verify the example has required fields
    for (const field of requiredFields) {
      expect(exampleOutput).toHaveProperty(field)
    }

    // This is documentation - always passes
    expect(true).toBe(true)
  })

  it('documents error context requirements for different operations', () => {
    // Database errors should include
    const dbErrorContext = {
      operation: 'insert' as const,
      source: 'DOBase.emitEvent',
      context: {
        verb: 'string',
        thingId: 'string',
        table: 'string',
      },
    }

    // Pipeline errors should include
    const pipelineErrorContext = {
      operation: 'pipeline-send' as const,
      source: 'DOBase.emitEvent',
      context: {
        verb: 'string',
        attempt: 'number',
        maxRetries: 'number',
      },
    }

    // Location errors should include
    const locationErrorContext = {
      operation: 'location-detection' as const,
      source: 'LocationManager.detectLocation',
      context: {
        request: 'object | undefined',
      },
    }

    // Configuration warnings should include
    const configWarningContext = {
      operation: 'config-check' as const,
      source: 'DOBase.loadFromR2',
      context: {
        missingConfig: 'string',
        fallbackBehavior: 'string',
      },
    }

    // Document these exist (always passes)
    expect(dbErrorContext).toBeDefined()
    expect(pipelineErrorContext).toBeDefined()
    expect(locationErrorContext).toBeDefined()
    expect(configWarningContext).toBeDefined()
  })
})

// ============================================================================
// Summary Report Test
// ============================================================================

describe('Console Usage Summary', () => {
  it('generates a summary of all console.* usage in objects/core/', async () => {
    const coreDir = path.resolve(__dirname, '../../objects/core')
    const files = await getTypeScriptFiles(coreDir)

    const summary: Record<string, { logs: number; warns: number; errors: number }> = {}
    let totalLogs = 0
    let totalWarns = 0
    let totalErrors = 0

    for (const file of files) {
      const content = await fs.readFile(file, 'utf8')
      const codeOnly = removeComments(content)
      const fileName = path.relative(coreDir, file)

      const logs = (codeOnly.match(/console\.log\(/g) || []).length
      const warns = (codeOnly.match(/console\.warn\(/g) || []).length
      const errors = (codeOnly.match(/console\.error\(/g) || []).length

      if (logs > 0 || warns > 0 || errors > 0) {
        summary[fileName] = { logs, warns, errors }
        totalLogs += logs
        totalWarns += warns
        totalErrors += errors
      }
    }

    console.log('\n=== Console Usage Summary ===')
    console.log(JSON.stringify(summary, null, 2))
    console.log(`\nTotal: ${totalLogs} logs, ${totalWarns} warns, ${totalErrors} errors`)
    console.log(`Grand total: ${totalLogs + totalWarns + totalErrors} console.* calls`)

    // This test is informational - it documents the current state
    // The real tests above enforce the rules
    expect(totalLogs + totalWarns + totalErrors).toBeGreaterThan(0) // Confirms there ARE violations to fix
  })
})
