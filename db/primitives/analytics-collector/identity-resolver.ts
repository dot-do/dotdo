/**
 * IdentityResolver - Identity resolution and user merging for analytics
 *
 * Provides comprehensive identity resolution capabilities:
 * - Anonymous user tracking with persistent identifiers
 * - Authenticated user identification and profile management
 * - Profile merging (anonymous -> authenticated)
 * - Identity graph management for cross-device/cross-session tracking
 *
 * @module db/primitives/analytics-collector/identity-resolver
 */

// ============================================================================
// TYPES
// ============================================================================

/**
 * Represents a node in the identity graph.
 * Each node represents a single identifier (anonymous or authenticated).
 */
export interface IdentityNode {
  /** The identifier value */
  id: string
  /** Type of identifier */
  type: 'anonymous' | 'user' | 'email' | 'phone' | 'device' | 'custom'
  /** When this identifier was first seen */
  firstSeen: Date
  /** When this identifier was last seen */
  lastSeen: Date
  /** Traits associated with this identifier */
  traits: Record<string, unknown>
}

/**
 * Represents an edge (link) between two identity nodes.
 */
export interface IdentityEdge {
  /** Source identifier */
  fromId: string
  /** Target identifier */
  toId: string
  /** Type of relationship */
  type: 'alias' | 'identify' | 'merge' | 'device' | 'inferred'
  /** When this link was created */
  createdAt: Date
  /** Confidence score (0-1) for the link */
  confidence: number
  /** Source of the link (e.g., 'identify_call', 'alias_call', 'device_fingerprint') */
  source: string
}

/**
 * A resolved identity profile representing a single user.
 * Aggregates all known identifiers and traits for a user.
 */
export interface ResolvedIdentity {
  /** Canonical user ID (if identified) */
  canonicalId: string | null
  /** All anonymous IDs associated with this user */
  anonymousIds: string[]
  /** All user IDs associated with this user (including merged accounts) */
  userIds: string[]
  /** All email addresses */
  emails: string[]
  /** All phone numbers */
  phones: string[]
  /** All device IDs */
  deviceIds: string[]
  /** Custom identifiers */
  customIds: Map<string, string[]>
  /** Merged traits from all identifiers (most recent wins) */
  traits: Record<string, unknown>
  /** When this identity was first created */
  createdAt: Date
  /** When this identity was last updated */
  updatedAt: Date
  /** History of merges */
  mergeHistory: MergeRecord[]
}

/**
 * Records a merge operation for audit trail.
 */
export interface MergeRecord {
  /** When the merge occurred */
  timestamp: Date
  /** The identifier that was merged in */
  sourceId: string
  /** The identifier it was merged into */
  targetId: string
  /** Type of merge operation */
  mergeType: 'alias' | 'identify' | 'auto'
  /** Traits that were inherited from the source */
  inheritedTraits: string[]
}

/**
 * Options for identity resolution behavior.
 */
export interface IdentityResolverOptions {
  /** Maximum number of anonymous IDs to track per identity (default: 100) */
  maxAnonymousIds?: number
  /** Maximum age of anonymous IDs before expiration in ms (default: 365 days) */
  anonymousIdTTL?: number
  /** Whether to auto-merge on email match (default: false) */
  autoMergeOnEmail?: boolean
  /** Whether to auto-merge on phone match (default: false) */
  autoMergeOnPhone?: boolean
  /** Minimum confidence threshold for auto-merge (default: 0.8) */
  autoMergeThreshold?: number
  /** Trait merge strategy (default: 'newest') */
  traitMergeStrategy?: 'newest' | 'oldest' | 'merge'
  /** Callback when identities are merged */
  onMerge?: (record: MergeRecord) => void
  /** Callback when a new identity is created */
  onIdentityCreated?: (identity: ResolvedIdentity) => void
}

/**
 * Input for the identify operation.
 */
