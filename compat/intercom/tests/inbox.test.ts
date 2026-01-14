/**
 * @dotdo/intercom - Inbox Routing Compatibility Layer Tests (RED Phase)
 *
 * TDD RED phase tests for Intercom Inbox Routing API:
 * - Inbox CRUD operations
 * - Team Inboxes with member management
 * - Assignment Rules with conditions
 * - Round-Robin assignment
 * - Priority Routing
 * - Workload Balancing
 *
 * These tests define the expected behavior before implementation.
 * Reference: https://developers.intercom.com/docs/references/rest-api/api.intercom.io/Teams/
 *
 * @see https://www.intercom.com/help/en/articles/7191-team-inboxes-set-up
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { IntercomLocal, type IntercomLocalConfig } from '../local'

// =============================================================================
// Types for Inbox Routing (to be implemented)
// =============================================================================

/**
 * Inbox object representing a team inbox or personal inbox
 */
export interface Inbox {
  type: 'inbox'
  id: string
  name: string
  team_id: string | null
  is_default: boolean
  conversation_counts: {
    open: number
    pending: number
    closed: number
  }
  created_at: number
  updated_at: number
}

/**
 * Team inbox with member management
 */
export interface TeamInbox extends Inbox {
  type: 'inbox'
  team_id: string
  members: TeamMember[]
  settings: TeamInboxSettings
}

/**
 * Team member configuration
 */
export interface TeamMember {
  admin_id: string
  name: string
  email: string
  availability: 'available' | 'away' | 'busy'
  max_open_conversations: number
  current_open_conversations: number
  paused_from_rotation: boolean
  joined_at: number
}

/**
 * Team inbox settings
 */
export interface TeamInboxSettings {
  round_robin_enabled: boolean
  max_open_per_member: number
  auto_assignment_enabled: boolean
  assignment_rules: AssignmentRule[]
}

/**
 * Assignment rule for routing conversations
 */
export interface AssignmentRule {
  id: string
  name: string
  priority: number
  enabled: boolean
  conditions: AssignmentCondition[]
  condition_operator: 'AND' | 'OR'
  assignee_type: 'admin' | 'team' | 'round_robin'
  assignee_id: string | null
  created_at: number
  updated_at: number
}

/**
 * Rule condition for matching conversations
 */
export interface AssignmentCondition {
  field: 'subject' | 'body' | 'email_domain' | 'tag' | 'company_size' | 'custom_attribute'
  operator: 'contains' | 'equals' | 'regex' | 'greater_than' | 'less_than' | 'starts_with'
  value: string | number
  custom_attribute_key?: string
}

/**
 * Priority level for conversations
 */
export type PriorityLevel = 'low' | 'normal' | 'high' | 'urgent'

/**
 * Priority routing configuration
 */
export interface PriorityRouting {
  vip_conditions: VIPCondition[]
  urgent_keywords: string[]
  escalation_rules: EscalationRule[]
  sla_based_priority: boolean
}

/**
 * VIP condition for priority routing
 */
export interface VIPCondition {
  id: string
  type: 'email_domain' | 'company_size' | 'tag' | 'custom_attribute'
  value: string | number
  priority: PriorityLevel
}

/**
 * Escalation rule for auto-escalation
 */
export interface EscalationRule {
  id: string
  trigger: 'time_waiting' | 'sla_breach' | 'manual'
  threshold_minutes?: number
  escalate_to: 'team' | 'admin'
  escalate_to_id: string
  enabled: boolean
}

/**
 * Workload statistics for an admin
 */
export interface AdminWorkload {
  admin_id: string
  name: string
  open_conversations: number
  pending_conversations: number
  closed_today: number
  average_response_time: number
  capacity_percentage: number
}

/**
 * Team workload statistics
 */
export interface TeamWorkload {
  team_id: string
  name: string
  total_open: number
  total_pending: number
  members: AdminWorkload[]
  bottleneck_admin_id: string | null
}

// =============================================================================
// Extended IntercomLocal Interface (to be implemented)
// =============================================================================

interface ExtendedIntercomLocal extends IntercomLocal {
  inboxes: {
    create(params: { name: string; team_id?: string; is_default?: boolean }): Promise<Inbox>
    find(id: string): Promise<Inbox>
    update(id: string, params: { name?: string }): Promise<Inbox>
    delete(id: string): Promise<{ id: string; deleted: true }>
    list(params?: { team_id?: string }): Promise<{ inboxes: Inbox[]; total_count: number }>
    getConversationCounts(id: string): Promise<Inbox['conversation_counts']>
  }
  teamInboxes: {
    create(params: { name: string; members?: string[] }): Promise<TeamInbox>
    find(id: string): Promise<TeamInbox>
    addMember(inboxId: string, adminId: string): Promise<TeamMember>
    removeMember(inboxId: string, adminId: string): Promise<{ removed: true }>
    listMembers(inboxId: string): Promise<{ members: TeamMember[] }>
    getStats(inboxId: string): Promise<{ open: number; pending: number; closed: number }>
    getMemberWorkload(inboxId: string, adminId: string): Promise<AdminWorkload>
    setMemberAvailability(inboxId: string, adminId: string, availability: TeamMember['availability']): Promise<TeamMember>
    transferConversation(conversationId: string, fromTeamId: string, toTeamId: string): Promise<void>
    setCapacityLimit(inboxId: string, limit: number): Promise<TeamInboxSettings>
  }
  assignmentRules: {
    create(inboxId: string, params: Omit<AssignmentRule, 'id' | 'created_at' | 'updated_at'>): Promise<AssignmentRule>
    update(ruleId: string, params: Partial<AssignmentRule>): Promise<AssignmentRule>
    delete(ruleId: string): Promise<{ id: string; deleted: true }>
    list(inboxId: string): Promise<{ rules: AssignmentRule[] }>
    test(ruleId: string, conversationId: string): Promise<{ matches: boolean; matched_conditions: string[] }>
    updatePriority(ruleId: string, priority: number): Promise<AssignmentRule>
    setDefault(inboxId: string, assigneeType: 'admin' | 'team', assigneeId: string): Promise<void>
  }
  roundRobin: {
    enable(inboxId: string): Promise<TeamInboxSettings>
    disable(inboxId: string): Promise<TeamInboxSettings>
    setMaxOpenPerMember(inboxId: string, max: number): Promise<TeamInboxSettings>
    getStatus(inboxId: string): Promise<{ enabled: boolean; current_member_index: number; members: string[] }>
    pauseMember(inboxId: string, adminId: string): Promise<TeamMember>
    resumeMember(inboxId: string, adminId: string): Promise<TeamMember>
    getNextAssignee(inboxId: string): Promise<{ admin_id: string; reason: string }>
    validateDistribution(inboxId: string): Promise<{ even: boolean; max_diff: number; distribution: Record<string, number> }>
    resetOnMemberChange(inboxId: string): Promise<void>
  }
  priorityRouting: {
    setVIPCondition(condition: Omit<VIPCondition, 'id'>): Promise<VIPCondition>
    removeVIPCondition(conditionId: string): Promise<{ id: string; deleted: true }>
    setUrgentKeywords(keywords: string[]): Promise<{ keywords: string[] }>
    getPriorityForConversation(conversationId: string): Promise<{ priority: PriorityLevel; reasons: string[] }>
    escalate(conversationId: string, reason: string): Promise<void>
    setEscalationRule(rule: Omit<EscalationRule, 'id'>): Promise<EscalationRule>
    removeEscalationRule(ruleId: string): Promise<{ id: string; deleted: true }>
    enableSLABasedPriority(enabled: boolean): Promise<PriorityRouting>
  }
  workload: {
    getAdminWorkload(adminId: string): Promise<AdminWorkload>
    getTeamWorkload(teamId: string): Promise<TeamWorkload>
    autoBalance(teamId: string): Promise<{ rebalanced: number; moves: Array<{ conversation_id: string; from: string; to: string }> }>
    setWorkloadLimit(adminId: string, limit: number): Promise<{ admin_id: string; limit: number }>
    getRealtimeUpdates(teamId: string): AsyncIterable<TeamWorkload>
    getHistoricalData(teamId: string, startDate: number, endDate: number): Promise<Array<{ timestamp: number; workload: TeamWorkload }>>
  }
}

// =============================================================================
// Test Helpers
// =============================================================================

function createTestClient(config?: Partial<IntercomLocalConfig>): ExtendedIntercomLocal {
  return new IntercomLocal({
    workspaceId: 'test_workspace',
    ...config,
  }) as ExtendedIntercomLocal
}

async function createTestConversation(
  client: ExtendedIntercomLocal,
  body = 'Test message',
  options: { tags?: string[]; companySize?: number; emailDomain?: string } = {}
): Promise<{ conversationId: string; contactId: string }> {
  const email = options.emailDomain
    ? `user_${Date.now()}@${options.emailDomain}`
    : `user_${Date.now()}@example.com`

  const contact = await client.contacts.create({
    role: 'user',
    email,
    custom_attributes: options.companySize ? { company_size: options.companySize } : {},
  })

  const conversation = await client.conversations.create({
    from: { type: 'user', id: contact.id },
    body,
  })

  return { conversationId: conversation.id, contactId: contact.id }
}

// =============================================================================
// Inbox CRUD Tests (15+ tests)
// =============================================================================

