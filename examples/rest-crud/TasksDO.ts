// REST CRUD Durable Object
// Demonstrates: Full RESTful API with CRUD operations, filtering, pagination, and relationships
// Key patterns: HATEOAS links, query parameters, bulk operations, proper HTTP methods/status codes

import { Hono } from 'hono'
import { DO, type DOEnv, createContext, type WorkflowContext } from '@dotdo/do'
import type {
  Task,
  Project,
  User,
  CreateTaskRequest,
  UpdateTaskRequest,
  TaskFilters,
  PaginatedResponse,
  BulkUpdateRequest,
  BulkUpdateResponse,
} from './types'

// Default pagination limit
const DEFAULT_LIMIT = 20
const MAX_LIMIT = 100

export class TasksDO extends DO {
  constructor(state: DurableObjectState, env: DOEnv) {
    super(state, env)

    // Initialize WorkflowContext for event handling
    this.$ = createContext(state, env)

    // ========================================================================
    // Event Handlers - Track entity lifecycle
    // ========================================================================

    this.$.on.Task.created(async (event) => {
      const { taskId, title } = (event as { type: string; payload: { taskId: string; title: string } }).payload
      console.log(`[Event] Task created: ${title} (${taskId})`)
    })

    this.$.on.Task.updated(async (event) => {
      const { taskId, changes } = (event as { type: string; payload: { taskId: string; changes: string[] } }).payload
      console.log(`[Event] Task updated: ${taskId}, fields: ${changes.join(', ')}`)
    })

    this.$.on.Task.deleted(async (event) => {
      const { taskId } = (event as { type: string; payload: { taskId: string } }).payload
      console.log(`[Event] Task deleted: ${taskId}`)
    })

    this.$.on.Task.completed(async (event) => {
      const { taskId, title } = (event as { type: string; payload: { taskId: string; title: string } }).payload
      console.log(`[Event] Task completed: ${title} (${taskId})`)
    })
  }

  protected routes(app: Hono): void {
    // ========================================================================
    // Tasks CRUD API
    // ========================================================================

    // LIST - Get all tasks with filtering and pagination
    app.get('/tasks', async (c) => {
      // Parse query parameters
      const limit = Math.min(
        parseInt(c.req.query('limit') || String(DEFAULT_LIMIT)),
        MAX_LIMIT
      )
      const offset = parseInt(c.req.query('offset') || '0')

      // Parse filters
      const filters: TaskFilters = {
        status: c.req.query('status') as Task['status'] | undefined,
        priority: c.req.query('priority') as Task['priority'] | undefined,
        assigneeId: c.req.query('assigneeId'),
        projectId: c.req.query('projectId'),
        tag: c.req.query('tag'),
        search: c.req.query('search'),
      }

      // Get all tasks
      const allTasks = await this.things.list({ type: 'Task' })
      let tasks = allTasks as unknown as (Task & { $id: string })[]

      // Apply filters
      if (filters.status) {
        tasks = tasks.filter((t) => t.status === filters.status)
      }
      if (filters.priority) {
        tasks = tasks.filter((t) => t.priority === filters.priority)
      }
      if (filters.assigneeId) {
        tasks = tasks.filter((t) => t.assigneeId === filters.assigneeId)
      }
      if (filters.tag) {
        tasks = tasks.filter((t) => t.tags.includes(filters.tag!))
      }
      if (filters.search) {
        const search = filters.search.toLowerCase()
        tasks = tasks.filter(
          (t) =>
            t.title.toLowerCase().includes(search) ||
            t.description?.toLowerCase().includes(search)
        )
      }

      // Get tasks for project
      if (filters.projectId) {
        const taskIds = await this.relationships.getRelated(
          filters.projectId,
          'contains'
        )
        tasks = tasks.filter((t) => taskIds.includes(t.$id))
      }

      // Sort by creation date (newest first)
      tasks.sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      )

      // Apply pagination
      const total = tasks.length
      const paginated = tasks.slice(offset, offset + limit)

      // Build HATEOAS response
      const response: PaginatedResponse<Task & { $id: string; _links: object }> = {
        data: paginated.map((task) => ({
          ...task,
          _links: {
            self: { href: `/tasks/${task.$id}` },
            update: { href: `/tasks/${task.$id}`, method: 'PATCH' },
            delete: { href: `/tasks/${task.$id}`, method: 'DELETE' },
          },
        })),
        pagination: {
          total,
          limit,
          offset,
          hasMore: offset + limit < total,
        },
      }

      // Add pagination links
      const links: Record<string, { href: string }> = {
        self: { href: `/tasks?limit=${limit}&offset=${offset}` },
      }
      if (offset > 0) {
        links.prev = { href: `/tasks?limit=${limit}&offset=${Math.max(0, offset - limit)}` }
      }
      if (offset + limit < total) {
        links.next = { href: `/tasks?limit=${limit}&offset=${offset + limit}` }
      }

      return c.json({ ...response, _links: links })
    })

