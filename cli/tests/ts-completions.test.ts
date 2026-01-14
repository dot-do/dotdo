import { describe, it, expect } from 'vitest'
import {
  getCompletions,
  getDetailedCompletions,
  createCompletionService,
} from '../services/ts-completions'
import { join } from 'path'
import { writeFileSync, mkdirSync, rmSync } from 'fs'

describe('TS completions', () => {
  describe('getCompletions', () => {
    it('returns completions for Math methods', () => {
      const completions = getCompletions('const x = Math.', 15)
      expect(completions.length).toBeGreaterThan(0)
      expect(completions).toContain('abs')
      expect(completions).toContain('floor')
      expect(completions).toContain('ceil')
    })

    it('returns completions for array methods', () => {
      const completions = getCompletions('const arr = [1,2,3]; arr.', 25)
      expect(completions.length).toBeGreaterThan(0)
      expect(completions).toContain('map')
      expect(completions).toContain('filter')
      expect(completions).toContain('reduce')
    })

    it('returns completions for $ context', () => {
      const completions = getCompletions('$.', 2)
      expect(completions.length).toBeGreaterThan(0)
      expect(completions).toContain('things')
      expect(completions).toContain('events')
      expect(completions).toContain('actions')
    })

    it('returns completions for $.things methods', () => {
      const completions = getCompletions('$.things.', 9)
      expect(completions.length).toBeGreaterThan(0)
      expect(completions).toContain('list')
      expect(completions).toContain('get')
      expect(completions).toContain('create')
    })

    it('returns completions for $.every scheduler', () => {
      const completions = getCompletions('$.every.', 8)
      expect(completions.length).toBeGreaterThan(0)
      expect(completions).toContain('Monday')
      expect(completions).toContain('day')
    })

    it('returns completions for string methods', () => {
      const completions = getCompletions('const s = "hello"; s.', 21)
      expect(completions.length).toBeGreaterThan(0)
      expect(completions).toContain('toUpperCase')
      expect(completions).toContain('toLowerCase')
      expect(completions).toContain('split')
    })

    it('returns empty array for invalid code gracefully', () => {
      // Should not throw, just return empty
      const completions = getCompletions('{{{{', 4)
      expect(Array.isArray(completions)).toBe(true)
    })

    it('filters out private entries starting with underscore', () => {
      const completions = getCompletions('const obj = { _private: 1, public: 2 }; obj.', 44)
      expect(completions).not.toContain('_private')
      expect(completions).toContain('public')
    })

    it('limits results to 20 entries', () => {
      // Object has many methods
      const completions = getCompletions('const obj = {}; Object.', 23)
      expect(completions.length).toBeLessThanOrEqual(20)
    })
  })

  describe('getDetailedCompletions', () => {
    it('returns completions with kind information', () => {
      const completions = getDetailedCompletions('Math.', 5)
      expect(completions.length).toBeGreaterThan(0)

      const absCompletion = completions.find((c) => c.name === 'abs')
      expect(absCompletion).toBeDefined()
      expect(absCompletion?.kind).toBeDefined()
      expect(absCompletion?.sortText).toBeDefined()
    })

    it('returns $ context completions with proper types', () => {
      const completions = getDetailedCompletions('$.', 2)
      expect(completions.length).toBeGreaterThan(0)

      const thingsCompletion = completions.find((c) => c.name === 'things')
      expect(thingsCompletion).toBeDefined()
    })
  })

  describe('createCompletionService', () => {
    it('creates a reusable service instance', () => {
      const service = createCompletionService()

      const completions1 = service.getCompletions('$.', 2)
      const completions2 = service.getCompletions('Math.', 5)

      expect(completions1).toContain('things')
      expect(completions2).toContain('abs')
    })

    it('accepts custom types path', () => {
      // Create a temp types file
      const tempDir = join(process.cwd(), '.test-types-temp')
      const typesPath = join(tempDir, 'custom.d.ts')

      try {
        mkdirSync(tempDir, { recursive: true })
        writeFileSync(
          typesPath,
          `
          declare const customGlobal: {
            customMethod(): void
            customProp: string
          }
        `
        )

        const service = createCompletionService(typesPath)
        const completions = service.getCompletions('customGlobal.', 13)

        expect(completions).toContain('customMethod')
        expect(completions).toContain('customProp')
      } finally {
        // Cleanup
        try {
          rmSync(tempDir, { recursive: true })
        } catch {
          // Ignore cleanup errors
        }
      }
    })
  })

  describe('edge cases', () => {
    it('handles empty input', () => {
      const completions = getCompletions('', 0)
      expect(Array.isArray(completions)).toBe(true)
    })

    it('handles position at start of code', () => {
      const completions = getCompletions('const x = 1', 0)
      expect(Array.isArray(completions)).toBe(true)
    })

    it('handles position beyond code length', () => {
      const completions = getCompletions('const x = 1', 100)
      expect(Array.isArray(completions)).toBe(true)
    })

    it('handles multiline code', () => {
      const code = `const x = 1
const y = 2
Math.`
      const completions = getCompletions(code, code.length)
      expect(completions).toContain('abs')
    })

    it('handles await expressions', () => {
      const completions = getCompletions('await $.things.', 15)
      expect(completions).toContain('list')
      expect(completions).toContain('get')
    })

    it('handles async function context', () => {
      const code = 'async function test() { return $.things.'
      const completions = getCompletions(code, code.length)
      expect(completions).toContain('list')
    })
  })
})