describe('@dotdo/intercom - Inbox CRUD', () => {
  let client: ExtendedIntercomLocal

  beforeEach(() => {
    client = createTestClient()
  })

  describe('create', () => {
    it('should create inbox with name', async () => {
      const inbox = await client.inboxes.create({
        name: 'Support Inbox',
      })

      expect(inbox.type).toBe('inbox')
      expect(inbox.id).toBeDefined()
      expect(inbox.name).toBe('Support Inbox')
      expect(inbox.team_id).toBeNull()
      expect(inbox.is_default).toBe(false)
      expect(inbox.created_at).toBeDefined()
      expect(inbox.updated_at).toBeDefined()
    })

    it('should create inbox for team', async () => {
      const inbox = await client.inboxes.create({
        name: 'Sales Team Inbox',
        team_id: 'team_sales',
      })

      expect(inbox.team_id).toBe('team_sales')
      expect(inbox.name).toBe('Sales Team Inbox')
    })

    it('should create default inbox', async () => {
      const inbox = await client.inboxes.create({
        name: 'Default Inbox',
        is_default: true,
      })

      expect(inbox.is_default).toBe(true)
    })

    it('should only allow one default inbox', async () => {
      await client.inboxes.create({
        name: 'First Default',
        is_default: true,
      })

      // Creating another default should either fail or demote the first
      const second = await client.inboxes.create({
        name: 'Second Default',
        is_default: true,
      })

      expect(second.is_default).toBe(true)

      const list = await client.inboxes.list()
      const defaults = list.inboxes.filter((i) => i.is_default)
      expect(defaults.length).toBe(1)
      expect(defaults[0].name).toBe('Second Default')
    })

    it('should initialize conversation counts to zero', async () => {
      const inbox = await client.inboxes.create({
        name: 'New Inbox',
      })

      expect(inbox.conversation_counts).toEqual({
        open: 0,
        pending: 0,
        closed: 0,
      })
    })
  })

  describe('find', () => {
    it('should get inbox by ID', async () => {
      const created = await client.inboxes.create({
        name: 'Find Me Inbox',
      })

      const found = await client.inboxes.find(created.id)

      expect(found.id).toBe(created.id)
      expect(found.name).toBe('Find Me Inbox')
    })

    it('should throw error for non-existent inbox', async () => {
      await expect(client.inboxes.find('inbox_nonexistent')).rejects.toThrow()
    })
  })

  describe('update', () => {
    it('should update inbox name', async () => {
      const inbox = await client.inboxes.create({
        name: 'Original Name',
      })

      const updated = await client.inboxes.update(inbox.id, {
        name: 'Updated Name',
      })

      expect(updated.name).toBe('Updated Name')
      expect(updated.updated_at).toBeGreaterThanOrEqual(inbox.updated_at)
    })

    it('should preserve other fields when updating name', async () => {
      const inbox = await client.inboxes.create({
        name: 'Inbox',
        team_id: 'team_support',
      })

      const updated = await client.inboxes.update(inbox.id, {
        name: 'New Name',
      })

      expect(updated.team_id).toBe('team_support')
    })
  })

  describe('delete', () => {
    it('should delete inbox', async () => {
      const inbox = await client.inboxes.create({
        name: 'To Delete',
      })

      const result = await client.inboxes.delete(inbox.id)

      expect(result.id).toBe(inbox.id)
      expect(result.deleted).toBe(true)

      await expect(client.inboxes.find(inbox.id)).rejects.toThrow()
    })

    it('should not delete inbox with open conversations', async () => {
      const inbox = await client.inboxes.create({
        name: 'Has Conversations',
      })

      // Create a conversation and assign it to this inbox
      const { conversationId } = await createTestConversation(client)

      // TODO: Implement inbox assignment for conversations
      // await client.conversations.assignToInbox(conversationId, inbox.id)

      // Should throw or return error
      await expect(client.inboxes.delete(inbox.id)).rejects.toThrow(/open conversations/)
    })

    it('should not delete default inbox', async () => {
      const inbox = await client.inboxes.create({
        name: 'Default',
        is_default: true,
      })

      await expect(client.inboxes.delete(inbox.id)).rejects.toThrow(/default inbox/)
    })
  })

  describe('list', () => {
    it('should list all inboxes', async () => {
      await client.inboxes.create({ name: 'Inbox 1' })
      await client.inboxes.create({ name: 'Inbox 2' })
      await client.inboxes.create({ name: 'Inbox 3' })

      const result = await client.inboxes.list()

      expect(result.inboxes.length).toBe(3)
      expect(result.total_count).toBe(3)
    })

    it('should filter inboxes by team', async () => {
      await client.inboxes.create({ name: 'Team A Inbox', team_id: 'team_a' })
      await client.inboxes.create({ name: 'Team B Inbox', team_id: 'team_b' })
      await client.inboxes.create({ name: 'No Team Inbox' })

      const result = await client.inboxes.list({ team_id: 'team_a' })

      expect(result.inboxes.length).toBe(1)
      expect(result.inboxes[0].team_id).toBe('team_a')
    })
  })

  describe('conversation counts', () => {
    it('should get conversation counts for inbox', async () => {
      const inbox = await client.inboxes.create({
        name: 'Counting Inbox',
      })

      // TODO: Create conversations and assign to inbox
      const counts = await client.inboxes.getConversationCounts(inbox.id)

      expect(counts).toHaveProperty('open')
      expect(counts).toHaveProperty('pending')
      expect(counts).toHaveProperty('closed')
    })

    it('should update counts when conversations change state', async () => {
      const inbox = await client.inboxes.create({
        name: 'Dynamic Counts',
      })

      const { conversationId } = await createTestConversation(client)
      // TODO: Assign conversation to inbox

      const initialCounts = await client.inboxes.getConversationCounts(inbox.id)
      expect(initialCounts.open).toBe(1)

      await client.conversations.close({
        id: conversationId,
        admin_id: 'admin_123',
      })

      const afterClose = await client.inboxes.getConversationCounts(inbox.id)
      expect(afterClose.open).toBe(0)
      expect(afterClose.closed).toBe(1)
    })
  })
})

// =============================================================================
// Team Inboxes Tests (15+ tests)
// =============================================================================

describe('@dotdo/intercom - Team Inboxes', () => {
  let client: ExtendedIntercomLocal

  beforeEach(() => {
    client = createTestClient()
  })

  describe('create team inbox', () => {
    it('should create team inbox with members', async () => {
      const teamInbox = await client.teamInboxes.create({
        name: 'Support Team',
        members: ['admin_1', 'admin_2', 'admin_3'],
      })

      expect(teamInbox.name).toBe('Support Team')
      expect(teamInbox.members.length).toBe(3)
      expect(teamInbox.members.map((m) => m.admin_id)).toContain('admin_1')
    })

    it('should create team inbox with default settings', async () => {
      const teamInbox = await client.teamInboxes.create({
        name: 'New Team',
      })

      expect(teamInbox.settings.round_robin_enabled).toBe(false)
      expect(teamInbox.settings.auto_assignment_enabled).toBe(true)
      expect(teamInbox.settings.assignment_rules).toEqual([])
    })
  })

  describe('member management', () => {
    it('should add team member', async () => {
      const teamInbox = await client.teamInboxes.create({
        name: 'Growing Team',
      })

      const member = await client.teamInboxes.addMember(teamInbox.id, 'admin_new')

      expect(member.admin_id).toBe('admin_new')
      expect(member.availability).toBe('available')
      expect(member.current_open_conversations).toBe(0)
      expect(member.paused_from_rotation).toBe(false)
      expect(member.joined_at).toBeDefined()
    })

    it('should remove team member', async () => {
      const teamInbox = await client.teamInboxes.create({
        name: 'Shrinking Team',
        members: ['admin_1', 'admin_2'],
      })

      const result = await client.teamInboxes.removeMember(teamInbox.id, 'admin_1')

      expect(result.removed).toBe(true)

      const updated = await client.teamInboxes.find(teamInbox.id)
      expect(updated.members.length).toBe(1)
      expect(updated.members[0].admin_id).toBe('admin_2')
    })

    it('should list team members', async () => {
      const teamInbox = await client.teamInboxes.create({
        name: 'Full Team',
        members: ['admin_1', 'admin_2', 'admin_3'],
      })

      const result = await client.teamInboxes.listMembers(teamInbox.id)

      expect(result.members.length).toBe(3)
    })

    it('should prevent removing last member', async () => {
      const teamInbox = await client.teamInboxes.create({
        name: 'Solo Team',
        members: ['admin_solo'],
      })

      await expect(
        client.teamInboxes.removeMember(teamInbox.id, 'admin_solo')
      ).rejects.toThrow(/last member/)
    })
  })

  describe('team stats', () => {
    it('should get team inbox stats (open, pending, closed)', async () => {
      const teamInbox = await client.teamInboxes.create({
        name: 'Stats Team',
        members: ['admin_1'],
      })

      const stats = await client.teamInboxes.getStats(teamInbox.id)

      expect(stats).toHaveProperty('open')
      expect(stats).toHaveProperty('pending')
      expect(stats).toHaveProperty('closed')
    })

    it('should get team member workload stats', async () => {
      const teamInbox = await client.teamInboxes.create({
        name: 'Workload Team',
        members: ['admin_worker'],
      })

      const workload = await client.teamInboxes.getMemberWorkload(teamInbox.id, 'admin_worker')

      expect(workload.admin_id).toBe('admin_worker')
      expect(workload.open_conversations).toBeGreaterThanOrEqual(0)
      expect(workload.average_response_time).toBeGreaterThanOrEqual(0)
      expect(workload.capacity_percentage).toBeGreaterThanOrEqual(0)
    })
  })

  describe('member availability', () => {
    it('should set member availability status', async () => {
      const teamInbox = await client.teamInboxes.create({
        name: 'Availability Team',
        members: ['admin_1'],
      })

      const member = await client.teamInboxes.setMemberAvailability(
        teamInbox.id,
        'admin_1',
        'away'
      )

      expect(member.availability).toBe('away')
    })

    it('should support available, away, and busy statuses', async () => {
      const teamInbox = await client.teamInboxes.create({
        name: 'Status Team',
        members: ['admin_1'],
      })

      await client.teamInboxes.setMemberAvailability(teamInbox.id, 'admin_1', 'available')
      let member = await client.teamInboxes.getMemberWorkload(teamInbox.id, 'admin_1')
      // Member workload doesn't directly show availability, check via listMembers
      const members1 = await client.teamInboxes.listMembers(teamInbox.id)
      expect(members1.members[0].availability).toBe('available')

      await client.teamInboxes.setMemberAvailability(teamInbox.id, 'admin_1', 'busy')
      const members2 = await client.teamInboxes.listMembers(teamInbox.id)
      expect(members2.members[0].availability).toBe('busy')
    })
  })

  describe('conversation transfer', () => {
    it('should transfer conversation between teams', async () => {
      const team1 = await client.teamInboxes.create({
        name: 'Team 1',
        members: ['admin_1'],
      })

      const team2 = await client.teamInboxes.create({
        name: 'Team 2',
        members: ['admin_2'],
      })

      const { conversationId } = await createTestConversation(client)
      // TODO: Assign to team1

      await client.teamInboxes.transferConversation(
        conversationId,
        team1.team_id!,
        team2.team_id!
      )

      // Verify conversation is now in team2
      const conversation = await client.conversations.find(conversationId)
      expect(conversation.team_assignee_id).toBe(team2.team_id)
    })
  })

  describe('capacity limits', () => {
    it('should set team capacity limits', async () => {
      const teamInbox = await client.teamInboxes.create({
        name: 'Limited Team',
        members: ['admin_1'],
      })

      const settings = await client.teamInboxes.setCapacityLimit(teamInbox.id, 50)

      expect(settings.max_open_per_member).toBe(50)
    })

    it('should reject assignment when at capacity', async () => {
      const teamInbox = await client.teamInboxes.create({
        name: 'Full Team',
        members: ['admin_1'],
      })

      await client.teamInboxes.setCapacityLimit(teamInbox.id, 1)

      // Create first conversation - should succeed
      const { conversationId: conv1 } = await createTestConversation(client)
      // TODO: Assign to team
      await client.conversations.assign({
        id: conv1,
        admin_id: 'system',
        assignee_id: 'admin_1',
        type: 'admin',
      })

      // Create second conversation - should queue or warn
      const { conversationId: conv2 } = await createTestConversation(client)
      // TODO: Assignment should handle capacity
    })
  })
})

// =============================================================================
// Assignment Rules Tests (20+ tests)
// =============================================================================