    // CREATE - Create a new task
    app.post('/tasks', async (c) => {
      const body = await c.req.json<CreateTaskRequest>()

      // Validate required fields
      if (!body.title || body.title.trim() === '') {
        return c.json({ error: 'Title is required' }, 400)
      }

      // Create task
      const task = await this.things.create({
        $type: 'Task',
        title: body.title.trim(),
        description: body.description,
        status: 'pending',
        priority: body.priority || 'medium',
        dueDate: body.dueDate,
        assigneeId: body.assigneeId,
        tags: body.tags || [],
        createdAt: new Date().toISOString(),
      })

      // Create relationship if project specified
      if (body.projectId) {
        await this.relationships.add({
          subject: body.projectId,
          predicate: 'contains',
          object: task.$id,
        })
      }

      // Fire event
      this.$.send({
        type: 'Task.created',
        payload: { taskId: task.$id, title: task.title },
      })

      // Return 201 Created with Location header
      c.header('Location', `/tasks/${task.$id}`)
      return c.json(
        {
          ...task,
          _links: {
            self: { href: `/tasks/${task.$id}` },
            update: { href: `/tasks/${task.$id}`, method: 'PATCH' },
            delete: { href: `/tasks/${task.$id}`, method: 'DELETE' },
          },
        },
        201
      )
    })

    // READ - Get a single task
    app.get('/tasks/:id', async (c) => {
      const taskId = c.req.param('id')
      const task = await this.things.get(taskId)

      if (!task || task.$type !== 'Task') {
        return c.json({ error: 'Task not found' }, 404)
      }

      const taskData = task as unknown as Task & { $id: string }

      // Get related project
      const projectRels = await this.relationships.getSubjects(taskId, 'contains')
      const projectId = projectRels[0]

      return c.json({
        ...taskData,
        projectId,
        _links: {
          self: { href: `/tasks/${taskId}` },
          update: { href: `/tasks/${taskId}`, method: 'PATCH' },
          delete: { href: `/tasks/${taskId}`, method: 'DELETE' },
          collection: { href: '/tasks' },
          ...(projectId && { project: { href: `/projects/${projectId}` } }),
        },
      })
    })

