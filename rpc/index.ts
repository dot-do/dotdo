/**
 * Cap'n Web RPC
 *
 * Capability-based RPC layer for dotdo v2
 *
 * Features:
 * - Interface Generation - Generate RPC interfaces from DO classes
 * - $meta Introspection - Runtime schema/method/capability discovery
 * - Promise Pipelining - Chain calls without round-trips
 * - Capability-based Security - Unforgeable references with attenuation
 * - Type-safe Remote Execution - RPC calls are type-checked
 * - Serialization - JSON and binary formats
 */

// Re-export from transport
export { serialize, deserialize } from './transport'
export type { SerializationOptions, TypeHandler } from './transport'

// Re-export from capability
export { createCapability, verifyCapability, assertUnforgeable, serializeCapability, deserializeCapability } from './capability'
export type { Capability } from './capability'

// Re-export from proxy
export { createRPCClient, pipeline, RPCError, RPCErrorCodes, sendRPCRequest } from './proxy'
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
} from './proxy'

// Re-export from interface
export { generateInterface } from './interface'
export type { InterfaceGeneratorOptions, GeneratedInterface } from './interface'

// Re-export from negotiation
export { createNegotiatingClient, createNegotiationHandler } from './negotiation'
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
} from './negotiation'

// Re-export from websocket-rpc - Bidirectional RPC over WebSocket with hibernation support
export {
  WebSocketRpcClient,
  WebSocketRpcHandler,
  generateMessageId,
  generateCallbackId,
  isCallbackStub,
} from './websocket-rpc'
export type {
  RpcMessage,
  CallbackStub,
  WebSocketRpcOptions,
} from './websocket-rpc'