describe('@dotdo/intercom - Assignment Rules', () => {
  let client: ExtendedIntercomLocal
  let inboxId: string

  beforeEach(async () => {
    client = createTestClient()
    const inbox = await client.inboxes.create({ name: 'Rules Inbox' })
    inboxId = inbox.id
  })

  describe('rule CRUD', () => {
    it('should create rule with conditions', async () => {
      const rule = await client.assignmentRules.create(inboxId, {
        name: 'VIP Support',
        priority: 1,
        enabled: true,
        conditions: [
          {
            field: 'email_domain',
            operator: 'equals',
            value: 'vip.example.com',
          },
        ],
        condition_operator: 'AND',
        assignee_type: 'admin',
        assignee_id: 'admin_vip',
      })

      expect(rule.id).toBeDefined()
      expect(rule.name).toBe('VIP Support')
      expect(rule.priority).toBe(1)
      expect(rule.conditions.length).toBe(1)
      expect(rule.created_at).toBeDefined()
    })

    it('should update rule priority', async () => {
      const rule = await client.assignmentRules.create(inboxId, {
        name: 'Test Rule',
        priority: 5,
        enabled: true,
        conditions: [],
        condition_operator: 'AND',
        assignee_type: 'team',
        assignee_id: 'team_default',
      })

      const updated = await client.assignmentRules.updatePriority(rule.id, 1)

      expect(updated.priority).toBe(1)
    })

    it('should delete rule', async () => {
      const rule = await client.assignmentRules.create(inboxId, {
        name: 'To Delete',
        priority: 1,
        enabled: true,
        conditions: [],
        condition_operator: 'AND',
        assignee_type: 'team',
        assignee_id: 'team_default',
      })

      const result = await client.assignmentRules.delete(rule.id)

      expect(result.deleted).toBe(true)
    })

    it('should list rules for inbox', async () => {
      await client.assignmentRules.create(inboxId, {
        name: 'Rule 1',
        priority: 1,
        enabled: true,
        conditions: [],
        condition_operator: 'AND',
        assignee_type: 'team',
        assignee_id: 'team_1',
      })

      await client.assignmentRules.create(inboxId, {
        name: 'Rule 2',
        priority: 2,
        enabled: true,
        conditions: [],
        condition_operator: 'AND',
        assignee_type: 'team',
        assignee_id: 'team_2',
      })

      const result = await client.assignmentRules.list(inboxId)

      expect(result.rules.length).toBe(2)
    })
  })

  describe('rule testing', () => {
    it('should test rule against conversation', async () => {
      const rule = await client.assignmentRules.create(inboxId, {
        name: 'Enterprise Rule',
        priority: 1,
        enabled: true,
        conditions: [
          {
            field: 'email_domain',
            operator: 'equals',
            value: 'enterprise.com',
          },
        ],
        condition_operator: 'AND',
        assignee_type: 'admin',
        assignee_id: 'admin_enterprise',
      })

      const { conversationId } = await createTestConversation(client, 'Help needed', {
        emailDomain: 'enterprise.com',
      })

      const result = await client.assignmentRules.test(rule.id, conversationId)

      expect(result.matches).toBe(true)
      expect(result.matched_conditions.length).toBe(1)
    })

    it('should not match when conditions fail', async () => {
      const rule = await client.assignmentRules.create(inboxId, {
        name: 'Enterprise Rule',
        priority: 1,
        enabled: true,
        conditions: [
          {
            field: 'email_domain',
            operator: 'equals',
            value: 'enterprise.com',
          },
        ],
        condition_operator: 'AND',
        assignee_type: 'admin',
        assignee_id: 'admin_enterprise',
      })

      const { conversationId } = await createTestConversation(client, 'Help needed', {
        emailDomain: 'other.com',
      })

      const result = await client.assignmentRules.test(rule.id, conversationId)

      expect(result.matches).toBe(false)
    })
  })

  describe('condition types', () => {
    it('should support contains operator', async () => {
      const rule = await client.assignmentRules.create(inboxId, {
        name: 'Contains Rule',
        priority: 1,
        enabled: true,
        conditions: [
          {
            field: 'body',
            operator: 'contains',
            value: 'urgent',
          },
        ],
        condition_operator: 'AND',
        assignee_type: 'admin',
        assignee_id: 'admin_urgent',
      })

      const { conversationId } = await createTestConversation(
        client,
        'This is an urgent request'
      )

      const result = await client.assignmentRules.test(rule.id, conversationId)
      expect(result.matches).toBe(true)
    })

    it('should support equals operator', async () => {
      const rule = await client.assignmentRules.create(inboxId, {
        name: 'Equals Rule',
        priority: 1,
        enabled: true,
        conditions: [
          {
            field: 'email_domain',
            operator: 'equals',
            value: 'exact.com',
          },
        ],
        condition_operator: 'AND',
        assignee_type: 'admin',
        assignee_id: 'admin_exact',
      })

      const { conversationId } = await createTestConversation(client, 'Test', {
        emailDomain: 'exact.com',
      })

      const result = await client.assignmentRules.test(rule.id, conversationId)
      expect(result.matches).toBe(true)
    })

    it('should support regex operator', async () => {
      const rule = await client.assignmentRules.create(inboxId, {
        name: 'Regex Rule',
        priority: 1,
        enabled: true,
        conditions: [
          {
            field: 'subject',
            operator: 'regex',
            value: '^\\[TICKET-\\d+\\]',
          },
        ],
        condition_operator: 'AND',
        assignee_type: 'admin',
        assignee_id: 'admin_tickets',
      })

      // TODO: Need way to set subject on conversation
      const { conversationId } = await createTestConversation(
        client,
        '[TICKET-123] Issue description'
      )

      const result = await client.assignmentRules.test(rule.id, conversationId)
      expect(result.matches).toBe(true)
    })

    it('should support subject field', async () => {
      const rule = await client.assignmentRules.create(inboxId, {
        name: 'Subject Rule',
        priority: 1,
        enabled: true,
        conditions: [
          {
            field: 'subject',
            operator: 'contains',
            value: 'billing',
          },
        ],
        condition_operator: 'AND',
        assignee_type: 'team',
        assignee_id: 'team_billing',
      })

      // TODO: Add subject support to conversations
      expect(rule.conditions[0].field).toBe('subject')
    })

    it('should support body field', async () => {
      const rule = await client.assignmentRules.create(inboxId, {
        name: 'Body Rule',
        priority: 1,
        enabled: true,
        conditions: [
          {
            field: 'body',
            operator: 'contains',
            value: 'refund',
          },
        ],
        condition_operator: 'AND',
        assignee_type: 'admin',
        assignee_id: 'admin_refunds',
      })

      const { conversationId } = await createTestConversation(
        client,
        'I would like to request a refund'
      )

      const result = await client.assignmentRules.test(rule.id, conversationId)
      expect(result.matches).toBe(true)
    })

    it('should support email_domain field', async () => {
      const rule = await client.assignmentRules.create(inboxId, {
        name: 'Domain Rule',
        priority: 1,
        enabled: true,
        conditions: [
          {
            field: 'email_domain',
            operator: 'equals',
            value: 'acme.com',
          },
        ],
        condition_operator: 'AND',
        assignee_type: 'admin',
        assignee_id: 'admin_acme',
      })

      const { conversationId } = await createTestConversation(client, 'Help', {
        emailDomain: 'acme.com',
      })

      const result = await client.assignmentRules.test(rule.id, conversationId)
      expect(result.matches).toBe(true)
    })

    it('should support tag field', async () => {
      const rule = await client.assignmentRules.create(inboxId, {
        name: 'Tag Rule',
        priority: 1,
        enabled: true,
        conditions: [
          {
            field: 'tag',
            operator: 'equals',
            value: 'vip',
          },
        ],
        condition_operator: 'AND',
        assignee_type: 'admin',
        assignee_id: 'admin_vip',
      })

      const { conversationId } = await createTestConversation(client, 'VIP request')

      // Add tag to conversation
      await client.conversations.addTag({
        id: conversationId,
        admin_id: 'admin_tagger',
        tag_id: 'vip',
      })

      const result = await client.assignmentRules.test(rule.id, conversationId)
      expect(result.matches).toBe(true)
    })
  })

  describe('multiple conditions', () => {
    it('should support AND conditions (all must match)', async () => {
      const rule = await client.assignmentRules.create(inboxId, {
        name: 'AND Rule',
        priority: 1,
        enabled: true,
        conditions: [
          { field: 'email_domain', operator: 'equals', value: 'enterprise.com' },
          { field: 'body', operator: 'contains', value: 'urgent' },
        ],
        condition_operator: 'AND',
        assignee_type: 'admin',
        assignee_id: 'admin_urgent_enterprise',
      })

      // Both conditions match
      const { conversationId: conv1 } = await createTestConversation(
        client,
        'This is urgent',
        { emailDomain: 'enterprise.com' }
      )
      const result1 = await client.assignmentRules.test(rule.id, conv1)
      expect(result1.matches).toBe(true)

      // Only one condition matches
      const { conversationId: conv2 } = await createTestConversation(
        client,
        'Not urgent at all',
        { emailDomain: 'enterprise.com' }
      )
      const result2 = await client.assignmentRules.test(rule.id, conv2)
      expect(result2.matches).toBe(false)
    })

    it('should support OR conditions (any must match)', async () => {
      const rule = await client.assignmentRules.create(inboxId, {
        name: 'OR Rule',
        priority: 1,
        enabled: true,
        conditions: [
          { field: 'email_domain', operator: 'equals', value: 'vip1.com' },
          { field: 'email_domain', operator: 'equals', value: 'vip2.com' },
        ],
        condition_operator: 'OR',
        assignee_type: 'admin',
        assignee_id: 'admin_vip',
      })

      const { conversationId: conv1 } = await createTestConversation(client, 'Test', {
        emailDomain: 'vip1.com',
      })
      const result1 = await client.assignmentRules.test(rule.id, conv1)
      expect(result1.matches).toBe(true)

      const { conversationId: conv2 } = await createTestConversation(client, 'Test', {
        emailDomain: 'vip2.com',
      })
      const result2 = await client.assignmentRules.test(rule.id, conv2)
      expect(result2.matches).toBe(true)

      const { conversationId: conv3 } = await createTestConversation(client, 'Test', {
        emailDomain: 'other.com',
      })
      const result3 = await client.assignmentRules.test(rule.id, conv3)
      expect(result3.matches).toBe(false)
    })
  })

  describe('rule execution', () => {
    it('should execute rules in priority order', async () => {
      // Low priority rule
      await client.assignmentRules.create(inboxId, {
        name: 'Low Priority',
        priority: 10,
        enabled: true,
        conditions: [{ field: 'body', operator: 'contains', value: 'help' }],
        condition_operator: 'AND',
        assignee_type: 'team',
        assignee_id: 'team_general',
      })

      // High priority rule
      await client.assignmentRules.create(inboxId, {
        name: 'High Priority',
        priority: 1,
        enabled: true,
        conditions: [{ field: 'body', operator: 'contains', value: 'help' }],
        condition_operator: 'AND',
        assignee_type: 'admin',
        assignee_id: 'admin_priority',
      })

      const { conversationId } = await createTestConversation(client, 'I need help')

      // Run assignment rules
      const result = await client.conversations.runAssignmentRules(conversationId)

      // Should be assigned to admin_priority (priority 1, not team_general priority 10)
      expect(result.admin_assignee_id).toBe('admin_priority')
    })

    it('should use default assignment when no rules match', async () => {
      await client.assignmentRules.setDefault(inboxId, 'team', 'team_default')

      await client.assignmentRules.create(inboxId, {
        name: 'Specific Rule',
        priority: 1,
        enabled: true,
        conditions: [{ field: 'email_domain', operator: 'equals', value: 'special.com' }],
        condition_operator: 'AND',
        assignee_type: 'admin',
        assignee_id: 'admin_special',
      })

      const { conversationId } = await createTestConversation(client, 'Regular message', {
        emailDomain: 'regular.com',
      })

      const result = await client.conversations.runAssignmentRules(conversationId)

      expect(result.team_assignee_id).toBe('team_default')
    })

    it('should skip disabled rules', async () => {
      await client.assignmentRules.create(inboxId, {
        name: 'Disabled Rule',
        priority: 1,
        enabled: false,
        conditions: [{ field: 'body', operator: 'contains', value: 'test' }],
        condition_operator: 'AND',
        assignee_type: 'admin',
        assignee_id: 'admin_disabled',
      })

      await client.assignmentRules.create(inboxId, {
        name: 'Enabled Rule',
        priority: 2,
        enabled: true,
        conditions: [{ field: 'body', operator: 'contains', value: 'test' }],
        condition_operator: 'AND',
        assignee_type: 'admin',
        assignee_id: 'admin_enabled',
      })

      const { conversationId } = await createTestConversation(client, 'This is a test')

      const result = await client.conversations.runAssignmentRules(conversationId)

      expect(result.admin_assignee_id).toBe('admin_enabled')
    })
  })
})

