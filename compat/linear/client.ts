/**
 * LinearLocal - Complete Local Linear Implementation
 *
 * Drop-in replacement for Linear SDK that runs entirely locally.
 * Uses dotdo primitives:
 * - TemporalStore for issue/project state with time-travel queries
 * - WindowManager for cycle/sprint management
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

import { LocalIssuesResource } from './issues'
import { LocalProjectsResource } from './projects'
import { LocalCyclesResource } from './cycles'
import { LocalWebhooksResource, WebhookUtils } from './webhooks'
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
  IssueRelationCreateInput,
  IssueRelationPayload,
  IssueHistory,
  // Projects
  Project,
  ProjectCreateInput,
  ProjectUpdateInput,
  ProjectPayload,
  ProjectFilterArgs,
  ProjectMilestoneCreateInput,
  ProjectMilestoneUpdateInput,
  ProjectMilestonePayload,
  ProjectUpdateCreateInput,
  ProjectUpdatePayload,
  // Cycles
  Cycle,
  CycleCreateInput,
  CycleUpdateInput,
  CyclePayload,
  CycleFilterArgs,
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
  ReactionCreateInput,
  ReactionPayload,
  // Common
  Connection,
  PageInfo,
  ID,
  DateTime,
  SuccessPayload,
  PaginationArgs,
} from './types'

// =============================================================================
// Default Workflow States
// =============================================================================

const DEFAULT_WORKFLOW_STATES: Array<{
  name: string
  type: 'backlog' | 'unstarted' | 'started' | 'completed' | 'canceled'
  color: string
  position: number
}> = [
  { name: 'Backlog', type: 'backlog', color: '#bec2c8', position: 0 },
  { name: 'Todo', type: 'unstarted', color: '#e2e2e2', position: 1 },
  { name: 'In Progress', type: 'started', color: '#f2c94c', position: 2 },
  { name: 'Done', type: 'completed', color: '#5e6ad2', position: 3 },
  { name: 'Canceled', type: 'canceled', color: '#95a2b3', position: 4 },
]

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
  type: 'backlog' | 'unstarted' | 'started' | 'completed' | 'canceled'
  position: number
  teamId: ID
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
  private issuesResource: LocalIssuesResource
  private projectsResource: LocalProjectsResource
  private cyclesResource: LocalCyclesResource
  private webhooksResource: LocalWebhooksResource

  // Local storage for simple resources
  private teamsStore: Map<ID, StoredTeam> = new Map()
  private usersStore: Map<ID, StoredUser> = new Map()
  private commentsStore: Map<ID, StoredComment> = new Map()
  private labelsStore: Map<ID, StoredLabel> = new Map()
  private workflowStatesStore: Map<ID, StoredWorkflowState> = new Map()
  private reactionsStore: Map<ID, StoredReaction> = new Map()

  // Current user (viewer)
  private currentUserId: ID

  // Organization ID
  private organizationId: ID = 'org_local'

  // Static webhook utilities
  static readonly webhooks = WebhookUtils

  constructor(config?: LinearLocalConfig) {
    this.config = config ?? {}

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

    // Event handler for webhook delivery
    const onEvent = this.config.webhooks !== false
      ? (type: string, action: string, data: unknown) => {
          const resourceType = type as WebhookResourceType
          const webhookAction = action as WebhookAction

          // Create and deliver webhook event
          this.webhooksResource
            .createEvent(resourceType, webhookAction, data as Record<string, unknown>)
            .then((event) => {
              if (this.config.onWebhookEvent) {
                this.config.onWebhookEvent(event)
              }
            })
            .catch(() => {})
        }
      : undefined

    // Initialize resources
    this.issuesResource = new LocalIssuesResource({
      onEvent,
      getTeam: (id) => this.team(id),
      getUser: (id) => this.getUserOrNull(id),
      getState: (id) => this.getStateOrNull(id),
      getLabel: (id) => this.getLabelOrNull(id),
      getProject: (id) => this.getProjectOrNull(id),
      getCycle: (id) => this.getCycleOrNull(id),
      getComments: (issueId) => this.getIssueComments(issueId),
    })

    this.projectsResource = new LocalProjectsResource({
      onEvent,
      getTeam: (id) => this.team(id),
      getUser: (id) => this.getUserOrNull(id),
      getProjectIssues: (projectId, args) =>
        this.issuesResource.listByProject(projectId, args),
    })

    this.cyclesResource = new LocalCyclesResource({
      onEvent,
      getTeam: (id) => this.team(id),
      getCycleIssues: (cycleId, args) =>
        this.issuesResource.listByCycle(cycleId, args),
    })

    this.webhooksResource = new LocalWebhooksResource({
      organizationId: this.organizationId,
      getTeam: (id) => this.getTeamOrNull(id),
      getUser: (id) => this.getUserOrNull(id),
    })
  }

  private generateId(): string {
    return crypto.randomUUID()
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
    this.issuesResource.initTeamCounter(id)
    this.cyclesResource.initTeamCounter(id)

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

  private async getTeamOrNull(id: ID): Promise<Team | null> {
    const stored = this.teamsStore.get(id)
    if (!stored) return null
    return this.hydrateTeam(stored)
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

  private async hydrateTeam(stored: StoredTeam): Promise<Team> {
    const activeCycle = await this.cyclesResource.getActiveCycle(stored.id)
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
      issues: (args) => this.issuesResource.listByTeam(stored.id, args),
      projects: (args) => this.projectsResource.listByTeam(stored.id, args),
      cycles: (args) => this.cyclesResource.listByTeam(stored.id, args),
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
    return this.issuesResource.create(input, this.currentUserId)
  }

  async issue(id: ID): Promise<Issue> {
    return this.issuesResource.retrieve(id)
  }

  async issueAsOf(id: ID, timestamp: number): Promise<Issue | null> {
    return this.issuesResource.retrieveAsOf(id, timestamp)
  }

  async issueHistory(id: ID): Promise<IssueHistory[]> {
    return this.issuesResource.history(id)
  }

  async issueUpdate(id: ID, input: IssueUpdateInput): Promise<IssuePayload> {
    return this.issuesResource.update(id, input)
  }

  async issueArchive(id: ID): Promise<IssueArchivePayload> {
    return this.issuesResource.archive(id)
  }

  async issueUnarchive(id: ID): Promise<IssueArchivePayload> {
    return this.issuesResource.unarchive(id)
  }

  async issueDelete(id: ID): Promise<IssueArchivePayload> {
    return this.issuesResource.delete(id)
  }

  async issues(args?: IssueFilterArgs): Promise<Connection<Issue>> {
    return this.issuesResource.list(args)
  }

  async searchIssues(query: string, args?: IssueFilterArgs): Promise<Connection<Issue>> {
    return this.issuesResource.search(query, args)
  }

  async issueRelationCreate(input: IssueRelationCreateInput): Promise<IssueRelationPayload> {
    return this.issuesResource.createRelation(input)
  }

  // ===========================================================================
  // Projects
  // ===========================================================================

  async projectCreate(input: ProjectCreateInput): Promise<ProjectPayload> {
    return this.projectsResource.create(input, this.currentUserId)
  }

  async project(id: ID): Promise<Project> {
    return this.projectsResource.retrieve(id)
  }

  private async getProjectOrNull(id: ID): Promise<Project | null> {
    try {
      return await this.projectsResource.retrieve(id)
    } catch {
      return null
    }
  }

  async projectUpdate(id: ID, input: ProjectUpdateInput): Promise<ProjectPayload> {
    return this.projectsResource.update(id, input)
  }

  async projectArchive(id: ID): Promise<ProjectPayload> {
    return this.projectsResource.archive(id)
  }

  async projectDelete(id: ID): Promise<SuccessPayload> {
    return this.projectsResource.delete(id)
  }

  async projects(args?: ProjectFilterArgs): Promise<Connection<Project>> {
    return this.projectsResource.list(args)
  }

  async searchProjects(query: string, args?: ProjectFilterArgs): Promise<Connection<Project>> {
    return this.projectsResource.search(query, args)
  }

  async projectMilestoneCreate(input: ProjectMilestoneCreateInput): Promise<ProjectMilestonePayload> {
    return this.projectsResource.createMilestone(input)
  }

  async projectMilestoneUpdate(
    id: ID,
    input: ProjectMilestoneUpdateInput
  ): Promise<ProjectMilestonePayload> {
    return this.projectsResource.updateMilestone(id, input)
  }

  async projectUpdateCreate(input: ProjectUpdateCreateInput): Promise<ProjectUpdatePayload> {
    return this.projectsResource.createUpdate(input, this.currentUserId)
  }

  // ===========================================================================
  // Cycles
  // ===========================================================================

  async cycleCreate(input: CycleCreateInput): Promise<CyclePayload> {
    return this.cyclesResource.create(input)
  }

  async cycle(id: ID): Promise<Cycle> {
    return this.cyclesResource.retrieve(id)
  }

  private async getCycleOrNull(id: ID): Promise<Cycle | null> {
    try {
      return await this.cyclesResource.retrieve(id)
    } catch {
      return null
    }
  }

  async cycleUpdate(id: ID, input: CycleUpdateInput): Promise<CyclePayload> {
    return this.cyclesResource.update(id, input)
  }

  async cycleArchive(id: ID): Promise<SuccessPayload> {
    return this.cyclesResource.archive(id)
  }

  async cycles(args?: CycleFilterArgs): Promise<Connection<Cycle>> {
    return this.cyclesResource.list(args)
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
    const user = await this.user(stored.userId)

    return {
      id: stored.id,
      createdAt: stored.createdAt,
      updatedAt: stored.updatedAt,
      archivedAt: stored.archivedAt,
      body: stored.body,
      editedAt: stored.editedAt,
      url: `${issue.url}#comment-${stored.id}`,
      issue,
      user,
    }
  }

  getIssueComments(issueId: ID): Connection<Comment> {
    const comments = Array.from(this.commentsStore.values())
      .filter((c) => c.issueId === issueId && !c.archivedAt)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())

    return {
      nodes: comments.map((c) => this.hydrateCommentSync(c)),
      pageInfo: { hasNextPage: false, hasPreviousPage: false },
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

  private async getLabelOrNull(id: ID): Promise<IssueLabel | null> {
    const stored = this.labelsStore.get(id)
    if (!stored || stored.archivedAt) return null
    return this.hydrateLabel(stored)
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

  private async getStateOrNull(id: ID): Promise<WorkflowState | null> {
    const stored = this.workflowStatesStore.get(id)
    if (!stored) return null
    return this.hydrateWorkflowState(stored)
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

  private async getUserOrNull(id: ID): Promise<User | null> {
    const stored = this.usersStore.get(id)
    if (!stored) return null
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
    return this.webhooksResource.create(input, this.currentUserId)
  }

  async webhookUpdate(id: ID, input: WebhookUpdateInput): Promise<WebhookPayload> {
    return this.webhooksResource.update(id, input)
  }

  async webhookDelete(id: ID): Promise<SuccessPayload> {
    return this.webhooksResource.delete(id)
  }

  async webhooks(args?: PaginationArgs): Promise<Connection<Webhook>> {
    return this.webhooksResource.list(args)
  }


  // ===========================================================================
  // Utilities
  // ===========================================================================

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

  private createError(code: string, message: string): Error {
    const error = new Error(message) as Error & { code: string }
    error.code = code
    return error
  }

  /**
   * Clear all state (for testing)
   */
  async clear(): Promise<void> {
    await this.issuesResource.clear()
    await this.projectsResource.clear()
    await this.cyclesResource.clear()
    await this.webhooksResource.clear()
    this.teamsStore.clear()
    this.commentsStore.clear()
    this.labelsStore.clear()
    this.workflowStatesStore.clear()
    this.reactionsStore.clear()
  }

  /**
   * Dispose of resources
   */
  dispose(): void {
    this.cyclesResource.dispose()
  }
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
