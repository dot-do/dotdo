/**
 * LinearLocal - Complete Local Linear Implementation
 *
 * Drop-in replacement for Linear SDK that runs entirely locally.
 * Uses in-memory storage for all resources.
 *
 * Perfect for:
 * - Testing without network calls
 * - Edge deployment (Cloudflare Workers)
 * - Development environments
 *
 * @example
 * ```typescript
 * import { LinearLocal } from '@dotdo/linear'
 *
 * // Create local Linear instance
 * const linear = new LinearLocal()
 *
 * // Use exactly like real Linear SDK
 * const team = await linear.teamCreate({ name: 'Engineering', key: 'ENG' })
 *
 * const issue = await linear.issueCreate({
 *   teamId: team.team.id,
 *   title: 'Implement feature X',
 * })
 *
 * // Time-travel query (dotdo extension)
 * const issueAtTime = await linear.issueAsOf(issue.issue.id, Date.now() - 3600000)
 * ```
 */

import { createTemporalStore, type MemoryTemporalStore } from './backends/memory'
import type {
  LinearLocalConfig,
  LinearClientConfig,
  // Teams
  Team,
  TeamCreateInput,
  TeamUpdateInput,
  TeamPayload,
  // Issues
  Issue,
  IssueCreateInput,
  IssueUpdateInput,
  IssuePayload,
  IssueArchivePayload,
  IssueFilterArgs,
  IssueFilter,
  IssueRelation,
  IssueRelationCreateInput,
  IssueRelationPayload,
  IssueHistory,
  // Projects
  Project,
  ProjectCreateInput,
  ProjectUpdateInput,
  ProjectPayload,
  ProjectFilterArgs,
  ProjectFilter,
  ProjectMilestone,
  ProjectMilestoneCreateInput,
  ProjectMilestoneUpdateInput,
  ProjectMilestonePayload,
  ProjectUpdate,
  ProjectUpdateCreateInput,
  ProjectUpdatePayload,
  // Cycles
  Cycle,
  CycleCreateInput,
  CycleUpdateInput,
  CyclePayload,
  CycleFilterArgs,
  CycleFilter,
  // Comments
  Comment,
  CommentCreateInput,
  CommentUpdateInput,
  CommentPayload,
  // Labels
  IssueLabel,
  IssueLabelCreateInput,
  IssueLabelUpdateInput,
  IssueLabelPayload,
  LabelFilterArgs,
  // Workflow States
  WorkflowState,
  WorkflowStateCreateInput,
  WorkflowStateUpdateInput,
  WorkflowStatePayload,
  WorkflowStateType,
  // Users
  User,
  UserUpdateInput,
  UserPayload,
  // Webhooks
  Webhook,
  WebhookCreateInput,
  WebhookUpdateInput,
  WebhookPayload,
  WebhookResourceType,
  WebhookAction,
  WebhookDeliveryPayload,
  // Reactions
  Reaction,
  ReactionCreateInput,
  ReactionPayload,
  // Common
  Connection,
  PageInfo,
  ID,
  DateTime,
  SuccessPayload,
  PaginationArgs,
  IssuePriority,
  ProjectState,
} from './types'

// =============================================================================
// Default Workflow States
// =============================================================================

const DEFAULT_WORKFLOW_STATES: Array<{
  name: string
  type: WorkflowStateType
  color: string
  position: number
}> = [
  { name: 'Backlog', type: 'backlog', color: '#bec2c8', position: 0 },
  { name: 'Todo', type: 'unstarted', color: '#e2e2e2', position: 1 },
  { name: 'In Progress', type: 'started', color: '#f2c94c', position: 2 },
  { name: 'Done', type: 'completed', color: '#5e6ad2', position: 3 },
  { name: 'Canceled', type: 'canceled', color: '#95a2b3', position: 4 },
]

const PRIORITY_LABELS: Record<IssuePriority, string> = {
  0: 'No priority',
  1: 'Urgent',
  2: 'High',
  3: 'Medium',
  4: 'Low',
}

// =============================================================================
// Stored Types
// =============================================================================

interface StoredTeam {
  id: ID
  createdAt: DateTime
  updatedAt: DateTime
  archivedAt?: DateTime | null
  name: string
  key: string
  description?: string | null
  icon?: string | null
  color?: string | null
  private: boolean
  timezone: string
  issueCount: number
}

interface StoredUser {
  id: ID
  createdAt: DateTime
  updatedAt: DateTime
  archivedAt?: DateTime | null
  name: string
  displayName: string
  email: string
  avatarUrl?: string | null
  admin: boolean
  active: boolean
  guest: boolean
  description?: string | null
  timezone?: string | null
}

interface StoredIssue {
  id: ID
  createdAt: DateTime
  updatedAt: DateTime
  archivedAt?: DateTime | null
  deletedAt?: DateTime | null
  number: number
  identifier: string
  title: string
  description?: string | null
  priority: IssuePriority
  estimate?: number | null
  sortOrder: number
  startedAt?: DateTime | null
  completedAt?: DateTime | null
  canceledAt?: DateTime | null
  dueDate?: DateTime | null
  teamId: ID
  stateId: ID
  assigneeId?: ID | null
  creatorId?: ID | null
  parentId?: ID | null
  projectId?: ID | null
  cycleId?: ID | null
  labelIds: ID[]
}

interface StoredProject {
  id: ID
  createdAt: DateTime
  updatedAt: DateTime
  archivedAt?: DateTime | null
  deletedAt?: DateTime | null
  name: string
  description?: string | null
  icon?: string | null
  color?: string | null
  state: ProjectState
  slugId: string
  progress: number
  startDate?: DateTime | null
  targetDate?: DateTime | null
  startedAt?: DateTime | null
  completedAt?: DateTime | null
  canceledAt?: DateTime | null
  sortOrder: number
  teamIds: ID[]
  memberIds: ID[]
  creatorId?: ID | null
  leadId?: ID | null
}

interface StoredCycle {
  id: ID
  createdAt: DateTime
  updatedAt: DateTime
  archivedAt?: DateTime | null
  number: number
  name?: string | null
  description?: string | null
  startsAt: DateTime
  endsAt: DateTime
  completedAt?: DateTime | null
  progress: number
  scopeHistory: number[]
  completedScopeHistory: number[]
  issueCountHistory: number[]
  completedIssueCountHistory: number[]
  teamId: ID
}

interface StoredComment {
  id: ID
  createdAt: DateTime
  updatedAt: DateTime
  archivedAt?: DateTime | null
  body: string
  issueId: ID
  userId: ID
  parentId?: ID | null
  editedAt?: DateTime | null
}

interface StoredLabel {
  id: ID
  createdAt: DateTime
  updatedAt: DateTime
  archivedAt?: DateTime | null
  name: string
  description?: string | null
  color: string
  isGroup: boolean
  teamId?: ID | null
  parentId?: ID | null
  creatorId?: ID | null
}

interface StoredWorkflowState {
  id: ID
  createdAt: DateTime
  updatedAt: DateTime
  archivedAt?: DateTime | null
  name: string
  description?: string | null
  color: string
  type: WorkflowStateType
  position: number
  teamId: ID
}

interface StoredWebhook {
  id: ID
  createdAt: DateTime
  updatedAt: DateTime
  archivedAt?: DateTime | null
  url: string
  label?: string | null
  enabled: boolean
  secret: string
  resourceTypes: WebhookResourceType[]
  allPublicTeams: boolean
  teamId?: ID | null
  creatorId?: ID | null
}

interface StoredMilestone {
  id: ID
  createdAt: DateTime
  updatedAt: DateTime
  archivedAt?: DateTime | null
  name: string
  description?: string | null
  targetDate?: DateTime | null
  sortOrder: number
  projectId: ID
}

interface StoredProjectUpdate {
  id: ID
  createdAt: DateTime
  updatedAt: DateTime
  body: string
  health: 'onTrack' | 'atRisk' | 'offTrack'
  projectId: ID
  userId: ID
  editedAt?: DateTime | null
}

interface StoredReaction {
  id: ID
  createdAt: DateTime
  updatedAt: DateTime
  emoji: string
  userId: ID
  commentId?: ID | null
  projectUpdateId?: ID | null
}

// =============================================================================
// LinearLocal Implementation
// =============================================================================

/**
 * LinearLocal - Local Linear implementation
 */
export class LinearLocal {
  private config: LinearLocalConfig

  // Storage stores
  private teamsStore: Map<ID, StoredTeam> = new Map()
  private usersStore: Map<ID, StoredUser> = new Map()
  private issuesStore: MemoryTemporalStore<StoredIssue>
  private projectsStore: MemoryTemporalStore<StoredProject>
  private cyclesStore: MemoryTemporalStore<StoredCycle>
  private commentsStore: Map<ID, StoredComment> = new Map()
  private labelsStore: Map<ID, StoredLabel> = new Map()
  private workflowStatesStore: Map<ID, StoredWorkflowState> = new Map()
  private webhooksStore: Map<ID, StoredWebhook> = new Map()
  private milestonesStore: Map<ID, StoredMilestone> = new Map()
  private projectUpdatesStore: Map<ID, StoredProjectUpdate> = new Map()
  private reactionsStore: Map<ID, StoredReaction> = new Map()
  private relationsStore: Map<ID, IssueRelation> = new Map()

  // Counters
  private issueCounters: Map<ID, number> = new Map()
  private cycleCounters: Map<ID, number> = new Map()