// =============================================================================
// Round-Robin Tests (15+ tests)
// =============================================================================

describe('@dotdo/intercom - Round-Robin Assignment', () => {
  let client: ExtendedIntercomLocal
  let teamInboxId: string

  beforeEach(async () => {
    client = createTestClient()
    const teamInbox = await client.teamInboxes.create({
      name: 'Round Robin Team',
      members: ['admin_1', 'admin_2', 'admin_3'],
    })
    teamInboxId = teamInbox.id
  })

  describe('enable/disable', () => {
    it('should enable round-robin for inbox', async () => {
      const settings = await client.roundRobin.enable(teamInboxId)

      expect(settings.round_robin_enabled).toBe(true)
    })

    it('should disable round-robin for inbox', async () => {
      await client.roundRobin.enable(teamInboxId)
      const settings = await client.roundRobin.disable(teamInboxId)

      expect(settings.round_robin_enabled).toBe(false)
    })
  })

  describe('configuration', () => {
    it('should set max open conversations per member', async () => {
      await client.roundRobin.enable(teamInboxId)

      const settings = await client.roundRobin.setMaxOpenPerMember(teamInboxId, 10)

      expect(settings.max_open_per_member).toBe(10)
    })

    it('should get round-robin status', async () => {
      await client.roundRobin.enable(teamInboxId)

      const status = await client.roundRobin.getStatus(teamInboxId)

      expect(status.enabled).toBe(true)
      expect(status.current_member_index).toBe(0)
      expect(status.members).toContain('admin_1')
      expect(status.members).toContain('admin_2')
      expect(status.members).toContain('admin_3')
    })
  })

  describe('member rotation control', () => {
    it('should pause member from rotation', async () => {
      await client.roundRobin.enable(teamInboxId)

      const member = await client.roundRobin.pauseMember(teamInboxId, 'admin_1')

      expect(member.paused_from_rotation).toBe(true)
    })

    it('should resume member in rotation', async () => {
      await client.roundRobin.enable(teamInboxId)
      await client.roundRobin.pauseMember(teamInboxId, 'admin_1')

      const member = await client.roundRobin.resumeMember(teamInboxId, 'admin_1')

      expect(member.paused_from_rotation).toBe(false)
    })

    it('should skip paused members during assignment', async () => {
      await client.roundRobin.enable(teamInboxId)
      await client.roundRobin.pauseMember(teamInboxId, 'admin_1')
      await client.roundRobin.pauseMember(teamInboxId, 'admin_2')

      const next = await client.roundRobin.getNextAssignee(teamInboxId)

      expect(next.admin_id).toBe('admin_3')
      expect(next.reason).toContain('round_robin')
    })
  })

  describe('assignment behavior', () => {
    it('should skip overloaded members', async () => {
      await client.roundRobin.enable(teamInboxId)
      await client.roundRobin.setMaxOpenPerMember(teamInboxId, 1)

      // Assign a conversation to admin_1
      const { conversationId: conv1 } = await createTestConversation(client)
      await client.conversations.assign({
        id: conv1,
        admin_id: 'system',
        assignee_id: 'admin_1',
        type: 'admin',
      })

      // Next assignee should skip admin_1
      const next = await client.roundRobin.getNextAssignee(teamInboxId)

      expect(next.admin_id).not.toBe('admin_1')
      expect(next.reason).toContain('capacity')
    })

    it('should skip offline members', async () => {
      await client.roundRobin.enable(teamInboxId)
      await client.teamInboxes.setMemberAvailability(teamInboxId, 'admin_1', 'away')
      await client.teamInboxes.setMemberAvailability(teamInboxId, 'admin_2', 'away')

      const next = await client.roundRobin.getNextAssignee(teamInboxId)

      expect(next.admin_id).toBe('admin_3')
    })

    it('should ensure even distribution', async () => {
      await client.roundRobin.enable(teamInboxId)

      // Create and assign 9 conversations
      for (let i = 0; i < 9; i++) {
        const { conversationId } = await createTestConversation(client, `Message ${i}`)
        const next = await client.roundRobin.getNextAssignee(teamInboxId)
        await client.conversations.assign({
          id: conversationId,
          admin_id: 'system',
          assignee_id: next.admin_id,
          type: 'admin',
        })
      }

      const validation = await client.roundRobin.validateDistribution(teamInboxId)

      expect(validation.even).toBe(true)
      expect(validation.max_diff).toBe(0)
      expect(validation.distribution['admin_1']).toBe(3)
      expect(validation.distribution['admin_2']).toBe(3)
      expect(validation.distribution['admin_3']).toBe(3)
    })

    it('should reset rotation when members change', async () => {
      await client.roundRobin.enable(teamInboxId)

      // Assign some conversations to advance the rotation
      for (let i = 0; i < 2; i++) {
        const { conversationId } = await createTestConversation(client)
        const next = await client.roundRobin.getNextAssignee(teamInboxId)
        await client.conversations.assign({
          id: conversationId,
          admin_id: 'system',
          assignee_id: next.admin_id,
          type: 'admin',
        })
      }

      const statusBefore = await client.roundRobin.getStatus(teamInboxId)
      expect(statusBefore.current_member_index).toBeGreaterThan(0)

      // Add a new member
      await client.teamInboxes.addMember(teamInboxId, 'admin_4')
      await client.roundRobin.resetOnMemberChange(teamInboxId)

      const statusAfter = await client.roundRobin.getStatus(teamInboxId)
      expect(statusAfter.current_member_index).toBe(0)
      expect(statusAfter.members.length).toBe(4)
    })
  })

  describe('edge cases', () => {
    it('should handle all members unavailable', async () => {
      await client.roundRobin.enable(teamInboxId)
      await client.teamInboxes.setMemberAvailability(teamInboxId, 'admin_1', 'away')
      await client.teamInboxes.setMemberAvailability(teamInboxId, 'admin_2', 'away')
      await client.teamInboxes.setMemberAvailability(teamInboxId, 'admin_3', 'away')

      await expect(client.roundRobin.getNextAssignee(teamInboxId)).rejects.toThrow(
        /no available members/
      )
    })

    it('should handle all members at capacity', async () => {
      await client.roundRobin.enable(teamInboxId)
      await client.roundRobin.setMaxOpenPerMember(teamInboxId, 1)

      // Fill up all members
      for (const adminId of ['admin_1', 'admin_2', 'admin_3']) {
        const { conversationId } = await createTestConversation(client)
        await client.conversations.assign({
          id: conversationId,
          admin_id: 'system',
          assignee_id: adminId,
          type: 'admin',
        })
      }

      // Next assignment should either queue or throw
      await expect(client.roundRobin.getNextAssignee(teamInboxId)).rejects.toThrow(
        /all members at capacity/
      )
    })

    it('should handle single member team', async () => {
      const soloTeam = await client.teamInboxes.create({
        name: 'Solo Team',
        members: ['admin_solo'],
      })

      await client.roundRobin.enable(soloTeam.id)

      for (let i = 0; i < 3; i++) {
        const next = await client.roundRobin.getNextAssignee(soloTeam.id)
        expect(next.admin_id).toBe('admin_solo')
      }
    })
  })
})

// =============================================================================
// Priority Routing Tests (15+ tests)
// =============================================================================

