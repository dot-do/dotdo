/**
 * @fileoverview Worker Loader Types
 *
 * This module defines types for loading and interacting with Cloudflare Workers
 * in the gitdo environment. Based on patterns from mongo.do research.
 *
 * @module types/worker-loader
 */

/**
 * WorkerLoader interface for managing worker instances.
 */
export interface WorkerLoader {
  get(id: string, getCode: () => Promise<WorkerCode>): WorkerStub
}

/**
 * WorkerCode defines the configuration and modules for a worker.
 */
export interface WorkerCode {
  compatibilityDate: string
  compatibilityFlags?: string[]
  mainModule: string
  modules: Record<string, string | { js: string } | { text: string }>
  globalOutbound?: null
  env?: Record<string, unknown>
}

/**
 * WorkerStub provides methods to interact with a worker instance.
 */
export interface WorkerStub {
  fetch?(request: Request): Promise<Response>
  getEntrypoint?(name?: string): WorkerEntrypoint
}

/**
 * WorkerEntrypoint represents a worker's entrypoint.
 */
export interface WorkerEntrypoint {
  fetch(request: Request): Promise<Response>
}

/**
 * Internal marker symbol for identifying real Cloudflare worker loaders.
 */
const REAL_WORKER_LOADER_MARKER = Symbol.for('cloudflare.worker_loader')

/**
 * MockWorkerLoader provides a mock implementation of the WorkerLoader interface
 * for testing purposes. It caches WorkerStubs by ID.
 */
export class MockWorkerLoader implements WorkerLoader {
  private cache = new Map<string, WorkerStub>()

  get(id: string, _getCode: () => Promise<WorkerCode>): WorkerStub {
    const cached = this.cache.get(id)
    if (cached) {
      return cached
    }

    const stub: WorkerStub = {
      fetch: async (_request: Request): Promise<Response> => {
        return new Response('MockWorkerLoader response')
      },
      getEntrypoint: (_name?: string): WorkerEntrypoint => {
        return {
          fetch: async (_request: Request): Promise<Response> => {
            return new Response('MockWorkerLoader entrypoint response')
          }
        }
      }
    }

    this.cache.set(id, stub)
    return stub
  }
}

/**
 * Type guard to check if a loader is a real Cloudflare worker loader.
 * Returns false for MockWorkerLoader instances, null, undefined, or non-WorkerLoader objects.
 * Returns true only for real Cloudflare worker_loaders that have the internal marker.
 *
 * @param loader - The loader to check
 * @returns true if the loader is a real Cloudflare worker loader
 */
export function isRealWorkerLoader(loader: unknown): loader is WorkerLoader {
  if (loader === null || loader === undefined) {
    return false
  }

  if (loader instanceof MockWorkerLoader) {
    return false
  }

  if (typeof loader !== 'object') {
    return false
  }

  // Check for the internal marker that real Cloudflare worker loaders would have
  const obj = loader as Record<string | symbol, unknown>
  return obj[REAL_WORKER_LOADER_MARKER] === true
}
