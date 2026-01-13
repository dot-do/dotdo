/**
 * VisibilityModule - Extracted visibility and access control from DOBase
 *
 * This module handles:
 * - Visibility-based access checks (public, unlisted, org, user)
 * - Thing filtering based on actor context
 * - Owner and organization membership checks
 *
 * Extracted from DOBase to separate visibility concerns from the main DO logic.
 * Part of Phase 1 decomposition (low-risk extractions).
 */

import type { Thing } from '../../types/Thing'
import type { ThingEntity } from '../../db/stores'
import type { ActorContext } from './ActorContextModule'

/**
 * Visibility levels for Things
 */
export type Visibility = 'public' | 'unlisted' | 'org' | 'user'

/**
 * Thing-like object with optional data containing visibility metadata
 */
export interface VisibleThing {
  data?: Record<string, unknown> | null
}

/**
 * Function type for retrieving a thing by ID
 */
export type ThingGetter = (id: string) => Promise<ThingEntity | null>

/**
 * VisibilityModule - Manages visibility-based access control for Things
 */
export class VisibilityModule {
  /**
   * Get actor context function - injected to avoid circular dependencies
   */
  private readonly _getActorContext: () => ActorContext

  constructor(getActorContext: () => ActorContext) {
    this._getActorContext = getActorContext
  }

  /**
   * Check if the current actor can view a thing based on its visibility.
   *
   * Visibility levels:
   * - 'public': Visible to everyone
   * - 'unlisted': Visible if you have the direct link
   * - 'org': Visible to members of the same organization
   * - 'user': Visible only to the owner
   *
   * @param thing - The thing to check visibility for
   * @returns true if the current actor can view the thing
   */
  canViewThing(thing: Thing | ThingEntity | VisibleThing | null | undefined): boolean {
    if (!thing) {
      return false
    }

    const visibility = this.getVisibility(thing)
    const actor = this._getActorContext()

    // Public and unlisted are always viewable
    if (visibility === 'public' || visibility === 'unlisted') {
      return true
    }

    // Organization visibility - check org membership
    if (visibility === 'org') {
      const thingOrgId = this.extractOrgId(thing)
      return !!actor.orgId && actor.orgId === thingOrgId
    }

    // User visibility (default) - check ownership
    const thingOwnerId = this.extractOwnerId(thing)
    return !!actor.userId && actor.userId === thingOwnerId
  }

  /**
   * Assert that the current actor can view a thing.
   * Throws an error with appropriate message if access is denied.
   *
   * @param thing - The thing to check visibility for
   * @param message - Optional custom error message
   * @throws Error if thing is null/undefined or access is denied
   */
  assertCanView(thing: Thing | ThingEntity | VisibleThing | null | undefined, message?: string): void {
    if (!thing) {
      throw new Error(message ?? 'Thing not found')
    }

    if (!this.canViewThing(thing)) {
      const visibility = this.getVisibility(thing)
      let reason: string
      switch (visibility) {
        case 'org':
          reason = 'Organization membership required'
          break
        case 'user':
          reason = 'Owner access required'
          break
        default:
          reason = 'Access denied'
      }
      throw new Error(message ?? reason)
    }
  }

  /**
   * Filter an array of things to only those visible to the current actor.
   *
   * @param things - Array of things to filter
   * @returns Array of visible things
   */
  filterVisibleThings<T extends Thing | ThingEntity | VisibleThing>(things: T[]): T[] {
    return things.filter((thing) => this.canViewThing(thing))
  }

  /**
   * Get a thing by ID if it's visible to the current actor.
   *
   * @param id - Thing ID to retrieve
   * @param getter - Function to retrieve the thing
   * @returns The thing if visible, null otherwise
   */
  async getVisibleThing(id: string, getter: ThingGetter): Promise<ThingEntity | null> {
    const thing = await getter(id)
    if (!thing) {
      return null
    }
    return this.canViewThing(thing) ? thing : null
  }

  /**
   * Get the visibility level of a thing.
   *
   * @param thing - The thing to get visibility for
   * @returns The visibility level (defaults to 'user' if not specified)
   */
  getVisibility(thing: Thing | ThingEntity | VisibleThing | null | undefined): Visibility {
    if (!thing) {
      return 'user'
    }
    const dataObj = thing.data as Record<string, unknown> | undefined
    const visibility = dataObj?.visibility as string | undefined
    return (visibility as Visibility) ?? 'user'
  }

  /**
   * Check if the current actor is the owner of a thing.
   *
   * @param thing - The thing to check ownership for
   * @returns true if the current actor owns the thing
   */
  isOwner(thing: Thing | ThingEntity | VisibleThing | null | undefined): boolean {
    if (!thing) {
      return false
    }

    const thingOwnerId = this.extractOwnerId(thing)
    const actor = this._getActorContext()
    return !!actor.userId && actor.userId === thingOwnerId
  }

  /**
   * Check if the current actor is in the same organization as a thing.
   *
   * @param thing - The thing to check organization membership for
   * @returns true if the current actor is in the thing's organization
   */
  isInThingOrg(thing: Thing | ThingEntity | VisibleThing | null | undefined): boolean {
    if (!thing) {
      return false
    }

    const thingOrgId = this.extractOrgId(thing)
    const actor = this._getActorContext()
    return !!actor.orgId && actor.orgId === thingOrgId
  }

  /**
   * Extract owner ID from a thing's data.
   * Checks both data.meta.ownerId and data.ownerId for flexibility.
   */
  private extractOwnerId(thing: VisibleThing): string | undefined {
    const dataObj = thing.data as Record<string, unknown> | undefined
    const metaObj = dataObj?.meta as Record<string, unknown> | undefined
    return (metaObj?.ownerId as string | undefined) ?? (dataObj?.ownerId as string | undefined)
  }

  /**
   * Extract organization ID from a thing's data.
   * Checks both data.meta.orgId and data.orgId for flexibility.
   */
  private extractOrgId(thing: VisibleThing): string | undefined {
    const dataObj = thing.data as Record<string, unknown> | undefined
    const metaObj = dataObj?.meta as Record<string, unknown> | undefined
    return (metaObj?.orgId as string | undefined) ?? (dataObj?.orgId as string | undefined)
  }
}
