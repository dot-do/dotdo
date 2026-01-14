import { BenchmarkResult } from './types'

export interface Baseline {
  timestamp: string
  results: BenchmarkResult[]
  metadata?: {
    commit?: string
    branch?: string
    [key: string]: unknown
  }
}

export interface BaselineConfig {
  path: string
}

export interface DeltaEntry {
  baselineP50: number
  currentP50: number
  change: number // Percentage change as decimal (1.0 = +100%)
}

export type Delta = Record<string, DeltaEntry>
