/**
 * Data Layer Integration Tests (TDD RED Phase)
 *
 * These tests verify the integration between TanStack DB collections
 * and the app's data layer, including live queries and real-time updates.
 *
 * Tests cover:
 * - Collection integration with app components
 * - Live query reactivity in UI
 * - Multi-collection joins
 * - Real-time sync behavior
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react'
import { z } from 'zod'

// =============================================================================
// Mock WebSocket
// =============================================================================

class MockWebSocket {
  static instances: MockWebSocket[] = []
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3

  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: ((event: { code?: number; reason?: string }) => void) | null = null
  onerror: ((error: Error) => void) | null = null
  readyState = MockWebSocket.CONNECTING

  constructor(public url: string) {
    MockWebSocket.instances.push(this)
  }

  send = vi.fn()
  close = vi.fn()

  simulateOpen() {
    this.readyState = MockWebSocket.OPEN
    this.onopen?.()
  }

  simulateMessage(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) })
  }

  simulateClose(code?: number, reason?: string) {
    this.readyState = MockWebSocket.CLOSED
    this.onclose?.({ code, reason })
  }
}

// =============================================================================
// Test Schemas (matching app domain models)
// =============================================================================

const TaskSchema = z.object({
  $id: z.string(),
  $type: z.literal('Task'),
  title: z.string(),
  description: z.string().optional(),
  status: z.enum(['todo', 'in_progress', 'done']),
  priority: z.enum(['low', 'medium', 'high', 'urgent']),
  assigneeId: z.string().nullable(),
  projectId: z.string().nullable(),
  dueDate: z.string().nullable(),
  tags: z.array(z.string()).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

type Task = z.infer<typeof TaskSchema>

const ProjectSchema = z.object({
  $id: z.string(),
  $type: z.literal('Project'),
  name: z.string(),
  description: z.string().optional(),
  status: z.enum(['active', 'archived', 'completed']),
  color: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

type Project = z.infer<typeof ProjectSchema>

const UserSchema = z.object({
  $id: z.string(),
  $type: z.literal('User'),
  name: z.string(),
  email: z.string(),
  avatarUrl: z.string().optional(),
  role: z.enum(['admin', 'member', 'viewer']),
  createdAt: z.string(),
  updatedAt: z.string(),
})

type User = z.infer<typeof UserSchema>

// =============================================================================
// Test Helpers
// =============================================================================

function createTask(overrides: Partial<Task> = {}): Task {
  return {
    $id: `task-${Math.random().toString(36).slice(2)}`,
    $type: 'Task',
    title: 'Test Task',
    status: 'todo',
    priority: 'medium',
    assigneeId: null,
    projectId: null,
    dueDate: null,
    tags: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  }
}

function createProject(overrides: Partial<Project> = {}): Project {
  return {
    $id: `project-${Math.random().toString(36).slice(2)}`,
    $type: 'Project',
    name: 'Test Project',
    status: 'active',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  }
}

function createUser(overrides: Partial<User> = {}): User {
  return {
    $id: `user-${Math.random().toString(36).slice(2)}`,
    $type: 'User',
    name: 'Test User',
    email: 'test@example.com',
    role: 'member',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  }
}

let mockFetch: ReturnType<typeof vi.fn>

// =============================================================================
// Mock Imports - These will be replaced with real imports when implemented
// =============================================================================

// These imports represent the expected API for the data layer
// They will fail until implementation exists - that's the RED phase!
import {
  SyncProvider,
  useDotdoCollection,
  useLiveQuery,
} from '@dotdo/tanstack/react'

// =============================================================================
// Test Wrapper
// =============================================================================

function TestWrapper({ children }: { children: React.ReactNode }) {
  return (
    <SyncProvider doUrl="wss://app.dotdo.test/do/workspace-1">
      {children}
    </SyncProvider>
  )
}

// =============================================================================
// Test Setup
// =============================================================================

describe('App Data Layer', () => {
  let originalWebSocket: typeof globalThis.WebSocket
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    vi.useFakeTimers()
    MockWebSocket.instances = []
    originalWebSocket = globalThis.WebSocket
    originalFetch = globalThis.fetch
    mockFetch = vi.fn()
    // @ts-expect-error - mock WebSocket
    globalThis.WebSocket = MockWebSocket
    globalThis.fetch = mockFetch
  })

  afterEach(() => {
    vi.useRealTimers()
    globalThis.WebSocket = originalWebSocket
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  // ===========================================================================
  // Task Board Component Tests
  // ===========================================================================

  describe('TaskBoard component integration', () => {
    /**
     * Mock TaskBoard component that uses live queries
     * This represents how the real component would work
     */
    function TaskBoard() {
      const { data: tasks, isLoading, insert, update } = useDotdoCollection({
        collection: 'Task',
        schema: TaskSchema,
      })

      // Live query: filter tasks by status
      const todoTasks = useLiveQuery(tasks, {
        from: 'Task',
        where: { status: 'todo' },
      })

      const inProgressTasks = useLiveQuery(tasks, {
        from: 'Task',
        where: { status: 'in_progress' },
      })

      const doneTasks = useLiveQuery(tasks, {
        from: 'Task',
        where: { status: 'done' },
      })

      if (isLoading) {
        return <div data-testid="loading">Loading...</div>
      }

      return (
        <div data-testid="task-board">
          <div data-testid="todo-column">
            <h2>To Do ({todoTasks.length})</h2>
            {todoTasks.map(task => (
              <div key={task.$id} data-testid={`task-${task.$id}`}>
                {task.title}
              </div>
            ))}
          </div>
          <div data-testid="in-progress-column">
            <h2>In Progress ({inProgressTasks.length})</h2>
            {inProgressTasks.map(task => (
              <div key={task.$id} data-testid={`task-${task.$id}`}>
                {task.title}
              </div>
            ))}
          </div>
          <div data-testid="done-column">
            <h2>Done ({doneTasks.length})</h2>
            {doneTasks.map(task => (
              <div key={task.$id} data-testid={`task-${task.$id}`}>
                {task.title}
              </div>
            ))}
          </div>
        </div>
      )
    }

    it('renders tasks in correct columns based on status', async () => {
      render(
        <TestWrapper>
          <TaskBoard />
        </TestWrapper>
      )

      expect(screen.getByTestId('loading')).toBeInTheDocument()

      await act(async () => {
        MockWebSocket.instances[0]?.simulateOpen()
        MockWebSocket.instances[0]?.simulateMessage({
          type: 'initial',
          collection: 'Task',
          data: [
            createTask({ $id: 'task-1', title: 'Task 1', status: 'todo' }),
            createTask({ $id: 'task-2', title: 'Task 2', status: 'in_progress' }),
            createTask({ $id: 'task-3', title: 'Task 3', status: 'done' }),
            createTask({ $id: 'task-4', title: 'Task 4', status: 'todo' }),
          ],
          txid: 100,
        })
      })

      await waitFor(() => {
        expect(screen.getByTestId('task-board')).toBeInTheDocument()
      })

      // Check column counts
      expect(screen.getByText('To Do (2)')).toBeInTheDocument()
      expect(screen.getByText('In Progress (1)')).toBeInTheDocument()
      expect(screen.getByText('Done (1)')).toBeInTheDocument()

      // Check tasks are in correct columns
      const todoColumn = screen.getByTestId('todo-column')
      expect(todoColumn).toContainElement(screen.getByTestId('task-task-1'))
      expect(todoColumn).toContainElement(screen.getByTestId('task-task-4'))

      const inProgressColumn = screen.getByTestId('in-progress-column')
      expect(inProgressColumn).toContainElement(screen.getByTestId('task-task-2'))

      const doneColumn = screen.getByTestId('done-column')
      expect(doneColumn).toContainElement(screen.getByTestId('task-task-3'))
    })

    it('moves task between columns when status changes', async () => {
      render(
        <TestWrapper>
          <TaskBoard />
        </TestWrapper>
      )

      await act(async () => {
        MockWebSocket.instances[0]?.simulateOpen()
        MockWebSocket.instances[0]?.simulateMessage({
          type: 'initial',
          collection: 'Task',
          data: [
            createTask({ $id: 'task-1', title: 'Task 1', status: 'todo' }),
          ],
          txid: 100,
        })
      })

      await waitFor(() => {
        expect(screen.getByText('To Do (1)')).toBeInTheDocument()
        expect(screen.getByText('In Progress (0)')).toBeInTheDocument()
      })

      // Simulate status change from server
      await act(async () => {
        MockWebSocket.instances[0]?.simulateMessage({
          type: 'update',
          collection: 'Task',
          key: 'task-1',
          data: createTask({ $id: 'task-1', title: 'Task 1', status: 'in_progress' }),
          txid: 101,
        })
      })

      await waitFor(() => {
        expect(screen.getByText('To Do (0)')).toBeInTheDocument()
        expect(screen.getByText('In Progress (1)')).toBeInTheDocument()
      })

      const inProgressColumn = screen.getByTestId('in-progress-column')
      expect(inProgressColumn).toContainElement(screen.getByTestId('task-task-1'))
    })

    it('adds new task to correct column when inserted', async () => {
      render(
        <TestWrapper>
          <TaskBoard />
        </TestWrapper>
      )

      await act(async () => {
        MockWebSocket.instances[0]?.simulateOpen()
        MockWebSocket.instances[0]?.simulateMessage({
          type: 'initial',
          collection: 'Task',
          data: [],
          txid: 100,
        })
      })

      await waitFor(() => {
        expect(screen.getByText('To Do (0)')).toBeInTheDocument()
      })

      // Insert new task
      await act(async () => {
        MockWebSocket.instances[0]?.simulateMessage({
          type: 'insert',
          collection: 'Task',
          key: 'task-new',
          data: createTask({ $id: 'task-new', title: 'New Task', status: 'todo' }),
          txid: 101,
        })
      })

      await waitFor(() => {
        expect(screen.getByText('To Do (1)')).toBeInTheDocument()
        expect(screen.getByText('New Task')).toBeInTheDocument()
      })
    })

    it('removes task from board when deleted', async () => {
      render(
        <TestWrapper>
          <TaskBoard />
        </TestWrapper>
      )

      await act(async () => {
        MockWebSocket.instances[0]?.simulateOpen()
        MockWebSocket.instances[0]?.simulateMessage({
          type: 'initial',
          collection: 'Task',
          data: [
            createTask({ $id: 'task-1', title: 'Task to Delete', status: 'todo' }),
          ],
          txid: 100,
        })
      })

      await waitFor(() => {
        expect(screen.getByText('Task to Delete')).toBeInTheDocument()
      })

      // Delete task
      await act(async () => {
        MockWebSocket.instances[0]?.simulateMessage({
          type: 'delete',
          collection: 'Task',
          key: 'task-1',
          txid: 101,
        })
      })

      await waitFor(() => {
        expect(screen.queryByText('Task to Delete')).not.toBeInTheDocument()
        expect(screen.getByText('To Do (0)')).toBeInTheDocument()
      })
    })
  })

  // ===========================================================================
  // Task Detail with Relations Tests
  // ===========================================================================

  describe('TaskDetail component with joins', () => {
    /**
     * Mock TaskDetail component that shows task with related project and assignee
     */
    function TaskDetail({ taskId }: { taskId: string }) {
      const { data: tasks } = useDotdoCollection({
        collection: 'Task',
        schema: TaskSchema,
      })

      const { data: users } = useDotdoCollection({
        collection: 'User',
        schema: UserSchema,
      })

      const { data: projects } = useDotdoCollection({
        collection: 'Project',
        schema: ProjectSchema,
      })

      // Find the specific task
      const task = tasks.find(t => t.$id === taskId)

      // Join with related data
      const taskWithRelations = useLiveQuery(tasks, {
        from: 'Task',
        where: { $id: taskId },
        join: {
          assignee: {
            from: users,
            on: (t: Task, u: User) => t.assigneeId === u.$id,
            type: 'left',
          },
          project: {
            from: projects,
            on: (t: Task, p: Project) => t.projectId === p.$id,
            type: 'left',
          },
        },
      })

      const result = taskWithRelations[0]

      if (!result) {
        return <div data-testid="not-found">Task not found</div>
      }

      return (
        <div data-testid="task-detail">
          <h1 data-testid="task-title">{result.task.title}</h1>
          <p data-testid="task-status">Status: {result.task.status}</p>
          <p data-testid="task-priority">Priority: {result.task.priority}</p>

          {result.assignee && (
            <div data-testid="assignee-info">
              <span data-testid="assignee-name">{result.assignee.name}</span>
              <span data-testid="assignee-email">{result.assignee.email}</span>
            </div>
          )}

          {result.project && (
            <div data-testid="project-info">
              <span data-testid="project-name">{result.project.name}</span>
            </div>
          )}
        </div>
      )
    }

    it('renders task with joined assignee and project', async () => {
      render(
        <TestWrapper>
          <TaskDetail taskId="task-1" />
        </TestWrapper>
      )

      // Initialize all collections
      await act(async () => {
        // Task collection
        MockWebSocket.instances[0]?.simulateOpen()
        MockWebSocket.instances[0]?.simulateMessage({
          type: 'initial',
          collection: 'Task',
          data: [
            createTask({
              $id: 'task-1',
              title: 'Important Task',
              status: 'in_progress',
              priority: 'high',
              assigneeId: 'user-1',
              projectId: 'project-1',
            }),
          ],
          txid: 100,
        })

        // User collection
        MockWebSocket.instances[1]?.simulateOpen()
        MockWebSocket.instances[1]?.simulateMessage({
          type: 'initial',
          collection: 'User',
          data: [
            createUser({ $id: 'user-1', name: 'Alice', email: 'alice@example.com' }),
          ],
          txid: 100,
        })

        // Project collection
        MockWebSocket.instances[2]?.simulateOpen()
        MockWebSocket.instances[2]?.simulateMessage({
          type: 'initial',
          collection: 'Project',
          data: [
            createProject({ $id: 'project-1', name: 'Alpha Project' }),
          ],
          txid: 100,
        })
      })

      await waitFor(() => {
        expect(screen.getByTestId('task-detail')).toBeInTheDocument()
      })

      // Verify task data
      expect(screen.getByTestId('task-title')).toHaveTextContent('Important Task')
      expect(screen.getByTestId('task-status')).toHaveTextContent('Status: in_progress')
      expect(screen.getByTestId('task-priority')).toHaveTextContent('Priority: high')

      // Verify joined assignee
      expect(screen.getByTestId('assignee-name')).toHaveTextContent('Alice')
      expect(screen.getByTestId('assignee-email')).toHaveTextContent('alice@example.com')

      // Verify joined project
      expect(screen.getByTestId('project-name')).toHaveTextContent('Alpha Project')
    })

    it('updates when related user changes', async () => {
      render(
        <TestWrapper>
          <TaskDetail taskId="task-1" />
        </TestWrapper>
      )

      await act(async () => {
        MockWebSocket.instances[0]?.simulateOpen()
        MockWebSocket.instances[0]?.simulateMessage({
          type: 'initial',
          collection: 'Task',
          data: [
            createTask({ $id: 'task-1', title: 'Task', assigneeId: 'user-1', projectId: null }),
          ],
          txid: 100,
        })

        MockWebSocket.instances[1]?.simulateOpen()
        MockWebSocket.instances[1]?.simulateMessage({
          type: 'initial',
          collection: 'User',
          data: [
            createUser({ $id: 'user-1', name: 'Alice' }),
          ],
          txid: 100,
        })

        MockWebSocket.instances[2]?.simulateOpen()
        MockWebSocket.instances[2]?.simulateMessage({
          type: 'initial',
          collection: 'Project',
          data: [],
          txid: 100,
        })
      })

      await waitFor(() => {
        expect(screen.getByTestId('assignee-name')).toHaveTextContent('Alice')
      })

      // Update user name
      await act(async () => {
        MockWebSocket.instances[1]?.simulateMessage({
          type: 'update',
          collection: 'User',
          key: 'user-1',
          data: createUser({ $id: 'user-1', name: 'Alice Smith' }),
          txid: 101,
        })
      })

      await waitFor(() => {
        expect(screen.getByTestId('assignee-name')).toHaveTextContent('Alice Smith')
      })
    })

    it('handles reassignment to different user', async () => {
      render(
        <TestWrapper>
          <TaskDetail taskId="task-1" />
        </TestWrapper>
      )

      await act(async () => {
        MockWebSocket.instances[0]?.simulateOpen()
        MockWebSocket.instances[0]?.simulateMessage({
          type: 'initial',
          collection: 'Task',
          data: [
            createTask({ $id: 'task-1', title: 'Task', assigneeId: 'user-1', projectId: null }),
          ],
          txid: 100,
        })

        MockWebSocket.instances[1]?.simulateOpen()
        MockWebSocket.instances[1]?.simulateMessage({
          type: 'initial',
          collection: 'User',
          data: [
            createUser({ $id: 'user-1', name: 'Alice' }),
            createUser({ $id: 'user-2', name: 'Bob' }),
          ],
          txid: 100,
        })

        MockWebSocket.instances[2]?.simulateOpen()
        MockWebSocket.instances[2]?.simulateMessage({
          type: 'initial',
          collection: 'Project',
          data: [],
          txid: 100,
        })
      })

      await waitFor(() => {
        expect(screen.getByTestId('assignee-name')).toHaveTextContent('Alice')
      })

      // Reassign task to Bob
      await act(async () => {
        MockWebSocket.instances[0]?.simulateMessage({
          type: 'update',
          collection: 'Task',
          key: 'task-1',
          data: createTask({ $id: 'task-1', title: 'Task', assigneeId: 'user-2', projectId: null }),
          txid: 101,
        })
      })

      await waitFor(() => {
        expect(screen.getByTestId('assignee-name')).toHaveTextContent('Bob')
      })
    })
  })

  // ===========================================================================
  // Project Dashboard with Aggregations Tests
  // ===========================================================================

  describe('ProjectDashboard with aggregations', () => {
    /**
     * Mock ProjectDashboard that shows projects with task counts
     */
    function ProjectDashboard() {
      const { data: projects, isLoading: projectsLoading } = useDotdoCollection({
        collection: 'Project',
        schema: ProjectSchema,
      })

      const { data: tasks, isLoading: tasksLoading } = useDotdoCollection({
        collection: 'Task',
        schema: TaskSchema,
      })

      if (projectsLoading || tasksLoading) {
        return <div data-testid="loading">Loading...</div>
      }

      // Join projects with task counts
      const projectsWithCounts = projects.map(project => {
        const projectTasks = tasks.filter(t => t.projectId === project.$id)
        const completedTasks = projectTasks.filter(t => t.status === 'done')

        return {
          ...project,
          totalTasks: projectTasks.length,
          completedTasks: completedTasks.length,
          progress: projectTasks.length > 0
            ? Math.round((completedTasks.length / projectTasks.length) * 100)
            : 0,
        }
      })

      return (
        <div data-testid="project-dashboard">
          {projectsWithCounts.map(project => (
            <div key={project.$id} data-testid={`project-${project.$id}`}>
              <h3 data-testid={`project-name-${project.$id}`}>{project.name}</h3>
              <p data-testid={`project-tasks-${project.$id}`}>
                Tasks: {project.completedTasks}/{project.totalTasks}
              </p>
              <div
                data-testid={`project-progress-${project.$id}`}
                data-progress={project.progress}
              >
                {project.progress}% complete
              </div>
            </div>
          ))}
        </div>
      )
    }

    it('renders projects with correct task counts', async () => {
      render(
        <TestWrapper>
          <ProjectDashboard />
        </TestWrapper>
      )

      await act(async () => {
        MockWebSocket.instances[0]?.simulateOpen()
        MockWebSocket.instances[0]?.simulateMessage({
          type: 'initial',
          collection: 'Project',
          data: [
            createProject({ $id: 'project-1', name: 'Alpha' }),
            createProject({ $id: 'project-2', name: 'Beta' }),
          ],
          txid: 100,
        })

        MockWebSocket.instances[1]?.simulateOpen()
        MockWebSocket.instances[1]?.simulateMessage({
          type: 'initial',
          collection: 'Task',
          data: [
            createTask({ $id: 'task-1', projectId: 'project-1', status: 'done' }),
            createTask({ $id: 'task-2', projectId: 'project-1', status: 'todo' }),
            createTask({ $id: 'task-3', projectId: 'project-1', status: 'done' }),
            createTask({ $id: 'task-4', projectId: 'project-2', status: 'todo' }),
          ],
          txid: 100,
        })
      })

      await waitFor(() => {
        expect(screen.getByTestId('project-dashboard')).toBeInTheDocument()
      })

      // Project Alpha: 2/3 tasks done = 67%
      expect(screen.getByTestId('project-tasks-project-1')).toHaveTextContent('Tasks: 2/3')
      expect(screen.getByTestId('project-progress-project-1')).toHaveTextContent('67% complete')

      // Project Beta: 0/1 tasks done = 0%
      expect(screen.getByTestId('project-tasks-project-2')).toHaveTextContent('Tasks: 0/1')
      expect(screen.getByTestId('project-progress-project-2')).toHaveTextContent('0% complete')
    })

    it('updates progress when task is completed', async () => {
      render(
        <TestWrapper>
          <ProjectDashboard />
        </TestWrapper>
      )

      await act(async () => {
        MockWebSocket.instances[0]?.simulateOpen()
        MockWebSocket.instances[0]?.simulateMessage({
          type: 'initial',
          collection: 'Project',
          data: [
            createProject({ $id: 'project-1', name: 'Alpha' }),
          ],
          txid: 100,
        })

        MockWebSocket.instances[1]?.simulateOpen()
        MockWebSocket.instances[1]?.simulateMessage({
          type: 'initial',
          collection: 'Task',
          data: [
            createTask({ $id: 'task-1', projectId: 'project-1', status: 'todo' }),
            createTask({ $id: 'task-2', projectId: 'project-1', status: 'todo' }),
          ],
          txid: 100,
        })
      })

      await waitFor(() => {
        expect(screen.getByTestId('project-tasks-project-1')).toHaveTextContent('Tasks: 0/2')
        expect(screen.getByTestId('project-progress-project-1')).toHaveTextContent('0% complete')
      })

      // Complete one task
      await act(async () => {
        MockWebSocket.instances[1]?.simulateMessage({
          type: 'update',
          collection: 'Task',
          key: 'task-1',
          data: createTask({ $id: 'task-1', projectId: 'project-1', status: 'done' }),
          txid: 101,
        })
      })

      await waitFor(() => {
        expect(screen.getByTestId('project-tasks-project-1')).toHaveTextContent('Tasks: 1/2')
        expect(screen.getByTestId('project-progress-project-1')).toHaveTextContent('50% complete')
      })
    })

    it('updates counts when task is moved to different project', async () => {
      render(
        <TestWrapper>
          <ProjectDashboard />
        </TestWrapper>
      )

      await act(async () => {
        MockWebSocket.instances[0]?.simulateOpen()
        MockWebSocket.instances[0]?.simulateMessage({
          type: 'initial',
          collection: 'Project',
          data: [
            createProject({ $id: 'project-1', name: 'Alpha' }),
            createProject({ $id: 'project-2', name: 'Beta' }),
          ],
          txid: 100,
        })

        MockWebSocket.instances[1]?.simulateOpen()
        MockWebSocket.instances[1]?.simulateMessage({
          type: 'initial',
          collection: 'Task',
          data: [
            createTask({ $id: 'task-1', projectId: 'project-1', status: 'todo' }),
          ],
          txid: 100,
        })
      })

      await waitFor(() => {
        expect(screen.getByTestId('project-tasks-project-1')).toHaveTextContent('Tasks: 0/1')
        expect(screen.getByTestId('project-tasks-project-2')).toHaveTextContent('Tasks: 0/0')
      })

      // Move task to project-2
      await act(async () => {
        MockWebSocket.instances[1]?.simulateMessage({
          type: 'update',
          collection: 'Task',
          key: 'task-1',
          data: createTask({ $id: 'task-1', projectId: 'project-2', status: 'todo' }),
          txid: 101,
        })
      })

      await waitFor(() => {
        expect(screen.getByTestId('project-tasks-project-1')).toHaveTextContent('Tasks: 0/0')
        expect(screen.getByTestId('project-tasks-project-2')).toHaveTextContent('Tasks: 0/1')
      })
    })
  })

  // ===========================================================================
  // Optimistic UI Tests
  // ===========================================================================

  describe('Optimistic UI behavior', () => {
    function TaskList() {
      const { data: tasks, isLoading, insert, update, delete: deleteTask, pendingMutations } = useDotdoCollection({
        collection: 'Task',
        schema: TaskSchema,
      })

      if (isLoading) {
        return <div data-testid="loading">Loading...</div>
      }

      return (
        <div data-testid="task-list">
          <div data-testid="pending-count">Pending: {pendingMutations}</div>
          <button
            data-testid="add-task-btn"
            onClick={() => insert(createTask({ $id: 'new-task', title: 'New Task' }))}
          >
            Add Task
          </button>
          {tasks.map(task => (
            <div key={task.$id} data-testid={`task-${task.$id}`}>
              <span>{task.title}</span>
              <button
                data-testid={`complete-${task.$id}`}
                onClick={() => update(task.$id, { status: 'done' })}
              >
                Complete
              </button>
              <button
                data-testid={`delete-${task.$id}`}
                onClick={() => deleteTask(task.$id)}
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      )
    }

    it('shows optimistic insert immediately', async () => {
      mockFetch.mockImplementation(() =>
        new Promise(resolve =>
          setTimeout(() =>
            resolve({
              ok: true,
              json: () => Promise.resolve({ success: true, rowid: 200 }),
            }),
            1000
          )
        )
      )

      render(
        <TestWrapper>
          <TaskList />
        </TestWrapper>
      )

      await act(async () => {
        MockWebSocket.instances[0]?.simulateOpen()
        MockWebSocket.instances[0]?.simulateMessage({
          type: 'initial',
          collection: 'Task',
          data: [],
          txid: 100,
        })
      })

      await waitFor(() => {
        expect(screen.getByTestId('task-list')).toBeInTheDocument()
      })

      // Click add button
      await act(async () => {
        fireEvent.click(screen.getByTestId('add-task-btn'))
      })

      // Task should appear immediately (optimistic)
      await waitFor(() => {
        expect(screen.getByText('New Task')).toBeInTheDocument()
      })

      // Should show pending mutation
      expect(screen.getByTestId('pending-count')).toHaveTextContent('Pending: 1')
    })

    it('shows optimistic update immediately', async () => {
      mockFetch.mockImplementation(() =>
        new Promise(resolve =>
          setTimeout(() =>
            resolve({
              ok: true,
              json: () => Promise.resolve({ success: true, rowid: 200 }),
            }),
            1000
          )
        )
      )

      render(
        <TestWrapper>
          <TaskList />
        </TestWrapper>
      )

      await act(async () => {
        MockWebSocket.instances[0]?.simulateOpen()
        MockWebSocket.instances[0]?.simulateMessage({
          type: 'initial',
          collection: 'Task',
          data: [
            createTask({ $id: 'task-1', title: 'Task 1', status: 'todo' }),
          ],
          txid: 100,
        })
      })

      await waitFor(() => {
        expect(screen.getByTestId('task-task-1')).toBeInTheDocument()
      })

      // Click complete button
      await act(async () => {
        fireEvent.click(screen.getByTestId('complete-task-1'))
      })

      // Should show pending mutation
      await waitFor(() => {
        expect(screen.getByTestId('pending-count')).toHaveTextContent('Pending: 1')
      })
    })

    it('shows optimistic delete immediately', async () => {
      mockFetch.mockImplementation(() =>
        new Promise(resolve =>
          setTimeout(() =>
            resolve({
              ok: true,
              json: () => Promise.resolve({ success: true, rowid: 200 }),
            }),
            1000
          )
        )
      )

      render(
        <TestWrapper>
          <TaskList />
        </TestWrapper>
      )

      await act(async () => {
        MockWebSocket.instances[0]?.simulateOpen()
        MockWebSocket.instances[0]?.simulateMessage({
          type: 'initial',
          collection: 'Task',
          data: [
            createTask({ $id: 'task-1', title: 'Task 1' }),
            createTask({ $id: 'task-2', title: 'Task 2' }),
          ],
          txid: 100,
        })
      })

      await waitFor(() => {
        expect(screen.getByTestId('task-task-1')).toBeInTheDocument()
        expect(screen.getByTestId('task-task-2')).toBeInTheDocument()
      })

      // Click delete button
      await act(async () => {
        fireEvent.click(screen.getByTestId('delete-task-1'))
      })

      // Task should be removed immediately (optimistic)
      await waitFor(() => {
        expect(screen.queryByTestId('task-task-1')).not.toBeInTheDocument()
        expect(screen.getByTestId('task-task-2')).toBeInTheDocument()
      })
    })

    it('rolls back on insert failure', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Server error'),
      })

      render(
        <TestWrapper>
          <TaskList />
        </TestWrapper>
      )

      await act(async () => {
        MockWebSocket.instances[0]?.simulateOpen()
        MockWebSocket.instances[0]?.simulateMessage({
          type: 'initial',
          collection: 'Task',
          data: [],
          txid: 100,
        })
      })

      await waitFor(() => {
        expect(screen.getByTestId('task-list')).toBeInTheDocument()
      })

      // Click add button (will fail)
      await act(async () => {
        fireEvent.click(screen.getByTestId('add-task-btn'))
      })

      // After failure, task should be rolled back
      await waitFor(() => {
        expect(screen.queryByText('New Task')).not.toBeInTheDocument()
        expect(screen.getByTestId('pending-count')).toHaveTextContent('Pending: 0')
      })
    })
  })

  // ===========================================================================
  // Real-time Sync Tests
  // ===========================================================================

  describe('Real-time sync behavior', () => {
    function TaskCounter() {
      const { data: tasks, txid } = useDotdoCollection({
        collection: 'Task',
        schema: TaskSchema,
      })

      return (
        <div data-testid="task-counter">
          <span data-testid="count">{tasks.length}</span>
          <span data-testid="txid">{txid}</span>
        </div>
      )
    }

    it('receives real-time updates from server', async () => {
      render(
        <TestWrapper>
          <TaskCounter />
        </TestWrapper>
      )

      await act(async () => {
        MockWebSocket.instances[0]?.simulateOpen()
        MockWebSocket.instances[0]?.simulateMessage({
          type: 'initial',
          collection: 'Task',
          data: [],
          txid: 100,
        })
      })

      await waitFor(() => {
        expect(screen.getByTestId('count')).toHaveTextContent('0')
        expect(screen.getByTestId('txid')).toHaveTextContent('100')
      })

      // Simulate another user inserting a task
      await act(async () => {
        MockWebSocket.instances[0]?.simulateMessage({
          type: 'insert',
          collection: 'Task',
          key: 'task-from-other-user',
          data: createTask({ $id: 'task-from-other-user' }),
          txid: 101,
        })
      })

      await waitFor(() => {
        expect(screen.getByTestId('count')).toHaveTextContent('1')
        expect(screen.getByTestId('txid')).toHaveTextContent('101')
      })
    })

    it('handles rapid updates from multiple sources', async () => {
      render(
        <TestWrapper>
          <TaskCounter />
        </TestWrapper>
      )

      await act(async () => {
        MockWebSocket.instances[0]?.simulateOpen()
        MockWebSocket.instances[0]?.simulateMessage({
          type: 'initial',
          collection: 'Task',
          data: [],
          txid: 100,
        })
      })

      await waitFor(() => {
        expect(screen.getByTestId('count')).toHaveTextContent('0')
      })

      // Simulate rapid inserts
      await act(async () => {
        for (let i = 0; i < 5; i++) {
          MockWebSocket.instances[0]?.simulateMessage({
            type: 'insert',
            collection: 'Task',
            key: `task-${i}`,
            data: createTask({ $id: `task-${i}` }),
            txid: 101 + i,
          })
        }
      })

      await waitFor(() => {
        expect(screen.getByTestId('count')).toHaveTextContent('5')
        expect(screen.getByTestId('txid')).toHaveTextContent('105')
      })
    })

    it('handles reconnection and resync', async () => {
      render(
        <TestWrapper>
          <TaskCounter />
        </TestWrapper>
      )

      await act(async () => {
        MockWebSocket.instances[0]?.simulateOpen()
        MockWebSocket.instances[0]?.simulateMessage({
          type: 'initial',
          collection: 'Task',
          data: [createTask({ $id: 'task-1' })],
          txid: 100,
        })
      })

      await waitFor(() => {
        expect(screen.getByTestId('count')).toHaveTextContent('1')
      })

      // Simulate disconnect
      await act(async () => {
        MockWebSocket.instances[0]?.simulateClose()
      })

      // Wait for reconnection
      await act(async () => {
        vi.advanceTimersByTime(1000)
      })

      // Simulate reconnection with updated data
      await act(async () => {
        MockWebSocket.instances[1]?.simulateOpen()
        MockWebSocket.instances[1]?.simulateMessage({
          type: 'initial',
          collection: 'Task',
          data: [
            createTask({ $id: 'task-1' }),
            createTask({ $id: 'task-2' }), // New task added while disconnected
          ],
          txid: 150,
        })
      })

      await waitFor(() => {
        expect(screen.getByTestId('count')).toHaveTextContent('2')
        expect(screen.getByTestId('txid')).toHaveTextContent('150')
      })
    })
  })
})
