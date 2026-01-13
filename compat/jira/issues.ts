/**
 * Jira Issues Resource - Local Implementation
 *
 * Full implementation of Jira REST API v3 issues endpoints.
 * Uses TemporalStore for issue state tracking with changelog.
 */

import { createTemporalStore, type TemporalStore } from '../../db/primitives/temporal-store'
import type {
  Issue,
  IssueCreateInput,
  IssueUpdateInput,
  IssueTransitionInput,
  IssueFields,
  IssueType,
  IssuePriority,
  IssueStatus,
  IssueResolution,
  IssueComment,
  IssueWorklog,
  IssueAttachment,
  IssueChangelog,
  IssueHistory,
  IssueChangelogItem,
  IssueLink,
  IssueTransition,
  Project,
  User,
  AtlassianDocumentFormat,
  CreateIssueResponse,
  JqlSearchOptions,
  JqlSearchResult,
  StatusCategory,
  WebhookPayload,
} from './types'

export interface IssuesResourceOptions {
  onEvent?: (event: WebhookPayload) => void
  getProject: (keyOrId: string) => Promise<Project>
  getUser: (accountId: string) => Promise<User>
  getCurrentUser: () => Promise<User>
  generateIssueKey: (projectKey: string) => string
}

interface StoredIssue {
  id: string
  key: string
  projectKey: string
  projectId: string
  summary: string
  description?: AtlassianDocumentFormat | string | null
  issueTypeId: string
  issueTypeName: string
  isSubtask: boolean
  statusId: string
  statusName: string
  statusCategory: StatusCategory
  priorityId?: string
  priorityName?: string
  resolutionId?: string | null
  resolutionName?: string | null
  assigneeId?: string | null
  reporterId?: string
  creatorId?: string
  labels: string[]
  componentIds: string[]
  fixVersionIds: string[]
  parentKey?: string | null
  duedate?: string | null
  created: string
  updated: string
  resolutiondate?: string | null
  customFields: Record<string, unknown>
  // Time tracking
  originalEstimate?: string
  remainingEstimate?: string
  timeSpent?: string
  originalEstimateSeconds?: number
  remainingEstimateSeconds?: number
  timeSpentSeconds?: number
}

interface StoredComment {
  id: string
  issueKey: string
  authorId: string
  body: AtlassianDocumentFormat | string
  created: string
  updated: string
  updateAuthorId?: string
}

interface StoredWorklog {
  id: string
  issueKey: string
  authorId: string
  comment?: AtlassianDocumentFormat | string
  created: string
  updated: string
  started: string
  timeSpent: string
  timeSpentSeconds: number
}

interface StoredAttachment {
  id: string
  issueKey: string
  filename: string
  authorId: string
  created: string
  size: number
  mimeType: string
  content: string
}

interface ChangelogEntry {
  id: string
  issueKey: string
  authorId: string
  created: string
  items: IssueChangelogItem[]
}

// Default workflow transitions
const DEFAULT_TRANSITIONS: Record<string, IssueTransition[]> = {
  'To Do': [
    {
      id: '21',
      name: 'In Progress',
      to: {
        id: '3',
        name: 'In Progress',
        statusCategory: { id: 4, key: 'indeterminate', name: 'In Progress', colorName: 'yellow' },
      },
    },
    {
      id: '31',
      name: 'Done',
      to: {
        id: '4',
        name: 'Done',
        statusCategory: { id: 3, key: 'done', name: 'Done', colorName: 'green' },
      },
    },
  ],
  'In Progress': [
    {
      id: '11',
      name: 'To Do',
      to: {
        id: '1',
        name: 'To Do',
        statusCategory: { id: 2, key: 'new', name: 'To Do', colorName: 'blue-gray' },
      },
    },
    {
      id: '31',
      name: 'Done',
      to: {
        id: '4',
        name: 'Done',
        statusCategory: { id: 3, key: 'done', name: 'Done', colorName: 'green' },
      },
    },
  ],
  Done: [
    {
      id: '11',
      name: 'To Do',
      to: {
        id: '1',
        name: 'To Do',
        statusCategory: { id: 2, key: 'new', name: 'To Do', colorName: 'blue-gray' },
      },
    },
    {
      id: '21',
      name: 'In Progress',
      to: {
        id: '3',
        name: 'In Progress',
        statusCategory: { id: 4, key: 'indeterminate', name: 'In Progress', colorName: 'yellow' },
      },
    },
  ],
}