describe('@dotdo/intercom - Priority Routing', () => {
  let client: ExtendedIntercomLocal

  beforeEach(() => {
    client = createTestClient()
  })

  describe('VIP conditions', () => {
    it('should set VIP conditions by email domain', async () => {
      const condition = await client.priorityRouting.setVIPCondition({
        type: 'email_domain',
        value: 'enterprise.com',
        priority: 'high',
      })

      expect(condition.id).toBeDefined()
      expect(condition.type).toBe('email_domain')
      expect(condition.priority).toBe('high')
    })

    it('should set VIP conditions by company size', async () => {
      const condition = await client.priorityRouting.setVIPCondition({
        type: 'company_size',
        value: 1000,
        priority: 'high',
      })

      expect(condition.type).toBe('company_size')
      expect(condition.value).toBe(1000)
    })

    it('should remove VIP condition', async () => {
      const condition = await client.priorityRouting.setVIPCondition({
        type: 'email_domain',
        value: 'test.com',
        priority: 'high',
      })

      const result = await client.priorityRouting.removeVIPCondition(condition.id)

      expect(result.deleted).toBe(true)
    })

    it('should apply VIP priority to matching conversations', async () => {
      await client.priorityRouting.setVIPCondition({
        type: 'email_domain',
        value: 'vip.com',
        priority: 'high',
      })

      const { conversationId } = await createTestConversation(client, 'VIP request', {
        emailDomain: 'vip.com',
      })

      const result = await client.priorityRouting.getPriorityForConversation(conversationId)

      expect(result.priority).toBe('high')
      expect(result.reasons).toContain('VIP: email_domain matches vip.com')
    })
  })

  describe('urgent keywords', () => {
    it('should set urgent keywords', async () => {
      const result = await client.priorityRouting.setUrgentKeywords([
        'urgent',
        'emergency',
        'critical',
        'asap',
      ])

      expect(result.keywords).toContain('urgent')
      expect(result.keywords).toContain('emergency')
    })

    it('should detect urgent priority from keywords', async () => {
      await client.priorityRouting.setUrgentKeywords(['urgent', 'emergency'])

      const { conversationId } = await createTestConversation(
        client,
        'This is an EMERGENCY! Please help immediately!'
      )

      const result = await client.priorityRouting.getPriorityForConversation(conversationId)

      expect(result.priority).toBe('urgent')
      expect(result.reasons).toContain('Contains urgent keyword: emergency')
    })

    it('should be case-insensitive for keywords', async () => {
      await client.priorityRouting.setUrgentKeywords(['urgent'])

      const { conversationId } = await createTestConversation(client, 'This is URGENT!')

      const result = await client.priorityRouting.getPriorityForConversation(conversationId)

      expect(result.priority).toBe('urgent')
    })
  })

  describe('priority levels', () => {
    it('should get priority for conversation', async () => {
      const { conversationId } = await createTestConversation(client, 'Normal question')

      const result = await client.priorityRouting.getPriorityForConversation(conversationId)

      expect(['low', 'normal', 'high', 'urgent']).toContain(result.priority)
    })

    it('should support all priority levels: low, normal, high, urgent', async () => {
      // Low priority - no special markers
      const { conversationId: lowConv } = await createTestConversation(client, 'Just wondering')

      // Set up conditions for different priorities
      await client.priorityRouting.setVIPCondition({
        type: 'email_domain',
        value: 'important.com',
        priority: 'high',
      })

      await client.priorityRouting.setUrgentKeywords(['emergency'])

      const { conversationId: highConv } = await createTestConversation(client, 'Question', {
        emailDomain: 'important.com',
      })

      const { conversationId: urgentConv } = await createTestConversation(
        client,
        'Emergency situation!'
      )

      const lowResult = await client.priorityRouting.getPriorityForConversation(lowConv)
      const highResult = await client.priorityRouting.getPriorityForConversation(highConv)
      const urgentResult = await client.priorityRouting.getPriorityForConversation(urgentConv)

      expect(lowResult.priority).toBe('normal')
      expect(highResult.priority).toBe('high')
      expect(urgentResult.priority).toBe('urgent')
    })
  })

  describe('manual escalation', () => {
    it('should escalate conversation with reason', async () => {
      const { conversationId } = await createTestConversation(client, 'Complex issue')

      await client.priorityRouting.escalate(conversationId, 'Customer threatening legal action')

      const result = await client.priorityRouting.getPriorityForConversation(conversationId)

      expect(result.priority).toBe('urgent')
      expect(result.reasons).toContain('Manual escalation: Customer threatening legal action')
    })
  })

  describe('escalation rules', () => {
    it('should set escalation rule for time waiting', async () => {
      const rule = await client.priorityRouting.setEscalationRule({
        trigger: 'time_waiting',
        threshold_minutes: 30,
        escalate_to: 'admin',
        escalate_to_id: 'admin_supervisor',
        enabled: true,
      })

      expect(rule.id).toBeDefined()
      expect(rule.trigger).toBe('time_waiting')
      expect(rule.threshold_minutes).toBe(30)
    })

    it('should set escalation rule for SLA breach', async () => {
      const rule = await client.priorityRouting.setEscalationRule({
        trigger: 'sla_breach',
        escalate_to: 'team',
        escalate_to_id: 'team_escalation',
        enabled: true,
      })

      expect(rule.trigger).toBe('sla_breach')
    })

    it('should remove escalation rule', async () => {
      const rule = await client.priorityRouting.setEscalationRule({
        trigger: 'time_waiting',
        threshold_minutes: 60,
        escalate_to: 'admin',
        escalate_to_id: 'admin_1',
        enabled: true,
      })

      const result = await client.priorityRouting.removeEscalationRule(rule.id)

      expect(result.deleted).toBe(true)
    })
  })

  describe('SLA-based priority', () => {
    it('should enable SLA-based priority', async () => {
      const config = await client.priorityRouting.enableSLABasedPriority(true)

      expect(config.sla_based_priority).toBe(true)
    })

    it('should increase priority as SLA deadline approaches', async () => {
      await client.priorityRouting.enableSLABasedPriority(true)

      // TODO: Create conversation with SLA and simulate time passage
      const { conversationId } = await createTestConversation(client, 'SLA bound request')

      // Conversation should start at normal priority
      const initialResult =
        await client.priorityRouting.getPriorityForConversation(conversationId)
      expect(initialResult.priority).toBe('normal')

      // TODO: Fast-forward time to near SLA breach
      // Priority should increase
    })
  })

  describe('priority affects assignment order', () => {
    it('should assign high priority conversations first', async () => {
      await client.priorityRouting.setUrgentKeywords(['urgent'])

      const teamInbox = await client.teamInboxes.create({
        name: 'Priority Team',
        members: ['admin_1'],
      })

      // Create normal priority conversation first
      const { conversationId: normalConv } = await createTestConversation(
        client,
        'Regular question'
      )

      // Create urgent conversation second
      const { conversationId: urgentConv } = await createTestConversation(
        client,
        'Urgent issue!'
      )

      // When getting queue, urgent should be first
      // TODO: Implement priority queue for inbox
    })
  })
})

// =============================================================================
// Workload Balancing Tests (10+ tests)
// =============================================================================

describe('@dotdo/intercom - Workload Balancing', () => {
  let client: ExtendedIntercomLocal
  let teamId: string

  beforeEach(async () => {
    client = createTestClient()
    const teamInbox = await client.teamInboxes.create({
      name: 'Workload Team',
      members: ['admin_1', 'admin_2', 'admin_3'],
    })
    teamId = teamInbox.team_id!
  })

  describe('admin workload', () => {
    it('should get admin workload', async () => {
      const workload = await client.workload.getAdminWorkload('admin_1')

      expect(workload.admin_id).toBe('admin_1')
      expect(workload).toHaveProperty('open_conversations')
      expect(workload).toHaveProperty('pending_conversations')
      expect(workload).toHaveProperty('closed_today')
      expect(workload).toHaveProperty('average_response_time')
      expect(workload).toHaveProperty('capacity_percentage')
    })

    it('should calculate capacity percentage correctly', async () => {
      await client.workload.setWorkloadLimit('admin_1', 10)

      // Assign 5 conversations to admin_1
      for (let i = 0; i < 5; i++) {
        const { conversationId } = await createTestConversation(client)
        await client.conversations.assign({
          id: conversationId,
          admin_id: 'system',
          assignee_id: 'admin_1',
          type: 'admin',
        })
      }

      const workload = await client.workload.getAdminWorkload('admin_1')

      expect(workload.open_conversations).toBe(5)
      expect(workload.capacity_percentage).toBe(50)
    })
  })

  describe('team workload', () => {
    it('should get team workload', async () => {
      const workload = await client.workload.getTeamWorkload(teamId)

      expect(workload.team_id).toBe(teamId)
      expect(workload).toHaveProperty('total_open')
      expect(workload).toHaveProperty('total_pending')
      expect(workload).toHaveProperty('members')
      expect(workload.members.length).toBe(3)
    })

    it('should identify bottleneck admin', async () => {
      // Overload admin_1
      for (let i = 0; i < 10; i++) {
        const { conversationId } = await createTestConversation(client)
        await client.conversations.assign({
          id: conversationId,
          admin_id: 'system',
          assignee_id: 'admin_1',
          type: 'admin',
        })
      }

      const workload = await client.workload.getTeamWorkload(teamId)

      expect(workload.bottleneck_admin_id).toBe('admin_1')
    })
  })

  describe('auto-balance', () => {
    it('should auto-balance workload across team', async () => {
      // Create imbalanced workload
      for (let i = 0; i < 9; i++) {
        const { conversationId } = await createTestConversation(client)
        await client.conversations.assign({
          id: conversationId,
          admin_id: 'system',
          assignee_id: 'admin_1',
          type: 'admin',
        })
      }

      const workloadBefore = await client.workload.getTeamWorkload(teamId)
      expect(workloadBefore.members.find((m) => m.admin_id === 'admin_1')?.open_conversations).toBe(
        9
      )

      const result = await client.workload.autoBalance(teamId)

      expect(result.rebalanced).toBe(6) // Should move 6 conversations to balance (3 each)
      expect(result.moves.length).toBe(6)

      const workloadAfter = await client.workload.getTeamWorkload(teamId)
      for (const member of workloadAfter.members) {
        expect(member.open_conversations).toBe(3)
      }
    })

    it('should report moves made during auto-balance', async () => {
      // Create some imbalance
      for (let i = 0; i < 6; i++) {
        const { conversationId } = await createTestConversation(client)
        await client.conversations.assign({
          id: conversationId,
          admin_id: 'system',
          assignee_id: 'admin_1',
          type: 'admin',
        })
      }

      const result = await client.workload.autoBalance(teamId)

      for (const move of result.moves) {
        expect(move).toHaveProperty('conversation_id')
        expect(move).toHaveProperty('from')
        expect(move).toHaveProperty('to')
        expect(move.from).toBe('admin_1')
        expect(['admin_2', 'admin_3']).toContain(move.to)
      }
    })
  })

  describe('workload limits', () => {
    it('should set workload limit per admin', async () => {
      const result = await client.workload.setWorkloadLimit('admin_1', 20)

      expect(result.admin_id).toBe('admin_1')
      expect(result.limit).toBe(20)
    })

    it('should respect workload limits during assignment', async () => {
      await client.workload.setWorkloadLimit('admin_1', 2)

      // Assign 2 conversations to admin_1
      for (let i = 0; i < 2; i++) {
        const { conversationId } = await createTestConversation(client)
        await client.conversations.assign({
          id: conversationId,
          admin_id: 'system',
          assignee_id: 'admin_1',
          type: 'admin',
        })
      }

      // Third assignment should fail or redirect
      const { conversationId } = await createTestConversation(client)
      await expect(
        client.conversations.assign({
          id: conversationId,
          admin_id: 'system',
          assignee_id: 'admin_1',
          type: 'admin',
        })
      ).rejects.toThrow(/workload limit/)
    })
  })

  describe('real-time updates', () => {
    it('should provide real-time workload updates', async () => {
      const updates: TeamWorkload[] = []

      const stream = client.workload.getRealtimeUpdates(teamId)

      // Collect first update
      for await (const update of stream) {
        updates.push(update)
        if (updates.length >= 1) break
      }

      expect(updates.length).toBeGreaterThanOrEqual(1)
      expect(updates[0].team_id).toBe(teamId)
    })
  })

  describe('historical data', () => {
    it('should get historical workload data', async () => {
      const now = Math.floor(Date.now() / 1000)
      const oneDayAgo = now - 86400

      const history = await client.workload.getHistoricalData(teamId, oneDayAgo, now)

      expect(Array.isArray(history)).toBe(true)
      for (const entry of history) {
        expect(entry).toHaveProperty('timestamp')
        expect(entry).toHaveProperty('workload')
        expect(entry.workload.team_id).toBe(teamId)
      }
    })
  })
})

// =============================================================================
// SLA Management Tests (15+ tests)
// =============================================================================

/**
 * SLA Policy for inbox
 */
export interface SLAPolicy {
  id: string
  name: string
  description?: string
  first_response_time: number // seconds
  next_response_time: number // seconds
  resolution_time: number // seconds
  business_hours?: BusinessHours
  priority_overrides?: Record<PriorityLevel, Partial<SLATimings>>
  is_active: boolean
  created_at: number
  updated_at: number
}

/**
 * SLA timings
 */
