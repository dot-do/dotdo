import { VectorConfig, DatasetGenerator } from './types'

function createRng(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface VectorRecord {
  $id: string
  content: string
  embedding: number[]
}

export class VectorGenerator implements DatasetGenerator<VectorRecord, VectorConfig> {
  async *generate(config: VectorConfig): AsyncGenerator<VectorRecord> {
    const rng = createRng(config.seed ?? Date.now())

    for (let i = 0; i < config.size; i++) {
      yield this.generateVector(rng, config.dimension, config.normalize ?? true, i)
    }
  }

  generateSync(config: VectorConfig): VectorRecord[] {
    const rng = createRng(config.seed ?? Date.now())
    const vectors: VectorRecord[] = []

    for (let i = 0; i < config.size; i++) {
      vectors.push(this.generateVector(rng, config.dimension, config.normalize ?? true, i))
    }

    return vectors
  }

  private generateVector(
    rng: () => number,
    dimension: number,
    normalize: boolean,
    index: number
  ): VectorRecord {
    let embedding = Array.from({ length: dimension }, () => rng() * 2 - 1)

    if (normalize) {
      const magnitude = Math.sqrt(embedding.reduce((sum, x) => sum + x * x, 0))
      embedding = embedding.map((x) => x / magnitude)
    }

    return {
      $id: `vec_${index}`,
      content: `Sample content for vector ${index}`,
      embedding,
    }
  }
}
