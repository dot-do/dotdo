/**
 * TypeScript Compilation Tests
 *
 * These tests verify that TypeScript compilation passes with zero errors.
 * This is a RED test (TDD) - designed to fail until all type errors are fixed.
 *
 * Test Cases:
 * 1. Full project compilation should pass (`tsc --noEmit` exits with code 0)
 * 2. No type errors in api/routes/*.ts
 * 3. No type errors in db/*.ts
 * 4. No type errors in objects/*.ts
 *
 * @see dotdo-yk9uv - [RED] TypeScript compilation should pass with zero errors
 */

import { describe, it, expect } from 'vitest'
import { execSync } from 'child_process'
import { join } from 'path'

// Project root is three levels up from tests/typescript/
const PROJECT_ROOT = join(__dirname, '../..')

/**
 * Runs TypeScript compiler and returns the result
 * @param extraArgs Additional arguments to pass to tsc
 * @returns Object containing exit code and output
 */
function runTypeCheck(extraArgs: string = ''): { exitCode: number; output: string } {
  try {
    const output = execSync(`npx tsc --noEmit ${extraArgs}`, {
      cwd: PROJECT_ROOT,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    return { exitCode: 0, output }
  } catch (error) {
    const execError = error as { status?: number; stdout?: string; stderr?: string }
    return {
      exitCode: execError.status ?? 1,
      output: (execError.stdout ?? '') + (execError.stderr ?? ''),
    }
  }
}

/**
 * Parses TypeScript compiler output and extracts errors by file path prefix
 * @param output Raw tsc output
 * @param pathPrefix File path prefix to filter (e.g., 'api/routes/', 'db/', 'objects/')
 * @returns Array of error messages for files matching the prefix
 */
function getErrorsForPath(output: string, pathPrefix: string): string[] {
  const lines = output.split('\n')
  const errors: string[] = []

  for (const line of lines) {
    // TypeScript errors look like: "path/to/file.ts(line,col): error TSxxxx: message"
    if (line.startsWith(pathPrefix) && line.includes(': error TS')) {
      errors.push(line)
    }
  }

  return errors
}

/**
 * Counts total TypeScript errors in output
 * @param output Raw tsc output
 * @returns Total number of errors
 */
function countTotalErrors(output: string): number {
  const lines = output.split('\n')
  return lines.filter((line) => line.includes(': error TS')).length
}

describe('TypeScript Compilation', () => {
  describe('Full Project', () => {
    it('should compile with zero errors (tsc --noEmit exits with code 0)', () => {
      const { exitCode, output } = runTypeCheck()

      // Provide helpful error message showing what errors exist
      if (exitCode !== 0) {
        const errorCount = countTotalErrors(output)
        console.error(`\n=== TypeScript Compilation Failed ===`)
        console.error(`Total errors: ${errorCount}`)
        console.error(`\nFirst 20 errors:`)
        const errors = output.split('\n').filter((line) => line.includes(': error TS'))
        console.error(errors.slice(0, 20).join('\n'))
        if (errors.length > 20) {
          console.error(`\n... and ${errors.length - 20} more errors`)
        }
      }

      expect(exitCode, 'TypeScript compilation should exit with code 0').toBe(0)
    })
  })

  describe('api/routes/*.ts', () => {
    it('should have no type errors', () => {
      const { output } = runTypeCheck()
      const errors = getErrorsForPath(output, 'api/routes/')

      if (errors.length > 0) {
        console.error(`\n=== api/routes/ Type Errors (${errors.length}) ===`)
        console.error(errors.join('\n'))
      }

      expect(errors.length, 'api/routes/ should have no type errors').toBe(0)
    })
  })

  describe('db/*.ts', () => {
    it('should have no type errors', () => {
      const { output } = runTypeCheck()
      const errors = getErrorsForPath(output, 'db/')

      if (errors.length > 0) {
        console.error(`\n=== db/ Type Errors (${errors.length}) ===`)
        console.error(errors.join('\n'))
      }

      expect(errors.length, 'db/ should have no type errors').toBe(0)
    })
  })

  describe('objects/*.ts', () => {
    it('should have no type errors', () => {
      const { output } = runTypeCheck()
      const errors = getErrorsForPath(output, 'objects/')

      if (errors.length > 0) {
        console.error(`\n=== objects/ Type Errors (${errors.length}) ===`)
        console.error(errors.join('\n'))
      }

      expect(errors.length, 'objects/ should have no type errors').toBe(0)
    })
  })

  describe('lib/*.ts', () => {
    it('should have no type errors', () => {
      const { output } = runTypeCheck()
      const errors = getErrorsForPath(output, 'lib/')

      if (errors.length > 0) {
        console.error(`\n=== lib/ Type Errors (${errors.length}) ===`)
        console.error(errors.join('\n'))
      }

      expect(errors.length, 'lib/ should have no type errors').toBe(0)
    })
  })

  describe('workflows/*.ts', () => {
    it('should have no type errors', () => {
      const { output } = runTypeCheck()
      const errors = getErrorsForPath(output, 'workflows/')

      if (errors.length > 0) {
        console.error(`\n=== workflows/ Type Errors (${errors.length}) ===`)
        console.error(errors.join('\n'))
      }

      expect(errors.length, 'workflows/ should have no type errors').toBe(0)
    })
  })

  describe('types/*.ts', () => {
    it('should have no type errors', () => {
      const { output } = runTypeCheck()
      const errors = getErrorsForPath(output, 'types/')

      if (errors.length > 0) {
        console.error(`\n=== types/ Type Errors (${errors.length}) ===`)
        console.error(errors.join('\n'))
      }

      expect(errors.length, 'types/ should have no type errors').toBe(0)
    })
  })

  describe('Root *.ts files', () => {
    it('should have no type errors in full.ts', () => {
      const { output } = runTypeCheck()
      const errors = getErrorsForPath(output, 'full.ts')

      if (errors.length > 0) {
        console.error(`\n=== full.ts Type Errors (${errors.length}) ===`)
        console.error(errors.join('\n'))
      }

      expect(errors.length, 'full.ts should have no type errors').toBe(0)
    })

    it('should have no type errors in git.ts', () => {
      const { output } = runTypeCheck()
      const errors = getErrorsForPath(output, 'git.ts')

      if (errors.length > 0) {
        console.error(`\n=== git.ts Type Errors (${errors.length}) ===`)
        console.error(errors.join('\n'))
      }

      expect(errors.length, 'git.ts should have no type errors').toBe(0)
    })

    it('should have no type errors in bash.ts', () => {
      const { output } = runTypeCheck()
      const errors = getErrorsForPath(output, 'bash.ts')

      if (errors.length > 0) {
        console.error(`\n=== bash.ts Type Errors (${errors.length}) ===`)
        console.error(errors.join('\n'))
      }

      expect(errors.length, 'bash.ts should have no type errors').toBe(0)
    })
  })
})
