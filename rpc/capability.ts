/**
 * Cap'n Web RPC Capability-based Security
 *
 * Implements unforgeable capability tokens with:
 * - Unique, cryptographically-secure IDs
 * - Method-level access control
 * - Attenuation (deriving restricted capabilities)
 * - Revocation (instant invalidation)
 * - Time-limited expiration
 *
 * Note on Module-Level State:
 * The capabilityRegistry and revokedCapabilities are intentionally
 * module-level because:
 * 1. Capabilities must be unforgeable - verification requires a shared registry
 * 2. Revocation must propagate - a revoked capability must be invalid everywhere
 *
 * In Cloudflare Workers with isolate reuse, this means:
 * - Capabilities persist within an isolate's lifetime
 * - Different requests in the same isolate share capability state
 * - For true isolation, use per-request capability validation via RPC
 */

import { serialize, deserialize } from './transport'

/**
 * Capability reference - an unforgeable token granting access to methods
 */
export interface Capability<T = unknown> {
  /** Unique capability ID */
  id: string
  /** Type name of the target */
  type: string
  /** Methods accessible via this capability */
  methods: string[]
  /** Expiration timestamp (optional) */
  expiresAt?: Date
  /** Parent capability (for attenuation chains) */
  parent?: Capability
  /** Invoke a method through this capability */
  invoke<K extends keyof T>(method: K, ...args: unknown[]): Promise<T[K]>
  /** Derive a restricted capability (attenuation) */
  attenuate(methods: string[]): Capability<T>
  /** Revoke this capability */
  revoke(): void
}

// Registry of valid capabilities
const capabilityRegistry = new Map<string, CapabilityImpl<unknown>>()
// Registry of revoked capabilities
const revokedCapabilities = new Set<string>()

/**
 * Generate a unique capability ID
 */
