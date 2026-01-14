/**
 * @dotdo/segment - Personas (Computed Traits & Audiences)
 *
 * Segment Personas compatibility layer providing:
 * - User profile unification across identities
 * - Computed traits based on user behavior (including SQL-like expressions)
 * - Audience building with complex conditions
 * - Real-time profile updates and webhooks
 * - Trait history tracking
 * - External ID support
 *
 * @module @dotdo/segment/personas
 */

import type { SegmentEvent, Traits, Destination } from './types.js'
import {
  IdentityResolver,
  createIdentityResolver,
  type IdentityResolverOptions,
  type MergedProfile,
  type IdentityNode,
} from './identity.js'

// =============================================================================
// Types
// =============================================================================

/**
 * Computed trait types
 */
export type ComputedTraitType =
  | 'count'
  | 'sum'
  | 'average'
  | 'min'
  | 'max'
  | 'first'
  | 'last'
  | 'unique_count'
  | 'list'
  | 'days_since_first'
  | 'days_since_last'
  | 'most_frequent'

/**
 * Computed trait configuration
 */
export interface ComputedTraitConfig {
  /** Trait name */
  name: string
  /** Computation type */
  type: ComputedTraitType
  /** Description of the trait */
  description?: string
  /** Event name to compute from */
  eventName: string
  /** Property to extract value from (for sum, average, min, max, first, last, unique_count, list, most_frequent) */
  property?: string
  /** Filter function to select events */
  filter?: (event: SegmentEvent) => boolean
  /** Time window in milliseconds (only include events within this window) */
  timeWindow?: number
}

/**
 * Audience configuration
 */
export interface AudienceConfig {
  /** Audience name */
  name: string
  /** Description of the audience */
  description?: string
  /** Condition function to evaluate membership */
  condition: (profile: UserProfile) => boolean
}

/**
 * User profile
 */
export interface UserProfile {
  /** User ID */
  userId?: string
  /** Anonymous ID */
  anonymousId?: string
  /** User traits from identify calls */
  traits: Record<string, unknown>
  /** Computed traits from events */
  computedTraits: Record<string, unknown>
  /** Audience memberships */
  audiences: string[]
  /** Audience entry timestamps */
  audienceTimestamps?: Record<string, string>
}

/**
 * Result of computing a trait
 */
export interface TraitResult {
  /** The computed value */
  value: unknown
  /** Number of events used in computation */
  eventCount: number
  /** Timestamp of computation */
  computedAt: string
}

/**
 * Result of evaluating an audience
 */
export interface AudienceResult {
  /** Whether the user is a member */
  member: boolean
  /** When the user entered (if member) */
  enteredAt?: string
}

/**
 * Personas engine options
 */
export interface PersonasEngineOptions {
  /** Callback when a profile is updated */
  onProfileUpdated?: (profile: UserProfile) => void
  /** Callback when a user enters an audience */
  onAudienceEnter?: (userId: string, audienceName: string) => void
  /** Callback when a user exits an audience */
  onAudienceExit?: (userId: string, audienceName: string) => void
  /** Enable identity resolution for profile unification */
  enableIdentityResolution?: boolean
  /** Identity resolver options */
  identityResolverOptions?: IdentityResolverOptions
  /** Callback when trait value changes */
  onTraitChanged?: (userId: string, traitName: string, oldValue: unknown, newValue: unknown) => void
  /** Enable trait history tracking */
  enableTraitHistory?: boolean
  /** Destinations to sync audiences to */
  audienceDestinations?: Destination[]
}

// =============================================================================
// SQL-like Expression Types
// =============================================================================

/**
 * SQL-like expression for computed traits
 */
export interface TraitExpression {
  /** Expression type: aggregate, conditional, arithmetic */
  type: 'aggregate' | 'conditional' | 'arithmetic' | 'window'
  /** SQL-like expression string */
  expression: string
  /** Parsed components (for execution) */
  components?: ExpressionComponents
}

/**
 * Parsed expression components
 */
export interface ExpressionComponents {
  /** Aggregation function */
  aggregation?: 'COUNT' | 'SUM' | 'AVG' | 'MIN' | 'MAX' | 'FIRST' | 'LAST' | 'COUNT_DISTINCT' | 'COLLECT'
  /** Field/property to aggregate */
  field?: string
  /** Filter/where conditions */
  where?: ExpressionCondition[]
  /** Time window in milliseconds */
  timeWindow?: number
  /** Group by field */
  groupBy?: string
}

/**
 * Expression condition for filtering
 */
export interface ExpressionCondition {
  field: string
  operator: '=' | '!=' | '>' | '<' | '>=' | '<=' | 'LIKE' | 'IN' | 'NOT IN' | 'IS NULL' | 'IS NOT NULL'
  value?: unknown
}

// =============================================================================
// Audience Operator Types
// =============================================================================

/**
 * Audience condition operators
 */
