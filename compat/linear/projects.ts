/**
 * Linear Projects Resource - Local Implementation
 *
 * Uses TemporalStore for project state tracking.
 * Supports full project lifecycle: create, update, archive, delete.
 * Includes project milestones and updates.
 */

import { createTemporalStore, type TemporalStore } from '../../db/primitives/temporal-store'
import type {
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
  Connection,
  PageInfo,
  ID,
  DateTime,
  ProjectState,
  Team,
  User,
  Issue,
  IssueFilterArgs,
  SuccessPayload,
} from './types'

export interface ProjectsResourceOptions {
  onEvent?: (type: string, action: string, data: unknown) => void
  getTeam: (id: ID) => Promise<Team>
  getUser: (id: ID) => Promise<User | null>
  getProjectIssues: (projectId: ID, args?: IssueFilterArgs) => Promise<Connection<Issue>>
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

/**
 * Local Projects Resource
 */
export class LocalProjectsResource {
  private store: TemporalStore<StoredProject>
  private milestones: Map<ID, StoredMilestone> = new Map()
  private updates: Map<ID, StoredProjectUpdate> = new Map()
  private onEvent?: (type: string, action: string, data: unknown) => void
  private options: ProjectsResourceOptions

  constructor(options: ProjectsResourceOptions) {
    this.store = createTemporalStore<StoredProject>({
      enableTTL: false,
      retention: { maxVersions: 50 },
    })
    this.onEvent = options.onEvent
    this.options = options
  }

  private generateId(): string {
    return crypto.randomUUID()
  }

  private generateSlugId(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 50)
  }

  /**
   * Convert stored project to full Project type
   */
  private async hydrate(stored: StoredProject): Promise<Project> {
    const creator = stored.creatorId ? await this.options.getUser(stored.creatorId) : null
    const lead = stored.leadId ? await this.options.getUser(stored.leadId) : null

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
      creator,
      lead,

      // Relationship methods
      teams: async () => this.getProjectTeams(stored.teamIds),
      members: async () => this.getProjectMembers(stored.memberIds),
      issues: async (args) => this.options.getProjectIssues(stored.id, args),
      projectMilestones: async () => this.getProjectMilestones(stored.id),
      projectUpdates: async () => this.getProjectUpdates(stored.id),
    }

