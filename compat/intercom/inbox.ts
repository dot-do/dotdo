/**
 * @dotdo/intercom - Inbox Routing Compatibility Layer
 *
 * Manages Intercom inbox routing with support for:
 * - Inbox management (create, update, delete, list)
 * - Team inboxes with member management
 * - Assignment rules for automatic routing
 * - Round-robin assignment
 * - Priority routing (VIP, urgent)
 * - Workload balancing
 * - SLA management
 *
 * @module @dotdo/intercom/inbox
 */

import type {
  ConversationContext,
  CustomAttributes,
} from './types'

// =============================================================================
// Inbox Types
// =============================================================================

/**
 * Inbox representing a shared mailbox for conversations
 */
export interface Inbox {
  id: string
  name: string
  team_id?: string
  is_default: boolean
  is_team_inbox: boolean
  admin_ids: string[]
  round_robin_enabled: boolean
  round_robin_config?: RoundRobinConfig
  sla_policy_id?: string
  created_at: Date
  updated_at: Date
}

/**
 * Input for creating an inbox
 */
export interface CreateInboxInput {
  name: string
  teamId?: string
  isDefault?: boolean
}

/**
 * Input for updating an inbox
 */
export interface UpdateInboxInput {
  name?: string
  teamId?: string
  isDefault?: boolean
}

// =============================================================================
// Team Types
// =============================================================================

/**
 * Team member in an inbox
 */
export interface TeamMember {
  admin_id: string
  inbox_id: string
  role: 'member' | 'admin'
  is_paused: boolean
  current_open_conversations: number
  max_open_conversations?: number
  joined_at: Date
}

/**
 * Team inbox statistics
 */
export interface TeamInboxStats {
  inbox_id: string
  total_open: number
  total_pending: number
  total_snoozed: number
  total_closed_today: number
  average_first_response_time: number
  average_resolution_time: number
  sla_breach_count: number
  member_stats: MemberStats[]
}

/**
 * Individual member statistics
 */
export interface MemberStats {
  admin_id: string
  open_conversations: number
  closed_today: number
  average_response_time: number
  sla_breaches: number
}

// =============================================================================
// Assignment Rule Types
// =============================================================================

/**
 * Condition operator for assignment rules
 */
export type ConditionOperator =
  | 'equals'
  | 'not_equals'
  | 'contains'
  | 'not_contains'
  | 'starts_with'
  | 'ends_with'
  | 'greater_than'
  | 'less_than'
  | 'is_set'
  | 'is_not_set'
  | 'matches_regex'

/**
 * Condition field for assignment rules
 */
export type ConditionField =
  | 'conversation.type'
  | 'conversation.channel'
  | 'conversation.tags'
  | 'conversation.priority'
  | 'contact.email'
  | 'contact.name'
  | 'contact.company'
  | 'contact.custom_attributes'
  | 'message.body'
  | 'message.subject'

/**
 * Single condition in an assignment rule
 */
export interface AssignmentCondition {
  field: ConditionField
  operator: ConditionOperator
  value: string | number | boolean | string[]
}

/**
 * Assignment target type
 */
export type AssignmentTarget =
  | { type: 'admin'; admin_id: string }
  | { type: 'team'; team_id: string }
  | { type: 'inbox'; inbox_id: string }
  | { type: 'round_robin'; inbox_id: string }

/**
 * Assignment rule for automatic routing
 */
export interface AssignmentRule {
  id: string
  inbox_id: string
  name: string
  description?: string
  conditions: AssignmentCondition[]
  condition_logic: 'and' | 'or'
  assign_to: AssignmentTarget
  priority: number
  is_active: boolean
  created_at: Date
  updated_at: Date
}

/**
 * Input for creating an assignment rule
 */
export interface CreateAssignmentRuleInput {
  name: string
  conditions: AssignmentCondition[]
  assignTo: AssignmentTarget
  priority?: number
  description?: string
  conditionLogic?: 'and' | 'or'
}

/**
 * Input for updating an assignment rule
 */
export interface UpdateAssignmentRuleInput {
  name?: string
  description?: string
  conditions?: AssignmentCondition[]
  conditionLogic?: 'and' | 'or'
  assignTo?: AssignmentTarget
  priority?: number
  isActive?: boolean
}

/**
 * Result of testing an assignment rule
 */
export interface AssignmentRuleTestResult {
  matches: boolean
  matched_conditions: number[]
  would_assign_to: AssignmentTarget | null
}

// =============================================================================
// Round-Robin Types
// =============================================================================

/**
 * Round-robin configuration for an inbox
 */
export interface RoundRobinConfig {
  enabled: boolean
  members: RoundRobinMember[]
  max_open_conversations_per_member?: number
  max_total_conversations?: number
  current_index: number
  assignment_strategy: 'sequential' | 'least_busy'
}

/**
 * Member in round-robin rotation
 */
export interface RoundRobinMember {
  admin_id: string
  is_paused: boolean
  current_open_conversations: number
  max_open_conversations?: number
  last_assigned_at?: Date
}

/**
 * Input for enabling round-robin
 */
export interface EnableRoundRobinInput {
  members: string[]
  maxOpenConversations?: number
  assignmentStrategy?: 'sequential' | 'least_busy'
}

/**
 * Input for setting round-robin limits
 */
export interface RoundRobinLimitsInput {
  perMember?: number
  total?: number
}

/**
 * Status of round-robin for an inbox
 */
export interface RoundRobinStatus {
  enabled: boolean
  members: RoundRobinMember[]
  current_index: number
  total_open_conversations: number
  max_total_conversations?: number
  next_assignee?: string
}

// =============================================================================
// Priority Routing Types
// =============================================================================

/**
 * VIP condition for priority routing
 */
export interface VIPCondition {
  field: ConditionField
  operator: ConditionOperator
  value: string | number | boolean | string[]
}

/**
 * Priority rules configuration
 */
export interface PriorityRulesConfig {
  vip_conditions: VIPCondition[]
  urgent_keywords: string[]
  sla_config?: {
    vip_first_response_time: number
    vip_resolution_time: number
    urgent_first_response_time: number
    urgent_resolution_time: number
  }
}

/**
 * Priority level for a conversation
 */
export type PriorityLevel = 'vip' | 'urgent' | 'high' | 'normal' | 'low'

/**
 * Priority result for a conversation
 */
export interface ConversationPriority {
  conversation_id: string
  priority: PriorityLevel
  is_vip: boolean
  is_urgent: boolean
  matched_vip_conditions: number[]
  matched_urgent_keywords: string[]
  sla_target?: {
    first_response_by: Date
    resolution_by: Date
  }
}