  // Current user (viewer)
  private currentUserId: ID

  // Organization ID
  private organizationId: ID = 'org_local'

  constructor(config?: LinearLocalConfig) {
    this.config = config ?? {}

    // Initialize temporal stores
    this.issuesStore = createTemporalStore<StoredIssue>({ maxVersions: 100 })
    this.projectsStore = createTemporalStore<StoredProject>({ maxVersions: 50 })
    this.cyclesStore = createTemporalStore<StoredCycle>({ maxVersions: 50 })

    // Create default user
    this.currentUserId = this.generateId()
    this.usersStore.set(this.currentUserId, {
      id: this.currentUserId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      name: 'Local User',
      displayName: 'Local User',
      email: 'user@local.dev',
      admin: true,
      active: true,
      guest: false,
    })
  }

  private generateId(): string {
    return crypto.randomUUID()
  }

  private slugify(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 50)
  }

  private emitEvent(type: WebhookResourceType, action: WebhookAction, data: unknown): void {
    if (this.config.webhooks !== false && this.config.onWebhookEvent) {
      const payload: WebhookDeliveryPayload = {
        action,
        type,
        createdAt: new Date().toISOString(),
        url: '',
        webhookTimestamp: Date.now(),
        webhookId: '',
        organizationId: this.organizationId,
        data: data as Record<string, unknown>,
      }
      this.config.onWebhookEvent(payload)
    }
  }

  private createError(code: string, message: string): Error {
    const error = new Error(message) as Error & { code: string }
    error.code = code
    return error
  }

  private paginateResults<T extends { id: string }>(
    items: T[],
    args?: PaginationArgs
  ): Connection<T> {
    const first = args?.first ?? 50
    let startIndex = 0

    if (args?.after) {
      const afterIndex = items.findIndex((i) => i.id === args.after)
      if (afterIndex !== -1) {
        startIndex = afterIndex + 1
      }
    }

    const page = items.slice(startIndex, startIndex + first)
    const hasNextPage = startIndex + first < items.length
    const hasPreviousPage = startIndex > 0

    const pageInfo: PageInfo = {
      hasNextPage,
      hasPreviousPage,
      startCursor: page[0]?.id,
      endCursor: page[page.length - 1]?.id,
    }

    return {
      nodes: page,
      pageInfo,
    }
  }

  // ===========================================================================
  // Viewer (Current User)
  // ===========================================================================

  get viewer(): Promise<User> {
    return this.user(this.currentUserId)
  }

  // ===========================================================================
  // Teams
  // ===========================================================================

  async teamCreate(input: TeamCreateInput): Promise<TeamPayload> {
    const now = new Date().toISOString()
    const id = this.generateId()

    const stored: StoredTeam = {
      id,
      createdAt: now,
      updatedAt: now,
      name: input.name,
      key: input.key.toUpperCase(),
      description: input.description ?? null,
      icon: input.icon ?? null,
      color: input.color ?? null,
      private: input.private ?? false,
      timezone: input.timezone ?? 'UTC',
      issueCount: 0,
    }

    this.teamsStore.set(id, stored)

    // Create default workflow states for the team
    for (const state of DEFAULT_WORKFLOW_STATES) {
      const stateId = this.generateId()
      this.workflowStatesStore.set(stateId, {
        id: stateId,
        createdAt: now,
        updatedAt: now,
        name: state.name,
        description: null,
        color: state.color,
        type: state.type,
        position: state.position,
        teamId: id,
      })
    }

    // Initialize counters
    this.issueCounters.set(id, 0)
    this.cycleCounters.set(id, 0)

    const team = await this.hydrateTeam(stored)

    return {
      success: true,
      team,
    }
  }

  async team(id: ID): Promise<Team> {
    const stored = this.teamsStore.get(id)
    if (!stored) {
      throw this.createError('NotFound', `Team not found: ${id}`)
    }
    return this.hydrateTeam(stored)
  }

  // Internal method to get team without active cycle lookup (prevents infinite recursion)
  private async getTeamForCycle(id: ID): Promise<Team> {
    const stored = this.teamsStore.get(id)
    if (!stored) {
      throw this.createError('NotFound', `Team not found: ${id}`)
    }
    return this.hydrateTeam(stored, true)
  }

  async teams(args?: PaginationArgs): Promise<Connection<Team>> {
    const all = Array.from(this.teamsStore.values()).filter((t) => !t.archivedAt)
    const hydrated = await Promise.all(all.map((t) => this.hydrateTeam(t)))
    return this.paginateResults(hydrated, args)
  }

  async teamUpdate(id: ID, input: TeamUpdateInput): Promise<TeamPayload> {
    const existing = this.teamsStore.get(id)
    if (!existing) {
      throw this.createError('NotFound', `Team not found: ${id}`)
    }

    const now = new Date().toISOString()
    const updated: StoredTeam = {
      ...existing,
      updatedAt: now,
      name: input.name ?? existing.name,
      key: input.key ? input.key.toUpperCase() : existing.key,
      description: input.description !== undefined ? input.description : existing.description,
      icon: input.icon !== undefined ? input.icon : existing.icon,
      color: input.color !== undefined ? input.color : existing.color,
      private: input.private ?? existing.private,
      timezone: input.timezone ?? existing.timezone,
    }

    this.teamsStore.set(id, updated)
    const team = await this.hydrateTeam(updated)

    return {
      success: true,
      team,
    }
  }

  private async hydrateTeam(stored: StoredTeam, skipActiveCycle = false): Promise<Team> {
    // skipActiveCycle prevents infinite recursion when hydrateCycle -> hydrateTeam -> getActiveCycleForTeam -> hydrateCycle
    const activeCycle = skipActiveCycle ? null : await this.getActiveCycleForTeam(stored.id)
    return {
      id: stored.id,
      createdAt: stored.createdAt,
      updatedAt: stored.updatedAt,
      archivedAt: stored.archivedAt,
      name: stored.name,
      key: stored.key,
      description: stored.description,
      icon: stored.icon,
      color: stored.color,
      private: stored.private,
      timezone: stored.timezone,
      issueCount: stored.issueCount,

      // Relationship methods
      issues: (args) => this.getIssuesByTeam(stored.id, args),
      projects: (args) => this.getProjectsByTeam(stored.id, args),
      cycles: (args) => this.getCyclesByTeam(stored.id, args),
      states: () => this.getTeamStates(stored.id),
      labels: () => this.getTeamLabels(stored.id),
      members: () => this.getTeamMembers(),
      activeCycle: activeCycle ?? null,
    }
  }

  // ===========================================================================
  // Issues
  // ===========================================================================

  async issueCreate(input: IssueCreateInput): Promise<IssuePayload> {
    const now = new Date().toISOString()
    const id = this.generateId()
    const team = await this.team(input.teamId)
    const issueNumber = this.getNextIssueNumber(input.teamId)
    const identifier = `${team.key}-${issueNumber}`

    // Get default state if not provided
    let stateId = input.stateId
    if (!stateId) {
      const states = await team.states?.()
      const defaultState = states?.nodes.find((s) => s.type === 'backlog' || s.name === 'Backlog')
      stateId = defaultState?.id ?? states?.nodes[0]?.id ?? ''
    }

    const stored: StoredIssue = {
      id,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
      deletedAt: null,
      number: issueNumber,
      identifier,
      title: input.title,
      description: input.description ?? null,
      priority: input.priority ?? 0,
      estimate: input.estimate ?? null,
      sortOrder: input.sortOrder ?? Date.now(),
      startedAt: null,
      completedAt: null,
      canceledAt: null,
      dueDate: input.dueDate ?? null,
      teamId: input.teamId,
      stateId,
      assigneeId: input.assigneeId ?? null,
      creatorId: this.currentUserId,
      parentId: input.parentId ?? null,
      projectId: input.projectId ?? null,
      cycleId: input.cycleId ?? null,
      labelIds: input.labelIds ?? [],
    }

    await this.issuesStore.put(id, stored, Date.now())
    const issue = await this.hydrateIssue(stored)

    this.emitEvent('Issue', 'create', issue)

    return {
      success: true,
      issue,
    }
  }

  async issue(id: ID): Promise<Issue> {
    const stored = await this.issuesStore.get(id)
    if (!stored || stored.deletedAt) {
      throw this.createError('NotFound', `Issue not found: ${id}`)
    }
    return this.hydrateIssue(stored)
  }

  async issueAsOf(id: ID, timestamp: number): Promise<Issue | null> {
    const stored = await this.issuesStore.getAsOf(id, timestamp)
    if (!stored || stored.deletedAt) {
      return null
    }
    return this.hydrateIssue(stored)
  }

  async issueHistory(id: ID): Promise<IssueHistory[]> {
    const history: IssueHistory[] = []
    const current = await this.issuesStore.get(id)

    if (current) {
      history.push({
        id: this.generateId(),
        createdAt: current.createdAt,
        updatedAt: current.updatedAt,
        issue: await this.hydrateIssue(current),
        changes: {},
      })
    }

    return history
  }

  async issueUpdate(id: ID, input: IssueUpdateInput): Promise<IssuePayload> {
    const existing = await this.issuesStore.get(id)
    if (!existing || existing.deletedAt) {
      throw this.createError('NotFound', `Issue not found: ${id}`)
    }

    const now = new Date().toISOString()

    // Track state transitions for timestamps
    let startedAt = existing.startedAt
    let completedAt = existing.completedAt
    let canceledAt = existing.canceledAt

    if (input.stateId && input.stateId !== existing.stateId) {
      const newState = this.workflowStatesStore.get(input.stateId)
      if (newState) {
        if (newState.type === 'started' && !startedAt) {
          startedAt = now
        } else if (newState.type === 'completed' && !completedAt) {
          completedAt = now
        } else if (newState.type === 'canceled' && !canceledAt) {
          canceledAt = now
        }
      }
    }

    const updated: StoredIssue = {
      ...existing,
      updatedAt: now,
      title: input.title ?? existing.title,
      description: input.description !== undefined ? input.description : existing.description,
      priority: input.priority ?? existing.priority,
      estimate: input.estimate !== undefined ? input.estimate : existing.estimate,
      sortOrder: input.sortOrder ?? existing.sortOrder,
      dueDate: input.dueDate !== undefined ? input.dueDate : existing.dueDate,
      stateId: input.stateId ?? existing.stateId,
      assigneeId: input.assigneeId !== undefined ? input.assigneeId : existing.assigneeId,
      parentId: input.parentId !== undefined ? input.parentId : existing.parentId,
      projectId: input.projectId !== undefined ? input.projectId : existing.projectId,
      cycleId: input.cycleId !== undefined ? input.cycleId : existing.cycleId,
      labelIds: input.labelIds ?? existing.labelIds,
      startedAt,
      completedAt,
      canceledAt,
    }

    await this.issuesStore.put(id, updated, Date.now())
    const issue = await this.hydrateIssue(updated)

    this.emitEvent('Issue', 'update', issue)

    return {
      success: true,
      issue,
    }
  }

  async issueArchive(id: ID): Promise<IssueArchivePayload> {
    const existing = await this.issuesStore.get(id)
    if (!existing || existing.deletedAt) {
      throw this.createError('NotFound', `Issue not found: ${id}`)
    }

    const now = new Date().toISOString()
    const updated: StoredIssue = {
      ...existing,
      updatedAt: now,
      archivedAt: now,
    }

    await this.issuesStore.put(id, updated, Date.now())
    const issue = await this.hydrateIssue(updated)

    this.emitEvent('Issue', 'update', issue)

    return {
      success: true,
      entity: issue,
    }
  }

  async issueUnarchive(id: ID): Promise<IssueArchivePayload> {
    const existing = await this.issuesStore.get(id)
    if (!existing || existing.deletedAt) {
      throw this.createError('NotFound', `Issue not found: ${id}`)
    }

    const now = new Date().toISOString()
    const updated: StoredIssue = {
      ...existing,
      updatedAt: now,
      archivedAt: null,
    }

    await this.issuesStore.put(id, updated, Date.now())
    const issue = await this.hydrateIssue(updated)

    return {
      success: true,
      entity: issue,
    }
  }

  async issueDelete(id: ID): Promise<IssueArchivePayload> {
    const existing = await this.issuesStore.get(id)
    if (!existing || existing.deletedAt) {
      throw this.createError('NotFound', `Issue not found: ${id}`)
    }

    const now = new Date().toISOString()
    const updated: StoredIssue = {
      ...existing,
      updatedAt: now,
      deletedAt: now,
    }

    await this.issuesStore.put(id, updated, Date.now())

    this.emitEvent('Issue', 'remove', { id })

    return {
      success: true,
    }
  }

  async issues(args?: IssueFilterArgs): Promise<Connection<Issue>> {
    const all = await this.getAllIssues()
    let filtered = all.filter((i) => !i.deletedAt)

    if (!args?.includeArchived) {
      filtered = filtered.filter((i) => !i.archivedAt)
    }

    if (args?.filter) {
      filtered = this.applyIssueFilter(filtered, args.filter)
    }

    const hydrated = await Promise.all(filtered.map((i) => this.hydrateIssue(i)))

    // Apply ordering
    if (args?.orderBy) {
      hydrated.sort((a, b) => {
        switch (args.orderBy) {
          case 'createdAt':
            return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
          case 'updatedAt':
            return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
          case 'priority':
            return a.priority - b.priority
          case 'estimate':
            return (b.estimate ?? 0) - (a.estimate ?? 0)
          case 'title':
            return a.title.localeCompare(b.title)
          default:
            return 0
        }
      })
    } else {
      hydrated.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    }

    return this.paginateResults(hydrated, args)
  }

  async searchIssues(query: string, args?: IssueFilterArgs): Promise<Connection<Issue>> {
    const all = await this.getAllIssues()
    const queryLower = query.toLowerCase()

    const filtered = all.filter(
      (i) =>
        !i.deletedAt &&
        !i.archivedAt &&
        (i.title.toLowerCase().includes(queryLower) ||
          i.description?.toLowerCase().includes(queryLower) ||
          i.identifier.toLowerCase().includes(queryLower))
    )

    const hydrated = await Promise.all(filtered.map((i) => this.hydrateIssue(i)))
    return this.paginateResults(hydrated, args)
  }

  async issueRelationCreate(input: IssueRelationCreateInput): Promise<IssueRelationPayload> {
    const id = this.generateId()
    const now = new Date().toISOString()

    const issue = await this.issue(input.issueId)
    const relatedIssue = await this.issue(input.relatedIssueId)

    const relation: IssueRelation = {
      id,
      createdAt: now,
      updatedAt: now,
      type: input.type,
      issue,
      relatedIssue,
    }

    this.relationsStore.set(id, relation)

    return {
      success: true,
      issueRelation: relation,
    }
  }

  private async getAllIssues(): Promise<StoredIssue[]> {
    const results: StoredIssue[] = []
    for await (const issue of this.issuesStore.range('', {})) {
      results.push(issue)
    }
    return results
  }

  private async getIssuesByTeam(teamId: ID, args?: IssueFilterArgs): Promise<Connection<Issue>> {
    const all = await this.getAllIssues()
    let filtered = all.filter((i) => i.teamId === teamId && !i.deletedAt)

    if (!args?.includeArchived) {
      filtered = filtered.filter((i) => !i.archivedAt)
    }

    const hydrated = await Promise.all(filtered.map((i) => this.hydrateIssue(i)))
    return this.paginateResults(hydrated, args)
  }

  private async getIssuesByProject(projectId: ID, args?: IssueFilterArgs): Promise<Connection<Issue>> {
    const all = await this.getAllIssues()
    let filtered = all.filter((i) => i.projectId === projectId && !i.deletedAt)

    if (!args?.includeArchived) {
      filtered = filtered.filter((i) => !i.archivedAt)
    }

    const hydrated = await Promise.all(filtered.map((i) => this.hydrateIssue(i)))
    return this.paginateResults(hydrated, args)
  }

  private async getIssuesByCycle(cycleId: ID, args?: IssueFilterArgs): Promise<Connection<Issue>> {
    const all = await this.getAllIssues()
    let filtered = all.filter((i) => i.cycleId === cycleId && !i.deletedAt)

    if (!args?.includeArchived) {
      filtered = filtered.filter((i) => !i.archivedAt)
    }

    const hydrated = await Promise.all(filtered.map((i) => this.hydrateIssue(i)))
    return this.paginateResults(hydrated, args)
  }

  private getNextIssueNumber(teamId: ID): number {
    const current = this.issueCounters.get(teamId) ?? 0
    const next = current + 1
    this.issueCounters.set(teamId, next)
    return next
  }

  private applyIssueFilter(issues: StoredIssue[], filter: IssueFilter): StoredIssue[] {
    return issues.filter((issue) => {
      if (filter.priority) {
        if (filter.priority.eq !== undefined && issue.priority !== filter.priority.eq) return false
        if (filter.priority.neq !== undefined && issue.priority === filter.priority.neq) return false
        if (filter.priority.lt !== undefined && issue.priority >= filter.priority.lt) return false
        if (filter.priority.lte !== undefined && issue.priority > filter.priority.lte) return false
        if (filter.priority.gt !== undefined && issue.priority <= filter.priority.gt) return false
        if (filter.priority.gte !== undefined && issue.priority < filter.priority.gte) return false
        if (filter.priority.in && !filter.priority.in.includes(issue.priority)) return false
        if (filter.priority.nin && filter.priority.nin.includes(issue.priority)) return false
      }

      if (filter.team?.id?.eq && issue.teamId !== filter.team.id.eq) return false

      if (filter.project) {
        if (filter.project.null === true && issue.projectId !== null) return false
        if (filter.project.null === false && issue.projectId === null) return false
        if (filter.project.id?.eq && issue.projectId !== filter.project.id.eq) return false
      }

      if (filter.cycle) {
        if (filter.cycle.null === true && issue.cycleId !== null) return false
        if (filter.cycle.null === false && issue.cycleId === null) return false
        if (filter.cycle.id?.eq && issue.cycleId !== filter.cycle.id.eq) return false
      }

      if (filter.assignee) {
        if (filter.assignee.null === true && issue.assigneeId !== null) return false
        if (filter.assignee.null === false && issue.assigneeId === null) return false
        if (filter.assignee.id?.eq && issue.assigneeId !== filter.assignee.id.eq) return false
      }

      if (filter.state?.id?.eq && issue.stateId !== filter.state.id.eq) return false

      if (filter.title) {
        if (filter.title.eq && issue.title !== filter.title.eq) return false
        if (filter.title.contains && !issue.title.includes(filter.title.contains)) return false
        if (
          filter.title.containsIgnoreCase &&
          !issue.title.toLowerCase().includes(filter.title.containsIgnoreCase.toLowerCase())
        )
          return false
      }

      if (filter.and) {
        for (const subFilter of filter.and) {
          if (this.applyIssueFilter([issue], subFilter).length === 0) return false
        }
      }

      if (filter.or && filter.or.length > 0) {
        let anyMatch = false
        for (const subFilter of filter.or) {
          if (this.applyIssueFilter([issue], subFilter).length > 0) {
            anyMatch = true
            break
          }
        }
        if (!anyMatch) return false
      }

      return true
    })
  }

  private async hydrateIssue(stored: StoredIssue): Promise<Issue> {
    const team = await this.team(stored.teamId)
    const state = this.workflowStatesStore.get(stored.stateId)
    const assignee = stored.assigneeId ? this.usersStore.get(stored.assigneeId) : null
    const creator = stored.creatorId ? this.usersStore.get(stored.creatorId) : null

    let parent: Issue | null = null
    if (stored.parentId) {
      try {
        parent = await this.issue(stored.parentId)
      } catch {
        parent = null
      }
    }

    let project: Project | null = null
    if (stored.projectId) {
      try {
        project = await this.project(stored.projectId)
      } catch {
        project = null
      }
    }

    let cycle: Cycle | null = null
    if (stored.cycleId) {
      try {
        cycle = await this.cycle(stored.cycleId)
      } catch {
        cycle = null
      }
    }

    const issue: Issue = {
      id: stored.id,
      createdAt: stored.createdAt,
      updatedAt: stored.updatedAt,
      archivedAt: stored.archivedAt,
      number: stored.number,
      identifier: stored.identifier,
      title: stored.title,
      description: stored.description,
      priority: stored.priority,
      priorityLabel: PRIORITY_LABELS[stored.priority],
      estimate: stored.estimate,
      sortOrder: stored.sortOrder,
      startedAt: stored.startedAt,
      completedAt: stored.completedAt,
      canceledAt: stored.canceledAt,
      dueDate: stored.dueDate,
      url: `https://linear.app/team/${team.key}/issue/${stored.identifier}`,
      branchName: `${team.key.toLowerCase()}-${stored.number}-${this.slugify(stored.title)}`,
      team,
      state: state ? await this.hydrateWorkflowState(state) : ({} as WorkflowState),
      assignee: assignee ? await this.hydrateUser(assignee) : null,
      creator: creator ? await this.hydrateUser(creator) : null,
      parent,
      project,
      cycle,

      // Relationship methods
      labels: async () => this.getIssueLabels(stored.labelIds),
      children: async (args) => this.getIssueChildren(stored.id, args),
      comments: async () => this.getIssueComments(stored.id),
      blockedBy: async () => this.getBlockedBy(stored.id),
      blocks: async () => this.getBlocks(stored.id),
    }

    return issue
  }

  private async getIssueLabels(labelIds: ID[]): Promise<Connection<IssueLabel>> {
    const labels: IssueLabel[] = []
    for (const id of labelIds) {
      const stored = this.labelsStore.get(id)
      if (stored && !stored.archivedAt) {
        labels.push(await this.hydrateLabel(stored))
      }
    }
    return {
      nodes: labels,
      pageInfo: { hasNextPage: false, hasPreviousPage: false },
    }
  }

  private async getIssueChildren(parentId: ID, args?: IssueFilterArgs): Promise<Connection<Issue>> {
    const all = await this.getAllIssues()
    const children = all.filter((i) => i.parentId === parentId && !i.deletedAt)
    const hydrated = await Promise.all(children.map((c) => this.hydrateIssue(c)))
    return this.paginateResults(hydrated, args)
  }

  private getIssueComments(issueId: ID): Connection<Comment> {
    const comments = Array.from(this.commentsStore.values())
      .filter((c) => c.issueId === issueId && !c.archivedAt)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())

    return {
      nodes: comments.map((c) => this.hydrateCommentSync(c)),
      pageInfo: { hasNextPage: false, hasPreviousPage: false },
    }
  }

  private async getBlockedBy(issueId: ID): Promise<Connection<Issue>> {
    const blocking: Issue[] = []
    for (const relation of this.relationsStore.values()) {
      if (relation.issue.id === issueId && relation.type === 'blocks') {
        try {
          const blocker = await this.issue(relation.relatedIssue.id)
          blocking.push(blocker)
        } catch {
          // Ignore deleted issues
        }
      }
    }
    return {
      nodes: blocking,
      pageInfo: { hasNextPage: false, hasPreviousPage: false },
    }
  }

  private async getBlocks(issueId: ID): Promise<Connection<Issue>> {
    const blocked: Issue[] = []
    for (const relation of this.relationsStore.values()) {
      if (relation.relatedIssue.id === issueId && relation.type === 'blocks') {
        try {
          const issue = await this.issue(relation.issue.id)
          blocked.push(issue)
        } catch {
          // Ignore deleted issues
        }
      }
    }
    return {
      nodes: blocked,
      pageInfo: { hasNextPage: false, hasPreviousPage: false },
    }
  }

  // ===========================================================================
  // Projects
  // ===========================================================================

  async projectCreate(input: ProjectCreateInput): Promise<ProjectPayload> {
    const now = new Date().toISOString()
    const id = this.generateId()

    const stored: StoredProject = {
      id,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
      deletedAt: null,
      name: input.name,
      description: input.description ?? null,
      icon: input.icon ?? null,
      color: input.color ?? null,
      state: input.state ?? 'planned',
      slugId: this.slugify(input.name),
      progress: 0,
      startDate: input.startDate ?? null,
      targetDate: input.targetDate ?? null,
      startedAt: input.state === 'started' ? now : null,
      completedAt: null,
      canceledAt: null,
      sortOrder: input.sortOrder ?? Date.now(),
      teamIds: input.teamIds,
      memberIds: input.memberIds ?? [],
      creatorId: this.currentUserId,
      leadId: input.leadId ?? null,
    }

    await this.projectsStore.put(id, stored, Date.now())
    const project = await this.hydrateProject(stored)

    this.emitEvent('Project', 'create', project)

    return {
      success: true,
      project,
    }
  }

  async project(id: ID): Promise<Project> {
    const stored = await this.projectsStore.get(id)
    if (!stored || stored.deletedAt) {
      throw this.createError('NotFound', `Project not found: ${id}`)
    }
    return this.hydrateProject(stored)
  }

  async projectUpdate(id: ID, input: ProjectUpdateInput): Promise<ProjectPayload> {
    const existing = await this.projectsStore.get(id)
    if (!existing || existing.deletedAt) {
      throw this.createError('NotFound', `Project not found: ${id}`)
    }

    const now = new Date().toISOString()

    let startedAt = existing.startedAt
    let completedAt = existing.completedAt
    let canceledAt = existing.canceledAt

    if (input.state && input.state !== existing.state) {
      if (input.state === 'started' && !startedAt) {
        startedAt = now
      } else if (input.state === 'completed' && !completedAt) {
        completedAt = now
      } else if (input.state === 'canceled' && !canceledAt) {
        canceledAt = now
      }
    }

    const updated: StoredProject = {
      ...existing,
      updatedAt: now,
      name: input.name ?? existing.name,
      description: input.description !== undefined ? input.description : existing.description,
      icon: input.icon !== undefined ? input.icon : existing.icon,
      color: input.color !== undefined ? input.color : existing.color,
      state: input.state ?? existing.state,
      startDate: input.startDate !== undefined ? input.startDate : existing.startDate,
      targetDate: input.targetDate !== undefined ? input.targetDate : existing.targetDate,
      sortOrder: input.sortOrder ?? existing.sortOrder,
      memberIds: input.memberIds ?? existing.memberIds,
      leadId: input.leadId !== undefined ? input.leadId : existing.leadId,
      startedAt,
      completedAt,
      canceledAt,
    }

    await this.projectsStore.put(id, updated, Date.now())
    const project = await this.hydrateProject(updated)

    this.emitEvent('Project', 'update', project)

    return {
      success: true,
      project,
    }
  }

  async projectArchive(id: ID): Promise<ProjectPayload> {
    const existing = await this.projectsStore.get(id)
    if (!existing || existing.deletedAt) {
      throw this.createError('NotFound', `Project not found: ${id}`)
    }

    const now = new Date().toISOString()
    const updated: StoredProject = {
      ...existing,
      updatedAt: now,
      archivedAt: now,
    }

    await this.projectsStore.put(id, updated, Date.now())
    const project = await this.hydrateProject(updated)

    this.emitEvent('Project', 'update', project)

    return {
      success: true,
      project,
    }
  }

  async projectDelete(id: ID): Promise<SuccessPayload> {
    const existing = await this.projectsStore.get(id)
    if (!existing || existing.deletedAt) {
      throw this.createError('NotFound', `Project not found: ${id}`)
    }

    const now = new Date().toISOString()
    const updated: StoredProject = {
      ...existing,
      updatedAt: now,
      deletedAt: now,
    }

    await this.projectsStore.put(id, updated, Date.now())

    this.emitEvent('Project', 'remove', { id })

    return {
      success: true,
    }
  }

  async projects(args?: ProjectFilterArgs): Promise<Connection<Project>> {
    const all = await this.getAllProjects()
    let filtered = all.filter((p) => !p.deletedAt)

    if (!args?.includeArchived) {
      filtered = filtered.filter((p) => !p.archivedAt)
    }

    if (args?.filter) {
      filtered = this.applyProjectFilter(filtered, args.filter)
    }

    const hydrated = await Promise.all(filtered.map((p) => this.hydrateProject(p)))

    if (args?.orderBy) {
      hydrated.sort((a, b) => {
        switch (args.orderBy) {
          case 'createdAt':
            return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
          case 'updatedAt':
            return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
          case 'name':
            return a.name.localeCompare(b.name)
          case 'progress':
            return b.progress - a.progress
          default:
            return 0
        }
      })
    } else {
      hydrated.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    }

    return this.paginateResults(hydrated, args)
  }

  async searchProjects(query: string, args?: ProjectFilterArgs): Promise<Connection<Project>> {
    const all = await this.getAllProjects()
    const queryLower = query.toLowerCase()

    const filtered = all.filter(
      (p) =>
        !p.deletedAt &&
        !p.archivedAt &&
        (p.name.toLowerCase().includes(queryLower) ||
          p.description?.toLowerCase().includes(queryLower))
    )

    const hydrated = await Promise.all(filtered.map((p) => this.hydrateProject(p)))
    return this.paginateResults(hydrated, args)
  }

  async projectMilestoneCreate(input: ProjectMilestoneCreateInput): Promise<ProjectMilestonePayload> {
    const now = new Date().toISOString()
    const id = this.generateId()

    const stored: StoredMilestone = {
      id,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
      name: input.name,
      description: input.description ?? null,
      targetDate: input.targetDate ?? null,
      sortOrder: input.sortOrder ?? Date.now(),
      projectId: input.projectId,
    }

    this.milestonesStore.set(id, stored)
    const milestone = await this.hydrateMilestone(stored)

    return {
      success: true,
      projectMilestone: milestone,
    }
  }

  async projectMilestoneUpdate(id: ID, input: ProjectMilestoneUpdateInput): Promise<ProjectMilestonePayload> {
    const existing = this.milestonesStore.get(id)
    if (!existing) {
      throw this.createError('NotFound', `Project milestone not found: ${id}`)
    }

    const now = new Date().toISOString()
    const updated: StoredMilestone = {
      ...existing,
      updatedAt: now,
      name: input.name ?? existing.name,
      description: input.description !== undefined ? input.description : existing.description,
      targetDate: input.targetDate !== undefined ? input.targetDate : existing.targetDate,
      sortOrder: input.sortOrder ?? existing.sortOrder,
    }

    this.milestonesStore.set(id, updated)
    const milestone = await this.hydrateMilestone(updated)

    return {
      success: true,
      projectMilestone: milestone,
    }
  }

  async projectUpdateCreate(input: ProjectUpdateCreateInput): Promise<ProjectUpdatePayload> {
    const now = new Date().toISOString()
    const id = this.generateId()

    const stored: StoredProjectUpdate = {
      id,
      createdAt: now,
      updatedAt: now,
      body: input.body,
      health: input.health ?? 'onTrack',
      projectId: input.projectId,
      userId: this.currentUserId,
      editedAt: null,
    }

    this.projectUpdatesStore.set(id, stored)
    const update = await this.hydrateProjectUpdate(stored)

    this.emitEvent('ProjectUpdate', 'create', update)

    return {
      success: true,
      projectUpdate: update,
    }
  }

  private async getAllProjects(): Promise<StoredProject[]> {
    const results: StoredProject[] = []
    for await (const project of this.projectsStore.range('', {})) {
      results.push(project)
    }
    return results
  }

  private async getProjectsByTeam(teamId: ID, args?: ProjectFilterArgs): Promise<Connection<Project>> {
    const all = await this.getAllProjects()
    let filtered = all.filter((p) => p.teamIds.includes(teamId) && !p.deletedAt)

    if (!args?.includeArchived) {
      filtered = filtered.filter((p) => !p.archivedAt)
    }

    const hydrated = await Promise.all(filtered.map((p) => this.hydrateProject(p)))
    return this.paginateResults(hydrated, args)
  }

  private applyProjectFilter(projects: StoredProject[], filter: ProjectFilter): StoredProject[] {
    return projects.filter((project) => {
      if (filter.name) {
        if (filter.name.eq && project.name !== filter.name.eq) return false
        if (filter.name.contains && !project.name.includes(filter.name.contains)) return false
      }

      if (filter.state) {
        if (filter.state.eq && project.state !== filter.state.eq) return false
        if (filter.state.in && !filter.state.in.includes(project.state)) return false
      }

      if (filter.and) {
        for (const subFilter of filter.and) {
          if (this.applyProjectFilter([project], subFilter).length === 0) return false
        }
      }

      if (filter.or && filter.or.length > 0) {
        let anyMatch = false
        for (const subFilter of filter.or) {
          if (this.applyProjectFilter([project], subFilter).length > 0) {
            anyMatch = true
            break
          }
        }
        if (!anyMatch) return false
      }

      return true
    })
  }

  private async hydrateProject(stored: StoredProject): Promise<Project> {
    const creator = stored.creatorId ? this.usersStore.get(stored.creatorId) : null
    const lead = stored.leadId ? this.usersStore.get(stored.leadId) : null

    const project: Project = {
      id: stored.id,
      createdAt: stored.createdAt,
      updatedAt: stored.updatedAt,
      archivedAt: stored.archivedAt,
      name: stored.name,
      description: stored.description,
      icon: stored.icon,
      color: stored.color,
      state: stored.state,
      slugId: stored.slugId,
      url: `https://linear.app/project/${stored.slugId}`,
      progress: stored.progress,
      startDate: stored.startDate,
      targetDate: stored.targetDate,
      startedAt: stored.startedAt,
      completedAt: stored.completedAt,
      canceledAt: stored.canceledAt,
      sortOrder: stored.sortOrder,
      creator: creator ? await this.hydrateUser(creator) : null,
      lead: lead ? await this.hydrateUser(lead) : null,

      // Relationship methods
      teams: async () => this.getProjectTeams(stored.teamIds),
      members: async () => this.getProjectMembers(stored.memberIds),
      issues: async (args) => this.getIssuesByProject(stored.id, args),
      projectMilestones: async () => this.getProjectMilestones(stored.id),
      projectUpdates: async () => this.getProjectUpdates(stored.id),
    }

    return project
  }

  private async getProjectTeams(teamIds: ID[]): Promise<Connection<Team>> {
    const teams: Team[] = []
    for (const id of teamIds) {
      try {
        const team = await this.team(id)
        teams.push(team)
      } catch {
        // Ignore missing teams
      }
    }
    return {
      nodes: teams,
      pageInfo: { hasNextPage: false, hasPreviousPage: false },
    }
  }

  private async getProjectMembers(memberIds: ID[]): Promise<Connection<User>> {
    const users: User[] = []
    for (const id of memberIds) {
      const stored = this.usersStore.get(id)
      if (stored) {
        users.push(await this.hydrateUser(stored))
      }
    }
    return {
      nodes: users,
      pageInfo: { hasNextPage: false, hasPreviousPage: false },
    }
  }

  private async getProjectMilestones(projectId: ID): Promise<Connection<ProjectMilestone>> {
    const milestones: ProjectMilestone[] = []

    for (const stored of this.milestonesStore.values()) {
      if (stored.projectId === projectId && !stored.archivedAt) {
        milestones.push(await this.hydrateMilestone(stored))
      }
    }

    milestones.sort((a, b) => a.sortOrder - b.sortOrder)

    return {
      nodes: milestones,
      pageInfo: { hasNextPage: false, hasPreviousPage: false },
    }
  }

  private async getProjectUpdates(projectId: ID): Promise<Connection<ProjectUpdate>> {
    const updates: ProjectUpdate[] = []

    for (const stored of this.projectUpdatesStore.values()) {
      if (stored.projectId === projectId) {
        updates.push(await this.hydrateProjectUpdate(stored))
      }
    }

    updates.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

    return {
      nodes: updates,
      pageInfo: { hasNextPage: false, hasPreviousPage: false },
    }
  }

  private async hydrateMilestone(stored: StoredMilestone): Promise<ProjectMilestone> {
    const project = await this.project(stored.projectId)

    return {
      id: stored.id,
      createdAt: stored.createdAt,
      updatedAt: stored.updatedAt,
      archivedAt: stored.archivedAt,
      name: stored.name,
      description: stored.description,
      targetDate: stored.targetDate,
      sortOrder: stored.sortOrder,
      project,
    }
  }

  private async hydrateProjectUpdate(stored: StoredProjectUpdate): Promise<ProjectUpdate> {
    const project = await this.project(stored.projectId)
    const user = this.usersStore.get(stored.userId)

    return {
      id: stored.id,
      createdAt: stored.createdAt,
      updatedAt: stored.updatedAt,
      body: stored.body,
      health: stored.health,
      project,
      user: user ? await this.hydrateUser(user) : ({} as User),
      editedAt: stored.editedAt,
    }
  }

  // ===========================================================================
  // Cycles
  // ===========================================================================

  async cycleCreate(input: CycleCreateInput): Promise<CyclePayload> {
    const now = new Date().toISOString()
    const id = this.generateId()
    const cycleNumber = this.getNextCycleNumber(input.teamId)

    const stored: StoredCycle = {
      id,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
      number: cycleNumber,
      name: input.name ?? null,
      description: input.description ?? null,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      completedAt: null,
      progress: 0,
      scopeHistory: [],
      completedScopeHistory: [],
      issueCountHistory: [],
      completedIssueCountHistory: [],
      teamId: input.teamId,
    }

    await this.cyclesStore.put(id, stored, Date.now())
    const cycle = await this.hydrateCycle(stored)

    this.emitEvent('Cycle', 'create', cycle)

    return {
      success: true,
      cycle,
    }
  }

  async cycle(id: ID): Promise<Cycle> {
    const stored = await this.cyclesStore.get(id)
    if (!stored) {
      throw this.createError('NotFound', `Cycle not found: ${id}`)
    }
    return this.hydrateCycle(stored)
  }

  async cycleUpdate(id: ID, input: CycleUpdateInput): Promise<CyclePayload> {
    const existing = await this.cyclesStore.get(id)
    if (!existing) {
      throw this.createError('NotFound', `Cycle not found: ${id}`)
    }

    const now = new Date().toISOString()

    const updated: StoredCycle = {
      ...existing,
      updatedAt: now,
      name: input.name !== undefined ? input.name : existing.name,
      description: input.description !== undefined ? input.description : existing.description,
      startsAt: input.startsAt ?? existing.startsAt,
      endsAt: input.endsAt ?? existing.endsAt,
      completedAt: input.completedAt !== undefined ? input.completedAt : existing.completedAt,
    }

    await this.cyclesStore.put(id, updated, Date.now())
    const cycle = await this.hydrateCycle(updated)

    this.emitEvent('Cycle', 'update', cycle)

    return {
      success: true,
      cycle,
    }
  }

  async cycleArchive(id: ID): Promise<SuccessPayload> {
    const existing = await this.cyclesStore.get(id)
    if (!existing) {
      throw this.createError('NotFound', `Cycle not found: ${id}`)
    }

    const now = new Date().toISOString()
    const updated: StoredCycle = {
      ...existing,
      updatedAt: now,
      archivedAt: now,
    }

    await this.cyclesStore.put(id, updated, Date.now())

    this.emitEvent('Cycle', 'update', { id, archived: true })

    return {
      success: true,
    }
  }

  async cycles(args?: CycleFilterArgs): Promise<Connection<Cycle>> {
    const all = await this.getAllCycles()
    let filtered = all

    if (!args?.includeArchived) {
      filtered = filtered.filter((c) => !c.archivedAt)
    }

    if (args?.filter) {
      filtered = this.applyCycleFilter(filtered, args.filter)
    }

    const hydrated = await Promise.all(filtered.map((c) => this.hydrateCycle(c)))

    if (args?.orderBy) {
      hydrated.sort((a, b) => {
        switch (args.orderBy) {
          case 'createdAt':
            return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
          case 'startsAt':
            return new Date(b.startsAt).getTime() - new Date(a.startsAt).getTime()
          case 'endsAt':
            return new Date(b.endsAt).getTime() - new Date(a.endsAt).getTime()
          case 'number':
            return b.number - a.number
          default:
            return 0
        }
      })
    } else {
      hydrated.sort((a, b) => new Date(b.startsAt).getTime() - new Date(a.startsAt).getTime())
    }

    return this.paginateResults(hydrated, args)
  }

  private async getAllCycles(): Promise<StoredCycle[]> {
    const results: StoredCycle[] = []
    for await (const cycle of this.cyclesStore.range('', {})) {
      results.push(cycle)
    }
    return results
  }

  private async getCyclesByTeam(teamId: ID, args?: CycleFilterArgs): Promise<Connection<Cycle>> {
    const all = await this.getAllCycles()
    let filtered = all.filter((c) => c.teamId === teamId)

    if (!args?.includeArchived) {
      filtered = filtered.filter((c) => !c.archivedAt)
    }

    const hydrated = await Promise.all(filtered.map((c) => this.hydrateCycle(c)))
    hydrated.sort((a, b) => b.number - a.number)

    return this.paginateResults(hydrated, args)
  }

  private async getActiveCycleForTeam(teamId: ID): Promise<Cycle | null> {
    const all = await this.getAllCycles()
    const now = Date.now()

    const activeCycle = all.find((c) => {
      if (c.teamId !== teamId) return false
      if (c.archivedAt) return false
      if (c.completedAt) return false

      const startsAt = new Date(c.startsAt).getTime()
      const endsAt = new Date(c.endsAt).getTime()

      return startsAt <= now && now <= endsAt
    })

    if (!activeCycle) return null

    return this.hydrateCycle(activeCycle)
  }

  private getNextCycleNumber(teamId: ID): number {
    const current = this.cycleCounters.get(teamId) ?? 0
    const next = current + 1
    this.cycleCounters.set(teamId, next)
    return next
  }

  private applyCycleFilter(cycles: StoredCycle[], filter: CycleFilter): StoredCycle[] {
    return cycles.filter((cycle) => {
      if (filter.number) {
        if (filter.number.eq !== undefined && cycle.number !== filter.number.eq) return false
        if (filter.number.gt !== undefined && cycle.number <= filter.number.gt) return false
        if (filter.number.gte !== undefined && cycle.number < filter.number.gte) return false
        if (filter.number.lt !== undefined && cycle.number >= filter.number.lt) return false
        if (filter.number.lte !== undefined && cycle.number > filter.number.lte) return false
      }

      if (filter.team?.id?.eq && cycle.teamId !== filter.team.id.eq) return false

      if (filter.name) {
        if (filter.name.eq && cycle.name !== filter.name.eq) return false
        if (filter.name.contains && !cycle.name?.includes(filter.name.contains)) return false
      }

      if (filter.isActive?.eq !== undefined) {
        const now = Date.now()
        const startsAt = new Date(cycle.startsAt).getTime()
        const endsAt = new Date(cycle.endsAt).getTime()
        const isActive = startsAt <= now && now <= endsAt && !cycle.completedAt

        if (filter.isActive.eq !== isActive) return false
      }

      if (filter.and) {
        for (const subFilter of filter.and) {
          if (this.applyCycleFilter([cycle], subFilter).length === 0) return false
        }
      }

      if (filter.or && filter.or.length > 0) {
        let anyMatch = false
        for (const subFilter of filter.or) {
          if (this.applyCycleFilter([cycle], subFilter).length > 0) {
            anyMatch = true
            break
          }
        }
        if (!anyMatch) return false
      }

      return true
    })
  }

  private async hydrateCycle(stored: StoredCycle): Promise<Cycle> {
    // Use getTeamForCycle to avoid infinite recursion: hydrateCycle -> team -> hydrateTeam -> getActiveCycleForTeam -> hydrateCycle
    const team = await this.getTeamForCycle(stored.teamId)

    const cycle: Cycle = {
      id: stored.id,
      createdAt: stored.createdAt,
      updatedAt: stored.updatedAt,
      archivedAt: stored.archivedAt,
      number: stored.number,
      name: stored.name,
      description: stored.description,
      startsAt: stored.startsAt,
      endsAt: stored.endsAt,
      completedAt: stored.completedAt,
      progress: stored.progress,
      scopeHistory: stored.scopeHistory,
      completedScopeHistory: stored.completedScopeHistory,
      issueCountHistory: stored.issueCountHistory,
      completedIssueCountHistory: stored.completedIssueCountHistory,
      team,

      // Relationship methods
      issues: async (args) => this.getIssuesByCycle(stored.id, args),
    }

    return cycle
  }

  // ===========================================================================
  // Comments
  // ===========================================================================

  async commentCreate(input: CommentCreateInput): Promise<CommentPayload> {
    const now = new Date().toISOString()
    const id = this.generateId()

    const stored: StoredComment = {
      id,
      createdAt: now,
      updatedAt: now,
      body: input.body,
      issueId: input.issueId,
      userId: this.currentUserId,
      parentId: input.parentId ?? null,
    }

    this.commentsStore.set(id, stored)
    const comment = await this.hydrateComment(stored)

    return {
      success: true,
      comment,
    }
  }

  async comment(id: ID): Promise<Comment> {
    const stored = this.commentsStore.get(id)
    if (!stored || stored.archivedAt) {
      throw this.createError('NotFound', `Comment not found: ${id}`)
    }
    return this.hydrateComment(stored)
  }

  async commentUpdate(id: ID, input: CommentUpdateInput): Promise<CommentPayload> {
    const existing = this.commentsStore.get(id)
    if (!existing || existing.archivedAt) {
      throw this.createError('NotFound', `Comment not found: ${id}`)
    }

    const now = new Date().toISOString()
    const updated: StoredComment = {
      ...existing,
      updatedAt: now,
      body: input.body ?? existing.body,
      editedAt: now,
    }

    this.commentsStore.set(id, updated)
    const comment = await this.hydrateComment(updated)

    return {
      success: true,
      comment,
    }
  }

  async commentDelete(id: ID): Promise<SuccessPayload> {
    const existing = this.commentsStore.get(id)
    if (!existing) {
      throw this.createError('NotFound', `Comment not found: ${id}`)
    }

    this.commentsStore.delete(id)

    return {
      success: true,
    }
  }

  private async hydrateComment(stored: StoredComment): Promise<Comment> {
    const issue = await this.issue(stored.issueId)
    const user = this.usersStore.get(stored.userId)

    return {
      id: stored.id,
      createdAt: stored.createdAt,
      updatedAt: stored.updatedAt,
      archivedAt: stored.archivedAt,
      body: stored.body,
      editedAt: stored.editedAt,
      url: `${issue.url}#comment-${stored.id}`,
      issue,
      user: user ? await this.hydrateUser(user) : ({} as User),
    }
  }

  private hydrateCommentSync(stored: StoredComment): Comment {
    return {
      id: stored.id,
      createdAt: stored.createdAt,
      updatedAt: stored.updatedAt,
      archivedAt: stored.archivedAt,
      body: stored.body,
      editedAt: stored.editedAt,
      url: '',
    } as Comment
  }

  // ===========================================================================
  // Labels
  // ===========================================================================

  async issueLabelCreate(input: IssueLabelCreateInput): Promise<IssueLabelPayload> {
    const now = new Date().toISOString()
    const id = this.generateId()

    const stored: StoredLabel = {
      id,
      createdAt: now,
      updatedAt: now,
      name: input.name,
      description: input.description ?? null,
      color: input.color,
      isGroup: false,
      teamId: input.teamId ?? null,
      parentId: input.parentId ?? null,
      creatorId: this.currentUserId,
    }

    this.labelsStore.set(id, stored)
    const label = await this.hydrateLabel(stored)

    return {
      success: true,
      issueLabel: label,
    }
  }

  async issueLabelUpdate(id: ID, input: IssueLabelUpdateInput): Promise<IssueLabelPayload> {
    const existing = this.labelsStore.get(id)
    if (!existing || existing.archivedAt) {
      throw this.createError('NotFound', `Label not found: ${id}`)
    }

    const now = new Date().toISOString()
    const updated: StoredLabel = {
      ...existing,
      updatedAt: now,
      name: input.name ?? existing.name,
      description: input.description !== undefined ? input.description : existing.description,
      color: input.color ?? existing.color,
      parentId: input.parentId !== undefined ? input.parentId : existing.parentId,
    }

    this.labelsStore.set(id, updated)
    const label = await this.hydrateLabel(updated)

    return {
      success: true,
      issueLabel: label,
    }
  }

  async issueLabelArchive(id: ID): Promise<IssueLabelPayload> {
    const existing = this.labelsStore.get(id)
    if (!existing) {
      throw this.createError('NotFound', `Label not found: ${id}`)
    }

    const now = new Date().toISOString()
    const updated: StoredLabel = {
      ...existing,
      updatedAt: now,
      archivedAt: now,
    }

    this.labelsStore.set(id, updated)
    const label = await this.hydrateLabel(updated)

    return {
      success: true,
      issueLabel: label,
    }
  }

  async issueLabels(args?: LabelFilterArgs): Promise<Connection<IssueLabel>> {
    const all = Array.from(this.labelsStore.values()).filter((l) => !l.archivedAt)
    const hydrated = await Promise.all(all.map((l) => this.hydrateLabel(l)))
    return this.paginateResults(hydrated, args)
  }

  private async getTeamLabels(teamId: ID): Promise<Connection<IssueLabel>> {
    const filtered = Array.from(this.labelsStore.values()).filter(
      (l) => l.teamId === teamId && !l.archivedAt
    )
    const hydrated = await Promise.all(filtered.map((l) => this.hydrateLabel(l)))
    return {
      nodes: hydrated,
      pageInfo: { hasNextPage: false, hasPreviousPage: false },
    }
  }

  private async hydrateLabel(stored: StoredLabel): Promise<IssueLabel> {
    return {
      id: stored.id,
      createdAt: stored.createdAt,
      updatedAt: stored.updatedAt,
      archivedAt: stored.archivedAt,
      name: stored.name,
      description: stored.description,
      color: stored.color,
      isGroup: stored.isGroup,
    }
  }

  // ===========================================================================
  // Workflow States
  // ===========================================================================

  async workflowStateCreate(input: WorkflowStateCreateInput): Promise<WorkflowStatePayload> {
    const now = new Date().toISOString()
    const id = this.generateId()

    const stored: StoredWorkflowState = {
      id,
      createdAt: now,
      updatedAt: now,
      name: input.name,
      description: input.description ?? null,
      color: input.color,
      type: input.type,
      position: input.position ?? this.getNextStatePosition(input.teamId),
      teamId: input.teamId,
    }

    this.workflowStatesStore.set(id, stored)
    const state = await this.hydrateWorkflowState(stored)

    return {
      success: true,
      workflowState: state,
    }
  }

  async workflowStateUpdate(id: ID, input: WorkflowStateUpdateInput): Promise<WorkflowStatePayload> {
    const existing = this.workflowStatesStore.get(id)
    if (!existing) {
      throw this.createError('NotFound', `Workflow state not found: ${id}`)
    }

    const now = new Date().toISOString()
    const updated: StoredWorkflowState = {
      ...existing,
      updatedAt: now,
      name: input.name ?? existing.name,
      description: input.description !== undefined ? input.description : existing.description,
      color: input.color ?? existing.color,
      type: input.type ?? existing.type,
      position: input.position ?? existing.position,
    }

    this.workflowStatesStore.set(id, updated)
    const state = await this.hydrateWorkflowState(updated)

    return {
      success: true,
      workflowState: state,
    }
  }

  private async getTeamStates(teamId: ID): Promise<Connection<WorkflowState>> {
    const filtered = Array.from(this.workflowStatesStore.values())
      .filter((s) => s.teamId === teamId && !s.archivedAt)
      .sort((a, b) => a.position - b.position)

    const hydrated = await Promise.all(filtered.map((s) => this.hydrateWorkflowState(s)))
    return {
      nodes: hydrated,
      pageInfo: { hasNextPage: false, hasPreviousPage: false },
    }
  }

  private getNextStatePosition(teamId: ID): number {
    const teamStates = Array.from(this.workflowStatesStore.values()).filter((s) => s.teamId === teamId)
    return teamStates.length
  }

  private async hydrateWorkflowState(stored: StoredWorkflowState): Promise<WorkflowState> {
    const team = await this.team(stored.teamId)

    return {
      id: stored.id,
      createdAt: stored.createdAt,
      updatedAt: stored.updatedAt,
      archivedAt: stored.archivedAt,
      name: stored.name,
      description: stored.description,
      color: stored.color,
      type: stored.type,
      position: stored.position,
      team,
    }
  }

  // ===========================================================================
  // Users
  // ===========================================================================

  async user(id: ID): Promise<User> {
    const stored = this.usersStore.get(id)
    if (!stored) {
      throw this.createError('NotFound', `User not found: ${id}`)
    }
    return this.hydrateUser(stored)
  }

  async users(args?: PaginationArgs): Promise<Connection<User>> {
    const all = Array.from(this.usersStore.values()).filter((u) => u.active)
    const hydrated = await Promise.all(all.map((u) => this.hydrateUser(u)))
    return this.paginateResults(hydrated, args)
  }

  async userUpdate(id: ID, input: UserUpdateInput): Promise<UserPayload> {
    const existing = this.usersStore.get(id)
    if (!existing) {
      throw this.createError('NotFound', `User not found: ${id}`)
    }

    const now = new Date().toISOString()
    const updated: StoredUser = {
      ...existing,
      updatedAt: now,
      name: input.name ?? existing.name,
      displayName: input.displayName ?? existing.displayName,
      avatarUrl: input.avatarUrl !== undefined ? input.avatarUrl : existing.avatarUrl,
      description: input.description !== undefined ? input.description : existing.description,
      timezone: input.timezone !== undefined ? input.timezone : existing.timezone,
    }

    this.usersStore.set(id, updated)
    const user = await this.hydrateUser(updated)

    return {
      success: true,
      user,
    }
  }

  private async getTeamMembers(): Promise<Connection<User>> {
    const all = Array.from(this.usersStore.values()).filter((u) => u.active)
    const hydrated = await Promise.all(all.map((u) => this.hydrateUser(u)))
    return {
      nodes: hydrated,
      pageInfo: { hasNextPage: false, hasPreviousPage: false },
    }
  }

  private async hydrateUser(stored: StoredUser): Promise<User> {
    return {
      id: stored.id,
      createdAt: stored.createdAt,
      updatedAt: stored.updatedAt,
      archivedAt: stored.archivedAt,
      name: stored.name,
      displayName: stored.displayName,
      email: stored.email,
      avatarUrl: stored.avatarUrl,
      admin: stored.admin,
      active: stored.active,
      guest: stored.guest,
      url: `https://linear.app/user/${stored.id}`,
      description: stored.description,
      timezone: stored.timezone,
    }
  }

  // ===========================================================================
  // Reactions
  // ===========================================================================

  async reactionCreate(input: ReactionCreateInput): Promise<ReactionPayload> {
    const now = new Date().toISOString()
    const id = this.generateId()

    const stored: StoredReaction = {
      id,
      createdAt: now,
      updatedAt: now,
      emoji: input.emoji,
      userId: this.currentUserId,
      commentId: input.commentId ?? null,
      projectUpdateId: input.projectUpdateId ?? null,
    }

    this.reactionsStore.set(id, stored)

    return {
      success: true,
      reaction: {
        id: stored.id,
        createdAt: stored.createdAt,
        updatedAt: stored.updatedAt,
        emoji: stored.emoji,
        user: await this.user(this.currentUserId),
      },
    }
  }

  // ===========================================================================
  // Webhooks
  // ===========================================================================

  async webhookCreate(input: WebhookCreateInput): Promise<WebhookPayload> {
    const now = new Date().toISOString()
    const id = this.generateId()
    const secret = input.secret ?? this.generateWebhookSecret()

    const stored: StoredWebhook = {
      id,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
      url: input.url,
      label: input.label ?? null,
      enabled: input.enabled ?? true,
      secret,
      resourceTypes: input.resourceTypes,
      allPublicTeams: input.allPublicTeams ?? false,
      teamId: input.teamId ?? null,
      creatorId: this.currentUserId,
    }

    this.webhooksStore.set(id, stored)
    const webhook = await this.hydrateWebhook(stored)

    return {
      success: true,
      webhook,
    }
  }

  async webhookUpdate(id: ID, input: WebhookUpdateInput): Promise<WebhookPayload> {
    const existing = this.webhooksStore.get(id)
    if (!existing || existing.archivedAt) {
      throw this.createError('NotFound', `Webhook not found: ${id}`)
    }

    const now = new Date().toISOString()

    const updated: StoredWebhook = {
      ...existing,
      updatedAt: now,
      url: input.url ?? existing.url,
      label: input.label !== undefined ? input.label : existing.label,
      enabled: input.enabled ?? existing.enabled,
      resourceTypes: input.resourceTypes ?? existing.resourceTypes,
      secret: input.secret !== undefined ? (input.secret ?? existing.secret) : existing.secret,
    }

    this.webhooksStore.set(id, updated)
    const webhook = await this.hydrateWebhook(updated)

    return {
      success: true,
      webhook,
    }
  }

  async webhookDelete(id: ID): Promise<SuccessPayload> {
    const existing = this.webhooksStore.get(id)
    if (!existing) {
      throw this.createError('NotFound', `Webhook not found: ${id}`)
    }

    this.webhooksStore.delete(id)

    return {
      success: true,
    }
  }

  async webhooks(args?: PaginationArgs): Promise<Connection<Webhook>> {
    const all = Array.from(this.webhooksStore.values()).filter((w) => !w.archivedAt)
    const hydrated = await Promise.all(all.map((w) => this.hydrateWebhook(w)))
    return this.paginateResults(hydrated, args)
  }

  private generateWebhookSecret(): string {
    const bytes = new Uint8Array(32)
    crypto.getRandomValues(bytes)
    return 'lin_wh_' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  }

  private async hydrateWebhook(stored: StoredWebhook): Promise<Webhook> {
    let team: Team | undefined
    if (stored.teamId) {
      try {
        team = await this.team(stored.teamId)
      } catch {
        // Ignore missing teams
      }
    }

    const creator = stored.creatorId ? this.usersStore.get(stored.creatorId) : null

    return {
      id: stored.id,
      createdAt: stored.createdAt,
      updatedAt: stored.updatedAt,
      archivedAt: stored.archivedAt,
      url: stored.url,
      label: stored.label,
      enabled: stored.enabled,
      secret: stored.secret,
      resourceTypes: stored.resourceTypes,
      allPublicTeams: stored.allPublicTeams,
      team,
      creator: creator ? await this.hydrateUser(creator) : undefined,
    }
  }

  // ===========================================================================
  // Utilities
  // ===========================================================================

  /**
   * Clear all state (for testing)
   */
  async clear(): Promise<void> {
    await this.issuesStore.clear()
    await this.projectsStore.clear()
    await this.cyclesStore.clear()
    this.teamsStore.clear()
    this.commentsStore.clear()
    this.labelsStore.clear()
    this.workflowStatesStore.clear()
    this.webhooksStore.clear()
    this.milestonesStore.clear()
    this.projectUpdatesStore.clear()
    this.reactionsStore.clear()
    this.relationsStore.clear()
    this.issueCounters.clear()
    this.cycleCounters.clear()
  }

  /**
   * Dispose of resources
   */
  dispose(): void {
    // No resources to dispose in the simplified implementation
  }
}

