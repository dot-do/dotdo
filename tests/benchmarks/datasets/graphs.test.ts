import { describe, test, expect } from 'vitest'
import { GraphGenerator } from './graphs'

describe('GraphGenerator', () => {
  test('produces valid edges', () => {
    const gen = new GraphGenerator()
    const edges = gen.generateSync({
      size: 50,
      nodeCount: 10,
      density: 0.5,
    })

    edges.forEach((edge) => {
      expect(edge.from).toBeDefined()
      expect(edge.to).toBeDefined()
      expect(typeof edge.from).toBe('string')
      expect(typeof edge.to).toBe('string')
    })
  })

  test('respects density - low density produces fewer edges', () => {
    const gen = new GraphGenerator()
    const lowDensity = gen.generateSync({
      size: 1000,
      nodeCount: 20,
      density: 0.1,
    })
    const highDensity = gen.generateSync({
      size: 1000,
      nodeCount: 20,
      density: 0.9,
    })

    // With same size limit but different densities, low should have fewer unique edges
    expect(lowDensity.length).toBeLessThanOrEqual(highDensity.length)
  })

  test('edge nodes are within nodeCount range', () => {
    const gen = new GraphGenerator()
    const edges = gen.generateSync({
      size: 100,
      nodeCount: 5,
      density: 1,
    })

    const nodeIds = new Set<string>()
    edges.forEach((e) => {
      nodeIds.add(e.from)
      nodeIds.add(e.to)
    })

    expect(nodeIds.size).toBeLessThanOrEqual(5)
  })

  test('directed graphs allow both directions', () => {
    const gen = new GraphGenerator()
    const edges = gen.generateSync({
      size: 100,
      nodeCount: 10,
      density: 0.8,
      directed: true,
      seed: 123,
    })

    // In directed graph, A->B and B->A are different edges
    const edgeSet = new Set(edges.map((e) => `${e.from}->${e.to}`))
    // Could have both directions for some pairs
    expect(edgeSet.size).toBe(edges.length) // No duplicates
  })

  test('is deterministic with same seed', () => {
    const gen = new GraphGenerator()
    const config = { size: 20, nodeCount: 5, density: 0.5, seed: 555 }

    const e1 = gen.generateSync(config)
    const e2 = gen.generateSync(config)

    expect(e1).toEqual(e2)
  })
})