// Default issue types
const DEFAULT_ISSUE_TYPES: IssueType[] = [
  { id: '10001', name: 'Bug', description: 'A problem or defect', subtask: false, hierarchyLevel: 0 },
  { id: '10002', name: 'Task', description: 'A task to complete', subtask: false, hierarchyLevel: 0 },
  { id: '10003', name: 'Story', description: 'A user story', subtask: false, hierarchyLevel: 0 },
  { id: '10004', name: 'Epic', description: 'A large feature', subtask: false, hierarchyLevel: -1 },
  { id: '10005', name: 'Sub-task', description: 'A subtask', subtask: true, hierarchyLevel: 1 },
]

// Default priorities
const DEFAULT_PRIORITIES: IssuePriority[] = [
  { id: '1', name: 'Highest', description: 'Highest priority' },
  { id: '2', name: 'High', description: 'High priority' },
  { id: '3', name: 'Medium', description: 'Medium priority' },
  { id: '4', name: 'Low', description: 'Low priority' },
  { id: '5', name: 'Lowest', description: 'Lowest priority' },
]

// Default resolutions
const DEFAULT_RESOLUTIONS: IssueResolution[] = [
  { id: '1', name: 'Fixed', description: 'The issue has been fixed' },
  { id: '2', name: "Won't Fix", description: 'The issue will not be fixed' },
  { id: '3', name: 'Duplicate', description: 'The issue is a duplicate' },
  { id: '4', name: 'Cannot Reproduce', description: 'Cannot reproduce the issue' },
  { id: '5', name: 'Done', description: 'Work has been completed' },
]

/**
 * Local Issues Resource
 */
export class LocalIssuesResource {
  private store: TemporalStore<StoredIssue>
  private comments: Map<string, StoredComment> = new Map()
  private worklogs: Map<string, StoredWorklog> = new Map()
  private attachments: Map<string, StoredAttachment> = new Map()
  private changelog: Map<string, ChangelogEntry[]> = new Map()
  private options: IssuesResourceOptions

  constructor(options: IssuesResourceOptions) {
    this.store = createTemporalStore<StoredIssue>({
      enableTTL: false,
      retention: { maxVersions: 100 },
    })
    this.options = options
  }

  private generateId(): string {
    return crypto.randomUUID()
  }

  // ===========================================================================
  // Issue CRUD
  // ===========================================================================

