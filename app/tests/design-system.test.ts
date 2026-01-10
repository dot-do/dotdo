/**
 * Design System Consistency Tests (TDD RED Phase)
 *
 * These tests verify that the codebase follows design system conventions.
 * Tests SHOULD FAIL until hardcoded colors are replaced with CSS variables.
 *
 * Design System Rules:
 * - Use bg-background instead of bg-gray-900
 * - Use border instead of border-gray-800
 * - Use text-muted-foreground instead of text-gray-*
 * - Use Button component instead of inline bg-blue-600 styles
 * - Use CSS variables (var(--*)) instead of hardcoded HSL values
 *
 * @see app/components/cockpit/index.tsx
 * @see app/routes/admin/workflows/index.tsx
 * @see app/routes/admin/sandboxes/index.tsx
 * @see app/routes/admin/browsers/index.tsx
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

// =============================================================================
// Test Utilities
// =============================================================================

/**
 * Read file contents from the app directory
 */
function readAppFile(relativePath: string): string {
  const fullPath = join(process.cwd(), 'app', relativePath)
  if (!existsSync(fullPath)) {
    throw new Error(`File not found: ${fullPath}`)
  }
  return readFileSync(fullPath, 'utf-8')
}

/**
 * Check if file contains a forbidden pattern
 */
function containsPattern(content: string, pattern: RegExp): boolean {
  return pattern.test(content)
}

/**
 * Find all matches of a pattern in content with line numbers
 */
function findPatternMatches(content: string, pattern: RegExp): Array<{ line: number; match: string }> {
  const lines = content.split('\n')
  const matches: Array<{ line: number; match: string }> = []

  lines.forEach((line, index) => {
    const lineMatches = line.match(pattern)
    if (lineMatches) {
      matches.push({
        line: index + 1,
        match: lineMatches[0],
      })
    }
  })

  return matches
}

// =============================================================================
// Forbidden Pattern Definitions
// =============================================================================

/**
 * Patterns that should NOT appear in the codebase
 * These hardcoded values should be replaced with design system tokens
 */
const FORBIDDEN_PATTERNS = {
  // Background colors that should use bg-background or bg-card
  hardcodedBgGray900: /bg-gray-900/g,
  hardcodedBgGray800: /bg-gray-800(?!\/)/g, // Exclude opacity variants like bg-gray-800/50

  // Border colors that should use border or border-border
  hardcodedBorderGray800: /border-gray-800/g,
  hardcodedBorderGray700: /border-gray-700/g,

  // Text colors that should use text-muted-foreground or text-foreground
  hardcodedTextGray: /text-gray-\d{3}/g,

  // Button styles that should use Button component
  inlineButtonBgBlue600: /className=["'][^"']*bg-blue-600[^"']*["']/g,
  inlineButtonBgBlue700: /hover:bg-blue-700/g,

  // Hardcoded HSL values that should use CSS variables
  hardcodedHslValue: /hsl\(\s*\d+\.?\d*\s+\d+\.?\d*%\s+\d+\.?\d*%\s*\)/g,
}

// =============================================================================
// Test Suite: Cockpit Components
// =============================================================================

describe('Design System: Cockpit Components', () => {
  const cockpitPath = 'components/cockpit/index.tsx'

  it('should NOT contain bg-gray-900 (use bg-background instead)', () => {
    const content = readAppFile(cockpitPath)
    const matches = findPatternMatches(content, FORBIDDEN_PATTERNS.hardcodedBgGray900)

    expect(matches).toEqual([])
  })

  it('should NOT contain border-gray-800 (use border instead)', () => {
    const content = readAppFile(cockpitPath)
    const matches = findPatternMatches(content, FORBIDDEN_PATTERNS.hardcodedBorderGray800)

    expect(matches).toEqual([])
  })

  it('should NOT contain text-gray-* classes (use text-muted-foreground instead)', () => {
    const content = readAppFile(cockpitPath)
    const matches = findPatternMatches(content, FORBIDDEN_PATTERNS.hardcodedTextGray)

    expect(matches).toEqual([])
  })

  it('should NOT contain bg-gray-800 (use bg-card or bg-muted instead)', () => {
    const content = readAppFile(cockpitPath)
    const matches = findPatternMatches(content, FORBIDDEN_PATTERNS.hardcodedBgGray800)

    expect(matches).toEqual([])
  })

  it('should NOT contain border-gray-700 (use border instead)', () => {
    const content = readAppFile(cockpitPath)
    const matches = findPatternMatches(content, FORBIDDEN_PATTERNS.hardcodedBorderGray700)

    expect(matches).toEqual([])
  })

  it('should NOT contain hardcoded HSL values (use CSS variables instead)', () => {
    const content = readAppFile(cockpitPath)
    const matches = findPatternMatches(content, FORBIDDEN_PATTERNS.hardcodedHslValue)

    expect(matches).toEqual([])
  })
})

// =============================================================================
// Test Suite: Admin Workflows Route
// =============================================================================

describe('Design System: Admin Workflows Route', () => {
  const workflowsPath = 'routes/admin/workflows/index.tsx'

  it('should NOT contain inline bg-blue-600 button styles (use Button component instead)', () => {
    const content = readAppFile(workflowsPath)
    const matches = findPatternMatches(content, FORBIDDEN_PATTERNS.inlineButtonBgBlue600)

    expect(matches).toEqual([])
  })

  it('should NOT contain hover:bg-blue-700 (use Button component instead)', () => {
    const content = readAppFile(workflowsPath)
    const matches = findPatternMatches(content, FORBIDDEN_PATTERNS.inlineButtonBgBlue700)

    expect(matches).toEqual([])
  })

  it('should NOT contain text-gray-* classes (use text-muted-foreground instead)', () => {
    const content = readAppFile(workflowsPath)
    const matches = findPatternMatches(content, FORBIDDEN_PATTERNS.hardcodedTextGray)

    expect(matches).toEqual([])
  })

  it('should import Button component from design system', () => {
    const content = readAppFile(workflowsPath)
    // Should have Button import
    const hasButtonImport = /import.*\{[^}]*Button[^}]*\}.*from.*['"].*button['"]/.test(content)
      || /import.*Button.*from.*['"].*button['"]/.test(content)
      || /import.*\{[^}]*Button[^}]*\}.*from.*['"].*ui['"]/.test(content)

    expect(hasButtonImport).toBe(true)
  })
})

