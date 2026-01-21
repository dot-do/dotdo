/**
 * DO Handler Infrastructure
 *
 * This module provides a composition-based architecture for the DO class.
 * Instead of having all responsibilities in one "God Object", the DO class
 * delegates to specialized handlers:
 *
 * - StorageHandler: Entity management (things, events, relationships)
 * - RPCHandler: RPC endpoint handling (/rpc, /rpc/batch)
 * - AlarmHandler: Alarm management and scheduling
 * - WebSocketHandler: WebSocket connection management
 *
 * The DO class acts as a facade that coordinates these handlers.
 *
 * @module do/handlers
 */

export { StorageHandler, type StorageHandlerOptions } from './storage'
export { RPCHandler, type RPCHandlerOptions, type RPCContext } from './rpc'
export { AlarmHandler, type AlarmHandlerOptions } from './alarm'
export { WebSocketHandler, type WebSocketHandlerOptions } from './websocket'
export { DOHandlerRegistry, type DOHandlerRegistryOptions, type DOHandler } from './registry'