/**
 * Escalation record
 */
export interface Escalation {
  id: string
  conversation_id: string
  from_admin_id?: string
  to_admin_id?: string
  to_inbox_id?: string
  reason?: string
  previous_priority: PriorityLevel
  new_priority: PriorityLevel
  created_at: Date
}

// =============================================================================
// Workload Types
// =============================================================================

/**
 * Workload for an admin
 */
export interface AdminWorkload {
  admin_id: string
  total_open: number
  total_pending: number
  total_snoozed: number
  by_inbox: Record<string, number>
  by_priority: Record<PriorityLevel, number>
  max_open?: number
  max_new_per_day?: number
  new_today: number
  average_response_time: number
  is_at_capacity: boolean
}

/**
 * Workload for a team
 */
export interface TeamWorkload {
  team_id: string
  total_open: number
  total_pending: number
  total_snoozed: number
  member_workloads: AdminWorkload[]
  average_utilization: number
  overloaded_members: string[]
  available_members: string[]
}

/**
 * Input for setting workload limits
 */
export interface WorkloadLimitsInput {
  maxOpen?: number
  maxNew?: number
}

/**
 * Result of workload balancing
 */
export interface WorkloadBalanceResult {
  moves: Array<{
    conversation_id: string
    from_admin_id: string
    to_admin_id: string
    reason: string
  }>
  before_balance: TeamWorkload
  after_balance: TeamWorkload
}

// =============================================================================
// SLA Types
// =============================================================================

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
 * SLA policy
 */
export interface SLAPolicy {
  id: string
  name: string
  description?: string
  first_response_time?: number // seconds
  next_response_time?: number // seconds
  resolution_time?: number // seconds
  business_hours?: BusinessHours
  priority_overrides?: {
    [K in PriorityLevel]?: {
      first_response_time?: number
      next_response_time?: number
      resolution_time?: number
    }
  }
  is_active: boolean
  created_at: Date
  updated_at: Date
}

/**
 * Input for creating an SLA policy
 */
export interface CreateSLAPolicyInput {
  name: string
  description?: string
  firstResponseTime?: number
  nextResponseTime?: number
  resolutionTime?: number
  businessHours?: BusinessHours
  priorityOverrides?: SLAPolicy['priority_overrides']
}

/**
 * SLA status for a conversation
 */
export interface SLAStatus {
  conversation_id: string
  policy_id: string
  policy_name: string
  first_response: {
    target: Date | null
    actual: Date | null
    is_breached: boolean
    time_remaining?: number // seconds
  }
  next_response: {
    target: Date | null
    actual: Date | null
    is_breached: boolean
    time_remaining?: number
  }
  resolution: {
    target: Date | null
    actual: Date | null
    is_breached: boolean
    time_remaining?: number
  }
  overall_status: 'on_track' | 'at_risk' | 'breached'
}

/**
 * SLA breach record
 */
export interface SLABreach {
  id: string
  conversation_id: string
  policy_id: string
  breach_type: 'first_response' | 'next_response' | 'resolution'
  target_time: Date
  actual_time?: Date
  breached_by: number // seconds
  admin_id?: string
  created_at: Date
}

/**
 * Options for querying SLA breaches
 */
export interface SLABreachesOptions {
  period?: 'today' | 'week' | 'month' | 'custom'
  startDate?: Date
  endDate?: Date
  breachType?: SLABreach['breach_type']
}

// =============================================================================
// Error Types
// =============================================================================

/**
 * Base Intercom inbox error
 */
export class InboxError extends Error {
  code: string
  status?: number

  constructor(message: string, code: string, status?: number) {
    super(message)
    this.name = 'InboxError'
    this.code = code
    this.status = status
  }
}

/**
 * Inbox not found error
 */
export class InboxNotFoundError extends InboxError {
  constructor(inboxId: string) {
    super(`Inbox not found: ${inboxId}`, 'inbox_not_found', 404)
  }
}

/**
 * Rule not found error
 */
export class RuleNotFoundError extends InboxError {
  constructor(ruleId: string) {
    super(`Assignment rule not found: ${ruleId}`, 'rule_not_found', 404)
  }
}

/**
 * SLA policy not found error
 */
export class SLAPolicyNotFoundError extends InboxError {
  constructor(policyId: string) {
    super(`SLA policy not found: ${policyId}`, 'sla_policy_not_found', 404)
  }
}

/**
 * Admin not found error
 */
export class AdminNotFoundError extends InboxError {
  constructor(adminId: string) {
    super(`Admin not found: ${adminId}`, 'admin_not_found', 404)
  }
}

// =============================================================================
// Helper Functions
// =============================================================================

function generateId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

// =============================================================================
// Inbox Router - Main Implementation
// =============================================================================

/**
 * Configuration for InboxRouter
 */
export interface InboxRouterConfig {
  workspaceId: string
}

/**
 * Inbox Router - Manages inbox routing, assignment rules, round-robin,
 * priority routing, workload balancing, and SLA policies.
 *
 * @example
 * ```typescript
 * import { InboxRouter } from '@dotdo/intercom/inbox'
 *
 * const router = new InboxRouter({ workspaceId: 'ws_123' })
 *
 * // Create an inbox
 * const inbox = await router.createInbox({ name: 'Support' })
 *
 * // Add assignment rules
 * await router.createAssignmentRule({
 *   name: 'VIP Routing',
 *   conditions: [
 *     { field: 'contact.custom_attributes', operator: 'equals', value: 'vip' }
 *   ],
 *   assignTo: { type: 'admin', admin_id: 'admin_vip' },
 * })
 *
 * // Enable round-robin
 * await router.enableRoundRobin(inbox.id, {
 *   members: ['admin_1', 'admin_2', 'admin_3'],
 *   maxOpenConversations: 10,
 * })
 * ```
 */
export class InboxRouter {
  private workspaceId: string

  // Storage maps
  private inboxes: Map<string, Inbox> = new Map()
  private teamMembers: Map<string, TeamMember[]> = new Map() // inbox_id -> members
  private assignmentRules: Map<string, AssignmentRule[]> = new Map() // inbox_id -> rules
  private slaPolicies: Map<string, SLAPolicy> = new Map()
  private slaBreaches: Map<string, SLABreach[]> = new Map() // inbox_id -> breaches
  private escalations: Map<string, Escalation[]> = new Map() // conversation_id -> escalations
  private priorityRules: PriorityRulesConfig | null = null
  private adminWorkloads: Map<string, AdminWorkload> = new Map()
  private conversationPriorities: Map<string, ConversationPriority> = new Map()
  private conversationSlaStatus: Map<string, SLAStatus> = new Map()

