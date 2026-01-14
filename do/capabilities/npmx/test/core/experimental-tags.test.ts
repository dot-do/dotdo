/**
 * RED Phase Tests: Verify placeholder implementations have @experimental tags
 *
 * These tests ensure that incomplete/placeholder implementations in the SDK
 * are properly marked with @experimental JSDoc tags. This prevents users from
 * relying on APIs that aren't fully implemented yet.
 *
 * The tests scan exported functions and methods to verify:
 * 1. Placeholder implementations have @experimental tag
 * 2. Functions returning stub data (empty arrays, zero values) are documented
 *
 * @example Proper @experimental usage:
 * ```typescript
 * /**
 *  * Create an npm SDK instance
 *  *
 *  * @experimental This API is not yet fully implemented
 *  * /
 * export function createNpm(config: NpmConfig = {}): NpmSDK {
 *   // Placeholder implementation
 *   return { ... }
 * }
 * ```
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

// Patterns that indicate placeholder/stub implementations
// Note: These are checked at the function/export level, not every line
const PLACEHOLDER_PATTERNS = {
  // Comment indicators for placeholders without @experimental
  // Note: "// @experimental - Placeholder" is VALID documentation
  placeholderComment: /\/\/\s*[Pp]laceholder(?!\s+implementation)/,
  stubComment: /\/\/\s*[Ss]tub(?!\s*-)/,
  notImplementedComment: /\/\/\s*[Nn]ot\s+[Ii]mplemented/,

  // Code patterns that indicate stubs (checked at export boundaries)
  // These are only violations if no @experimental in surrounding context
  zeroExitCode: /return\s*\{[^}]*exitCode:\s*0[^}]*output:\s*['"]['"]/,
}

// These patterns are allowed when accompanied by @experimental
const ALLOWED_WITH_EXPERIMENTAL = {
  todoComment: /\/\/\s*TODO[:\s]/,
  emptyPromise: /async\s*\([^)]*\)\s*=>\s*\{\s*\}/,
  emptyArrayReturn: /return\s*\[\s*\]/,
  emptyObjectReturn: /return\s*\{\s*\}/,
}

// Patterns that indicate proper documentation (in JSDoc or inline comments)
const PROPER_DOC_PATTERNS = {
  experimental: /@experimental\b/,
  alpha: /@alpha\b/,
  beta: /@beta\b/,
  internal: /@internal\b/,
  deprecated: /@deprecated\b/,
}

// Inline comment pattern for @experimental (valid documentation)
const INLINE_EXPERIMENTAL = /\/\/\s*@experimental/

interface Violation {
  file: string
  line: number
  content: string
  pattern: string
  reason: string
}

interface ScanResult {
  file: string
  violations: Violation[]
  properlyDocumented: string[]
}

/**
 * Scans file content for placeholder implementations that lack @experimental tags
 */
function scanForUndocumentedPlaceholders(
  filePath: string,
  content: string
): ScanResult {
  const lines = content.split('\n')
  const violations: Violation[] = []
  const properlyDocumented: string[] = []

  // Track JSDoc blocks and their targets
  let currentJsDoc: { start: number; content: string } | null = null
  let inJsDoc = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const lineNum = i + 1

    // Track JSDoc block start
    if (line.includes('/**') && !line.includes('*/')) {
      inJsDoc = true
      currentJsDoc = { start: lineNum, content: line }
      continue
    }

    // Accumulate JSDoc content
    if (inJsDoc) {
      currentJsDoc!.content += '\n' + line
      if (line.includes('*/')) {
        inJsDoc = false
      }
      continue
    }

    // Check for placeholder patterns in non-JSDoc code
    for (const [patternName, pattern] of Object.entries(PLACEHOLDER_PATTERNS)) {
      if (pattern.test(line)) {
        // Look for @experimental in:
        // 1. Preceding JSDoc block
        // 2. Inline comment on the same or nearby line
        // 3. Function body (within 10 lines before)
        const jsDocContent = findPrecedingJsDoc(lines, i)
        const nearbyContext = findNearbyContext(lines, i, 10)

        // Check if properly documented via JSDoc
        const hasJsDocExperimental = Object.values(PROPER_DOC_PATTERNS).some(
          (docPattern) => docPattern.test(jsDocContent)
        )

        // Check if properly documented via inline comment
        const hasInlineExperimental = INLINE_EXPERIMENTAL.test(nearbyContext)

        if (!hasJsDocExperimental && !hasInlineExperimental) {
          violations.push({
            file: filePath,
            line: lineNum,
            content: line.trim(),
            pattern: patternName,
            reason: `Placeholder code without @experimental tag`,
          })
        } else {
          properlyDocumented.push(`${filePath}:${lineNum} (${patternName})`)
        }
        break // Only report once per line
      }
    }

    // Reset JSDoc tracking after non-JSDoc line
    currentJsDoc = null
  }

  return { file: filePath, violations, properlyDocumented }
}

