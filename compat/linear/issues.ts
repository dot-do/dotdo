/**
 * Linear Issues Resource - Local Implementation
 *
 * Uses TemporalStore for issue state tracking with time-travel queries.
 * Supports full issue lifecycle: create, update, archive, delete.
 */

import { createTemporalStore, type TemporalStore } from '../../db/primitives/temporal-store'
import type {
  Issue,
  IssueCreateInput,
  IssueUpdateInput,
  IssuePayload,
  IssueArchivePayload,
  IssueBatchPayload,
  IssueFilterArgs,
  IssueFilter,
  IssueRelation,
  IssueRelationCreateInput,
  IssueRelationPayload,
  IssueHistory,
  Connection,
  PageInfo,
  PaginationArgs,
  ID,
  DateTime,
  IssuePriority,
  Team,
  WorkflowState,
  User,
  IssueLabel,
  Project,
  Cycle,
  Comment,
} from './types'

export interface IssuesResourceOptions {
  onEvent?: (type: string, action: string, data: unknown) => void
  getTeam: (id: ID) => Promise<Team>
  getUser: (id: ID) => Promise<User | null>
  getState: (id: ID) => Promise<WorkflowState | null>
  getLabel: (id: ID) => Promise<IssueLabel | null>
  getProject: (id: ID) => Promise<Project | null>
  getCycle: (id: ID) => Promise<Cycle | null>
  getComments?: (issueId: ID) => Connection<Comment>
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

const PRIORITY_LABELS: Record<IssuePriority, string> = {
  0: 'No priority',
  1: 'Urgent',
  2: 'High',
  3: 'Medium',
  4: 'Low',
}

/**
 * Local Issues Resource
 * Uses TemporalStore for state management with time-travel capabilities
 */
export class LocalIssuesResource {
  private store: TemporalStore<StoredIssue>
  private relations: Map<ID, IssueRelation> = new Map()
  private issueCounters: Map<ID, number> = new Map() // teamId -> issue number
  private onEvent?: (type: string, action: string, data: unknown) => void
  private options: IssuesResourceOptions

  constructor(options: IssuesResourceOptions) {
    this.store = createTemporalStore<StoredIssue>({
      enableTTL: false,
      retention: { maxVersions: 100 }, // Keep extensive history
    })
    this.onEvent = options.onEvent
    this.options = options
  }

  private generateId(): string {
    return crypto.randomUUID()
  }

  private getNextIssueNumber(teamId: ID): number {
    const current = this.issueCounters.get(teamId) ?? 0
    const next = current + 1
    this.issueCounters.set(teamId, next)
    return next
  }

  /**
   * Convert stored issue to full Issue type with relationships
   */
  private async hydrate(stored: StoredIssue): Promise<Issue> {
    const team = await this.options.getTeam(stored.teamId)
    const state = await this.options.getState(stored.stateId)
    const assignee = stored.assigneeId ? await this.options.getUser(stored.assigneeId) : null
    const creator = stored.creatorId ? await this.options.getUser(stored.creatorId) : null
    const parent = stored.parentId ? await this.retrieve(stored.parentId) : null
    const project = stored.projectId ? await this.options.getProject(stored.projectId) : null
    const cycle = stored.cycleId ? await this.options.getCycle(stored.cycleId) : null

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
      state: state!,
      assignee,
      creator,
      parent,
      project,
      cycle,

      // Relationship methods
      labels: async () => this.getIssueLabels(stored.id, stored.labelIds),
      children: async (args) => this.getChildren(stored.id, args),
      comments: async () => this.getComments(stored.id),
      blockedBy: async () => this.getBlockedBy(stored.id),
      blocks: async () => this.getBlocks(stored.id),
    }

    return issue
  }

