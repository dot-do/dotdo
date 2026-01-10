/**
 * TanStack DB integration for dotdo
 *
 * Provides WebSocket sync and Cap'n Web RPC for real-time data synchronization
 * between TanStack DB clients and dotdo backends.
 *
 * @module db/tanstack
 *
 * @example
 * ```ts
 * import { dotdoCollectionOptions, createSyncClient, createRPCClient } from '@/db/tanstack'
 *
 * // Create collection options for TanStack DB
 * const taskCollection = dotdoCollectionOptions({ name: 'Task' })
 *
 * // WebSocket real-time sync
 * const syncClient = createSyncClient({ url: 'wss://api.example.com/sync' })
 *
 * // RPC for mutations with promise pipelining
 * const rpcClient = createRPCClient({ url: 'https://api.example.com/rpc' })
 * ```
 */

// Protocol types and utilities (shared between client and server)
export * from './protocol'

// Collection options for TanStack DB integration
export * from './collection'

// WebSocket sync client
export * from './sync-client'

// Cap'n Web RPC client
export * from './rpc'