export type AudienceOperator =
  | 'equals'
  | 'not_equals'
  | 'greater_than'
  | 'less_than'
  | 'greater_than_or_equals'
  | 'less_than_or_equals'
  | 'contains'
  | 'not_contains'
  | 'starts_with'
  | 'ends_with'
  | 'in_list'
  | 'not_in_list'
  | 'is_set'
  | 'is_not_set'
  | 'within_last_n_days'
  | 'more_than_n_days_ago'

/**
 * Structured audience condition
 */
export interface AudienceCondition {
  /** Trait source: traits, computedTraits, or custom */
  source: 'traits' | 'computedTraits' | 'custom'
  /** Trait name */
  trait: string
  /** Operator to apply */
  operator: AudienceOperator
  /** Value to compare against */
  value?: unknown
}

/**
 * Audience rule combining multiple conditions
 */
export interface AudienceRule {
  /** How to combine conditions: AND or OR */
  combinator: 'AND' | 'OR'
  /** Conditions in this rule */
  conditions: Array<AudienceCondition | AudienceRule>
}

/**
 * Enhanced audience configuration with rules
 */
export interface EnhancedAudienceConfig extends AudienceConfig {
  /** Structured rules (alternative to condition function) */
  rules?: AudienceRule
  /** Sync to these destination names */
  syncDestinations?: string[]
  /** Estimated size (for planning) */
  estimatedSize?: number
  /** Tags for organization */
  tags?: string[]
}

// =============================================================================
// Trait History Types
// =============================================================================

/**
 * A single trait value change
 */
export interface TraitHistoryEntry {
  /** Timestamp of the change */
  timestamp: string
  /** Previous value */
  previousValue: unknown
  /** New value */
  newValue: unknown
  /** Event that triggered the change */
  triggerEvent?: string
}

/**
 * Full trait history for a user
 */
export interface TraitHistory {
  /** Trait name */
  traitName: string
  /** History of changes */
  history: TraitHistoryEntry[]
  /** Current value */
  currentValue: unknown
}

// =============================================================================
// External ID Types
// =============================================================================

/**
 * External ID representation
 */
export interface ExternalId {
  /** External system type (e.g., 'salesforce', 'hubspot') */
  type: string
  /** ID value in the external system */
  id: string
  /** Collection/object type in external system */
  collection?: string
  /** Additional metadata */
  metadata?: Record<string, unknown>
}

/**
 * Extended user profile with external IDs
 */
export interface ExtendedUserProfile extends UserProfile {
  /** External IDs from integrated systems */
  externalIds?: ExternalId[]
  /** Trait history if enabled */
  traitHistories?: Record<string, TraitHistory>
  /** Identity graph nodes (if identity resolution enabled) */
  identityNodes?: IdentityNode[]
  /** Profile confidence score (0-1) */
  confidenceScore?: number
  /** Last activity timestamp */
  lastActivityAt?: string
  /** Profile creation timestamp */
  createdAt?: string
}

// =============================================================================
// ComputedTrait Class
// =============================================================================

/**
 * Computed trait computes values from event streams.
 */
export class ComputedTrait {
  readonly name: string
  readonly type: ComputedTraitType
  readonly description?: string
  readonly eventName: string
  readonly property?: string
  readonly filter?: (event: SegmentEvent) => boolean
  readonly timeWindow?: number

  constructor(config: ComputedTraitConfig) {
    this.name = config.name
    this.type = config.type
    this.description = config.description
    this.eventName = config.eventName
    this.property = config.property
    this.filter = config.filter
    this.timeWindow = config.timeWindow
  }

  /**
   * Compute the trait value from a list of events.
   */
  compute(events: SegmentEvent[]): TraitResult {
    // Filter to matching events
    let matchingEvents = events.filter((e) => e.type === 'track' && e.event === this.eventName)

    // Apply custom filter
    if (this.filter) {
      matchingEvents = matchingEvents.filter(this.filter)
    }

    // Apply time window
    if (this.timeWindow) {
      const cutoff = Date.now() - this.timeWindow
      matchingEvents = matchingEvents.filter((e) => {
        const eventTime = new Date(e.timestamp).getTime()
        return eventTime >= cutoff
      })
    }

    // Sort by timestamp
    matchingEvents.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())

    // Compute based on type
    const value = this.computeValue(matchingEvents)