  constructor(config: InboxRouterConfig) {
    this.workspaceId = config.workspaceId
  }

  // ===========================================================================
  // 1. Inbox Management
  // ===========================================================================

  /**
   * Create a new inbox
   */
  async createInbox(input: CreateInboxInput): Promise<Inbox> {
    const id = generateId('inbox')
    const now = new Date()

    // If this is default, unset other defaults
    if (input.isDefault) {
      for (const inbox of this.inboxes.values()) {
        if (inbox.is_default) {
          inbox.is_default = false
          inbox.updated_at = now
        }
      }
    }

    const inbox: Inbox = {
      id,
      name: input.name,
      team_id: input.teamId,
      is_default: input.isDefault ?? false,
      is_team_inbox: !!input.teamId,
      admin_ids: [],
      round_robin_enabled: false,
      created_at: now,
      updated_at: now,
    }

    this.inboxes.set(id, inbox)
    this.teamMembers.set(id, [])
    this.assignmentRules.set(id, [])

    return inbox
  }

  /**
   * Get an inbox by ID
   */
  async getInbox(inboxId: string): Promise<Inbox> {
    const inbox = this.inboxes.get(inboxId)
    if (!inbox) {
      throw new InboxNotFoundError(inboxId)
    }
    return inbox
  }

  /**
   * Update an inbox
   */
  async updateInbox(inboxId: string, updates: UpdateInboxInput): Promise<Inbox> {
    const inbox = await this.getInbox(inboxId)
    const now = new Date()

    // Handle default flag changes
    if (updates.isDefault && !inbox.is_default) {
      for (const other of this.inboxes.values()) {
        if (other.is_default && other.id !== inboxId) {
          other.is_default = false
          other.updated_at = now
        }
      }
    }

    if (updates.name !== undefined) inbox.name = updates.name
    if (updates.teamId !== undefined) {
      inbox.team_id = updates.teamId
      inbox.is_team_inbox = !!updates.teamId
    }
    if (updates.isDefault !== undefined) inbox.is_default = updates.isDefault

    inbox.updated_at = now
    this.inboxes.set(inboxId, inbox)

    return inbox
  }

  /**
   * Delete an inbox
   */
  async deleteInbox(inboxId: string): Promise<void> {
    if (!this.inboxes.has(inboxId)) {
      throw new InboxNotFoundError(inboxId)
    }

    this.inboxes.delete(inboxId)
    this.teamMembers.delete(inboxId)
    this.assignmentRules.delete(inboxId)
  }

  /**
   * List all inboxes
   */
  async listInboxes(options?: { teamId?: string }): Promise<Inbox[]> {
    let inboxes = Array.from(this.inboxes.values())

    if (options?.teamId) {
      inboxes = inboxes.filter((inbox) => inbox.team_id === options.teamId)
    }

    return inboxes.sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
  }

  // ===========================================================================
  // 2. Team Inboxes
  // ===========================================================================

  /**
   * Create a team inbox
   */
  async createTeamInbox(
    teamId: string,
    input: { name: string; members: string[] }
  ): Promise<Inbox> {
    const inbox = await this.createInbox({
      name: input.name,
      teamId,
    })

    // Add members
    for (const adminId of input.members) {
      await this.addTeamMember(inbox.id, adminId)
    }

    return this.getInbox(inbox.id)
  }

  /**
   * Add a team member to an inbox
   */
  async addTeamMember(inboxId: string, adminId: string): Promise<TeamMember> {
    const inbox = await this.getInbox(inboxId)
    const members = this.teamMembers.get(inboxId) ?? []

    // Check if already a member
    if (members.some((m) => m.admin_id === adminId)) {
      throw new InboxError('Admin is already a member of this inbox', 'already_member', 400)
    }

    const member: TeamMember = {
      admin_id: adminId,
      inbox_id: inboxId,
      role: 'member',
      is_paused: false,
      current_open_conversations: 0,
      joined_at: new Date(),
    }

    members.push(member)
    this.teamMembers.set(inboxId, members)

    // Update inbox admin_ids
    inbox.admin_ids.push(adminId)
    inbox.updated_at = new Date()
    this.inboxes.set(inboxId, inbox)

    return member
  }

  /**
   * Remove a team member from an inbox
   */
  async removeTeamMember(inboxId: string, adminId: string): Promise<void> {
    const inbox = await this.getInbox(inboxId)
    const members = this.teamMembers.get(inboxId) ?? []

    const index = members.findIndex((m) => m.admin_id === adminId)
    if (index === -1) {
      throw new AdminNotFoundError(adminId)
    }

    members.splice(index, 1)
    this.teamMembers.set(inboxId, members)

    // Update inbox admin_ids
    inbox.admin_ids = inbox.admin_ids.filter((id) => id !== adminId)
    inbox.updated_at = new Date()
    this.inboxes.set(inboxId, inbox)
  }

  /**
   * List team members of an inbox
   */
  async listTeamMembers(inboxId: string): Promise<TeamMember[]> {
    await this.getInbox(inboxId) // Validate inbox exists
    return this.teamMembers.get(inboxId) ?? []
  }

  /**
   * Get team inbox statistics
   */
  async getTeamInboxStats(inboxId: string): Promise<TeamInboxStats> {
    await this.getInbox(inboxId)
    const members = this.teamMembers.get(inboxId) ?? []
    const breaches = this.slaBreaches.get(inboxId) ?? []

    // Calculate stats from members
    let totalOpen = 0
    const memberStats: MemberStats[] = []

    for (const member of members) {
      const workload = this.adminWorkloads.get(member.admin_id)
      const openConversations = workload?.total_open ?? member.current_open_conversations

      totalOpen += openConversations

      memberStats.push({
        admin_id: member.admin_id,
        open_conversations: openConversations,
        closed_today: 0, // Would need conversation tracking
        average_response_time: workload?.average_response_time ?? 0,
        sla_breaches: breaches.filter((b) => b.admin_id === member.admin_id).length,
      })
    }

    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const todayBreaches = breaches.filter((b) => b.created_at >= today)

    return {
      inbox_id: inboxId,
      total_open: totalOpen,
      total_pending: 0,
      total_snoozed: 0,
      total_closed_today: 0,
      average_first_response_time: 0,
      average_resolution_time: 0,
      sla_breach_count: todayBreaches.length,
      member_stats: memberStats,
    }
  }

  // ===========================================================================
  // 3. Assignment Rules
  // ===========================================================================