    return project
  }

  private async getProjectTeams(teamIds: ID[]): Promise<Connection<Team>> {
    const teams: Team[] = []
    for (const id of teamIds) {
      const team = await this.options.getTeam(id)
      if (team) teams.push(team)
    }
    return {
      nodes: teams,
      pageInfo: { hasNextPage: false, hasPreviousPage: false },
    }
  }

  private async getProjectMembers(memberIds: ID[]): Promise<Connection<User>> {
    const users: User[] = []
    for (const id of memberIds) {
      const user = await this.options.getUser(id)
      if (user) users.push(user)
    }
    return {
      nodes: users,
      pageInfo: { hasNextPage: false, hasPreviousPage: false },
    }
  }

  private async getProjectMilestones(projectId: ID): Promise<Connection<ProjectMilestone>> {
    const milestones: ProjectMilestone[] = []

    for (const stored of this.milestones.values()) {
      if (stored.projectId === projectId && !stored.archivedAt) {
        const milestone = await this.hydrateMilestone(stored)
        milestones.push(milestone)
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

    for (const stored of this.updates.values()) {
      if (stored.projectId === projectId) {
        const update = await this.hydrateUpdate(stored)
        updates.push(update)
      }
    }

    updates.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

    return {
      nodes: updates,
      pageInfo: { hasNextPage: false, hasPreviousPage: false },
    }
  }

  private async hydrateMilestone(stored: StoredMilestone): Promise<ProjectMilestone> {
    const project = await this.retrieve(stored.projectId)

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

  private async hydrateUpdate(stored: StoredProjectUpdate): Promise<ProjectUpdate> {
    const project = await this.retrieve(stored.projectId)
    const user = await this.options.getUser(stored.userId)

    return {
      id: stored.id,
      createdAt: stored.createdAt,
      updatedAt: stored.updatedAt,
      body: stored.body,
      health: stored.health,
      project,
      user: user!,
      editedAt: stored.editedAt,
    }
  }

  /**
   * Create a new project
   */
  async create(input: ProjectCreateInput, creatorId?: ID): Promise<ProjectPayload> {
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
      slugId: this.generateSlugId(input.name),
      progress: 0,
      startDate: input.startDate ?? null,
      targetDate: input.targetDate ?? null,
      startedAt: input.state === 'started' ? now : null,
      completedAt: null,
      canceledAt: null,
      sortOrder: input.sortOrder ?? Date.now(),
      teamIds: input.teamIds,
      memberIds: input.memberIds ?? [],
      creatorId: creatorId ?? null,
      leadId: input.leadId ?? null,
    }

    await this.store.put(id, stored, Date.now())
    const project = await this.hydrate(stored)

    this.emitEvent('Project', 'create', project)

    return {
      success: true,
      project,
    }
  }

  /**
   * Retrieve a project by ID
   */
  async retrieve(id: ID): Promise<Project> {
    const stored = await this.store.get(id)
    if (!stored || stored.deletedAt) {
      throw this.createError('NotFound', `Project not found: ${id}`)
    }
    return this.hydrate(stored)
  }

  /**
   * Update a project
   */
  async update(id: ID, input: ProjectUpdateInput): Promise<ProjectPayload> {
    const existing = await this.store.get(id)
    if (!existing || existing.deletedAt) {
      throw this.createError('NotFound', `Project not found: ${id}`)
    }

    const now = new Date().toISOString()

    // Track state transitions
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

    await this.store.put(id, updated, Date.now())
    const project = await this.hydrate(updated)

    this.emitEvent('Project', 'update', project)

    return {
      success: true,
      project,
    }
  }

  /**
   * Archive a project
   */
  async archive(id: ID): Promise<ProjectPayload> {
    const existing = await this.store.get(id)
    if (!existing || existing.deletedAt) {
      throw this.createError('NotFound', `Project not found: ${id}`)
    }

    const now = new Date().toISOString()
    const updated: StoredProject = {
      ...existing,
      updatedAt: now,
      archivedAt: now,
    }

    await this.store.put(id, updated, Date.now())
    const project = await this.hydrate(updated)

    this.emitEvent('Project', 'update', project)

    return {
      success: true,
      project,
    }
  }

  /**
   * Delete a project (soft delete)
   */
  async delete(id: ID): Promise<SuccessPayload> {
    const existing = await this.store.get(id)
    if (!existing || existing.deletedAt) {
      throw this.createError('NotFound', `Project not found: ${id}`)
    }

    const now = new Date().toISOString()
    const updated: StoredProject = {
      ...existing,
      updatedAt: now,
      deletedAt: now,
    }

    await this.store.put(id, updated, Date.now())

    this.emitEvent('Project', 'remove', { id })

    return {
      success: true,
    }
  }

  /**
   * List all stored projects (internal)
   */
  private async listAll(): Promise<StoredProject[]> {
    const results: StoredProject[] = []
    const iterator = this.store.range('', {})
    let result = await iterator.next()

    while (!result.done) {
      results.push(result.value)
      result = await iterator.next()
    }

    return results
  }

  /**
   * List projects with filtering and pagination
   */
  async list(args?: ProjectFilterArgs): Promise<Connection<Project>> {
    const all = await this.listAll()
    let filtered = all.filter((p) => !p.deletedAt)

    if (!args?.includeArchived) {
      filtered = filtered.filter((p) => !p.archivedAt)
    }

    if (args?.filter) {
      filtered = this.applyFilter(filtered, args.filter)
    }

    const hydrated = await Promise.all(filtered.map((p) => this.hydrate(p)))

    // Apply ordering
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

  /**
   * Search projects by text
   */
  async search(query: string, args?: ProjectFilterArgs): Promise<Connection<Project>> {
    const all = await this.listAll()
    const queryLower = query.toLowerCase()

    let filtered = all.filter(
      (p) =>
        !p.deletedAt &&
        !p.archivedAt &&
        (p.name.toLowerCase().includes(queryLower) ||
          p.description?.toLowerCase().includes(queryLower))
    )

    const hydrated = await Promise.all(filtered.map((p) => this.hydrate(p)))
    return this.paginateResults(hydrated, args)
  }

  /**
   * Get projects by team
   */
  async listByTeam(teamId: ID, args?: ProjectFilterArgs): Promise<Connection<Project>> {
    const all = await this.listAll()
    let filtered = all.filter((p) => p.teamIds.includes(teamId) && !p.deletedAt)

    if (!args?.includeArchived) {
      filtered = filtered.filter((p) => !p.archivedAt)
    }

    const hydrated = await Promise.all(filtered.map((p) => this.hydrate(p)))
    return this.paginateResults(hydrated, args)
  }

  // ===========================================================================
  // Project Milestones
  // ===========================================================================

  /**
   * Create a project milestone
   */
  async createMilestone(input: ProjectMilestoneCreateInput): Promise<ProjectMilestonePayload> {
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

    this.milestones.set(id, stored)
    const milestone = await this.hydrateMilestone(stored)

    return {
      success: true,
      projectMilestone: milestone,
    }
  }

  /**
   * Update a project milestone
   */
  async updateMilestone(id: ID, input: ProjectMilestoneUpdateInput): Promise<ProjectMilestonePayload> {
    const existing = this.milestones.get(id)
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

    this.milestones.set(id, updated)
    const milestone = await this.hydrateMilestone(updated)

    return {
      success: true,
      projectMilestone: milestone,
    }
  }

  /**
   * Delete a project milestone
   */
  async deleteMilestone(id: ID): Promise<SuccessPayload> {
    if (!this.milestones.has(id)) {
      throw this.createError('NotFound', `Project milestone not found: ${id}`)
    }

    this.milestones.delete(id)

    return {
      success: true,
    }
  }

  // ===========================================================================
  // Project Updates
  // ===========================================================================

  /**
   * Create a project update
   */
  async createUpdate(input: ProjectUpdateCreateInput, userId: ID): Promise<ProjectUpdatePayload> {
    const now = new Date().toISOString()
    const id = this.generateId()

    const stored: StoredProjectUpdate = {
      id,
      createdAt: now,
      updatedAt: now,
      body: input.body,
      health: input.health ?? 'onTrack',
      projectId: input.projectId,
      userId,
      editedAt: null,
    }

    this.updates.set(id, stored)
    const update = await this.hydrateUpdate(stored)

    this.emitEvent('ProjectUpdate', 'create', update)

    return {
      success: true,
      projectUpdate: update,
    }
  }

  /**
   * Get a project update
   */
  async getUpdate(id: ID): Promise<ProjectUpdate> {
    const stored = this.updates.get(id)
    if (!stored) {
      throw this.createError('NotFound', `Project update not found: ${id}`)
    }
    return this.hydrateUpdate(stored)
  }

  /**
   * Update progress for a project (based on issue completion)
   */
  async updateProgress(id: ID, progress: number): Promise<void> {
    const existing = await this.store.get(id)
    if (!existing || existing.deletedAt) {
      return
    }

    const updated: StoredProject = {
      ...existing,
      progress: Math.min(100, Math.max(0, progress)),
    }

    await this.store.put(id, updated, Date.now())
  }

  private applyFilter(projects: StoredProject[], filter: ProjectFilter): StoredProject[] {
    return projects.filter((project) => {
      // Name filter
      if (filter.name) {
        if (filter.name.eq && project.name !== filter.name.eq) return false
        if (filter.name.contains && !project.name.includes(filter.name.contains)) return false
      }

      // State filter
      if (filter.state) {
        if (filter.state.eq && project.state !== filter.state.eq) return false
        if (filter.state.in && !filter.state.in.includes(project.state)) return false
      }

      // AND filter
      if (filter.and) {
        for (const subFilter of filter.and) {
          if (this.applyFilter([project], subFilter).length === 0) return false
        }
      }

      // OR filter
      if (filter.or && filter.or.length > 0) {
        let anyMatch = false
        for (const subFilter of filter.or) {
          if (this.applyFilter([project], subFilter).length > 0) {
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
    args?: ProjectFilterArgs
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
    this.store = createTemporalStore<StoredProject>({
      enableTTL: false,
      retention: { maxVersions: 50 },
    })
    this.milestones.clear()
    this.updates.clear()
  }
}
