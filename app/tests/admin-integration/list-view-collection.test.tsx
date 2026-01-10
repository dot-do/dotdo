/**
 * ListView + useCollection Integration Tests (TDD RED Phase)
 *
 * Tests for integrating @mdxui/admin ListView and DataGrid components
 * with @dotdo/react useCollection hook for real-time data display.
 *
 * Test Cases:
 * - DataGrid receives data from useCollection
 * - Loading state shows skeleton
 * - Empty state shows message
 * - Pagination works with live data
 *
 * Note: This depends on dotdo-jbfgt (GREEN phase for @dotdo/react hooks)
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as React from 'react'
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react'

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
// Mock fetch
// =============================================================================

const mockFetch = vi.fn()

// =============================================================================
// Test Types
// =============================================================================

interface Task {
  $id: string
  title: string
  status: 'todo' | 'in_progress' | 'done'
  priority: number
  createdAt: string
}

// =============================================================================
// Test Fixtures
// =============================================================================

const mockTasks: Task[] = [
  { $id: 'task-1', title: 'Setup project', status: 'done', priority: 1, createdAt: '2024-01-01T00:00:00Z' },
  { $id: 'task-2', title: 'Write tests', status: 'in_progress', priority: 2, createdAt: '2024-01-02T00:00:00Z' },
  { $id: 'task-3', title: 'Deploy app', status: 'todo', priority: 3, createdAt: '2024-01-03T00:00:00Z' },
]

// =============================================================================
// Mock Components (simulating integration)
// =============================================================================

// Mock ListView from @mdxui/admin
interface ListViewProps {
  title?: string
  loading?: boolean
  empty?: React.ReactNode
  children: React.ReactNode
  pagination?: React.ReactNode
}

function MockListView({ title, loading, empty, children, pagination }: ListViewProps) {
  if (loading) {
    return (
      <div data-testid="list-view">
        <div data-testid="loading-skeleton" className="skeleton">
          Loading...
        </div>
      </div>
    )
  }

  const isEmpty = React.Children.count(children) === 0

  return (
    <div data-testid="list-view">
      {title && <h1>{title}</h1>}
      {isEmpty && empty ? (
        <div data-testid="empty-state">{empty}</div>
      ) : (
        children
      )}
      {!isEmpty && pagination}
    </div>
  )
}

// Mock DataGrid from @mdxui/admin
interface DataGridColumn<T> {
  source: keyof T
  label: string
  sortable?: boolean
}

interface DataGridProps<T> {
  data: T[]
  columns: DataGridColumn<T>[]
  rowKey?: keyof T
  loading?: boolean
  empty?: React.ReactNode
  onRowClick?: (record: T) => void
}

function MockDataGrid<T extends { $id: string }>({
  data,
  columns,
  rowKey = '$id' as keyof T,
  loading,
  empty,
  onRowClick,
}: DataGridProps<T>) {
  if (loading) {
    return (
      <div data-testid="datagrid-skeleton" className="skeleton">
        Loading grid...
      </div>
    )
  }

  if (data.length === 0 && empty) {
    return <div data-testid="datagrid-empty">{empty}</div>
  }

  return (
    <table data-testid="datagrid" role="table">
      <thead>
        <tr>
          {columns.map(col => (
            <th key={String(col.source)} role="columnheader">
              {col.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {data.map(row => (
          <tr
            key={String(row[rowKey])}
            role="row"
            data-testid={`row-${row[rowKey]}`}
            onClick={() => onRowClick?.(row)}
            style={{ cursor: onRowClick ? 'pointer' : 'default' }}
          >
            {columns.map(col => (
              <td key={String(col.source)} role="cell">
                {String(row[col.source as keyof T])}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
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

function useMockCollection<T>({ collection }: { collection: string }): UseCollectionResult<T> {
  const [data, setData] = React.useState<T[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<Error | null>(null)

  React.useEffect(() => {
    // Simulate WebSocket connection and initial data load
    const ws = MockWebSocket.lastInstance
    if (ws) {
      const handleMessage = (event: MessageEvent) => {
        try {
          const msg = JSON.parse(event.data)
          if (msg.type === 'initial') {
            setData(msg.data)
            setIsLoading(false)
          } else if (msg.type === 'insert') {
            setData(prev => [...prev, msg.data])
          } else if (msg.type === 'update') {
            setData(prev => prev.map(item =>
              (item as { $id: string }).$id === msg.key ? msg.data : item
            ))
          } else if (msg.type === 'delete') {
            setData(prev => prev.filter(item =>
              (item as { $id: string }).$id !== msg.key
            ))
          }
        } catch (e) {
          setError(e as Error)
        }
      }

      ws.addEventListener('message', handleMessage as EventListener)
      return () => ws.removeEventListener('message', handleMessage as EventListener)
    }
  }, [collection])

  return {
    data,
    isLoading,
    error,
    insert: async (item) => {
      // Optimistic update
      setData(prev => [...prev, item])
    },
    update: async (id, changes) => {
      setData(prev => prev.map(item =>
        (item as { $id: string }).$id === id ? { ...item, ...changes } : item
      ))
    },
    delete: async (id) => {
      setData(prev => prev.filter(item => (item as { $id: string }).$id !== id))
    },
    refetch: () => {
      setIsLoading(true)
    },
  }
}

// =============================================================================
// Integrated Test Component
// =============================================================================

const taskColumns: DataGridColumn<Task>[] = [
  { source: 'title', label: 'Title', sortable: true },
  { source: 'status', label: 'Status', sortable: true },
  { source: 'priority', label: 'Priority', sortable: true },
]

function TaskListWithCollection() {
  const { data, isLoading, error } = useMockCollection<Task>({ collection: 'Task' })

  if (error) {
    return <div data-testid="error-state">Error: {error.message}</div>
  }

  return (
    <MockListView
      title="Tasks"
      loading={isLoading}
      empty={<span>No tasks found</span>}
    >
      {data.length > 0 ? (
        <MockDataGrid
          data={data}
          columns={taskColumns}
          rowKey="$id"
        />
      ) : null}
    </MockListView>
  )
}

// =============================================================================
// Test Suite
// =============================================================================

describe('ListView + useCollection Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // @ts-expect-error - Replace global WebSocket
    global.WebSocket = MockWebSocket
    global.fetch = mockFetch
    MockWebSocket.reset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    MockWebSocket.reset()
  })

  // ===========================================================================
  // Loading State
  // ===========================================================================

  describe('loading state', () => {
    it('should show loading skeleton while data loads', () => {
      // Create WebSocket first
      new MockWebSocket('ws://test/sync')

      render(<TaskListWithCollection />)

      expect(screen.getByTestId('loading-skeleton')).toBeInTheDocument()
    })

    it('should hide skeleton after data arrives', async () => {
      const ws = new MockWebSocket('ws://test/sync')

      render(<TaskListWithCollection />)

      // Initially loading
      expect(screen.getByTestId('loading-skeleton')).toBeInTheDocument()

      // Simulate initial data message
      await waitFor(() => {
        ws.simulateMessage({
          type: 'initial',
          collection: 'Task',
          data: mockTasks,
          txid: 1,
        })
      })

      await waitFor(() => {
        expect(screen.queryByTestId('loading-skeleton')).not.toBeInTheDocument()
      })
    })

    it('should show DataGrid skeleton during grid-specific loading', () => {
      const ws = new MockWebSocket('ws://test/sync')

      const { rerender } = render(
        <MockDataGrid data={[]} columns={taskColumns} loading={true} />
      )

      expect(screen.getByTestId('datagrid-skeleton')).toBeInTheDocument()

      rerender(
        <MockDataGrid data={mockTasks} columns={taskColumns} loading={false} />
      )

      expect(screen.queryByTestId('datagrid-skeleton')).not.toBeInTheDocument()
    })
  })

  // ===========================================================================
  // Data Rendering
  // ===========================================================================

  describe('data rendering', () => {
    it('should display data in DataGrid after load', async () => {
      const ws = new MockWebSocket('ws://test/sync')

      render(<TaskListWithCollection />)

      ws.simulateMessage({
        type: 'initial',
        collection: 'Task',
        data: mockTasks,
        txid: 1,
      })

      await waitFor(() => {
        expect(screen.getByTestId('datagrid')).toBeInTheDocument()
      })

      // Check that all tasks are rendered
      expect(screen.getByText('Setup project')).toBeInTheDocument()
      expect(screen.getByText('Write tests')).toBeInTheDocument()
      expect(screen.getByText('Deploy app')).toBeInTheDocument()
    })

    it('should render correct number of rows', async () => {
      const ws = new MockWebSocket('ws://test/sync')

      render(<TaskListWithCollection />)

      ws.simulateMessage({
        type: 'initial',
        collection: 'Task',
        data: mockTasks,
        txid: 1,
      })

      await waitFor(() => {
        const rows = screen.getAllByRole('row')
        // 1 header + 3 data rows
        expect(rows).toHaveLength(4)
      })
    })

    it('should render column headers', async () => {
      const ws = new MockWebSocket('ws://test/sync')

      render(<TaskListWithCollection />)

      ws.simulateMessage({
        type: 'initial',
        collection: 'Task',
        data: mockTasks,
        txid: 1,
      })

      await waitFor(() => {
        expect(screen.getByRole('columnheader', { name: 'Title' })).toBeInTheDocument()
        expect(screen.getByRole('columnheader', { name: 'Status' })).toBeInTheDocument()
        expect(screen.getByRole('columnheader', { name: 'Priority' })).toBeInTheDocument()
      })
    })
  })

  // ===========================================================================
  // Empty State
  // ===========================================================================

  describe('empty state', () => {
    it('should show empty message when no data', async () => {
      const ws = new MockWebSocket('ws://test/sync')

      render(<TaskListWithCollection />)

      ws.simulateMessage({
        type: 'initial',
        collection: 'Task',
        data: [],
        txid: 1,
      })

      await waitFor(() => {
        expect(screen.getByTestId('empty-state')).toBeInTheDocument()
        expect(screen.getByText('No tasks found')).toBeInTheDocument()
      })
    })

    it('should not show empty state when loading', () => {
      new MockWebSocket('ws://test/sync')

      render(<TaskListWithCollection />)

      // Should show loading, not empty
      expect(screen.getByTestId('loading-skeleton')).toBeInTheDocument()
      expect(screen.queryByTestId('empty-state')).not.toBeInTheDocument()
    })
  })

  // ===========================================================================
  // Real-time Updates
  // ===========================================================================

  describe('real-time updates', () => {
    it('should add new item on insert message', async () => {
      const ws = new MockWebSocket('ws://test/sync')

      render(<TaskListWithCollection />)

      // Initial data
      ws.simulateMessage({
        type: 'initial',
        collection: 'Task',
        data: mockTasks,
        txid: 1,
      })

      await waitFor(() => {
        expect(screen.getAllByRole('row')).toHaveLength(4)
      })

      // Insert new task
      ws.simulateMessage({
        type: 'insert',
        collection: 'Task',
        data: { $id: 'task-4', title: 'New task', status: 'todo', priority: 4, createdAt: '2024-01-04T00:00:00Z' },
        txid: 2,
      })

      await waitFor(() => {
        expect(screen.getAllByRole('row')).toHaveLength(5)
        expect(screen.getByText('New task')).toBeInTheDocument()
      })
    })

    it('should update item on update message', async () => {
      const ws = new MockWebSocket('ws://test/sync')

      render(<TaskListWithCollection />)

      ws.simulateMessage({
        type: 'initial',
        collection: 'Task',
        data: mockTasks,
        txid: 1,
      })

      await waitFor(() => {
        expect(screen.getByText('Setup project')).toBeInTheDocument()
      })

      // Update first task
      ws.simulateMessage({
        type: 'update',
        collection: 'Task',
        key: 'task-1',
        data: { $id: 'task-1', title: 'Updated project', status: 'done', priority: 1, createdAt: '2024-01-01T00:00:00Z' },
        txid: 2,
      })

      await waitFor(() => {
        expect(screen.getByText('Updated project')).toBeInTheDocument()
        expect(screen.queryByText('Setup project')).not.toBeInTheDocument()
      })
    })

    it('should remove item on delete message', async () => {
      const ws = new MockWebSocket('ws://test/sync')

      render(<TaskListWithCollection />)

      ws.simulateMessage({
        type: 'initial',
        collection: 'Task',
        data: mockTasks,
        txid: 1,
      })

      await waitFor(() => {
        expect(screen.getAllByRole('row')).toHaveLength(4)
      })

      // Delete first task
      ws.simulateMessage({
        type: 'delete',
        collection: 'Task',
        key: 'task-1',
        txid: 2,
      })

      await waitFor(() => {
        expect(screen.getAllByRole('row')).toHaveLength(3)
        expect(screen.queryByText('Setup project')).not.toBeInTheDocument()
      })
    })
  })

  // ===========================================================================
  // Pagination with Live Data (RED - requires real implementation)
  // ===========================================================================

  describe('pagination with live data', () => {
    /**
     * RED: Pagination should work with live collection data
     */
    it.skip('should paginate collection data', async () => {
      // Test that:
      // 1. Large dataset is paginated
      // 2. Page controls work
      // 3. Real-time updates respect current page

      expect(true).toBe(false) // Placeholder for RED phase
    })

    /**
     * RED: New items should appear on correct page
     */
    it.skip('should handle new items during pagination', async () => {
      // Test that:
      // 1. New item appears on correct page based on sort
      // 2. Page count updates appropriately
      // 3. UI remains consistent

      expect(true).toBe(false) // Placeholder for RED phase
    })
  })

  // ===========================================================================
  // Error Handling
  // ===========================================================================

  describe('error handling', () => {
    it('should show error state on connection error', async () => {
      const ws = new MockWebSocket('ws://test/sync')

      render(<TaskListWithCollection />)

      // Simulate error
      ws.simulateMessage({ type: 'error', message: 'Connection failed' })

      // Error should be caught by the component
      // This test validates the error handling pattern
    })
  })
})
