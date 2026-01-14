import { WorkloadConfig, Workload, WorkloadOperation, AccessPattern } from './types'

function createRng(seed: number) {
  return function() {
    let t = seed += 0x6D2B79F5
    t = Math.imul(t ^ t >>> 15, t | 1)
    t ^= t + Math.imul(t ^ t >>> 7, t | 61)
    return ((t ^ t >>> 14) >>> 0) / 4294967296
  }
}

function zipf(rng: () => number, n: number, s: number = 1): number {
  const sum = Array.from({ length: n }, (_, i) => 1 / Math.pow(i + 1, s))
    .reduce((a, b) => a + b, 0)
  const random = rng() * sum
  let cumulative = 0
  for (let i = 0; i < n; i++) {
    cumulative += 1 / Math.pow(i + 1, s)
    if (random <= cumulative) return i
  }
  return n - 1
}

class CustomWorkload implements Workload {
  readonly config: WorkloadConfig
  private rng: () => number

  constructor(config: WorkloadConfig, seed?: number) {
    this.config = config
    this.rng = createRng(seed ?? Date.now())
  }

  *operations(keyCount: number): Generator<WorkloadOperation> {
    const { readRatio, operations, batchSize, accessPattern } = this.config
    let sequentialIndex = 0
    let count = 0

    while (!operations || count < operations) {
      const isRead = this.rng() < readRatio
      const key = this.getKey(keyCount, accessPattern, sequentialIndex)

      if (accessPattern === 'sequential') {
        sequentialIndex = (sequentialIndex + 1) % keyCount
      }

      const batchIndex = batchSize > 1 ? Math.floor(count / batchSize) : undefined

      yield {
        type: isRead ? 'read' : 'write',
        key,
        batchIndex
      }

      count++
    }
  }

  private getKey(keyCount: number, pattern: AccessPattern, seqIndex: number): string {
    switch (pattern) {
      case 'sequential':
        return `key_${seqIndex}`
      case 'random':
        return `key_${Math.floor(this.rng() * keyCount)}`
      case 'zipf':
        return `key_${zipf(this.rng, keyCount)}`
      default:
        return `key_${Math.floor(this.rng() * keyCount)}`
    }
  }
}

export function createWorkload(config: WorkloadConfig, seed?: number): Workload {
  return new CustomWorkload(config, seed)
}