    // UPDATE - Update a task (partial update)
    app.patch('/tasks/:id', async (c) => {
      const taskId = c.req.param('id')
      const body = await c.req.json<UpdateTaskRequest>()

      const existing = await this.things.get(taskId)
      if (!existing || existing.$type !== 'Task') {
        return c.json({ error: 'Task not found' }, 404)
      }

      const existingTask = existing as unknown as Task

      // Track what changed
      const changes: string[] = []
      const updates: Partial<Task> = { updatedAt: new Date().toISOString() }

      if (body.title !== undefined && body.title !== existingTask.title) {
        updates.title = body.title
        changes.push('title')
      }
      if (body.description !== undefined && body.description !== existingTask.description) {
        updates.description = body.description
        changes.push('description')
      }
      if (body.status !== undefined && body.status !== existingTask.status) {
        updates.status = body.status
        changes.push('status')

        // Track completion
        if (body.status === 'completed') {
          updates.completedAt = new Date().toISOString()
        }
      }
      if (body.priority !== undefined && body.priority !== existingTask.priority) {
        updates.priority = body.priority
        changes.push('priority')
      }
      if (body.dueDate !== undefined && body.dueDate !== existingTask.dueDate) {
        updates.dueDate = body.dueDate
        changes.push('dueDate')
      }
      if (body.assigneeId !== undefined && body.assigneeId !== existingTask.assigneeId) {
        updates.assigneeId = body.assigneeId
        changes.push('assigneeId')
      }
      if (body.tags !== undefined) {
        updates.tags = body.tags
        changes.push('tags')
      }

      // Apply updates
      const updated = await this.things.update(taskId, updates)

      // Fire events
      if (changes.length > 0) {
        this.$.send({
          type: 'Task.updated',
          payload: { taskId, changes },
        })
      }

      if (body.status === 'completed') {
        this.$.send({
          type: 'Task.completed',
          payload: { taskId, title: existingTask.title },
        })
      }

      return c.json({
        ...updated,
        _links: {
          self: { href: `/tasks/${taskId}` },
          update: { href: `/tasks/${taskId}`, method: 'PATCH' },
          delete: { href: `/tasks/${taskId}`, method: 'DELETE' },
        },
      })
    })

    // REPLACE - Full replacement of a task
    app.put('/tasks/:id', async (c) => {
      const taskId = c.req.param('id')
      const body = await c.req.json<CreateTaskRequest>()

      const existing = await this.things.get(taskId)
      if (!existing || existing.$type !== 'Task') {
        return c.json({ error: 'Task not found' }, 404)
      }

      // Validate required fields
      if (!body.title || body.title.trim() === '') {
        return c.json({ error: 'Title is required' }, 400)
      }

      const existingTask = existing as unknown as Task & { $id: string }

      // Full replacement - keep original createdAt
      const updates = {
        title: body.title.trim(),
        description: body.description,
        status: 'pending' as Task['status'],
        priority: body.priority || 'medium',
        dueDate: body.dueDate,
        assigneeId: body.assigneeId,
        tags: body.tags || [],
        updatedAt: new Date().toISOString(),
      }

      const updated = await this.things.update(taskId, updates)

      this.$.send({
        type: 'Task.updated',
        payload: { taskId, changes: ['full_replacement'] },
      })

      return c.json({
        ...updated,
        _links: {
          self: { href: `/tasks/${taskId}` },
          update: { href: `/tasks/${taskId}`, method: 'PATCH' },
          delete: { href: `/tasks/${taskId}`, method: 'DELETE' },
        },
      })
    })

    // DELETE - Delete a task
    app.delete('/tasks/:id', async (c) => {
      const taskId = c.req.param('id')

      const existing = await this.things.get(taskId)
      if (!existing || existing.$type !== 'Task') {
        return c.json({ error: 'Task not found' }, 404)
      }

      // Remove from any projects
      const projectIds = await this.relationships.getSubjects(taskId, 'contains')
      for (const projectId of projectIds) {
        await this.relationships.remove({
          subject: projectId,
          predicate: 'contains',
          object: taskId,
        })
      }

      // Delete the task
      await this.things.delete(taskId)

      this.$.send({
        type: 'Task.deleted',
        payload: { taskId },
      })

      // Return 204 No Content
      return c.body(null, 204)
    })

    // ========================================================================
    // Bulk Operations
    // ========================================================================

    // Bulk update tasks
    app.patch('/tasks', async (c) => {
      const body = await c.req.json<BulkUpdateRequest>()

      if (!body.ids || body.ids.length === 0) {
        return c.json({ error: 'No task IDs provided' }, 400)
      }

      const response: BulkUpdateResponse = {
        updated: 0,
        failed: [],
      }

      for (const taskId of body.ids) {
        try {
          const existing = await this.things.get(taskId)
          if (!existing || existing.$type !== 'Task') {
            response.failed.push(taskId)
            continue
          }

          await this.things.update(taskId, {
            ...body.update,
            updatedAt: new Date().toISOString(),
          })

          response.updated++

          this.$.send({
            type: 'Task.updated',
            payload: { taskId, changes: Object.keys(body.update) },
          })
        } catch {
          response.failed.push(taskId)
        }
      }

      return c.json(response)
    })

