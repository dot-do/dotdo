import { CostMetrics } from './types'

// DO billing constants
const WRITE_COST_PER_MILLION = 1.0      // $1 per million row writes
const READ_COST_PER_MILLION = 0.001     // $0.001 per million row reads
const STORAGE_COST_PER_GB = 0.20        // $0.20 per GB

export { CostMetrics }

export class CostTracker {
  private _rowWrites = 0
  private _rowReads = 0
  private _storageBytes = 0

  get rowWrites(): number {
    return this._rowWrites
  }

  get rowReads(): number {
    return this._rowReads
  }

  get storageBytes(): number {
    return this._storageBytes
  }

  get storageGb(): number {
    return this._storageBytes / (1024 * 1024 * 1024)
  }

  get estimatedCost(): number {
    const writeCost = (this._rowWrites / 1_000_000) * WRITE_COST_PER_MILLION
    const readCost = (this._rowReads / 1_000_000) * READ_COST_PER_MILLION
    const storageCost = this.storageGb * STORAGE_COST_PER_GB
    return writeCost + readCost + storageCost
  }

  trackWrite(count: number): void {
    this._rowWrites += count
  }

  trackRead(count: number): void {
    this._rowReads += count
  }

  trackStorage(bytes: number): void {
    this._storageBytes = bytes
  }

  reset(): void {
    this._rowWrites = 0
    this._rowReads = 0
    this._storageBytes = 0
  }

  toMetrics(): CostMetrics {
    const writeCost = (this._rowWrites / 1_000_000) * WRITE_COST_PER_MILLION
    const readCost = (this._rowReads / 1_000_000) * READ_COST_PER_MILLION
    const storageCost = this.storageGb * STORAGE_COST_PER_GB

    return {
      rowWrites: this._rowWrites,
      rowReads: this._rowReads,
      storageBytes: this._storageBytes,
      storageGb: this.storageGb,
      estimatedCost: this.estimatedCost,
      breakdown: {
        writeCost,
        readCost,
        storageCost
      }
    }
  }

  wrap<T extends { exec: (sql: string) => any }>(db: T): T {
    const self = this
    return new Proxy(db, {
      get(target, prop) {
        if (prop === 'exec') {
          return (sql: string) => {
            const result = target.exec(sql)
            if (sql.toUpperCase().includes('INSERT') ||
                sql.toUpperCase().includes('UPDATE') ||
                sql.toUpperCase().includes('DELETE')) {
              self.trackWrite(result?.changes || 1)
            }
            if (sql.toUpperCase().includes('SELECT')) {
              self.trackRead(result?.rows?.length || 0)
            }
            return result
          }
        }
        return (target as any)[prop]
      }
    }) as T
  }
}
