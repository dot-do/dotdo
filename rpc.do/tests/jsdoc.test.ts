/**
 * @module rpc.do/tests/jsdoc
 *
 * Tests for verifying JSDoc documentation on all public exports.
 *
 * This test suite parses source files and verifies that:
 * 1. All exported functions have JSDoc comments
 * 2. JSDoc includes @param for each parameter
 * 3. JSDoc includes @returns for return values
 * 4. JSDoc includes @example for complex functions
 * 5. JSDoc includes @throws for functions that throw
 * 6. Type exports have JSDoc descriptions
 */

import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'

const SRC_DIR = path.join(__dirname, '..', 'src')

// ============================================================================
// Helpers
// ============================================================================

/**
 * Extract JSDoc comment immediately preceding a given line
 * Looks backwards from the line to find /** ... *\/
 */
function extractJSDocBefore(lines: string[], lineIndex: number): string | null {
  // Look backwards to find the end of JSDoc (*/)
  let searchIndex = lineIndex - 1

  // Skip blank lines and decorators
  while (searchIndex >= 0) {
    const line = lines[searchIndex]?.trim() ?? ''
    if (line === '' || line.startsWith('@')) {
      searchIndex--
    } else {
      break
    }
  }

  if (searchIndex < 0) return null

  const endLine = lines[searchIndex]?.trim() ?? ''
  if (!endLine.endsWith('*/')) return null

  // Now find the start of JSDoc (/**)
  let startIndex = searchIndex
  while (startIndex >= 0) {
    const line = lines[startIndex]?.trim() ?? ''
    if (line.startsWith('/**')) {
      break
    }
    startIndex--
  }

  if (startIndex < 0) return null

  // Extract JSDoc content
  return lines.slice(startIndex, searchIndex + 1).join('\n')
}

/**
 * Check if JSDoc contains specific tags
 */
function hasTag(jsdoc: string, tag: string): boolean {
  return jsdoc.includes(`@${tag}`)
}

/**
 * Check if JSDoc has @param for a parameter name
 */
function hasParamTag(jsdoc: string, paramName: string): boolean {
  // Match @param name or @param {type} name
  const paramPattern = new RegExp(`@param\\s+(?:\\{[^}]*\\}\\s+)?${paramName}(?:\\s|$|-|\\n)`)
  return paramPattern.test(jsdoc)
}

/**
 * Extract function/class/interface signature from a line
 */
interface ParsedExport {
  type: 'function' | 'class' | 'interface' | 'type' | 'const' | 'enum'
  name: string
  params?: string[]
  hasReturn?: boolean
  lineIndex: number
}

function parseExport(line: string, lineIndex: number): ParsedExport | null {
  // Export function
  const fnMatch = line.match(/^export\s+(?:async\s+)?function\s+(\w+)\s*(?:<[^>]*>)?\s*\(([^)]*)\)/)
  if (fnMatch) {
    const name = fnMatch[1] ?? ''
    const paramsStr = fnMatch[2] ?? ''
    const params = paramsStr
      .split(',')
      .map((p) => p.trim().split(/[?:=]/)[0]?.trim())
      .filter((p): p is string => !!p && p !== '')

    const parsedExport: ParsedExport = {
      type: 'function',
      name,
      hasReturn: true, // Assume all exported functions return something
      lineIndex,
    }
    if (params.length > 0) {
      parsedExport.params = params
    }
    return parsedExport
  }

  // Export class
  const classMatch = line.match(/^export\s+class\s+(\w+)/)
  if (classMatch) {
    return {
      type: 'class',
      name: classMatch[1] ?? '',
      lineIndex,
    }
  }

  // Export interface
  const interfaceMatch = line.match(/^export\s+interface\s+(\w+)/)
  if (interfaceMatch) {
    return {
      type: 'interface',
      name: interfaceMatch[1] ?? '',
      lineIndex,
    }
  }

  // Export type
  const typeMatch = line.match(/^export\s+type\s+(\w+)/)
  if (typeMatch) {
    return {
      type: 'type',
      name: typeMatch[1] ?? '',
      lineIndex,
    }
  }

  // Export const
  const constMatch = line.match(/^export\s+const\s+(\w+)/)
  if (constMatch) {
    return {
      type: 'const',
      name: constMatch[1] ?? '',
      lineIndex,
    }
  }

  // Export enum
  const enumMatch = line.match(/^export\s+(?:const\s+)?enum\s+(\w+)/)
  if (enumMatch) {
    return {
      type: 'enum',
      name: enumMatch[1] ?? '',
      lineIndex,
    }
  }

  return null
}

