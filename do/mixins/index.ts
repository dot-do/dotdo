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
 * Mixin function type for composing class capabilities.
 * This generic represents a function that takes a base class and returns an extended class.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MixinFunction<TBase = unknown, TResult = unknown> = (base: TBase) => TResult

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
  T1 extends MixinFunction,
  T2 extends MixinFunction = MixinFunction,
  T3 extends MixinFunction = MixinFunction,
  T4 extends MixinFunction = MixinFunction
> = ReturnType<T1> & ReturnType<T2> & ReturnType<T3> & ReturnType<T4>

/**
 * Utility type to get the instance type of a composed mixin.
 *
 * This type safely extracts the instance type from any constructor,
 * with proper constraints to ensure T is a valid constructor type.
 *
 * @template T - A constructor type (constrained to ensure type safety)
 *
 * @example
 * ```typescript
 * const MyDO = WithRPC(WithStorage(BaseDO))
 * type MyDOInstance = InstanceOf<typeof MyDO>
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type InstanceOf<T extends new (...args: any[]) => any> =
  T extends new (...args: any[]) => infer R ? R : never