    return {
      value,
      eventCount: matchingEvents.length,
      computedAt: new Date().toISOString(),
    }
  }

  private computeValue(events: SegmentEvent[]): unknown {
    switch (this.type) {
      case 'count':
        return events.length

      case 'sum':
        return this.computeSum(events)

      case 'average':
        return this.computeAverage(events)

      case 'min':
        return this.computeMin(events)

      case 'max':
        return this.computeMax(events)

      case 'first':
        return this.computeFirst(events)

      case 'last':
        return this.computeLast(events)

      case 'unique_count':
        return this.computeUniqueCount(events)

      case 'list':
        return this.computeList(events)

      case 'days_since_first':
        return this.computeDaysSinceFirst(events)

      case 'days_since_last':
        return this.computeDaysSinceLast(events)

      case 'most_frequent':
        return this.computeMostFrequent(events)

      default:
        return null
    }
  }

  private getPropertyValue(event: SegmentEvent): unknown {
    if (!this.property) return undefined
    return event.properties?.[this.property]
  }

  private getNumericValues(events: SegmentEvent[]): number[] {
    return events
      .map((e) => this.getPropertyValue(e))
      .filter((v): v is number => typeof v === 'number')
  }

  private computeSum(events: SegmentEvent[]): number {
    return this.getNumericValues(events).reduce((sum, v) => sum + v, 0)
  }

  private computeAverage(events: SegmentEvent[]): number {
    const values = this.getNumericValues(events)
    if (values.length === 0) return 0
    return values.reduce((sum, v) => sum + v, 0) / values.length
  }

  private computeMin(events: SegmentEvent[]): number | null {
    const values = this.getNumericValues(events)
    if (values.length === 0) return null
    return Math.min(...values)
  }

  private computeMax(events: SegmentEvent[]): number | null {
    const values = this.getNumericValues(events)
    if (values.length === 0) return null
    return Math.max(...values)
  }

  private computeFirst(events: SegmentEvent[]): unknown {
    if (events.length === 0) return null
    return this.getPropertyValue(events[0]!)
  }

  private computeLast(events: SegmentEvent[]): unknown {
    if (events.length === 0) return null
    return this.getPropertyValue(events[events.length - 1]!)
  }

  private computeUniqueCount(events: SegmentEvent[]): number {
    const values = new Set(
      events.map((e) => this.getPropertyValue(e)).filter((v) => v !== undefined && v !== null)
    )
    return values.size
  }

  private computeList(events: SegmentEvent[]): unknown[] {
    const seen = new Set<unknown>()
    const result: unknown[] = []

    for (const event of events) {
      const value = this.getPropertyValue(event)
      if (value !== undefined && value !== null && !seen.has(value)) {
        seen.add(value)
        result.push(value)
      }
    }

    return result
  }

  private computeDaysSinceFirst(events: SegmentEvent[]): number | null {
    if (events.length === 0) return null
    const firstEvent = events[0]!
    const firstTime = new Date(firstEvent.timestamp).getTime()
    const now = Date.now()
    return Math.floor((now - firstTime) / (24 * 60 * 60 * 1000))
  }

  private computeDaysSinceLast(events: SegmentEvent[]): number | null {
    if (events.length === 0) return null
    const lastEvent = events[events.length - 1]!
    const lastTime = new Date(lastEvent.timestamp).getTime()
    const now = Date.now()
    return Math.floor((now - lastTime) / (24 * 60 * 60 * 1000))
  }

  private computeMostFrequent(events: SegmentEvent[]): unknown {
    const counts = new Map<unknown, number>()

    for (const event of events) {
      const value = this.getPropertyValue(event)
      if (value !== undefined && value !== null) {
        counts.set(value, (counts.get(value) || 0) + 1)
      }
    }

    let maxCount = 0
    let mostFrequent: unknown = null

    for (const [value, count] of counts) {
      if (count > maxCount) {
        maxCount = count
        mostFrequent = value
      }
    }

    return mostFrequent
  }
}

// =============================================================================
// Audience Class
// =============================================================================

/**
 * Audience evaluates user membership based on profile data.
 */
export class Audience {
  readonly name: string
  readonly description?: string
  readonly condition: (profile: UserProfile) => boolean

  constructor(config: AudienceConfig) {
    this.name = config.name
    this.description = config.description
    this.condition = config.condition
  }

  /**
   * Evaluate whether a user profile is a member of this audience.
   */
  evaluate(profile: UserProfile): AudienceResult {
    try {
      const member = this.condition(profile)
      return {
        member,
        enteredAt: member ? new Date().toISOString() : undefined,
      }
    } catch {
      // If condition throws, user is not a member
      return { member: false }
    }
  }
}

// =============================================================================
// PersonasEngine Class
// =============================================================================

/**
 * Personas Engine manages computed traits, audiences, and user profiles.
 * Supports profile unification, trait history, and real-time updates.
 */
export class PersonasEngine {
  private computedTraits: Map<string, ComputedTrait> = new Map()
  private audiences: Map<string, Audience> = new Map()
  private enhancedAudiences: Map<string, EnhancedAudienceConfig> = new Map()
  private profiles: Map<string, ExtendedUserProfile> = new Map()
  private events: Map<string, SegmentEvent[]> = new Map()
  private traitHistories: Map<string, Map<string, TraitHistory>> = new Map()
  private readonly options: PersonasEngineOptions
  private readonly identityResolver?: IdentityResolver
  private audienceDestinations: Map<string, Destination> = new Map()

  constructor(options?: PersonasEngineOptions) {
    this.options = options || {}

    // Initialize identity resolver if enabled
    if (this.options.enableIdentityResolution) {
      this.identityResolver = createIdentityResolver(this.options.identityResolverOptions)
    }

    // Register audience destinations
    if (this.options.audienceDestinations) {
      for (const dest of this.options.audienceDestinations) {
        this.audienceDestinations.set(dest.name, dest)
      }
    }
  }