// =============================================================================
// Test Suite: Admin Sandboxes Route
// =============================================================================

describe('Design System: Admin Sandboxes Route', () => {
  const sandboxesPath = 'routes/admin/sandboxes/index.tsx'

  it('should NOT contain inline bg-blue-600 button styles (use Button component instead)', () => {
    const content = readAppFile(sandboxesPath)
    const matches = findPatternMatches(content, FORBIDDEN_PATTERNS.inlineButtonBgBlue600)

    expect(matches).toEqual([])
  })

  it('should NOT contain hover:bg-blue-700 (use Button component instead)', () => {
    const content = readAppFile(sandboxesPath)
    const matches = findPatternMatches(content, FORBIDDEN_PATTERNS.inlineButtonBgBlue700)

    expect(matches).toEqual([])
  })

  it('should NOT contain text-gray-* classes (use text-muted-foreground instead)', () => {
    const content = readAppFile(sandboxesPath)
    const matches = findPatternMatches(content, FORBIDDEN_PATTERNS.hardcodedTextGray)

    expect(matches).toEqual([])
  })

  it('should import Button component from design system', () => {
    const content = readAppFile(sandboxesPath)
    // Should have Button import
    const hasButtonImport = /import.*\{[^}]*Button[^}]*\}.*from.*['"].*button['"]/.test(content)
      || /import.*Button.*from.*['"].*button['"]/.test(content)
      || /import.*\{[^}]*Button[^}]*\}.*from.*['"].*ui['"]/.test(content)

    expect(hasButtonImport).toBe(true)
  })
})

// =============================================================================
// Test Suite: Admin Browsers Route
// =============================================================================

describe('Design System: Admin Browsers Route', () => {
  const browsersPath = 'routes/admin/browsers/index.tsx'

  it('should NOT contain inline bg-blue-600 button styles (use Button component instead)', () => {
    const content = readAppFile(browsersPath)
    const matches = findPatternMatches(content, FORBIDDEN_PATTERNS.inlineButtonBgBlue600)

    expect(matches).toEqual([])
  })

  it('should NOT contain hover:bg-blue-700 (use Button component instead)', () => {
    const content = readAppFile(browsersPath)
    const matches = findPatternMatches(content, FORBIDDEN_PATTERNS.inlineButtonBgBlue700)

    expect(matches).toEqual([])
  })

  it('should NOT contain text-gray-* classes (use text-muted-foreground instead)', () => {
    const content = readAppFile(browsersPath)
    const matches = findPatternMatches(content, FORBIDDEN_PATTERNS.hardcodedTextGray)

    expect(matches).toEqual([])
  })

  it('should import Button component from design system', () => {
    const content = readAppFile(browsersPath)
    // Should have Button import
    const hasButtonImport = /import.*\{[^}]*Button[^}]*\}.*from.*['"].*button['"]/.test(content)
      || /import.*Button.*from.*['"].*button['"]/.test(content)
      || /import.*\{[^}]*Button[^}]*\}.*from.*['"].*ui['"]/.test(content)

    expect(hasButtonImport).toBe(true)
  })
})

// =============================================================================
// Test Suite: Global Design System Consistency
// =============================================================================

