/**
 * @module Identity
 * @description Identity management for Durable Objects
 *
 * Handles namespace URL (ns), branch tracking, and type discriminators
 * for DO instances. Extracted from DOTiny as a composable module.
 */

/**
 * Interface for the Identity component
 */
export interface IIdentity {
  /** Namespace URL - the DO's identity (e.g., 'https://tenant.api.dotdo.dev') */
  readonly ns: string

  /** Current branch name (default: 'main') */
  readonly branch: string

  /** Parent namespace URL (optional) */
  readonly parent?: string

  /** Type discriminator for polymorphic behavior */
  readonly $type: string

  /** Whether identity has been derived from a request */
  readonly identityDerived: boolean

  /** Set namespace URL */
  setNs(ns: string): void

  /** Set parent namespace */
  setParent(parent: string): void

  /** Set branch */
  setBranch(branch: string): void

  /** Mark identity as derived */
  markIdentityDerived(): void

  /** Derive identity from request URL */
  deriveFromRequest(request: Request): void

  /** Get the full type hierarchy */
  getTypeHierarchy(constructor: Function): string[]

  /** Check if instance is of or extends the given type */
  isInstanceOfType(type: string, constructor: Function): boolean

  /** Check for exact type match */
  isType(type: string): boolean

  /** Check if this type extends the given type */
  extendsType(type: string, constructor: Function): boolean

  /** Serialize identity to JSON */
  toJSON(): Record<string, unknown>
}

/**
 * Configuration for Identity
 */
export interface IdentityConfig {
  /** Static $type from the DO class */
  $type: string
}

/**
 * Identity - Manages DO namespace, branch, and type identity
 *
 * This class encapsulates all identity-related state and behavior,
 * allowing it to be composed into DO classes rather than inherited.
 */
export class Identity implements IIdentity {
  private _ns: string = ''
  private _branch: string = 'main'
  private _parent?: string
  private _identityDerived: boolean = false
  private readonly _$type: string

  constructor(config: IdentityConfig) {
    this._$type = config.$type
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GETTERS
  // ═══════════════════════════════════════════════════════════════════════════

  get ns(): string {
    return this._ns
  }

  get branch(): string {
    return this._branch
  }

  get parent(): string | undefined {
    return this._parent
  }

  get $type(): string {
    return this._$type
  }

  get identityDerived(): boolean {
    return this._identityDerived
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SETTERS
  // ═══════════════════════════════════════════════════════════════════════════

  setNs(ns: string): void {
    this._ns = ns
  }

  setParent(parent: string): void {
    this._parent = parent
  }

  setBranch(branch: string): void {
    this._branch = branch
  }

  markIdentityDerived(): void {
    this._identityDerived = true
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // IDENTITY DERIVATION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Derive identity (ns) from the incoming request URL if not already set.
   * The ns is the first subdomain from the request URL's hostname.
   *
   * Examples:
   * - https://acme.api.dotdo.dev/foo -> ns = 'acme'
   * - https://localhost:8787/bar -> ns = 'localhost'
   * - https://single-domain.dev/bar -> ns = 'single-domain'
   */
  deriveFromRequest(request: Request): void {
    // Only derive once - first request wins
    if (this._identityDerived) {
      return
    }

    try {
      const url = new URL(request.url)
      const hostname = url.hostname

      // Extract first subdomain (e.g., 'acme' from 'acme.api.dotdo.dev')
      const parts = hostname.split('.')
      const ns = parts[0] ?? hostname

      // Set ns if it's empty
      if (!this._ns && ns) {
        this._ns = ns
      }

      this._identityDerived = true
    } catch {
      // Silently ignore URL parsing errors - ns remains as-is
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TYPE HIERARCHY
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get the full type hierarchy for this instance
   * Returns an array from most specific to most general (e.g., ['Agent', 'Worker', 'DO'])
   */
  getTypeHierarchy(constructor: Function): string[] {
    const hierarchy: string[] = []
    let current: { $type?: string } | null = constructor as { $type?: string }

    while (current && current.$type) {
      hierarchy.push(current.$type)
      const parent = Object.getPrototypeOf(current)
      if (parent === Function.prototype || !parent.$type) break
      current = parent
    }

    return hierarchy
  }

  /**
   * Check if this instance is of or extends the given type
   */
  isInstanceOfType(type: string, constructor: Function): boolean {
    return this.getTypeHierarchy(constructor).includes(type)
  }

  /**
   * Check for exact type match
   */
  isType(type: string): boolean {
    return this._$type === type
  }

  /**
   * Check if this type extends the given type (includes exact match)
   */
  extendsType(type: string, constructor: Function): boolean {
    return this.isInstanceOfType(type, constructor)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SERIALIZATION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Serialize identity to JSON
   */
  toJSON(): Record<string, unknown> {
    return {
      $type: this._$type,
      ns: this._ns,
      branch: this._branch,
      ...(this._parent && { parent: this._parent }),
    }
  }
}

/**
 * Factory function to create an Identity instance
 */
export function createIdentity(config: IdentityConfig): Identity {
  return new Identity(config)
}