export interface IdentifyInput {
  /** User ID (for authenticated users) */
  userId?: string
  /** Anonymous ID */
  anonymousId?: string
  /** User traits to set */
  traits?: Record<string, unknown>
  /** Additional identifiers */
  identifiers?: {
    email?: string
    phone?: string
    deviceId?: string
    [key: string]: string | undefined
  }
}

/**
 * Input for the alias operation.
 */
export interface AliasInput {
  /** Previous identifier */
  previousId: string
  /** New/canonical identifier */
  userId: string
}

/**
 * Result of a resolve operation.
 */
export interface ResolveResult {
  /** The resolved identity */
  identity: ResolvedIdentity
  /** Whether a merge occurred */
  merged: boolean
  /** Merge records if any merges occurred */
  merges: MergeRecord[]
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function generateCanonicalId(): string {
  const hex = '0123456789abcdef'
  let id = 'id_'
  for (let i = 0; i < 24; i++) {
    id += hex[Math.floor(Math.random() * 16)]
  }
  return id
}

function mergeTraits(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>,
  strategy: 'newest' | 'oldest' | 'merge'
): Record<string, unknown> {
  switch (strategy) {
    case 'oldest':
      // Keep existing values, only add new keys
      return { ...incoming, ...existing }
    case 'merge':
      // Deep merge arrays and objects
      const result = { ...existing }
      for (const [key, value] of Object.entries(incoming)) {
        if (Array.isArray(value) && Array.isArray(result[key])) {
          // Merge arrays (deduplicate)
          result[key] = [...new Set([...(result[key] as unknown[]), ...value])]
        } else if (
          typeof value === 'object' &&
          value !== null &&
          typeof result[key] === 'object' &&
          result[key] !== null
        ) {
          // Merge objects
          result[key] = { ...(result[key] as object), ...value }
        } else if (value !== undefined) {
          // Use newest for primitives
          result[key] = value
        }
      }
      return result
    case 'newest':
    default:
      // Incoming values overwrite existing
      return { ...existing, ...incoming }
  }
}

function createEmptyIdentity(): ResolvedIdentity {
  const now = new Date()
  return {
    canonicalId: null,
    anonymousIds: [],
    userIds: [],
    emails: [],
    phones: [],
    deviceIds: [],
    customIds: new Map(),
    traits: {},
    createdAt: now,
    updatedAt: now,
    mergeHistory: [],
  }
}

// ============================================================================
// IDENTITY RESOLVER CLASS
// ============================================================================

/**
 * IdentityResolver manages the identity graph and resolves user identities.
 *
 * @example
 * ```typescript
 * const resolver = new IdentityResolver({
 *   autoMergeOnEmail: true,
 *   onMerge: (record) => console.log('Merged:', record)
 * })
 *
 * // Track anonymous user
 * resolver.identify({ anonymousId: 'anon_123', traits: { referrer: 'google' } })
 *
 * // Later, user signs up
 * resolver.identify({
 *   userId: 'user_456',
 *   anonymousId: 'anon_123',
 *   traits: { email: 'john@example.com', name: 'John' }
 * })
 *
 * // Get resolved identity
 * const identity = resolver.resolve('user_456')
 * // identity.anonymousIds includes 'anon_123'
 * // identity.traits includes both referrer and name
 * ```
 */
export class IdentityResolver {
  readonly options: Required<
    Pick<
      IdentityResolverOptions,
      | 'maxAnonymousIds'
      | 'anonymousIdTTL'
      | 'autoMergeOnEmail'
      | 'autoMergeOnPhone'
      | 'autoMergeThreshold'
      | 'traitMergeStrategy'
    >
  > &
    Pick<IdentityResolverOptions, 'onMerge' | 'onIdentityCreated'>

  // Identity graph storage
  private nodes: Map<string, IdentityNode> = new Map()
  private edges: Map<string, IdentityEdge[]> = new Map()

  // Resolved identities cache
  private identities: Map<string, ResolvedIdentity> = new Map()

  // Indexes for fast lookup
  private emailIndex: Map<string, string[]> = new Map()
  private phoneIndex: Map<string, string[]> = new Map()
  private anonymousToCanonical: Map<string, string> = new Map()
  private userToCanonical: Map<string, string> = new Map()

