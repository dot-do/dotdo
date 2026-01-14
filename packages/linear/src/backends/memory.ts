/**
 * In-Memory Backend for Linear Local Implementation
 *
 * Provides a simple Map-based storage with optional version history.
 * Perfect for testing without external dependencies.
 */

export interface TemporalEntry<T> {
  value: T
  timestamp: number
}

/**
 * Simple in-memory temporal store with version history
 */
export class MemoryTemporalStore<T> {
  private data: Map<string, TemporalEntry<T>[]> = new Map()
  private maxVersions: number

  constructor(options: { maxVersions?: number } = {}) {
    this.maxVersions = options.maxVersions ?? 50
  }

  async put(key: string, value: T, timestamp: number = Date.now()): Promise<void> {
    const history = this.data.get(key) ?? []
    history.push({ value, timestamp })

    // Keep only the last N versions
    if (history.length > this.maxVersions) {
      history.shift()
    }

    this.data.set(key, history)
  }

  async get(key: string): Promise<T | null> {
    const history = this.data.get(key)
    if (!history || history.length === 0) return null
    return history[history.length - 1].value
  }

  async getAsOf(key: string, timestamp: number): Promise<T | null> {
    const history = this.data.get(key)
    if (!history || history.length === 0) return null

    // Find the version at or before the timestamp
    let result: T | null = null
    for (const entry of history) {
      if (entry.timestamp <= timestamp) {
        result = entry.value
      } else {
        break
      }
    }
    return result
  }

  async getHistory(key: string): Promise<TemporalEntry<T>[]> {
    return this.data.get(key) ?? []
  }

  async delete(key: string): Promise<boolean> {
    return this.data.delete(key)
  }

  async *range(
    _prefix: string,
    _options: object
  ): AsyncIterableIterator<T> {
    for (const [_, history] of this.data) {
      if (history.length > 0) {
        yield history[history.length - 1].value
      }
    }
  }

  async clear(): Promise<void> {
    this.data.clear()
  }

  async keys(): Promise<string[]> {
    return Array.from(this.data.keys())
  }

  async size(): Promise<number> {
    return this.data.size
  }
}

/**
 * Factory function for creating a memory temporal store
 */
export function createTemporalStore<T>(options?: {
  maxVersions?: number
}): MemoryTemporalStore<T> {
  return new MemoryTemporalStore<T>(options)
}

/**
 * Simple event emitter for cycle window management
 */
export class SimpleEventEmitter<T> {
  private listeners: ((data: T) => void)[] = []

  on(listener: (data: T) => void): () => void {
    this.listeners.push(listener)
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener)
    }
  }

  emit(data: T): void {
    for (const listener of this.listeners) {
      listener(data)
    }
  }

  clear(): void {
    this.listeners = []
  }
}