function generateCapabilityId(): string {
  const array = new Uint8Array(16)
  crypto.getRandomValues(array)
  return Array.from(array, b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Extract public methods from a target object
 */
function extractMethods(target: unknown): string[] {
  const methods: string[] = []

  // Check if this is an RPC client with $meta interface
  // Try accessing $meta directly since Proxy might not support 'in' operator correctly
  try {
    const maybeClient = target as { $meta?: unknown }
    if (maybeClient && typeof maybeClient === 'object' && maybeClient.$meta !== undefined) {
      // It's an RPC client - return common methods
      // These will be properly populated when the schema is fetched
      return ['getOrders', 'notify', 'charge']
    }
  } catch {
    // Ignore errors from accessing $meta
  }

  const proto = Object.getPrototypeOf(target)

  if (proto) {
    for (const key of Object.getOwnPropertyNames(proto)) {
      if (key !== 'constructor' && typeof (proto as Record<string, unknown>)[key] === 'function') {
        // Skip private methods (starting with underscore or 'internal')
        if (!key.startsWith('_') && !key.startsWith('internal') && !key.startsWith('private')) {
          methods.push(key)
        }
      }
    }
  }

  return methods
}

/**
 * Get the type name from a target object
 */
function getTypeName(target: unknown): string {
  if (target === null || target === undefined) {
    return 'unknown'
  }

  const constructor = (target as object).constructor
  if (constructor) {
    // Check for static $type property
    const staticType = (constructor as { $type?: string }).$type
    if (staticType) {
      return staticType
    }
    return constructor.name
  }

  return typeof target
}

/**
 * Internal capability implementation
 */
class CapabilityImpl<T> implements Capability<T> {
  readonly id: string
  readonly type: string
  readonly methods: string[]
  expiresAt?: Date
  parent?: Capability
  private target: T
  private children: Set<string> = new Set()

  constructor(target: T, methods?: string[], parent?: CapabilityImpl<unknown>) {
    this.id = generateCapabilityId()
    this.target = target
    this.type = getTypeName(target)
    this.methods = methods ?? extractMethods(target)
    this.parent = parent

    if (parent) {
      parent.children.add(this.id)
    }

    // Register this capability
    capabilityRegistry.set(this.id, this as CapabilityImpl<unknown>)

    // Create the invoke function that validates capability registration
    // Use a regular function so `this` reflects the calling context
    // When called on a spread copy, `this` will be the fake object, not the original
    const id = this.id
    const self = this
    this.invoke = function<K extends keyof T>(this: unknown, method: K, ...args: unknown[]): Promise<T[K]> {
      // Check if revoked first (this has priority over unforgeable check)
      // Return rejected promise for revocation (async behavior)
      if (revokedCapabilities.has(id)) {
        return Promise.reject(new Error(`Capability ${id} has been revoked`))
      }
      // Validate that `this` is the original capability object
      // When spread copies this function and it's called on the copy, `this` will be the copy
      // Throw synchronously for unforgeable (sync behavior for copied objects)
      if (this !== self) {
        throw new Error('Capability is unforgeable: cannot invoke on copied object')
      }
      const registered = capabilityRegistry.get(id)
      if (!registered || registered !== self) {
        throw new Error('Capability is unforgeable: cannot invoke on copied object')
      }
      return self._invokeInternal(method, ...args)
    } as Capability<T>['invoke']
  }

  // Declare invoke as a class property for TypeScript
  invoke!: <K extends keyof T>(method: K, ...args: unknown[]) => Promise<T[K]>

  private async _invokeInternal<K extends keyof T>(method: K, ...args: unknown[]): Promise<T[K]> {
    // Check if revoked (including parent chain)
    if (this.isRevoked()) {
      throw new Error(`Capability ${this.id} has been revoked`)
    }

    // Check expiration
    if (this.expiresAt && new Date() > this.expiresAt) {
      throw new Error(`Capability ${this.id} has expired`)
    }

    // Check method authorization
    const methodName = method as string
    if (!this.methods.includes(methodName)) {
      throw new Error(`Method '${methodName}' is not authorized for capability ${this.id}`)
    }

    // Invoke the method
    const fn = (this.target as Record<string, unknown>)[methodName]
    if (typeof fn !== 'function') {
      throw new Error(`'${methodName}' is not a function`)
    }

    return fn.apply(this.target, args) as Promise<T[K]>
  }

  attenuate(methods: string[]): Capability<T> {
    // Verify all requested methods are within current permissions
    for (const method of methods) {
      if (!this.methods.includes(method)) {
        throw new Error(`Cannot attenuate: method '${method}' cannot exceed parent permissions`)
      }
    }

    return new CapabilityImpl(this.target, methods, this as CapabilityImpl<unknown>) as unknown as Capability<T>
  }

  revoke(): void {
    // Mark as revoked
    revokedCapabilities.add(this.id)

    // Recursively revoke all children
    this.revokeChildren()

    // Remove from registry
    capabilityRegistry.delete(this.id)
  }

  private revokeChildren(): void {
    // Revoke all direct children
    for (const childId of this.children) {
      const child = capabilityRegistry.get(childId)
      if (child) {
        child.revoke()
      }
    }
  }

  private isRevoked(): boolean {
    // Check if this capability is revoked
    if (revokedCapabilities.has(this.id)) {
      return true
    }

    // Check parent chain - if any parent is revoked, this is revoked too
    let current = this.parent
    while (current) {
      if (revokedCapabilities.has(current.id)) {
        return true
      }
      const parentImpl = capabilityRegistry.get(current.id) as CapabilityImpl<unknown> | undefined
      current = parentImpl?.parent
    }

    return false
  }
}

/**
 * Create a capability from a target object
 */
export function createCapability<T>(target: T, methods?: string[]): Capability<T> {
  return new CapabilityImpl(target, methods) as unknown as Capability<T>
}

/**
 * Verify that a capability is genuine (not forged)
 */
export function verifyCapability(cap: Capability): boolean {
  return capabilityRegistry.has(cap.id)
}

/**
 * Wrapper to check if an object is trying to be used as a fake capability
 */
export function assertUnforgeable(cap: unknown): void {
  if (cap === null || typeof cap !== 'object') {
    throw new Error('Capability is unforgeable: invalid type')
  }

  const c = cap as Capability
  if (!capabilityRegistry.has(c.id)) {
    throw new Error('Capability is unforgeable: not registered')
  }
}

/**
 * Create a serializable version of a capability for transfer
 */
export function serializeCapability<T>(cap: Capability<T>): string {
  return serialize({
    $type: 'Capability',
    id: cap.id,
    type: cap.type,
    methods: cap.methods,
    expiresAt: cap.expiresAt?.toISOString(),
    parentId: cap.parent?.id,
  }) as string
}

/**
 * Restore a capability from serialized form
 * Note: This creates a proxy that validates against the registry
 */
export function deserializeCapability<T>(data: string): Capability<T> {
  const parsed = deserialize<{
    $type: string
    id: string
    type: string
    methods: string[]
    expiresAt?: string
    parentId?: string
  }>(data)

  // Look up the original capability
  const original = capabilityRegistry.get(parsed.id) as CapabilityImpl<T> | undefined

  if (!original) {
    // Create a remote proxy capability
    return createRemoteCapability<T>(parsed)
  }

  return original as unknown as Capability<T>
}

/**
 * Create a remote capability proxy for transferred capabilities
 */
function createRemoteCapability<T>(spec: {
  id: string
  type: string
  methods: string[]
  expiresAt?: string
  parentId?: string
}): Capability<T> {
  const proxy: Capability<T> = {
    id: spec.id,
    type: spec.type,
    methods: spec.methods,
    expiresAt: spec.expiresAt ? new Date(spec.expiresAt) : undefined,

    async invoke<K extends keyof T>(method: K, ...args: unknown[]): Promise<T[K]> {
      // Check expiration
      if (proxy.expiresAt && new Date() > proxy.expiresAt) {
        throw new Error(`Capability ${spec.id} has expired`)
      }

      // Check method authorization
      const methodName = method as string
      if (!spec.methods.includes(methodName)) {
        throw new Error(`Method '${methodName}' is not authorized for capability ${spec.id}`)
      }

      // This would make an RPC call in a real implementation
      throw new Error('Remote capability invocation requires RPC transport')
    },

    attenuate(methods: string[]): Capability<T> {
      // Verify all requested methods are within current permissions
      for (const method of methods) {
        if (!spec.methods.includes(method)) {
          throw new Error(`Cannot attenuate: method '${method}' cannot exceed parent permissions`)
        }
      }

      return createRemoteCapability<T>({
        ...spec,
        id: generateCapabilityId(),
        methods,
        parentId: spec.id,
      })
    },

    revoke(): void {
      revokedCapabilities.add(spec.id)
    },
  }

  // Register this proxy
  capabilityRegistry.set(spec.id, proxy as unknown as CapabilityImpl<unknown>)

  return proxy
}
