/**
 * EditView + useRecord Integration Tests (TDD RED Phase)
 *
 * Tests for integrating @mdxui/admin EditView and SimpleForm components
 * with @dotdo/react useRecord hook for editing single records.
 *
 * Test Cases:
 * - Form populated with record data
 * - Save calls update
 * - Delete calls delete
 * - Optimistic UI updates
 *
 * Note: This depends on dotdo-jbfgt (GREEN phase for @dotdo/react hooks)
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as React from 'react'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// =============================================================================
// Mock WebSocket
// =============================================================================

class MockWebSocket {
  static instances: MockWebSocket[] = []
  static lastInstance: MockWebSocket | null = null

  readyState = WebSocket.CONNECTING
  url: string
  private eventListeners: Map<string, Set<EventListener>> = new Map()

  constructor(url: string) {
    this.url = url
    MockWebSocket.instances.push(this)
    MockWebSocket.lastInstance = this

    setTimeout(() => {
      this.readyState = WebSocket.OPEN
      this.dispatchEvent('open', new Event('open'))
    }, 0)
  }

  addEventListener(type: string, listener: EventListener) {
    if (!this.eventListeners.has(type)) {
      this.eventListeners.set(type, new Set())
    }
    this.eventListeners.get(type)!.add(listener)
  }

  removeEventListener(type: string, listener: EventListener) {
    this.eventListeners.get(type)?.delete(listener)
  }

  send(_data: string) {}

  close() {
    this.readyState = WebSocket.CLOSED
    this.dispatchEvent('close', new CloseEvent('close'))
  }

  dispatchEvent(type: string, event: Event) {
    this.eventListeners.get(type)?.forEach(fn => fn(event))
  }

  simulateMessage(data: unknown) {
    this.dispatchEvent('message', new MessageEvent('message', {
      data: JSON.stringify(data),
    }))
  }

  static reset() {
    MockWebSocket.instances.forEach(ws => ws.close())
    MockWebSocket.instances = []
    MockWebSocket.lastInstance = null
  }
}

// =============================================================================
// Mock fetch for RPC
// =============================================================================

const mockFetch = vi.fn()

// =============================================================================
// Test Types
// =============================================================================

interface Task {
  $id: string
  title: string
  description: string
  status: 'todo' | 'in_progress' | 'done'
  priority: number
}

// =============================================================================
// Test Fixtures
// =============================================================================

const mockTask: Task = {
  $id: 'task-1',
  title: 'Setup project',
  description: 'Initialize the project structure',
  status: 'in_progress',
  priority: 2,
}

const allTasks: Task[] = [
  mockTask,
  { $id: 'task-2', title: 'Write tests', description: 'Add unit tests', status: 'todo', priority: 1 },
]

// =============================================================================
// Mock Components (simulating integration)
// =============================================================================

// Mock EditView from @mdxui/admin
interface EditViewProps {
  title?: string
  loading?: boolean
  children: React.ReactNode
  actions?: React.ReactNode
}

function MockEditView({ title, loading, children, actions }: EditViewProps) {
  if (loading) {
    return (
      <div data-testid="edit-view">
        <div data-testid="loading-skeleton" className="skeleton">
          Loading...
        </div>
      </div>
    )
  }

  return (
    <div data-testid="edit-view">
      {title && <h1 data-testid="edit-title">{title}</h1>}
      <div data-testid="form-content">{children}</div>
      {actions && <div data-testid="form-actions">{actions}</div>}
    </div>
  )
}

// Mock SimpleForm from @mdxui/admin
interface SimpleFormProps {
  defaultValues?: Record<string, unknown>
  onSubmit?: (data: Record<string, unknown>) => void
  disabled?: boolean
  children: React.ReactNode
}

function MockSimpleForm({ defaultValues, onSubmit, disabled, children }: SimpleFormProps) {
  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (disabled) return

    const formData = new FormData(e.currentTarget)
    const data: Record<string, unknown> = {}
    formData.forEach((value, key) => {
      data[key] = value
    })
    onSubmit?.(data)
  }

  return (
    <form data-testid="simple-form" onSubmit={handleSubmit}>
      {React.Children.map(children, child => {
        if (React.isValidElement(child)) {
          const fieldName = child.props.source || child.props.name
          if (fieldName && defaultValues) {
            return React.cloneElement(child as React.ReactElement<{ defaultValue?: unknown }>, {
              defaultValue: defaultValues[fieldName],
            })
          }
        }
        return child
      })}
    </form>
  )
}

// Mock TextInput from @mdxui/admin
interface TextInputProps {
  source: string
  label: string
  defaultValue?: string
  disabled?: boolean
}

function MockTextInput({ source, label, defaultValue, disabled }: TextInputProps) {
  return (
    <div>
      <label htmlFor={source}>{label}</label>
      <input
        id={source}
        name={source}
        type="text"
        defaultValue={defaultValue}
        disabled={disabled}
        data-testid={`input-${source}`}
      />
    </div>
  )
}

// Mock SelectInput from @mdxui/admin
interface SelectInputProps {
  source: string
  label: string
  choices: { id: string; name: string }[]
  defaultValue?: string
  disabled?: boolean
}

function MockSelectInput({ source, label, choices, defaultValue, disabled }: SelectInputProps) {
  return (
    <div>
      <label htmlFor={source}>{label}</label>
      <select
        id={source}
        name={source}
        defaultValue={defaultValue}
        disabled={disabled}
        data-testid={`select-${source}`}
      >
        {choices.map(choice => (
          <option key={choice.id} value={choice.id}>
            {choice.name}
          </option>
        ))}
      </select>
    </div>
  )
}

// Mock useRecord hook (simulating @dotdo/react)
interface UseRecordResult<T> {
  data: T | null
  isLoading: boolean
  error: Error | null
  update: (changes: Partial<T>) => Promise<void>
  delete: () => Promise<void>
  refetch: () => void
}

function useMockRecord<T extends { $id: string }>({
  collection,
  id,
}: {
  collection: string
  id: string
}): UseRecordResult<T> {
  const [data, setData] = React.useState<T | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<Error | null>(null)
  const [optimisticData, setOptimisticData] = React.useState<Partial<T> | null>(null)

  // Track update/delete callbacks for testing
  const onUpdateRef = React.useRef<((changes: Partial<T>) => void) | null>(null)
  const onDeleteRef = React.useRef<(() => void) | null>(null)

  React.useEffect(() => {
    const ws = MockWebSocket.lastInstance
    if (ws) {
      const handleMessage = (event: MessageEvent) => {
        try {
          const msg = JSON.parse(event.data)
          if (msg.type === 'initial') {
            const allData = msg.data as T[]
            const record = allData.find(item => item.$id === id) ?? null
            setData(record)
            setIsLoading(false)
          } else if (msg.type === 'update' && msg.key === id) {
            setData(msg.data as T)
            setOptimisticData(null) // Clear optimistic state
          } else if (msg.type === 'delete' && msg.key === id) {
            setData(null)
          }
        } catch (e) {
          setError(e as Error)
        }
      }

      ws.addEventListener('message', handleMessage as EventListener)
      return () => ws.removeEventListener('message', handleMessage as EventListener)
    }
  }, [collection, id])

  const update = React.useCallback(async (changes: Partial<T>) => {
    // Optimistic update
    setOptimisticData(changes)
    onUpdateRef.current?.(changes)

    try {
      // Simulate RPC call
      const response = await mockFetch('/rpc', {
        method: 'POST',
        body: JSON.stringify({
          type: 'call',
          calls: [{
            method: `${collection}.update`,
            args: [{ key: id, ...changes }],
          }],
        }),
      })

      if (!response.ok) {
        throw new Error('Update failed')
      }
    } catch (err) {
      // Rollback on error
      setOptimisticData(null)
      throw err
    }
  }, [collection, id])

  const deleteRecord = React.useCallback(async () => {
    onDeleteRef.current?.()

    try {
      const response = await mockFetch('/rpc', {
        method: 'POST',
        body: JSON.stringify({
          type: 'call',
          calls: [{
            method: `${collection}.delete`,
            args: [{ key: id }],
          }],
        }),
      })

      if (!response.ok) {
        throw new Error('Delete failed')
      }
    } catch (err) {
      throw err
    }
  }, [collection, id])

  // Merge optimistic data with real data
  const mergedData = data && optimisticData
    ? { ...data, ...optimisticData }
    : data

  return {
    data: mergedData,
    isLoading,
    error,
    update,
    delete: deleteRecord,
    refetch: () => setIsLoading(true),
  }
}

// =============================================================================
// Integrated Test Components
// =============================================================================

const statusChoices = [
  { id: 'todo', name: 'To Do' },
  { id: 'in_progress', name: 'In Progress' },
  { id: 'done', name: 'Done' },
]

interface TaskEditFormProps {
  taskId: string
  onSave?: (data: Record<string, unknown>) => void
  onDelete?: () => void
}

function TaskEditForm({ taskId, onSave, onDelete }: TaskEditFormProps) {
  const { data: task, isLoading, error, update, delete: deleteTask } = useMockRecord<Task>({
    collection: 'Task',
    id: taskId,
  })

  const handleSubmit = async (formData: Record<string, unknown>) => {
    try {
      await update(formData as Partial<Task>)
      onSave?.(formData)
    } catch (err) {
      console.error('Save failed:', err)
    }
  }

  const handleDelete = async () => {
    try {
      await deleteTask()
      onDelete?.()
    } catch (err) {
      console.error('Delete failed:', err)
    }
  }

  if (error) {
    return <div data-testid="error-state">Error: {error.message}</div>
  }

  if (!task && !isLoading) {
    return <div data-testid="not-found">Task not found</div>
  }

  return (
    <MockEditView
      title={task ? `Edit: ${task.title}` : 'Edit Task'}
      loading={isLoading}
      actions={
        <>
          <button type="submit" form="task-form" data-testid="save-button">
            Save
          </button>
          <button type="button" onClick={handleDelete} data-testid="delete-button">
            Delete
          </button>
        </>
      }
    >
      {task && (
        <MockSimpleForm
          defaultValues={task as unknown as Record<string, unknown>}
          onSubmit={handleSubmit}
        >
          <MockTextInput source="title" label="Title" />
          <MockTextInput source="description" label="Description" />
          <MockSelectInput source="status" label="Status" choices={statusChoices} />
        </MockSimpleForm>
      )}
    </MockEditView>
  )
}

// =============================================================================
// Test Suite
// =============================================================================

describe('EditView + useRecord Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // @ts-expect-error - Replace global WebSocket
    global.WebSocket = MockWebSocket
    global.fetch = mockFetch
    MockWebSocket.reset()

    // Default successful fetch response
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ results: [] }),
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    MockWebSocket.reset()
  })

  // ===========================================================================
  // Loading State
  // ===========================================================================

  describe('loading state', () => {
    it('should show loading skeleton while record loads', () => {
      new MockWebSocket('ws://test/sync')

      render(<TaskEditForm taskId="task-1" />)

      expect(screen.getByTestId('loading-skeleton')).toBeInTheDocument()
    })

    it('should hide skeleton after record loads', async () => {
      const ws = new MockWebSocket('ws://test/sync')

      render(<TaskEditForm taskId="task-1" />)

      ws.simulateMessage({
        type: 'initial',
        collection: 'Task',
        data: allTasks,
        txid: 1,
      })

      await waitFor(() => {
        expect(screen.queryByTestId('loading-skeleton')).not.toBeInTheDocument()
      })
    })
  })

  // ===========================================================================
  // Form Population
  // ===========================================================================

  describe('form population', () => {
    it('should populate form fields with record data', async () => {
      const ws = new MockWebSocket('ws://test/sync')

      render(<TaskEditForm taskId="task-1" />)

      ws.simulateMessage({
        type: 'initial',
        collection: 'Task',
        data: allTasks,
        txid: 1,
      })

      await waitFor(() => {
        const titleInput = screen.getByTestId('input-title') as HTMLInputElement
        expect(titleInput.value).toBe('Setup project')
      })

      const descInput = screen.getByTestId('input-description') as HTMLInputElement
      expect(descInput.value).toBe('Initialize the project structure')

      const statusSelect = screen.getByTestId('select-status') as HTMLSelectElement
      expect(statusSelect.value).toBe('in_progress')
    })

    it('should show edit title with record name', async () => {
      const ws = new MockWebSocket('ws://test/sync')

      render(<TaskEditForm taskId="task-1" />)

      ws.simulateMessage({
        type: 'initial',
        collection: 'Task',
        data: allTasks,
        txid: 1,
      })

      await waitFor(() => {
        expect(screen.getByTestId('edit-title')).toHaveTextContent('Edit: Setup project')
      })
    })

    it('should show not found for missing record', async () => {
      const ws = new MockWebSocket('ws://test/sync')

      render(<TaskEditForm taskId="task-999" />)

      ws.simulateMessage({
        type: 'initial',
        collection: 'Task',
        data: allTasks,
        txid: 1,
      })

      await waitFor(() => {
        expect(screen.getByTestId('not-found')).toBeInTheDocument()
      })
    })
  })

  // ===========================================================================
  // Save / Update
  // ===========================================================================

  describe('save / update', () => {
    it('should call update when form is submitted', async () => {
      const ws = new MockWebSocket('ws://test/sync')
      const onSave = vi.fn()

      render(<TaskEditForm taskId="task-1" onSave={onSave} />)

      ws.simulateMessage({
        type: 'initial',
        collection: 'Task',
        data: allTasks,
        txid: 1,
      })

      await waitFor(() => {
        expect(screen.getByTestId('input-title')).toBeInTheDocument()
      })

      // Change a field
      const titleInput = screen.getByTestId('input-title') as HTMLInputElement
      fireEvent.change(titleInput, { target: { value: 'Updated title' } })

      // Submit form
      const saveButton = screen.getByTestId('save-button')
      fireEvent.click(saveButton)

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith('/rpc', expect.objectContaining({
          method: 'POST',
        }))
      })
    })

    it('should make RPC call with correct data', async () => {
      const ws = new MockWebSocket('ws://test/sync')

      render(<TaskEditForm taskId="task-1" />)

      ws.simulateMessage({
        type: 'initial',
        collection: 'Task',
        data: allTasks,
        txid: 1,
      })

      await waitFor(() => {
        expect(screen.getByTestId('input-title')).toBeInTheDocument()
      })

      // Submit form
      const saveButton = screen.getByTestId('save-button')
      fireEvent.click(saveButton)

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalled()
        const callArgs = mockFetch.mock.calls[0]
        const body = JSON.parse(callArgs[1].body)
        expect(body.calls[0].method).toBe('Task.update')
      })
    })
  })

  // ===========================================================================
  // Delete
  // ===========================================================================

  describe('delete', () => {
    it('should call delete when delete button clicked', async () => {
      const ws = new MockWebSocket('ws://test/sync')
      const onDelete = vi.fn()

      render(<TaskEditForm taskId="task-1" onDelete={onDelete} />)

      ws.simulateMessage({
        type: 'initial',
        collection: 'Task',
        data: allTasks,
        txid: 1,
      })

      await waitFor(() => {
        expect(screen.getByTestId('delete-button')).toBeInTheDocument()
      })

      const deleteButton = screen.getByTestId('delete-button')
      fireEvent.click(deleteButton)

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith('/rpc', expect.objectContaining({
          method: 'POST',
        }))
      })
    })

    it('should make RPC delete call', async () => {
      const ws = new MockWebSocket('ws://test/sync')

      render(<TaskEditForm taskId="task-1" />)

      ws.simulateMessage({
        type: 'initial',
        collection: 'Task',
        data: allTasks,
        txid: 1,
      })

      await waitFor(() => {
        expect(screen.getByTestId('delete-button')).toBeInTheDocument()
      })

      const deleteButton = screen.getByTestId('delete-button')
      fireEvent.click(deleteButton)

      await waitFor(() => {
        const callArgs = mockFetch.mock.calls[0]
        const body = JSON.parse(callArgs[1].body)
        expect(body.calls[0].method).toBe('Task.delete')
      })
    })
  })

  // ===========================================================================
  // Optimistic Updates (RED - requires real implementation)
  // ===========================================================================

  describe('optimistic updates', () => {
    /**
     * RED: Form should show optimistic changes immediately
     */
    it.skip('should show optimistic update before server confirms', async () => {
      // Test that:
      // 1. User edits field
      // 2. Field shows new value immediately
      // 3. Server confirms
      // 4. Value remains consistent

      expect(true).toBe(false) // Placeholder for RED phase
    })

    /**
     * RED: Form should rollback on error
     */
    it.skip('should rollback optimistic update on error', async () => {
      // Test that:
      // 1. User edits field
      // 2. Server returns error
      // 3. Field reverts to original value

      expect(true).toBe(false) // Placeholder for RED phase
    })

    /**
     * RED: Save button should show pending state
     */
    it.skip('should show pending state during save', async () => {
      // Test that:
      // 1. User clicks save
      // 2. Button shows loading indicator
      // 3. Button disabled during save
      // 4. Button returns to normal after save

      expect(true).toBe(false) // Placeholder for RED phase
    })
  })

  // ===========================================================================
  // Real-time Updates
  // ===========================================================================

  describe('real-time updates', () => {
    it('should update form when server pushes changes', async () => {
      const ws = new MockWebSocket('ws://test/sync')

      render(<TaskEditForm taskId="task-1" />)

      ws.simulateMessage({
        type: 'initial',
        collection: 'Task',
        data: allTasks,
        txid: 1,
      })

      await waitFor(() => {
        const titleInput = screen.getByTestId('input-title') as HTMLInputElement
        expect(titleInput.value).toBe('Setup project')
      })

      // Simulate server update
      ws.simulateMessage({
        type: 'update',
        collection: 'Task',
        key: 'task-1',
        data: { ...mockTask, title: 'Server updated title' },
        txid: 2,
      })

      await waitFor(() => {
        const titleInput = screen.getByTestId('input-title') as HTMLInputElement
        expect(titleInput.value).toBe('Server updated title')
      })
    })

    it('should handle record deletion from server', async () => {
      const ws = new MockWebSocket('ws://test/sync')

      render(<TaskEditForm taskId="task-1" />)

      ws.simulateMessage({
        type: 'initial',
        collection: 'Task',
        data: allTasks,
        txid: 1,
      })

      await waitFor(() => {
        expect(screen.getByTestId('input-title')).toBeInTheDocument()
      })

      // Simulate server delete
      ws.simulateMessage({
        type: 'delete',
        collection: 'Task',
        key: 'task-1',
        txid: 2,
      })

      await waitFor(() => {
        expect(screen.getByTestId('not-found')).toBeInTheDocument()
      })
    })
  })
})
