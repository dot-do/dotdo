import { WorkloadConfig } from './types'
import { BaseWorkload } from './base'

export interface ReadHeavyConfig {
  operations?: number
  batchSize?: number
  seed?: number
}

export class ReadHeavyWorkload extends BaseWorkload {
  readonly config: WorkloadConfig

  constructor(options: ReadHeavyConfig = {}) {
    super(options.seed)
    this.config = {
      name: 'read-heavy',
      readRatio: 0.9,
      writeRatio: 0.1,
      batchSize: options.batchSize ?? 1,
      operations: options.operations,
      accessPattern: 'random'
    }
  }
}
