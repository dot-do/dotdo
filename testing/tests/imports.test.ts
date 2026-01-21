/**
 * Import Lint Test - Detects cross-package relative imports
 *
 * This test enforces that packages use workspace imports (@dotdo/xxx)
 * instead of relative parent traversals (../xxx) when importing from
 * other workspace packages.
 *
 * TDD: RED phase - This test should fail until imports are fixed.
 *
 * @example
 * // Bad (detected by this test):
 * import { createThingsStore } from '../../db/things'
 *
 * // Good:
 * import { createThingsStore } from '@dotdo/db'
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join, relative, dirname, basename } from 'path'

// Workspace packages that should use @dotdo/xxx imports
const WORKSPACE_PACKAGES = [
  'db',
  'rpc',
  'auth',
  'do',
  'api',
  'mcp',
  'ai',
  'app',
  'integrations',
  'utils',
  'test-utils',
] as const

// Source directories to check
const SOURCE_DIRS = ['do', 'api', 'mcp'] as const

// Directories to ignore
const IGNORE_DIRS = new Set([
  'node_modules',
  'dist',
  '.worktrees',
  'primitives',
  'tests', // Allow relative imports in tests for test fixtures
])

// Files to ignore
const IGNORE_FILES = new Set([
  '_worker-entry.ts', // Worker entry needs relative imports
  'CONVERSION_GUIDE.md', // Documentation
])

interface ImportViolation {
  file: string
  line: number
  importPath: string
  targetPackage: string
  suggestion: string
}

/**
 * Extract all imports from a TypeScript file
 */
function extractImports(content: string): Array<{ line: number; path: string }> {
  const imports: Array<{ line: number; path: string }> = []
  const lines = content.split('\n')

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    // Match: import ... from '...'
    // Match: import ... from "..."
    // Match: export ... from '...'
    // Match: export ... from "..."
    const importMatch = line.match(/(?:import|export)\s+.*?\s+from\s+['"]([^'"]+)['"]/s)
    if (importMatch?.[1]) {
      imports.push({ line: i + 1, path: importMatch[1] })
    }

    // Also match dynamic imports: import('...')
    const dynamicMatch = line.match(/import\(['"]([^'"]+)['"]\)/)
    if (dynamicMatch?.[1]) {
      imports.push({ line: i + 1, path: dynamicMatch[1] })
    }
  }

  return imports
}

/**
 * Check if an import path crosses package boundaries
 */
function checkCrossPackageImport(
  importPath: string,
  sourceFile: string,
  rootDir: string
): ImportViolation | null {
  // Only check relative imports with parent traversal
  if (!importPath.startsWith('../')) {
    return null
  }

  // Get the source package
  const relativeSourcePath = relative(rootDir, sourceFile)
  const sourcePackage = relativeSourcePath.split('/')[0]

  // Skip if source is not in a workspace package
  if (!sourcePackage || !WORKSPACE_PACKAGES.includes(sourcePackage as any)) {
    return null
  }

  // Resolve the target path
  const sourceDir = dirname(sourceFile)
  let targetPath = importPath

  // Count parent traversals and remove them to find target
  let parentCount = 0
  let remainingPath = importPath
  while (remainingPath.startsWith('../')) {
    parentCount++
    remainingPath = remainingPath.slice(3)
  }

  // Navigate up from source directory
  let currentDir = sourceDir
  for (let i = 0; i < parentCount; i++) {
    currentDir = dirname(currentDir)
  }

  // Get the target relative to root
  const targetFullPath = join(currentDir, remainingPath)
  const relativeTargetPath = relative(rootDir, targetFullPath)
  const targetPackage = relativeTargetPath.split('/')[0]

  // Check if crossing package boundaries
  if (
    targetPackage &&
    targetPackage !== sourcePackage &&
    WORKSPACE_PACKAGES.includes(targetPackage as any)
  ) {
    // Determine the correct workspace import
    let suggestion: string

    // Special cases for subpath exports
    // Note: prefer main package import (@dotdo/rpc) over subpath imports
    if (targetPackage === 'rpc') {
      // All RPC exports (errors, client, batch, etc.) are available from @dotdo/rpc
      suggestion = '@dotdo/rpc'
    } else if (targetPackage === 'integrations') {
      if (remainingPath.includes('stripe')) {
        suggestion = '@dotdo/integrations/stripe'
      } else if (remainingPath.includes('sendgrid')) {
        suggestion = '@dotdo/integrations/sendgrid'
      } else {
        suggestion = '@dotdo/integrations'
      }
    } else if (targetPackage === 'db') {
      // db exports everything from index
      suggestion = '@dotdo/db'
    } else if (targetPackage === 'auth') {
      // auth exports everything from index
      suggestion = '@dotdo/auth'
    } else if (targetPackage === 'utils') {
      // utils should be @dotdo/utils
      suggestion = '@dotdo/utils'
    } else if (targetPackage === 'test-utils') {
      suggestion = '@dotdo/test-utils'
    } else {
      suggestion = `@dotdo/${targetPackage}`
    }

    return {
      file: relativeSourcePath,
      line: 0, // Will be filled in by caller
      importPath,
      targetPackage,
      suggestion,
    }
  }

  return null
}