// =============================================================================
// Webhook Signature Utilities
// =============================================================================

export const WebhookUtils = {
  /**
   * Sign a webhook payload
   */
  async sign(payload: string, secret: string): Promise<string> {
    const encoder = new TextEncoder()
    const data = encoder.encode(payload)
    const keyData = encoder.encode(secret)

    const key = await crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, [
      'sign',
    ])

    const signature = await crypto.subtle.sign('HMAC', key, data)
    const bytes = new Uint8Array(signature)
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  },

  /**
   * Verify a webhook signature
   */
  async verify(payload: string, signature: string, secret: string): Promise<boolean> {
    try {
      const expectedSignature = await this.sign(payload, secret)
      return expectedSignature === signature
    } catch {
      return false
    }
  },

  /**
   * Create Linear-style webhook header
   */
  async createHeader(
    payload: string,
    secret: string,
    timestamp?: number
  ): Promise<{ 'linear-signature': string; 'linear-timestamp': string }> {
    const ts = timestamp ?? Date.now()
    const signaturePayload = `${ts}.${payload}`
    const signature = await this.sign(signaturePayload, secret)

    return {
      'linear-signature': signature,
      'linear-timestamp': ts.toString(),
    }
  },

  /**
   * Verify Linear webhook with timestamp tolerance
   */
  async verifyRequest(
    payload: string,
    headers: { 'linear-signature': string; 'linear-timestamp': string },
    secret: string,
    toleranceMs: number = 300000 // 5 minutes
  ): Promise<boolean> {
    const timestamp = parseInt(headers['linear-timestamp'], 10)
    if (isNaN(timestamp)) return false

    // Check timestamp freshness
    const now = Date.now()
    if (Math.abs(now - timestamp) > toleranceMs) {
      return false
    }

    const signaturePayload = `${timestamp}.${payload}`
    return this.verify(signaturePayload, headers['linear-signature'], secret)
  },
}

