import { DocumentConfig, DatasetGenerator } from './types'

// Seeded PRNG (mulberry32)
function createRng(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export class DocumentGenerator implements DatasetGenerator<Record<string, any>, DocumentConfig> {
  async *generate(config: DocumentConfig): AsyncGenerator<Record<string, any>> {
    const rng = createRng(config.seed ?? Date.now())
    const depth = config.depth ?? 3
    const arraySize = config.arraySize ?? 5
    const stringLength = config.stringLength ?? 50

    for (let i = 0; i < config.size; i++) {
      yield this.generateDoc(rng, depth, arraySize, stringLength, i)
    }
  }

  generateSync(config: DocumentConfig): Record<string, any>[] {
    const rng = createRng(config.seed ?? Date.now())
    const depth = config.depth ?? 3
    const arraySize = config.arraySize ?? 5
    const stringLength = config.stringLength ?? 50

    const docs: Record<string, any>[] = []
    for (let i = 0; i < config.size; i++) {
      docs.push(this.generateDoc(rng, depth, arraySize, stringLength, i))
    }
    return docs
  }

  private generateDoc(
    rng: () => number,
    maxDepth: number,
    arraySize: number,
    stringLength: number,
    index: number,
    currentDepth = 0
  ): Record<string, any> {
    const doc: Record<string, any> = {
      $id: `doc_${index}_${Math.floor(rng() * 1000000)}`,
    }

    const numFields = 3 + Math.floor(rng() * 5)

    for (let i = 0; i < numFields; i++) {
      const fieldName = `field_${i}`
      doc[fieldName] = this.generateValue(rng, maxDepth, arraySize, stringLength, currentDepth)
    }

    return doc
  }

  private generateValue(
    rng: () => number,
    maxDepth: number,
    arraySize: number,
    stringLength: number,
    currentDepth: number
  ): any {
    const type = Math.floor(rng() * 6)

    if (currentDepth >= maxDepth) {
      // Only primitives at max depth
      return type < 3 ? this.generateString(rng, stringLength) : rng() * 1000
    }

    switch (type) {
      case 0:
      case 1:
        return this.generateString(rng, stringLength)
      case 2:
      case 3:
        return rng() * 1000
      case 4:
        // Array
        const arrLen = 1 + Math.floor(rng() * (arraySize - 1))
        return Array.from({ length: arrLen }, () =>
          this.generateValue(rng, maxDepth, arraySize, stringLength, currentDepth + 1)
        )
      case 5:
        // Nested object
        return this.generateDoc(rng, maxDepth, arraySize, stringLength, 0, currentDepth + 1)
      default:
        return null
    }
  }

  private generateString(rng: () => number, maxLen: number): string {
    const len = 5 + Math.floor(rng() * (maxLen - 5))
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
    let str = ''
    for (let i = 0; i < len; i++) {
      str += chars[Math.floor(rng() * chars.length)]
    }
    return str
  }
}
