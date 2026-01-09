/**
 * DODispatcher - Route requests to the appropriate Durable Object
 *
 * Provides type-based routing from requests to DO instances.
 */

import { TypeRegistry } from './TypeRegistry'
import type { Env } from '../objects/DO'

/**
 * Result of resolving a request to a DO
 */
export interface ResolveResult {
  namespace: string
  doClass: string
  doId: string
}

/**
 * DO stub interface
 */
interface DOStub {
  fetch(request: Request | string, init?: RequestInit): Promise<Response>
}

/**
 * DODispatcher - Routes requests to appropriate DOs based on type
 */
export class DODispatcher {
  constructor(
    private registry: TypeRegistry,
    private env: Env,
  ) {}

  /**
   * Resolve a request to DO class and ID
   */
  async resolve(request: Request): Promise<ResolveResult> {
    const url = new URL(request.url)
    const namespace = `${url.protocol}//${url.host}`

    // Check for X-DO-Type header first
    const headerType = request.headers.get('X-DO-Type')
    if (headerType) {
      if (!this.registry.has(headerType)) {
        throw new Error(`Unknown type: ${headerType}`)
      }

      // Extract ID from path (first segment after /)
      const pathParts = url.pathname.slice(1).split('/')
      const doId = pathParts[0] || ''

      return {
        namespace,
        doClass: headerType,
        doId,
      }
    }

    // Parse path: /{Type}/{id}
    const pathParts = url.pathname.slice(1).split('/')
    if (pathParts.length < 2) {
      throw new Error('Invalid path format: expected /{Type}/{id}')
    }

    const [doClass, doId] = pathParts

    // Validate the type is registered
    if (!this.registry.has(doClass)) {
      throw new Error(`Unknown type: ${doClass}`)
    }

    return {
      namespace,
      doClass,
      doId,
    }
  }

  /**
   * Get a DO stub for the request
   */
  async getStub(request: Request): Promise<DOStub> {
    const { doClass, doId, namespace } = await this.resolve(request)

    // Get the DO binding
    const metadata = this.registry.getMetadata(doClass)
    const binding = this.env[metadata.binding] as DurableObjectNamespace | undefined

    if (!binding) {
      throw new Error(`DO namespace binding not configured: ${metadata.binding}`)
    }

    // Create the DO ID from the lookup key
    const lookupKey = `${namespace}/${doClass}/${doId}`
    const id = binding.idFromName(lookupKey)

    return binding.get(id) as DOStub
  }
}

// Re-export TypeRegistry for convenience
export { TypeRegistry } from './TypeRegistry'