  constructor(options: IdentityResolverOptions = {}) {
    this.options = {
      maxAnonymousIds: options.maxAnonymousIds ?? 100,
      anonymousIdTTL: options.anonymousIdTTL ?? 365 * 24 * 60 * 60 * 1000,
      autoMergeOnEmail: options.autoMergeOnEmail ?? false,
      autoMergeOnPhone: options.autoMergeOnPhone ?? false,
      autoMergeThreshold: options.autoMergeThreshold ?? 0.8,
      traitMergeStrategy: options.traitMergeStrategy ?? 'newest',
      onMerge: options.onMerge,
      onIdentityCreated: options.onIdentityCreated,
    }
  }

  /**
   * Identify a user, creating or updating their identity profile.
   * Links anonymous IDs to user IDs when both are provided.
   */
  identify(input: IdentifyInput): ResolveResult {
    const { userId, anonymousId, traits = {}, identifiers = {} } = input
    const now = new Date()
    const merges: MergeRecord[] = []

    if (!userId && !anonymousId) {
      throw new Error('userId or anonymousId is required')
    }

    // Find or create canonical identity
    let canonicalId = this.findCanonicalId(userId, anonymousId)
    let identity: ResolvedIdentity

    if (canonicalId) {
      identity = this.identities.get(canonicalId)!
    } else {
      // Create new identity
      canonicalId = generateCanonicalId()
      identity = createEmptyIdentity()
      this.identities.set(canonicalId, identity)
      this.options.onIdentityCreated?.(identity)
    }

    // Add user ID if provided
    if (userId && !identity.userIds.includes(userId)) {
      identity.userIds.push(userId)
      this.userToCanonical.set(userId, canonicalId)
      identity.canonicalId = userId // User ID becomes canonical

      // Create/update node
      this.addOrUpdateNode(userId, 'user', traits, now)
    }

    // Add anonymous ID if provided
    if (anonymousId) {
      const existingCanonical = this.anonymousToCanonical.get(anonymousId)

      if (existingCanonical && existingCanonical !== canonicalId) {
        // Anonymous ID belongs to different identity - merge!
        const mergeRecord = this.mergeIdentities(
          existingCanonical,
          canonicalId,
          'identify'
        )
        if (mergeRecord) {
          merges.push(mergeRecord)
        }
      } else if (!identity.anonymousIds.includes(anonymousId)) {
        // Enforce max anonymous IDs
        if (identity.anonymousIds.length >= this.options.maxAnonymousIds) {
          // Remove oldest anonymous ID
          const oldest = identity.anonymousIds.shift()
          if (oldest) {
            this.anonymousToCanonical.delete(oldest)
          }
        }

        identity.anonymousIds.push(anonymousId)
        this.anonymousToCanonical.set(anonymousId, canonicalId)

        // Create/update node
        this.addOrUpdateNode(anonymousId, 'anonymous', {}, now)
      }

      // Link anonymous to user if both provided
      if (userId) {
        this.addEdge(anonymousId, userId, 'identify', 1.0, 'identify_call')
      }
    }

    // Process additional identifiers
    if (identifiers.email) {
      const email = identifiers.email.toLowerCase()
      if (!identity.emails.includes(email)) {
        identity.emails.push(email)
      }
      this.addToIndex(this.emailIndex, email, canonicalId)
      this.addOrUpdateNode(email, 'email', {}, now)

      // Auto-merge on email if enabled
      if (this.options.autoMergeOnEmail) {
        const emailMerges = this.autoMergeByIndex(
          this.emailIndex,
          email,
          canonicalId
        )
        merges.push(...emailMerges)
      }
    }

    if (identifiers.phone) {
      const phone = this.normalizePhone(identifiers.phone)
      if (!identity.phones.includes(phone)) {
        identity.phones.push(phone)
      }
      this.addToIndex(this.phoneIndex, phone, canonicalId)
      this.addOrUpdateNode(phone, 'phone', {}, now)

      // Auto-merge on phone if enabled
      if (this.options.autoMergeOnPhone) {
        const phoneMerges = this.autoMergeByIndex(
          this.phoneIndex,
          phone,
          canonicalId
        )
        merges.push(...phoneMerges)
      }
    }

    if (identifiers.deviceId) {
      if (!identity.deviceIds.includes(identifiers.deviceId)) {
        identity.deviceIds.push(identifiers.deviceId)
      }
      this.addOrUpdateNode(identifiers.deviceId, 'device', {}, now)
    }

    // Process custom identifiers
    for (const [key, value] of Object.entries(identifiers)) {
      if (
        value &&
        key !== 'email' &&
        key !== 'phone' &&
        key !== 'deviceId'
      ) {
        const existing = identity.customIds.get(key) || []
        if (!existing.includes(value)) {
          existing.push(value)
          identity.customIds.set(key, existing)
        }
        this.addOrUpdateNode(value, 'custom', { type: key }, now)
      }
    }

    // Merge traits
    identity.traits = mergeTraits(
      identity.traits,
      traits,
      this.options.traitMergeStrategy
    )

    // Update timestamp
    identity.updatedAt = now

    // Re-fetch identity in case merges modified it
    identity = this.identities.get(canonicalId)!

    return {
      identity,
      merged: merges.length > 0,
      merges,
    }
  }

