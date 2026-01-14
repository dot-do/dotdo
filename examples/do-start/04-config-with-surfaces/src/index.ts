/**
 * Config with Surfaces Example - Entry Point
 *
 * Demonstrates how the entryPoint in do.config.ts defines
 * the backend Durable Objects shared across all surfaces.
 */

import { DO } from 'dotdo'

// ============================================================================
// Counter Durable Object
// ============================================================================

/**
 * Simple counter with increment/decrement operations.
 * Automatically exposed as REST endpoints.
 */
export class Counter extends DO {
  static readonly $type = 'Counter'

  async getValue() {
    const counter = await this.things.get({ $type: 'CounterState' })
    return { value: counter?.value ?? 0 }
  }

  async increment(amount: number = 1) {
    const counter = await this.things.get({ $type: 'CounterState' })
    const currentValue = counter?.value ?? 0
    const newValue = currentValue + amount

    if (counter) {
      await this.things.update(counter.$id, { value: newValue })
    } else {
      await this.things.create({ $type: 'CounterState', value: newValue })
    }

    await this.events.emit('Counter.incremented', { from: currentValue, to: newValue, amount })
    return { value: newValue }
  }

  async decrement(amount: number = 1) {
    return this.increment(-amount)
  }

  async reset() {
    const counter = await this.things.get({ $type: 'CounterState' })
    if (counter) {
      await this.things.update(counter.$id, { value: 0 })
    }
    await this.events.emit('Counter.reset', { previousValue: counter?.value ?? 0 })
    return { value: 0 }
  }
}

// ============================================================================
// Workspace Durable Object
// ============================================================================

/**
 * Workspace manages projects, tasks, and team members.
 * Shows a more complex DO with multiple entity types.
 */
export class Workspace extends DO {
  static readonly $type = 'Workspace'

  // ─────────────────────────────────────────────────────────────────────────
  // Projects
  // ─────────────────────────────────────────────────────────────────────────

  async createProject(name: string, description?: string) {
    const project = await this.things.create({
      $type: 'Project',
      name,
      description: description ?? '',
      status: 'active',
      createdAt: new Date().toISOString(),
    })
    await this.events.emit('Project.created', { projectId: project.$id, name })
    return project
  }

  async listProjects(status?: string) {
    const filter: Record<string, unknown> = { $type: 'Project' }
    if (status) filter.status = status
    return this.things.list(filter)
  }

  async getProject(id: string) {
    return this.things.get(id)
  }

  async updateProject(id: string, updates: { name?: string; description?: string; status?: string }) {
    return this.things.update(id, updates)
  }

  async archiveProject(id: string) {
    const project = await this.things.update(id, { status: 'archived', archivedAt: new Date().toISOString() })
    await this.events.emit('Project.archived', { projectId: id })
    return project
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Tasks
  // ─────────────────────────────────────────────────────────────────────────

  async createTask(projectId: string, title: string, assignee?: string) {
    const task = await this.things.create({
      $type: 'Task',
      projectId,
      title,
      assignee,
      status: 'todo',
      createdAt: new Date().toISOString(),
    })
    await this.events.emit('Task.created', { taskId: task.$id, projectId, title })
    return task
  }

  async listTasks(projectId?: string) {
    const filter: Record<string, unknown> = { $type: 'Task' }
    if (projectId) filter.projectId = projectId
    return this.things.list(filter)
  }

  async completeTask(id: string) {
    const task = await this.things.update(id, { status: 'done', completedAt: new Date().toISOString() })
    await this.events.emit('Task.completed', { taskId: id })
    return task
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Team Members
  // ─────────────────────────────────────────────────────────────────────────

  async addMember(name: string, email: string, role: string = 'member') {
    const member = await this.things.create({
      $type: 'Member',
      name,
      email,
      role,
      joinedAt: new Date().toISOString(),
    })
    await this.events.emit('Member.added', { memberId: member.$id, email, role })
    return member
  }

  async listMembers() {
    return this.things.list({ $type: 'Member' })
  }

  async updateMemberRole(id: string, role: string) {
    return this.things.update(id, { role })
  }
}
