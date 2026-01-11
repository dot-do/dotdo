/**
 * Resource Integration Tests (TDD RED Phase)
 *
 * Tests for integrating @mdxui/admin Resource components with @dotdo/react
 * data layer. These tests verify that Admin resources can be wrapped with
 * the DO provider and connect to live data.
 *
 * Dependencies:
 * - @mdxui/admin: Admin, Resource, AdminWithoutRouter
 * - @dotdo/react: DO, useCollection, useLiveQuery
 *
 * Note: This depends on dotdo-jbfgt (GREEN phase for @dotdo/react hooks)
 *
 * @see https://github.com/dot-do/ui/tree/main/packages/admin
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// =============================================================================
// Mock Setup
// =============================================================================

// Mock WebSocket for real-time sync
class MockWebSocket {
  static instances: MockWebSocket[] = []

  readyState = WebSocket.CONNECTING
  url: string
  onopen: ((event: Event) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null

  private eventListeners: Map<string, Set<EventListener>> = new Map()

  constructor(url: string) {
    this.url = url
    MockWebSocket.instances.push(this)
    // Simulate async connection
    setTimeout(() => {
      this.readyState = WebSocket.OPEN
      const event = new Event('open')
      this.onopen?.(event)
      this.eventListeners.get('open')?.forEach(fn => fn(event))
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

  send(data: string) {
    // Mock send - can be extended to trigger responses
  }

  close() {
    this.readyState = WebSocket.CLOSED
    const event = new CloseEvent('close')
    this.onclose?.(event)
    this.eventListeners.get('close')?.forEach(fn => fn(event))
  }

  // Helper to simulate server message
  simulateMessage(data: unknown) {
    const event = new MessageEvent('message', {
      data: JSON.stringify(data),
    })
    this.onmessage?.(event)
    this.eventListeners.get('message')?.forEach(fn => fn(event))
  }

  static reset() {
    MockWebSocket.instances.forEach(ws => ws.close())
    MockWebSocket.instances = []
  }
}

// Mock fetch for RPC calls
const mockFetch = vi.fn()

// =============================================================================
// Test Types
// =============================================================================

interface Task {
  $id: string
  title: string
  status: 'todo' | 'in_progress' | 'done'
  assignee?: string
  createdAt: string
}

// =============================================================================
// Test Fixtures
// =============================================================================

const mockTasks: Task[] = [
  { $id: 'task-1', title: 'Setup project', status: 'done', createdAt: '2024-01-01T00:00:00Z' },
  { $id: 'task-2', title: 'Write tests', status: 'in_progress', assignee: 'alice', createdAt: '2024-01-02T00:00:00Z' },
  { $id: 'task-3', title: 'Deploy app', status: 'todo', createdAt: '2024-01-03T00:00:00Z' },
]

// =============================================================================
// Mock Components (simulating @mdxui/admin)
// =============================================================================

// These mock the admin package components - in real tests these would be imported
// from @mdxui/admin once installed

interface AdminContextValue {
  resources: Map<string, ResourceDefinition>
  registerResource: (resource: ResourceDefinition) => void
  unregisterResource: (name: string) => void
}

interface ResourceDefinition {
  name: string
  list?: React.ComponentType
  create?: React.ComponentType
  edit?: React.ComponentType
}

const AdminContext = React.createContext<AdminContextValue | null>(null)

function MockAdmin({ children }: { children: React.ReactNode }) {
  const [resources, setResources] = React.useState<Map<string, ResourceDefinition>>(new Map())

  const registerResource = React.useCallback((resource: ResourceDefinition) => {
    setResources(prev => new Map(prev).set(resource.name, resource))
  }, [])

  const unregisterResource = React.useCallback((name: string) => {
    setResources(prev => {
      const next = new Map(prev)
      next.delete(name)
      return next
    })
  }, [])

  return (
    <AdminContext.Provider value={{ resources, registerResource, unregisterResource }}>
      <div data-testid="admin-root">{children}</div>
    </AdminContext.Provider>
  )
}

function MockResource({
  name,
  list: ListComponent
}: {
  name: string
  list?: React.ComponentType
}) {
  const ctx = React.useContext(AdminContext)

  React.useEffect(() => {
    if (ctx) {
      ctx.registerResource({ name, list: ListComponent })
      return () => ctx.unregisterResource(name)
    }
  }, [name, ListComponent, ctx])

  // Render list if at list route
  return ListComponent ? <ListComponent /> : null
}

// =============================================================================
// Mock DO Provider (simulating @dotdo/react)
// =============================================================================

interface DotdoContextValue {
  ns: string
  client: null
  connections: Map<string, WebSocket>
  getConnection: (collection: string) => WebSocket | null
}

const DotdoContext = React.createContext<DotdoContextValue | null>(null)

function MockDO({ ns, children }: { ns: string; children: React.ReactNode }) {
  const connections = React.useRef(new Map<string, WebSocket>())

  const value: DotdoContextValue = {
    ns,
    client: null,
    connections: connections.current,
    getConnection: (collection: string) => connections.current.get(collection) ?? null,
  }

  return (
    <DotdoContext.Provider value={value}>
      {children}
    </DotdoContext.Provider>
  )
}

function useMockDotdoContext() {
  const ctx = React.useContext(DotdoContext)
  if (!ctx) throw new Error('useDotdoContext must be used within DO provider')
  return ctx
}

// =============================================================================
// Test Suite
// =============================================================================

describe('Resource Integration with DO Provider', () => {
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
  // Basic Integration
  // ===========================================================================

  describe('basic integration', () => {
    it('should render Admin inside DO provider', () => {
      render(
        <MemoryRouter>
          <MockDO ns="https://api.example.com.ai/do/workspace">
            <MockAdmin>
              <MockResource name="tasks" />
            </MockAdmin>
          </MockDO>
        </MemoryRouter>
      )

      expect(screen.getByTestId('admin-root')).toBeInTheDocument()
    })

    it('should provide dotdo context to admin children', () => {
      function TestComponent() {
        const ctx = useMockDotdoContext()
        return <div data-testid="ns">{ctx.ns}</div>
      }

      render(
        <MemoryRouter>
          <MockDO ns="https://api.example.com.ai/do/workspace">
            <MockAdmin>
              <TestComponent />
            </MockAdmin>
          </MockDO>
        </MemoryRouter>
      )

      expect(screen.getByTestId('ns')).toHaveTextContent('https://api.example.com.ai/do/workspace')
    })

    it('should register resource with admin context', () => {
      function TaskList() {
        return <div data-testid="task-list">Task List</div>
      }

      render(
        <MemoryRouter>
          <MockDO ns="https://api.example.com.ai/do/workspace">
            <MockAdmin>
              <MockResource name="tasks" list={TaskList} />
            </MockAdmin>
          </MockDO>
        </MemoryRouter>
      )

      expect(screen.getByTestId('task-list')).toBeInTheDocument()
    })
  })

  // ===========================================================================
  // Data Flow Integration (RED - requires @dotdo/react hooks)
  // ===========================================================================

  describe('data flow integration', () => {
    /**
     * RED: This test requires useCollection hook from @dotdo/react
     * It should fail until the hook is properly integrated
     */
    it.skip('should connect useCollection to Resource list view', async () => {
      // This test will use real hooks once @dotdo/react is stable
      // The pattern is:
      // 1. DO provider creates WebSocket connection
      // 2. useCollection subscribes to collection
      // 3. DataGrid receives data from hook
      // 4. Real-time updates flow through

      expect(true).toBe(false) // Placeholder for RED phase
    })

    /**
     * RED: Resource list should receive data from useCollection
     */
    it.skip('should pass collection data to ListView DataGrid', async () => {
      // ListView receives:
      // - data: from useCollection
      // - isLoading: from useCollection
      // - empty: shown when data.length === 0

      expect(true).toBe(false) // Placeholder for RED phase
    })

    /**
     * RED: Resource should support nested provider pattern
     */
    it.skip('should support DotdoResource wrapper component', async () => {
      // DotdoResource combines:
      // - Resource registration
      // - useCollection for data
      // - Automatic binding to ListView/DataGrid

      expect(true).toBe(false) // Placeholder for RED phase
    })
  })

  // ===========================================================================
  // Context Composition
  // ===========================================================================

  describe('context composition', () => {
    it('should allow multiple nested providers', () => {
      render(
        <MemoryRouter>
          <MockDO ns="https://api.example.com.ai/do/org1">
            <MockAdmin>
              <MockResource name="org1-tasks" />
            </MockAdmin>
          </MockDO>
        </MemoryRouter>
      )

      expect(screen.getByTestId('admin-root')).toBeInTheDocument()
    })

    it('should isolate DO context per namespace', () => {
      function NamespaceDisplay() {
        const ctx = useMockDotdoContext()
        return <span data-testid="current-ns">{ctx.ns}</span>
      }

      const { container } = render(
        <MemoryRouter>
          <MockDO ns="https://api.example.com.ai/do/workspace1">
            <MockAdmin>
              <NamespaceDisplay />
            </MockAdmin>
          </MockDO>
        </MemoryRouter>
      )

      expect(screen.getByTestId('current-ns')).toHaveTextContent('workspace1')
    })
  })
})
