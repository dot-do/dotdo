import { DatasetConfig, PRESET_SIZES, PresetSize } from './types'

export { PRESET_SIZES }

export function getPreset(size: PresetSize): DatasetConfig {
  return {
    size: PRESET_SIZES[size],
  }
}