  /**
   * Create a new issue
   */
  async create(input: IssueCreateInput): Promise<CreateIssueResponse> {
    const now = new Date().toISOString()
    const id = this.generateId()

    // Resolve project
    const projectRef = input.fields.project
    const project = await this.options.getProject(projectRef.key ?? projectRef.id!)

    // Generate issue key
    const key = this.options.generateIssueKey(project.key)

    // Resolve issue type
    const issueTypeRef = input.fields.issuetype
    const issueType =
      DEFAULT_ISSUE_TYPES.find(
        (t) => t.id === issueTypeRef.id || t.name === issueTypeRef.name
      ) ?? DEFAULT_ISSUE_TYPES[1]

    // Resolve priority
    const priorityRef = input.fields.priority
    const priority = priorityRef
      ? DEFAULT_PRIORITIES.find(
          (p) => p.id === priorityRef.id || p.name === priorityRef.name
        )
      : DEFAULT_PRIORITIES[2] // Default to Medium

    // Get current user as reporter/creator
    const currentUser = await this.options.getCurrentUser()

    // Parse time tracking
    const timeTracking = this.parseTimeTracking(input.fields.timetracking)

    const stored: StoredIssue = {
      id,
      key,
      projectKey: project.key,
      projectId: project.id,
      summary: input.fields.summary,
      description: input.fields.description ?? null,
      issueTypeId: issueType.id,
      issueTypeName: issueType.name,
      isSubtask: issueType.subtask,
      statusId: '1',
      statusName: 'To Do',
      statusCategory: { id: 2, key: 'new', name: 'To Do', colorName: 'blue-gray' },
      priorityId: priority?.id,
      priorityName: priority?.name,
      resolutionId: null,
      resolutionName: null,
      assigneeId: input.fields.assignee?.accountId ?? null,
      reporterId: input.fields.reporter?.accountId ?? currentUser.accountId,
      creatorId: currentUser.accountId,
      labels: input.fields.labels ?? [],
      componentIds: input.fields.components?.map((c) => c.id ?? c.name!) ?? [],
      fixVersionIds: input.fields.fixVersions?.map((v) => v.id ?? v.name!) ?? [],
      parentKey: input.fields.parent?.key ?? input.fields.parent?.id ?? null,
      duedate: input.fields.duedate ?? null,
      created: now,
      updated: now,
      resolutiondate: null,
      customFields: this.extractCustomFields(input.fields),
      ...timeTracking,
    }

    await this.store.put(key, stored, Date.now())

    // Initialize changelog
    this.changelog.set(key, [])

    // Emit webhook event
    this.emitEvent('jira:issue_created', { issue: await this.hydrate(stored) })

    return {
      id,
      key,
      self: `https://jira.atlassian.net/rest/api/3/issue/${key}`,
    }
  }

  /**
   * Get an issue by key or ID
   */
  async get(
    keyOrId: string,
    options?: { expand?: string[]; fields?: string[] }
  ): Promise<Issue> {
    const stored = await this.store.get(keyOrId) || await this.findByKey(keyOrId)
    if (!stored) {
      throw this.createError('NotFound', `Issue not found: ${keyOrId}`)
    }

    const issue = await this.hydrate(stored, options)
    return issue
  }

