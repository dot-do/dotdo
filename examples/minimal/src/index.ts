/**
 * dotdo Minimal Example
 *
 * Demonstrates core features:
 * - Durable Object with SQLite storage
 * - CRUD operations via Hono routes
 * - RPC methods called from worker
 */
import { DurableObject } from 'cloudflare:workers'
import { Hono } from 'hono'

// ============================================================================
// Types
// ============================================================================

interface Env {
  TASK_DO: DurableObjectNamespace<TaskDO>
}

interface Task {
  id: string
  title: string
  completed: boolean
  createdAt: string
}

// ============================================================================
// TaskDO - A simple Durable Object with SQLite storage
// ============================================================================

export class TaskDO extends DurableObject<Env> {
  private app: Hono

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)

    // Initialize SQLite table
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        completed INTEGER DEFAULT 0,
        created_at TEXT NOT NULL
      )
    `)

    // Set up Hono router
    this.app = new Hono()
    this.registerRoutes()
  }

  private registerRoutes(): void {
    // List all tasks
    this.app.get('/tasks', (c) => {
      const tasks = this.listTasks()
      return c.json({ tasks })
    })

    // Create a task
    this.app.post('/tasks', async (c) => {
      const body = await c.req.json<{ title: string }>()
      const task = this.createTask(body.title)
      return c.json(task, 201)
    })

    // Get a single task
    this.app.get('/tasks/:id', (c) => {
      const task = this.getTask(c.req.param('id'))
      if (!task) {
        return c.json({ error: 'Task not found' }, 404)
      }
      return c.json(task)
    })

    // Toggle task completion
    this.app.patch('/tasks/:id/toggle', (c) => {
      const task = this.toggleTask(c.req.param('id'))
      if (!task) {
        return c.json({ error: 'Task not found' }, 404)
      }
      return c.json(task)
    })

    // Delete a task
    this.app.delete('/tasks/:id', (c) => {
      const deleted = this.deleteTask(c.req.param('id'))
      return c.json({ deleted })
    })
  }

  // Handle HTTP requests
  async fetch(request: Request): Promise<Response> {
    return this.app.fetch(request)
  }

  // =========================================================================
  // RPC Methods - Can be called directly via stub
  // =========================================================================

  createTask(title: string): Task {
    const id = crypto.randomUUID().slice(0, 8)
    const now = new Date().toISOString()

    this.ctx.storage.sql.exec(
      'INSERT INTO tasks (id, title, completed, created_at) VALUES (?, ?, 0, ?)',
      id,
      title,
      now
    )

    return { id, title, completed: false, createdAt: now }
  }

  listTasks(): Task[] {
    const rows = this.ctx.storage.sql
      .exec('SELECT * FROM tasks ORDER BY created_at DESC')
      .toArray()

    return rows.map((row) => ({
      id: row.id as string,
      title: row.title as string,
      completed: Boolean(row.completed),
      createdAt: row.created_at as string,
    }))
  }

  getTask(id: string): Task | null {
    const rows = this.ctx.storage.sql
      .exec('SELECT * FROM tasks WHERE id = ?', id)
      .toArray()

    if (rows.length === 0) return null

    const row = rows[0]
    return {
      id: row.id as string,
      title: row.title as string,
      completed: Boolean(row.completed),
      createdAt: row.created_at as string,
    }
  }

  toggleTask(id: string): Task | null {
    const task = this.getTask(id)
    if (!task) return null

    const newCompleted = !task.completed
    this.ctx.storage.sql.exec(
      'UPDATE tasks SET completed = ? WHERE id = ?',
      newCompleted ? 1 : 0,
      id
    )

    return { ...task, completed: newCompleted }
  }

  deleteTask(id: string): boolean {
    this.ctx.storage.sql.exec('DELETE FROM tasks WHERE id = ?', id)
    return true
  }

  // Simple RPC ping
  ping(): string {
    return 'pong'
  }
}

// ============================================================================
// Worker Entry Point
// ============================================================================

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    // Route to TaskDO - use path prefix or default namespace
    const id = env.TASK_DO.idFromName('default')
    const stub = env.TASK_DO.get(id)

    // Example of calling RPC method directly
    if (url.pathname === '/rpc/ping') {
      const result = await stub.ping()
      return new Response(JSON.stringify({ result }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Example of calling RPC method with arguments
    if (url.pathname === '/rpc/create' && request.method === 'POST') {
      const body = await request.json() as { title: string }
      const task = await stub.createTask(body.title)
      return new Response(JSON.stringify(task), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Pass through to DO's Hono router
    return stub.fetch(request)
  },
}
