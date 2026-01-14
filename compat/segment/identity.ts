/**
 * @dotdo/segment - Identity Resolution
 *
 * Segment Identity Resolution compatibility layer providing:
 * - User profile merging across anonymous and known identities
 * - Identity graph management
 * - Profile stitching across devices/sessions
 * - Alias relationship tracking
 *
 * @module @dotdo/segment/identity
 */

import type { SegmentEvent, Traits } from './types.js'

// =============================================================================
// Types
// =============================================================================

/**
 * Identity types for the graph
 */
export type IdentityType = 'user_id' | 'anonymous_id' | 'email' | 'phone' | 'device_id' | 'custom'

/**
 * An identity node in the graph
 */
export interface IdentityNode {
  /** The identity type */
  type: IdentityType
  /** The identity value */
  value: string
  /** When this identity was first seen */
  firstSeen: string
  /** When this identity was last seen */
  lastSeen: string
  /** Confidence score (0-1) */
  confidence: number
}

/**
 * An edge connecting two identities
 */
export interface IdentityEdge {
  /** Source identity */
  source: IdentityNode
  /** Target identity */
  target: IdentityNode
  /** How the connection was established */
  method: 'identify' | 'alias' | 'track' | 'inferred'
  /** When the connection was established */
  createdAt: string
  /** Confidence score for this connection */
  confidence: number
}

/**
 * A merged user profile
 */
export interface MergedProfile {
  /** The canonical user ID (primary identifier) */
  canonicalId: string
  /** All identity nodes associated with this profile */
  identities: IdentityNode[]
  /** All edges in the identity graph for this profile */
  edges: IdentityEdge[]
  /** Merged traits from all identity sources */
  traits: Traits
  /** When this profile was created */
  createdAt: string
  /** When this profile was last updated */
  updatedAt: string
  /** Merge history */
  mergeHistory: MergeEvent[]
}

/**
 * A merge event in the profile history
 */
export interface MergeEvent {
  /** Type of merge */
  type: 'create' | 'merge' | 'update_traits' | 'add_identity'
  /** When the merge happened */
  timestamp: string
  /** Identities involved */
  identities: string[]
  /** Additional metadata */
  metadata?: Record<string, unknown>
}

/**
 * Identity resolution options
 */
export interface IdentityResolverOptions {
  /** Minimum confidence score to merge profiles (0-1, default: 0.5) */
  mergeThreshold?: number
  /** Custom identity extractors */
  identityExtractors?: IdentityExtractor[]
  /** Callback when profiles are merged */
  onProfileMerged?: (profile: MergedProfile, mergedFrom: string[]) => void
  /** Callback when a new identity is discovered */
  onIdentityDiscovered?: (identity: IdentityNode, profileId: string) => void
}

/**
 * Custom identity extractor function
 */
export interface IdentityExtractor {
  /** Identity type this extractor handles */
  type: IdentityType | string
  /** Extract identity value from an event */
  extract: (event: SegmentEvent) => string | null
}

/**
 * Query options for looking up profiles
 */
export interface ProfileQuery {
  /** User ID to look up */
  userId?: string
  /** Anonymous ID to look up */
  anonymousId?: string
  /** Email to look up */
  email?: string
  /** Custom identity type and value */
  custom?: { type: string; value: string }
}

// =============================================================================
// IdentityResolver Class
// =============================================================================

/**
 * Identity Resolver manages user identity resolution and profile merging.
 */
export class IdentityResolver {
  private profiles: Map<string, MergedProfile> = new Map()
  private identityIndex: Map<string, string> = new Map() // identity -> canonicalId
  private readonly options: Required<IdentityResolverOptions>

  constructor(options?: IdentityResolverOptions) {
    this.options = {
      mergeThreshold: options?.mergeThreshold ?? 0.5,
      identityExtractors: options?.identityExtractors ?? [],
      onProfileMerged: options?.onProfileMerged ?? (() => {}),
      onIdentityDiscovered: options?.onIdentityDiscovered ?? (() => {}),
    }
  }

