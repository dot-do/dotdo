/**
 * @dotdo/core/rpc - RPC Client for Durable Objects
 *
 * This module exports the client-side RPC functionality for connecting to
 * dotdo Durable Objects. Features:
 *
 * - Promise Pipelining - Chain calls without round-trips
 * - WebSocket RPC - Bidirectional communication with callbacks
 * - Capability-based Security - Unforgeable references with attenuation
 * - Type-safe Remote Execution - RPC calls are type-checked
 *
 * @example
 * ```typescript
 * import { createRPCClient, pipeline } from '@dotdo/core/rpc'
 *
 * // Create type-safe client
 * const customer = createRPCClient<CustomerDO>({
 *   target: stub, // DurableObjectStub or URL
 * })
 *
 * // Direct calls
 * const orders = await customer.getOrders()
 *
 * // Promise pipelining - single round-trip
 * const total = await pipeline(customer)
 *   .then('getOrders')
 *   .then('reduce', (sum: number, o: Order) => sum + o.total, 0)
 *   .execute()
 * ```
 *
 * @module @dotdo/core/rpc
 */

// ============================================================================
// RPC Client - Type-safe proxy with promise pipelining
// ============================================================================

export {
  createRPCClient,
  pipeline,
  RPCError,
  RPCErrorCodes,
  sendRPCRequest,
} from '../../rpc/proxy'

export type {
  Schema,
  FieldSchema,
  MethodSchema,
  ParamSchema,
  MethodDescriptor,
  MetaInterface,
  PipelineBuilder,
  PipelineStep,
  RPCClientOptions,
  RPCErrorCode,
  RPCRequest,
  RPCResponse,
} from '../../rpc/proxy'

// ============================================================================
// WebSocket RPC - Bidirectional communication with hibernation support
// ============================================================================

export {
  WebSocketRpcClient,
  WebSocketRpcHandler,
  generateMessageId,
  generateCallbackId,
  isCallbackStub,
} from '../../rpc/websocket-rpc'

export type {
  RpcMessage,
  CallbackStub,
  WebSocketRpcOptions,
} from '../../rpc/websocket-rpc'

// ============================================================================
// Serialization - JSON and binary formats
// ============================================================================

export { serialize, deserialize } from '../../rpc/transport'
export type { SerializationOptions, TypeHandler } from '../../rpc/transport'

// ============================================================================
// Capabilities - Unforgeable references with attenuation
// ============================================================================

export {
  createCapability,
  verifyCapability,
  assertUnforgeable,
  serializeCapability,
  deserializeCapability,
} from '../../rpc/capability'

export type { Capability } from '../../rpc/capability'

// ============================================================================
// Capability Tokens - HMAC-signed tokens for three-party handoff
// ============================================================================

export {
  createCapabilityToken,
  verifyCapabilityToken,
  attenuateCapability,
  isMethodAllowed,
  isScopeAllowed,
  CapabilityError,
} from '../../rpc/capability-token'

export type { CapabilityPayload, CapabilityErrorCode } from '../../rpc/capability-token'

// ============================================================================
// Negotiation - Protocol version and capability negotiation
// ============================================================================

export { createNegotiatingClient, createNegotiationHandler } from '../../rpc/negotiation'

export type {
  ProtocolVersion,
  CapabilityNegotiationRequest,
  CapabilityNegotiationResponse,
  CapabilitySchema,
  NegotiatedConnection,
  NegotiatingRPCClient,
  NegotiationHandler,
  NegotiatingClientOptions,
  NegotiationHandlerOptions,
} from '../../rpc/negotiation'

// ============================================================================
// Interface Generation - Generate RPC interfaces from DO classes
// ============================================================================

export { generateInterface } from '../../rpc/interface'
export type { InterfaceGeneratorOptions, GeneratedInterface } from '../../rpc/interface'