  /**
   * Alias one identifier to another.
   * Typically used to link anonymous ID to user ID after signup.
   */
  alias(input: AliasInput): ResolveResult {
    const { previousId, userId } = input
    const now = new Date()
    const merges: MergeRecord[] = []

    if (!previousId || !userId) {
      throw new Error('previousId and userId are required')
    }

    // Find canonical IDs for both
    const previousCanonical = this.findCanonicalId(undefined, previousId)
    const userCanonical = this.findCanonicalId(userId, undefined)

    if (previousCanonical && userCanonical && previousCanonical !== userCanonical) {
      // Both exist but different - merge them
      const mergeRecord = this.mergeIdentities(
        previousCanonical,
        userCanonical,
        'alias'
      )
      if (mergeRecord) {
        merges.push(mergeRecord)
      }
    } else if (previousCanonical && !userCanonical) {
      // Previous exists, add user ID to it
      const identity = this.identities.get(previousCanonical)!
      if (!identity.userIds.includes(userId)) {
        identity.userIds.push(userId)
      }
      identity.canonicalId = userId
      identity.updatedAt = now
      this.userToCanonical.set(userId, previousCanonical)
      this.addOrUpdateNode(userId, 'user', {}, now)
    } else if (!previousCanonical && userCanonical) {
      // User exists, add previous ID to it
      const identity = this.identities.get(userCanonical)!
      if (!identity.anonymousIds.includes(previousId)) {
        identity.anonymousIds.push(previousId)
      }
      identity.updatedAt = now
      this.anonymousToCanonical.set(previousId, userCanonical)
      this.addOrUpdateNode(previousId, 'anonymous', {}, now)
    } else if (!previousCanonical && !userCanonical) {
      // Neither exists - create new identity with both
      const canonicalId = generateCanonicalId()
      const identity = createEmptyIdentity()
      identity.canonicalId = userId
      identity.userIds.push(userId)
      identity.anonymousIds.push(previousId)
      identity.updatedAt = now

      this.identities.set(canonicalId, identity)
      this.userToCanonical.set(userId, canonicalId)
      this.anonymousToCanonical.set(previousId, canonicalId)
      this.addOrUpdateNode(userId, 'user', {}, now)
      this.addOrUpdateNode(previousId, 'anonymous', {}, now)
      this.options.onIdentityCreated?.(identity)
    }

    // Add alias edge
    this.addEdge(previousId, userId, 'alias', 1.0, 'alias_call')

    // Get final identity
    const finalCanonical = this.userToCanonical.get(userId)!
    const identity = this.identities.get(finalCanonical)!

    return {
      identity,
      merged: merges.length > 0,
      merges,
    }
  }

