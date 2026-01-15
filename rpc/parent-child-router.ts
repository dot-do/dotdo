/**
 * Parent-Child Router
 *
 * Implements hierarchical DO routing for parent-child relationships.
 * Manages hierarchical ID resolution and capability delegation between
 * parent and child Durable Objects.
 *
 * ID format: parent:child:grandchild
 * e.g., "tenant-123:user-456:session-789"
 *
 * Key features:
 * - Hierarchical ID parsing and building
 * - Parent/child resolution from ID structure
 * - Capability delegation with automatic attenuation
 * - Multi-level hierarchy support with configurable depth limit
 */

import {
  createCapabilityToken,
  verifyCapabilityToken,
  attenuateCapability,
  CapabilityPayload,
} from './capability-token'

// =============================================================================
// Constants
// =============================================================================

/** Default separator for hierarchical IDs */
const DEFAULT_HIERARCHY_SEPARATOR = ':'

/** Default maximum hierarchy depth */
const DEFAULT_MAX_DEPTH = 5

// =============================================================================
// Types
// =============================================================================

/**
 * Options for configuring the ParentChildRouter
 */
export interface ParentChildRouterOptions {
  /** Separator character(s) for hierarchical IDs (default: ':') */
  separator?: string
  /** Maximum depth of hierarchy (default: 5) */
  maxDepth?: number
}

// =============================================================================
// ParentChildRouter Implementation
// =============================================================================

/**
 * Router for managing parent-child DO hierarchies.
 *
 * Provides methods for:
 * - Parsing and building hierarchical IDs
 * - Resolving parent/child relationships
 * - Creating capability tokens with proper delegation
 *
 * @example
 * ```typescript
 * const router = new ParentChildRouter()
 *
 * // Build hierarchy
 * const tenantId = 'tenant-123'
 * const userId = router.getChildId(tenantId, 'user-456')
 * // userId = 'tenant-123:user-456'
 *
 * // Navigate back up
 * const parent = router.getParentId(userId)
 * // parent = 'tenant-123'
 * ```
 */
export class ParentChildRouter {
  private separator: string
  private maxDepth: number

  constructor(options?: ParentChildRouterOptions) {
    this.separator = options?.separator ?? DEFAULT_HIERARCHY_SEPARATOR
    this.maxDepth = options?.maxDepth ?? DEFAULT_MAX_DEPTH
  }

  // ===========================================================================
  // ID Parsing and Building
  // ===========================================================================

  /**
   * Parse a hierarchical ID into its component parts.
   *
   * @param id - The hierarchical ID to parse
   * @returns Array of ID parts from root to leaf
   *
   * @example
   * ```typescript
   * router.parseId('tenant-123:user-456:session-789')
   * // Returns: ['tenant-123', 'user-456', 'session-789']
   * ```
   */
  parseId(id: string): string[] {
    return id.split(this.separator)
  }

  /**
   * Build a hierarchical ID from component parts.
   *
   * @param parts - Array of ID parts from root to leaf
   * @returns Combined hierarchical ID
   *
   * @example
   * ```typescript
   * router.buildId(['tenant-123', 'user-456', 'session-789'])
   * // Returns: 'tenant-123:user-456:session-789'
   * ```
   */
  buildId(parts: string[]): string {
    return parts.join(this.separator)
  }

  // ===========================================================================
  // Parent/Child Resolution
  // ===========================================================================

  /**
   * Get the parent ID from a hierarchical child ID.
   *
   * @param childId - The child's hierarchical ID
   * @returns The parent's ID, or null if childId is root-level
   *
   * @example
   * ```typescript
   * router.getParentId('tenant-123:user-456')
   * // Returns: 'tenant-123'
   *
   * router.getParentId('tenant-123')
   * // Returns: null (root level)
   * ```
   */
  getParentId(childId: string): string | null {
    const parts = this.parseId(childId)
    if (parts.length <= 1) {
      return null
    }
    return this.buildId(parts.slice(0, -1))
  }

  /**
   * Get a child ID by appending a suffix to a parent ID.
   *
   * @param parentId - The parent's hierarchical ID
   * @param childSuffix - The suffix to append for the child
   * @returns The child's full hierarchical ID
   * @throws Error if adding child would exceed max hierarchy depth
   *
   * @example
   * ```typescript
   * router.getChildId('tenant-123', 'user-456')
   * // Returns: 'tenant-123:user-456'
   * ```
   */
  getChildId(parentId: string, childSuffix: string): string {
    const parts = this.parseId(parentId)
    if (parts.length >= this.maxDepth) {
      throw new Error(`Max hierarchy depth (${this.maxDepth}) exceeded`)
    }
    return this.buildId([...parts, childSuffix])
  }

  /**
   * Generate a unique child suffix for creating new children.
   *
   * @returns A unique suffix string suitable for use with getChildId
   *
   * @example
   * ```typescript
   * const suffix = router.generateChildSuffix()
   * // Returns: 'child_1705123456789_abc123'
   * ```
   */
  generateChildSuffix(): string {
    return `child_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`
  }