  /**
   * Create an assignment rule
   */
  async createAssignmentRule(
    inboxId: string,
    input: CreateAssignmentRuleInput
  ): Promise<AssignmentRule> {
    await this.getInbox(inboxId)
    const rules = this.assignmentRules.get(inboxId) ?? []

    const id = generateId('rule')
    const now = new Date()

    const rule: AssignmentRule = {
      id,
      inbox_id: inboxId,
      name: input.name,
      description: input.description,
      conditions: input.conditions,
      condition_logic: input.conditionLogic ?? 'and',
      assign_to: input.assignTo,
      priority: input.priority ?? rules.length,
      is_active: true,
      created_at: now,
      updated_at: now,
    }

    rules.push(rule)
    rules.sort((a, b) => a.priority - b.priority)
    this.assignmentRules.set(inboxId, rules)

    return rule
  }

  /**
   * Update an assignment rule
   */
  async updateAssignmentRule(ruleId: string, updates: UpdateAssignmentRuleInput): Promise<AssignmentRule> {
    // Find the rule
    let foundRule: AssignmentRule | null = null
    let foundInboxId: string | null = null

    for (const [inboxId, rules] of this.assignmentRules) {
      const rule = rules.find((r) => r.id === ruleId)
      if (rule) {
        foundRule = rule
        foundInboxId = inboxId
        break
      }
    }

    if (!foundRule || !foundInboxId) {
      throw new RuleNotFoundError(ruleId)
    }

    const now = new Date()

    if (updates.name !== undefined) foundRule.name = updates.name
    if (updates.description !== undefined) foundRule.description = updates.description
    if (updates.conditions !== undefined) foundRule.conditions = updates.conditions
    if (updates.conditionLogic !== undefined) foundRule.condition_logic = updates.conditionLogic
    if (updates.assignTo !== undefined) foundRule.assign_to = updates.assignTo
    if (updates.priority !== undefined) foundRule.priority = updates.priority
    if (updates.isActive !== undefined) foundRule.is_active = updates.isActive

    foundRule.updated_at = now

    // Re-sort rules by priority
    const rules = this.assignmentRules.get(foundInboxId)!
    rules.sort((a, b) => a.priority - b.priority)
    this.assignmentRules.set(foundInboxId, rules)

    return foundRule
  }

  /**
   * Delete an assignment rule
   */
  async deleteAssignmentRule(ruleId: string): Promise<void> {
    for (const [inboxId, rules] of this.assignmentRules) {
      const index = rules.findIndex((r) => r.id === ruleId)
      if (index !== -1) {
        rules.splice(index, 1)
        this.assignmentRules.set(inboxId, rules)
        return
      }
    }
    throw new RuleNotFoundError(ruleId)
  }

  /**
   * List assignment rules for an inbox
   */
  async listAssignmentRules(inboxId: string): Promise<AssignmentRule[]> {
    await this.getInbox(inboxId)
    return this.assignmentRules.get(inboxId) ?? []
  }

  /**
   * Test an assignment rule against a conversation
   */
  async testAssignmentRule(
    ruleId: string,
    conversation: ConversationContext
  ): Promise<AssignmentRuleTestResult> {
    // Find the rule
    let foundRule: AssignmentRule | null = null

    for (const rules of this.assignmentRules.values()) {
      const rule = rules.find((r) => r.id === ruleId)
      if (rule) {
        foundRule = rule
        break
      }
    }

    if (!foundRule) {
      throw new RuleNotFoundError(ruleId)
    }

    const matchedConditions: number[] = []
    let matches = foundRule.condition_logic === 'and'

    for (let i = 0; i < foundRule.conditions.length; i++) {
      const condition = foundRule.conditions[i]
      const conditionMatches = this.evaluateCondition(condition, conversation)

      if (conditionMatches) {
        matchedConditions.push(i)
      }

      if (foundRule.condition_logic === 'and') {
        matches = matches && conditionMatches
      } else {
        matches = matches || conditionMatches
      }
    }

    return {
      matches,
      matched_conditions: matchedConditions,
      would_assign_to: matches ? foundRule.assign_to : null,
    }
  }

  /**
   * Evaluate a condition against a conversation
   */
  private evaluateCondition(
    condition: AssignmentCondition,
    conversation: ConversationContext
  ): boolean {
    const fieldValue = this.getFieldValue(condition.field, conversation)

    switch (condition.operator) {
      case 'equals':
        return fieldValue === condition.value
      case 'not_equals':
        return fieldValue !== condition.value
      case 'contains':
        return typeof fieldValue === 'string' && fieldValue.includes(String(condition.value))
      case 'not_contains':
        return typeof fieldValue === 'string' && !fieldValue.includes(String(condition.value))
      case 'starts_with':
        return typeof fieldValue === 'string' && fieldValue.startsWith(String(condition.value))
      case 'ends_with':
        return typeof fieldValue === 'string' && fieldValue.endsWith(String(condition.value))
      case 'greater_than':
        return typeof fieldValue === 'number' && fieldValue > Number(condition.value)
      case 'less_than':
        return typeof fieldValue === 'number' && fieldValue < Number(condition.value)
      case 'is_set':
        return fieldValue !== null && fieldValue !== undefined
      case 'is_not_set':
        return fieldValue === null || fieldValue === undefined
      case 'matches_regex':
        return typeof fieldValue === 'string' && new RegExp(String(condition.value)).test(fieldValue)
      default:
        return false
    }
  }

  /**
   * Get field value from conversation context
   */
  private getFieldValue(field: ConditionField, conversation: ConversationContext): unknown {
    switch (field) {
      case 'conversation.type':
        return conversation.type
      case 'conversation.channel':
        return conversation.channel
      case 'conversation.tags':
        return conversation.tags
      case 'conversation.priority':
        return conversation.priority
      case 'contact.email':
        return conversation.contact.email
      case 'contact.name':
        return conversation.contact.name
      case 'contact.company':
        return conversation.contact.company
      case 'contact.custom_attributes':
        return conversation.contact.custom_attributes
      case 'message.body':
        return conversation.message?.body
      case 'message.subject':
        return conversation.message?.subject
      default:
        return null
    }
  }

  // ===========================================================================
  // 4. Round-Robin Assignment
  // ===========================================================================

