/**
 * Adapter - Protocol Translation Layer
 *
 * Meta-abstraction that declaratively maps external APIs to internal primitives.
 * Makes compat layers trivial to write - new adapters are typically <200 LOC.
 *
 * Usage:
 * ```typescript
 * const stripeAdapter = Adapter.create({
 *   source: externalStripeProtocol,
 *   target: internalPaymentsProtocol,
 * })
 *   .mapOperation('charges.create', 'payments.process', {
 *     request: (stripe) => ({ amount: stripe.amount, currency: stripe.currency }),
 *     response: (internal) => ({ id: `ch_${internal.id}`, status: internal.state }),
 *   })
 *   .mapType('stripe.customer', 'internal.user', {
 *     toInternal: (c) => ({ id: c.id, email: c.email }),
 *     toExternal: (u) => ({ id: u.id, email: u.email, object: 'customer' }),
 *   })
 *   .mapError((err) => ({
 *     type: 'card_error',
 *     code: err.code,
 *     message: err.message,
 *   }))
 *   .webhooks({
 *     'payment_intent.succeeded': 'payments.completed',
 *     'payment_intent.failed': 'payments.failed',
 *   })
 *   .build()
 * ```
 */

import type { ProtocolInstance } from '../protocol/types'
import type {
  AdapterBuilder,
  AdapterConfig,
  AdapterMappings,
  CompiledAdapter,
  ErrorMapper,
  ExternalError,
  InternalError,
  OperationTransform,
  TypeCoercion,
  WebhookConfig,
  WebhookEvent,
  WebhookResult,
} from './types'

export * from './types'

// =============================================================================
// Adapter Builder Implementation
// =============================================================================

/**
 * Internal state for the adapter builder
 */
interface AdapterBuilderState<
  TExternal extends ProtocolInstance<any, any>,
  TInternal extends ProtocolInstance<any, any>,
> {
  source: TExternal
  target: TInternal
  operations: Map<string, { internal: string; transform: OperationTransform }>
  types: Map<string, { internal: string; coercion: TypeCoercion }>
  webhooks: Map<string, string>
  errorMapper: ErrorMapper | null
}

/**
 * Create an adapter builder instance
 */
function createAdapterBuilder<
  TExternal extends ProtocolInstance<any, any>,
  TInternal extends ProtocolInstance<any, any>,
>(config: AdapterConfig<TExternal, TInternal>): AdapterBuilder<TExternal, TInternal> {
  const state: AdapterBuilderState<TExternal, TInternal> = {
    source: config.source,
    target: config.target,
    operations: new Map(),
    types: new Map(),
    webhooks: new Map(),
    errorMapper: null,
  }

  const builder: AdapterBuilder<TExternal, TInternal> = {
    get source() {
      return state.source
    },

    get target() {
      return state.target
    },

    mapOperation(
      external: string,
      internal: string,
      transform?: OperationTransform
    ): AdapterBuilder<TExternal, TInternal> {
      state.operations.set(external, {
        internal,
        transform: transform ?? {},
      })
      return builder
    },

    mapType(
      external: string,
      internal: string,
      coercion: TypeCoercion
    ): AdapterBuilder<TExternal, TInternal> {
      state.types.set(external, {
        internal,
        coercion,
      })
      return builder
    },

    mapError(handler: ErrorMapper): AdapterBuilder<TExternal, TInternal> {
      state.errorMapper = handler
      return builder
    },

    webhooks(config: WebhookConfig): AdapterBuilder<TExternal, TInternal> {
      for (const [external, internal] of Object.entries(config)) {
        state.webhooks.set(external, internal)
      }
      return builder
    },

    build(): CompiledAdapter<TExternal, TInternal> {
      return createCompiledAdapter(state)
    },
  }

  return builder
}

// =============================================================================
// Compiled Adapter Implementation
// =============================================================================

/**
 * Create a compiled adapter from the builder state
 */
function createCompiledAdapter<
  TExternal extends ProtocolInstance<any, any>,
  TInternal extends ProtocolInstance<any, any>,
>(state: AdapterBuilderState<TExternal, TInternal>): CompiledAdapter<TExternal, TInternal> {
  // Clone the state to make it immutable
  const compiledOperations = new Map(state.operations)
  const compiledTypes = new Map(state.types)
  const compiledWebhooks = new Map(state.webhooks)
  const compiledErrorMapper = state.errorMapper

  // Cache configured internal protocol for execution
  let configuredInternal: any = null

  return {
    get source() {
      return state.source
    },

    get target() {
      return state.target
    },

    async execute<K extends string>(
      operation: K,
      input: unknown
    ): Promise<unknown> {
      const mapping = compiledOperations.get(operation)
      if (!mapping) {
        throw new Error(`Operation '${operation}' is not mapped in this adapter`)
      }

      // Get or configure the internal protocol
      if (!configuredInternal) {
        configuredInternal = state.target.configure({})
        await configuredInternal.connect()
      }

      // Transform request if needed
      let transformedInput = input
      if (mapping.transform.request) {
        transformedInput = await mapping.transform.request(input)
      }

      // Execute the internal operation
      const internalOp = configuredInternal.operations[mapping.internal]
      if (!internalOp) {
        throw new Error(`Internal operation '${mapping.internal}' not found`)
      }

      const result = await internalOp(transformedInput)

      // Transform response if needed
      if (mapping.transform.response) {
        return mapping.transform.response(result)
      }

      return result
    },

    async handleWebhook(event: WebhookEvent): Promise<WebhookResult | null> {
      const internalEvent = compiledWebhooks.get(event.type)
      if (!internalEvent) {
        return null
      }

      return {
        internalEvent,
        data: event.data,
      }
    },

    async coerceToInternal<T>(typeName: string, value: unknown): Promise<T> {
      const mapping = compiledTypes.get(typeName)
      if (!mapping) {
        throw new Error(`Unknown type '${typeName}' - no mapping defined`)
      }

      return mapping.coercion.toInternal(value) as Promise<T>
    },

    async coerceToExternal<T>(typeName: string, value: unknown): Promise<T> {
      const mapping = compiledTypes.get(typeName)
      if (!mapping) {
        throw new Error(`Unknown type '${typeName}' - no mapping defined`)
      }

      return mapping.coercion.toExternal(value) as Promise<T>
    },

    translateError(error: InternalError): ExternalError {
      if (compiledErrorMapper) {
        return compiledErrorMapper(error)
      }

      // Default pass-through
      return {
        code: error.code,
        message: error.message,
      }
    },

    getMappings(): AdapterMappings {
      return {
        operations: new Map(compiledOperations),
        types: new Map(compiledTypes),
        webhooks: new Map(compiledWebhooks),
        errorMapper: compiledErrorMapper,
      }
    },
  }
}

// =============================================================================
// Adapter Factory
// =============================================================================

/**
 * Adapter factory with static methods
 */
export const Adapter = {
  /**
   * Create a new adapter builder
   *
   * @param config - Source and target protocols to adapt between
   * @returns An AdapterBuilder for chaining mapping configurations
   *
   * @example
   * ```typescript
   * const adapter = Adapter.create({
   *   source: stripeProtocol,
   *   target: paymentsProtocol,
   * })
   *   .mapOperation('charges.create', 'payments.process')
   *   .build()
   * ```
   */
  create<
    TExternal extends ProtocolInstance<any, any>,
    TInternal extends ProtocolInstance<any, any>,
  >(config: AdapterConfig<TExternal, TInternal>): AdapterBuilder<TExternal, TInternal> {
    return createAdapterBuilder(config)
  },
}