  /**
   * Update an issue
   */
  async update(keyOrId: string, input: IssueUpdateInput): Promise<void> {
    const stored = await this.store.get(keyOrId) || await this.findByKey(keyOrId)
    if (!stored) {
      throw this.createError('NotFound', `Issue not found: ${keyOrId}`)
    }

    const now = new Date().toISOString()
    const changelogItems: IssueChangelogItem[] = []
    const currentUser = await this.options.getCurrentUser()

    // Apply field updates
    if (input.fields) {
      if (input.fields.summary && input.fields.summary !== stored.summary) {
        changelogItems.push({
          field: 'summary',
          fieldtype: 'jira',
          fromString: stored.summary,
          toString: input.fields.summary,
        })
        stored.summary = input.fields.summary
      }

      if (input.fields.description !== undefined) {
        changelogItems.push({
          field: 'description',
          fieldtype: 'jira',
          fromString: this.descriptionToString(stored.description),
          toString: this.descriptionToString(input.fields.description),
        })
        stored.description = input.fields.description ?? null
      }

      if (input.fields.priority) {
        const priority = DEFAULT_PRIORITIES.find(
          (p) => p.id === input.fields!.priority!.id || p.name === input.fields!.priority!.name
        )
        if (priority && priority.name !== stored.priorityName) {
          changelogItems.push({
            field: 'priority',
            fieldtype: 'jira',
            from: stored.priorityId,
            fromString: stored.priorityName ?? null,
            to: priority.id,
            toString: priority.name,
          })
          stored.priorityId = priority.id
          stored.priorityName = priority.name
        }
      }

      if (input.fields.assignee !== undefined) {
        const newAssigneeId = input.fields.assignee?.accountId ?? null
        if (newAssigneeId !== stored.assigneeId) {
          const oldAssignee = stored.assigneeId
            ? await this.options.getUser(stored.assigneeId)
            : null
          const newAssignee = newAssigneeId
            ? await this.options.getUser(newAssigneeId)
            : null
          changelogItems.push({
            field: 'assignee',
            fieldtype: 'jira',
            from: stored.assigneeId ?? null,
            fromString: oldAssignee?.displayName ?? null,
            to: newAssigneeId,
            toString: newAssignee?.displayName ?? null,
          })
          stored.assigneeId = newAssigneeId
        }
      }

      if (input.fields.duedate !== undefined) {
        if (input.fields.duedate !== stored.duedate) {
          changelogItems.push({
            field: 'duedate',
            fieldtype: 'jira',
            fromString: stored.duedate ?? null,
            toString: input.fields.duedate ?? null,
          })
          stored.duedate = input.fields.duedate ?? null
        }
      }

      if (input.fields.resolution) {
        const resolution = DEFAULT_RESOLUTIONS.find(
          (r) => r.id === input.fields!.resolution!.id || r.name === input.fields!.resolution!.name
        )
        if (resolution) {
          changelogItems.push({
            field: 'resolution',
            fieldtype: 'jira',
            from: stored.resolutionId ?? null,
            fromString: stored.resolutionName ?? null,
            to: resolution.id,
            toString: resolution.name,
          })
          stored.resolutionId = resolution.id
          stored.resolutionName = resolution.name
          if (!stored.resolutiondate) {
            stored.resolutiondate = now
          }
        }
      }
    }

    // Apply update operations (add/remove/set)
    if (input.update) {
      if (input.update.labels) {
        for (const op of input.update.labels) {
          if (op.add && typeof op.add === 'string') {
            if (!stored.labels.includes(op.add)) {
              stored.labels.push(op.add)
              changelogItems.push({
                field: 'labels',
                fieldtype: 'jira',
                toString: op.add,
              })
            }
          }
          if (op.remove && typeof op.remove === 'string') {
            const idx = stored.labels.indexOf(op.remove)
            if (idx !== -1) {
              stored.labels.splice(idx, 1)
              changelogItems.push({
                field: 'labels',
                fieldtype: 'jira',
                fromString: op.remove,
              })
            }
          }
          if (op.set && Array.isArray(op.set)) {
            stored.labels = op.set as string[]
            changelogItems.push({
              field: 'labels',
              fieldtype: 'jira',
              toString: (op.set as string[]).join(' '),
            })
          }
        }
      }
    }

    // Update timestamp
    stored.updated = now

    // Store updated issue
    await this.store.put(stored.key, stored, Date.now())

    // Record changelog
    if (changelogItems.length > 0) {
      const entry: ChangelogEntry = {
        id: this.generateId(),
        issueKey: stored.key,
        authorId: currentUser.accountId,
        created: now,
        items: changelogItems,
      }
      const existing = this.changelog.get(stored.key) ?? []
      existing.push(entry)
      this.changelog.set(stored.key, existing)

      // Emit webhook event
      const issue = await this.hydrate(stored)
      this.emitEvent('jira:issue_updated', {
        issue,
        changelog: this.buildChangelog(stored.key),
      })
    }
  }

  /**
   * Delete an issue
   */
  async delete(keyOrId: string, options?: { deleteSubtasks?: boolean }): Promise<void> {
    const stored = await this.store.get(keyOrId) || await this.findByKey(keyOrId)
    if (!stored) {
      throw this.createError('NotFound', `Issue not found: ${keyOrId}`)
    }

    // Delete subtasks if requested
    if (options?.deleteSubtasks) {
      const subtasks = await this.getSubtasks(stored.key)
      for (const subtask of subtasks) {
        await this.store.delete(subtask.key)
      }
    }

    // Emit webhook event before deletion
    const issue = await this.hydrate(stored)
    this.emitEvent('jira:issue_deleted', { issue })

    // Delete the issue
    await this.store.delete(stored.key)
    this.changelog.delete(stored.key)

    // Delete comments
    for (const [id, comment] of this.comments) {
      if (comment.issueKey === stored.key) {
        this.comments.delete(id)
      }
    }
  }

  // ===========================================================================
  // Transitions
  // ===========================================================================

  /**
   * Get available transitions for an issue
   */
  async getTransitions(keyOrId: string): Promise<{ transitions: IssueTransition[] }> {
    const stored = await this.store.get(keyOrId) || await this.findByKey(keyOrId)
    if (!stored) {
      throw this.createError('NotFound', `Issue not found: ${keyOrId}`)
    }

    const transitions = DEFAULT_TRANSITIONS[stored.statusName] ?? []
    return { transitions }
  }