  /**
   * Enable round-robin assignment for an inbox
   */
  async enableRoundRobin(inboxId: string, input: EnableRoundRobinInput): Promise<RoundRobinConfig> {
    const inbox = await this.getInbox(inboxId)

    const config: RoundRobinConfig = {
      enabled: true,
      members: input.members.map((adminId) => ({
        admin_id: adminId,
        is_paused: false,
        current_open_conversations: 0,
      })),
      max_open_conversations_per_member: input.maxOpenConversations,
      current_index: 0,
      assignment_strategy: input.assignmentStrategy ?? 'sequential',
    }

    inbox.round_robin_enabled = true
    inbox.round_robin_config = config
    inbox.updated_at = new Date()
    this.inboxes.set(inboxId, inbox)

    return config
  }

  /**
   * Disable round-robin assignment for an inbox
   */
  async disableRoundRobin(inboxId: string): Promise<void> {
    const inbox = await this.getInbox(inboxId)

    inbox.round_robin_enabled = false
    inbox.round_robin_config = undefined
    inbox.updated_at = new Date()
    this.inboxes.set(inboxId, inbox)
  }

  /**
   * Set round-robin limits for an inbox
   */
  async setRoundRobinLimits(inboxId: string, limits: RoundRobinLimitsInput): Promise<RoundRobinConfig> {
    const inbox = await this.getInbox(inboxId)

    if (!inbox.round_robin_config) {
      throw new InboxError('Round-robin not enabled for this inbox', 'round_robin_not_enabled', 400)
    }

    if (limits.perMember !== undefined) {
      inbox.round_robin_config.max_open_conversations_per_member = limits.perMember
      for (const member of inbox.round_robin_config.members) {
        member.max_open_conversations = limits.perMember
      }
    }

    if (limits.total !== undefined) {
      inbox.round_robin_config.max_total_conversations = limits.total
    }

    inbox.updated_at = new Date()
    this.inboxes.set(inboxId, inbox)

    return inbox.round_robin_config
  }

  /**
   * Get round-robin status for an inbox
   */
  async getRoundRobinStatus(inboxId: string): Promise<RoundRobinStatus> {
    const inbox = await this.getInbox(inboxId)

    if (!inbox.round_robin_config) {
      return {
        enabled: false,
        members: [],
        current_index: 0,
        total_open_conversations: 0,
      }
    }

    const config = inbox.round_robin_config
    const totalOpen = config.members.reduce((sum, m) => sum + m.current_open_conversations, 0)

    // Find next available assignee
    let nextAssignee: string | undefined
    const activeMembers = config.members.filter((m) => !m.is_paused)

    if (activeMembers.length > 0) {
      if (config.assignment_strategy === 'least_busy') {
        // Find member with least open conversations
        const sorted = [...activeMembers].sort(
          (a, b) => a.current_open_conversations - b.current_open_conversations
        )
        const candidate = sorted[0]
        if (
          !candidate.max_open_conversations ||
          candidate.current_open_conversations < candidate.max_open_conversations
        ) {
          nextAssignee = candidate.admin_id
        }
      } else {
        // Sequential round-robin
        for (let i = 0; i < activeMembers.length; i++) {
          const idx = (config.current_index + i) % activeMembers.length
          const member = activeMembers[idx]
          if (
            !member.max_open_conversations ||
            member.current_open_conversations < member.max_open_conversations
          ) {
            nextAssignee = member.admin_id
            break
          }
        }
      }
    }

    return {
      enabled: config.enabled,
      members: config.members,
      current_index: config.current_index,
      total_open_conversations: totalOpen,
      max_total_conversations: config.max_total_conversations,
      next_assignee: nextAssignee,
    }
  }

  /**
   * Pause a member in round-robin rotation
   */
  async pauseRoundRobinMember(inboxId: string, adminId: string): Promise<void> {
    const inbox = await this.getInbox(inboxId)

    if (!inbox.round_robin_config) {
      throw new InboxError('Round-robin not enabled for this inbox', 'round_robin_not_enabled', 400)
    }

    const member = inbox.round_robin_config.members.find((m) => m.admin_id === adminId)
    if (!member) {
      throw new AdminNotFoundError(adminId)
    }

    member.is_paused = true
    inbox.updated_at = new Date()
    this.inboxes.set(inboxId, inbox)
  }

  /**
   * Resume a member in round-robin rotation
   */
  async resumeRoundRobinMember(inboxId: string, adminId: string): Promise<void> {
    const inbox = await this.getInbox(inboxId)

    if (!inbox.round_robin_config) {
      throw new InboxError('Round-robin not enabled for this inbox', 'round_robin_not_enabled', 400)
    }

    const member = inbox.round_robin_config.members.find((m) => m.admin_id === adminId)
    if (!member) {
      throw new AdminNotFoundError(adminId)
    }

    member.is_paused = false
    inbox.updated_at = new Date()
    this.inboxes.set(inboxId, inbox)
  }

  /**
   * Get the next assignee from round-robin and advance the index
   */
  async getNextRoundRobinAssignee(inboxId: string): Promise<string | null> {
    const status = await this.getRoundRobinStatus(inboxId)

    if (!status.enabled || !status.next_assignee) {
      return null
    }

    const inbox = await this.getInbox(inboxId)
    const config = inbox.round_robin_config!

    // Update member state
    const member = config.members.find((m) => m.admin_id === status.next_assignee)
    if (member) {
      member.current_open_conversations++
      member.last_assigned_at = new Date()
    }

    // Advance index for sequential strategy
    if (config.assignment_strategy === 'sequential') {
      config.current_index = (config.current_index + 1) % config.members.length
    }

    inbox.updated_at = new Date()
    this.inboxes.set(inboxId, inbox)

    return status.next_assignee
  }

  // ===========================================================================
  // 5. Priority Routing
  // ===========================================================================

  /**
   * Set priority rules configuration
   */
  async setPriorityRules(config: PriorityRulesConfig): Promise<void> {
    this.priorityRules = config
  }

  /**
   * Get priority for a conversation
   */
  async getPriorityForConversation(conversationId: string): Promise<ConversationPriority> {
    // Check if we already computed it
    const existing = this.conversationPriorities.get(conversationId)
    if (existing) {
      return existing
    }

    // Return default priority if no rules configured
    return {
      conversation_id: conversationId,
      priority: 'normal',
      is_vip: false,
      is_urgent: false,
      matched_vip_conditions: [],
      matched_urgent_keywords: [],
    }
  }

