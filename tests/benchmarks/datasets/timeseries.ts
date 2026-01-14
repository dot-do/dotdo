import { TimeSeriesConfig, DatasetGenerator } from './types'

function createRng(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface TimeSeriesRecord {
  $id: string
  timestamp: Date
  value: number
}

export class TimeSeriesGenerator implements DatasetGenerator<TimeSeriesRecord, TimeSeriesConfig> {
  async *generate(config: TimeSeriesConfig): AsyncGenerator<TimeSeriesRecord> {
    const rng = createRng(config.seed ?? Date.now())
    const range = config.valueRange ?? { min: 0, max: 100 }
    let currentTime = config.startTime.getTime()

    for (let i = 0; i < config.size; i++) {
      yield {
        $id: `ts_${i}`,
        timestamp: new Date(currentTime),
        value: range.min + rng() * (range.max - range.min),
      }
      currentTime += config.interval
    }
  }

  generateSync(config: TimeSeriesConfig): TimeSeriesRecord[] {
    const rng = createRng(config.seed ?? Date.now())
    const range = config.valueRange ?? { min: 0, max: 100 }
    const records: TimeSeriesRecord[] = []
    let currentTime = config.startTime.getTime()

    for (let i = 0; i < config.size; i++) {
      records.push({
        $id: `ts_${i}`,
        timestamp: new Date(currentTime),
        value: range.min + rng() * (range.max - range.min),
      })
      currentTime += config.interval
    }

    return records
  }
}