  /**
   * Transition an issue
   */
  async transition(keyOrId: string, input: IssueTransitionInput): Promise<void> {
    const stored = await this.store.get(keyOrId) || await this.findByKey(keyOrId)
    if (!stored) {
      throw this.createError('NotFound', `Issue not found: ${keyOrId}`)
    }

    const now = new Date().toISOString()
    const currentUser = await this.options.getCurrentUser()

    // Find the transition
    const availableTransitions = DEFAULT_TRANSITIONS[stored.statusName] ?? []
    let transition: IssueTransition | undefined

    if (input.transition.id) {
      transition = availableTransitions.find((t) => t.id === input.transition.id)
    } else if (input.transition.name) {
      transition = availableTransitions.find((t) => t.name === input.transition.name)
    }

    if (!transition) {
      throw this.createError('InvalidTransition', `Invalid transition: ${input.transition.id || input.transition.name}`)
    }

    const changelogItems: IssueChangelogItem[] = []

    // Record status change
    changelogItems.push({
      field: 'status',
      fieldtype: 'jira',
      from: stored.statusId,
      fromString: stored.statusName,
      to: transition.to.id,
      toString: transition.to.name,
    })

    // Apply the transition
    stored.statusId = transition.to.id
    stored.statusName = transition.to.name
    stored.statusCategory = transition.to.statusCategory

    // Handle resolution for Done transitions
    if (transition.to.statusCategory.key === 'done') {
      if (input.fields?.resolution) {
        const resolution = DEFAULT_RESOLUTIONS.find(
          (r) => r.id === input.fields!.resolution!.id || r.name === input.fields!.resolution!.name
        )
        if (resolution) {
          stored.resolutionId = resolution.id
          stored.resolutionName = resolution.name
          stored.resolutiondate = now
          changelogItems.push({
            field: 'resolution',
            fieldtype: 'jira',
            from: null,
            fromString: null,
            to: resolution.id,
            toString: resolution.name,
          })
        }
      } else {
        // Default resolution
        stored.resolutionId = '5'
        stored.resolutionName = 'Done'
        stored.resolutiondate = now
        changelogItems.push({
          field: 'resolution',
          fieldtype: 'jira',
          from: null,
          fromString: null,
          to: '5',
          toString: 'Done',
        })
      }
    }

    // Apply additional field updates
    if (input.fields?.assignee) {
      const oldAssigneeId = stored.assigneeId
      stored.assigneeId = input.fields.assignee.accountId
      const newAssignee = await this.options.getUser(stored.assigneeId)
      changelogItems.push({
        field: 'assignee',
        fieldtype: 'jira',
        from: oldAssigneeId ?? null,
        to: stored.assigneeId,
        toString: newAssignee?.displayName ?? null,
      })
    }

    stored.updated = now
    await this.store.put(stored.key, stored, Date.now())

    // Record changelog
    const entry: ChangelogEntry = {
      id: this.generateId(),
      issueKey: stored.key,
      authorId: currentUser.accountId,
      created: now,
      items: changelogItems,
    }
    const existing = this.changelog.get(stored.key) ?? []
    existing.push(entry)
    this.changelog.set(stored.key, existing)

    // Emit webhook
    const issue = await this.hydrate(stored)
    this.emitEvent('jira:issue_updated', {
      issue,
      changelog: this.buildChangelog(stored.key),
    })
  }

  // ===========================================================================
  // Comments
  // ===========================================================================

  /**
   * Add a comment to an issue
   */
  async addComment(
    keyOrId: string,
    input: { body: AtlassianDocumentFormat | string }
  ): Promise<IssueComment> {
    const stored = await this.store.get(keyOrId) || await this.findByKey(keyOrId)
    if (!stored) {
      throw this.createError('NotFound', `Issue not found: ${keyOrId}`)
    }

    const now = new Date().toISOString()
    const currentUser = await this.options.getCurrentUser()
    const id = this.generateId()

    const comment: StoredComment = {
      id,
      issueKey: stored.key,
      authorId: currentUser.accountId,
      body: input.body,
      created: now,
      updated: now,
    }

    this.comments.set(id, comment)

    // Emit webhook
    this.emitEvent('comment_created', {
      issue: await this.hydrate(stored),
      comment: await this.hydrateComment(comment),
    })

    return this.hydrateComment(comment)
  }

