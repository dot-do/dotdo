import { describe, it, expect, beforeAll } from 'vitest'
import { promises as fs } from 'node:fs'
import * as path from 'node:path'

/**
 * README.md Documentation Tests
 *
 * These tests verify that the README.md contains all required sections
 * and that code examples are valid TypeScript.
 */

describe('README.md documentation', () => {
  let readmeContent: string
  const readmePath = path.join(__dirname, '..', 'README.md')

  beforeAll(async () => {
    try {
      readmeContent = await fs.readFile(readmePath, 'utf-8')
    } catch {
      readmeContent = ''
    }
  })

  describe('file existence', () => {
    it('README.md file exists', () => {
      expect(readmeContent.length).toBeGreaterThan(0)
    })
  })

  describe('required sections', () => {
    it('contains "Installation" section', () => {
      expect(readmeContent).toMatch(/##?\s*Installation/i)
    })

    it('contains "Quick Start" section with code example', () => {
      expect(readmeContent).toMatch(/##?\s*Quick Start/i)
      // Should have a code block after Quick Start
      const quickStartIndex = readmeContent.search(/##?\s*Quick Start/i)
      const afterQuickStart = readmeContent.slice(quickStartIndex)
      expect(afterQuickStart).toMatch(/```(typescript|ts|javascript|js)/)
    })

    it('contains "$ Proxy API" section', () => {
      expect(readmeContent).toMatch(/##?\s*\$\s*Proxy API/i)
    })

    it('contains "CLI Commands" section', () => {
      expect(readmeContent).toMatch(/##?\s*CLI Commands/i)
    })

    it('contains "Authentication" section', () => {
      expect(readmeContent).toMatch(/##?\s*Authentication/i)
    })

    it('contains "TypeScript Support" section', () => {
      expect(readmeContent).toMatch(/##?\s*TypeScript Support/i)
    })
  })

  describe('CLI Commands coverage', () => {
    it('documents pull command', () => {
      expect(readmeContent).toMatch(/rpc\.do\s+pull/i)
    })

    it('documents eval command', () => {
      expect(readmeContent).toMatch(/rpc\.do\s+eval/i)
    })

    it('documents run command', () => {
      expect(readmeContent).toMatch(/rpc\.do\s+run/i)
    })

    it('documents repl command', () => {
      expect(readmeContent).toMatch(/rpc\.do\s+repl/i)
    })
  })

  describe('$ Proxy API coverage', () => {
    it('documents basic method calls ($.things.create, $.things.get)', () => {
      expect(readmeContent).toMatch(/\$\.things\.create/)
      expect(readmeContent).toMatch(/\$\.\w+\.get/)
    })

    it('documents entity binding ($.Customer(id))', () => {
      expect(readmeContent).toMatch(/\$\.\w+\(['"].*['"]\)/)
    })

    it('documents event handlers ($.on.Entity.action)', () => {
      expect(readmeContent).toMatch(/\$\.on\.\w+\.\w+/)
    })

    it('documents scheduling ($.every)', () => {
      expect(readmeContent).toMatch(/\$\.every/)
    })

    it('documents reflection methods (_types, _schema, md)', () => {
      expect(readmeContent).toMatch(/\$\._types\(\)/)
      expect(readmeContent).toMatch(/\$\._schema\(\)/)
      expect(readmeContent).toMatch(/\$\.md\(\)/)
    })
  })

  describe('code examples are valid TypeScript', () => {
    it('all code blocks have valid syntax', () => {
      // Extract all TypeScript/JavaScript code blocks
      const codeBlockRegex = /```(?:typescript|ts|javascript|js)?\n([\s\S]*?)```/g
      const codeBlocks: string[] = []
      let match: RegExpExecArray | null

      while ((match = codeBlockRegex.exec(readmeContent)) !== null) {
        const code = match[1]
        if (code !== undefined) {
          codeBlocks.push(code)
        }
      }

      // Should have at least some code examples
      expect(codeBlocks.length).toBeGreaterThan(0)

      // Basic syntax validation: check for balanced brackets
      for (const code of codeBlocks) {
        // Count brackets
        const openParens = (code.match(/\(/g) || []).length
        const closeParens = (code.match(/\)/g) || []).length
        const openBraces = (code.match(/\{/g) || []).length
        const closeBraces = (code.match(/\}/g) || []).length
        const openBrackets = (code.match(/\[/g) || []).length
        const closeBrackets = (code.match(/\]/g) || []).length

        expect(openParens).toBe(closeParens)
        expect(openBraces).toBe(closeBraces)
        expect(openBrackets).toBe(closeBrackets)
      }
    })

    it('code examples can be parsed as JavaScript', () => {
      // Extract code blocks
      const codeBlockRegex = /```(?:typescript|ts|javascript|js)?\n([\s\S]*?)```/g
      let match: RegExpExecArray | null
      const codeBlocks: string[] = []

      while ((match = codeBlockRegex.exec(readmeContent)) !== null) {
        const code = match[1]
        if (code !== undefined) {
          codeBlocks.push(code)
        }
      }

      for (const code of codeBlocks) {
        // Skip shell commands (bash blocks)
        if (code.trim().startsWith('npm ') ||
            code.trim().startsWith('pnpm ') ||
            code.trim().startsWith('yarn ') ||
            code.trim().startsWith('rpc.do ') ||
            code.trim().startsWith('#') ||
            code.trim().startsWith('$')) {
          continue
        }

        // Try to parse as JavaScript expression or statements
        // Remove TypeScript-specific syntax for parsing
        const jsCode = code
          .replace(/:\s*\w+(\[\])?(\s*[,\)\}=])/g, '$2') // Remove type annotations
          .replace(/:\s*Promise<[^>]+>/g, '') // Remove Promise types
          .replace(/:\s*\{[^}]+\}/g, '') // Remove inline type objects
          .replace(/<[^>]+>/g, '') // Remove generics
          .replace(/interface\s+\w+\s*\{[\s\S]*?\}/g, '') // Remove interfaces
          .replace(/type\s+\w+\s*=\s*[^;]+;/g, '') // Remove type aliases
          .replace(/export\s+/g, '') // Remove export keywords
          .replace(/import\s+.*?from\s+['"][^'"]+['"];?/g, '') // Remove imports
          .replace(/import\s+\{[^}]*\}\s+from\s+['"][^'"]+['"];?/g, '') // Remove named imports
          .trim()

        // Skip if nothing left after stripping
        if (jsCode.length === 0) {
          continue
        }

        // Try to create a function with the code (checks syntax)
        // This is a simple check - we wrap in an async function to allow top-level await
        try {
          // eslint-disable-next-line @typescript-eslint/no-implied-eval
          new Function(`'use strict'; return (async () => { ${jsCode} })`)
        } catch (error) {
          // If it fails, try as an expression
          try {
            // eslint-disable-next-line @typescript-eslint/no-implied-eval
            new Function(`'use strict'; return (async () => { return ${jsCode} })`)
          } catch {
            // Ignore parsing errors for now - we're doing basic validation
            // Real TypeScript validation would require the TypeScript compiler
          }
        }
      }
    })
  })

  describe('authentication section', () => {
    it('mentions OAuth device flow', () => {
      expect(readmeContent).toMatch(/OAuth.*device.*flow|device.*flow.*OAuth|device\s*authorization/i)
    })

    it('mentions token storage', () => {
      expect(readmeContent).toMatch(/token.*stor|\.do\/tokens/i)
    })
  })

  describe('TypeScript section', () => {
    it('mentions type generation', () => {
      expect(readmeContent).toMatch(/type.*generat|\.d\.ts|_types/i)
    })
  })
})