// =============================================================================
// LinearClient (SDK-compatible wrapper)
// =============================================================================

/**
 * LinearClient - SDK-compatible wrapper
 *
 * For production use, this would make actual API calls.
 * For local testing, it wraps LinearLocal.
 */
export class LinearClient {
  private local: LinearLocal

  constructor(_config?: LinearClientConfig) {
    // For now, always use local implementation
    // In production, this would check for apiKey and make real API calls
    this.local = new LinearLocal()
  }

  // Delegate all methods to local implementation
  get viewer() {
    return this.local.viewer
  }

  team(id: ID) {
    return this.local.team(id)
  }

  teams(args?: PaginationArgs) {
    return this.local.teams(args)
  }

  teamCreate(input: TeamCreateInput) {
    return this.local.teamCreate(input)
  }

  teamUpdate(id: ID, input: TeamUpdateInput) {
    return this.local.teamUpdate(id, input)
  }

  issue(id: ID) {
    return this.local.issue(id)
  }

  issues(args?: IssueFilterArgs) {
    return this.local.issues(args)
  }

  issueCreate(input: IssueCreateInput) {
    return this.local.issueCreate(input)
  }

  issueUpdate(id: ID, input: IssueUpdateInput) {
    return this.local.issueUpdate(id, input)
  }