  /**
   * Compute and set priority for a conversation based on context
   */
  async computePriority(
    conversationId: string,
    conversation: ConversationContext
  ): Promise<ConversationPriority> {
    if (!this.priorityRules) {
      return this.getPriorityForConversation(conversationId)
    }

    const matchedVipConditions: number[] = []
    const matchedUrgentKeywords: string[] = []
    let isVip = false
    let isUrgent = false

    // Check VIP conditions
    for (let i = 0; i < this.priorityRules.vip_conditions.length; i++) {
      const condition = this.priorityRules.vip_conditions[i]
      if (this.evaluateCondition(condition, conversation)) {
        matchedVipConditions.push(i)
        isVip = true
      }
    }

    // Check urgent keywords in message body
    const messageBody = conversation.message?.body?.toLowerCase() ?? ''
    for (const keyword of this.priorityRules.urgent_keywords) {
      if (messageBody.includes(keyword.toLowerCase())) {
        matchedUrgentKeywords.push(keyword)
        isUrgent = true
      }
    }

    // Determine priority level
    let priority: PriorityLevel = 'normal'
    if (isVip) {
      priority = 'vip'
    } else if (isUrgent) {
      priority = 'urgent'
    }

    // Calculate SLA targets if configured
    let slaTarget: ConversationPriority['sla_target']
    if (this.priorityRules.sla_config) {
      const now = new Date()
      if (isVip) {
        slaTarget = {
          first_response_by: new Date(now.getTime() + this.priorityRules.sla_config.vip_first_response_time * 1000),
          resolution_by: new Date(now.getTime() + this.priorityRules.sla_config.vip_resolution_time * 1000),
        }
      } else if (isUrgent) {
        slaTarget = {
          first_response_by: new Date(now.getTime() + this.priorityRules.sla_config.urgent_first_response_time * 1000),
          resolution_by: new Date(now.getTime() + this.priorityRules.sla_config.urgent_resolution_time * 1000),
        }
      }
    }

    const result: ConversationPriority = {
      conversation_id: conversationId,
      priority,
      is_vip: isVip,
      is_urgent: isUrgent,
      matched_vip_conditions: matchedVipConditions,
      matched_urgent_keywords: matchedUrgentKeywords,
      sla_target: slaTarget,
    }

    this.conversationPriorities.set(conversationId, result)
    return result
  }

  /**
   * Escalate a conversation
   */
  async escalateConversation(
    conversationId: string,
    options?: {
      reason?: string
      toAdminId?: string
      toInboxId?: string
    }
  ): Promise<Escalation> {
    const currentPriority = await this.getPriorityForConversation(conversationId)

    const id = generateId('esc')
    const escalation: Escalation = {
      id,
      conversation_id: conversationId,
      to_admin_id: options?.toAdminId,
      to_inbox_id: options?.toInboxId,
      reason: options?.reason,
      previous_priority: currentPriority.priority,
      new_priority: 'urgent',
      created_at: new Date(),
    }

    const escalations = this.escalations.get(conversationId) ?? []
    escalations.push(escalation)
    this.escalations.set(conversationId, escalations)

    // Update the conversation priority
    currentPriority.priority = 'urgent'
    currentPriority.is_urgent = true
    this.conversationPriorities.set(conversationId, currentPriority)

    return escalation
  }

  // ===========================================================================
  // 6. Workload Balancing
  // ===========================================================================

  /**
   * Get workload for an admin
   */
  async getAdminWorkload(adminId: string): Promise<AdminWorkload> {
    const existing = this.adminWorkloads.get(adminId)
    if (existing) {
      return existing
    }

    // Return default workload
    const workload: AdminWorkload = {
      admin_id: adminId,
      total_open: 0,
      total_pending: 0,
      total_snoozed: 0,
      by_inbox: {},
      by_priority: {
        vip: 0,
        urgent: 0,
        high: 0,
        normal: 0,
        low: 0,
      },
      new_today: 0,
      average_response_time: 0,
      is_at_capacity: false,
    }

    this.adminWorkloads.set(adminId, workload)
    return workload
  }

  /**
   * Get workload for a team
   */
  async getTeamWorkload(teamId: string): Promise<TeamWorkload> {
    // Find all inboxes for this team
    const teamInboxes = Array.from(this.inboxes.values()).filter((i) => i.team_id === teamId)

    // Collect all unique admins
    const adminIds = new Set<string>()
    for (const inbox of teamInboxes) {
      for (const adminId of inbox.admin_ids) {
        adminIds.add(adminId)
      }
    }

    // Get workloads for all admins
    const memberWorkloads: AdminWorkload[] = []
    let totalOpen = 0
    let totalPending = 0
    let totalSnoozed = 0
    const overloaded: string[] = []
    const available: string[] = []

    for (const adminId of adminIds) {
      const workload = await this.getAdminWorkload(adminId)
      memberWorkloads.push(workload)
      totalOpen += workload.total_open
      totalPending += workload.total_pending
      totalSnoozed += workload.total_snoozed

      if (workload.is_at_capacity) {
        overloaded.push(adminId)
      } else {
        available.push(adminId)
      }
    }

    // Calculate utilization
    const totalCapacity = memberWorkloads.reduce((sum, w) => sum + (w.max_open ?? 50), 0)
    const averageUtilization = totalCapacity > 0 ? totalOpen / totalCapacity : 0

    return {
      team_id: teamId,
      total_open: totalOpen,
      total_pending: totalPending,
      total_snoozed: totalSnoozed,
      member_workloads: memberWorkloads,
      average_utilization: averageUtilization,
      overloaded_members: overloaded,
      available_members: available,
    }
  }

