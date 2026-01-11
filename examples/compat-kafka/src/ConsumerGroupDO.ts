/**
 * ConsumerGroupDO - Consumer offset tracking and group coordination
 *
 * Manages:
 * - Consumer group membership
 * - Partition assignment (rebalancing)
 * - Offset storage and commits
 * - Heartbeat tracking
 * - Generation management
 */

import { DO } from 'dotdo'
import {
  type ConsumerOffset,
  type ConsumerMember,
  type ConsumerGroupState,
  type ConsumerGroupDescription,
  type ConsumerGroupMetadata,
  type TopicPartitionOffset,
  type ConsumerAssignment,
  type OffsetAndMetadata,
  KafkaError,
  ErrorCode,
} from './types'

interface MemberRow {
  member_id: string
  client_id: string
  client_host: string
  session_timeout: number
  rebalance_timeout: number
  subscriptions: string
  assignment: string
  last_heartbeat: string
  joined_at: string
}

interface OffsetRow {
  topic: string
  partition: number
  offset: string
  metadata: string
  commit_timestamp: string
  leader_epoch: number | null
}

interface GroupStateRow {
  key: string
  value: string
}

/**
 * Assignment strategy function type
 */
type AssignmentStrategy = (
  members: ConsumerMember[],
  topicPartitions: Map<string, number[]>
) => Map<string, Map<string, number[]>>

/**
 * ConsumerGroupDO - Manages consumer group state
 */
export class ConsumerGroupDO extends DO {
  static readonly $type = 'ConsumerGroupDO'

  private initialized = false
  private groupId: string = ''
  private generationId = 0
  private state: ConsumerGroupState = 'Empty'
  private protocolType = 'consumer'
  private protocol = 'range'
  private leaderId: string | null = null

  // Configuration
  private sessionTimeoutMs = 30000
  private rebalanceTimeoutMs = 60000
  private heartbeatIntervalMs = 3000

