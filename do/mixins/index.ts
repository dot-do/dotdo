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
  type MixinInstance,
  type HasDurableObjectState,
  type HasEnv
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
 * Generic mixin function type.
 * Represents a function that takes a constructor and returns an extended constructor.
 * Uses `unknown` for the base parameter to be as permissive as possible while maintaining type safety.
 *
 * @template TReturn - The return type of the mixin function
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MixinFn<TReturn = any> = (base: Constructor<any>) => TReturn

/**
 * Type helper for inferring the composed class type from multiple mixins.
 * Combines the return types of up to 4 mixin functions.
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
  T1 extends MixinFn,
  T2 extends MixinFn = MixinFn<Constructor>,
  T3 extends MixinFn = MixinFn<Constructor>,
  T4 extends MixinFn = MixinFn<Constructor>
> = ReturnType<T1> & ReturnType<T2> & ReturnType<T3> & ReturnType<T4>

/**
 * Utility type to get the instance type of a composed mixin.
 * Uses `unknown[]` for args where possible but falls back to `any[]` for inference.
 *
 * @example
 * ```typescript
 * const MyDO = WithRPC(WithStorage(BaseDO))
 * type MyDOInstance = InstanceOf<typeof MyDO>
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type InstanceOf<T> = T extends new (...args: any[]) => infer R ? R : never

/**
 * Helper type to ensure a class has the required mixin capabilities.
 * Use this to type-check that a composed class has specific features.
 *
 * @example
 * ```typescript
 * function requiresStorage<T extends HasStorage>(instance: T) {
 *   return instance.things.list()
 * }
 * ```
 */
export type RequiresMixin<T, M> = T extends M ? T : never