  /**
   * Auto-balance workload in an inbox
   */
  async autoBalanceWorkload(inboxId: string): Promise<WorkloadBalanceResult> {
    const inbox = await this.getInbox(inboxId)
    const members = this.teamMembers.get(inboxId) ?? []

    // Get workloads for all members
    const workloads: AdminWorkload[] = []
    for (const member of members) {
      workloads.push(await this.getAdminWorkload(member.admin_id))
    }

    const beforeBalance: TeamWorkload = {
      team_id: inbox.team_id ?? inboxId,
      total_open: workloads.reduce((sum, w) => sum + w.total_open, 0),
      total_pending: workloads.reduce((sum, w) => sum + w.total_pending, 0),
      total_snoozed: workloads.reduce((sum, w) => sum + w.total_snoozed, 0),
      member_workloads: [...workloads],
      average_utilization: 0,
      overloaded_members: workloads.filter((w) => w.is_at_capacity).map((w) => w.admin_id),
      available_members: workloads.filter((w) => !w.is_at_capacity).map((w) => w.admin_id),
    }

    const moves: WorkloadBalanceResult['moves'] = []

    // Calculate target per member
    const totalConversations = workloads.reduce((sum, w) => sum + w.total_open, 0)
    const targetPerMember = Math.ceil(totalConversations / workloads.length)

    // Find overloaded and underloaded members
    const overloaded = workloads.filter((w) => w.total_open > targetPerMember)
    const underloaded = workloads.filter((w) => w.total_open < targetPerMember)

    // Balance by moving conversations from overloaded to underloaded
    // Note: In a real implementation, we would actually reassign conversations
    // Here we just calculate what moves would be needed
    for (const over of overloaded) {
      const excess = over.total_open - targetPerMember

      for (let i = 0; i < excess; i++) {
        const under = underloaded.find((u) => u.total_open < targetPerMember)
        if (!under) break

        moves.push({
          conversation_id: `conv_placeholder_${moves.length}`,
          from_admin_id: over.admin_id,
          to_admin_id: under.admin_id,
          reason: 'workload_balance',
        })

        over.total_open--
        under.total_open++
      }
    }

    // Calculate after balance
    const afterBalance: TeamWorkload = {
      team_id: inbox.team_id ?? inboxId,
      total_open: workloads.reduce((sum, w) => sum + w.total_open, 0),
      total_pending: workloads.reduce((sum, w) => sum + w.total_pending, 0),
      total_snoozed: workloads.reduce((sum, w) => sum + w.total_snoozed, 0),
      member_workloads: workloads,
      average_utilization: 0,
      overloaded_members: workloads.filter((w) => w.is_at_capacity).map((w) => w.admin_id),
      available_members: workloads.filter((w) => !w.is_at_capacity).map((w) => w.admin_id),
    }

    return {
      moves,
      before_balance: beforeBalance,
      after_balance: afterBalance,
    }
  }

  /**
   * Set workload limits for an admin
   */
  async setWorkloadLimits(adminId: string, limits: WorkloadLimitsInput): Promise<void> {
    const workload = await this.getAdminWorkload(adminId)

    if (limits.maxOpen !== undefined) {
      workload.max_open = limits.maxOpen
    }
    if (limits.maxNew !== undefined) {
      workload.max_new_per_day = limits.maxNew
    }

    // Update capacity status
    workload.is_at_capacity = workload.max_open !== undefined && workload.total_open >= workload.max_open

    this.adminWorkloads.set(adminId, workload)
  }

  // ===========================================================================
  // 7. SLA Management
  // ===========================================================================

  /**
   * Create an SLA policy
   */
  async createSLAPolicy(input: CreateSLAPolicyInput): Promise<SLAPolicy> {
    const id = generateId('sla')
    const now = new Date()

    const policy: SLAPolicy = {
      id,
      name: input.name,
      description: input.description,
      first_response_time: input.firstResponseTime,
      next_response_time: input.nextResponseTime,
      resolution_time: input.resolutionTime,
      business_hours: input.businessHours,
      priority_overrides: input.priorityOverrides,
      is_active: true,
      created_at: now,
      updated_at: now,
    }

    this.slaPolicies.set(id, policy)
    return policy
  }

  /**
   * Assign an SLA policy to an inbox
   */
  async assignSLAPolicy(inboxId: string, policyId: string): Promise<void> {
    const inbox = await this.getInbox(inboxId)

    if (!this.slaPolicies.has(policyId)) {
      throw new SLAPolicyNotFoundError(policyId)
    }

    inbox.sla_policy_id = policyId
    inbox.updated_at = new Date()
    this.inboxes.set(inboxId, inbox)
  }

  /**
   * Get SLA status for a conversation
   */
  async getSLAStatus(conversationId: string): Promise<SLAStatus | null> {
    return this.conversationSlaStatus.get(conversationId) ?? null
  }

  /**
   * Compute SLA status for a conversation
   */
  async computeSLAStatus(
    conversationId: string,
    inboxId: string,
    conversationCreatedAt: Date,
    firstResponseAt?: Date,
    lastResponseAt?: Date,
    resolvedAt?: Date
  ): Promise<SLAStatus> {
    const inbox = await this.getInbox(inboxId)

    if (!inbox.sla_policy_id) {
      throw new InboxError('No SLA policy assigned to this inbox', 'no_sla_policy', 400)
    }

    const policy = this.slaPolicies.get(inbox.sla_policy_id)
    if (!policy) {
      throw new SLAPolicyNotFoundError(inbox.sla_policy_id)
    }

    const now = new Date()
    const priority = this.conversationPriorities.get(conversationId)
    const priorityLevel = priority?.priority ?? 'normal'

    // Get times with priority overrides
    const overrides = policy.priority_overrides?.[priorityLevel]
    const firstResponseTime = overrides?.first_response_time ?? policy.first_response_time
    const nextResponseTime = overrides?.next_response_time ?? policy.next_response_time
    const resolutionTime = overrides?.resolution_time ?? policy.resolution_time

    // Calculate targets
    const firstResponseTarget = firstResponseTime
      ? new Date(conversationCreatedAt.getTime() + firstResponseTime * 1000)
      : null

    const nextResponseTarget = lastResponseAt && nextResponseTime
      ? new Date(lastResponseAt.getTime() + nextResponseTime * 1000)
      : null

    const resolutionTarget = resolutionTime
      ? new Date(conversationCreatedAt.getTime() + resolutionTime * 1000)
      : null

    // Check breaches
    const firstResponseBreached = firstResponseTarget
      ? (firstResponseAt ? firstResponseAt > firstResponseTarget : now > firstResponseTarget)
      : false

    const nextResponseBreached = nextResponseTarget
      ? now > nextResponseTarget
      : false

    const resolutionBreached = resolutionTarget
      ? (resolvedAt ? resolvedAt > resolutionTarget : now > resolutionTarget)
      : false

    // Calculate time remaining
    const timeRemaining = (target: Date | null): number | undefined => {
      if (!target) return undefined
      const remaining = target.getTime() - now.getTime()
      return remaining > 0 ? Math.floor(remaining / 1000) : 0
    }

    // Determine overall status
    let overallStatus: SLAStatus['overall_status'] = 'on_track'
    if (firstResponseBreached || nextResponseBreached || resolutionBreached) {
      overallStatus = 'breached'
    } else {
      // Check if at risk (within 20% of target)
      const checkAtRisk = (target: Date | null): boolean => {
        if (!target) return false
        const remaining = target.getTime() - now.getTime()
        const total = target.getTime() - conversationCreatedAt.getTime()
        return remaining > 0 && remaining / total < 0.2
      }

      if (checkAtRisk(firstResponseTarget) || checkAtRisk(resolutionTarget)) {
        overallStatus = 'at_risk'
      }
    }

    const status: SLAStatus = {
      conversation_id: conversationId,
      policy_id: policy.id,
      policy_name: policy.name,
      first_response: {
        target: firstResponseTarget,
        actual: firstResponseAt ?? null,
        is_breached: firstResponseBreached,
        time_remaining: timeRemaining(firstResponseTarget),
      },
      next_response: {
        target: nextResponseTarget,
        actual: null,
        is_breached: nextResponseBreached,
        time_remaining: timeRemaining(nextResponseTarget),
      },
      resolution: {
        target: resolutionTarget,
        actual: resolvedAt ?? null,
        is_breached: resolutionBreached,
        time_remaining: timeRemaining(resolutionTarget),
      },
      overall_status: overallStatus,
    }

    this.conversationSlaStatus.set(conversationId, status)

    // Record breaches
    if (firstResponseBreached && !firstResponseAt) {
      await this.recordSLABreach(inboxId, conversationId, policy.id, 'first_response', firstResponseTarget!)
    }
    if (resolutionBreached && !resolvedAt) {
      await this.recordSLABreach(inboxId, conversationId, policy.id, 'resolution', resolutionTarget!)
    }

    return status
  }

