/**
 * Tests for do/tiny.ts - Minimal DO Entry Point
 *
 * The tiny entry point exports the smallest DO class (~15KB):
 * - DO class from DOTiny (minimal features)
 * - Empty capabilities array
 * - Env type
 */

import { describe, it, expect } from 'vitest'

// Import from the tiny entry point
import * as doTiny from '../tiny'

describe('do/tiny.ts - Minimal DO Entry Point', () => {
  describe('DO Class Export', () => {
    it('exports DO class', () => {
      expect(doTiny.DO).toBeDefined()
      expect(typeof doTiny.DO).toBe('function')
    })

    it('DO is a class constructor', () => {
      expect(doTiny.DO.prototype).toBeDefined()
      expect(doTiny.DO.prototype.constructor).toBe(doTiny.DO)
    })
  })

  describe('Capabilities', () => {
    it('exports empty capabilities array', () => {
      expect(doTiny.capabilities).toBeDefined()
      expect(Array.isArray(doTiny.capabilities)).toBe(true)
      expect(doTiny.capabilities.length).toBe(0)
    })

    it('capabilities array is typed as string[]', () => {
      // TypeScript check - should accept string operations
      const caps: string[] = doTiny.capabilities
      expect(caps).toEqual([])
    })
  })

  describe('Minimal Bundle', () => {
    it('does not export fs capability', () => {
      expect((doTiny as Record<string, unknown>).withFs).toBeUndefined()
    })

    it('does not export git capability', () => {
      expect((doTiny as Record<string, unknown>).withGit).toBeUndefined()
    })

    it('does not export bash capability', () => {
      expect((doTiny as Record<string, unknown>).withBash).toBeUndefined()
    })
  })

  describe('Export Count', () => {
    it('exports minimal number of symbols', () => {
      const exportKeys = Object.keys(doTiny)
      // Should only export DO and capabilities
      expect(exportKeys).toContain('DO')
      expect(exportKeys).toContain('capabilities')
      // Tiny should have very few exports
      expect(exportKeys.length).toBeLessThanOrEqual(3)
    })
  })
})