  /**
   * Get comments for an issue
   */
  async getComments(keyOrId: string): Promise<{
    comments: IssueComment[]
    total: number
    maxResults: number
    startAt: number
  }> {
    const stored = await this.store.get(keyOrId) || await this.findByKey(keyOrId)
    if (!stored) {
      throw this.createError('NotFound', `Issue not found: ${keyOrId}`)
    }

    const comments: IssueComment[] = []
    for (const [, c] of this.comments) {
      if (c.issueKey === stored.key) {
        comments.push(await this.hydrateComment(c))
      }
    }

    comments.sort((a, b) => new Date(a.created).getTime() - new Date(b.created).getTime())

    return {
      comments,
      total: comments.length,
      maxResults: 50,
      startAt: 0,
    }
  }

  /**
   * Update a comment
   */
  async updateComment(
    issueKeyOrId: string,
    commentId: string,
    input: { body: AtlassianDocumentFormat | string }
  ): Promise<IssueComment> {
    const comment = this.comments.get(commentId)
    if (!comment) {
      throw this.createError('NotFound', `Comment not found: ${commentId}`)
    }

    const now = new Date().toISOString()
    const currentUser = await this.options.getCurrentUser()

    comment.body = input.body
    comment.updated = now
    comment.updateAuthorId = currentUser.accountId

    this.comments.set(commentId, comment)

    return this.hydrateComment(comment)
  }

  /**
   * Delete a comment
   */
  async deleteComment(issueKeyOrId: string, commentId: string): Promise<void> {
    if (!this.comments.has(commentId)) {
      throw this.createError('NotFound', `Comment not found: ${commentId}`)
    }

    this.comments.delete(commentId)
  }

  // ===========================================================================
  // Search
  // ===========================================================================

  /**
   * Search issues using JQL
   */
  async search(options: JqlSearchOptions): Promise<JqlSearchResult> {
    const all = await this.listAll()
    let filtered = [...all]

    // Parse and apply JQL
    if (options.jql) {
      filtered = this.applyJql(filtered, options.jql)
    }

    // Apply pagination
    const startAt = options.startAt ?? 0
    const maxResults = options.maxResults ?? 50
    const total = filtered.length
    const page = filtered.slice(startAt, startAt + maxResults)

    // Hydrate issues
    const issues = await Promise.all(page.map((s) => this.hydrate(s, { fields: options.fields })))

    return {
      startAt,
      maxResults,
      total,
      issues,
    }
  }

  // ===========================================================================
  // Internal Helpers
  // ===========================================================================

  private async findByKey(key: string): Promise<StoredIssue | null> {
    const all = await this.listAll()
    return all.find((i) => i.key === key || i.id === key) ?? null
  }

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

  private async getSubtasks(parentKey: string): Promise<StoredIssue[]> {
    const all = await this.listAll()
    return all.filter((i) => i.parentKey === parentKey)
  }