  /**
   * Record an SLA breach
   */
  private async recordSLABreach(
    inboxId: string,
    conversationId: string,
    policyId: string,
    breachType: SLABreach['breach_type'],
    targetTime: Date
  ): Promise<void> {
    const now = new Date()
    const breaches = this.slaBreaches.get(inboxId) ?? []

    // Check if already recorded
    const existing = breaches.find(
      (b) => b.conversation_id === conversationId && b.breach_type === breachType
    )
    if (existing) return

    const breach: SLABreach = {
      id: generateId('breach'),
      conversation_id: conversationId,
      policy_id: policyId,
      breach_type: breachType,
      target_time: targetTime,
      breached_by: Math.floor((now.getTime() - targetTime.getTime()) / 1000),
      created_at: now,
    }

    breaches.push(breach)
    this.slaBreaches.set(inboxId, breaches)
  }

  /**
   * Get SLA breaches for an inbox
   */
  async getSLABreaches(inboxId: string, options?: SLABreachesOptions): Promise<SLABreach[]> {
    await this.getInbox(inboxId)
    let breaches = this.slaBreaches.get(inboxId) ?? []

    if (options?.period) {
      const now = new Date()
      let startDate: Date

      switch (options.period) {
        case 'today':
          startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate())
          break
        case 'week':
          startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
          break
        case 'month':
          startDate = new Date(now.getFullYear(), now.getMonth(), 1)
          break
        case 'custom':
          startDate = options.startDate ?? new Date(0)
          break
        default:
          startDate = new Date(0)
      }

      const endDate = options.endDate ?? now
      breaches = breaches.filter(
        (b) => b.created_at >= startDate && b.created_at <= endDate
      )
    }

    if (options?.breachType) {
      breaches = breaches.filter((b) => b.breach_type === options.breachType)
    }

    return breaches.sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
  }

  /**
   * Get all SLA policies
   */
  async listSLAPolicies(): Promise<SLAPolicy[]> {
    return Array.from(this.slaPolicies.values())
  }

  /**
   * Update an SLA policy
   */
  async updateSLAPolicy(policyId: string, updates: Partial<CreateSLAPolicyInput>): Promise<SLAPolicy> {
    const policy = this.slaPolicies.get(policyId)
    if (!policy) {
      throw new SLAPolicyNotFoundError(policyId)
    }

    if (updates.name !== undefined) policy.name = updates.name
    if (updates.description !== undefined) policy.description = updates.description
    if (updates.firstResponseTime !== undefined) policy.first_response_time = updates.firstResponseTime
    if (updates.nextResponseTime !== undefined) policy.next_response_time = updates.nextResponseTime
    if (updates.resolutionTime !== undefined) policy.resolution_time = updates.resolutionTime
    if (updates.businessHours !== undefined) policy.business_hours = updates.businessHours
    if (updates.priorityOverrides !== undefined) policy.priority_overrides = updates.priorityOverrides

    policy.updated_at = new Date()
    this.slaPolicies.set(policyId, policy)

    return policy
  }

  /**
   * Delete an SLA policy
   */
  async deleteSLAPolicy(policyId: string): Promise<void> {
    if (!this.slaPolicies.has(policyId)) {
      throw new SLAPolicyNotFoundError(policyId)
    }

    // Remove policy from any inboxes using it
    for (const inbox of this.inboxes.values()) {
      if (inbox.sla_policy_id === policyId) {
        inbox.sla_policy_id = undefined
        inbox.updated_at = new Date()
      }
    }

    this.slaPolicies.delete(policyId)
  }

  // ===========================================================================
  // Assignment Engine
  // ===========================================================================

  /**
   * Route a conversation through assignment rules and round-robin
   */
  async routeConversation(
    inboxId: string,
    conversation: ConversationContext
  ): Promise<{ assignedTo: AssignmentTarget | null; rule?: AssignmentRule }> {
    await this.getInbox(inboxId)
    const rules = this.assignmentRules.get(inboxId) ?? []

    // Check rules in priority order
    for (const rule of rules) {
      if (!rule.is_active) continue

      const result = await this.testAssignmentRule(rule.id, conversation)
      if (result.matches) {
        // If round-robin target, get next assignee
        if (result.would_assign_to?.type === 'round_robin') {
          const nextAdmin = await this.getNextRoundRobinAssignee(result.would_assign_to.inbox_id)
          if (nextAdmin) {
            return {
              assignedTo: { type: 'admin', admin_id: nextAdmin },
              rule,
            }
          }
        }

        return {
          assignedTo: result.would_assign_to,
          rule,
        }
      }
    }

    // No rules matched - try default round-robin if enabled
    const inbox = await this.getInbox(inboxId)
    if (inbox.round_robin_enabled) {
      const nextAdmin = await this.getNextRoundRobinAssignee(inboxId)
      if (nextAdmin) {
        return {
          assignedTo: { type: 'admin', admin_id: nextAdmin },
        }
      }
    }

    return { assignedTo: null }
  }
}

// =============================================================================
// Export ConversationContext type for consumers
// =============================================================================

export interface LocalConversationContext {
  id: string
  type: 'email' | 'chat' | 'social'
  channel: string
  tags: string[]
  priority?: PriorityLevel
  contact: {
    email?: string
    name?: string
    company?: string
    custom_attributes?: Record<string, unknown>
  }
  message?: {
    body?: string
    subject?: string
  }
  assigned_admin_id?: string
  assigned_inbox_id?: string
  first_response_at?: Date
  last_response_at?: Date
  created_at: Date
}
