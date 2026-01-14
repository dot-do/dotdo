/**
 * dotdo Client SDK - Cap'n Web RPC Client
 *
 * This module re-exports from @dotdo/client for backwards compatibility.
 * The canonical implementation is now in packages/client.
 *
 * @deprecated Import from '@dotdo/client' instead of 'dotdo/sdk/client'
 * @module sdk/client
 */

// Re-export everything from @dotdo/client
export {
  // Main exports
  $,
  $Context,
  configure,
  // Session management
  disposeSession,
  disposeAllSessions,
  // Legacy exports for backwards compatibility
  createClient,
  // Types
  type ChainStep,
  type RpcError,
  type RpcPromise,
  type RpcClient,
  type SdkConfig,
  type DOClient,
  type ClientConfig,
  type ConnectionState,
  type ReconnectConfig,
  type AuthConfig,
  type RPCError,
  type SubscriptionHandle,
  type PipelineStep,
} from '@dotdo/client'

// Default export
export { default } from '@dotdo/client'
