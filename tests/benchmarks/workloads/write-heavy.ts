import { WorkloadConfig } from './types'
import { BaseWorkload } from './base'

export interface WriteHeavyConfig {
  operations?: number
  batchSize?: number
  seed?: number
}

export class WriteHeavyWorkload extends BaseWorkload {
  readonly config: WorkloadConfig

  constructor(options: WriteHeavyConfig = {}) {
    super(options.seed)
    this.config = {
      name: 'write-heavy',
      readRatio: 0.1,
      writeRatio: 0.9,
      batchSize: options.batchSize ?? 1,
      operations: options.operations,
      accessPattern: 'random'
    }
  }
}