describe('Design System: Global Consistency Checks', () => {
  const filesToCheck = [
    'components/cockpit/index.tsx',
    'routes/admin/workflows/index.tsx',
    'routes/admin/sandboxes/index.tsx',
    'routes/admin/browsers/index.tsx',
  ]

  it('should have zero total violations of hardcoded gray backgrounds', () => {
    let totalViolations = 0

    for (const filePath of filesToCheck) {
      const content = readAppFile(filePath)
      const bgGray900 = findPatternMatches(content, FORBIDDEN_PATTERNS.hardcodedBgGray900)
      const bgGray800 = findPatternMatches(content, FORBIDDEN_PATTERNS.hardcodedBgGray800)

      totalViolations += bgGray900.length + bgGray800.length
    }

    expect(totalViolations).toBe(0)
  })

  it('should have zero total violations of hardcoded gray borders', () => {
    let totalViolations = 0

    for (const filePath of filesToCheck) {
      const content = readAppFile(filePath)
      const borderGray800 = findPatternMatches(content, FORBIDDEN_PATTERNS.hardcodedBorderGray800)
      const borderGray700 = findPatternMatches(content, FORBIDDEN_PATTERNS.hardcodedBorderGray700)

      totalViolations += borderGray800.length + borderGray700.length
    }

    expect(totalViolations).toBe(0)
  })

  it('should have zero total violations of hardcoded gray text', () => {
    let totalViolations = 0

    for (const filePath of filesToCheck) {
      const content = readAppFile(filePath)
      const textGray = findPatternMatches(content, FORBIDDEN_PATTERNS.hardcodedTextGray)

      totalViolations += textGray.length
    }

    expect(totalViolations).toBe(0)
  })

  it('should have zero total violations of inline button styles', () => {
    let totalViolations = 0

    for (const filePath of filesToCheck) {
      const content = readAppFile(filePath)
      const bgBlue600 = findPatternMatches(content, FORBIDDEN_PATTERNS.inlineButtonBgBlue600)
      const hoverBlue700 = findPatternMatches(content, FORBIDDEN_PATTERNS.inlineButtonBgBlue700)

      totalViolations += bgBlue600.length + hoverBlue700.length
    }

    expect(totalViolations).toBe(0)
  })

  it('should have zero total violations of hardcoded HSL values', () => {
    let totalViolations = 0

    for (const filePath of filesToCheck) {
      const content = readAppFile(filePath)
      const hslValues = findPatternMatches(content, FORBIDDEN_PATTERNS.hardcodedHslValue)

      totalViolations += hslValues.length
    }

    expect(totalViolations).toBe(0)
  })
})

// =============================================================================
// Test Suite: Design System Token Usage
// =============================================================================

describe('Design System: Token Usage Verification', () => {
  it('cockpit components should use design system tokens', () => {
    const content = readAppFile('components/cockpit/index.tsx')

    // Components that already use design system tokens (these should pass)
    // Note: Some chart components already use bg-background and text-muted-foreground
    const usesBackgroundToken = content.includes('bg-background')
    const usesBorderToken = content.includes('border') && !content.includes('border-gray')
    const usesMutedForeground = content.includes('text-muted-foreground')

    // At least some design system tokens should be in use
    const usesDesignSystemTokens = usesBackgroundToken || usesBorderToken || usesMutedForeground

    expect(usesDesignSystemTokens).toBe(true)
  })

  it('admin routes should use Button component for primary actions', () => {
    const adminRoutes = [
      'routes/admin/workflows/index.tsx',
      'routes/admin/sandboxes/index.tsx',
      'routes/admin/browsers/index.tsx',
    ]

    for (const routePath of adminRoutes) {
      const content = readAppFile(routePath)

      // Check that native button elements with blue styling don't exist
      // These should be replaced with <Button> component
      const hasInlineBlueButton = /className=["'][^"']*bg-blue-600[^"']*["']/.test(content)

      expect(hasInlineBlueButton).toBe(false)
    }
  })
})

// =============================================================================
// Diagnostic Test: Report All Violations (for debugging)
// =============================================================================

describe('Design System: Violation Report (Diagnostic)', () => {
  it('reports all design system violations for debugging', () => {
    const filesToCheck = [
      'components/cockpit/index.tsx',
      'routes/admin/workflows/index.tsx',
      'routes/admin/sandboxes/index.tsx',
      'routes/admin/browsers/index.tsx',
    ]

    const violations: Record<string, Array<{ pattern: string; line: number; match: string }>> = {}

    for (const filePath of filesToCheck) {
      const content = readAppFile(filePath)
      violations[filePath] = []

      // Check each pattern
      for (const [patternName, pattern] of Object.entries(FORBIDDEN_PATTERNS)) {
        const matches = findPatternMatches(content, pattern)
        for (const match of matches) {
          violations[filePath].push({
            pattern: patternName,
            line: match.line,
            match: match.match,
          })
        }
      }
    }

    // Calculate totals
    const totalViolations = Object.values(violations).reduce(
      (sum, fileViolations) => sum + fileViolations.length,
      0
    )

    // This test is informational - it will pass to show the violations
    // The actual enforcement is done by the individual tests above
    console.log('\n=== Design System Violations Report ===')
    console.log(`Total violations: ${totalViolations}`)
    console.log('')

    for (const [file, fileViolations] of Object.entries(violations)) {
      if (fileViolations.length > 0) {
        console.log(`\n${file} (${fileViolations.length} violations):`)
        for (const v of fileViolations) {
          console.log(`  Line ${v.line}: ${v.pattern} - "${v.match}"`)
        }
      }
    }

    // GREEN phase - all violations should be fixed
    expect(totalViolations).toBe(0)
  })
})
