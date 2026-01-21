/**
 * Integration tests for DO + digital-tasks (do-zr1u.8)
 *
 * Tests that verify the Durable Object task management integrates properly
 * with the digital-tasks primitive from primitives/packages/digital-tasks.
 *
 * digital-tasks provides:
 * - Task = Function + metadata (status, progress, assignment, dependencies)
 * - Task lifecycle: pending -> queued -> assigned -> in_progress -> completed/failed
 * - Projects with parallel/sequential task execution modes
 * - Dependencies and dependency tracking
 *
 * These tests verify:
 * 1. DO can store and manage digital-tasks via Things store
 * 2. Task status transitions emit appropriate events
 * 3. Task dependencies are properly tracked via Relationships
 * 4. Project materialization creates proper task hierarchies
 * 5. Task lifecycle events are recorded in Events store
 *
 * Following TDD - these tests are written to FAIL first, driving implementation.
 *
 * @module do/tests/digital-tasks-integration.test
 */

import { describe, it, expect } from 'vitest'
import { env } from 'cloudflare:test'
import type { Thing, Event, Relationship } from '@dotdo/db'

// Import digital-tasks types for type checking (not runtime - TDD style)
import type {
  Task,
  TaskStatus,
  TaskPriority,
  TaskProgress,
  WorkerRef,
  Project,
  TaskDefinition,
} from 'digital-tasks'

// ============================================================================
// TEST HELPER: Get DO stub with real SQLite storage
// ============================================================================

function getTestDO(name: string = 'digital-tasks-test-' + Date.now()) {
  const id = env.DO.idFromName(name)
  return env.DO.get(id)
}

// ============================================================================
// Helper: Make RPC request to DO
// ============================================================================

async function rpc(stub: DurableObjectStub, method: string, args: unknown[] = []) {
  const response = await stub.fetch('https://do/rpc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, args }),
  })
  return response
}

// ============================================================================
// TESTS: DO + digital-tasks Integration
// ============================================================================