export interface SLATimings {
  first_response_time: number
  next_response_time: number
  resolution_time: number
}

/**
 * Business hours configuration
 */
export interface BusinessHours {
  timezone: string
  schedule: {
    [day: string]: {
      start: string // HH:mm
      end: string // HH:mm
      is_closed: boolean
    }
  }
  holidays: Array<{
    date: string // YYYY-MM-DD
    name: string
  }>
}

/**
 * SLA status for a conversation
 */
export interface SLAStatus {
  conversation_id: string
  policy_id: string
  policy_name: string
  first_response: SLAMetric
  next_response: SLAMetric
  resolution: SLAMetric
  overall_status: 'on_track' | 'at_risk' | 'breached'
}

/**
 * Individual SLA metric
 */
export interface SLAMetric {
  target: number | null
  actual: number | null
  is_breached: boolean
  time_remaining?: number
}

/**
 * SLA breach record
 */
export interface SLABreach {
  id: string
  conversation_id: string
  policy_id: string
  breach_type: 'first_response' | 'next_response' | 'resolution'
  target_time: number
  actual_time?: number
  breached_by: number // seconds
  admin_id?: string
  created_at: number
}

/**
 * Extended client with SLA management
 */
interface ExtendedWithSLA extends ExtendedIntercomLocal {
  sla: {
    createPolicy(params: Omit<SLAPolicy, 'id' | 'created_at' | 'updated_at'>): Promise<SLAPolicy>
    getPolicy(policyId: string): Promise<SLAPolicy>
    updatePolicy(policyId: string, params: Partial<SLAPolicy>): Promise<SLAPolicy>
    deletePolicy(policyId: string): Promise<{ id: string; deleted: true }>
    listPolicies(): Promise<{ policies: SLAPolicy[] }>
    assignToInbox(inboxId: string, policyId: string): Promise<void>
    removeFromInbox(inboxId: string): Promise<void>
    getStatus(conversationId: string): Promise<SLAStatus>
    getBreaches(
      inboxId: string,
      options?: { period?: 'today' | 'week' | 'month'; breachType?: SLABreach['breach_type'] }
    ): Promise<{ breaches: SLABreach[] }>
    setBusinessHours(policyId: string, hours: BusinessHours): Promise<SLAPolicy>
    setPriorityOverrides(policyId: string, overrides: SLAPolicy['priority_overrides']): Promise<SLAPolicy>
    pauseForConversation(conversationId: string, reason: string): Promise<void>
    resumeForConversation(conversationId: string): Promise<void>
  }
}

describe('@dotdo/intercom - SLA Management', () => {
  let client: ExtendedWithSLA
  let inboxId: string

  beforeEach(async () => {
    client = createTestClient() as ExtendedWithSLA
    const inbox = await client.inboxes.create({ name: 'SLA Inbox' })
    inboxId = inbox.id
  })

  describe('policy CRUD', () => {
    it('should create SLA policy with timings', async () => {
      const policy = await client.sla.createPolicy({
        name: 'Standard SLA',
        first_response_time: 3600, // 1 hour
        next_response_time: 7200, // 2 hours
        resolution_time: 86400, // 24 hours
        is_active: true,
      })

      expect(policy.id).toBeDefined()
      expect(policy.name).toBe('Standard SLA')
      expect(policy.first_response_time).toBe(3600)
      expect(policy.next_response_time).toBe(7200)
      expect(policy.resolution_time).toBe(86400)
      expect(policy.created_at).toBeDefined()
    })

    it('should get SLA policy by ID', async () => {
      const created = await client.sla.createPolicy({
        name: 'Test SLA',
        first_response_time: 1800,
        next_response_time: 3600,
        resolution_time: 43200,
        is_active: true,
      })

      const found = await client.sla.getPolicy(created.id)

      expect(found.id).toBe(created.id)
      expect(found.name).toBe('Test SLA')
    })

    it('should update SLA policy', async () => {
      const policy = await client.sla.createPolicy({
        name: 'Original',
        first_response_time: 3600,
        next_response_time: 7200,
        resolution_time: 86400,
        is_active: true,
      })

      const updated = await client.sla.updatePolicy(policy.id, {
        name: 'Updated SLA',
        first_response_time: 1800,
      })

      expect(updated.name).toBe('Updated SLA')
      expect(updated.first_response_time).toBe(1800)
      expect(updated.resolution_time).toBe(86400) // unchanged
    })

    it('should delete SLA policy', async () => {
      const policy = await client.sla.createPolicy({
        name: 'To Delete',
        first_response_time: 3600,
        next_response_time: 7200,
        resolution_time: 86400,
        is_active: true,
      })

      const result = await client.sla.deletePolicy(policy.id)

      expect(result.deleted).toBe(true)
      await expect(client.sla.getPolicy(policy.id)).rejects.toThrow()
    })

    it('should list all SLA policies', async () => {
      await client.sla.createPolicy({
        name: 'Policy 1',
        first_response_time: 3600,
        next_response_time: 7200,
        resolution_time: 86400,
        is_active: true,
      })

      await client.sla.createPolicy({
        name: 'Policy 2',
        first_response_time: 1800,
        next_response_time: 3600,
        resolution_time: 43200,
        is_active: true,
      })

      const result = await client.sla.listPolicies()

      expect(result.policies.length).toBe(2)
    })
  })

  describe('inbox assignment', () => {
    it('should assign SLA policy to inbox', async () => {
      const policy = await client.sla.createPolicy({
        name: 'Inbox SLA',
        first_response_time: 3600,
        next_response_time: 7200,
        resolution_time: 86400,
        is_active: true,
      })

      await client.sla.assignToInbox(inboxId, policy.id)

      // Verify inbox has SLA
      const inbox = await client.inboxes.find(inboxId)
      expect((inbox as any).sla_policy_id).toBe(policy.id)
    })

    it('should remove SLA policy from inbox', async () => {
      const policy = await client.sla.createPolicy({
        name: 'Temp SLA',
        first_response_time: 3600,
        next_response_time: 7200,
        resolution_time: 86400,
        is_active: true,
      })

      await client.sla.assignToInbox(inboxId, policy.id)
      await client.sla.removeFromInbox(inboxId)

      const inbox = await client.inboxes.find(inboxId)
      expect((inbox as any).sla_policy_id).toBeUndefined()
    })

    it('should throw when assigning non-existent policy', async () => {
      await expect(client.sla.assignToInbox(inboxId, 'sla_nonexistent')).rejects.toThrow()
    })
  })

  describe('SLA status tracking', () => {
    it('should get SLA status for conversation', async () => {
      const policy = await client.sla.createPolicy({
        name: 'Tracking SLA',
        first_response_time: 3600,
        next_response_time: 7200,
        resolution_time: 86400,
        is_active: true,
      })

      await client.sla.assignToInbox(inboxId, policy.id)

      const { conversationId } = await createTestConversation(client)
      // TODO: Assign conversation to inbox

      const status = await client.sla.getStatus(conversationId)

      expect(status.conversation_id).toBe(conversationId)
      expect(status.policy_id).toBe(policy.id)
      expect(status.first_response).toHaveProperty('target')
      expect(status.first_response).toHaveProperty('is_breached')
      expect(status.overall_status).toBe('on_track')
    })

    it('should track first response SLA', async () => {
      const policy = await client.sla.createPolicy({
        name: 'First Response SLA',
        first_response_time: 3600, // 1 hour
        next_response_time: 7200,
        resolution_time: 86400,
        is_active: true,
      })

      await client.sla.assignToInbox(inboxId, policy.id)

      const { conversationId } = await createTestConversation(client)

      let status = await client.sla.getStatus(conversationId)
      expect(status.first_response.target).toBeDefined()
      expect(status.first_response.actual).toBeNull()
      expect(status.first_response.is_breached).toBe(false)

      // Reply to conversation
      await client.conversations.reply({
        id: conversationId,
        type: 'admin',
        admin_id: 'admin_1',
        body: 'Here to help!',
      })

      status = await client.sla.getStatus(conversationId)
      expect(status.first_response.actual).toBeDefined()
      expect(status.first_response.is_breached).toBe(false)
    })

    it('should detect SLA breach', async () => {
      const policy = await client.sla.createPolicy({
        name: 'Strict SLA',
        first_response_time: 1, // 1 second - will breach immediately
        next_response_time: 1,
        resolution_time: 1,
        is_active: true,
      })

      await client.sla.assignToInbox(inboxId, policy.id)

      const { conversationId } = await createTestConversation(client)

      // Wait for breach
      await new Promise((resolve) => setTimeout(resolve, 50))

      const status = await client.sla.getStatus(conversationId)
      expect(status.first_response.is_breached).toBe(true)
      expect(status.overall_status).toBe('breached')
    })

    it('should calculate time remaining', async () => {
      const policy = await client.sla.createPolicy({
        name: 'Time Remaining SLA',
        first_response_time: 3600,
        next_response_time: 7200,
        resolution_time: 86400,
        is_active: true,
      })

      await client.sla.assignToInbox(inboxId, policy.id)

      const { conversationId } = await createTestConversation(client)
      const status = await client.sla.getStatus(conversationId)

      expect(status.first_response.time_remaining).toBeDefined()
      expect(status.first_response.time_remaining).toBeGreaterThan(0)
      expect(status.first_response.time_remaining).toBeLessThanOrEqual(3600)
    })
  })

  describe('SLA breaches', () => {
    it('should record SLA breach', async () => {
      const policy = await client.sla.createPolicy({
        name: 'Breach SLA',
        first_response_time: 1,
        next_response_time: 1,
        resolution_time: 1,
        is_active: true,
      })

      await client.sla.assignToInbox(inboxId, policy.id)

      await createTestConversation(client)

      // Wait for breach
      await new Promise((resolve) => setTimeout(resolve, 50))

      const result = await client.sla.getBreaches(inboxId)

      expect(result.breaches.length).toBeGreaterThan(0)
      expect(result.breaches[0].breach_type).toBe('first_response')
    })

    it('should filter breaches by period', async () => {
      const policy = await client.sla.createPolicy({
        name: 'Period SLA',
        first_response_time: 1,
        next_response_time: 1,
        resolution_time: 1,
        is_active: true,
      })

      await client.sla.assignToInbox(inboxId, policy.id)

      await createTestConversation(client)
      await new Promise((resolve) => setTimeout(resolve, 50))

      const todayBreaches = await client.sla.getBreaches(inboxId, { period: 'today' })
      const weekBreaches = await client.sla.getBreaches(inboxId, { period: 'week' })

      expect(todayBreaches.breaches.length).toBeGreaterThan(0)
      expect(weekBreaches.breaches.length).toBeGreaterThanOrEqual(todayBreaches.breaches.length)
    })

    it('should filter breaches by type', async () => {
      const policy = await client.sla.createPolicy({
        name: 'Type Filter SLA',
        first_response_time: 1,
        next_response_time: 1,
        resolution_time: 1,
        is_active: true,
      })

      await client.sla.assignToInbox(inboxId, policy.id)

      await createTestConversation(client)
      await new Promise((resolve) => setTimeout(resolve, 50))

      const firstResponseBreaches = await client.sla.getBreaches(inboxId, {
        breachType: 'first_response',
      })

      for (const breach of firstResponseBreaches.breaches) {
        expect(breach.breach_type).toBe('first_response')
      }
    })
  })

  describe('business hours', () => {
    it('should set business hours for SLA policy', async () => {
      const policy = await client.sla.createPolicy({
        name: 'Business Hours SLA',
        first_response_time: 3600,
        next_response_time: 7200,
        resolution_time: 86400,
        is_active: true,
      })

      const businessHours: BusinessHours = {
        timezone: 'America/New_York',
        schedule: {
          monday: { start: '09:00', end: '17:00', is_closed: false },
          tuesday: { start: '09:00', end: '17:00', is_closed: false },
          wednesday: { start: '09:00', end: '17:00', is_closed: false },
          thursday: { start: '09:00', end: '17:00', is_closed: false },
          friday: { start: '09:00', end: '17:00', is_closed: false },
          saturday: { start: '00:00', end: '00:00', is_closed: true },
          sunday: { start: '00:00', end: '00:00', is_closed: true },
        },
        holidays: [
          { date: '2024-12-25', name: 'Christmas' },
          { date: '2024-01-01', name: 'New Year' },
        ],
      }

      const updated = await client.sla.setBusinessHours(policy.id, businessHours)

      expect(updated.business_hours).toBeDefined()
      expect(updated.business_hours?.timezone).toBe('America/New_York')
      expect(updated.business_hours?.schedule.monday.start).toBe('09:00')
    })

    it('should pause SLA timer outside business hours', async () => {
      // This test would need to mock time or use specific business hours
      // For now, just verify the API exists
      const policy = await client.sla.createPolicy({
        name: 'Paused SLA',
        first_response_time: 3600,
        next_response_time: 7200,
        resolution_time: 86400,
        is_active: true,
        business_hours: {
          timezone: 'UTC',
          schedule: {
            monday: { start: '09:00', end: '17:00', is_closed: false },
            tuesday: { start: '09:00', end: '17:00', is_closed: false },
            wednesday: { start: '09:00', end: '17:00', is_closed: false },
            thursday: { start: '09:00', end: '17:00', is_closed: false },
            friday: { start: '09:00', end: '17:00', is_closed: false },
            saturday: { start: '00:00', end: '00:00', is_closed: true },
            sunday: { start: '00:00', end: '00:00', is_closed: true },
          },
          holidays: [],
        },
      })

      expect(policy.business_hours).toBeDefined()
    })
  })

  describe('priority overrides', () => {
    it('should set priority-based SLA overrides', async () => {
      const policy = await client.sla.createPolicy({
        name: 'Priority SLA',
        first_response_time: 3600,
        next_response_time: 7200,
        resolution_time: 86400,
        is_active: true,
      })

      const overrides: SLAPolicy['priority_overrides'] = {
        urgent: {
          first_response_time: 900, // 15 minutes
          resolution_time: 14400, // 4 hours
        },
        high: {
          first_response_time: 1800, // 30 minutes
          resolution_time: 28800, // 8 hours
        },
        normal: {},
        low: {
          first_response_time: 7200, // 2 hours
          resolution_time: 172800, // 48 hours
        },
      }

      const updated = await client.sla.setPriorityOverrides(policy.id, overrides)

      expect(updated.priority_overrides).toBeDefined()
      expect(updated.priority_overrides?.urgent?.first_response_time).toBe(900)
    })

    it('should apply priority-specific SLA to urgent conversations', async () => {
      const policy = await client.sla.createPolicy({
        name: 'Urgent Priority SLA',
        first_response_time: 3600,
        next_response_time: 7200,
        resolution_time: 86400,
        is_active: true,
        priority_overrides: {
          urgent: {
            first_response_time: 900,
            resolution_time: 14400,
          },
          high: {},
          normal: {},
          low: {},
        },
      })

      await client.sla.assignToInbox(inboxId, policy.id)

      // Create urgent conversation
      await client.priorityRouting.setUrgentKeywords(['emergency'])
      const { conversationId } = await createTestConversation(client, 'This is an emergency!')

      const status = await client.sla.getStatus(conversationId)

      // Should have shorter SLA due to urgent priority
      expect(status.first_response.time_remaining).toBeLessThanOrEqual(900)
    })
  })

  describe('SLA pause/resume', () => {
    it('should pause SLA for conversation', async () => {
      const policy = await client.sla.createPolicy({
        name: 'Pausable SLA',
        first_response_time: 3600,
        next_response_time: 7200,
        resolution_time: 86400,
        is_active: true,
      })

      await client.sla.assignToInbox(inboxId, policy.id)

      const { conversationId } = await createTestConversation(client)

      await client.sla.pauseForConversation(conversationId, 'Waiting for customer info')

      const status = await client.sla.getStatus(conversationId)
      expect((status as any).is_paused).toBe(true)
    })

    it('should resume SLA for conversation', async () => {
      const policy = await client.sla.createPolicy({
        name: 'Resumable SLA',
        first_response_time: 3600,
        next_response_time: 7200,
        resolution_time: 86400,
        is_active: true,
      })

      await client.sla.assignToInbox(inboxId, policy.id)

      const { conversationId } = await createTestConversation(client)

      await client.sla.pauseForConversation(conversationId, 'Waiting')
      await client.sla.resumeForConversation(conversationId)

      const status = await client.sla.getStatus(conversationId)
      expect((status as any).is_paused).toBe(false)
    })
  })
})

