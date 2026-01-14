export type AccessPattern = 'sequential' | 'random' | 'zipf'

export interface WorkloadConfig {
  name: string
  readRatio: number      // 0-1
  writeRatio: number     // 0-1
  batchSize: number      // Operations per batch
  duration?: number      // Max duration ms
  operations?: number    // Max operations
  accessPattern: AccessPattern
}

export type OperationType = 'read' | 'write'

export interface WorkloadOperation {
  type: OperationType
  key: string
  batchIndex?: number
}

export interface Workload {
  readonly config: WorkloadConfig
  operations(keyCount: number): Generator<WorkloadOperation>
}

// Built-in workload presets
export const WORKLOAD_PRESETS = {
  READ_HEAVY: 'read-heavy',
  WRITE_HEAVY: 'write-heavy',
  MIXED: 'mixed',
  BATCH: 'batch',
  STREAMING: 'streaming',
  HOT_COLD: 'hot-cold'
} as const
