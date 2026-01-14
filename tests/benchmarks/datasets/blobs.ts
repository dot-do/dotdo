import { BlobConfig, DatasetGenerator } from './types'

function createRng(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface BlobRecord {
  $id: string
  data: Uint8Array
  size: number
}

export class BlobGenerator implements DatasetGenerator<BlobRecord, BlobConfig> {
  async *generate(config: BlobConfig): AsyncGenerator<BlobRecord> {
    const rng = createRng(config.seed ?? Date.now())

    for (let i = 0; i < config.size; i++) {
      yield this.generateBlob(rng, config.minSize, config.maxSize, i)
    }
  }

  generateSync(config: BlobConfig): BlobRecord[] {
    const rng = createRng(config.seed ?? Date.now())
    const blobs: BlobRecord[] = []

    for (let i = 0; i < config.size; i++) {
      blobs.push(this.generateBlob(rng, config.minSize, config.maxSize, i))
    }

    return blobs
  }

  private generateBlob(
    rng: () => number,
    minSize: number,
    maxSize: number,
    index: number
  ): BlobRecord {
    const size = Math.floor(minSize + rng() * (maxSize - minSize))
    const data = new Uint8Array(size)

    for (let i = 0; i < size; i++) {
      data[i] = Math.floor(rng() * 256)
    }

    return {
      $id: `blob_${index}`,
      data,
      size,
    }
  }
}