  /**
   * Add a computed trait.
   */
  addComputedTrait(config: ComputedTraitConfig): void {
    const trait = new ComputedTrait(config)
    this.computedTraits.set(config.name, trait)
  }

  /**
   * Check if a computed trait exists.
   */
  hasComputedTrait(name: string): boolean {
    return this.computedTraits.has(name)
  }

  /**
   * Get all computed trait names.
   */
  getComputedTraitNames(): string[] {
    return Array.from(this.computedTraits.keys())
  }

  /**
   * Add an audience.
   */
  addAudience(config: AudienceConfig): void {
    const audience = new Audience(config)
    this.audiences.set(config.name, audience)
  }

  /**
   * Add an enhanced audience with rules.
   */
  addEnhancedAudience(config: EnhancedAudienceConfig): void {
    this.enhancedAudiences.set(config.name, config)

    // Create condition function from rules if provided
    let condition = config.condition
    if (config.rules) {
      condition = (profile: UserProfile) => this.evaluateAudienceRule(config.rules!, profile)
    }

    const audience = new Audience({
      name: config.name,
      description: config.description,
      condition,
    })
    this.audiences.set(config.name, audience)
  }

  /**
   * Check if an audience exists.
   */
  hasAudience(name: string): boolean {
    return this.audiences.has(name)
  }

  /**
   * Get all audience names.
   */
  getAudienceNames(): string[] {
    return Array.from(this.audiences.keys())
  }

  /**
   * Get audience configuration.
   */
  getAudienceConfig(name: string): EnhancedAudienceConfig | undefined {
    return this.enhancedAudiences.get(name)
  }

  /**
   * Process events for a user and update their profile.
   */
  processEvents(userId: string, newEvents: SegmentEvent[]): UserProfile {
    // Get or create profile
    let profile = this.profiles.get(userId) || this.createEmptyProfile(userId)
    const now = new Date().toISOString()

    // Update last activity
    ;(profile as ExtendedUserProfile).lastActivityAt = now

    // Process through identity resolver if enabled
    if (this.identityResolver) {
      for (const event of newEvents) {
        const mergedProfile = this.identityResolver.processEvent(event)
        if (mergedProfile) {
          // Update identity nodes on profile
          ;(profile as ExtendedUserProfile).identityNodes = mergedProfile.identities
          ;(profile as ExtendedUserProfile).confidenceScore = this.calculateConfidenceScore(mergedProfile)
        }
      }
    }

    // Get or create events list
    const userEvents = this.events.get(userId) || []

    // Add new events
    userEvents.push(...newEvents)
    this.events.set(userId, userEvents)

    // Process identify events to update traits
    for (const event of newEvents) {
      if (event.type === 'identify' && event.traits) {
        profile.traits = { ...profile.traits, ...event.traits }

        // Extract external IDs from traits if present
        this.extractExternalIds(profile as ExtendedUserProfile, event.traits)
      }
    }

    // Store previous computed trait values for history tracking
    const previousComputedTraits = { ...profile.computedTraits }

    // Store previous audience memberships
    const previousAudiences = new Set(profile.audiences)

    // Compute all traits
    for (const trait of this.computedTraits.values()) {
      const result = trait.compute(userEvents)
      const previousValue = previousComputedTraits[trait.name]
      const newValue = result.value

      profile.computedTraits[trait.name] = newValue

      // Track trait history if enabled
      if (this.options.enableTraitHistory && !this.valuesEqual(previousValue, newValue)) {
        this.recordTraitChange(userId, trait.name, previousValue, newValue, newEvents[newEvents.length - 1]?.event)

        // Notify on trait change
        if (this.options.onTraitChanged) {
          this.options.onTraitChanged(userId, trait.name, previousValue, newValue)
        }
      }
    }

    // Evaluate all audiences
    const newAudiences: string[] = []
    for (const audience of this.audiences.values()) {
      const result = audience.evaluate(profile)
      if (result.member) {
        newAudiences.push(audience.name)

        // Check for audience entry
        if (!previousAudiences.has(audience.name)) {
          if (!profile.audienceTimestamps) {
            profile.audienceTimestamps = {}
          }
          profile.audienceTimestamps[audience.name] = result.enteredAt || now

          // Notify on entry
          if (this.options.onAudienceEnter) {
            this.options.onAudienceEnter(userId, audience.name)
          }

          // Sync to destinations if configured
          this.syncAudienceEntry(userId, audience.name, profile)
        }
      } else {
        // Check for audience exit
        if (previousAudiences.has(audience.name)) {
          if (this.options.onAudienceExit) {
            this.options.onAudienceExit(userId, audience.name)
          }

          // Sync exit to destinations
          this.syncAudienceExit(userId, audience.name, profile)
        }
      }
    }

    profile.audiences = newAudiences

    // Store updated profile
    this.profiles.set(userId, profile as ExtendedUserProfile)

    // Notify on profile update
    if (this.options.onProfileUpdated) {
      this.options.onProfileUpdated(profile)
    }

    return profile
  }

