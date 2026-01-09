/**
 * StepDOBridge - Bridges workflow step execution to Durable Objects
 *
 * Provides the $ proxy pattern for calling DO methods from workflow steps:
 *
 * ```typescript
 * workflow.step('createUser', async (ctx) => {
 *   const user = await ctx.$.Users('user-123').create({ name: 'John' })
 *   await ctx.$.Notifications('user-123').send({ message: 'Welcome!' })
 *   return { userId: user.id }
 * })
 * ```
 *
 * The bridge:
 * - Maps $.Noun(id) to DurableObjectNamespace.get(id)
 * - Proxies method calls to DO.fetch() with JSON-RPC style payloads
 * - Handles responses and errors from DOs
 */

// ============================================================================
// TYPES
// ============================================================================

/**
 * Durable Object stub interface (matches Cloudflare Workers types)
 */
export interface DOStub {
  fetch(request: Request): Promise<Response>
}

/**
 * Durable Object namespace binding interface
 */
export interface DONamespaceBinding {
  idFromName(name: string): DurableObjectId
  idFromString(str: string): DurableObjectId
  get(id: DurableObjectId): DOStub
}

/**
 * Domain proxy type - returned by createProxy()
 * $.Noun(id).method(...args) style calls
 */
export interface DomainProxy {
  [Noun: string]: (id: string) => MethodProxy
}

/**
 * Method proxy - returned by $.Noun(id)
 * Allows calling any method on the resolved DO
 */
export interface MethodProxy {
  [method: string]: (...args: unknown[]) => Promise<unknown>
}

/**
 * Error thrown when DO call fails
 */
export class DOCallError extends Error {
  readonly noun: string
  readonly id: string
  readonly method: string
  readonly originalError?: { message: string; name: string }

  constructor(
    noun: string,
    id: string,
    method: string,
    message: string,
    originalError?: { message: string; name: string },
  ) {
    super(message)
    this.name = originalError?.name || 'DOCallError'
    this.noun = noun
    this.id = id
    this.method = method
    this.originalError = originalError
  }
}

// ============================================================================
// STEP DO BRIDGE
// ============================================================================

export class StepDOBridge {
  private readonly namespaces: Record<string, DONamespaceBinding>

  /**
   * Create a new StepDOBridge with DO namespace bindings.
   *
   * @param namespaces - Map of noun names to DurableObjectNamespace bindings
   *
   * @example
   * ```typescript
   * const bridge = new StepDOBridge({
   *   Users: env.USERS,
   *   Orders: env.ORDERS,
   *   Notifications: env.NOTIFICATIONS,
   * })
   * ```
   */
  constructor(namespaces: Record<string, DONamespaceBinding>) {
    this.namespaces = namespaces
  }

  /**
   * Create a domain proxy for use in workflow step context.
   * Returns a proxy that supports $.Noun(id).method(...args) style calls.
   *
   * @returns Domain proxy object
   *
   * @example
   * ```typescript
   * const $ = bridge.createProxy()
   * const user = await $.Users('user-123').create({ name: 'John' })
   * ```
   */
  createProxy(): DomainProxy {
    const self = this

    return new Proxy({} as DomainProxy, {
      get(_, noun: string) {
        // Return a function that takes an ID and returns a method proxy
        return (id: string) => self.createMethodProxy(noun, id)
      },
    })
  }

  /**
   * Create a method proxy for a specific DO instance.
   * This proxy intercepts method calls and routes them to the DO.
   */
  private createMethodProxy(noun: string, id: string): MethodProxy {
    const self = this

    return new Proxy({} as MethodProxy, {
      get(_, method: string) {
        // Return an async function that calls the DO method
        return async (...args: unknown[]) => {
          return self.callDOMethod(noun, id, method, args)
        }
      },
    })
  }

  /**
   * Call a method on a Durable Object.
   *
   * @param noun - The DO type/noun name (e.g., 'Users', 'Orders')
   * @param id - The DO instance ID
   * @param method - The method name to call
   * @param args - Arguments to pass to the method
   * @returns The method result
   * @throws DOCallError if the call fails
   */
  private async callDOMethod(noun: string, id: string, method: string, args: unknown[]): Promise<unknown> {
    // Get the namespace binding
    const namespace = this.namespaces[noun]
    if (!namespace) {
      throw new DOCallError(
        noun,
        id,
        method,
        `DO namespace '${noun}' is not registered. Available namespaces: ${Object.keys(this.namespaces).join(', ')}`,
      )
    }

    // Get the DO stub
    const doId = namespace.idFromName(id)
    const stub = namespace.get(doId)

    // Build the request
    // We use a POST request with the method in the path and args in the body
    const url = `https://do.internal/${method}`
    const body = args.length === 1 ? args[0] : args.length > 0 ? args : undefined

    const request = new Request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })

    // Call the DO
    let response: Response
    try {
      response = await stub.fetch(request)
    } catch (error) {
      throw new DOCallError(
        noun,
        id,
        method,
        `Failed to call ${noun}(${id}).${method}(): ${error instanceof Error ? error.message : String(error)}`,
      )
    }

    // Parse the response
    let data: { result?: unknown; error?: { message: string; name: string } }
    try {
      data = await response.json()
    } catch {
      throw new DOCallError(noun, id, method, `Invalid JSON response from ${noun}(${id}).${method}()`)
    }

    // Handle errors
    if (!response.ok || data.error) {
      const errorInfo = data.error || { message: `HTTP ${response.status}`, name: 'Error' }
      throw new DOCallError(noun, id, method, errorInfo.message, errorInfo)
    }

    return data.result
  }
}

export default StepDOBridge