  /**
   * Resolve an identifier to its full identity profile.
   */
  resolve(id: string): ResolvedIdentity | undefined {
    const canonicalId = this.findCanonicalId(id, id)
    if (!canonicalId) {
      return undefined
    }
    return this.identities.get(canonicalId)
  }

  /**
   * Get all identifiers associated with a given identifier.
   */
  getLinkedIds(id: string): string[] {
    const identity = this.resolve(id)
    if (!identity) {
      return []
    }

    const ids: string[] = [
      ...identity.userIds,
      ...identity.anonymousIds,
      ...identity.emails,
      ...identity.phones,
      ...identity.deviceIds,
    ]

    // Add custom IDs
    for (const values of identity.customIds.values()) {
      ids.push(...values)
    }

    return [...new Set(ids)]
  }

  /**
   * Check if two identifiers belong to the same identity.
   */
  areSameUser(id1: string, id2: string): boolean {
    const canonical1 = this.findCanonicalId(id1, id1)
    const canonical2 = this.findCanonicalId(id2, id2)

    if (!canonical1 || !canonical2) {
      return false
    }

    return canonical1 === canonical2
  }

  /**
   * Get traits for an identifier.
   */
  getTraits(id: string): Record<string, unknown> | undefined {
    const identity = this.resolve(id)
    return identity?.traits
  }

  /**
   * Update traits for an identifier.
   */
  updateTraits(id: string, traits: Record<string, unknown>): boolean {
    const canonicalId = this.findCanonicalId(id, id)
    if (!canonicalId) {
      return false
    }

    const identity = this.identities.get(canonicalId)!
    identity.traits = mergeTraits(
      identity.traits,
      traits,
      this.options.traitMergeStrategy
    )
    identity.updatedAt = new Date()

    return true
  }

  /**
   * Get the canonical (primary) user ID for an identifier.
   */
  getCanonicalUserId(id: string): string | null {
    const identity = this.resolve(id)
    return identity?.canonicalId || null
  }

  /**
   * Get all anonymous IDs for a user.
   */
  getAnonymousIds(userId: string): string[] {
    const identity = this.resolve(userId)
    return identity?.anonymousIds || []
  }

  /**
   * Manually merge two identities.
   */
  merge(sourceId: string, targetId: string): MergeRecord | null {
    const sourceCanonical = this.findCanonicalId(sourceId, sourceId)
    const targetCanonical = this.findCanonicalId(targetId, targetId)

    if (!sourceCanonical || !targetCanonical) {
      return null
    }

    if (sourceCanonical === targetCanonical) {
      return null // Already same identity
    }

    return this.mergeIdentities(sourceCanonical, targetCanonical, 'auto')
  }

  /**
   * Get identity graph statistics.
   */
  getStats(): {
    totalIdentities: number
    totalNodes: number
    totalEdges: number
    averageAnonymousIdsPerUser: number
  } {
    let totalAnonymousIds = 0
    let identitiesWithUsers = 0

    for (const identity of this.identities.values()) {
      if (identity.userIds.length > 0) {
        identitiesWithUsers++
        totalAnonymousIds += identity.anonymousIds.length
      }
    }

    let totalEdges = 0
    for (const edges of this.edges.values()) {
      totalEdges += edges.length
    }

    return {
      totalIdentities: this.identities.size,
      totalNodes: this.nodes.size,
      totalEdges,
      averageAnonymousIdsPerUser:
        identitiesWithUsers > 0 ? totalAnonymousIds / identitiesWithUsers : 0,
    }
  }

  /**
   * Clear expired anonymous IDs based on TTL.
   */
  cleanupExpiredAnonymousIds(): number {
    const now = Date.now()
    const ttl = this.options.anonymousIdTTL
    let cleaned = 0

    for (const [canonicalId, identity] of this.identities.entries()) {
      const validAnonymousIds: string[] = []

      for (const anonId of identity.anonymousIds) {
        const node = this.nodes.get(anonId)
        if (node && now - node.lastSeen.getTime() < ttl) {
          validAnonymousIds.push(anonId)
        } else {
          // Remove expired
          this.anonymousToCanonical.delete(anonId)
          this.nodes.delete(anonId)
          this.edges.delete(anonId)
          cleaned++
        }
      }

      identity.anonymousIds = validAnonymousIds
    }

    return cleaned
  }