  /**
   * Process an event and update identity resolution.
   */
  processEvent(event: SegmentEvent): MergedProfile | null {
    const identities = this.extractIdentities(event)
    if (identities.length === 0) return null

    // Find existing profiles for these identities
    const existingProfileIds = new Set<string>()
    for (const identity of identities) {
      const key = this.getIdentityKey(identity)
      const profileId = this.identityIndex.get(key)
      if (profileId) {
        existingProfileIds.add(profileId)
      }
    }

    let profile: MergedProfile

    if (existingProfileIds.size === 0) {
      // Create new profile
      profile = this.createProfile(identities, event)
    } else if (existingProfileIds.size === 1) {
      // Update existing profile
      const profileId = Array.from(existingProfileIds)[0]!
      profile = this.updateProfile(profileId, identities, event)
    } else {
      // Merge multiple profiles
      const profileIds = Array.from(existingProfileIds)
      profile = this.mergeProfiles(profileIds, identities, event)
    }

    // Update traits from identify events
    if (event.type === 'identify' && event.traits) {
      profile.traits = this.mergeTraits(profile.traits, event.traits)
      profile.updatedAt = new Date().toISOString()
      profile.mergeHistory.push({
        type: 'update_traits',
        timestamp: new Date().toISOString(),
        identities: identities.map((i) => `${i.type}:${i.value}`),
      })
    }

    // Handle alias events
    if (event.type === 'alias' && event.previousId) {
      this.processAlias(profile, event)
    }

    return profile
  }

  /**
   * Look up a profile by various identifiers.
   */
  lookupProfile(query: ProfileQuery): MergedProfile | null {
    if (query.userId) {
      const key = this.getIdentityKey({ type: 'user_id', value: query.userId } as IdentityNode)
      const profileId = this.identityIndex.get(key)
      if (profileId) return this.profiles.get(profileId) || null
    }

    if (query.anonymousId) {
      const key = this.getIdentityKey({ type: 'anonymous_id', value: query.anonymousId } as IdentityNode)
      const profileId = this.identityIndex.get(key)
      if (profileId) return this.profiles.get(profileId) || null
    }

    if (query.email) {
      const key = this.getIdentityKey({ type: 'email', value: query.email } as IdentityNode)
      const profileId = this.identityIndex.get(key)
      if (profileId) return this.profiles.get(profileId) || null
    }

    if (query.custom) {
      const key = this.getIdentityKey({
        type: query.custom.type as IdentityType,
        value: query.custom.value,
      } as IdentityNode)
      const profileId = this.identityIndex.get(key)
      if (profileId) return this.profiles.get(profileId) || null
    }

    return null
  }

  /**
   * Get a profile by its canonical ID.
   */
  getProfile(canonicalId: string): MergedProfile | null {
    return this.profiles.get(canonicalId) || null
  }

  /**
   * Get all profiles.
   */
  getAllProfiles(): MergedProfile[] {
    return Array.from(this.profiles.values())
  }

  /**
   * Get all identities for a profile.
   */
  getIdentitiesForProfile(canonicalId: string): IdentityNode[] {
    const profile = this.profiles.get(canonicalId)
    return profile?.identities || []
  }

  /**
   * Get the identity graph for a profile.
   */
  getIdentityGraph(canonicalId: string): { nodes: IdentityNode[]; edges: IdentityEdge[] } | null {
    const profile = this.profiles.get(canonicalId)
    if (!profile) return null

    return {
      nodes: [...profile.identities],
      edges: [...profile.edges],
    }
  }

  /**
   * Manually merge two profiles.
   */
  manualMerge(canonicalId1: string, canonicalId2: string): MergedProfile | null {
    const profile1 = this.profiles.get(canonicalId1)
    const profile2 = this.profiles.get(canonicalId2)

    if (!profile1 || !profile2) return null

    return this.mergeProfiles([canonicalId1, canonicalId2], [], undefined)
  }

  /**
   * Get profile count.
   */
  getProfileCount(): number {
    return this.profiles.size
  }

  /**
   * Get identity count.
   */
  getIdentityCount(): number {
    return this.identityIndex.size
  }

