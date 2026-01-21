// @dotdo/rpc - Cap'n Web RPC Layer
// Client/server for all communication: client→worker, worker→worker, worker→DO, DO→worker, DO→DO

// Re-export Hono's ContentfulStatusCode for type compatibility in consumers
export type { ContentfulStatusCode } from 'hono/utils/http-status'

export * from './client'
export * from './server'
export * from './pipeline'
export * from './batch'
export * from './batch-rpc'
export * from './errors'
export * from './logging'
export * from './cross-do'
export * from './types'
export * from './typed-client'
export * from './validation'
export * from './rate-limit'
export * from './headers'

// Transport layer
export * from './transport'
