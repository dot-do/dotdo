/**
 * Basic REST API Example
 *
 * The simplest possible dotdo application - just an App.tsx file.
 * No configuration needed. Run with: do start
 *
 * This demonstrates:
 * - Zero-config pattern (no wrangler.jsonc, no do.config.ts)
 * - Basic DO with REST endpoints
 * - Automatic SQLite storage
 */

import { DO } from 'dotdo'

/**
 * A simple task tracker Durable Object
 */
export class Tasks extends DO {
  static readonly $type = 'Tasks'

  /**
   * Create a new task
   */
  async createTask(title: string, description?: string) {
    const task = await this.things.create({
      $type: 'Task',
      title,
      description: description ?? '',
      completed: false,
      createdAt: new Date().toISOString(),
    })
    return task
  }

  /**
   * List all tasks
   */
  async listTasks() {
    return this.things.list({ $type: 'Task' })
  }

  /**
   * Mark a task as completed
   */
  async completeTask(id: string) {
    const task = await this.things.get(id)
    if (!task) throw new Error('Task not found')

    return this.things.update(id, {
      completed: true,
      completedAt: new Date().toISOString(),
    })
  }

  /**
   * Delete a task
   */
  async deleteTask(id: string) {
    return this.things.delete(id)
  }
}

/**
 * App component - rendered at /
 */
export default function App() {
  return (
    <div style={{ maxWidth: '800px', margin: '0 auto', padding: '2rem' }}>
      <h1>Task Tracker</h1>
      <p>A simple REST API for managing tasks.</p>

      <h2>API Endpoints</h2>
      <ul>
        <li>
          <code>GET /Tasks/</code> - List all task namespaces
        </li>
        <li>
          <code>GET /Tasks/:id</code> - Get a specific task tracker
        </li>
        <li>
          <code>POST /Tasks/:id/createTask</code> - Create a new task
        </li>
        <li>
          <code>POST /Tasks/:id/completeTask</code> - Mark task as complete
        </li>
        <li>
          <code>DELETE /Tasks/:id/Task/:taskId</code> - Delete a task
        </li>
      </ul>

      <h2>Example Usage</h2>
      <pre style={{ background: '#f5f5f5', padding: '1rem', borderRadius: '4px' }}>
        {`# Create a task
curl -X POST http://localhost:4000/Tasks/my-list/createTask \\
  -H "Content-Type: application/json" \\
  -d '{"title": "Buy groceries", "description": "Milk, eggs, bread"}'

# List tasks
curl http://localhost:4000/Tasks/my-list

# Complete a task
curl -X POST http://localhost:4000/Tasks/my-list/completeTask \\
  -H "Content-Type: application/json" \\
  -d '{"id": "task-id-here"}'`}
      </pre>
    </div>
  )
}
