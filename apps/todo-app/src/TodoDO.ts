/**
 * Todo Durable Object
 *
 * Demonstrates:
 * - SQLite storage via DO state
 * - CRUD operations with typed entities
 * - Hono routing inside DO
 * - Schema migrations
 */

import { Hono } from 'hono'

// ============================================================================
// Types
// ============================================================================

export interface Todo {
  id: string
  title: string
  completed: boolean
  createdAt: number
  updatedAt: number
}

type SqlStorageValue = string | number | null | ArrayBuffer

type TodoRow = {
  id: string
  title: string
  completed: number // SQLite uses 0/1 for booleans
  created_at: number
  updated_at: number
} & Record<string, SqlStorageValue>

// ============================================================================
// Durable Object
// ============================================================================

export class TodoDO implements DurableObject {
  private state: DurableObjectState
  private app: Hono
  private sql: SqlStorage
  private initialized = false

  constructor(state: DurableObjectState, _env: unknown) {
    this.state = state
    this.sql = state.storage.sql
    this.app = new Hono()
    this.setupRoutes()
  }

  // Initialize the database schema
  private async initialize(): Promise<void> {
    if (this.initialized) return

    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS todos (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        completed INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `)

    this.initialized = true
  }

  // Generate a unique ID
  private generateId(): string {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  }

  // Convert row to Todo
  private rowToTodo(row: TodoRow): Todo {
    return {
      id: row.id,
      title: row.title,
      completed: row.completed === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  // Setup Hono routes
  private setupRoutes(): void {
    // Health check
    this.app.get('/', (c) =>
      c.json({
        status: 'ok',
        id: this.state.id.toString(),
        type: 'TodoDO',
      })
    )

    // List all todos
    this.app.get('/todos', async (c) => {
      await this.initialize()

      const cursor = this.sql.exec<TodoRow>(
        'SELECT id, title, completed, created_at, updated_at FROM todos ORDER BY created_at DESC'
      )
      const rows = [...cursor]
      const todos = rows.map((row) => this.rowToTodo(row))

      return c.json({
        data: todos,
        total: todos.length,
      })
    })

    // Create todo
    this.app.post('/todos', async (c) => {
      await this.initialize()

      const body = await c.req.json<{ title: string }>()

      if (!body.title?.trim()) {
        return c.json({ error: 'Title is required' }, 400)
      }

      const id = this.generateId()
      const now = Date.now()

      this.sql.exec(
        'INSERT INTO todos (id, title, completed, created_at, updated_at) VALUES (?, ?, 0, ?, ?)',
        id,
        body.title.trim(),
        now,
        now
      )

      const todo: Todo = {
        id,
        title: body.title.trim(),
        completed: false,
        createdAt: now,
        updatedAt: now,
      }

      return c.json(todo, 201)
    })

    // Get single todo
    this.app.get('/todos/:id', async (c) => {
      await this.initialize()

      const id = c.req.param('id')
      const cursor = this.sql.exec<TodoRow>(
        'SELECT id, title, completed, created_at, updated_at FROM todos WHERE id = ?',
        id
      )
      const rows = [...cursor]

      if (rows.length === 0) {
        return c.json({ error: 'Todo not found' }, 404)
      }

      return c.json(this.rowToTodo(rows[0]))
    })

    // Update todo
    this.app.patch('/todos/:id', async (c) => {
      await this.initialize()

      const id = c.req.param('id')
      const body = await c.req.json<{ title?: string; completed?: boolean }>()

      // Check if todo exists
      const existing = this.sql.exec<TodoRow>(
        'SELECT id, title, completed, created_at, updated_at FROM todos WHERE id = ?',
        id
      )
      const rows = [...existing]

      if (rows.length === 0) {
        return c.json({ error: 'Todo not found' }, 404)
      }

      const current = this.rowToTodo(rows[0])
      const now = Date.now()

      // Build update
      const updates: string[] = ['updated_at = ?']
      const values: (string | number)[] = [now]

      if (body.title !== undefined) {
        if (!body.title.trim()) {
          return c.json({ error: 'Title cannot be empty' }, 400)
        }
        updates.push('title = ?')
        values.push(body.title.trim())
      }

      if (body.completed !== undefined) {
        updates.push('completed = ?')
        values.push(body.completed ? 1 : 0)
      }

      values.push(id)

      this.sql.exec(`UPDATE todos SET ${updates.join(', ')} WHERE id = ?`, ...values)

      // Return updated todo
      const updated: Todo = {
        ...current,
        title: body.title?.trim() ?? current.title,
        completed: body.completed ?? current.completed,
        updatedAt: now,
      }

      return c.json(updated)
    })

    // Delete todo
    this.app.delete('/todos/:id', async (c) => {
      await this.initialize()

      const id = c.req.param('id')

      // Check if todo exists
      const existing = this.sql.exec<{ id: string }>('SELECT id FROM todos WHERE id = ?', id)
      const rows = [...existing]

      if (rows.length === 0) {
        return c.json({ error: 'Todo not found' }, 404)
      }

      this.sql.exec('DELETE FROM todos WHERE id = ?', id)

      return c.json({ deleted: true, id })
    })

    // Toggle todo completion
    this.app.post('/todos/:id/toggle', async (c) => {
      await this.initialize()

      const id = c.req.param('id')

      // Check if todo exists
      const existing = this.sql.exec<TodoRow>(
        'SELECT id, title, completed, created_at, updated_at FROM todos WHERE id = ?',
        id
      )
      const rows = [...existing]

      if (rows.length === 0) {
        return c.json({ error: 'Todo not found' }, 404)
      }

      const current = this.rowToTodo(rows[0])
      const now = Date.now()
      const newCompleted = !current.completed

      this.sql.exec('UPDATE todos SET completed = ?, updated_at = ? WHERE id = ?', newCompleted ? 1 : 0, now, id)

      return c.json({
        ...current,
        completed: newCompleted,
        updatedAt: now,
      })
    })
  }

  async fetch(request: Request): Promise<Response> {
    return this.app.fetch(request)
  }
}
