/**
 * Todo App CRUD Tests - Real Durable Object Instances
 *
 * Tests the complete CRUD lifecycle for todos using real miniflare instances.
 * NO MOCKS - per CLAUDE.md policy, all tests run against real DO with SQLite.
 *
 * @module apps/todo-app/tests/todo-crud.test
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface Todo {
  id: string
  title: string
  completed: boolean
  createdAt: number
  updatedAt: number
}

interface TodoListResponse {
  data: Todo[]
  total: number
}

interface DeleteResponse {
  deleted: boolean
  id: string
}

interface ErrorResponse {
  error: string
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Generate a unique test identifier to isolate test data between tests
 */
function generateTestId(): string {
  return `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Get a fresh DO stub for testing
 */
function getTestStub() {
  const testName = generateTestId()
  const id = env.TODO_DO.idFromName(testName)
  return env.TODO_DO.get(id)
}

/**
 * Make a request to the TodoDO
 */
async function doRequest<T>(
  stub: DurableObjectStub,
  method: string,
  path: string,
  body?: Record<string, unknown>
): Promise<{ status: number; data: T }> {
  const init: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json' },
  }
  if (body) {
    init.body = JSON.stringify(body)
  }
  const response = await stub.fetch(`http://internal${path}`, init)
  const data = (await response.json()) as T
  return { status: response.status, data }
}

// ============================================================================
// TEST SUITES
// ============================================================================