  private slugify(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 50)
  }

  private async getIssueLabels(issueId: ID, labelIds: ID[]): Promise<Connection<IssueLabel>> {
    const labels: IssueLabel[] = []
    for (const id of labelIds) {
      const label = await this.options.getLabel(id)
      if (label) labels.push(label)
    }
    return {
      nodes: labels,
      pageInfo: { hasNextPage: false, hasPreviousPage: false },
    }
  }

  private async getChildren(parentId: ID, args?: IssueFilterArgs): Promise<Connection<Issue>> {
    const all = await this.listAll()
    const children = all.filter((i) => i.parentId === parentId && !i.deletedAt)

    const hydrated = await Promise.all(children.map((c) => this.hydrate(c)))
    return this.paginateResults(hydrated, args)
  }

  private async getComments(issueId: ID): Promise<Connection<Comment>> {
    // Comments are managed by the client
    if (this.options.getComments) {
      return this.options.getComments(issueId)
    }
    return {
      nodes: [],
      pageInfo: { hasNextPage: false, hasPreviousPage: false },
    }
  }

  private async getBlockedBy(issueId: ID): Promise<Connection<Issue>> {
    const blocking: Issue[] = []
    for (const relation of this.relations.values()) {
      if (relation.issue.id === issueId && relation.type === 'blocks') {
        const blocker = await this.retrieve(relation.relatedIssue.id)
        if (blocker) blocking.push(blocker)
      }
    }
    return {
      nodes: blocking,
      pageInfo: { hasNextPage: false, hasPreviousPage: false },
    }
  }

  private async getBlocks(issueId: ID): Promise<Connection<Issue>> {
    const blocked: Issue[] = []
    for (const relation of this.relations.values()) {
      if (relation.relatedIssue.id === issueId && relation.type === 'blocks') {
        const issue = await this.retrieve(relation.issue.id)
        if (issue) blocked.push(issue)
      }
    }
    return {
      nodes: blocked,
      pageInfo: { hasNextPage: false, hasPreviousPage: false },
    }
  }

  /**
   * Create a new issue
   */
  async create(input: IssueCreateInput, creatorId?: ID): Promise<IssuePayload> {
    const now = new Date().toISOString()
    const id = this.generateId()
    const team = await this.options.getTeam(input.teamId)
    const issueNumber = this.getNextIssueNumber(input.teamId)
    const identifier = `${team.key}-${issueNumber}`

    // Get default state if not provided
    let stateId = input.stateId
    if (!stateId) {
      // Use team's default state (typically Backlog or Todo)
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
      stateId: stateId,
      assigneeId: input.assigneeId ?? null,
      creatorId: creatorId ?? null,
      parentId: input.parentId ?? null,
      projectId: input.projectId ?? null,
      cycleId: input.cycleId ?? null,
      labelIds: input.labelIds ?? [],
    }

    await this.store.put(id, stored, Date.now())
    const issue = await this.hydrate(stored)

    this.emitEvent('Issue', 'create', issue)

    return {
      success: true,
      issue,
    }
  }

  /**
   * Retrieve an issue by ID
   */
  async retrieve(id: ID): Promise<Issue> {
    const stored = await this.store.get(id)
    if (!stored || stored.deletedAt) {
      throw this.createError('NotFound', `Issue not found: ${id}`)
    }
    return this.hydrate(stored)
  }

  /**
   * Retrieve issue state at a specific point in time (time-travel query)
   */
  async retrieveAsOf(id: ID, timestamp: number): Promise<Issue | null> {
    const stored = await this.store.getAsOf(id, timestamp)
    if (!stored || stored.deletedAt) {
      return null
    }
    return this.hydrate(stored)
  }

  /**
   * Get issue history (all versions)
   */
  async history(id: ID): Promise<IssueHistory[]> {
    const history: IssueHistory[] = []
    const current = await this.store.get(id)

    if (current) {
      // For now, return a simplified history
      // In production, we'd track each change with actor info
      history.push({
        id: crypto.randomUUID(),
        createdAt: current.createdAt,
        updatedAt: current.updatedAt,
        issue: await this.hydrate(current),
        changes: {},
      })
    }

    return history
  }

  /**
   * Update an issue
   */
  async update(id: ID, input: IssueUpdateInput): Promise<IssuePayload> {
    const existing = await this.store.get(id)
    if (!existing || existing.deletedAt) {
      throw this.createError('NotFound', `Issue not found: ${id}`)
    }

    const now = new Date().toISOString()

    // Track state transitions for timestamps
    let startedAt = existing.startedAt
    let completedAt = existing.completedAt
    let canceledAt = existing.canceledAt

    if (input.stateId && input.stateId !== existing.stateId) {
      const newState = await this.options.getState(input.stateId)
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

    await this.store.put(id, updated, Date.now())
    const issue = await this.hydrate(updated)

    this.emitEvent('Issue', 'update', issue)

    return {
      success: true,
      issue,
    }
  }

  /**
   * Archive an issue
   */
  async archive(id: ID): Promise<IssueArchivePayload> {
    const existing = await this.store.get(id)
    if (!existing || existing.deletedAt) {
      throw this.createError('NotFound', `Issue not found: ${id}`)
    }

    const now = new Date().toISOString()
    const updated: StoredIssue = {
      ...existing,
      updatedAt: now,
      archivedAt: now,
    }

    await this.store.put(id, updated, Date.now())
    const issue = await this.hydrate(updated)

    this.emitEvent('Issue', 'update', issue)

    return {
      success: true,
      entity: issue,
    }
  }

  /**
   * Unarchive an issue
   */
  async unarchive(id: ID): Promise<IssueArchivePayload> {
    const existing = await this.store.get(id)
    if (!existing || existing.deletedAt) {
      throw this.createError('NotFound', `Issue not found: ${id}`)
    }

    const now = new Date().toISOString()
    const updated: StoredIssue = {
      ...existing,
      updatedAt: now,
      archivedAt: null,
    }

    await this.store.put(id, updated, Date.now())
    const issue = await this.hydrate(updated)

    return {
      success: true,
      entity: issue,
    }
  }

  /**
   * Delete an issue (soft delete)
   */
  async delete(id: ID): Promise<IssueArchivePayload> {
    const existing = await this.store.get(id)
    if (!existing || existing.deletedAt) {
      throw this.createError('NotFound', `Issue not found: ${id}`)
    }

    const now = new Date().toISOString()
    const updated: StoredIssue = {
      ...existing,
      updatedAt: now,
      deletedAt: now,
    }

    await this.store.put(id, updated, Date.now())

    this.emitEvent('Issue', 'remove', { id })

    return {
      success: true,
    }
  }

  /**
   * List all stored issues (internal)
   */
  private async listAll(): Promise<StoredIssue[]> {
    const results: StoredIssue[] = []
    const iterator = this.store.range('', {})
    let result = await iterator.next()

    while (!result.done) {
      results.push(result.value)
      result = await iterator.next()
    }

    return results
  }

  /**
   * List issues with filtering and pagination
   */
  async list(args?: IssueFilterArgs): Promise<Connection<Issue>> {
    const all = await this.listAll()
    let filtered = all.filter((i) => !i.deletedAt)

    // Apply archived filter
    if (!args?.includeArchived) {
      filtered = filtered.filter((i) => !i.archivedAt)
    }

    // Apply filter
    if (args?.filter) {
      filtered = this.applyFilter(filtered, args.filter)
    }

    // Hydrate all
    const hydrated = await Promise.all(filtered.map((i) => this.hydrate(i)))

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
      // Default sort by created descending
      hydrated.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    }

    return this.paginateResults(hydrated, args)
  }

  /**
   * Search issues by text
   */
  async search(query: string, args?: IssueFilterArgs): Promise<Connection<Issue>> {
    const all = await this.listAll()
    const queryLower = query.toLowerCase()

    let filtered = all.filter(
      (i) =>
        !i.deletedAt &&
        !i.archivedAt &&
        (i.title.toLowerCase().includes(queryLower) ||
          i.description?.toLowerCase().includes(queryLower) ||
          i.identifier.toLowerCase().includes(queryLower))
    )

    const hydrated = await Promise.all(filtered.map((i) => this.hydrate(i)))
    return this.paginateResults(hydrated, args)
  }

  /**
   * Get issues by team
   */
  async listByTeam(teamId: ID, args?: IssueFilterArgs): Promise<Connection<Issue>> {
    const all = await this.listAll()
    let filtered = all.filter((i) => i.teamId === teamId && !i.deletedAt)

    if (!args?.includeArchived) {
      filtered = filtered.filter((i) => !i.archivedAt)
    }

    if (args?.filter) {
      filtered = this.applyFilter(filtered, args.filter)
    }

    const hydrated = await Promise.all(filtered.map((i) => this.hydrate(i)))
    return this.paginateResults(hydrated, args)
  }

  /**
   * Get issues by project
   */
  async listByProject(projectId: ID, args?: IssueFilterArgs): Promise<Connection<Issue>> {
    const all = await this.listAll()
    let filtered = all.filter((i) => i.projectId === projectId && !i.deletedAt)

    if (!args?.includeArchived) {
      filtered = filtered.filter((i) => !i.archivedAt)
    }

    const hydrated = await Promise.all(filtered.map((i) => this.hydrate(i)))
    return this.paginateResults(hydrated, args)
  }

  /**
   * Get issues by cycle
   */
  async listByCycle(cycleId: ID, args?: IssueFilterArgs): Promise<Connection<Issue>> {
    const all = await this.listAll()
    let filtered = all.filter((i) => i.cycleId === cycleId && !i.deletedAt)

    if (!args?.includeArchived) {
      filtered = filtered.filter((i) => !i.archivedAt)
    }

    const hydrated = await Promise.all(filtered.map((i) => this.hydrate(i)))
    return this.paginateResults(hydrated, args)
  }

  /**
   * Create issue relation
   */
  async createRelation(input: IssueRelationCreateInput): Promise<IssueRelationPayload> {
    const id = this.generateId()
    const now = new Date().toISOString()

    const issue = await this.retrieve(input.issueId)
    const relatedIssue = await this.retrieve(input.relatedIssueId)

    const relation: IssueRelation = {
      id,
      createdAt: now,
      updatedAt: now,
      type: input.type,
      issue,
      relatedIssue,
    }

    this.relations.set(id, relation)

    return {
      success: true,
      issueRelation: relation,
    }
  }

  /**
   * Delete issue relation
   */
  async deleteRelation(id: ID): Promise<IssueRelationPayload> {
    const relation = this.relations.get(id)
    if (!relation) {
      throw this.createError('NotFound', `Issue relation not found: ${id}`)
    }

    this.relations.delete(id)

    return {
      success: true,
    }
  }

  private applyFilter(issues: StoredIssue[], filter: IssueFilter): StoredIssue[] {
    return issues.filter((issue) => {
      // Priority filter
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

      // Team filter
      if (filter.team?.id?.eq && issue.teamId !== filter.team.id.eq) return false

      // Project filter
      if (filter.project) {
        if (filter.project.null === true && issue.projectId !== null) return false
        if (filter.project.null === false && issue.projectId === null) return false
        if (filter.project.id?.eq && issue.projectId !== filter.project.id.eq) return false
      }

      // Cycle filter
      if (filter.cycle) {
        if (filter.cycle.null === true && issue.cycleId !== null) return false
        if (filter.cycle.null === false && issue.cycleId === null) return false
        if (filter.cycle.id?.eq && issue.cycleId !== filter.cycle.id.eq) return false
      }

      // Assignee filter
      if (filter.assignee) {
        if (filter.assignee.null === true && issue.assigneeId !== null) return false
        if (filter.assignee.null === false && issue.assigneeId === null) return false
        if (filter.assignee.id?.eq && issue.assigneeId !== filter.assignee.id.eq) return false
      }

      // State filter
      if (filter.state?.id?.eq && issue.stateId !== filter.state.id.eq) return false

      // Title filter
      if (filter.title) {
        if (filter.title.eq && issue.title !== filter.title.eq) return false
        if (filter.title.contains && !issue.title.includes(filter.title.contains)) return false
        if (
          filter.title.containsIgnoreCase &&
          !issue.title.toLowerCase().includes(filter.title.containsIgnoreCase.toLowerCase())
        )
          return false
      }

      // AND filter
      if (filter.and) {
        for (const subFilter of filter.and) {
          if (this.applyFilter([issue], subFilter).length === 0) return false
        }
      }

      // OR filter
      if (filter.or && filter.or.length > 0) {
        let anyMatch = false
        for (const subFilter of filter.or) {
          if (this.applyFilter([issue], subFilter).length > 0) {
            anyMatch = true
            break
          }
        }
        if (!anyMatch) return false
      }

      return true
    })
  }

  private paginateResults<T extends { id: string }>(
    items: T[],
    args?: PaginationArgs
  ): Connection<T> {
    const first = args?.first ?? 50
    let startIndex = 0

    // Handle cursor pagination
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

  private emitEvent(type: string, action: string, data: unknown): void {
    if (this.onEvent) {
      this.onEvent(type, action, data)
    }
  }

  private createError(code: string, message: string): Error {
    const error = new Error(message) as Error & { code: string }
    error.code = code
    return error
  }

  /**
   * Clear all data (for testing)
   */
  async clear(): Promise<void> {
    // Create a new store
    this.store = createTemporalStore<StoredIssue>({
      enableTTL: false,
      retention: { maxVersions: 100 },
    })
    this.relations.clear()
    this.issueCounters.clear()
  }

  /**
   * Set issue counter for a team (used during team creation)
   */
  initTeamCounter(teamId: ID): void {
    if (!this.issueCounters.has(teamId)) {
      this.issueCounters.set(teamId, 0)
    }
  }
}
