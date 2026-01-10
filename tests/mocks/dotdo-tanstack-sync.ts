/**
 * Mock for @dotdo/tanstack/sync module
 *
 * This stub provides the basic interface for dotdo sync engine.
 * Tests can override this with vi.mock() for specific test behavior.
 */

export type SyncStatus = 'syncing' | 'synced' | 'offline'

export interface SyncEngine {
  connect: () => Promise<void>
  disconnect: () => void
  sync: () => Promise<void>
  onStatusChange: (callback: (status: SyncStatus) => void) => () => void
  getStatus: () => SyncStatus
}

/**
 * Creates a mock sync engine instance
 */
export function createSyncEngine(): SyncEngine {
  let currentStatus: SyncStatus = 'offline'
  const listeners = new Set<(status: SyncStatus) => void>()

  return {
    connect: async () => {
      currentStatus = 'synced'
      listeners.forEach((cb) => cb(currentStatus))
    },
    disconnect: () => {
      currentStatus = 'offline'
      listeners.forEach((cb) => cb(currentStatus))
    },
    sync: async () => {
      currentStatus = 'syncing'
      listeners.forEach((cb) => cb(currentStatus))
      await new Promise((resolve) => setTimeout(resolve, 10))
      currentStatus = 'synced'
      listeners.forEach((cb) => cb(currentStatus))
    },
    onStatusChange: (callback: (status: SyncStatus) => void) => {
      listeners.add(callback)
      return () => {
        listeners.delete(callback)
      }
    },
    getStatus: () => currentStatus,
  }
}