  /**
   * Get a user profile.
   */
  getProfile(userId: string): UserProfile | undefined {
    return this.profiles.get(userId)
  }

  /**
   * Get extended user profile with additional data.
   */
  getExtendedProfile(userId: string): ExtendedUserProfile | undefined {
    const profile = this.profiles.get(userId)
    if (!profile) return undefined

    // Include trait histories if enabled
    if (this.options.enableTraitHistory) {
      const histories = this.traitHistories.get(userId)
      if (histories) {
        profile.traitHistories = Object.fromEntries(histories)
      }
    }

    return profile
  }

  /**
   * Get trait history for a user.
   */
  getTraitHistory(userId: string, traitName: string): TraitHistory | undefined {
    const userHistories = this.traitHistories.get(userId)
    return userHistories?.get(traitName)
  }

  /**
   * Get all trait histories for a user.
   */
  getAllTraitHistories(userId: string): Record<string, TraitHistory> | undefined {
    const userHistories = this.traitHistories.get(userId)
    if (!userHistories) return undefined
    return Object.fromEntries(userHistories)
  }

  /**
   * Add an external ID to a user profile.
   */
  addExternalId(userId: string, externalId: ExternalId): void {
    const profile = this.profiles.get(userId)
    if (!profile) return

    if (!profile.externalIds) {
      profile.externalIds = []
    }

    // Check if this external ID already exists
    const existingIndex = profile.externalIds.findIndex(
      (e) => e.type === externalId.type && e.id === externalId.id
    )

    if (existingIndex >= 0) {
      // Update existing
      profile.externalIds[existingIndex] = externalId
    } else {
      // Add new
      profile.externalIds.push(externalId)
    }
  }

  /**
   * Get external IDs for a user.
   */
  getExternalIds(userId: string): ExternalId[] | undefined {
    return this.profiles.get(userId)?.externalIds
  }

  /**
   * Lookup profile by external ID.
   */
  lookupByExternalId(type: string, id: string): ExtendedUserProfile | undefined {
    for (const profile of this.profiles.values()) {
      if (profile.externalIds?.some((e) => e.type === type && e.id === id)) {
        return profile
      }
    }
    return undefined
  }

  /**
   * Get unified profile from identity resolver.
   */
  getUnifiedProfile(userId: string): MergedProfile | null {
    if (!this.identityResolver) return null
    return this.identityResolver.lookupProfile({ userId })
  }

  /**
   * Get all profiles in a specific audience.
   */
  getAudienceMembers(audienceName: string): ExtendedUserProfile[] {
    return Array.from(this.profiles.values()).filter((p) => p.audiences.includes(audienceName))
  }

  /**
   * Get audience size.
   */
  getAudienceSize(audienceName: string): number {
    return this.getAudienceMembers(audienceName).length
  }

  /**
   * Export a user profile to JSON.
   */
  exportProfile(userId: string): UserProfile | undefined {
    const profile = this.profiles.get(userId)
    if (!profile) return undefined

    return {
      ...profile,
      traits: { ...profile.traits },
      computedTraits: { ...profile.computedTraits },
      audiences: [...profile.audiences],
    }
  }

  /**
   * Get all events for a user.
   */
  getEventsForUser(userId: string): SegmentEvent[] {
    return this.events.get(userId) || []
  }

  /**
   * Register an audience destination.
   */
  registerAudienceDestination(destination: Destination): void {
    this.audienceDestinations.set(destination.name, destination)
  }

  /**
   * Get all registered audience destinations.
   */
  getAudienceDestinations(): Destination[] {
    return Array.from(this.audienceDestinations.values())
  }

  /**
   * Clear all data.
   */
  clear(): void {
    this.profiles.clear()
    this.events.clear()
    this.traitHistories.clear()
    if (this.identityResolver) {
      this.identityResolver.clear()
    }
  }