/**
 * Recursively find all TypeScript files
 */
function findTypeScriptFiles(dir: string, rootDir: string): string[] {
  const files: string[] = []

  try {
    const entries = readdirSync(dir)

    for (const entry of entries) {
      const fullPath = join(dir, entry)
      const relativePath = relative(rootDir, fullPath)
      const dirName = relativePath.split('/')[1] || entry

      // Skip ignored directories
      if (IGNORE_DIRS.has(entry) || IGNORE_DIRS.has(dirName)) {
        continue
      }

      const stat = statSync(fullPath)

      if (stat.isDirectory()) {
        files.push(...findTypeScriptFiles(fullPath, rootDir))
      } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
        // Skip ignored files
        if (!IGNORE_FILES.has(basename(entry))) {
          files.push(fullPath)
        }
      }
    }
  } catch {
    // Directory doesn't exist or can't be read
  }

  return files
}

/**
 * Check a directory for cross-package imports
 */
function checkDirectory(sourceDir: string, rootDir: string): ImportViolation[] {
  const violations: ImportViolation[] = []
  const dirPath = join(rootDir, sourceDir)
  const files = findTypeScriptFiles(dirPath, rootDir)

  for (const file of files) {
    try {
      const content = readFileSync(file, 'utf-8')
      const imports = extractImports(content)

      for (const { line, path } of imports) {
        const violation = checkCrossPackageImport(path, file, rootDir)
        if (violation) {
          violation.line = line
          violations.push(violation)
        }
      }
    } catch {
      // File can't be read
    }
  }

  return violations
}

describe('Import Lint', () => {
  const rootDir = join(__dirname, '../..')

  it('should not have cross-package relative imports in do/', () => {
    const violations = checkDirectory('do', rootDir)

    if (violations.length > 0) {
      const message = formatViolations(violations)
      expect.fail(message)
    }
  })

  it('should not have cross-package relative imports in api/', () => {
    const violations = checkDirectory('api', rootDir)

    if (violations.length > 0) {
      const message = formatViolations(violations)
      expect.fail(message)
    }
  })

  it('should not have cross-package relative imports in mcp/', () => {
    const violations = checkDirectory('mcp', rootDir)

    if (violations.length > 0) {
      const message = formatViolations(violations)
      expect.fail(message)
    }
  })
})

/**
 * Format violations for error message
 */
function formatViolations(violations: ImportViolation[]): string {
  const lines = [
    `Found ${violations.length} cross-package relative import(s) that should use workspace imports:`,
    '',
  ]

  for (const v of violations) {
    lines.push(`  ${v.file}:${v.line}`)
    lines.push(`    import: ${v.importPath}`)
    lines.push(`    should be: ${v.suggestion}`)
    lines.push('')
  }

  lines.push('Run: npm run lint:imports:fix to auto-fix these issues.')

  return lines.join('\n')
}

// Export for use by fix script
export {
  checkDirectory,
  extractImports,
  checkCrossPackageImport,
  findTypeScriptFiles,
  type ImportViolation,
  WORKSPACE_PACKAGES,
  SOURCE_DIRS,
}