  /**
   * Export identity for serialization.
   */
  exportIdentity(id: string): object | undefined {
    const identity = this.resolve(id)
    if (!identity) {
      return undefined
    }

    return {
      ...identity,
      customIds: Object.fromEntries(identity.customIds),
    }
  }

  /**
   * Import a previously exported identity.
   */
  importIdentity(data: object): void {
    const identity = data as ResolvedIdentity & { customIds: Record<string, string[]> }

    // Convert customIds back to Map
    const resolvedIdentity: ResolvedIdentity = {
      ...identity,
      customIds: new Map(Object.entries(identity.customIds || {})),
      createdAt: new Date(identity.createdAt),
      updatedAt: new Date(identity.updatedAt),
      mergeHistory: identity.mergeHistory.map((m) => ({
        ...m,
        timestamp: new Date(m.timestamp),
      })),
    }

    // Generate canonical ID
    const canonicalId = generateCanonicalId()
    this.identities.set(canonicalId, resolvedIdentity)

    // Update indexes
    for (const userId of resolvedIdentity.userIds) {
      this.userToCanonical.set(userId, canonicalId)
    }
    for (const anonId of resolvedIdentity.anonymousIds) {
      this.anonymousToCanonical.set(anonId, canonicalId)
    }
    for (const email of resolvedIdentity.emails) {
      this.addToIndex(this.emailIndex, email, canonicalId)
    }
    for (const phone of resolvedIdentity.phones) {
      this.addToIndex(this.phoneIndex, phone, canonicalId)
    }
  }

  // -------------------------------------------------------------------------
  // PRIVATE METHODS
  // -------------------------------------------------------------------------

  private findCanonicalId(
    userId?: string,
    anonymousId?: string
  ): string | undefined {
    if (userId) {
      const canonical = this.userToCanonical.get(userId)
      if (canonical) return canonical
    }

    if (anonymousId) {
      return this.anonymousToCanonical.get(anonymousId)
    }

    return undefined
  }

  private addOrUpdateNode(
    id: string,
    type: IdentityNode['type'],
    traits: Record<string, unknown>,
    now: Date
  ): void {
    const existing = this.nodes.get(id)
    if (existing) {
      existing.lastSeen = now
      existing.traits = mergeTraits(
        existing.traits,
        traits,
        this.options.traitMergeStrategy
      )
    } else {
      this.nodes.set(id, {
        id,
        type,
        firstSeen: now,
        lastSeen: now,
        traits,
      })
    }
  }

  private addEdge(
    fromId: string,
    toId: string,
    type: IdentityEdge['type'],
    confidence: number,
    source: string
  ): void {
    const edge: IdentityEdge = {
      fromId,
      toId,
      type,
      createdAt: new Date(),
      confidence,
      source,
    }

    const existing = this.edges.get(fromId) || []
    // Avoid duplicate edges
    if (!existing.some((e) => e.toId === toId && e.type === type)) {
      existing.push(edge)
      this.edges.set(fromId, existing)
    }
  }

  private addToIndex(
    index: Map<string, string[]>,
    key: string,
    canonicalId: string
  ): void {
    const existing = index.get(key) || []
    if (!existing.includes(canonicalId)) {
      existing.push(canonicalId)
      index.set(key, existing)
    }
  }

  private normalizePhone(phone: string): string {
    // Remove all non-numeric characters
    return phone.replace(/\D/g, '')
  }