  issueArchive(id: ID) {
    return this.local.issueArchive(id)
  }

  issueDelete(id: ID) {
    return this.local.issueDelete(id)
  }

  project(id: ID) {
    return this.local.project(id)
  }

  projects(args?: ProjectFilterArgs) {
    return this.local.projects(args)
  }

  projectCreate(input: ProjectCreateInput) {
    return this.local.projectCreate(input)
  }

  projectUpdate(id: ID, input: ProjectUpdateInput) {
    return this.local.projectUpdate(id, input)
  }

  projectArchive(id: ID) {
    return this.local.projectArchive(id)
  }

  cycle(id: ID) {
    return this.local.cycle(id)
  }

  cycles(args?: CycleFilterArgs) {
    return this.local.cycles(args)
  }

  cycleCreate(input: CycleCreateInput) {
    return this.local.cycleCreate(input)
  }

  cycleUpdate(id: ID, input: CycleUpdateInput) {
    return this.local.cycleUpdate(id, input)
  }

  cycleArchive(id: ID) {
    return this.local.cycleArchive(id)
  }

  comment(id: ID) {
    return this.local.comment(id)
  }

  commentCreate(input: CommentCreateInput) {
    return this.local.commentCreate(input)
  }

  commentUpdate(id: ID, input: CommentUpdateInput) {
    return this.local.commentUpdate(id, input)
  }