  /**
   * Clear all data.
   */
  clear(): void {
    this.profiles.clear()
    this.identityIndex.clear()
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  private extractIdentities(event: SegmentEvent): IdentityNode[] {
    const identities: IdentityNode[] = []
    const now = new Date().toISOString()

    // Extract userId
    if (event.userId) {
      identities.push({
        type: 'user_id',
        value: event.userId,
        firstSeen: now,
        lastSeen: now,
        confidence: 1.0,
      })
    }

    // Extract anonymousId
    if (event.anonymousId) {
      identities.push({
        type: 'anonymous_id',
        value: event.anonymousId,
        firstSeen: now,
        lastSeen: now,
        confidence: 0.8,
      })
    }

    // Extract email from traits
    const email = event.traits?.email as string | undefined
    if (email && typeof email === 'string') {
      identities.push({
        type: 'email',
        value: email.toLowerCase(),
        firstSeen: now,
        lastSeen: now,
        confidence: 0.9,
      })
    }

    // Extract phone from traits
    const phone = event.traits?.phone as string | undefined
    if (phone && typeof phone === 'string') {
      identities.push({
        type: 'phone',
        value: this.normalizePhone(phone),
        firstSeen: now,
        lastSeen: now,
        confidence: 0.85,
      })
    }

    // Extract device ID from context
    const deviceId = event.context?.device?.id as string | undefined
    if (deviceId) {
      identities.push({
        type: 'device_id',
        value: deviceId,
        firstSeen: now,
        lastSeen: now,
        confidence: 0.7,
      })
    }

    // Apply custom extractors
    for (const extractor of this.options.identityExtractors) {
      const value = extractor.extract(event)
      if (value) {
        identities.push({
          type: extractor.type as IdentityType,
          value,
          firstSeen: now,
          lastSeen: now,
          confidence: 0.75,
        })
      }
    }

    return identities
  }

  private getIdentityKey(identity: IdentityNode): string {
    return `${identity.type}:${identity.value}`
  }

  private generateCanonicalId(): string {
    const bytes = new Uint8Array(16)
    crypto.getRandomValues(bytes)
    const hex = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
    return `profile_${hex}`
  }

  private createProfile(identities: IdentityNode[], event?: SegmentEvent): MergedProfile {
    const now = new Date().toISOString()
    const canonicalId = this.generateCanonicalId()

    // Create edges between identities
    const edges = this.createEdges(identities, event?.type === 'identify' ? 'identify' : 'track')

    const profile: MergedProfile = {
      canonicalId,
      identities: [...identities],
      edges,
      traits: event?.type === 'identify' && event.traits ? { ...event.traits } : {},
      createdAt: now,
      updatedAt: now,
      mergeHistory: [
        {
          type: 'create',
          timestamp: now,
          identities: identities.map((i) => `${i.type}:${i.value}`),
        },
      ],
    }

    // Store profile
    this.profiles.set(canonicalId, profile)

    // Index identities
    for (const identity of identities) {
      const key = this.getIdentityKey(identity)
      this.identityIndex.set(key, canonicalId)
      this.options.onIdentityDiscovered(identity, canonicalId)
    }

    return profile
  }

  private updateProfile(
    profileId: string,
    identities: IdentityNode[],
    event?: SegmentEvent
  ): MergedProfile {
    const profile = this.profiles.get(profileId)!
    const now = new Date().toISOString()

    // Add new identities
    const newIdentities: IdentityNode[] = []
    for (const identity of identities) {
      const key = this.getIdentityKey(identity)
      const existing = profile.identities.find(
        (i) => i.type === identity.type && i.value === identity.value
      )

      if (existing) {
        // Update lastSeen
        existing.lastSeen = now
      } else {
        // Add new identity
        newIdentities.push(identity)
        profile.identities.push(identity)
        this.identityIndex.set(key, profileId)
        this.options.onIdentityDiscovered(identity, profileId)
      }
    }

    // Create edges for new identities
    if (newIdentities.length > 0) {
      const newEdges = this.createEdges(
        [...profile.identities],
        event?.type === 'identify' ? 'identify' : 'track'
      )

      // Add only new edges
      for (const edge of newEdges) {
        const exists = profile.edges.some(
          (e) =>
            e.source.type === edge.source.type &&
            e.source.value === edge.source.value &&
            e.target.type === edge.target.type &&
            e.target.value === edge.target.value
        )
        if (!exists) {
          profile.edges.push(edge)
        }
      }

      profile.mergeHistory.push({
        type: 'add_identity',
        timestamp: now,
        identities: newIdentities.map((i) => `${i.type}:${i.value}`),
      })
    }

    profile.updatedAt = now
    return profile
  }

  private mergeProfiles(
    profileIds: string[],
    identities: IdentityNode[],
    event?: SegmentEvent
  ): MergedProfile {
    const now = new Date().toISOString()

    // Get all profiles to merge
    const profiles = profileIds.map((id) => this.profiles.get(id)!).filter(Boolean)

    // Use the oldest profile as the base
    profiles.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    const baseProfile = profiles[0]!

    // Merge all identities
    const allIdentities: Map<string, IdentityNode> = new Map()
    for (const profile of profiles) {
      for (const identity of profile.identities) {
        const key = this.getIdentityKey(identity)
        const existing = allIdentities.get(key)
        if (!existing || new Date(identity.firstSeen) < new Date(existing.firstSeen)) {
          allIdentities.set(key, identity)
        }
      }
    }

    // Add new identities from event
    for (const identity of identities) {
      const key = this.getIdentityKey(identity)
      if (!allIdentities.has(key)) {
        allIdentities.set(key, identity)
      }
    }

    // Merge all edges
    const allEdges: IdentityEdge[] = []
    const edgeSet = new Set<string>()
    for (const profile of profiles) {
      for (const edge of profile.edges) {
        const edgeKey = `${edge.source.type}:${edge.source.value}-${edge.target.type}:${edge.target.value}`
        if (!edgeSet.has(edgeKey)) {
          edgeSet.add(edgeKey)
          allEdges.push(edge)
        }
      }
    }

    // Create edges between identities from different profiles
    const identityArray = Array.from(allIdentities.values())
    const mergeEdges = this.createEdges(identityArray, 'identify')
    for (const edge of mergeEdges) {
      const edgeKey = `${edge.source.type}:${edge.source.value}-${edge.target.type}:${edge.target.value}`
      if (!edgeSet.has(edgeKey)) {
        edgeSet.add(edgeKey)
        allEdges.push(edge)
      }
    }

    // Merge traits
    let mergedTraits: Traits = {}
    for (const profile of profiles) {
      mergedTraits = this.mergeTraits(mergedTraits, profile.traits)
    }

    // Merge history
    const allHistory: MergeEvent[] = []
    for (const profile of profiles) {
      allHistory.push(...profile.mergeHistory)
    }
    allHistory.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())

    // Update base profile
    baseProfile.identities = identityArray
    baseProfile.edges = allEdges
    baseProfile.traits = mergedTraits
    baseProfile.updatedAt = now
    baseProfile.mergeHistory = [
      ...allHistory,
      {
        type: 'merge',
        timestamp: now,
        identities: profileIds,
        metadata: { mergedProfiles: profileIds.length },
      },
    ]

    // Update identity index
    for (const identity of identityArray) {
      const key = this.getIdentityKey(identity)
      this.identityIndex.set(key, baseProfile.canonicalId)
    }

    // Remove merged profiles (except base)
    for (const profileId of profileIds) {
      if (profileId !== baseProfile.canonicalId) {
        this.profiles.delete(profileId)
      }
    }

    // Notify
    this.options.onProfileMerged(baseProfile, profileIds)

    return baseProfile
  }

