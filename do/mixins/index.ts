/**
 * DO Base Class Mixins
 *
 * Composable mixins for building Durable Objects with specific capabilities.
 * Use the TypeScript mixin pattern to compose features:
 *
 * @example
 * ```typescript
 * import { WithStorage, WithWebSocket, WithRPC, WithAuth } from '@dotdo/do/mixins'
 *
 * // Compose multiple capabilities
 * class MyDO extends WithAuth(
 *   WithRPC(
 *     WithWebSocket(
 *       WithStorage(BaseDO)
 *     )
 *   ),
 *   { secret: env.JWT_SECRET }
 * ) {
 *   // MyDO now has:
 *   // - this.things, this.events, this.relationships (from Storage)
 *   // - this.ws (from WebSocket)
 *   // - this.getDOStub() (from RPC)
 *   // - this.validateCaller(), this.canAccess() (from Auth)
 * }
 *
 * // Or compose selectively
 * class MinimalDO extends WithStorage(BaseDO) {
 *   // Just storage, no WebSocket/RPC/Auth overhead
 * }
 * ```
 *
 * @module do/mixins
 */

// =============================================================================
// Storage Mixin
// =============================================================================

export {
  WithStorage,
  type Constructor,
  type HasStorage,
  type WithStorageOptions,
  type MixinInstance
} from './storage'

// =============================================================================
// WebSocket Mixin
// =============================================================================

export {
  WithWebSocket,
  type HasWebSocket,
  type WithWebSocketOptions,
  // Re-exports from websocket.ts
  WebSocketManager,
  type WebSocketMessage,
  type WebSocketHandler,
  type BroadcastResult,
  type ConnectionMetadata,
  type ConnectionHandler
} from './websocket'

// =============================================================================
// RPC Mixin
// =============================================================================

export {
  WithRPC,
  type HasRPC,
  type WithRPCOptions,
  type RPCRequest,
  type RPCResponse,
  // Re-exports from workflow/rpc.ts
  createDOAccessor,
  createDORPCProxy,
  type DOStubProxy,
  type DOStubFactory,
  type CrossDORPCConfig,
  // Re-exports from rpc/errors.ts
  RPCError,
  NotFoundError,
  InternalError
} from './rpc'

// =============================================================================
// Auth Mixin
// =============================================================================

export {
  WithAuth,
  type HasAuth,
  type WithAuthOptions,
  // Re-exports from auth.ts
  createDOAuthGuard,
  extractCallerInfoWithVerification,
  extractCallerInfo,
  detectCallerType,
  verifyDOSignature,
  setDOInternalSecret,
  addDOSourceHeadersAsync,
  createDOToDoHeaders,
  addWorkerHeaders,
  type DOAuthGuard,
  type DOAuthGuardConfig,
  type CallerInfo,
  type CallerType,
  type AuthPayload,
  // Headers
  CF_WORKER_HEADER,
  WORKER_NAME_HEADER,
  DO_SOURCE_HEADER,
  DO_SOURCE_ID_HEADER,
  CORRELATION_ID_HEADER,
  INTERNAL_TRUST_HEADER,
  DO_SIGNATURE_HEADER,
  DO_TIMESTAMP_HEADER
} from './auth'

// =============================================================================
// Composition Helpers
// =============================================================================

/**
 * Type helper for inferring the composed class type from multiple mixins.
 *
 * @example
 * ```typescript
 * type MyDOType = ComposedType<
 *   typeof WithStorage,
 *   typeof WithWebSocket,
 *   typeof WithRPC
 * >
 * ```
 */
export type ComposedType<
  T1 extends (base: any) => any,
  T2 extends (base: any) => any = (base: any) => any,
  T3 extends (base: any) => any = (base: any) => any,
  T4 extends (base: any) => any = (base: any) => any
> = ReturnType<T1> & ReturnType<T2> & ReturnType<T3> & ReturnType<T4>

/**
 * Utility type to get the instance type of a composed mixin.
 *
 * @example
 * ```typescript
 * const MyDO = WithRPC(WithStorage(BaseDO))
 * type MyDOInstance = InstanceOf<typeof MyDO>
 * ```
 */
export type InstanceOf<T> = T extends new (...args: any[]) => infer R ? R : never