describe('TodoDO CRUD Operations', () => {
  describe('Health Check', () => {
    it('responds to GET / with health status', async () => {
      const stub = getTestStub()

      const response = await stub.fetch('http://internal/')
      expect(response.status).toBe(200)

      const json = (await response.json()) as { status: string; id: string; type: string }
      expect(json.status).toBe('ok')
      expect(json.type).toBe('TodoDO')
      expect(json.id).toBeDefined()
    })
  })

  describe('Create Todo (POST /todos)', () => {
    it('creates a todo with valid title', async () => {
      const stub = getTestStub()

      const { status, data } = await doRequest<Todo>(stub, 'POST', '/todos', {
        title: 'Buy groceries',
      })

      expect(status).toBe(201)
      expect(data.id).toBeDefined()
      expect(data.title).toBe('Buy groceries')
      expect(data.completed).toBe(false)
      expect(data.createdAt).toBeDefined()
      expect(data.updatedAt).toBeDefined()
      expect(data.createdAt).toBe(data.updatedAt)
    })

    it('trims whitespace from title', async () => {
      const stub = getTestStub()

      const { status, data } = await doRequest<Todo>(stub, 'POST', '/todos', {
        title: '  Walk the dog  ',
      })

      expect(status).toBe(201)
      expect(data.title).toBe('Walk the dog')
    })

    it('rejects empty title', async () => {
      const stub = getTestStub()

      const { status, data } = await doRequest<ErrorResponse>(stub, 'POST', '/todos', {
        title: '',
      })

      expect(status).toBe(400)
      expect(data.error).toContain('required')
    })

    it('rejects whitespace-only title', async () => {
      const stub = getTestStub()

      const { status, data } = await doRequest<ErrorResponse>(stub, 'POST', '/todos', {
        title: '   ',
      })

      expect(status).toBe(400)
      expect(data.error).toContain('required')
    })

    it('rejects missing title', async () => {
      const stub = getTestStub()

      const { status, data } = await doRequest<ErrorResponse>(stub, 'POST', '/todos', {})

      expect(status).toBe(400)
      expect(data.error).toContain('required')
    })

    it('generates unique IDs for different todos', async () => {
      const stub = getTestStub()

      const { data: todo1 } = await doRequest<Todo>(stub, 'POST', '/todos', {
        title: 'First todo',
      })
      const { data: todo2 } = await doRequest<Todo>(stub, 'POST', '/todos', {
        title: 'Second todo',
      })

      expect(todo1.id).not.toBe(todo2.id)
    })
  })

  describe('List Todos (GET /todos)', () => {
    it('returns empty list when no todos exist', async () => {
      const stub = getTestStub()

      const { status, data } = await doRequest<TodoListResponse>(stub, 'GET', '/todos')

      expect(status).toBe(200)
      expect(data.data).toEqual([])
      expect(data.total).toBe(0)
    })

    it('returns all created todos', async () => {
      const stub = getTestStub()

      // Create some todos
      await doRequest(stub, 'POST', '/todos', { title: 'Todo 1' })
      await doRequest(stub, 'POST', '/todos', { title: 'Todo 2' })
      await doRequest(stub, 'POST', '/todos', { title: 'Todo 3' })

      const { status, data } = await doRequest<TodoListResponse>(stub, 'GET', '/todos')

      expect(status).toBe(200)
      expect(data.data).toHaveLength(3)
      expect(data.total).toBe(3)
    })

    it('returns todos in descending order by creation time', async () => {
      const stub = getTestStub()

      // Create todos with small delays to ensure different timestamps
      await doRequest(stub, 'POST', '/todos', { title: 'First' })
      await new Promise((r) => setTimeout(r, 10))
      await doRequest(stub, 'POST', '/todos', { title: 'Second' })
      await new Promise((r) => setTimeout(r, 10))
      await doRequest(stub, 'POST', '/todos', { title: 'Third' })

      const { data } = await doRequest<TodoListResponse>(stub, 'GET', '/todos')

      // Most recent first
      expect(data.data[0].title).toBe('Third')
      expect(data.data[1].title).toBe('Second')
      expect(data.data[2].title).toBe('First')
    })
  })

  describe('Get Single Todo (GET /todos/:id)', () => {
    it('returns a todo by ID', async () => {
      const stub = getTestStub()

      const { data: created } = await doRequest<Todo>(stub, 'POST', '/todos', {
        title: 'Find me',
      })

      const { status, data } = await doRequest<Todo>(stub, 'GET', `/todos/${created.id}`)

      expect(status).toBe(200)
      expect(data.id).toBe(created.id)
      expect(data.title).toBe('Find me')
      expect(data.completed).toBe(false)
    })

    it('returns 404 for non-existent todo', async () => {
      const stub = getTestStub()

      const { status, data } = await doRequest<ErrorResponse>(stub, 'GET', '/todos/non-existent-id')

      expect(status).toBe(404)
      expect(data.error).toContain('not found')
    })
  })

  describe('Update Todo (PATCH /todos/:id)', () => {
    it('updates todo title', async () => {
      const stub = getTestStub()

      const { data: created } = await doRequest<Todo>(stub, 'POST', '/todos', {
        title: 'Original title',
      })

      const { status, data } = await doRequest<Todo>(stub, 'PATCH', `/todos/${created.id}`, {
        title: 'Updated title',
      })

      expect(status).toBe(200)
      expect(data.id).toBe(created.id)
      expect(data.title).toBe('Updated title')
      expect(data.updatedAt).toBeGreaterThanOrEqual(data.createdAt)
    })

    it('updates todo completion status', async () => {
      const stub = getTestStub()

      const { data: created } = await doRequest<Todo>(stub, 'POST', '/todos', {
        title: 'Complete me',
      })

      expect(created.completed).toBe(false)

      const { status, data } = await doRequest<Todo>(stub, 'PATCH', `/todos/${created.id}`, {
        completed: true,
      })

      expect(status).toBe(200)
      expect(data.completed).toBe(true)
    })

    it('updates both title and completion status', async () => {
      const stub = getTestStub()

      const { data: created } = await doRequest<Todo>(stub, 'POST', '/todos', {
        title: 'Original',
      })

      const { status, data } = await doRequest<Todo>(stub, 'PATCH', `/todos/${created.id}`, {
        title: 'New title',
        completed: true,
      })

      expect(status).toBe(200)
      expect(data.title).toBe('New title')
      expect(data.completed).toBe(true)
    })

    it('trims whitespace from updated title', async () => {
      const stub = getTestStub()

      const { data: created } = await doRequest<Todo>(stub, 'POST', '/todos', {
        title: 'Original',
      })

      const { data } = await doRequest<Todo>(stub, 'PATCH', `/todos/${created.id}`, {
        title: '  Trimmed title  ',
      })

      expect(data.title).toBe('Trimmed title')
    })

    it('rejects empty title update', async () => {
      const stub = getTestStub()

      const { data: created } = await doRequest<Todo>(stub, 'POST', '/todos', {
        title: 'Original',
      })

      const { status, data } = await doRequest<ErrorResponse>(stub, 'PATCH', `/todos/${created.id}`, {
        title: '',
      })

      expect(status).toBe(400)
      expect(data.error).toContain('empty')
    })

    it('returns 404 for non-existent todo', async () => {
      const stub = getTestStub()

      const { status, data } = await doRequest<ErrorResponse>(stub, 'PATCH', '/todos/non-existent', {
        title: 'Updated',
      })

      expect(status).toBe(404)
      expect(data.error).toContain('not found')
    })

    it('updates updatedAt timestamp', async () => {
      const stub = getTestStub()

      const { data: created } = await doRequest<Todo>(stub, 'POST', '/todos', {
        title: 'Original',
      })

      // Small delay to ensure different timestamp
      await new Promise((r) => setTimeout(r, 10))

      const { data } = await doRequest<Todo>(stub, 'PATCH', `/todos/${created.id}`, {
        title: 'Updated',
      })

      expect(data.updatedAt).toBeGreaterThan(created.updatedAt)
      expect(data.createdAt).toBe(created.createdAt)
    })
  })

  describe('Delete Todo (DELETE /todos/:id)', () => {
    it('deletes a todo by ID', async () => {
      const stub = getTestStub()

      const { data: created } = await doRequest<Todo>(stub, 'POST', '/todos', {
        title: 'Delete me',
      })

      const { status, data } = await doRequest<DeleteResponse>(stub, 'DELETE', `/todos/${created.id}`)

      expect(status).toBe(200)
      expect(data.deleted).toBe(true)
      expect(data.id).toBe(created.id)

      // Verify it's gone
      const { status: getStatus } = await doRequest<ErrorResponse>(stub, 'GET', `/todos/${created.id}`)
      expect(getStatus).toBe(404)
    })

    it('returns 404 for non-existent todo', async () => {
      const stub = getTestStub()

      const { status, data } = await doRequest<ErrorResponse>(stub, 'DELETE', '/todos/non-existent')

      expect(status).toBe(404)
      expect(data.error).toContain('not found')
    })

    it('removes todo from list', async () => {
      const stub = getTestStub()

      // Create multiple todos
      const { data: todo1 } = await doRequest<Todo>(stub, 'POST', '/todos', { title: 'Keep 1' })
      const { data: todo2 } = await doRequest<Todo>(stub, 'POST', '/todos', { title: 'Delete' })
      const { data: todo3 } = await doRequest<Todo>(stub, 'POST', '/todos', { title: 'Keep 2' })

      // Delete one
      await doRequest(stub, 'DELETE', `/todos/${todo2.id}`)

      // Verify list
      const { data: list } = await doRequest<TodoListResponse>(stub, 'GET', '/todos')
      expect(list.total).toBe(2)
      expect(list.data.find((t) => t.id === todo1.id)).toBeDefined()
      expect(list.data.find((t) => t.id === todo2.id)).toBeUndefined()
      expect(list.data.find((t) => t.id === todo3.id)).toBeDefined()
    })
  })

  describe('Toggle Todo (POST /todos/:id/toggle)', () => {
    it('toggles incomplete todo to complete', async () => {
      const stub = getTestStub()

      const { data: created } = await doRequest<Todo>(stub, 'POST', '/todos', {
        title: 'Toggle me',
      })

      expect(created.completed).toBe(false)

      const { status, data } = await doRequest<Todo>(stub, 'POST', `/todos/${created.id}/toggle`)

      expect(status).toBe(200)
      expect(data.completed).toBe(true)
    })

    it('toggles complete todo to incomplete', async () => {
      const stub = getTestStub()

      const { data: created } = await doRequest<Todo>(stub, 'POST', '/todos', {
        title: 'Toggle back',
      })

      // Mark as complete
      await doRequest(stub, 'PATCH', `/todos/${created.id}`, { completed: true })

      // Toggle back
      const { status, data } = await doRequest<Todo>(stub, 'POST', `/todos/${created.id}/toggle`)

      expect(status).toBe(200)
      expect(data.completed).toBe(false)
    })

    it('returns 404 for non-existent todo', async () => {
      const stub = getTestStub()

      const { status, data } = await doRequest<ErrorResponse>(stub, 'POST', '/todos/non-existent/toggle')

      expect(status).toBe(404)
      expect(data.error).toContain('not found')
    })

    it('updates updatedAt timestamp on toggle', async () => {
      const stub = getTestStub()

      const { data: created } = await doRequest<Todo>(stub, 'POST', '/todos', {
        title: 'Toggle timestamp',
      })

      // Small delay
      await new Promise((r) => setTimeout(r, 10))

      const { data } = await doRequest<Todo>(stub, 'POST', `/todos/${created.id}/toggle`)

      expect(data.updatedAt).toBeGreaterThan(created.updatedAt)
    })
  })

  describe('Data Isolation', () => {
    it('isolates data between different DO instances', async () => {
      // Create two separate DO instances (simulating different users)
      const id1 = env.TODO_DO.idFromName('user-alice-' + generateTestId())
      const id2 = env.TODO_DO.idFromName('user-bob-' + generateTestId())

      const stub1 = env.TODO_DO.get(id1)
      const stub2 = env.TODO_DO.get(id2)

      // Create todos in each
      await doRequest(stub1, 'POST', '/todos', { title: "Alice's todo" })
      await doRequest(stub2, 'POST', '/todos', { title: "Bob's todo 1" })
      await doRequest(stub2, 'POST', '/todos', { title: "Bob's todo 2" })

      // Verify isolation
      const { data: aliceTodos } = await doRequest<TodoListResponse>(stub1, 'GET', '/todos')
      const { data: bobTodos } = await doRequest<TodoListResponse>(stub2, 'GET', '/todos')

      expect(aliceTodos.total).toBe(1)
      expect(aliceTodos.data[0].title).toBe("Alice's todo")

      expect(bobTodos.total).toBe(2)
      expect(bobTodos.data.map((t) => t.title)).toContain("Bob's todo 1")
      expect(bobTodos.data.map((t) => t.title)).toContain("Bob's todo 2")
    })
  })

  describe('Concurrent Operations', () => {
    it('handles concurrent todo creation', async () => {
      const stub = getTestStub()

      // Create multiple todos concurrently
      const createPromises = Array.from({ length: 5 }, (_, i) =>
        doRequest<Todo>(stub, 'POST', '/todos', { title: `Concurrent ${i}` })
      )

      const results = await Promise.all(createPromises)

      // All should succeed with unique IDs
      const ids = results.map((r) => r.data.id)
      expect(new Set(ids).size).toBe(5)

      // Verify all are in the list
      const { data: list } = await doRequest<TodoListResponse>(stub, 'GET', '/todos')
      expect(list.total).toBe(5)
    })

    it('handles concurrent reads and writes', async () => {
      const stub = getTestStub()

      // Create initial todos
      const { data: todo } = await doRequest<Todo>(stub, 'POST', '/todos', {
        title: 'Concurrent target',
      })

      // Mix of concurrent operations
      const operations = [
        doRequest(stub, 'GET', '/todos'),
        doRequest(stub, 'POST', '/todos', { title: 'New during read' }),
        doRequest<Todo>(stub, 'PATCH', `/todos/${todo.id}`, { title: 'Updated concurrently' }),
        doRequest(stub, 'GET', '/todos'),
        doRequest(stub, 'POST', `/todos/${todo.id}/toggle`),
      ]

      const results = await Promise.all(operations)

      // All operations should succeed (no 500 errors)
      for (const result of results) {
        expect(result.status).toBeLessThan(500)
      }
    })
  })
})