  private async hydrate(
    stored: StoredIssue,
    options?: { expand?: string[]; fields?: string[] }
  ): Promise<Issue> {
    const project = await this.options.getProject(stored.projectKey)
    const assignee = stored.assigneeId ? await this.options.getUser(stored.assigneeId) : null
    const reporter = stored.reporterId ? await this.options.getUser(stored.reporterId) : null
    const creator = stored.creatorId ? await this.options.getUser(stored.creatorId) : null

    const issueType: IssueType = {
      id: stored.issueTypeId,
      name: stored.issueTypeName,
      subtask: stored.isSubtask,
    }

    const status: IssueStatus = {
      id: stored.statusId,
      name: stored.statusName,
      statusCategory: stored.statusCategory,
    }

    const priority: IssuePriority | undefined = stored.priorityId
      ? { id: stored.priorityId, name: stored.priorityName! }
      : undefined

    const resolution: IssueResolution | null = stored.resolutionId
      ? { id: stored.resolutionId, name: stored.resolutionName! }
      : null

    // Get subtasks
    const subtasks = await this.getSubtasks(stored.key)
    const subtaskRefs = subtasks.map((s) => ({
      id: s.id,
      key: s.key,
      fields: {
        summary: s.summary,
        status: {
          id: s.statusId,
          name: s.statusName,
          statusCategory: s.statusCategory,
        },
        issuetype: {
          id: s.issueTypeId,
          name: s.issueTypeName,
          subtask: s.isSubtask,
        },
      },
    }))

    // Get parent if this is a subtask
    let parent: Issue['fields']['parent'] | undefined
    if (stored.parentKey) {
      const parentIssue = await this.findByKey(stored.parentKey)
      if (parentIssue) {
        parent = {
          id: parentIssue.id,
          key: parentIssue.key,
          fields: {
            summary: parentIssue.summary,
            status: {
              id: parentIssue.statusId,
              name: parentIssue.statusName,
              statusCategory: parentIssue.statusCategory,
            },
            issuetype: {
              id: parentIssue.issueTypeId,
              name: parentIssue.issueTypeName,
              subtask: parentIssue.isSubtask,
            },
          },
        }
      }
    }

    const issue: Issue = {
      id: stored.id,
      key: stored.key,
      self: `https://jira.atlassian.net/rest/api/3/issue/${stored.key}`,
      fields: {
        summary: stored.summary,
        description: stored.description,
        issuetype: issueType,
        project: {
          id: project.id,
          key: project.key,
          name: project.name,
        },
        status,
        priority,
        resolution,
        assignee,
        reporter: reporter ?? undefined,
        creator: creator ?? undefined,
        labels: stored.labels,
        duedate: stored.duedate,
        created: stored.created,
        updated: stored.updated,
        resolutiondate: stored.resolutiondate,
        parent,
        subtasks: subtaskRefs,
        timetracking: stored.originalEstimate
          ? {
              originalEstimate: stored.originalEstimate,
              remainingEstimate: stored.remainingEstimate,
              timeSpent: stored.timeSpent,
              originalEstimateSeconds: stored.originalEstimateSeconds,
              remainingEstimateSeconds: stored.remainingEstimateSeconds,
              timeSpentSeconds: stored.timeSpentSeconds,
            }
          : undefined,
        // Custom fields
        ...stored.customFields,
      },
    }

    // Expand changelog if requested
    if (options?.expand?.includes('changelog')) {
      issue.changelog = this.buildChangelog(stored.key)
    }

    // Expand transitions if requested
    if (options?.expand?.includes('transitions')) {
      const { transitions } = await this.getTransitions(stored.key)
      issue.transitions = transitions
    }

    return issue
  }

  private async hydrateComment(stored: StoredComment): Promise<IssueComment> {
    const author = await this.options.getUser(stored.authorId)
    const updateAuthor = stored.updateAuthorId
      ? await this.options.getUser(stored.updateAuthorId)
      : undefined

    return {
      id: stored.id,
      author,
      body: stored.body,
      created: stored.created,
      updated: stored.updated,
      updateAuthor,
    }
  }

  private buildChangelog(issueKey: string): IssueChangelog {
    const entries = this.changelog.get(issueKey) ?? []
    const histories: IssueHistory[] = entries.map((e) => ({
      id: e.id,
      author: { accountId: e.authorId, displayName: 'User', active: true },
      created: e.created,
      items: e.items,
    }))

    return {
      startAt: 0,
      maxResults: histories.length,
      total: histories.length,
      histories,
    }
  }

  private applyJql(issues: StoredIssue[], jql: string): StoredIssue[] {
    // Simple JQL parser
    const conditions = this.parseJql(jql)

    return issues.filter((issue) => {
      for (const condition of conditions) {
        if (!this.matchCondition(issue, condition)) {
          return false
        }
      }
      return true
    })
  }

