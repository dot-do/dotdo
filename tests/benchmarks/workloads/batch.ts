import { WorkloadConfig } from './types'
import { BaseWorkload } from './base'

export interface BatchConfig {
  batchSize?: number
  operations?: number
  seed?: number
}

export class BatchWorkload extends BaseWorkload {
  readonly config: WorkloadConfig

  constructor(options: BatchConfig = {}) {
    super(options.seed)
    this.config = {
      name: 'batch',
      readRatio: 0.2,
      writeRatio: 0.8,
      batchSize: options.batchSize ?? 100,
      operations: options.operations,
      accessPattern: 'sequential'
    }
  }
}