  private processAlias(profile: MergedProfile, event: SegmentEvent): void {
    const now = new Date().toISOString()

    // Look up profile for previousId
    const previousKey = `user_id:${event.previousId}`
    let previousProfileId = this.identityIndex.get(previousKey)

    // Also check anonymousId
    if (!previousProfileId) {
      const anonKey = `anonymous_id:${event.previousId}`
      previousProfileId = this.identityIndex.get(anonKey)
    }

    if (previousProfileId && previousProfileId !== profile.canonicalId) {
      // Merge profiles
      this.mergeProfiles([profile.canonicalId, previousProfileId], [], event)
    } else if (!previousProfileId) {
      // Add previousId as an identity
      const identity: IdentityNode = {
        type: 'user_id',
        value: event.previousId!,
        firstSeen: now,
        lastSeen: now,
        confidence: 0.9,
      }
      profile.identities.push(identity)
      this.identityIndex.set(this.getIdentityKey(identity), profile.canonicalId)

      // Add alias edge
      const currentIdentity = profile.identities.find(
        (i) => i.type === 'user_id' && i.value === event.userId
      )
      if (currentIdentity) {
        profile.edges.push({
          source: identity,
          target: currentIdentity,
          method: 'alias',
          createdAt: now,
          confidence: 1.0,
        })
      }
    }
  }

  private createEdges(
    identities: IdentityNode[],
    method: 'identify' | 'alias' | 'track' | 'inferred'
  ): IdentityEdge[] {
    const edges: IdentityEdge[] = []
    const now = new Date().toISOString()

    // Create edges between all pairs of identities
    for (let i = 0; i < identities.length; i++) {
      for (let j = i + 1; j < identities.length; j++) {
        const source = identities[i]!
        const target = identities[j]!

        edges.push({
          source,
          target,
          method,
          createdAt: now,
          confidence: Math.min(source.confidence, target.confidence),
        })
      }
    }

    return edges
  }

  private mergeTraits(base: Traits, incoming: Traits): Traits {
    const result = { ...base }

    for (const [key, value] of Object.entries(incoming)) {
      if (value !== undefined && value !== null) {
        // Prefer newer values (incoming overwrites base)
        result[key] = value
      }
    }

    return result
  }

  private normalizePhone(phone: string): string {
    // Remove all non-numeric characters
    return phone.replace(/\D/g, '')
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create an identity resolver instance.
 */
export function createIdentityResolver(options?: IdentityResolverOptions): IdentityResolver {
  return new IdentityResolver(options)
}
