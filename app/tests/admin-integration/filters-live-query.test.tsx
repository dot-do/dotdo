/**
 * Filters + useLiveQuery Integration Tests (TDD RED Phase)
 *
 * Tests for integrating @mdxui/admin filter components with @dotdo/react
 * useLiveQuery hook for reactive filtering.
 *
 * Test Cases:
 * - Filter controls update query
 * - Results update reactively
 * - Sort state preserved
 *
 * Note: This depends on dotdo-jbfgt (GREEN phase for @dotdo/react hooks)
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as React from 'react'
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react'

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
// Test Types
// =============================================================================

interface Task {
  $id: string
  title: string
  status: 'todo' | 'in_progress' | 'done'
  priority: number
  assignee: string | null
  createdAt: string
}

// =============================================================================
// Test Fixtures
// =============================================================================

const mockTasks: Task[] = [
  { $id: 'task-1', title: 'Setup project', status: 'done', priority: 1, assignee: 'alice', createdAt: '2024-01-01T00:00:00Z' },
  { $id: 'task-2', title: 'Write tests', status: 'in_progress', priority: 2, assignee: 'bob', createdAt: '2024-01-02T00:00:00Z' },
  { $id: 'task-3', title: 'Deploy app', status: 'todo', priority: 3, assignee: null, createdAt: '2024-01-03T00:00:00Z' },
  { $id: 'task-4', title: 'Fix bugs', status: 'todo', priority: 1, assignee: 'alice', createdAt: '2024-01-04T00:00:00Z' },
  { $id: 'task-5', title: 'Review code', status: 'in_progress', priority: 2, assignee: 'charlie', createdAt: '2024-01-05T00:00:00Z' },
]

// =============================================================================
// Mock Components
// =============================================================================

// Mock FilterForm from @mdxui/admin
interface FilterFormProps {
  children: React.ReactNode
  onSubmit?: (filters: Record<string, unknown>) => void
  onClear?: () => void
}

function MockFilterForm({ children, onSubmit, onClear }: FilterFormProps) {
  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    const filters: Record<string, unknown> = {}
    formData.forEach((value, key) => {
      if (value !== '') {
        filters[key] = value
      }
    })
    onSubmit?.(filters)
  }

  const handleClear = () => {
    onClear?.()
  }

  return (
    <form data-testid="filter-form" onSubmit={handleSubmit}>
      <div data-testid="filter-inputs">{children}</div>
      <button type="submit" data-testid="apply-filters">Apply</button>
      <button type="button" onClick={handleClear} data-testid="clear-filters">Clear</button>
    </form>
  )
}

// Mock SelectInput for filters
interface FilterSelectProps {
  source: string
  label: string
  choices: { id: string; name: string }[]
  allowEmpty?: boolean
}

function MockFilterSelect({ source, label, choices, allowEmpty = true }: FilterSelectProps) {
  return (
    <div>
      <label htmlFor={source}>{label}</label>
      <select id={source} name={source} data-testid={`filter-${source}`}>
        {allowEmpty && <option value="">All</option>}
        {choices.map(choice => (
          <option key={choice.id} value={choice.id}>{choice.name}</option>
        ))}
      </select>
    </div>
  )
}

// Mock SearchInput for text search
interface SearchInputProps {
  source: string
  placeholder?: string
}

function MockSearchInput({ source, placeholder }: SearchInputProps) {
  return (
    <input
      type="text"
      name={source}
      placeholder={placeholder}
      data-testid={`search-${source}`}
    />
  )
}

// Mock DataGrid
interface DataGridProps<T> {
  data: T[]
  rowKey?: keyof T
}

function MockDataGrid<T extends { $id: string }>({ data, rowKey = '$id' as keyof T }: DataGridProps<T>) {
  return (
    <table data-testid="datagrid" role="table">
      <tbody>
        {data.map(row => (
          <tr key={String(row[rowKey])} data-testid={`row-${row[rowKey]}`} role="row">
            <td>{(row as unknown as Task).title}</td>
            <td>{(row as unknown as Task).status}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// Mock useCollection hook
function useMockCollection<T>({ collection }: { collection: string }) {
  const [data, setData] = React.useState<T[]>([])
  const [isLoading, setIsLoading] = React.useState(true)

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
          // ignore
        }
      }

      ws.addEventListener('message', handleMessage as EventListener)
      return () => ws.removeEventListener('message', handleMessage as EventListener)
    }
  }, [collection])

  return { data, isLoading }
}

// Mock useLiveQuery hook
interface LiveQueryConfig<T> {
  from: string
  where?: Partial<T> | ((item: T) => boolean)
  orderBy?: keyof T
  order?: 'asc' | 'desc'
}

function useMockLiveQuery<T>(data: T[], config: LiveQueryConfig<T>): T[] {
  return React.useMemo(() => {
    let result = [...data]

    // Apply where filter
    if (config.where) {
      if (typeof config.where === 'function') {
        result = result.filter(config.where as (item: T) => boolean)
      } else {
        const whereObj = config.where as Partial<T>
        result = result.filter(item => {
          for (const [key, value] of Object.entries(whereObj)) {
            if (item[key as keyof T] !== value) return false
          }
          return true
        })
      }
    }

    // Apply ordering
    if (config.orderBy) {
      const orderKey = config.orderBy
      const direction = config.order === 'desc' ? -1 : 1
      result.sort((a, b) => {
        const aVal = a[orderKey]
        const bVal = b[orderKey]
        if (aVal < bVal) return -1 * direction
        if (aVal > bVal) return 1 * direction
        return 0
      })
    }

    return result
  }, [data, config.where, config.orderBy, config.order])
}

// =============================================================================
// Integrated Test Component
// =============================================================================

const statusChoices = [
  { id: 'todo', name: 'To Do' },
  { id: 'in_progress', name: 'In Progress' },
  { id: 'done', name: 'Done' },
]

const assigneeChoices = [
  { id: 'alice', name: 'Alice' },
  { id: 'bob', name: 'Bob' },
  { id: 'charlie', name: 'Charlie' },
]

function TaskListWithFilters() {
  const { data: allTasks, isLoading } = useMockCollection<Task>({ collection: 'Task' })
  const [filters, setFilters] = React.useState<Partial<Task>>({})
  const [sortConfig, setSortConfig] = React.useState<{ field: keyof Task; direction: 'asc' | 'desc' }>({
    field: 'createdAt',
    direction: 'desc',
  })

  // Apply filters and sorting using useLiveQuery
  const filteredTasks = useMockLiveQuery(allTasks, {
    from: 'Task',
    where: Object.keys(filters).length > 0 ? filters : undefined,
    orderBy: sortConfig.field,
    order: sortConfig.direction,
  })

  const handleApplyFilters = (newFilters: Record<string, unknown>) => {
    setFilters(newFilters as Partial<Task>)
  }

  const handleClearFilters = () => {
    setFilters({})
  }

  const handleSort = (field: keyof Task) => {
    setSortConfig(prev => ({
      field,
      direction: prev.field === field && prev.direction === 'asc' ? 'desc' : 'asc',
    }))
  }

  if (isLoading) {
    return <div data-testid="loading">Loading...</div>
  }

  return (
    <div data-testid="task-list-with-filters">
      <MockFilterForm onSubmit={handleApplyFilters} onClear={handleClearFilters}>
        <MockFilterSelect source="status" label="Status" choices={statusChoices} />
        <MockFilterSelect source="assignee" label="Assignee" choices={assigneeChoices} />
        <MockSearchInput source="title" placeholder="Search title..." />
      </MockFilterForm>

      <div data-testid="sort-controls">
        <button
          data-testid="sort-title"
          onClick={() => handleSort('title')}
        >
          Sort by Title {sortConfig.field === 'title' && (sortConfig.direction === 'asc' ? '\u2191' : '\u2193')}
        </button>
        <button
          data-testid="sort-priority"
          onClick={() => handleSort('priority')}
        >
          Sort by Priority {sortConfig.field === 'priority' && (sortConfig.direction === 'asc' ? '\u2191' : '\u2193')}
        </button>
      </div>

      <div data-testid="result-count">
        Showing {filteredTasks.length} of {allTasks.length} tasks
      </div>

      <MockDataGrid data={filteredTasks} />
    </div>
  )
}

// =============================================================================
// Test Suite
// =============================================================================

describe('Filters + useLiveQuery Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // @ts-expect-error - Replace global WebSocket
    global.WebSocket = MockWebSocket
    MockWebSocket.reset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    MockWebSocket.reset()
  })

  // ===========================================================================
  // Basic Filtering
  // ===========================================================================

  describe('basic filtering', () => {
    it('should display all tasks initially', async () => {
      const ws = new MockWebSocket('ws://test/sync')

      render(<TaskListWithFilters />)

      ws.simulateMessage({
        type: 'initial',
        collection: 'Task',
        data: mockTasks,
        txid: 1,
      })

      await waitFor(() => {
        expect(screen.getByTestId('result-count')).toHaveTextContent('Showing 5 of 5 tasks')
      })
    })

    it('should filter by status', async () => {
      const ws = new MockWebSocket('ws://test/sync')

      render(<TaskListWithFilters />)

      ws.simulateMessage({
        type: 'initial',
        collection: 'Task',
        data: mockTasks,
        txid: 1,
      })

      await waitFor(() => {
        expect(screen.getByTestId('filter-status')).toBeInTheDocument()
      })

      // Select status filter
      fireEvent.change(screen.getByTestId('filter-status'), {
        target: { value: 'todo' },
      })

      // Apply filters
      fireEvent.click(screen.getByTestId('apply-filters'))

      await waitFor(() => {
        expect(screen.getByTestId('result-count')).toHaveTextContent('Showing 2 of 5 tasks')
      })

      // Should show only todo tasks
      expect(screen.getByTestId('row-task-3')).toBeInTheDocument()
      expect(screen.getByTestId('row-task-4')).toBeInTheDocument()
      expect(screen.queryByTestId('row-task-1')).not.toBeInTheDocument()
    })

    it('should filter by assignee', async () => {
      const ws = new MockWebSocket('ws://test/sync')

      render(<TaskListWithFilters />)

      ws.simulateMessage({
        type: 'initial',
        collection: 'Task',
        data: mockTasks,
        txid: 1,
      })

      await waitFor(() => {
        expect(screen.getByTestId('filter-assignee')).toBeInTheDocument()
      })

      // Select assignee filter
      fireEvent.change(screen.getByTestId('filter-assignee'), {
        target: { value: 'alice' },
      })

      fireEvent.click(screen.getByTestId('apply-filters'))

      await waitFor(() => {
        expect(screen.getByTestId('result-count')).toHaveTextContent('Showing 2 of 5 tasks')
      })

      // Should show only alice's tasks
      expect(screen.getByTestId('row-task-1')).toBeInTheDocument()
      expect(screen.getByTestId('row-task-4')).toBeInTheDocument()
    })

    it('should clear filters', async () => {
      const ws = new MockWebSocket('ws://test/sync')

      render(<TaskListWithFilters />)

      ws.simulateMessage({
        type: 'initial',
        collection: 'Task',
        data: mockTasks,
        txid: 1,
      })

      await waitFor(() => {
        expect(screen.getByTestId('filter-status')).toBeInTheDocument()
      })

      // Apply status filter
      fireEvent.change(screen.getByTestId('filter-status'), {
        target: { value: 'done' },
      })
      fireEvent.click(screen.getByTestId('apply-filters'))

      await waitFor(() => {
        expect(screen.getByTestId('result-count')).toHaveTextContent('Showing 1 of 5 tasks')
      })

      // Clear filters
      fireEvent.click(screen.getByTestId('clear-filters'))

      await waitFor(() => {
        expect(screen.getByTestId('result-count')).toHaveTextContent('Showing 5 of 5 tasks')
      })
    })
  })

  // ===========================================================================
  // Reactive Updates
  // ===========================================================================

  describe('reactive updates', () => {
    it('should update filtered results when data changes', async () => {
      const ws = new MockWebSocket('ws://test/sync')

      render(<TaskListWithFilters />)

      ws.simulateMessage({
        type: 'initial',
        collection: 'Task',
        data: mockTasks,
        txid: 1,
      })

      await waitFor(() => {
        expect(screen.getByTestId('filter-status')).toBeInTheDocument()
      })

      // Filter to show only todo tasks
      fireEvent.change(screen.getByTestId('filter-status'), {
        target: { value: 'todo' },
      })
      fireEvent.click(screen.getByTestId('apply-filters'))

      await waitFor(() => {
        expect(screen.getByTestId('result-count')).toHaveTextContent('Showing 2 of 5 tasks')
      })

      // Insert new todo task
      ws.simulateMessage({
        type: 'insert',
        collection: 'Task',
        data: { $id: 'task-6', title: 'New todo', status: 'todo', priority: 1, assignee: null, createdAt: '2024-01-06T00:00:00Z' },
        txid: 2,
      })

      await waitFor(() => {
        expect(screen.getByTestId('result-count')).toHaveTextContent('Showing 3 of 6 tasks')
      })
    })

    it('should update when filtered item status changes', async () => {
      const ws = new MockWebSocket('ws://test/sync')

      render(<TaskListWithFilters />)

      ws.simulateMessage({
        type: 'initial',
        collection: 'Task',
        data: mockTasks,
        txid: 1,
      })

      await waitFor(() => {
        expect(screen.getByTestId('filter-status')).toBeInTheDocument()
      })

      // Filter to show only todo tasks
      fireEvent.change(screen.getByTestId('filter-status'), {
        target: { value: 'todo' },
      })
      fireEvent.click(screen.getByTestId('apply-filters'))

      await waitFor(() => {
        expect(screen.getByTestId('result-count')).toHaveTextContent('Showing 2 of 5 tasks')
      })

      // Update task-3 to done (should disappear from filtered results)
      ws.simulateMessage({
        type: 'update',
        collection: 'Task',
        key: 'task-3',
        data: { ...mockTasks[2], status: 'done' },
        txid: 2,
      })

      await waitFor(() => {
        expect(screen.getByTestId('result-count')).toHaveTextContent('Showing 1 of 5 tasks')
        expect(screen.queryByTestId('row-task-3')).not.toBeInTheDocument()
      })
    })

    it('should handle deleted items in filtered view', async () => {
      const ws = new MockWebSocket('ws://test/sync')

      render(<TaskListWithFilters />)

      ws.simulateMessage({
        type: 'initial',
        collection: 'Task',
        data: mockTasks,
        txid: 1,
      })

      await waitFor(() => {
        expect(screen.getByTestId('filter-status')).toBeInTheDocument()
      })

      // Filter to show only todo tasks
      fireEvent.change(screen.getByTestId('filter-status'), {
        target: { value: 'todo' },
      })
      fireEvent.click(screen.getByTestId('apply-filters'))

      await waitFor(() => {
        expect(screen.getByTestId('result-count')).toHaveTextContent('Showing 2 of 5 tasks')
      })

      // Delete task-3
      ws.simulateMessage({
        type: 'delete',
        collection: 'Task',
        key: 'task-3',
        txid: 2,
      })

      await waitFor(() => {
        expect(screen.getByTestId('result-count')).toHaveTextContent('Showing 1 of 4 tasks')
      })
    })
  })

  // ===========================================================================
  // Sorting
  // ===========================================================================

  describe('sorting', () => {
    it('should sort by title', async () => {
      const ws = new MockWebSocket('ws://test/sync')

      render(<TaskListWithFilters />)

      ws.simulateMessage({
        type: 'initial',
        collection: 'Task',
        data: mockTasks,
        txid: 1,
      })

      await waitFor(() => {
        expect(screen.getByTestId('sort-title')).toBeInTheDocument()
      })

      // Click sort by title
      fireEvent.click(screen.getByTestId('sort-title'))

      await waitFor(() => {
        const rows = screen.getAllByRole('row')
        // First row should be "Deploy app" (alphabetically first)
        expect(within(rows[0]).getByText('Deploy app')).toBeInTheDocument()
      })
    })

    it('should toggle sort direction', async () => {
      const ws = new MockWebSocket('ws://test/sync')

      render(<TaskListWithFilters />)

      ws.simulateMessage({
        type: 'initial',
        collection: 'Task',
        data: mockTasks,
        txid: 1,
      })

      await waitFor(() => {
        expect(screen.getByTestId('sort-title')).toBeInTheDocument()
      })

      // Click sort by title (ascending)
      fireEvent.click(screen.getByTestId('sort-title'))

      await waitFor(() => {
        expect(screen.getByTestId('sort-title')).toHaveTextContent('\u2191') // Up arrow
      })

      // Click again (descending)
      fireEvent.click(screen.getByTestId('sort-title'))

      await waitFor(() => {
        expect(screen.getByTestId('sort-title')).toHaveTextContent('\u2193') // Down arrow
      })
    })

    it('should preserve sort when filters change', async () => {
      const ws = new MockWebSocket('ws://test/sync')

      render(<TaskListWithFilters />)

      ws.simulateMessage({
        type: 'initial',
        collection: 'Task',
        data: mockTasks,
        txid: 1,
      })

      await waitFor(() => {
        expect(screen.getByTestId('sort-priority')).toBeInTheDocument()
      })

      // Sort by priority
      fireEvent.click(screen.getByTestId('sort-priority'))

      // Apply status filter
      fireEvent.change(screen.getByTestId('filter-status'), {
        target: { value: 'todo' },
      })
      fireEvent.click(screen.getByTestId('apply-filters'))

      await waitFor(() => {
        // Sort should still be active
        expect(screen.getByTestId('sort-priority')).toHaveTextContent('\u2191')
      })
    })
  })

  // ===========================================================================
  // Combined Filters (RED - requires real implementation)
  // ===========================================================================

  describe('combined filters', () => {
    /**
     * RED: Should support multiple filters at once
     */
    it.skip('should apply multiple filters simultaneously', async () => {
      // Test that:
      // 1. Status = todo AND assignee = alice
      // 2. Results show only matching items

      expect(true).toBe(false) // Placeholder for RED phase
    })

    /**
     * RED: Should support text search with other filters
     */
    it.skip('should combine text search with dropdown filters', async () => {
      // Test that:
      // 1. Search "deploy" AND status = todo
      // 2. Results match both criteria

      expect(true).toBe(false) // Placeholder for RED phase
    })
  })

  // ===========================================================================
  // URL Sync (RED - requires router integration)
  // ===========================================================================

  describe('URL sync', () => {
    /**
     * RED: Filter state should sync to URL
     */
    it.skip('should persist filters in URL params', async () => {
      // Test that:
      // 1. Apply filter
      // 2. URL updated with filter params
      // 3. Page refresh restores filters

      expect(true).toBe(false) // Placeholder for RED phase
    })

    /**
     * RED: Sort state should sync to URL
     */
    it.skip('should persist sort in URL params', async () => {
      // Test that:
      // 1. Apply sort
      // 2. URL updated with sort params

      expect(true).toBe(false) // Placeholder for RED phase
    })
  })
})
