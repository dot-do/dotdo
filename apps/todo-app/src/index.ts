/**
 * Todo App Example
 *
 * A simple CRUD todo list demonstrating dotdo capabilities:
 * - Durable Object for stateful todo storage
 * - Hono for routing
 * - SQLite storage via DO state
 * - RPC pattern for DO communication
 */

import { Hono } from 'hono'
import { cors } from 'hono/cors'

// Re-export the Durable Object class
export { TodoDO } from './TodoDO'

// Types
interface Env {
  TODO_DO: DurableObjectNamespace
}

// Main worker
const app = new Hono<{ Bindings: Env }>()

// Middleware
app.use('/*', cors())

// Health check
app.get('/', (c) =>
  c.json({
    name: 'Todo App',
    version: '1.0.0',
    description: 'Simple CRUD todo list using dotdo patterns',
    endpoints: {
      'GET /todos': 'List all todos',
      'POST /todos': 'Create a todo',
      'GET /todos/:id': 'Get a todo by ID',
      'PATCH /todos/:id': 'Update a todo',
      'DELETE /todos/:id': 'Delete a todo',
      'POST /todos/:id/toggle': 'Toggle todo completion',
    },
  })
)

// Get the TodoDO stub (using user ID or default)
function getTodoDO(c: { env: Env; req: { header: (name: string) => string | undefined } }) {
  // Use user ID from header if provided, otherwise use 'default'
  const userId = c.req.header('X-User-ID') || 'default'
  const id = c.env.TODO_DO.idFromName(userId)
  return c.env.TODO_DO.get(id)
}

// List todos
app.get('/todos', async (c) => {
  const stub = getTodoDO(c)
  const response = await stub.fetch(new Request('http://internal/todos'))
  return response
})

// Create todo
app.post('/todos', async (c) => {
  const stub = getTodoDO(c)
  const body = await c.req.json()

  const response = await stub.fetch(
    new Request('http://internal/todos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  )

  return response
})

// Get single todo
app.get('/todos/:id', async (c) => {
  const stub = getTodoDO(c)
  const id = c.req.param('id')

  const response = await stub.fetch(new Request(`http://internal/todos/${id}`))
  return response
})

// Update todo
app.patch('/todos/:id', async (c) => {
  const stub = getTodoDO(c)
  const id = c.req.param('id')
  const body = await c.req.json()

  const response = await stub.fetch(
    new Request(`http://internal/todos/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  )

  return response
})

// Delete todo
app.delete('/todos/:id', async (c) => {
  const stub = getTodoDO(c)
  const id = c.req.param('id')

  const response = await stub.fetch(
    new Request(`http://internal/todos/${id}`, {
      method: 'DELETE',
    })
  )

  return response
})

// Toggle todo completion
app.post('/todos/:id/toggle', async (c) => {
  const stub = getTodoDO(c)
  const id = c.req.param('id')

  const response = await stub.fetch(
    new Request(`http://internal/todos/${id}/toggle`, {
      method: 'POST',
    })
  )

  return response
})

export default app
