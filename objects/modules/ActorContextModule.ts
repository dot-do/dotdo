/**
 * ActorContextModule - Extracted actor context management from DOBase
 *
 * This module handles:
 * - Current actor tracking for action logging
 * - Actor context (userId, orgId) for visibility checks
 * - Actor lifecycle (set, get, clear)
 *
 * Extracted from DOBase to separate actor context concerns from the main DO logic.
 * Part of Phase 1 decomposition (low-risk extractions).
 */

/**
 * Actor context containing user and organization identifiers.
 * Used for visibility checks and action attribution.
 */
export interface ActorContext {
  /** User identifier */
  userId?: string
  /** Organization identifier */
  orgId?: string
}

/**
 * ActorContextModule - Manages actor identity for action logging and visibility
 */
export class ActorContextModule {
  /**
   * Current actor for action logging.
   * Format: 'Type/id' (e.g., 'Human/nathan', 'Agent/support')
   */
  private _currentActor = ''

  /**
   * Current actor context containing user/org identifiers.
   * Used for visibility filtering and authorization checks.
   */
  private _currentActorContext: ActorContext = {}

  /**
   * Set the current actor for subsequent action logging.
   *
   * @param actor - Actor identifier in 'Type/id' format
   *
   * @example
   * ```typescript
   * actorModule.setActor('Human/nathan')
   * actorModule.setActor('Agent/support-bot')
   * ```
   */
  setActor(actor: string): void {
    this._currentActor = actor
  }

  /**
   * Clear the current actor.
   * Called after request handling to reset actor state.
   */
  clearActor(): void {
    this._currentActor = ''
  }

  /**
   * Get the current actor for action logging.
   *
   * @returns The current actor identifier or empty string if not set
   */
  getCurrentActor(): string {
    return this._currentActor
  }

  /**
   * Set the actor context for visibility and authorization.
   *
   * @param context - Actor context with userId and/or orgId
   *
   * @example
   * ```typescript
   * actorModule.setActorContext({ userId: 'usr_123', orgId: 'org_456' })
   * ```
   */
  setActorContext(context: ActorContext): void {
    this._currentActorContext = context
  }

  /**
   * Get the current actor context.
   *
   * @returns Current actor context (may be empty object)
   */
  getActorContext(): ActorContext {
    return this._currentActorContext
  }

  /**
   * Clear the actor context.
   * Called after request handling to reset context state.
   */
  clearActorContext(): void {
    this._currentActorContext = {}
  }

  /**
   * Clear all actor state (both actor and context).
   * Convenience method for full reset after request handling.
   */
  clearAll(): void {
    this._currentActor = ''
    this._currentActorContext = {}
  }

  /**
   * Check if an actor is currently set.
   */
  get hasActor(): boolean {
    return this._currentActor !== ''
  }

  /**
   * Check if actor context has a user ID.
   */
  get hasUserId(): boolean {
    return this._currentActorContext.userId !== undefined
  }

  /**
   * Check if actor context has an organization ID.
   */
  get hasOrgId(): boolean {
    return this._currentActorContext.orgId !== undefined
  }

  /**
   * Get the current user ID from actor context.
   */
  get userId(): string | undefined {
    return this._currentActorContext.userId
  }

  /**
   * Get the current organization ID from actor context.
   */
  get orgId(): string | undefined {
    return this._currentActorContext.orgId
  }
}