    // ========================================================================
    // Projects CRUD
    // ========================================================================

    app.get('/projects', async (c) => {
      const projects = await this.things.list({ type: 'Project' })

      return c.json({
        data: projects.map((p) => ({
          ...p,
          _links: {
            self: { href: `/projects/${p.$id}` },
            tasks: { href: `/projects/${p.$id}/tasks` },
          },
        })),
        _links: {
          self: { href: '/projects' },
          create: { href: '/projects', method: 'POST' },
        },
      })
    })

    app.post('/projects', async (c) => {
      const body = await c.req.json<{ name: string; description?: string; color?: string }>()

      if (!body.name || body.name.trim() === '') {
        return c.json({ error: 'Name is required' }, 400)
      }

      const project = await this.things.create({
        $type: 'Project',
        name: body.name.trim(),
        description: body.description,
        color: body.color,
        status: 'active',
        createdAt: new Date().toISOString(),
      })

      c.header('Location', `/projects/${project.$id}`)
      return c.json(project, 201)
    })

    app.get('/projects/:id', async (c) => {
      const project = await this.things.get(c.req.param('id'))

      if (!project || project.$type !== 'Project') {
        return c.json({ error: 'Project not found' }, 404)
      }

      return c.json({
        ...project,
        _links: {
          self: { href: `/projects/${project.$id}` },
          tasks: { href: `/projects/${project.$id}/tasks` },
          update: { href: `/projects/${project.$id}`, method: 'PATCH' },
          delete: { href: `/projects/${project.$id}`, method: 'DELETE' },
        },
      })
    })

    // Get tasks in a project
    app.get('/projects/:id/tasks', async (c) => {
      const projectId = c.req.param('id')

      const project = await this.things.get(projectId)
      if (!project || project.$type !== 'Project') {
        return c.json({ error: 'Project not found' }, 404)
      }

      const taskIds = await this.relationships.getRelated(projectId, 'contains')
      const tasks = await Promise.all(
        taskIds.map((id) => this.things.get(id))
      )

      return c.json({
        data: tasks.filter(Boolean),
        _links: {
          self: { href: `/projects/${projectId}/tasks` },
          project: { href: `/projects/${projectId}` },
        },
      })
    })

    // Add task to project
    app.post('/projects/:id/tasks', async (c) => {
      const projectId = c.req.param('id')

      const project = await this.things.get(projectId)
      if (!project || project.$type !== 'Project') {
        return c.json({ error: 'Project not found' }, 404)
      }

      const body = await c.req.json<CreateTaskRequest>()

      // Create task
      const task = await this.things.create({
        $type: 'Task',
        title: body.title.trim(),
        description: body.description,
        status: 'pending',
        priority: body.priority || 'medium',
        dueDate: body.dueDate,
        assigneeId: body.assigneeId,
        tags: body.tags || [],
        createdAt: new Date().toISOString(),
      })

      // Add to project
      await this.relationships.add({
        subject: projectId,
        predicate: 'contains',
        object: task.$id,
      })

      this.$.send({
        type: 'Task.created',
        payload: { taskId: task.$id, title: task.title },
      })

      c.header('Location', `/tasks/${task.$id}`)
      return c.json(task, 201)
    })

    app.delete('/projects/:id', async (c) => {
      const projectId = c.req.param('id')

      const project = await this.things.get(projectId)
      if (!project || project.$type !== 'Project') {
        return c.json({ error: 'Project not found' }, 404)
      }

      // Remove all task relationships (but keep tasks)
      const taskIds = await this.relationships.getRelated(projectId, 'contains')
      for (const taskId of taskIds) {
        await this.relationships.remove({
          subject: projectId,
          predicate: 'contains',
          object: taskId,
        })
      }

      await this.things.delete(projectId)

      return c.body(null, 204)
    })

