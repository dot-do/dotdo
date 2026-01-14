import { WorkloadConfig } from './types'
import { BaseWorkload } from './base'

export interface MixedConfig {
  operations?: number
  duration?: number
  batchSize?: number
  seed?: number
}

export class MixedWorkload extends BaseWorkload {
  readonly config: WorkloadConfig

  constructor(options: MixedConfig = {}) {
    super(options.seed)
    this.config = {
      name: 'mixed',
      readRatio: 0.5,
      writeRatio: 0.5,
      batchSize: options.batchSize ?? 1,
      operations: options.operations,
      duration: options.duration,
      accessPattern: 'random'
    }
  }
}