  /**
   * Get the depth (level) of a hierarchical ID.
   *
   * @param id - The hierarchical ID
   * @returns Number of levels in the hierarchy (1 = root)
   *
   * @example
   * ```typescript
   * router.getDepth('tenant-123')              // Returns: 1
   * router.getDepth('tenant-123:user-456')     // Returns: 2
   * router.getDepth('tenant-123:user-456:x')   // Returns: 3
   * ```
   */
  getDepth(id: string): number {
    return this.parseId(id).length
  }

  /**
   * Check if childId is a descendant of parentId.
   *
   * @param parentId - The potential ancestor's ID
   * @param childId - The potential descendant's ID
   * @returns true if childId is a descendant of parentId
   *
   * @example
   * ```typescript
   * router.isDescendant('tenant-123', 'tenant-123:user-456')
   * // Returns: true
   *
   * router.isDescendant('tenant-123', 'tenant-456:user-789')
   * // Returns: false
   * ```
   */
  isDescendant(parentId: string, childId: string): boolean {
    return childId.startsWith(parentId + this.separator)
  }

  // ===========================================================================
  // Capability Delegation
  // ===========================================================================

  /**
   * Create a capability token for a child with delegated permissions from parent.
   *
   * The child capability:
   * - Is targeted at the child ID
   * - Cannot have more methods than the parent
   * - Cannot have higher scope than the parent
   * - Cannot have later expiry than the parent
   *
   * @param parentCapability - The parent's capability token
   * @param parentSecret - The shared secret for signing
   * @param childId - The child's hierarchical ID
   * @param restrictions - Optional restrictions to apply (can only reduce, not expand)
   * @returns New capability token for the child
   * @throws CapabilityError if attempting to escalate privileges
   *
   * @example
   * ```typescript
   * const childCap = await router.createChildCapability(
   *   parentCap,
   *   secret,
   *   'tenant-123:user-456',
   *   { methods: ['read'], scope: 'read' }
   * )
   * ```
   */
  async createChildCapability(
    parentCapability: string,
    parentSecret: string,
    childId: string,
    restrictions?: Partial<Pick<CapabilityPayload, 'methods' | 'scope' | 'exp'>>
  ): Promise<string> {
    // Verify and attenuate parent capability
    // The attenuateCapability function handles privilege escalation checks
    const attenuated = await attenuateCapability(parentCapability, parentSecret, {
      ...restrictions,
    })

    // Now we need to re-create with the child target
    // First verify the attenuated token to get its payload
    const attenuatedPayload = await verifyCapabilityToken(attenuated, parentSecret)

    // Create new token with child as target, preserving all other attenuated values
    return createCapabilityToken(
      {
        target: childId,
        methods: attenuatedPayload.methods,
        scope: attenuatedPayload.scope,
        exp: attenuatedPayload.exp,
        sub: attenuatedPayload.sub,
      },
      parentSecret
    )
  }

  /**
   * Create an initial capability token for a root-level entity.
   *
   * @param target - The target ID for the capability
   * @param secret - The shared secret for signing
   * @param options - Capability options (methods, scope, exp, sub)
   * @returns Signed capability token
   *
   * @example
   * ```typescript
   * const cap = await router.createRootCapability('tenant-123', secret, {
   *   methods: ['*'],
   *   scope: 'admin',
   *   exp: Date.now() + 3600000
   * })
   * ```
   */
  async createRootCapability(
    target: string,
    secret: string,
    options: Omit<CapabilityPayload, 'target'>
  ): Promise<string> {
    return createCapabilityToken({ target, ...options }, secret)
  }
}

// =============================================================================
// Hierarchy Resolver Helper
// =============================================================================

/**
 * Create a stub resolver for parent-child hierarchies.
 *
 * This helper creates navigation functions that use a stub getter
 * to resolve actual DO stubs from hierarchical IDs.
 *
 * @param getStub - Function to get a stub by ID
 * @returns Object with getChild and getParent methods
 *
 * @example
 * ```typescript
 * // In a Durable Object context
 * const resolver = createHierarchyResolver((id) =>
 *   env.DO.get(env.DO.idFromName(id))
 * )
 *
 * // Navigate to child
 * const child = resolver.getChild('tenant-123', 'user-456')
 *
 * // Navigate to parent
 * const parent = resolver.getParent('tenant-123:user-456')
 * ```
 */
export function createHierarchyResolver<T>(getStub: (id: string) => T | null): {
  getChild: (parentId: string, childSuffix: string) => T | null
  getParent: (childId: string) => T | null
} {
  const router = new ParentChildRouter()

  return {
    getChild(parentId: string, childSuffix: string): T | null {
      const childId = router.getChildId(parentId, childSuffix)
      return getStub(childId)
    },
    getParent(childId: string): T | null {
      const parentId = router.getParentId(childId)
      if (!parentId) {
        return null
      }
      return getStub(parentId)
    },
  }
}
