import { describe, test, expect } from 'vitest'
import { VectorGenerator } from './vectors'

describe('VectorGenerator', () => {
  test('produces correct dimension', () => {
    const gen = new VectorGenerator()
    const vectors = gen.generateSync({ size: 5, dimension: 1536 })

    vectors.forEach((v) => {
      expect(v.embedding.length).toBe(1536)
    })
  })

  test('normalizes embeddings to unit vectors', () => {
    const gen = new VectorGenerator()
    const vectors = gen.generateSync({ size: 5, dimension: 128, normalize: true })

    vectors.forEach((v) => {
      const magnitude = Math.sqrt(v.embedding.reduce((sum, x) => sum + x * x, 0))
      expect(magnitude).toBeCloseTo(1, 5)
    })
  })

  test('does not normalize when normalize=false', () => {
    const gen = new VectorGenerator()
    const vectors = gen.generateSync({ size: 5, dimension: 128, normalize: false })

    // At least one should not be normalized
    const notNormalized = vectors.some((v) => {
      const magnitude = Math.sqrt(v.embedding.reduce((sum, x) => sum + x * x, 0))
      return Math.abs(magnitude - 1) > 0.1
    })
    expect(notNormalized).toBe(true)
  })

  test('is deterministic with same seed', () => {
    const gen = new VectorGenerator()
    const v1 = gen.generateSync({ size: 3, dimension: 64, seed: 999 })
    const v2 = gen.generateSync({ size: 3, dimension: 64, seed: 999 })

    expect(v1).toEqual(v2)
  })

  test('includes metadata with each vector', () => {
    const gen = new VectorGenerator()
    const vectors = gen.generateSync({ size: 3, dimension: 64 })

    vectors.forEach((v) => {
      expect(v.$id).toBeDefined()
      expect(v.content).toBeDefined()
      expect(typeof v.content).toBe('string')
    })
  })
})
