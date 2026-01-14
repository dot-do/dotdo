/**
 * Dataset Generator Types
 *
 * Type definitions for benchmark dataset generation.
 */

export interface DatasetConfig {
  size: number
  seed?: number
}

export interface DocumentConfig extends DatasetConfig {
  depth?: number // Max nesting depth
  arraySize?: number // Max array length
  stringLength?: number // Max string length
}

export interface VectorConfig extends DatasetConfig {
  dimension: number // Vector dimension (e.g., 1536)
  normalize?: boolean // Normalize to unit vectors
}

export interface TimeSeriesConfig extends DatasetConfig {
  startTime: Date
  interval: number // Milliseconds between points
  valueRange?: { min: number; max: number }
}

export interface GraphConfig extends DatasetConfig {
  nodeCount: number
  density: number // 0-1, proportion of possible edges
  directed?: boolean
}

export interface BlobConfig extends DatasetConfig {
  minSize: number // Min bytes
  maxSize: number // Max bytes
}

// Generator interface
export interface DatasetGenerator<T, C extends DatasetConfig = DatasetConfig> {
  generate(config: C): AsyncGenerator<T>
  generateSync(config: C): T[]
}

// Preset sizes
export type PresetSize = 'small' | 'medium' | 'large'

export const PRESET_SIZES: Record<PresetSize, number> = {
  small: 100,
  medium: 10_000,
  large: 1_000_000,
}