describe('DO + digital-tasks Integration (do-zr1u.8)', () => {
  describe('Task Storage via Things', () => {
    it('should store a Task as a Thing with $type Task', async () => {
      const stub = getTestDO()

      // Create a task-like Thing with digital-tasks structure
      const taskData = {
        $type: 'Task',
        status: 'pending' as TaskStatus,
        priority: 'normal' as TaskPriority,
        function: {
          type: 'generative',
          name: 'summarize',
          description: 'Summarize the given text',
          args: { text: 'string' },
          output: 'string',
        },
        input: { text: 'Long article...' },
        allowedWorkers: ['agent', 'human'],
        tags: ['ai', 'content'],
      }

      const response = await rpc(stub, 'things.create', [taskData])
      expect(response.status).toBe(200)

      const task = (await response.json()) as Thing
      expect(task.$id).toBeDefined()
      expect(task.$type).toBe('Task')
      expect(task.status).toBe('pending')
      expect(task.priority).toBe('normal')
      expect(task.function).toBeDefined()
      expect((task as any).function.name).toBe('summarize')
    })

    it('should retrieve a Task by ID', async () => {
      const stub = getTestDO()

      // Create
      const createRes = await rpc(stub, 'things.create', [
        {
          $type: 'Task',
          status: 'queued',
          priority: 'high',
          function: { type: 'code', name: 'buildReport' },
        },
      ])
      const created = (await createRes.json()) as Thing

      // Get
      const getRes = await rpc(stub, 'things.get', [created.$id])
      expect(getRes.status).toBe(200)

      const retrieved = (await getRes.json()) as Thing
      expect(retrieved.$id).toBe(created.$id)
      expect(retrieved.status).toBe('queued')
      expect(retrieved.priority).toBe('high')
    })

    it('should list Tasks by type', async () => {
      const stub = getTestDO()

      // Create multiple tasks and other things
      await rpc(stub, 'things.create', [
        { $type: 'Task', status: 'pending', function: { name: 'task1' } },
      ])
      await rpc(stub, 'things.create', [
        { $type: 'Task', status: 'completed', function: { name: 'task2' } },
      ])
      await rpc(stub, 'things.create', [{ $type: 'Customer', name: 'Alice' }])

      // List only Tasks
      const response = await rpc(stub, 'things.list', [{ type: 'Task' }])
      expect(response.status).toBe(200)

      const tasks = (await response.json()) as Thing[]
      expect(tasks.length).toBe(2)
      expect(tasks.every((t) => t.$type === 'Task')).toBe(true)
    })

    it('should filter Tasks by status', async () => {
      const stub = getTestDO()

      // Create tasks with different statuses
      await rpc(stub, 'things.create', [
        { $type: 'Task', status: 'pending', function: { name: 'pending-task' } },
      ])
      await rpc(stub, 'things.create', [
        { $type: 'Task', status: 'in_progress', function: { name: 'progress-task' } },
      ])
      await rpc(stub, 'things.create', [
        { $type: 'Task', status: 'completed', function: { name: 'done-task' } },
      ])

      // Query pending tasks using where clause
      const response = await rpc(stub, 'things.list', [
        { type: 'Task', where: { status: 'pending' } },
      ])
      expect(response.status).toBe(200)

      const pendingTasks = (await response.json()) as Thing[]
      expect(pendingTasks.length).toBe(1)
      expect(pendingTasks[0].status).toBe('pending')
    })
  })

  describe('Task Status Transitions', () => {
    it('should update Task status from pending to queued', async () => {
      const stub = getTestDO()

      // Create pending task
      const createRes = await rpc(stub, 'things.create', [
        { $type: 'Task', status: 'pending', function: { name: 'test-task' } },
      ])
      const created = (await createRes.json()) as Thing

      // Update to queued
      const updateRes = await rpc(stub, 'things.update', [created.$id, { status: 'queued' }])
      expect(updateRes.status).toBe(200)

      const updated = (await updateRes.json()) as Thing
      expect(updated.status).toBe('queued')
    })

    it('should update Task status from queued to in_progress with assignment', async () => {
      const stub = getTestDO()

      // Create queued task
      const createRes = await rpc(stub, 'things.create', [
        { $type: 'Task', status: 'queued', function: { name: 'work-task' } },
      ])
      const created = (await createRes.json()) as Thing

      // Update to in_progress with worker assignment
      const worker: WorkerRef = { type: 'agent', id: 'agent-001', name: 'Claude' }
      const updateRes = await rpc(stub, 'things.update', [
        created.$id,
        {
          status: 'in_progress',
          assignment: {
            worker,
            assignedAt: new Date().toISOString(),
          },
          startedAt: new Date().toISOString(),
        },
      ])
      expect(updateRes.status).toBe(200)

      const updated = (await updateRes.json()) as Thing
      expect(updated.status).toBe('in_progress')
      expect((updated as any).assignment?.worker?.id).toBe('agent-001')
    })

    it('should update Task status to completed with output', async () => {
      const stub = getTestDO()

      // Create in_progress task
      const createRes = await rpc(stub, 'things.create', [
        {
          $type: 'Task',
          status: 'in_progress',
          function: { name: 'complete-task' },
          startedAt: new Date().toISOString(),
        },
      ])
      const created = (await createRes.json()) as Thing

      // Complete the task
      const updateRes = await rpc(stub, 'things.update', [
        created.$id,
        {
          status: 'completed',
          output: { result: 'Task completed successfully' },
          completedAt: new Date().toISOString(),
        },
      ])
      expect(updateRes.status).toBe(200)

      const updated = (await updateRes.json()) as Thing
      expect(updated.status).toBe('completed')
      expect((updated as any).output?.result).toBe('Task completed successfully')
    })

    it('should update Task status to failed with error', async () => {
      const stub = getTestDO()

      // Create in_progress task
      const createRes = await rpc(stub, 'things.create', [
        { $type: 'Task', status: 'in_progress', function: { name: 'fail-task' } },
      ])
      const created = (await createRes.json()) as Thing

      // Fail the task
      const updateRes = await rpc(stub, 'things.update', [
        created.$id,
        {
          status: 'failed',
          error: 'Connection timeout',
        },
      ])
      expect(updateRes.status).toBe(200)

      const updated = (await updateRes.json()) as Thing
      expect(updated.status).toBe('failed')
      expect((updated as any).error).toBe('Connection timeout')
    })
  })

  describe('Task Progress Tracking', () => {
    it('should update Task progress', async () => {
      const stub = getTestDO()

      // Create in_progress task
      const createRes = await rpc(stub, 'things.create', [
        { $type: 'Task', status: 'in_progress', function: { name: 'progress-task' } },
      ])
      const created = (await createRes.json()) as Thing

      // Update progress
      const progress: TaskProgress = {
        percent: 50,
        step: 'Processing data',
        currentStep: 2,
        totalSteps: 4,
        updatedAt: new Date(),
      }
      const updateRes = await rpc(stub, 'things.update', [created.$id, { progress }])
      expect(updateRes.status).toBe(200)

      const updated = (await updateRes.json()) as Thing
      expect((updated as any).progress?.percent).toBe(50)
      expect((updated as any).progress?.step).toBe('Processing data')
    })
  })

  describe('Task Dependencies via Relationships', () => {
    it('should create dependency relationship between Tasks', async () => {
      const stub = getTestDO()

      // Create two tasks
      const task1Res = await rpc(stub, 'things.create', [
        { $type: 'Task', status: 'pending', function: { name: 'task-1' } },
      ])
      const task1 = (await task1Res.json()) as Thing

      const task2Res = await rpc(stub, 'things.create', [
        { $type: 'Task', status: 'blocked', function: { name: 'task-2' } },
      ])
      const task2 = (await task2Res.json()) as Thing

      // Create blocked_by relationship: task2 is blocked_by task1
      const relRes = await rpc(stub, 'relationships.add', [
        { subject: task2.$id, predicate: 'blocked_by', object: task1.$id },
      ])
      expect(relRes.status).toBe(200)

      // Verify relationship exists
      const findRes = await rpc(stub, 'relationships.find', [
        { subject: task2.$id, predicate: 'blocked_by' },
      ])
      const rels = (await findRes.json()) as Relationship[]

      expect(rels.length).toBe(1)
      expect(rels[0].object).toBe(task1.$id)
    })

    it('should find all tasks blocked by a specific task', async () => {
      const stub = getTestDO()

      // Create blocking task and multiple blocked tasks
      const blockerRes = await rpc(stub, 'things.create', [
        { $type: 'Task', status: 'in_progress', function: { name: 'blocker' } },
      ])
      const blocker = (await blockerRes.json()) as Thing

      const blocked1Res = await rpc(stub, 'things.create', [
        { $type: 'Task', status: 'blocked', function: { name: 'blocked-1' } },
      ])
      const blocked1 = (await blocked1Res.json()) as Thing

      const blocked2Res = await rpc(stub, 'things.create', [
        { $type: 'Task', status: 'blocked', function: { name: 'blocked-2' } },
      ])
      const blocked2 = (await blocked2Res.json()) as Thing

      // Create relationships
      await rpc(stub, 'relationships.add', [
        { subject: blocked1.$id, predicate: 'blocked_by', object: blocker.$id },
      ])
      await rpc(stub, 'relationships.add', [
        { subject: blocked2.$id, predicate: 'blocked_by', object: blocker.$id },
      ])

      // Find all tasks blocked by the blocker (reverse lookup)
      const findRes = await rpc(stub, 'relationships.find', [
        { predicate: 'blocked_by', object: blocker.$id },
      ])
      const rels = (await findRes.json()) as Relationship[]

      expect(rels.length).toBe(2)
      const blockedIds = rels.map((r) => r.subject)
      expect(blockedIds).toContain(blocked1.$id)
      expect(blockedIds).toContain(blocked2.$id)
    })

    it('should create parent/child relationship for subtasks', async () => {
      const stub = getTestDO()

      // Create parent task
      const parentRes = await rpc(stub, 'things.create', [
        { $type: 'Task', status: 'pending', function: { name: 'parent-task' } },
      ])
      const parent = (await parentRes.json()) as Thing

      // Create child subtask
      const childRes = await rpc(stub, 'things.create', [
        {
          $type: 'Task',
          status: 'pending',
          function: { name: 'subtask-1' },
          parentId: parent.$id,
        },
      ])
      const child = (await childRes.json()) as Thing

      // Create parent/child relationship
      await rpc(stub, 'relationships.add', [
        { subject: parent.$id, predicate: 'has_subtask', object: child.$id },
      ])

      // Find subtasks
      const findRes = await rpc(stub, 'relationships.find', [
        { subject: parent.$id, predicate: 'has_subtask' },
      ])
      const rels = (await findRes.json()) as Relationship[]

      expect(rels.length).toBe(1)
      expect(rels[0].object).toBe(child.$id)
    })
  })

  describe('Task Lifecycle Events', () => {
    it('should emit Task.created event when task is created', async () => {
      const stub = getTestDO()

      // Create a task
      await rpc(stub, 'things.create', [
        { $type: 'Task', status: 'pending', function: { name: 'event-test' } },
      ])

      // Query for creation event
      const eventsRes = await rpc(stub, 'events.query', [{ type: 'Thing.created' }])
      const events = (await eventsRes.json()) as Event[]

      const taskCreatedEvent = events.find((e) => (e.payload as any)?.$type === 'Task')
      expect(taskCreatedEvent).toBeDefined()
    })

    it('should emit Task.statusChanged event on status transition', async () => {
      const stub = getTestDO()

      // Create task
      const createRes = await rpc(stub, 'things.create', [
        { $type: 'Task', status: 'pending', function: { name: 'status-event-task' } },
      ])
      const task = (await createRes.json()) as Thing

      // Update status
      await rpc(stub, 'things.update', [task.$id, { status: 'in_progress' }])

      // Query for update event
      const eventsRes = await rpc(stub, 'events.query', [{ type: 'Thing.updated' }])
      const events = (await eventsRes.json()) as Event[]

      const statusUpdateEvent = events.find((e) => (e.payload as any)?.$id === task.$id)
      expect(statusUpdateEvent).toBeDefined()
    })

    it('should emit Task.assigned event when worker is assigned', async () => {
      const stub = getTestDO()

      // Create task
      const createRes = await rpc(stub, 'things.create', [
        { $type: 'Task', status: 'queued', function: { name: 'assign-event-task' } },
      ])
      const task = (await createRes.json()) as Thing

      // Assign worker
      const worker: WorkerRef = { type: 'agent', id: 'agent-002' }
      await rpc(stub, 'things.update', [
        task.$id,
        {
          status: 'assigned',
          assignment: { worker, assignedAt: new Date().toISOString() },
        },
      ])

      // Query for update event (assignment is part of update)
      const eventsRes = await rpc(stub, 'events.query', [{ type: 'Thing.updated' }])
      const events = (await eventsRes.json()) as Event[]

      const assignEvent = events.find(
        (e) =>
          (e.payload as any)?.$id === task.$id && (e.payload as any)?.assignment !== undefined
      )
      expect(assignEvent).toBeDefined()
    })

    it('should emit Task.completed event when task completes', async () => {
      const stub = getTestDO()

      // Create in_progress task
      const createRes = await rpc(stub, 'things.create', [
        { $type: 'Task', status: 'in_progress', function: { name: 'complete-event-task' } },
      ])
      const task = (await createRes.json()) as Thing

      // Complete the task
      await rpc(stub, 'things.update', [
        task.$id,
        { status: 'completed', output: { success: true } },
      ])

      // Query for update event
      const eventsRes = await rpc(stub, 'events.query', [{ type: 'Thing.updated' }])
      const events = (await eventsRes.json()) as Event[]

      const completeEvent = events.find(
        (e) => (e.payload as any)?.$id === task.$id && (e.payload as any)?.status === 'completed'
      )
      expect(completeEvent).toBeDefined()
    })
  })

  describe('Project Storage', () => {
    it('should store a Project as a Thing with $type Project', async () => {
      const stub = getTestDO()

      // Create a project-like Thing
      const projectData = {
        $type: 'Project',
        name: 'Launch Feature',
        description: 'Ship the new dashboard feature',
        status: 'draft',
        defaultMode: 'sequential',
        tags: ['feature', 'q1-2026'],
      }

      const response = await rpc(stub, 'things.create', [projectData])
      expect(response.status).toBe(200)

      const project = (await response.json()) as Thing
      expect(project.$id).toBeDefined()
      expect(project.$type).toBe('Project')
      expect((project as any).name).toBe('Launch Feature')
      expect((project as any).status).toBe('draft')
    })

    it('should associate Tasks with a Project via Relationships', async () => {
      const stub = getTestDO()

      // Create project
      const projectRes = await rpc(stub, 'things.create', [
        { $type: 'Project', name: 'Test Project', status: 'active' },
      ])
      const project = (await projectRes.json()) as Thing

      // Create tasks belonging to project
      const task1Res = await rpc(stub, 'things.create', [
        {
          $type: 'Task',
          status: 'pending',
          function: { name: 'project-task-1' },
          projectId: project.$id,
        },
      ])
      const task1 = (await task1Res.json()) as Thing

      const task2Res = await rpc(stub, 'things.create', [
        {
          $type: 'Task',
          status: 'pending',
          function: { name: 'project-task-2' },
          projectId: project.$id,
        },
      ])
      const task2 = (await task2Res.json()) as Thing

      // Create relationships
      await rpc(stub, 'relationships.add', [
        { subject: project.$id, predicate: 'has_task', object: task1.$id },
      ])
      await rpc(stub, 'relationships.add', [
        { subject: project.$id, predicate: 'has_task', object: task2.$id },
      ])

      // Find all tasks in project
      const findRes = await rpc(stub, 'relationships.find', [
        { subject: project.$id, predicate: 'has_task' },
      ])
      const rels = (await findRes.json()) as Relationship[]

      expect(rels.length).toBe(2)
    })

    it('should filter Tasks by projectId', async () => {
      const stub = getTestDO()

      // Create project
      const projectRes = await rpc(stub, 'things.create', [
        { $type: 'Project', name: 'Filter Project', status: 'active' },
      ])
      const project = (await projectRes.json()) as Thing

      // Create tasks with projectId
      await rpc(stub, 'things.create', [
        { $type: 'Task', status: 'pending', function: { name: 't1' }, projectId: project.$id },
      ])
      await rpc(stub, 'things.create', [
        { $type: 'Task', status: 'pending', function: { name: 't2' }, projectId: project.$id },
      ])
      // Create task without project
      await rpc(stub, 'things.create', [
        { $type: 'Task', status: 'pending', function: { name: 't3' } },
      ])

      // Query tasks by projectId
      const response = await rpc(stub, 'things.list', [
        { type: 'Task', where: { projectId: project.$id } },
      ])
      expect(response.status).toBe(200)

      const projectTasks = (await response.json()) as Thing[]
      expect(projectTasks.length).toBe(2)
      expect(projectTasks.every((t) => (t as any).projectId === project.$id)).toBe(true)
    })
  })

  describe('Task Queue Operations', () => {
    it('should get next available task for a worker', async () => {
      const stub = getTestDO()

      // Create multiple queued tasks with different priorities
      await rpc(stub, 'things.create', [
        {
          $type: 'Task',
          status: 'queued',
          priority: 'low',
          function: { name: 'low-priority' },
          allowedWorkers: ['agent'],
        },
      ])
      const highPriorityRes = await rpc(stub, 'things.create', [
        {
          $type: 'Task',
          status: 'queued',
          priority: 'high',
          function: { name: 'high-priority' },
          allowedWorkers: ['agent'],
        },
      ])
      const highPriority = (await highPriorityRes.json()) as Thing

      // Query queued tasks sorted by priority (simulating getNextForWorker)
      // Note: This tests the data model - actual queue logic would be in DO methods
      const response = await rpc(stub, 'things.list', [
        { type: 'Task', where: { status: 'queued' } },
      ])
      expect(response.status).toBe(200)

      const queuedTasks = (await response.json()) as Thing[]
      expect(queuedTasks.length).toBe(2)

      // Sort by priority (high priority first)
      const priorityOrder = { critical: 5, urgent: 4, high: 3, normal: 2, low: 1 }
      queuedTasks.sort(
        (a, b) =>
          priorityOrder[(b as any).priority as keyof typeof priorityOrder] -
          priorityOrder[(a as any).priority as keyof typeof priorityOrder]
      )

      expect(queuedTasks[0].$id).toBe(highPriority.$id)
    })

    it('should claim a task for a worker', async () => {
      const stub = getTestDO()

      // Create queued task
      const createRes = await rpc(stub, 'things.create', [
        { $type: 'Task', status: 'queued', function: { name: 'claimable-task' } },
      ])
      const task = (await createRes.json()) as Thing

      // Claim the task (update with assignment)
      const worker: WorkerRef = { type: 'agent', id: 'claimer-agent', name: 'Claimer' }
      const claimRes = await rpc(stub, 'things.update', [
        task.$id,
        {
          status: 'assigned',
          assignment: { worker, assignedAt: new Date().toISOString() },
        },
      ])
      expect(claimRes.status).toBe(200)

      const claimed = (await claimRes.json()) as Thing
      expect(claimed.status).toBe('assigned')
      expect((claimed as any).assignment?.worker?.id).toBe('claimer-agent')

      // Verify task is no longer in queued state
      const getRes = await rpc(stub, 'things.get', [task.$id])
      const retrieved = (await getRes.json()) as Thing
      expect(retrieved.status).toBe('assigned')
    })
  })

  describe('Task Persistence', () => {
    it('should persist Task across DO accesses (real SQLite)', async () => {
      const doName = `digital-tasks-persist-${Date.now()}`

      // First access - create task
      const stub1 = getTestDO(doName)
      const createRes = await rpc(stub1, 'things.create', [
        {
          $type: 'Task',
          status: 'in_progress',
          priority: 'urgent',
          function: { type: 'generative', name: 'persistent-task' },
          assignment: {
            worker: { type: 'agent', id: 'persist-agent' },
            assignedAt: new Date().toISOString(),
          },
        },
      ])
      const created = (await createRes.json()) as Thing

      // Second access - verify persistence
      const stub2 = getTestDO(doName)
      const getRes = await rpc(stub2, 'things.get', [created.$id])
      const retrieved = (await getRes.json()) as Thing

      expect(retrieved).not.toBeNull()
      expect(retrieved.$id).toBe(created.$id)
      expect(retrieved.$type).toBe('Task')
      expect(retrieved.status).toBe('in_progress')
      expect(retrieved.priority).toBe('urgent')
      expect((retrieved as any).function?.name).toBe('persistent-task')
      expect((retrieved as any).assignment?.worker?.id).toBe('persist-agent')
    })

    it('should persist Task dependencies across DO accesses', async () => {
      const doName = `digital-tasks-deps-persist-${Date.now()}`

      // First access - create tasks and dependency
      const stub1 = getTestDO(doName)
      const task1Res = await rpc(stub1, 'things.create', [
        { $type: 'Task', status: 'completed', function: { name: 'dep-task-1' } },
      ])
      const task1 = (await task1Res.json()) as Thing

      const task2Res = await rpc(stub1, 'things.create', [
        { $type: 'Task', status: 'pending', function: { name: 'dep-task-2' } },
      ])
      const task2 = (await task2Res.json()) as Thing

      await rpc(stub1, 'relationships.add', [
        { subject: task2.$id, predicate: 'blocked_by', object: task1.$id },
      ])

      // Second access - verify dependency persists
      const stub2 = getTestDO(doName)
      const findRes = await rpc(stub2, 'relationships.find', [
        { subject: task2.$id, predicate: 'blocked_by' },
      ])
      const rels = (await findRes.json()) as Relationship[]

      expect(rels.length).toBe(1)
      expect(rels[0].object).toBe(task1.$id)
    })
  })
})