  /**
   * Get engine statistics.
   */
  getStats(): {
    profileCount: number
    eventCount: number
    traitCount: number
    audienceCount: number
    identityCount: number
  } {
    let totalEvents = 0
    for (const events of this.events.values()) {
      totalEvents += events.length
    }

    return {
      profileCount: this.profiles.size,
      eventCount: totalEvents,
      traitCount: this.computedTraits.size,
      audienceCount: this.audiences.size,
      identityCount: this.identityResolver?.getIdentityCount() ?? 0,
    }
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  private createEmptyProfile(userId: string): ExtendedUserProfile {
    const now = new Date().toISOString()
    return {
      userId,
      traits: {},
      computedTraits: {},
      audiences: [],
      externalIds: [],
      createdAt: now,
      lastActivityAt: now,
    }
  }

  private calculateConfidenceScore(mergedProfile: MergedProfile): number {
    // Calculate confidence based on number of identities and their individual confidence
    const identities = mergedProfile.identities
    if (identities.length === 0) return 0

    const avgConfidence = identities.reduce((sum, i) => sum + i.confidence, 0) / identities.length
    const identityBonus = Math.min(identities.length * 0.1, 0.3) // More identities = higher confidence

    return Math.min(avgConfidence + identityBonus, 1.0)
  }

  private extractExternalIds(profile: ExtendedUserProfile, traits: Traits): void {
    // Look for common external ID patterns in traits
    const externalIdPatterns = [
      { traitKey: 'salesforce_id', type: 'salesforce' },
      { traitKey: 'salesforceId', type: 'salesforce' },
      { traitKey: 'hubspot_id', type: 'hubspot' },
      { traitKey: 'hubspotId', type: 'hubspot' },
      { traitKey: 'stripe_customer_id', type: 'stripe', collection: 'customers' },
      { traitKey: 'stripeCustomerId', type: 'stripe', collection: 'customers' },
      { traitKey: 'intercom_id', type: 'intercom' },
      { traitKey: 'intercomId', type: 'intercom' },
      { traitKey: 'zendesk_id', type: 'zendesk' },
      { traitKey: 'zendeskId', type: 'zendesk' },
    ]

    if (!profile.externalIds) {
      profile.externalIds = []
    }

    for (const pattern of externalIdPatterns) {
      const value = traits[pattern.traitKey]
      if (value && typeof value === 'string') {
        const existingIndex = profile.externalIds.findIndex((e) => e.type === pattern.type)
        const externalId: ExternalId = {
          type: pattern.type,
          id: value,
          collection: pattern.collection,
        }

        if (existingIndex >= 0) {
          profile.externalIds[existingIndex] = externalId
        } else {
          profile.externalIds.push(externalId)
        }
      }
    }
  }

  private recordTraitChange(
    userId: string,
    traitName: string,
    previousValue: unknown,
    newValue: unknown,
    triggerEvent?: string
  ): void {
    if (!this.traitHistories.has(userId)) {
      this.traitHistories.set(userId, new Map())
    }

    const userHistories = this.traitHistories.get(userId)!

    if (!userHistories.has(traitName)) {
      userHistories.set(traitName, {
        traitName,
        history: [],
        currentValue: newValue,
      })
    }

    const history = userHistories.get(traitName)!
    history.history.push({
      timestamp: new Date().toISOString(),
      previousValue,
      newValue,
      triggerEvent,
    })
    history.currentValue = newValue
  }

  private valuesEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true
    if (typeof a !== typeof b) return false
    if (Array.isArray(a) && Array.isArray(b)) {
      return a.length === b.length && a.every((v, i) => this.valuesEqual(v, b[i]))
    }
    if (typeof a === 'object' && a !== null && b !== null) {
      const aKeys = Object.keys(a as object)
      const bKeys = Object.keys(b as object)
      return (
        aKeys.length === bKeys.length &&
        aKeys.every((k) => this.valuesEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
      )
    }
    return false
  }

  private evaluateAudienceRule(rule: AudienceRule, profile: UserProfile): boolean {
    const results = rule.conditions.map((condition) => {
      if ('combinator' in condition) {
        // Nested rule
        return this.evaluateAudienceRule(condition, profile)
      } else {
        // Single condition
        return this.evaluateAudienceCondition(condition, profile)
      }
    })

    if (rule.combinator === 'AND') {
      return results.every(Boolean)
    } else {
      return results.some(Boolean)
    }
  }

  private evaluateAudienceCondition(condition: AudienceCondition, profile: UserProfile): boolean {
    // Get the value from the appropriate source
    let value: unknown
    if (condition.source === 'traits') {
      value = profile.traits[condition.trait]
    } else if (condition.source === 'computedTraits') {
      value = profile.computedTraits[condition.trait]
    } else {
      // Custom source - could be extended
      return false
    }

    // Apply the operator
    return this.applyOperator(value, condition.operator, condition.value)
  }

  private applyOperator(value: unknown, operator: AudienceOperator, compareValue?: unknown): boolean {
    switch (operator) {
      case 'equals':
        return value === compareValue

      case 'not_equals':
        return value !== compareValue

      case 'greater_than':
        return typeof value === 'number' && typeof compareValue === 'number' && value > compareValue

      case 'less_than':
        return typeof value === 'number' && typeof compareValue === 'number' && value < compareValue

      case 'greater_than_or_equals':
        return typeof value === 'number' && typeof compareValue === 'number' && value >= compareValue

      case 'less_than_or_equals':
        return typeof value === 'number' && typeof compareValue === 'number' && value <= compareValue

      case 'contains':
        return typeof value === 'string' && typeof compareValue === 'string' && value.includes(compareValue)

      case 'not_contains':
        return typeof value === 'string' && typeof compareValue === 'string' && !value.includes(compareValue)

      case 'starts_with':
        return typeof value === 'string' && typeof compareValue === 'string' && value.startsWith(compareValue)

      case 'ends_with':
        return typeof value === 'string' && typeof compareValue === 'string' && value.endsWith(compareValue)

      case 'in_list':
        return Array.isArray(compareValue) && compareValue.includes(value)

      case 'not_in_list':
        return Array.isArray(compareValue) && !compareValue.includes(value)

      case 'is_set':
        return value !== undefined && value !== null

      case 'is_not_set':
        return value === undefined || value === null

      case 'within_last_n_days':
        if (typeof value !== 'string' || typeof compareValue !== 'number') return false
        const dateValue = new Date(value).getTime()
        const cutoff = Date.now() - compareValue * 24 * 60 * 60 * 1000
        return dateValue >= cutoff

      case 'more_than_n_days_ago':
        if (typeof value !== 'string' || typeof compareValue !== 'number') return false
        const dateVal = new Date(value).getTime()
        const threshold = Date.now() - compareValue * 24 * 60 * 60 * 1000
        return dateVal < threshold

      default:
        return false
    }
  }

  private async syncAudienceEntry(userId: string, audienceName: string, profile: UserProfile): Promise<void> {
    const config = this.enhancedAudiences.get(audienceName)
    if (!config?.syncDestinations) return

    for (const destName of config.syncDestinations) {
      const destination = this.audienceDestinations.get(destName)
      if (destination) {
        try {
          // Send an identify event with audience membership
          await destination.identify({
            type: 'identify',
            messageId: `audience_entry_${userId}_${audienceName}_${Date.now()}`,
            timestamp: new Date().toISOString(),
            userId,
            traits: {
              [`audience_${audienceName}`]: true,
              [`audience_${audienceName}_entered_at`]: new Date().toISOString(),
            },
          })
        } catch {
          // Ignore destination errors
        }
      }
    }
  }

  private async syncAudienceExit(userId: string, audienceName: string, profile: UserProfile): Promise<void> {
    const config = this.enhancedAudiences.get(audienceName)
    if (!config?.syncDestinations) return

    for (const destName of config.syncDestinations) {
      const destination = this.audienceDestinations.get(destName)
      if (destination) {
        try {
          // Send an identify event with audience removal
          await destination.identify({
            type: 'identify',
            messageId: `audience_exit_${userId}_${audienceName}_${Date.now()}`,
            timestamp: new Date().toISOString(),
            userId,
            traits: {
              [`audience_${audienceName}`]: false,
              [`audience_${audienceName}_exited_at`]: new Date().toISOString(),
            },
          })
        } catch {
          // Ignore destination errors
        }
      }
    }
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a computed trait.
 */
export function createComputedTrait(config: ComputedTraitConfig): ComputedTrait {
  return new ComputedTrait(config)
}

/**
 * Create an audience.
 */
export function createAudience(config: AudienceConfig): Audience {
  return new Audience(config)
}

/**
 * Create an enhanced audience with rules.
 */
export function createEnhancedAudience(config: EnhancedAudienceConfig): Audience {
  // Create condition function from rules if provided
  let condition = config.condition
  if (config.rules && !condition) {
    // Placeholder - full evaluation happens in PersonasEngine
    condition = () => false
  }

  return new Audience({
    name: config.name,
    description: config.description,
    condition,
  })
}

/**
 * Create a personas engine.
 */
export function createPersonasEngine(options?: PersonasEngineOptions): PersonasEngine {
  return new PersonasEngine(options)
}

// =============================================================================
// Audience Builder DSL
// =============================================================================

/**
 * Builder for creating audience rules with a fluent API.
 */
export class AudienceBuilder {
  private conditions: Array<AudienceCondition | AudienceRule> = []
  private combinator: 'AND' | 'OR' = 'AND'

  /**
   * Set the combinator to AND.
   */
  and(): this {
    this.combinator = 'AND'
    return this
  }

  /**
   * Set the combinator to OR.
   */
  or(): this {
    this.combinator = 'OR'
    return this
  }

  /**
   * Add a trait condition.
   */
  trait(name: string): ConditionBuilder {
    return new ConditionBuilder(this, 'traits', name)
  }

  /**
   * Add a computed trait condition.
   */
  computedTrait(name: string): ConditionBuilder {
    return new ConditionBuilder(this, 'computedTraits', name)
  }

  /**
   * Add a nested rule group.
   */
  group(builder: (b: AudienceBuilder) => AudienceBuilder): this {
    const nested = builder(new AudienceBuilder())
    this.conditions.push(nested.build())
    return this
  }

  /**
   * Add a raw condition.
   */
  addCondition(condition: AudienceCondition): this {
    this.conditions.push(condition)
    return this
  }

  /**
   * Build the audience rule.
   */
  build(): AudienceRule {
    return {
      combinator: this.combinator,
      conditions: this.conditions,
    }
  }
}

/**
 * Builder for individual conditions.
 */
class ConditionBuilder {
  private audienceBuilder: AudienceBuilder
  private source: 'traits' | 'computedTraits'
  private trait: string

  constructor(audienceBuilder: AudienceBuilder, source: 'traits' | 'computedTraits', trait: string) {
    this.audienceBuilder = audienceBuilder
    this.source = source
    this.trait = trait
  }

  private addCondition(operator: AudienceOperator, value?: unknown): AudienceBuilder {
    this.audienceBuilder.addCondition({
      source: this.source,
      trait: this.trait,
      operator,
      value,
    })
    return this.audienceBuilder
  }

  equals(value: unknown): AudienceBuilder {
    return this.addCondition('equals', value)
  }

  notEquals(value: unknown): AudienceBuilder {
    return this.addCondition('not_equals', value)
  }

  greaterThan(value: number): AudienceBuilder {
    return this.addCondition('greater_than', value)
  }

  lessThan(value: number): AudienceBuilder {
    return this.addCondition('less_than', value)
  }

  greaterThanOrEquals(value: number): AudienceBuilder {
    return this.addCondition('greater_than_or_equals', value)
  }

  lessThanOrEquals(value: number): AudienceBuilder {
    return this.addCondition('less_than_or_equals', value)
  }

  contains(value: string): AudienceBuilder {
    return this.addCondition('contains', value)
  }

  notContains(value: string): AudienceBuilder {
    return this.addCondition('not_contains', value)
  }

  startsWith(value: string): AudienceBuilder {
    return this.addCondition('starts_with', value)
  }

  endsWith(value: string): AudienceBuilder {
    return this.addCondition('ends_with', value)
  }

  inList(values: unknown[]): AudienceBuilder {
    return this.addCondition('in_list', values)
  }

  notInList(values: unknown[]): AudienceBuilder {
    return this.addCondition('not_in_list', values)
  }

  isSet(): AudienceBuilder {
    return this.addCondition('is_set')
  }

  isNotSet(): AudienceBuilder {
    return this.addCondition('is_not_set')
  }

  withinLastNDays(days: number): AudienceBuilder {
    return this.addCondition('within_last_n_days', days)
  }

  moreThanNDaysAgo(days: number): AudienceBuilder {
    return this.addCondition('more_than_n_days_ago', days)
  }
}

/**
 * Create an audience builder.
 */
export function audienceBuilder(): AudienceBuilder {
  return new AudienceBuilder()
}

// =============================================================================
// Prebuilt Audiences
// =============================================================================

/**
 * Create a high-value customer audience.
 */
export function highValueCustomersAudience(threshold: number = 1000): EnhancedAudienceConfig {
  return {
    name: 'High Value Customers',
    description: `Customers with total revenue > $${threshold}`,
    condition: (profile) => (profile.computedTraits.total_revenue as number) > threshold,
    rules: {
      combinator: 'AND',
      conditions: [
        {
          source: 'computedTraits',
          trait: 'total_revenue',
          operator: 'greater_than',
          value: threshold,
        },
      ],
    },
    tags: ['revenue', 'high-value'],
  }
}

/**
 * Create an at-risk churn audience.
 */
export function atRiskChurnAudience(inactiveDays: number = 30): EnhancedAudienceConfig {
  return {
    name: 'At Risk - Churn',
    description: `Users inactive for ${inactiveDays}+ days who were previously active`,
    condition: (profile) => {
      const lastActivity = profile.computedTraits.days_since_last_activity as number
      const previousActivity = profile.computedTraits.total_activities as number
      return lastActivity >= inactiveDays && previousActivity > 5
    },
    rules: {
      combinator: 'AND',
      conditions: [
        {
          source: 'computedTraits',
          trait: 'days_since_last_activity',
          operator: 'greater_than_or_equals',
          value: inactiveDays,
        },
        {
          source: 'computedTraits',
          trait: 'total_activities',
          operator: 'greater_than',
          value: 5,
        },
      ],
    },
    tags: ['churn', 'retention', 'at-risk'],
  }
}

/**
 * Create a new user audience.
 */
export function newUsersAudience(daysSinceSignup: number = 7): EnhancedAudienceConfig {
  return {
    name: 'New Users',
    description: `Users who signed up within the last ${daysSinceSignup} days`,
    condition: (profile) => {
      const signupDays = profile.computedTraits.days_since_signup as number
      return signupDays !== null && signupDays <= daysSinceSignup
    },
    rules: {
      combinator: 'AND',
      conditions: [
        {
          source: 'computedTraits',
          trait: 'days_since_signup',
          operator: 'less_than_or_equals',
          value: daysSinceSignup,
        },
      ],
    },
    tags: ['new-users', 'onboarding'],
  }
}

/**
 * Create an enterprise plan audience.
 */
export function enterprisePlanAudience(): EnhancedAudienceConfig {
  return {
    name: 'Enterprise Plan Users',
    description: 'Users on enterprise pricing plan',
    condition: (profile) => profile.traits.plan === 'enterprise',
    rules: {
      combinator: 'AND',
      conditions: [
        {
          source: 'traits',
          trait: 'plan',
          operator: 'equals',
          value: 'enterprise',
        },
      ],
    },
    tags: ['enterprise', 'plans'],
  }
}
