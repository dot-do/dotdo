/**
 * Mock for cloudflare:workers module
 *
 * This mock allows tests to import modules that depend on cloudflare:workers
 * without requiring the actual Cloudflare Workers runtime.
 */

/**
 * Mock DurableObject base class for Node.js tests
 */
export class DurableObject<E = unknown> {
  protected ctx: DurableObjectState
  protected env: E

  constructor(ctx: DurableObjectState, env: E) {
    this.ctx = ctx
    this.env = env
  }

  fetch(request: Request): Response | Promise<Response> {
    return new Response('Not implemented', { status: 501 })
  }

  alarm?(): void | Promise<void>

  webSocketMessage?(ws: WebSocket, message: string | ArrayBuffer): void | Promise<void>

  webSocketClose?(ws: WebSocket, code: number, reason: string, wasClean: boolean): void | Promise<void>

  webSocketError?(ws: WebSocket, error: unknown): void | Promise<void>
}

/**
 * Mock DurableObjectState
 */
export interface DurableObjectState {
  id: DurableObjectId
  storage: DurableObjectStorage
  waitUntil(promise: Promise<unknown>): void
  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>
}

/**
 * Mock DurableObjectId
 */
export interface DurableObjectId {
  toString(): string
  equals(other: DurableObjectId): boolean
  name?: string
}

/**
 * Mock DurableObjectStorage
 */
export interface DurableObjectStorage {
  get<T = unknown>(key: string): Promise<T | undefined>
  get<T = unknown>(keys: string[]): Promise<Map<string, T>>
  list<T = unknown>(options?: DurableObjectListOptions): Promise<Map<string, T>>
  put<T>(key: string, value: T): Promise<void>
  put<T>(entries: Record<string, T>): Promise<void>
  delete(key: string): Promise<boolean>
  delete(keys: string[]): Promise<number>
  deleteAll(): Promise<void>
  sql: SqlStorage
}

/**
 * Mock SqlStorage
 */
export interface SqlStorage {
  exec(query: string, ...params: unknown[]): SqlStorageCursor
}

/**
 * Mock SqlStorageCursor
 */
export interface SqlStorageCursor {
  toArray(): unknown[]
  one(): unknown
  raw(): unknown[]
}

/**
 * Mock DurableObjectListOptions
 */
export interface DurableObjectListOptions {
  start?: string
  startAfter?: string
  end?: string
  prefix?: string
  reverse?: boolean
  limit?: number
}

/**
 * Mock DurableObjectNamespace
 */
export interface DurableObjectNamespace<T = DurableObject> {
  idFromName(name: string): DurableObjectId
  idFromString(id: string): DurableObjectId
  newUniqueId(options?: { jurisdiction?: string }): DurableObjectId
  get(id: DurableObjectId): DurableObjectStub<T>
}

/**
 * Mock DurableObjectStub
 */
export interface DurableObjectStub<T = DurableObject> {
  id: DurableObjectId
  fetch(input: RequestInfo, init?: RequestInit): Promise<Response>
}

/**
 * Mock RpcStub and RpcTarget for RPC support
 */
export class RpcStub {
  // Stub class for RPC
}

export class RpcTarget {
  // Target class for RPC
}

/**
 * Export everything needed by DO.ts and other files
 */
export default {
  DurableObject,
  RpcStub,
  RpcTarget,
}
