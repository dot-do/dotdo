import { GraphConfig, DatasetGenerator } from './types'

function createRng(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface EdgeRecord {
  $id: string
  from: string
  to: string
  weight?: number
}

export class GraphGenerator implements DatasetGenerator<EdgeRecord, GraphConfig> {
  async *generate(config: GraphConfig): AsyncGenerator<EdgeRecord> {
    const rng = createRng(config.seed ?? Date.now())
    const edges = this.generateEdges(rng, config)

    for (const edge of edges) {
      yield edge
    }
  }

  generateSync(config: GraphConfig): EdgeRecord[] {
    const rng = createRng(config.seed ?? Date.now())
    return this.generateEdges(rng, config)
  }

  private generateEdges(rng: () => number, config: GraphConfig): EdgeRecord[] {
    const { nodeCount, density, directed = false, size } = config
    const edges: EdgeRecord[] = []
    const seen = new Set<string>()

    let attempts = 0
    const maxAttempts = size * 10

    while (edges.length < size && attempts < maxAttempts) {
      attempts++

      if (rng() > density) continue

      const from = `node_${Math.floor(rng() * nodeCount)}`
      const to = `node_${Math.floor(rng() * nodeCount)}`

      if (from === to) continue

      const key = directed ? `${from}->${to}` : [from, to].sort().join('<->')
      if (seen.has(key)) continue
      seen.add(key)

      edges.push({
        $id: `edge_${edges.length}`,
        from,
        to,
        weight: rng(),
      })
    }

    return edges
  }
}