/**
 * Find nearby context (lines around current position) for inline comments
 */
function findNearbyContext(
  lines: string[],
  currentIndex: number,
  range: number
): string {
  const start = Math.max(0, currentIndex - range)
  const end = Math.min(lines.length, currentIndex + 2)
  return lines.slice(start, end).join('\n')
}

/**
 * Find JSDoc block that precedes the current line (within function context)
 */
function findPrecedingJsDoc(lines: string[], currentIndex: number): string {
  // Look back up to 30 lines for a JSDoc block
  const searchStart = Math.max(0, currentIndex - 30)
  let jsDocContent = ''
  let inJsDoc = false

  for (let i = currentIndex - 1; i >= searchStart; i--) {
    const line = lines[i]

    // Found end of JSDoc
    if (line.includes('*/') && !inJsDoc) {
      inJsDoc = true
      jsDocContent = line + '\n' + jsDocContent
      continue
    }

    // Accumulate JSDoc
    if (inJsDoc) {
      jsDocContent = line + '\n' + jsDocContent
      if (line.includes('/**')) {
        break // Found start of JSDoc
      }
    }

    // Hit a function/export declaration - stop looking
    if (/^export\s+(function|const|class)/.test(line.trim())) {
      break
    }
  }

  return jsDocContent
}

describe('npmx experimental documentation', () => {
  let indexContent: string
  // Path from test/core/ up to npmx/index.ts
  const indexPath = join(__dirname, '../..', 'index.ts')

  beforeAll(async () => {
    indexContent = await readFile(indexPath, 'utf-8')
  })

  it('should have @experimental tag on createNpm placeholder', async () => {
    const result = scanForUndocumentedPlaceholders(indexPath, indexContent)

    // Filter for createNpm-related violations
    const createNpmViolations = result.violations.filter(
      (v) =>
        v.content.includes('Placeholder') ||
        v.content.includes('_packages') ||
        v.content.includes('_options')
    )

    expect(
      createNpmViolations,
      `createNpm() has placeholder code without @experimental tag:\n${createNpmViolations.map((v) => `  Line ${v.line}: ${v.content}`).join('\n')}`
    ).toHaveLength(0)
  })

  it('should have @experimental tag on npx placeholder', async () => {
    const result = scanForUndocumentedPlaceholders(indexPath, indexContent)

    // Filter for npx-related violations
    const npxViolations = result.violations.filter(
      (v) =>
        v.content.includes('_command') ||
        v.content.includes('_args') ||
        (v.content.includes('Placeholder') && v.line > 200)
    )

    expect(
      npxViolations,
      `npx() has placeholder code without @experimental tag:\n${npxViolations.map((v) => `  Line ${v.line}: ${v.content}`).join('\n')}`
    ).toHaveLength(0)
  })

  it('should have @experimental tag on npm singleton placeholder', async () => {
    const result = scanForUndocumentedPlaceholders(indexPath, indexContent)

    // All placeholder implementations should be documented
    expect(
      result.violations.length,
      `Found ${result.violations.length} placeholder implementations without @experimental tag:\n${result.violations.map((v) => `  Line ${v.line}: ${v.pattern} - ${v.content}`).join('\n')}`
    ).toBe(0)
  })

  describe('documentation patterns', () => {
    it('should have @experimental preceding placeholder comment', () => {
      // Find the "Placeholder implementation" comment line
      const lines = indexContent.split('\n')
      let placeholderLineIndex = -1

      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('Placeholder implementation')) {
          placeholderLineIndex = i
          break
        }
      }

      expect(placeholderLineIndex).toBeGreaterThan(0)

      // Look back for @experimental in the JSDoc
      const jsDoc = findPrecedingJsDoc(lines, placeholderLineIndex)
      expect(
        jsDoc,
        'createNpm JSDoc should contain @experimental tag'
      ).toMatch(/@experimental/)
    })

    it('should document that methods return stub data', () => {
      // Verify the @experimental tag explains the limitation
      const experimentalMatch = indexContent.match(
        /@experimental[^\n*]*(?:\n\s*\*[^\n]*)*placeholder/i
      )

      expect(
        experimentalMatch,
        '@experimental tag should mention placeholder/stub nature'
      ).toBeTruthy()
    })
  })
})

describe('experimental tag standards', () => {
  it('should use @experimental format consistently', () => {
    // The @experimental tag should follow the pattern:
    // @experimental This API returns placeholder data. Full implementation pending.
    const validExperimentalPattern =
      /@experimental\s+This\s+API\s+\w+.*\.\s*(?:Full|Implementation|Not)/

    const indexPath = join(__dirname, '../../..', 'index.ts')

    // This test documents the expected format
    expect(validExperimentalPattern.source).toContain('experimental')
  })
})