    // ========================================================================
    // Users CRUD
    // ========================================================================

    app.get('/users', async (c) => {
      const users = await this.things.list({ type: 'User' })

      return c.json({
        data: users.map((u) => ({
          ...u,
          _links: {
            self: { href: `/users/${u.$id}` },
            tasks: { href: `/tasks?assigneeId=${u.$id}` },
          },
        })),
      })
    })

    app.post('/users', async (c) => {
      const body = await c.req.json<{ email: string; name: string; role?: User['role'] }>()

      if (!body.email || !body.name) {
        return c.json({ error: 'Email and name are required' }, 400)
      }

      // Check for duplicate email
      const existing = await this.things.list({ type: 'User' })
      const duplicate = existing.find((u) => (u as unknown as User).email === body.email)
      if (duplicate) {
        return c.json({ error: 'Email already exists' }, 409)
      }

      const user = await this.things.create({
        $type: 'User',
        email: body.email.toLowerCase(),
        name: body.name,
        role: body.role || 'member',
        createdAt: new Date().toISOString(),
      })

      c.header('Location', `/users/${user.$id}`)
      return c.json(user, 201)
    })

    app.get('/users/:id', async (c) => {
      const user = await this.things.get(c.req.param('id'))

      if (!user || user.$type !== 'User') {
        return c.json({ error: 'User not found' }, 404)
      }

      return c.json({
        ...user,
        _links: {
          self: { href: `/users/${user.$id}` },
          tasks: { href: `/tasks?assigneeId=${user.$id}` },
        },
      })
    })

    // Get tasks assigned to user
    app.get('/users/:id/tasks', async (c) => {
      const userId = c.req.param('id')

      const user = await this.things.get(userId)
      if (!user || user.$type !== 'User') {
        return c.json({ error: 'User not found' }, 404)
      }

      const allTasks = await this.things.list({ type: 'Task' })
      const userTasks = allTasks.filter(
        (t) => (t as unknown as Task).assigneeId === userId
      )

      return c.json({
        data: userTasks,
        _links: {
          self: { href: `/users/${userId}/tasks` },
          user: { href: `/users/${userId}` },
        },
      })
    })

    // ========================================================================
    // Statistics / Aggregations
    // ========================================================================

    app.get('/stats', async (c) => {
      const tasks = (await this.things.list({ type: 'Task' })) as unknown as Task[]
      const projects = await this.things.list({ type: 'Project' })
      const users = await this.things.list({ type: 'User' })

      const byStatus = {
        pending: tasks.filter((t) => t.status === 'pending').length,
        in_progress: tasks.filter((t) => t.status === 'in_progress').length,
        completed: tasks.filter((t) => t.status === 'completed').length,
        cancelled: tasks.filter((t) => t.status === 'cancelled').length,
      }

      const byPriority = {
        high: tasks.filter((t) => t.priority === 'high').length,
        medium: tasks.filter((t) => t.priority === 'medium').length,
        low: tasks.filter((t) => t.priority === 'low').length,
      }

      // Tasks due today
      const today = new Date().toISOString().split('T')[0]
      const dueToday = tasks.filter((t) => t.dueDate?.startsWith(today)).length

      // Overdue tasks
      const now = new Date()
      const overdue = tasks.filter((t) => {
        if (!t.dueDate || t.status === 'completed' || t.status === 'cancelled') {
          return false
        }
        return new Date(t.dueDate) < now
      }).length

      return c.json({
        tasks: {
          total: tasks.length,
          byStatus,
          byPriority,
          dueToday,
          overdue,
        },
        projects: {
          total: projects.length,
          active: projects.filter((p) => (p as unknown as Project).status === 'active').length,
        },
        users: {
          total: users.length,
        },
        _links: {
          tasks: { href: '/tasks' },
          projects: { href: '/projects' },
          users: { href: '/users' },
        },
      })
    })
  }
}

// Export for worker binding
export { TasksDO as DO }
