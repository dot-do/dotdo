/**
 * Tests for do/base.ts - Core DO with WorkflowContext
 *
 * The base entry point exports the middle-tier DO class (~80KB):
 * - DO class from DOBase (workflow context, stores, events, scheduling)
 * - Capabilities array with workflow-related features
 * - Type exports: Env, ThingsCollection, RelationshipsAccessor, RelationshipRecord
 */

import { describe, it, expect } from 'vitest'

// Import from the base entry point
import * as doBase from '../base'

describe('do/base.ts - Core DO with WorkflowContext', () => {
  describe('DO Class Export', () => {
    it('exports DO class', () => {
      expect(doBase.DO).toBeDefined()
      expect(typeof doBase.DO).toBe('function')
    })

    it('DO is a class constructor', () => {
      expect(doBase.DO.prototype).toBeDefined()
      expect(doBase.DO.prototype.constructor).toBe(doBase.DO)
    })
  })

  describe('Capabilities', () => {
    it('exports capabilities array', () => {
      expect(doBase.capabilities).toBeDefined()
      expect(Array.isArray(doBase.capabilities)).toBe(true)
    })

    it('includes workflow capability', () => {
      expect(doBase.capabilities).toContain('workflow')
    })

    it('includes stores capability', () => {
      expect(doBase.capabilities).toContain('stores')
    })

    it('includes events capability', () => {
      expect(doBase.capabilities).toContain('events')
    })

    it('includes scheduling capability', () => {
      expect(doBase.capabilities).toContain('scheduling')
    })

    it('includes ai capability', () => {
      expect(doBase.capabilities).toContain('ai')
    })

    it('has exactly 5 capabilities', () => {
      expect(doBase.capabilities.length).toBe(5)
    })
  })

  describe('Base vs Full', () => {
    it('does not include fs capability', () => {
      expect(doBase.capabilities).not.toContain('fs')
    })

    it('does not include git capability', () => {
      expect(doBase.capabilities).not.toContain('git')
    })

    it('does not include bash capability', () => {
      expect(doBase.capabilities).not.toContain('bash')
    })
  })

  describe('Export Count', () => {
    it('exports expected number of symbols', () => {
      const exportKeys = Object.keys(doBase)
      // Should export DO and capabilities, possibly type re-exports
      expect(exportKeys).toContain('DO')
      expect(exportKeys).toContain('capabilities')
      // Base should have fewer exports than full
      expect(exportKeys.length).toBeLessThan(10)
    })
  })
})