  /**
   * Initialize the consumer group
   */
  async initialize(groupId?: string): Promise<void> {
    if (this.initialized && !groupId) return

    this.groupId = groupId || this.id

    // Members table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS members (
        member_id TEXT PRIMARY KEY,
        client_id TEXT NOT NULL,
        client_host TEXT NOT NULL,
        session_timeout INTEGER NOT NULL,
        rebalance_timeout INTEGER NOT NULL,
        subscriptions TEXT NOT NULL DEFAULT '[]',
        assignment TEXT NOT NULL DEFAULT '{}',
        last_heartbeat TEXT NOT NULL,
        joined_at TEXT NOT NULL
      )
    `)

    // Committed offsets table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS offsets (
        topic TEXT NOT NULL,
        partition INTEGER NOT NULL,
        offset TEXT NOT NULL,
        metadata TEXT NOT NULL DEFAULT '',
        commit_timestamp TEXT NOT NULL,
        leader_epoch INTEGER,
        PRIMARY KEY (topic, partition)
      )
    `)

    // Group state table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS group_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `)

    // Create index for offset queries
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_offsets_topic ON offsets(topic)`)

    // Load state
    await this.loadState()
    this.initialized = true
  }

  /**
   * Load group state from storage
   */
  private async loadState(): Promise<void> {
    const rows = this.db.exec(`SELECT key, value FROM group_state`).toArray() as GroupStateRow[]

    for (const { key, value } of rows) {
      switch (key) {
        case 'generation_id':
          this.generationId = parseInt(value)
          break
        case 'state':
          this.state = value as ConsumerGroupState
          break
        case 'protocol_type':
          this.protocolType = value
          break
        case 'protocol':
          this.protocol = value
          break
        case 'leader_id':
          this.leaderId = value || null
          break
      }
    }

    // Check for expired members and update state
    await this.checkMemberExpiry()
  }

  /**
   * Save state to storage
   */
  private saveState(): void {
    const states: [string, string][] = [
      ['generation_id', this.generationId.toString()],
      ['state', this.state],
      ['protocol_type', this.protocolType],
      ['protocol', this.protocol],
      ['leader_id', this.leaderId || ''],
    ]

    for (const [key, value] of states) {
      this.db.exec(`INSERT OR REPLACE INTO group_state (key, value) VALUES (?, ?)`, key, value)
    }
  }

  /**
   * Check for expired members and handle timeouts
   */
  private async checkMemberExpiry(): Promise<string[]> {
    const now = Date.now()
    const expiredMembers: string[] = []

    const members = this.db.exec(`SELECT * FROM members`).toArray() as MemberRow[]

    for (const member of members) {
      const lastHeartbeat = new Date(member.last_heartbeat).getTime()
      if (now - lastHeartbeat > member.session_timeout) {
        expiredMembers.push(member.member_id)
      }
    }

    // Remove expired members
    if (expiredMembers.length > 0) {
      const placeholders = expiredMembers.map(() => '?').join(',')
      this.db.exec(`DELETE FROM members WHERE member_id IN (${placeholders})`, ...expiredMembers)

      // Update state if necessary
      const remainingCount = this.db.exec(`SELECT COUNT(*) as count FROM members`).one() as { count: number }
      if (remainingCount.count === 0) {
        this.state = 'Empty'
        this.generationId = 0
        this.leaderId = null
      } else if (this.state === 'Stable') {
        // Trigger rebalance if we lost members
        this.state = 'PreparingRebalance'
      }
      this.saveState()
    }

    return expiredMembers
  }

  // ===========================================================================
  // Member Management
  // ===========================================================================

  /**
   * Join the consumer group
   */
  async joinGroup(
    memberId: string | null,
    clientId: string,
    clientHost: string,
    sessionTimeout: number,
    rebalanceTimeout: number,
    subscriptions: string[]
  ): Promise<{
    memberId: string
    generationId: number
    leaderId: string
    protocol: string
    members: Array<{ memberId: string; subscriptions: string[] }>
    errorCode: number
  }> {
    await this.initialize()

    // Generate member ID if not provided
    const finalMemberId = memberId || `${clientId}-${crypto.randomUUID()}`
    const now = new Date().toISOString()

    // Check for expired members first
    await this.checkMemberExpiry()

    // Check if member already exists
    const existing = this.db.exec(`SELECT member_id FROM members WHERE member_id = ?`, finalMemberId).one()

    if (existing) {
      // Update existing member
      this.db.exec(
        `UPDATE members SET subscriptions = ?, last_heartbeat = ? WHERE member_id = ?`,
        JSON.stringify(subscriptions),
        now,
        finalMemberId
      )
    } else {
      // Add new member
      this.db.exec(
        `INSERT INTO members (member_id, client_id, client_host, session_timeout, rebalance_timeout, subscriptions, assignment, last_heartbeat, joined_at)
         VALUES (?, ?, ?, ?, ?, ?, '{}', ?, ?)`,
        finalMemberId,
        clientId,
        clientHost,
        sessionTimeout,
        rebalanceTimeout,
        JSON.stringify(subscriptions),
        now,
        now
      )
    }

    // Get all members
    const allMembers = this.db.exec(`SELECT member_id, subscriptions FROM members ORDER BY joined_at`).toArray() as Array<{
      member_id: string
      subscriptions: string
    }>

    // Elect leader if needed (first member is leader)
    if (!this.leaderId || !allMembers.find((m) => m.member_id === this.leaderId)) {
      this.leaderId = allMembers[0]?.member_id || finalMemberId
    }

    // Update state and generation
    if (this.state === 'Empty' || this.state === 'Dead') {
      this.state = 'PreparingRebalance'
    }

    // Bump generation on join
    this.generationId++
    this.saveState()

    return {
      memberId: finalMemberId,
      generationId: this.generationId,
      leaderId: this.leaderId,
      protocol: this.protocol,
      members: allMembers.map((m) => ({
        memberId: m.member_id,
        subscriptions: JSON.parse(m.subscriptions),
      })),
      errorCode: 0,
    }
  }

  /**
   * Sync group (receive assignment from leader)
   */
  async syncGroup(
    memberId: string,
    generationId: number,
    assignments: Map<string, ConsumerAssignment[]>
  ): Promise<{
    assignment: ConsumerAssignment[]
    errorCode: number
  }> {
    await this.initialize()

    // Validate generation
    if (generationId !== this.generationId) {
      throw new KafkaError(
        `Invalid generation: expected ${this.generationId}, got ${generationId}`,
        ErrorCode.ILLEGAL_GENERATION
      )
    }

    // Validate member
    const member = this.db.exec(`SELECT member_id FROM members WHERE member_id = ?`, memberId).one()
    if (!member) {
      throw new KafkaError(`Unknown member: ${memberId}`, ErrorCode.UNKNOWN_MEMBER_ID)
    }

    // If this is the leader, apply assignments
    if (memberId === this.leaderId && assignments.size > 0) {
      for (const [targetMemberId, assignment] of assignments) {
        const assignmentMap: Record<string, number[]> = {}
        for (const a of assignment) {
          assignmentMap[a.topic] = a.partitions
        }

        this.db.exec(
          `UPDATE members SET assignment = ? WHERE member_id = ?`,
          JSON.stringify(assignmentMap),
          targetMemberId
        )
      }

      // Transition to stable
      this.state = 'Stable'
      this.saveState()
    }

    // Get this member's assignment
    const memberRow = this.db.exec(`SELECT assignment FROM members WHERE member_id = ?`, memberId).one() as {
      assignment: string
    } | null

    const assignment: ConsumerAssignment[] = []
    if (memberRow) {
      const assignmentMap = JSON.parse(memberRow.assignment) as Record<string, number[]>
      for (const [topic, partitions] of Object.entries(assignmentMap)) {
        assignment.push({ topic, partitions })
      }
    }

    return { assignment, errorCode: 0 }
  }

  /**
   * Process heartbeat
   */
  async heartbeat(memberId: string, generationId: number): Promise<{ errorCode: number }> {
    await this.initialize()

    // Validate generation
    if (generationId !== this.generationId) {
      return { errorCode: ErrorCode.ILLEGAL_GENERATION }
    }

    // Update heartbeat timestamp
    const result = this.db.exec(
      `UPDATE members SET last_heartbeat = ? WHERE member_id = ?`,
      new Date().toISOString(),
      memberId
    )

    if (!result.changes) {
      return { errorCode: ErrorCode.UNKNOWN_MEMBER_ID }
    }

    // Check if rebalancing
    if (this.state === 'PreparingRebalance' || this.state === 'CompletingRebalance') {
      return { errorCode: ErrorCode.REBALANCE_IN_PROGRESS }
    }

    return { errorCode: 0 }
  }

  /**
   * Leave the consumer group
   */
  async leaveGroup(memberId: string): Promise<void> {
    await this.initialize()

    this.db.exec(`DELETE FROM members WHERE member_id = ?`, memberId)

    // Check if leader left
    if (this.leaderId === memberId) {
      const firstMember = this.db.exec(`SELECT member_id FROM members ORDER BY joined_at LIMIT 1`).one() as {
        member_id: string
      } | null
      this.leaderId = firstMember?.member_id || null
    }

    // Update state
    const memberCount = this.db.exec(`SELECT COUNT(*) as count FROM members`).one() as { count: number }
    if (memberCount.count === 0) {
      this.state = 'Empty'
    } else if (this.state === 'Stable') {
      this.state = 'PreparingRebalance'
      this.generationId++
    }

    this.saveState()
  }

  // ===========================================================================
  // Offset Management
  // ===========================================================================

  /**
   * Commit offsets
   */
  async commitOffsets(
    memberId: string,
    generationId: number,
    offsets: TopicPartitionOffset[]
  ): Promise<Map<string, number>> {
    await this.initialize()

    const results = new Map<string, number>()
    const now = new Date().toISOString()

    // Validate generation (allow -1 for simple consumers)
    if (generationId !== -1 && generationId !== this.generationId) {
      for (const offset of offsets) {
        results.set(`${offset.topic}-${offset.partition}`, ErrorCode.ILLEGAL_GENERATION)
      }
      return results
    }

    // Validate member if generation specified
    if (generationId !== -1) {
      const member = this.db.exec(`SELECT member_id FROM members WHERE member_id = ?`, memberId).one()
      if (!member) {
        for (const offset of offsets) {
          results.set(`${offset.topic}-${offset.partition}`, ErrorCode.UNKNOWN_MEMBER_ID)
        }
        return results
      }
    }

    // Commit offsets
    for (const offset of offsets) {
      try {
        this.db.exec(
          `INSERT OR REPLACE INTO offsets (topic, partition, offset, metadata, commit_timestamp, leader_epoch)
           VALUES (?, ?, ?, ?, ?, ?)`,
          offset.topic,
          offset.partition,
          offset.offset,
          offset.metadata || '',
          now,
          offset.leaderEpoch ?? null
        )
        results.set(`${offset.topic}-${offset.partition}`, 0)
      } catch {
        results.set(`${offset.topic}-${offset.partition}`, ErrorCode.UNKNOWN)
      }
    }

    return results
  }

  /**
   * Fetch committed offsets
   */
  async fetchOffsets(
    topics?: { topic: string; partitions: number[] }[]
  ): Promise<TopicPartitionOffset[]> {
    await this.initialize()

    if (!topics || topics.length === 0) {
      // Return all offsets
      const rows = this.db.exec(`SELECT * FROM offsets`).toArray() as OffsetRow[]
      return rows.map((row) => ({
        topic: row.topic,
        partition: row.partition,
        offset: row.offset,
        metadata: row.metadata,
        leaderEpoch: row.leader_epoch ?? undefined,
      }))
    }

    const results: TopicPartitionOffset[] = []

    for (const { topic, partitions } of topics) {
      for (const partition of partitions) {
        const row = this.db
          .exec(`SELECT * FROM offsets WHERE topic = ? AND partition = ?`, topic, partition)
          .one() as OffsetRow | null

        if (row) {
          results.push({
            topic: row.topic,
            partition: row.partition,
            offset: row.offset,
            metadata: row.metadata,
            leaderEpoch: row.leader_epoch ?? undefined,
          })
        } else {
          // Return -1 for uncommitted partitions
          results.push({
            topic,
            partition,
            offset: '-1',
          })
        }
      }
    }

    return results
  }

  /**
   * Delete offsets for topics
   */
  async deleteOffsets(topics: string[]): Promise<void> {
    await this.initialize()

    if (topics.length === 0) return

    const placeholders = topics.map(() => '?').join(',')
    this.db.exec(`DELETE FROM offsets WHERE topic IN (${placeholders})`, ...topics)
  }

  /**
   * Reset offsets to earliest/latest
   */
  async resetOffsets(
    topic: string,
    partitions: number[],
    strategy: 'earliest' | 'latest',
    resolveOffset: (topic: string, partition: number, strategy: 'earliest' | 'latest') => Promise<string>
  ): Promise<void> {
    await this.initialize()

    const now = new Date().toISOString()

    for (const partition of partitions) {
      const offset = await resolveOffset(topic, partition, strategy)

      this.db.exec(
        `INSERT OR REPLACE INTO offsets (topic, partition, offset, metadata, commit_timestamp, leader_epoch)
         VALUES (?, ?, ?, 'reset', ?, NULL)`,
        topic,
        partition,
        offset,
        now
      )
    }
  }

  // ===========================================================================
  // Group Coordination
  // ===========================================================================

  /**
   * Perform partition assignment (called by leader)
   */
  performAssignment(
    members: Array<{ memberId: string; subscriptions: string[] }>,
    topicPartitions: Map<string, number>,
    strategy: 'range' | 'roundrobin' | 'sticky' = 'range'
  ): Map<string, ConsumerAssignment[]> {
    const assignments = new Map<string, ConsumerAssignment[]>()

    // Initialize assignments for all members
    for (const { memberId } of members) {
      assignments.set(memberId, [])
    }

    // Collect all topics members are subscribed to
    const topicSubscribers = new Map<string, string[]>()
    for (const { memberId, subscriptions } of members) {
      for (const topic of subscriptions) {
        const subscribers = topicSubscribers.get(topic) || []
        subscribers.push(memberId)
        topicSubscribers.set(topic, subscribers)
      }
    }

    switch (strategy) {
      case 'range':
        this.assignRange(assignments, topicSubscribers, topicPartitions)
        break
      case 'roundrobin':
        this.assignRoundRobin(assignments, topicSubscribers, topicPartitions)
        break
      case 'sticky':
        // Sticky is more complex - fallback to round robin for now
        this.assignRoundRobin(assignments, topicSubscribers, topicPartitions)
        break
    }

    return assignments
  }

  /**
   * Range assignment strategy
   */
  private assignRange(
    assignments: Map<string, ConsumerAssignment[]>,
    topicSubscribers: Map<string, string[]>,
    topicPartitions: Map<string, number>
  ): void {
    for (const [topic, subscribers] of topicSubscribers) {
      const partitionCount = topicPartitions.get(topic) || 0
      if (partitionCount === 0 || subscribers.length === 0) continue

      // Sort subscribers for deterministic assignment
      subscribers.sort()

      const partitionsPerConsumer = Math.floor(partitionCount / subscribers.length)
      const extraPartitions = partitionCount % subscribers.length

      let partitionIndex = 0

      for (let i = 0; i < subscribers.length; i++) {
        const memberId = subscribers[i]
        const numPartitions = partitionsPerConsumer + (i < extraPartitions ? 1 : 0)

        if (numPartitions > 0) {
          const partitions: number[] = []
          for (let j = 0; j < numPartitions; j++) {
            partitions.push(partitionIndex++)
          }

          const memberAssignments = assignments.get(memberId) || []
          memberAssignments.push({ topic, partitions })
          assignments.set(memberId, memberAssignments)
        }
      }
    }
  }

  /**
   * Round-robin assignment strategy
   */
  private assignRoundRobin(
    assignments: Map<string, ConsumerAssignment[]>,
    topicSubscribers: Map<string, string[]>,
    topicPartitions: Map<string, number>
  ): void {
    // Collect all topic-partitions
    const allPartitions: Array<{ topic: string; partition: number }> = []
    for (const [topic, count] of topicPartitions) {
      for (let p = 0; p < count; p++) {
        allPartitions.push({ topic, partition: p })
      }
    }

    // Sort for determinism
    allPartitions.sort((a, b) => {
      const topicCmp = a.topic.localeCompare(b.topic)
      return topicCmp !== 0 ? topicCmp : a.partition - b.partition
    })

    // Get all members sorted
    const allMembers = [...assignments.keys()].sort()
    let memberIndex = 0

    // Build intermediate map: member -> topic -> partitions
    const memberTopicPartitions = new Map<string, Map<string, number[]>>()
    for (const memberId of allMembers) {
      memberTopicPartitions.set(memberId, new Map())
    }

    for (const { topic, partition } of allPartitions) {
      // Find next eligible member
      const subscribers = topicSubscribers.get(topic) || []
      if (subscribers.length === 0) continue

      let attempts = 0
      while (attempts < allMembers.length) {
        const memberId = allMembers[memberIndex % allMembers.length]
        memberIndex++

        if (subscribers.includes(memberId)) {
          const topicMap = memberTopicPartitions.get(memberId)!
          const partitions = topicMap.get(topic) || []
          partitions.push(partition)
          topicMap.set(topic, partitions)
          break
        }
        attempts++
      }
    }

    // Convert to assignments format
    for (const [memberId, topicMap] of memberTopicPartitions) {
      const memberAssignments: ConsumerAssignment[] = []
      for (const [topic, partitions] of topicMap) {
        if (partitions.length > 0) {
          memberAssignments.push({ topic, partitions: partitions.sort((a, b) => a - b) })
        }
      }
      assignments.set(memberId, memberAssignments)
    }
  }

  // ===========================================================================
  // Group Information
  // ===========================================================================

  /**
   * Describe the consumer group
   */
  async describe(): Promise<ConsumerGroupDescription> {
    await this.initialize()

    const members = this.db.exec(`SELECT * FROM members`).toArray() as MemberRow[]

    return {
      groupId: this.groupId,
      protocolType: this.protocolType,
      protocol: this.protocol,
      state: this.state,
      members: members.map((m) => ({
        memberId: m.member_id,
        clientId: m.client_id,
        clientHost: m.client_host,
        memberMetadata: Buffer.from(m.subscriptions),
        memberAssignment: Buffer.from(m.assignment),
      })),
      coordinator: { id: 0, host: 'localhost', port: 9092 },
    }
  }

  /**
   * Get group metadata
   */
  async getMetadata(): Promise<ConsumerGroupMetadata> {
    await this.initialize()

    return {
      groupId: this.groupId,
      generationId: this.generationId,
      memberId: this.leaderId || '',
      protocolType: this.protocolType,
      protocol: this.protocol,
    }
  }

  /**
   * Get current state
   */
  async getState(): Promise<ConsumerGroupState> {
    await this.initialize()
    return this.state
  }

  /**
   * Get member count
   */
  async getMemberCount(): Promise<number> {
    await this.initialize()
    const row = this.db.exec(`SELECT COUNT(*) as count FROM members`).one() as { count: number }
    return row.count
  }

  /**
   * List all members
   */
  async listMembers(): Promise<
    Array<{
      memberId: string
      clientId: string
      subscriptions: string[]
      assignment: Record<string, number[]>
    }>
  > {
    await this.initialize()

    const rows = this.db.exec(`SELECT * FROM members`).toArray() as MemberRow[]

    return rows.map((r) => ({
      memberId: r.member_id,
      clientId: r.client_id,
      subscriptions: JSON.parse(r.subscriptions),
      assignment: JSON.parse(r.assignment),
    }))
  }

  /**
   * Delete the consumer group (remove all state)
   */
  async deleteGroup(): Promise<void> {
    await this.initialize()

    // Check if group is empty
    const memberCount = await this.getMemberCount()
    if (memberCount > 0) {
      throw new KafkaError('Cannot delete non-empty group', ErrorCode.NON_EMPTY_GROUP)
    }

    this.db.exec(`DELETE FROM members`)
    this.db.exec(`DELETE FROM offsets`)
    this.db.exec(`DELETE FROM group_state`)

    this.state = 'Dead'
    this.generationId = 0
    this.leaderId = null
  }
}