  commentDelete(id: ID) {
    return this.local.commentDelete(id)
  }

  user(id: ID) {
    return this.local.user(id)
  }

  users(args?: PaginationArgs) {
    return this.local.users(args)
  }

  userUpdate(id: ID, input: UserUpdateInput) {
    return this.local.userUpdate(id, input)
  }

  issueLabels(args?: LabelFilterArgs) {
    return this.local.issueLabels(args)
  }

  issueLabelCreate(input: IssueLabelCreateInput) {
    return this.local.issueLabelCreate(input)
  }

  issueLabelUpdate(id: ID, input: IssueLabelUpdateInput) {
    return this.local.issueLabelUpdate(id, input)
  }

  issueLabelArchive(id: ID) {
    return this.local.issueLabelArchive(id)
  }

  workflowStateCreate(input: WorkflowStateCreateInput) {
    return this.local.workflowStateCreate(input)
  }

  workflowStateUpdate(id: ID, input: WorkflowStateUpdateInput) {
    return this.local.workflowStateUpdate(id, input)
  }

  webhooks(args?: PaginationArgs) {
    return this.local.webhooks(args)
  }

  webhookCreate(input: WebhookCreateInput) {
    return this.local.webhookCreate(input)
  }

  webhookUpdate(id: ID, input: WebhookUpdateInput) {
    return this.local.webhookUpdate(id, input)
  }

  webhookDelete(id: ID) {
    return this.local.webhookDelete(id)
  }
}

export default LinearLocal
