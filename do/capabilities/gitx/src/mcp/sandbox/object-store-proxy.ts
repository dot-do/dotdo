/**
 * @fileoverview Object Store Proxy for Sandbox Execution
 *
 * Provides controlled access to the git object store within sandboxed code.
 */

/**
 * Interface for object stores that the proxy can wrap.
 * This abstracts the actual storage implementation (R2, SQLite, etc.)
 */
export interface ObjectStoreLike {
  getObject(sha: string): Promise<{ type: string; data: Uint8Array } | null>
  putObject(type: string, data: Uint8Array): Promise<string>
  listObjects(options?: { type?: string; limit?: number }): Promise<string[]>
}

export interface ObjectStoreAccess {
  getProxy(): ObjectStoreProxy
  getObject(sha: string): Promise<{ type: string; data: Uint8Array } | null>
  putObject(type: string, data: Uint8Array): Promise<string>
  listObjects(options?: { type?: string; limit?: number }): Promise<string[]>
}

export class ObjectStoreProxy {
  constructor(private objectStore: ObjectStoreLike) {}

  async getObject(sha: string): Promise<{ type: string; data: Uint8Array } | null> {
    return this.objectStore.getObject(sha)
  }

  async putObject(type: string, data: Uint8Array): Promise<string> {
    return this.objectStore.putObject(type, data)
  }

  async listObjects(options?: { type?: string; limit?: number }): Promise<string[]> {
    return this.objectStore.listObjects(options)
  }
}

export function createObjectStoreAccess(objectStore: ObjectStoreLike): ObjectStoreAccess {
  const proxy = new ObjectStoreProxy(objectStore)
  return {
    getProxy: () => proxy,
    getObject: (sha: string) => proxy.getObject(sha),
    putObject: (type: string, data: Uint8Array) => proxy.putObject(type, data),
    listObjects: (options?: { type?: string; limit?: number }) => proxy.listObjects(options),
  }
}