// =============================================================================
// Integration Tests - Routing Engine (10+ tests)
// =============================================================================

describe('@dotdo/intercom - Routing Engine Integration', () => {
  let client: ExtendedIntercomLocal

  beforeEach(() => {
    client = createTestClient()
  })

  describe('full routing flow', () => {
    it('should route conversation through rules to round-robin', async () => {
      // Setup team inbox with round-robin
      const teamInbox = await client.teamInboxes.create({
        name: 'Support Team',
        members: ['admin_1', 'admin_2', 'admin_3'],
      })

      await client.roundRobin.enable(teamInbox.id)

      // Create assignment rule that routes to round-robin
      await client.assignmentRules.create(teamInbox.id, {
        name: 'General Support',
        priority: 1,
        enabled: true,
        conditions: [{ field: 'body', operator: 'contains', value: 'help' }],
        condition_operator: 'AND',
        assignee_type: 'round_robin',
        assignee_id: teamInbox.id,
      })

      // Create matching conversation
      const { conversationId } = await createTestConversation(client, 'I need help with my account')

      // Run routing
      const result = await client.conversations.runAssignmentRules(conversationId)

      // Should be assigned to one of the team members
      expect(['admin_1', 'admin_2', 'admin_3']).toContain(result.admin_assignee_id)
    })

    it('should respect rule priority order', async () => {
      const inbox = await client.inboxes.create({ name: 'Priority Test' })

      // Low priority catch-all
      await client.assignmentRules.create(inbox.id, {
        name: 'Catch All',
        priority: 100,
        enabled: true,
        conditions: [],
        condition_operator: 'AND',
        assignee_type: 'admin',
        assignee_id: 'admin_catchall',
      })

      // High priority VIP rule
      await client.assignmentRules.create(inbox.id, {
        name: 'VIP',
        priority: 1,
        enabled: true,
        conditions: [{ field: 'email_domain', operator: 'equals', value: 'vip.com' }],
        condition_operator: 'AND',
        assignee_type: 'admin',
        assignee_id: 'admin_vip',
      })

      const { conversationId } = await createTestConversation(client, 'VIP request', {
        emailDomain: 'vip.com',
      })

      const result = await client.conversations.runAssignmentRules(conversationId)

      expect(result.admin_assignee_id).toBe('admin_vip')
    })

    it('should apply priority routing before assignment', async () => {
      // Set up VIP conditions
      await client.priorityRouting.setVIPCondition({
        type: 'email_domain',
        value: 'enterprise.com',
        priority: 'high',
      })

      const teamInbox = await client.teamInboxes.create({
        name: 'Priority Support',
        members: ['admin_regular', 'admin_vip'],
      })

      // Rule for high priority goes to VIP admin
      await client.assignmentRules.create(teamInbox.id, {
        name: 'High Priority',
        priority: 1,
        enabled: true,
        conditions: [{ field: 'tag', operator: 'equals', value: 'high_priority' }],
        condition_operator: 'AND',
        assignee_type: 'admin',
        assignee_id: 'admin_vip',
      })

      const { conversationId } = await createTestConversation(client, 'Enterprise request', {
        emailDomain: 'enterprise.com',
      })

      // Get priority
      const priority = await client.priorityRouting.getPriorityForConversation(conversationId)
      expect(priority.priority).toBe('high')
    })

    it('should handle workload limits during routing', async () => {
      const teamInbox = await client.teamInboxes.create({
        name: 'Limited Team',
        members: ['admin_1', 'admin_2'],
      })

      await client.roundRobin.enable(teamInbox.id)
      await client.roundRobin.setMaxOpenPerMember(teamInbox.id, 1)

      // Assign conversation to admin_1
      const { conversationId: conv1 } = await createTestConversation(client, 'First')
      await client.conversations.assign({
        id: conv1,
        admin_id: 'system',
        assignee_id: 'admin_1',
        type: 'admin',
      })

      // Next conversation should skip admin_1
      const next = await client.roundRobin.getNextAssignee(teamInbox.id)
      expect(next.admin_id).toBe('admin_2')
    })
  })

  describe('escalation flow', () => {
    it('should escalate and re-route conversation', async () => {
      const tier1Team = await client.teamInboxes.create({
        name: 'Tier 1',
        members: ['admin_t1'],
      })

      const tier2Team = await client.teamInboxes.create({
        name: 'Tier 2',
        members: ['admin_t2'],
      })

      const { conversationId } = await createTestConversation(client, 'Complex issue')

      // Assign to tier 1
      await client.conversations.assign({
        id: conversationId,
        admin_id: 'system',
        assignee_id: 'admin_t1',
        type: 'admin',
      })

      // Escalate
      await client.priorityRouting.escalate(conversationId, 'Needs expert help')

      // Transfer to tier 2
      await client.teamInboxes.transferConversation(
        conversationId,
        tier1Team.team_id!,
        tier2Team.team_id!
      )

      const conversation = await client.conversations.find(conversationId)
      expect(conversation.team_assignee_id).toBe(tier2Team.team_id)

      const priority = await client.priorityRouting.getPriorityForConversation(conversationId)
      expect(priority.priority).toBe('urgent')
    })
  })

  describe('SLA-aware routing', () => {
    it('should prioritize conversations nearing SLA breach', async () => {
      // This test validates that routing considers SLA status
      const inbox = await client.inboxes.create({ name: 'SLA-Aware Inbox' })

      // Create SLA with short first response time
      // (In full implementation, would need SLA resource)

      // Create two conversations
      const { conversationId: conv1 } = await createTestConversation(client, 'First conversation')
      const { conversationId: conv2 } = await createTestConversation(client, 'Second conversation')

      // In a full implementation, conv1 would be closer to SLA breach
      // and should be prioritized in the queue

      expect(conv1).toBeDefined()
      expect(conv2).toBeDefined()
    })
  })

  describe('multi-condition routing', () => {
    it('should match complex AND conditions', async () => {
      const inbox = await client.inboxes.create({ name: 'Complex Rules' })

      await client.assignmentRules.create(inbox.id, {
        name: 'VIP Urgent Billing',
        priority: 1,
        enabled: true,
        conditions: [
          { field: 'email_domain', operator: 'equals', value: 'enterprise.com' },
          { field: 'body', operator: 'contains', value: 'billing' },
          { field: 'body', operator: 'contains', value: 'urgent' },
        ],
        condition_operator: 'AND',
        assignee_type: 'admin',
        assignee_id: 'admin_billing_specialist',
      })

      // All conditions match
      const { conversationId: match } = await createTestConversation(
        client,
        'URGENT: billing issue needs immediate attention',
        { emailDomain: 'enterprise.com' }
      )

      const matchResult = await client.assignmentRules.test(
        (await client.assignmentRules.list(inbox.id)).rules[0].id,
        match
      )
      expect(matchResult.matches).toBe(true)

      // Missing one condition
      const { conversationId: noMatch } = await createTestConversation(
        client,
        'billing question', // missing "urgent"
        { emailDomain: 'enterprise.com' }
      )

      const noMatchResult = await client.assignmentRules.test(
        (await client.assignmentRules.list(inbox.id)).rules[0].id,
        noMatch
      )
      expect(noMatchResult.matches).toBe(false)
    })

    it('should match complex OR conditions', async () => {
      const inbox = await client.inboxes.create({ name: 'OR Rules' })

      await client.assignmentRules.create(inbox.id, {
        name: 'VIP Domains',
        priority: 1,
        enabled: true,
        conditions: [
          { field: 'email_domain', operator: 'equals', value: 'gold.com' },
          { field: 'email_domain', operator: 'equals', value: 'platinum.com' },
          { field: 'email_domain', operator: 'equals', value: 'diamond.com' },
        ],
        condition_operator: 'OR',
        assignee_type: 'admin',
        assignee_id: 'admin_vip',
      })

      // Any VIP domain should match
      for (const domain of ['gold.com', 'platinum.com', 'diamond.com']) {
        const { conversationId } = await createTestConversation(client, 'VIP request', {
          emailDomain: domain,
        })

        const result = await client.assignmentRules.test(
          (await client.assignmentRules.list(inbox.id)).rules[0].id,
          conversationId
        )
        expect(result.matches).toBe(true)
      }
    })
  })

  describe('failover handling', () => {
    it('should fall back when all team members unavailable', async () => {
      const teamInbox = await client.teamInboxes.create({
        name: 'Unavailable Team',
        members: ['admin_1', 'admin_2'],
      })

      await client.roundRobin.enable(teamInbox.id)

      // Mark all members as away
      await client.teamInboxes.setMemberAvailability(teamInbox.id, 'admin_1', 'away')
      await client.teamInboxes.setMemberAvailability(teamInbox.id, 'admin_2', 'away')

      // Should throw or return null for next assignee
      await expect(client.roundRobin.getNextAssignee(teamInbox.id)).rejects.toThrow(
        /no available members/
      )
    })

    it('should queue conversations when at capacity', async () => {
      const teamInbox = await client.teamInboxes.create({
        name: 'Full Team',
        members: ['admin_1'],
      })

      await client.roundRobin.enable(teamInbox.id)
      await client.roundRobin.setMaxOpenPerMember(teamInbox.id, 1)

      // Fill capacity
      const { conversationId: conv1 } = await createTestConversation(client, 'First')
      await client.conversations.assign({
        id: conv1,
        admin_id: 'system',
        assignee_id: 'admin_1',
        type: 'admin',
      })

      // Next should fail or queue
      await expect(client.roundRobin.getNextAssignee(teamInbox.id)).rejects.toThrow(
        /all members at capacity/
      )
    })
  })
})