  private autoMergeByIndex(
    index: Map<string, string[]>,
    key: string,
    currentCanonical: string
  ): MergeRecord[] {
    const merges: MergeRecord[] = []
    const candidates = index.get(key) || []

    for (const candidateCanonical of candidates) {
      if (candidateCanonical !== currentCanonical) {
        // Check confidence threshold
        // For now, email/phone matches are considered high confidence
        const confidence = 1.0
        if (confidence >= this.options.autoMergeThreshold) {
          const mergeRecord = this.mergeIdentities(
            candidateCanonical,
            currentCanonical,
            'auto'
          )
          if (mergeRecord) {
            merges.push(mergeRecord)
          }
        }
      }
    }

    return merges
  }

  private mergeIdentities(
    sourceCanonical: string,
    targetCanonical: string,
    mergeType: 'alias' | 'identify' | 'auto'
  ): MergeRecord | null {
    const source = this.identities.get(sourceCanonical)
    const target = this.identities.get(targetCanonical)

    if (!source || !target) {
      return null
    }

    const now = new Date()
    const inheritedTraits = Object.keys(source.traits)

    // Merge user IDs
    for (const userId of source.userIds) {
      if (!target.userIds.includes(userId)) {
        target.userIds.push(userId)
      }
      this.userToCanonical.set(userId, targetCanonical)
    }

    // Merge anonymous IDs (respecting max limit)
    for (const anonId of source.anonymousIds) {
      if (!target.anonymousIds.includes(anonId)) {
        if (target.anonymousIds.length >= this.options.maxAnonymousIds) {
          const oldest = target.anonymousIds.shift()
          if (oldest) {
            this.anonymousToCanonical.delete(oldest)
          }
        }
        target.anonymousIds.push(anonId)
      }
      this.anonymousToCanonical.set(anonId, targetCanonical)
    }

    // Merge emails
    for (const email of source.emails) {
      if (!target.emails.includes(email)) {
        target.emails.push(email)
      }
      this.addToIndex(this.emailIndex, email, targetCanonical)
    }

    // Merge phones
    for (const phone of source.phones) {
      if (!target.phones.includes(phone)) {
        target.phones.push(phone)
      }
      this.addToIndex(this.phoneIndex, phone, targetCanonical)
    }

    // Merge device IDs
    for (const deviceId of source.deviceIds) {
      if (!target.deviceIds.includes(deviceId)) {
        target.deviceIds.push(deviceId)
      }
    }

    // Merge custom IDs
    for (const [key, values] of source.customIds) {
      const existing = target.customIds.get(key) || []
      for (const value of values) {
        if (!existing.includes(value)) {
          existing.push(value)
        }
      }
      target.customIds.set(key, existing)
    }

    // Merge traits
    target.traits = mergeTraits(
      target.traits,
      source.traits,
      this.options.traitMergeStrategy
    )

    // Update canonical ID if source had one and target doesn't
    if (source.canonicalId && !target.canonicalId) {
      target.canonicalId = source.canonicalId
    }

    // Use earliest creation date
    if (source.createdAt < target.createdAt) {
      target.createdAt = source.createdAt
    }

    target.updatedAt = now

    // Copy merge history
    target.mergeHistory.push(...source.mergeHistory)

    // Create merge record
    const mergeRecord: MergeRecord = {
      timestamp: now,
      sourceId: source.canonicalId || sourceCanonical,
      targetId: target.canonicalId || targetCanonical,
      mergeType,
      inheritedTraits,
    }

    target.mergeHistory.push(mergeRecord)

    // Remove source identity
    this.identities.delete(sourceCanonical)

    // Update email index to remove source
    for (const email of source.emails) {
      const indexed = this.emailIndex.get(email) || []
      this.emailIndex.set(
        email,
        indexed.filter((id) => id !== sourceCanonical)
      )
    }

    // Update phone index to remove source
    for (const phone of source.phones) {
      const indexed = this.phoneIndex.get(phone) || []
      this.phoneIndex.set(
        phone,
        indexed.filter((id) => id !== sourceCanonical)
      )
    }

    // Notify callback
    this.options.onMerge?.(mergeRecord)

    return mergeRecord
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a new IdentityResolver instance.
 */
export function createIdentityResolver(
  options?: IdentityResolverOptions
): IdentityResolver {
  return new IdentityResolver(options)
}