/**
 * Parse a TypeScript file and extract exports with their JSDoc
 */
interface ExportWithDoc {
  export: ParsedExport
  jsdoc: string | null
  file: string
}

function parseFile(filePath: string): ExportWithDoc[] {
  const content = fs.readFileSync(filePath, 'utf-8')
  const lines = content.split('\n')
  const exports: ExportWithDoc[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''
    const trimmed = line.trim()

    // Skip if inside a comment
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue

    const parsed = parseExport(trimmed, i)
    if (parsed) {
      const jsdoc = extractJSDocBefore(lines, i)
      exports.push({
        export: parsed,
        jsdoc,
        file: filePath,
      })
    }
  }

  return exports
}

/**
 * Get all .ts files in a directory recursively
 */
function getTypeScriptFiles(dir: string): string[] {
  const files: string[] = []
  const entries = fs.readdirSync(dir, { withFileTypes: true })

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      // Skip cli directory as it's implementation details, not public API
      if (entry.name !== 'cli') {
        files.push(...getTypeScriptFiles(fullPath))
      }
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      files.push(fullPath)
    }
  }

  return files
}

// ============================================================================
// Tests
// ============================================================================

describe('JSDoc Documentation', () => {
  // Collect all exports from source files
  const files = getTypeScriptFiles(SRC_DIR)
  const allExports: ExportWithDoc[] = []

  for (const file of files) {
    allExports.push(...parseFile(file))
  }

  describe('All exports have JSDoc comments', () => {
    it('every public export has a JSDoc comment', () => {
      const missing: string[] = []

      for (const exp of allExports) {
        if (!exp.jsdoc) {
          const relativePath = path.relative(SRC_DIR, exp.file)
          missing.push(`${relativePath}: ${exp.export.type} ${exp.export.name}`)
        }
      }

      if (missing.length > 0) {
        console.log('Exports missing JSDoc:')
        missing.forEach((m) => console.log(`  - ${m}`))
      }

      expect(missing).toEqual([])
    })
  })

  describe('Functions have @param tags', () => {
    it('all function parameters are documented', () => {
      const missing: string[] = []

      for (const exp of allExports) {
        if (exp.export.type !== 'function') continue
        if (!exp.jsdoc) continue // Separate test for missing JSDoc
        if (!exp.export.params || exp.export.params.length === 0) continue

        for (const param of exp.export.params) {
          if (!hasParamTag(exp.jsdoc, param)) {
            const relativePath = path.relative(SRC_DIR, exp.file)
            missing.push(`${relativePath}: ${exp.export.name}() missing @param ${param}`)
          }
        }
      }

      if (missing.length > 0) {
        console.log('Functions missing @param:')
        missing.forEach((m) => console.log(`  - ${m}`))
      }

      expect(missing).toEqual([])
    })
  })

  describe('Functions have @returns tags', () => {
    it('all functions with return values have @returns', () => {
      const missing: string[] = []

      for (const exp of allExports) {
        if (exp.export.type !== 'function') continue
        if (!exp.jsdoc) continue // Separate test for missing JSDoc

        // Check for @returns or @return
        const hasReturns = hasTag(exp.jsdoc, 'returns') || hasTag(exp.jsdoc, 'return')
        if (!hasReturns) {
          const relativePath = path.relative(SRC_DIR, exp.file)
          missing.push(`${relativePath}: ${exp.export.name}()`)
        }
      }

      if (missing.length > 0) {
        console.log('Functions missing @returns:')
        missing.forEach((m) => console.log(`  - ${m}`))
      }

      expect(missing).toEqual([])
    })
  })

  describe('Complex functions have @example tags', () => {
    // Functions considered "complex" - factory functions, clients, transports
    const complexFunctions = [
      'createClient',
      'createProxy',
      'createFetchTransport',
      'createWebSocketTransport',
      'createAuthTransport',
      'ensureLoggedIn',
      'createRefreshFn',
      'refreshToken',
      'createLogger',
      'createLoggerFromCLI',
    ]

    it('complex functions have @example documentation', () => {
      const missing: string[] = []

      for (const exp of allExports) {
        if (exp.export.type !== 'function') continue
        if (!complexFunctions.includes(exp.export.name)) continue
        if (!exp.jsdoc) continue

        if (!hasTag(exp.jsdoc, 'example')) {
          const relativePath = path.relative(SRC_DIR, exp.file)
          missing.push(`${relativePath}: ${exp.export.name}()`)
        }
      }

      if (missing.length > 0) {
        console.log('Complex functions missing @example:')
        missing.forEach((m) => console.log(`  - ${m}`))
      }

      expect(missing).toEqual([])
    })
  })

  describe('Error-throwing functions have @throws tags', () => {
    // Functions known to throw errors
    const throwingFunctions = ['refreshToken']

    it('error-throwing functions have @throws documentation', () => {
      const missing: string[] = []

      for (const exp of allExports) {
        if (exp.export.type !== 'function') continue
        if (!throwingFunctions.includes(exp.export.name)) continue
        if (!exp.jsdoc) continue

        if (!hasTag(exp.jsdoc, 'throws')) {
          const relativePath = path.relative(SRC_DIR, exp.file)
          missing.push(`${relativePath}: ${exp.export.name}()`)
        }
      }

      if (missing.length > 0) {
        console.log('Functions missing @throws:')
        missing.forEach((m) => console.log(`  - ${m}`))
      }

      expect(missing).toEqual([])
    })
  })

  describe('Types and interfaces have descriptions', () => {
    it('all exported types have JSDoc descriptions', () => {
      const missing: string[] = []

      for (const exp of allExports) {
        if (exp.export.type !== 'interface' && exp.export.type !== 'type') continue
        if (!exp.jsdoc) {
          const relativePath = path.relative(SRC_DIR, exp.file)
          missing.push(`${relativePath}: ${exp.export.type} ${exp.export.name}`)
        }
      }

      if (missing.length > 0) {
        console.log('Types missing JSDoc:')
        missing.forEach((m) => console.log(`  - ${m}`))
      }

      expect(missing).toEqual([])
    })
  })

  describe('Classes have descriptions', () => {
    it('all exported classes have JSDoc descriptions', () => {
      const missing: string[] = []

      for (const exp of allExports) {
        if (exp.export.type !== 'class') continue
        if (!exp.jsdoc) {
          const relativePath = path.relative(SRC_DIR, exp.file)
          missing.push(`${relativePath}: class ${exp.export.name}`)
        }
      }

      if (missing.length > 0) {
        console.log('Classes missing JSDoc:')
        missing.forEach((m) => console.log(`  - ${m}`))
      }

      expect(missing).toEqual([])
    })
  })

  describe('Module documentation', () => {
    const expectedModules = [
      'src/index.ts',
      'src/client.ts',
      'src/types.ts',
      'src/logger.ts',
      'src/transport/index.ts',
      'src/transport/fetch.ts',
      'src/transport/websocket.ts',
      'src/transport/types.ts',
      'src/auth/index.ts',
      'src/auth/token-store.ts',
      'src/auth/device-flow.ts',
      'src/auth/auth-transport.ts',
      'src/auth/refresh.ts',
    ]

    it('all modules have @module documentation', () => {
      const missing: string[] = []

      for (const modulePath of expectedModules) {
        const fullPath = path.join(SRC_DIR, '..', modulePath)
        if (!fs.existsSync(fullPath)) {
          missing.push(`${modulePath}: file not found`)
          continue
        }

        const content = fs.readFileSync(fullPath, 'utf-8')
        if (!content.includes('@module')) {
          missing.push(`${modulePath}: missing @module tag`)
        }
      }

      if (missing.length > 0) {
        console.log('Modules missing @module:')
        missing.forEach((m) => console.log(`  - ${m}`))
      }

      expect(missing).toEqual([])
    })
  })

  describe('Summary statistics', () => {
    it('provides documentation coverage summary', () => {
      const stats = {
        total: allExports.length,
        documented: allExports.filter((e) => e.jsdoc !== null).length,
        functions: allExports.filter((e) => e.export.type === 'function').length,
        classes: allExports.filter((e) => e.export.type === 'class').length,
        interfaces: allExports.filter((e) => e.export.type === 'interface').length,
        types: allExports.filter((e) => e.export.type === 'type').length,
        consts: allExports.filter((e) => e.export.type === 'const').length,
        enums: allExports.filter((e) => e.export.type === 'enum').length,
      }

      console.log('\nJSDoc Documentation Coverage:')
      console.log(`  Total exports: ${stats.total}`)
      console.log(`  Documented: ${stats.documented} (${Math.round((stats.documented / stats.total) * 100)}%)`)
      console.log(`  Functions: ${stats.functions}`)
      console.log(`  Classes: ${stats.classes}`)
      console.log(`  Interfaces: ${stats.interfaces}`)
      console.log(`  Types: ${stats.types}`)
      console.log(`  Constants: ${stats.consts}`)
      console.log(`  Enums: ${stats.enums}`)

      // All exports should be documented
      expect(stats.documented).toBe(stats.total)
    })
  })
})