  private parseJql(jql: string): Array<{ field: string; operator: string; value: string }> {
    const conditions: Array<{ field: string; operator: string; value: string }> = []

    // Remove ORDER BY clause
    const orderByIndex = jql.toUpperCase().indexOf('ORDER BY')
    const queryPart = orderByIndex >= 0 ? jql.substring(0, orderByIndex) : jql

    // Split by AND/OR (simplified - treats OR as AND for now)
    const parts = queryPart.split(/\s+AND\s+|\s+OR\s+/i)

    for (const part of parts) {
      // Match patterns like: field = "value", field ~ "value", field = value
      const match = part.trim().match(/(\w+)\s*(=|~|!=|IN)\s*(?:"([^"]+)"|'([^']+)'|(\S+))/i)
      if (match) {
        conditions.push({
          field: match[1].toLowerCase(),
          operator: match[2].toLowerCase(),
          value: match[3] ?? match[4] ?? match[5],
        })
      }
    }

    return conditions
  }

  private matchCondition(
    issue: StoredIssue,
    condition: { field: string; operator: string; value: string }
  ): boolean {
    const { field, operator, value } = condition

    switch (field) {
      case 'project':
        return issue.projectKey === value
      case 'issuetype':
        return issue.issueTypeName.toLowerCase() === value.toLowerCase()
      case 'status':
        return issue.statusName.toLowerCase() === value.toLowerCase()
      case 'priority':
        return issue.priorityName?.toLowerCase() === value.toLowerCase()
      case 'labels':
        return issue.labels.some((l) => l.toLowerCase() === value.toLowerCase())
      case 'statuscategory':
        return issue.statusCategory.name.toLowerCase() === value.toLowerCase().replace(/"/g, '')
      case 'summary':
        if (operator === '~') {
          return issue.summary.toLowerCase().includes(value.toLowerCase())
        }
        return issue.summary === value
      default:
        return true
    }
  }

  private extractCustomFields(fields: IssueCreateInput['fields']): Record<string, unknown> {
    const custom: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(fields)) {
      if (key.startsWith('customfield_')) {
        custom[key] = value
      }
    }
    return custom
  }

  private parseTimeTracking(
    input?: { originalEstimate?: string; remainingEstimate?: string }
  ): Partial<StoredIssue> {
    if (!input) return {}

    const parseToSeconds = (estimate: string): number => {
      let total = 0
      const weeks = estimate.match(/(\d+)w/)
      const days = estimate.match(/(\d+)d/)
      const hours = estimate.match(/(\d+)h/)
      const minutes = estimate.match(/(\d+)m/)

      if (weeks) total += parseInt(weeks[1]) * 5 * 8 * 60 * 60
      if (days) total += parseInt(days[1]) * 8 * 60 * 60
      if (hours) total += parseInt(hours[1]) * 60 * 60
      if (minutes) total += parseInt(minutes[1]) * 60

      return total
    }

    return {
      originalEstimate: input.originalEstimate,
      remainingEstimate: input.remainingEstimate ?? input.originalEstimate,
      originalEstimateSeconds: input.originalEstimate
        ? parseToSeconds(input.originalEstimate)
        : undefined,
      remainingEstimateSeconds: input.remainingEstimate
        ? parseToSeconds(input.remainingEstimate)
        : input.originalEstimate
          ? parseToSeconds(input.originalEstimate)
          : undefined,
    }
  }

  private descriptionToString(
    desc: AtlassianDocumentFormat | string | null | undefined
  ): string | null {
    if (!desc) return null
    if (typeof desc === 'string') return desc
    // Convert ADF to simple string representation
    return JSON.stringify(desc)
  }

  private emitEvent(eventType: string, data: Partial<WebhookPayload>): void {
    if (this.options.onEvent) {
      this.options.onEvent({
        webhookEvent: eventType as WebhookPayload['webhookEvent'],
        timestamp: Date.now(),
        ...data,
      } as WebhookPayload)
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
    this.store = createTemporalStore<StoredIssue>({
      enableTTL: false,
      retention: { maxVersions: 100 },
    })
    this.comments.clear()
    this.worklogs.clear()
    this.attachments.clear()
    this.changelog.clear()
  }
}
