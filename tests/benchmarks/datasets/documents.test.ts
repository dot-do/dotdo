import { describe, test, expect } from 'vitest'
import { DocumentGenerator } from './documents'

describe('DocumentGenerator', () => {
  test('produces valid JSON documents', async () => {
    const gen = new DocumentGenerator()
    const docs = gen.generateSync({ size: 10 })

    docs.forEach((doc) => {
      expect(() => JSON.stringify(doc)).not.toThrow()
      expect(doc.$id).toBeDefined()
      expect(typeof doc.$id).toBe('string')
    })
  })

  test('respects nested depth limit', () => {
    const gen = new DocumentGenerator()
    const docs = gen.generateSync({ size: 5, depth: 2 })

    function getDepth(obj: any, current = 0): number {
      if (typeof obj !== 'object' || obj === null) return current
      return Math.max(...Object.values(obj).map((v) => getDepth(v, current + 1)))
    }

    docs.forEach((doc) => {
      expect(getDepth(doc)).toBeLessThanOrEqual(3) // +1 for root
    })
  })

  test('is deterministic with same seed', () => {
    const gen = new DocumentGenerator()
    const docs1 = gen.generateSync({ size: 10, seed: 12345 })
    const docs2 = gen.generateSync({ size: 10, seed: 12345 })

    expect(docs1).toEqual(docs2)
  })

  test('produces different results with different seeds', () => {
    const gen = new DocumentGenerator()
    const docs1 = gen.generateSync({ size: 10, seed: 11111 })
    const docs2 = gen.generateSync({ size: 10, seed: 22222 })

    expect(docs1).not.toEqual(docs2)
  })

  test('streams large datasets via async generator', async () => {
    const gen = new DocumentGenerator()
    const docs: any[] = []

    for await (const doc of gen.generate({ size: 100 })) {
      docs.push(doc)
      if (docs.length >= 50) break // Can stop early
    }

    expect(docs.length).toBe(50)
  })

  test('generates documents with various field types', () => {
    const gen = new DocumentGenerator()
    const docs = gen.generateSync({ size: 50, seed: 42 })

    // Should have variety of types
    const types = new Set<string>()
    docs.forEach((doc) => {
      Object.values(doc).forEach((v) => types.add(typeof v))
    })

    expect(types.has('string')).toBe(true)
    expect(types.has('number')).toBe(true)
  })
})
