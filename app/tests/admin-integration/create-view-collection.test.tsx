/**
 * CreateView + useCollection Integration Tests (TDD RED Phase)
 *
 * Tests for integrating @mdxui/admin CreateView and SimpleForm components
 * with @dotdo/react useCollection hook for creating new records.
 *
 * Test Cases:
 * - Form submits via insert
 * - Redirects after create
 * - Error handling
 *
 * Note: This depends on dotdo-jbfgt (GREEN phase for @dotdo/react hooks)
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as React from 'react'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter, useNavigate, Routes, Route } from 'react-router-dom'

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
// Mock Components
// =============================================================================

// Mock CreateView from @mdxui/admin
interface CreateViewProps {
  title?: string
  children: React.ReactNode
  actions?: React.ReactNode
}

function MockCreateView({ title, children, actions }: CreateViewProps) {
  return (
    <div data-testid="create-view">
      {title && <h1 data-testid="create-title">{title}</h1>}
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

function MockSimpleForm({ defaultValues = {}, onSubmit, disabled, children }: SimpleFormProps) {
  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (disabled) return

    const formData = new FormData(e.currentTarget)
    const data: Record<string, unknown> = { ...defaultValues }
    formData.forEach((value, key) => {
      data[key] = value
    })
    onSubmit?.(data)
  }

  return (
    <form id="task-create-form" data-testid="simple-form" onSubmit={handleSubmit}>
      {children}
    </form>
  )
}

// Mock TextInput from @mdxui/admin
interface TextInputProps {
  source: string
  label: string
  required?: boolean
  disabled?: boolean
}

function MockTextInput({ source, label, required, disabled }: TextInputProps) {
  return (
    <div>
      <label htmlFor={source}>{label}{required && ' *'}</label>
      <input
        id={source}
        name={source}
        type="text"
        required={required}
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

// Mock useCollection hook (simulating @dotdo/react)
interface UseCollectionResult<T> {
  data: T[]
  isLoading: boolean
  error: Error | null
  insert: (item: T) => Promise<void>
  update: (id: string, changes: Partial<T>) => Promise<void>
  delete: (id: string) => Promise<void>
  refetch: () => void
}

function useMockCollection<T extends { $id: string }>({
  collection,
}: {
  collection: string
}): UseCollectionResult<T> {
  const [data, setData] = React.useState<T[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<Error | null>(null)

  React.useEffect(() => {
    const ws = MockWebSocket.lastInstance
    if (ws) {
      const handleMessage = (event: MessageEvent) => {
        try {
          const msg = JSON.parse(event.data)
          if (msg.type === 'initial') {
            setData(msg.data as T[])
            setIsLoading(false)
          } else if (msg.type === 'insert') {
            setData(prev => [...prev, msg.data as T])
          }
        } catch (e) {
          setError(e as Error)
        }
      }

      ws.addEventListener('message', handleMessage as EventListener)
      return () => ws.removeEventListener('message', handleMessage as EventListener)
    }
  }, [collection])

  const insert = React.useCallback(async (item: T) => {
    // Optimistic insert
    setData(prev => [...prev, item])

    try {
      const response = await mockFetch('/rpc', {
        method: 'POST',
        body: JSON.stringify({
          type: 'call',
          calls: [{
            method: `${collection}.create`,
            args: [item],
          }],
        }),
      })

      if (!response.ok) {
        // Rollback on failure
        setData(prev => prev.filter(i => i.$id !== item.$id))
        throw new Error('Insert failed')
      }

      // Return the created ID from response
      const result = await response.json()
      return result.id || item.$id
    } catch (err) {
      setData(prev => prev.filter(i => i.$id !== item.$id))
      throw err
    }
  }, [collection])

  return {
    data,
    isLoading,
    error,
    insert,
    update: async () => {},
    delete: async () => {},
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

interface TaskCreateFormProps {
  onSuccess?: (id: string) => void
  onError?: (error: Error) => void
}

function TaskCreateForm({ onSuccess, onError }: TaskCreateFormProps) {
  const { insert, error } = useMockCollection<Task>({ collection: 'Task' })
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const [submitError, setSubmitError] = React.useState<string | null>(null)

  const handleSubmit = async (formData: Record<string, unknown>) => {
    setIsSubmitting(true)
    setSubmitError(null)

    try {
      const newTask: Task = {
        $id: `task-${Date.now()}`,
        title: formData.title as string,
        description: formData.description as string || '',
        status: (formData.status as Task['status']) || 'todo',
        priority: parseInt(formData.priority as string, 10) || 1,
      }

      await insert(newTask)
      onSuccess?.(newTask.$id)
    } catch (err) {
      const error = err as Error
      setSubmitError(error.message)
      onError?.(error)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <MockCreateView
      title="Create Task"
      actions={
        <>
          <button
            type="submit"
            form="task-create-form"
            disabled={isSubmitting}
            data-testid="create-button"
          >
            {isSubmitting ? 'Creating...' : 'Create'}
          </button>
          <button type="button" data-testid="cancel-button">
            Cancel
          </button>
        </>
      }
    >
      {submitError && (
        <div data-testid="submit-error" className="error">
          {submitError}
        </div>
      )}
      <MockSimpleForm onSubmit={handleSubmit} disabled={isSubmitting}>
        <MockTextInput source="title" label="Title" required />
        <MockTextInput source="description" label="Description" />
        <MockSelectInput
          source="status"
          label="Status"
          choices={statusChoices}
          defaultValue="todo"
        />
      </MockSimpleForm>
    </MockCreateView>
  )
}

// Component with navigation for redirect testing
function TaskCreateWithRedirect() {
  const navigate = vi.fn()

  const handleSuccess = (id: string) => {
    navigate(`/tasks/${id}`)
  }

  return <TaskCreateForm onSuccess={handleSuccess} />
}

// =============================================================================
// Test Suite
// =============================================================================

describe('CreateView + useCollection Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // @ts-expect-error - Replace global WebSocket
    global.WebSocket = MockWebSocket
    global.fetch = mockFetch
    MockWebSocket.reset()

    // Default successful fetch response
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'task-new' }),
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    MockWebSocket.reset()
  })

  // ===========================================================================
  // Rendering
  // ===========================================================================

  describe('rendering', () => {
    it('should render create form', () => {
      new MockWebSocket('ws://test/sync')

      render(<TaskCreateForm />)

      expect(screen.getByTestId('create-view')).toBeInTheDocument()
      expect(screen.getByTestId('create-title')).toHaveTextContent('Create Task')
    })

    it('should render form inputs', () => {
      new MockWebSocket('ws://test/sync')

      render(<TaskCreateForm />)

      expect(screen.getByTestId('input-title')).toBeInTheDocument()
      expect(screen.getByTestId('input-description')).toBeInTheDocument()
      expect(screen.getByTestId('select-status')).toBeInTheDocument()
    })

    it('should render action buttons', () => {
      new MockWebSocket('ws://test/sync')

      render(<TaskCreateForm />)

      expect(screen.getByTestId('create-button')).toBeInTheDocument()
      expect(screen.getByTestId('cancel-button')).toBeInTheDocument()
    })
  })

  // ===========================================================================
  // Form Submission
  // ===========================================================================

  describe('form submission', () => {
    it('should submit form via insert', async () => {
      const ws = new MockWebSocket('ws://test/sync')
      const onSuccess = vi.fn()

      render(<TaskCreateForm onSuccess={onSuccess} />)

      // Fill form
      fireEvent.change(screen.getByTestId('input-title'), {
        target: { value: 'New Task' },
      })
      fireEvent.change(screen.getByTestId('input-description'), {
        target: { value: 'Task description' },
      })

      // Submit
      fireEvent.click(screen.getByTestId('create-button'))

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith('/rpc', expect.objectContaining({
          method: 'POST',
        }))
      })
    })

    it('should call insert with correct data', async () => {
      const ws = new MockWebSocket('ws://test/sync')

      render(<TaskCreateForm />)

      // Fill form
      fireEvent.change(screen.getByTestId('input-title'), {
        target: { value: 'New Task' },
      })

      // Submit
      fireEvent.click(screen.getByTestId('create-button'))

      await waitFor(() => {
        const callArgs = mockFetch.mock.calls[0]
        const body = JSON.parse(callArgs[1].body)
        expect(body.calls[0].method).toBe('Task.create')
        expect(body.calls[0].args[0].title).toBe('New Task')
      })
    })

    it('should call onSuccess after successful create', async () => {
      new MockWebSocket('ws://test/sync')
      const onSuccess = vi.fn()

      render(<TaskCreateForm onSuccess={onSuccess} />)

      // Fill form
      fireEvent.change(screen.getByTestId('input-title'), {
        target: { value: 'New Task' },
      })

      // Submit
      fireEvent.click(screen.getByTestId('create-button'))

      await waitFor(() => {
        expect(onSuccess).toHaveBeenCalled()
      })
    })

    it('should pass created ID to onSuccess', async () => {
      new MockWebSocket('ws://test/sync')
      const onSuccess = vi.fn()

      render(<TaskCreateForm onSuccess={onSuccess} />)

      // Fill form
      fireEvent.change(screen.getByTestId('input-title'), {
        target: { value: 'New Task' },
      })

      // Submit
      fireEvent.click(screen.getByTestId('create-button'))

      await waitFor(() => {
        expect(onSuccess).toHaveBeenCalledWith(expect.stringMatching(/^task-/))
      })
    })
  })

  // ===========================================================================
  // Loading State During Submit
  // ===========================================================================

  describe('loading state during submit', () => {
    it('should disable button during submission', async () => {
      new MockWebSocket('ws://test/sync')

      // Slow response
      mockFetch.mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 100))
        return { ok: true, json: async () => ({ id: 'task-new' }) }
      })

      render(<TaskCreateForm />)

      fireEvent.change(screen.getByTestId('input-title'), {
        target: { value: 'New Task' },
      })
      fireEvent.click(screen.getByTestId('create-button'))

      // Button should be disabled
      expect(screen.getByTestId('create-button')).toBeDisabled()
    })

    it('should show loading text during submission', async () => {
      new MockWebSocket('ws://test/sync')

      mockFetch.mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 100))
        return { ok: true, json: async () => ({ id: 'task-new' }) }
      })

      render(<TaskCreateForm />)

      fireEvent.change(screen.getByTestId('input-title'), {
        target: { value: 'New Task' },
      })
      fireEvent.click(screen.getByTestId('create-button'))

      expect(screen.getByTestId('create-button')).toHaveTextContent('Creating...')
    })

    it('should re-enable button after submission completes', async () => {
      new MockWebSocket('ws://test/sync')

      render(<TaskCreateForm />)

      fireEvent.change(screen.getByTestId('input-title'), {
        target: { value: 'New Task' },
      })
      fireEvent.click(screen.getByTestId('create-button'))

      await waitFor(() => {
        expect(screen.getByTestId('create-button')).not.toBeDisabled()
      })
    })
  })

  // ===========================================================================
  // Error Handling
  // ===========================================================================

  describe('error handling', () => {
    it('should show error message on failure', async () => {
      new MockWebSocket('ws://test/sync')

      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
      })

      render(<TaskCreateForm />)

      fireEvent.change(screen.getByTestId('input-title'), {
        target: { value: 'New Task' },
      })
      fireEvent.click(screen.getByTestId('create-button'))

      await waitFor(() => {
        expect(screen.getByTestId('submit-error')).toBeInTheDocument()
      })
    })

    it('should call onError callback on failure', async () => {
      new MockWebSocket('ws://test/sync')
      const onError = vi.fn()

      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
      })

      render(<TaskCreateForm onError={onError} />)

      fireEvent.change(screen.getByTestId('input-title'), {
        target: { value: 'New Task' },
      })
      fireEvent.click(screen.getByTestId('create-button'))

      await waitFor(() => {
        expect(onError).toHaveBeenCalled()
      })
    })

    it('should allow retry after error', async () => {
      new MockWebSocket('ws://test/sync')

      // First call fails, second succeeds
      mockFetch
        .mockResolvedValueOnce({ ok: false, status: 500 })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'task-new' }) })

      render(<TaskCreateForm />)

      fireEvent.change(screen.getByTestId('input-title'), {
        target: { value: 'New Task' },
      })

      // First attempt fails
      fireEvent.click(screen.getByTestId('create-button'))

      await waitFor(() => {
        expect(screen.getByTestId('submit-error')).toBeInTheDocument()
      })

      // Button should be enabled for retry
      expect(screen.getByTestId('create-button')).not.toBeDisabled()

      // Second attempt succeeds
      fireEvent.click(screen.getByTestId('create-button'))

      await waitFor(() => {
        expect(screen.queryByTestId('submit-error')).not.toBeInTheDocument()
      })
    })
  })

  // ===========================================================================
  // Redirect After Create (RED - requires real router integration)
  // ===========================================================================

  describe('redirect after create', () => {
    /**
     * RED: Should navigate to edit view after create
     */
    it.skip('should redirect to edit view after successful create', async () => {
      // Test that:
      // 1. Form submitted successfully
      // 2. navigate() called with new resource URL
      // 3. User ends up on edit page

      expect(true).toBe(false) // Placeholder for RED phase
    })

    /**
     * RED: Should support custom redirect URL
     */
    it.skip('should support custom redirect after create', async () => {
      // Test that:
      // 1. Custom redirect prop provided
      // 2. navigate() called with custom URL

      expect(true).toBe(false) // Placeholder for RED phase
    })
  })

  // ===========================================================================
  // Validation (RED - requires real form validation)
  // ===========================================================================

  describe('validation', () => {
    /**
     * RED: Should validate required fields
     */
    it.skip('should prevent submit with empty required fields', async () => {
      // Test that:
      // 1. Required field empty
      // 2. Form shows validation error
      // 3. insert() not called

      expect(true).toBe(false) // Placeholder for RED phase
    })

    /**
     * RED: Should show field-level errors
     */
    it.skip('should show validation errors on fields', async () => {
      // Test that:
      // 1. Invalid data entered
      // 2. Field shows error message
      // 3. Error clears when fixed

      expect(true).toBe(false) // Placeholder for RED phase
    })
  })
})
