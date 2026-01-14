/**
 * Adapter Types - Protocol Translation Layer
 *
 * Type definitions for the Adapter abstraction that declaratively maps
 * external APIs to internal primitives.
 */

import type { ProtocolInstance, ConfigSchema, OperationsMap, ConfiguredProtocol } from '../protocol/types'

// =============================================================================
// Transform Function Types
// =============================================================================

/** Transform request from external to internal format */
export type RequestTransform<TExtReq, TIntReq> = (external: TExtReq) => TIntReq | Promise<TIntReq>

/** Transform response from internal to external format */
export type ResponseTransform<TIntRes, TExtRes> = (internal: TIntRes) => TExtRes | Promise<TExtRes>

/** Operation transform config */
export interface OperationTransform<TExtReq = unknown, TIntReq = unknown, TIntRes = unknown, TExtRes = unknown> {
  request?: RequestTransform<TExtReq, TIntReq>
  response?: ResponseTransform<TIntRes, TExtRes>
}

// =============================================================================
// Type Coercion Types
// =============================================================================

/** Bidirectional type coercion */
export interface TypeCoercion<TExternal = unknown, TInternal = unknown> {
  toInternal: (external: TExternal) => TInternal | Promise<TInternal>
  toExternal: (internal: TInternal) => TExternal | Promise<TExternal>
}

/** Type definition for mapping */
export interface TypeDef<T = unknown> {
  name: string
  schema?: Record<string, unknown>
}

// =============================================================================
// Error Mapping Types
// =============================================================================

/** Error that occurred in the internal protocol */
export interface InternalError {
  code?: string
  message: string
  details?: unknown
}

/** Mapped external error */
export interface ExternalError {
  type?: string
  code?: string
  message: string
  [key: string]: unknown
}

/** Error mapper function */
export type ErrorMapper = (error: InternalError) => ExternalError

// =============================================================================
// Webhook Types
// =============================================================================

/** Webhook routing configuration */
export type WebhookConfig = Record<string, string>

/** Webhook event */
export interface WebhookEvent {
  type: string
  data: unknown
}

/** Webhook handler result */
export interface WebhookResult {
  internalEvent: string
  data: unknown
}

// =============================================================================
// Compiled Adapter Types
// =============================================================================

/** Compiled adapter that efficiently routes operations */
export interface CompiledAdapter<
  TExternal extends ProtocolInstance<any, any> = ProtocolInstance<any, any>,
  TInternal extends ProtocolInstance<any, any> = ProtocolInstance<any, any>,
> {
  /** Source protocol (external API) */
  readonly source: TExternal

  /** Target protocol (internal primitives) */
  readonly target: TInternal

  /** Execute an external operation through the adapter */
  execute<K extends string>(
    operation: K,
    input: unknown
  ): Promise<unknown>

  /** Handle an incoming webhook event */
  handleWebhook(event: WebhookEvent): Promise<WebhookResult | null>

  /** Coerce a type from external to internal format */
  coerceToInternal<T>(typeName: string, value: unknown): Promise<T>

  /** Coerce a type from internal to external format */
  coerceToExternal<T>(typeName: string, value: unknown): Promise<T>

  /** Translate an error from internal to external format */
  translateError(error: InternalError): ExternalError

  /** Get mapping metadata */
  getMappings(): AdapterMappings
}

/** Adapter mappings metadata */
export interface AdapterMappings {
  operations: Map<string, { internal: string; transform: OperationTransform }>
  types: Map<string, { internal: string; coercion: TypeCoercion }>
  webhooks: Map<string, string>
  errorMapper: ErrorMapper | null
}

// =============================================================================
// Adapter Builder Types
// =============================================================================

/** Adapter builder interface */
export interface AdapterBuilder<
  TExternal extends ProtocolInstance<any, any> = ProtocolInstance<any, any>,
  TInternal extends ProtocolInstance<any, any> = ProtocolInstance<any, any>,
> {
  /** Source protocol */
  readonly source: TExternal

  /** Target protocol */
  readonly target: TInternal

  /** Map an external operation to an internal operation */
  mapOperation(
    external: string,
    internal: string,
    transform?: OperationTransform
  ): this

  /** Map an external type to an internal type with bidirectional coercion */
  mapType(
    external: string,
    internal: string,
    coercion: TypeCoercion
  ): this

  /** Set the error mapper */
  mapError(handler: ErrorMapper): this

  /** Configure webhook routing */
  webhooks(config: WebhookConfig): this

  /** Compile the adapter into an efficient runtime */
  build(): CompiledAdapter<TExternal, TInternal>
}

// =============================================================================
// Adapter Creation Config
// =============================================================================

/** Configuration for Adapter.create() */
export interface AdapterConfig<
  TExternal extends ProtocolInstance<any, any> = ProtocolInstance<any, any>,
  TInternal extends ProtocolInstance<any, any> = ProtocolInstance<any, any>,
> {
  source: TExternal
  target: TInternal
}