// =============================================================================
// Edge Cases and Error Handling Tests (10+ tests)
// =============================================================================

describe('@dotdo/intercom - Edge Cases and Error Handling', () => {
  let client: ExtendedIntercomLocal

  beforeEach(() => {
    client = createTestClient()
  })

  describe('invalid inputs', () => {
    it('should reject negative priority values', async () => {
      const inbox = await client.inboxes.create({ name: 'Test' })

      await expect(
        client.assignmentRules.create(inbox.id, {
          name: 'Negative Priority',
          priority: -1,
          enabled: true,
          conditions: [],
          condition_operator: 'AND',
          assignee_type: 'admin',
          assignee_id: 'admin_1',
        })
      ).rejects.toThrow(/invalid priority/)
    })

    it('should reject empty inbox name', async () => {
      await expect(
        client.inboxes.create({
          name: '',
        })
      ).rejects.toThrow(/name.*required/)
    })

    it('should reject invalid condition operator', async () => {
      const inbox = await client.inboxes.create({ name: 'Test' })

      await expect(
        client.assignmentRules.create(inbox.id, {
          name: 'Invalid Operator',
          priority: 1,
          enabled: true,
          conditions: [
            {
              field: 'body',
              operator: 'invalid_op' as any,
              value: 'test',
            },
          ],
          condition_operator: 'AND',
          assignee_type: 'admin',
          assignee_id: 'admin_1',
        })
      ).rejects.toThrow(/invalid operator/)
    })
  })

  describe('concurrent operations', () => {
    it('should handle concurrent round-robin assignments', async () => {
      const teamInbox = await client.teamInboxes.create({
        name: 'Concurrent Team',
        members: ['admin_1', 'admin_2', 'admin_3'],
      })

      await client.roundRobin.enable(teamInbox.id)

      // Simulate concurrent assignment requests
      const assignments = await Promise.all([
        client.roundRobin.getNextAssignee(teamInbox.id),
        client.roundRobin.getNextAssignee(teamInbox.id),
        client.roundRobin.getNextAssignee(teamInbox.id),
      ])

      // All should succeed and be distributed
      expect(assignments.every((a) => a.admin_id)).toBe(true)
    })

    it('should handle concurrent inbox updates', async () => {
      const inbox = await client.inboxes.create({ name: 'Concurrent Inbox' })

      // Simulate concurrent updates
      const updates = await Promise.all([
        client.inboxes.update(inbox.id, { name: 'Update 1' }),
        client.inboxes.update(inbox.id, { name: 'Update 2' }),
        client.inboxes.update(inbox.id, { name: 'Update 3' }),
      ])

      // All should complete (last write wins)
      expect(updates.every((u) => u.id === inbox.id)).toBe(true)
    })
  })

  describe('resource limits', () => {
    it('should handle large number of inboxes', async () => {
      const inboxes = await Promise.all(
        Array.from({ length: 100 }, (_, i) =>
          client.inboxes.create({ name: `Inbox ${i}` })
        )
      )

      expect(inboxes.length).toBe(100)

      const list = await client.inboxes.list()
      expect(list.total_count).toBe(100)
    })

    it('should handle large number of assignment rules', async () => {
      const inbox = await client.inboxes.create({ name: 'Many Rules' })

      const rules = await Promise.all(
        Array.from({ length: 50 }, (_, i) =>
          client.assignmentRules.create(inbox.id, {
            name: `Rule ${i}`,
            priority: i,
            enabled: true,
            conditions: [],
            condition_operator: 'AND',
            assignee_type: 'admin',
            assignee_id: 'admin_1',
          })
        )
      )

      expect(rules.length).toBe(50)

      const list = await client.assignmentRules.list(inbox.id)
      expect(list.rules.length).toBe(50)
    })
  })

  describe('cleanup and deletion', () => {
    it('should clean up assignment rules when inbox deleted', async () => {
      const inbox = await client.inboxes.create({ name: 'Cleanup Test' })

      await client.assignmentRules.create(inbox.id, {
        name: 'Rule 1',
        priority: 1,
        enabled: true,
        conditions: [],
        condition_operator: 'AND',
        assignee_type: 'admin',
        assignee_id: 'admin_1',
      })

      await client.inboxes.delete(inbox.id)

      // Rules should be cleaned up
      await expect(client.assignmentRules.list(inbox.id)).rejects.toThrow()
    })

    it('should handle deleting non-existent resources', async () => {
      await expect(client.inboxes.delete('inbox_nonexistent')).rejects.toThrow()
      await expect(client.assignmentRules.delete('rule_nonexistent')).rejects.toThrow()
    })
  })

  describe('state consistency', () => {
    it('should maintain consistent round-robin state after member changes', async () => {
      const teamInbox = await client.teamInboxes.create({
        name: 'State Team',
        members: ['admin_1', 'admin_2'],
      })

      await client.roundRobin.enable(teamInbox.id)

      // Advance the rotation
      await client.roundRobin.getNextAssignee(teamInbox.id)

      // Add a member
      await client.teamInboxes.addMember(teamInbox.id, 'admin_3')

      // State should be consistent
      const status = await client.roundRobin.getStatus(teamInbox.id)
      expect(status.members.length).toBe(3)
    })

    it('should handle member removal during active rotation', async () => {
      const teamInbox = await client.teamInboxes.create({
        name: 'Removal Team',
        members: ['admin_1', 'admin_2', 'admin_3'],
      })

      await client.roundRobin.enable(teamInbox.id)

      // Remove a member
      await client.teamInboxes.removeMember(teamInbox.id, 'admin_2')

      // Rotation should continue with remaining members
      const next = await client.roundRobin.getNextAssignee(teamInbox.id)
      expect(['admin_1', 'admin_3']).toContain(next.admin_id)
    })
  })

  describe('regex edge cases', () => {
    it('should handle invalid regex patterns gracefully', async () => {
      const inbox = await client.inboxes.create({ name: 'Regex Test' })

      const rule = await client.assignmentRules.create(inbox.id, {
        name: 'Invalid Regex',
        priority: 1,
        enabled: true,
        conditions: [
          {
            field: 'body',
            operator: 'regex',
            value: '[invalid(regex', // Invalid regex
          },
        ],
        condition_operator: 'AND',
        assignee_type: 'admin',
        assignee_id: 'admin_1',
      })

      const { conversationId } = await createTestConversation(client, 'Test message')

      // Should handle gracefully (not crash)
      await expect(client.assignmentRules.test(rule.id, conversationId)).rejects.toThrow(/invalid regex/)
    })

    it('should handle special regex characters in values', async () => {
      const inbox = await client.inboxes.create({ name: 'Special Chars' })

      const rule = await client.assignmentRules.create(inbox.id, {
        name: 'Special Chars',
        priority: 1,
        enabled: true,
        conditions: [
          {
            field: 'body',
            operator: 'contains',
            value: '$100.00', // Contains regex special chars
          },
        ],
        condition_operator: 'AND',
        assignee_type: 'admin',
        assignee_id: 'admin_1',
      })

      const { conversationId } = await createTestConversation(
        client,
        'The price is $100.00'
      )

      const result = await client.assignmentRules.test(rule.id, conversationId)
      expect(result.matches).toBe(true)
    })
  })
})
