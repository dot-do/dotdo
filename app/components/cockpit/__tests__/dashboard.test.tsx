/**
 * Dashboard Components Tests
 *
 * Comprehensive tests for cockpit dashboard components including:
 * - DashboardGrid: Grid layout with responsive columns
 * - KPICard: Key metric display with trends
 * - ActivityFeed: Event timeline with filtering
 * - AgentStatus, AgentCard, AgentGrid: Agent display components
 * - WorkflowDashboard, WorkflowList, WorkflowTimeline: Workflow components
 * - Tabs, DataTable, CommandPalette: Interactive widgets
 * - Settings components: UserProfile, APIKeyManager, etc.
 *
 * @see app/components/cockpit/dashboard.tsx
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import {
  DashboardGrid,
  KPICard,
  ActivityFeed,
  AgentStatus,
  AgentGrid,
  AgentCard,
  WorkflowDashboard,
  WorkflowList,
  WorkflowTimeline,
  AnalyticsDashboard,
  CommandGroup,
  CommandItem,
  CommandPalette,
  DataTable,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  SettingsLayout,
  SettingsSection,
  UserProfile,
  APIKeyManager,
  IntegrationsList,
  BillingManager,
  AgentChatModal,
} from '../dashboard'

// =============================================================================
// Test Data
// =============================================================================

const mockAgents = [
  { id: 'priya', name: 'Priya', status: 'working', role: 'Product' },
  { id: 'ralph', name: 'Ralph', status: 'idle', role: 'Engineering' },
  { id: 'tom', name: 'Tom', status: 'error', role: 'Tech Lead' },
  { id: 'mark', name: 'Mark', status: 'working', role: 'Marketing' },
]

const mockActivities = [
  {
    id: '1',
    type: 'deployment',
    title: 'Deployed v2.0.0',
    description: 'Production deployment completed',
    timestamp: new Date('2024-01-13T10:00:00Z'),
  },
  {
    id: '2',
    type: 'feature',
    title: 'Added dark mode',
    description: 'Theme switching support',
    timestamp: new Date('2024-01-13T09:30:00Z'),
  },
  {
    id: '3',
    type: 'bug',
    title: 'Fixed auth issue',
    timestamp: new Date('2024-01-13T09:00:00Z'),
  },
]

const mockWorkflows = [
  { id: 'wf1', name: 'Customer Onboarding', status: 'running' },
  { id: 'wf2', name: 'Payment Processing', status: 'pending' },
  { id: 'wf3', name: 'Order Fulfillment', status: 'completed' },
]

const mockTimelineEvents = [
  { id: 'e1', type: 'Workflow Started', timestamp: new Date('2024-01-13T08:00:00Z') },
  { id: 'e2', type: 'Step Completed', timestamp: new Date('2024-01-13T08:30:00Z') },
  { id: 'e3', type: 'Approval Received', timestamp: new Date('2024-01-13T09:00:00Z') },
]

// =============================================================================
// DashboardGrid Tests
// =============================================================================

describe('DashboardGrid', () => {
  it('renders children in a grid layout', () => {
    render(
      <DashboardGrid>
        <div data-testid="child-1">Card 1</div>
        <div data-testid="child-2">Card 2</div>
        <div data-testid="child-3">Card 3</div>
      </DashboardGrid>
    )

    expect(screen.getByTestId('child-1')).toBeInTheDocument()
    expect(screen.getByTestId('child-2')).toBeInTheDocument()
    expect(screen.getByTestId('child-3')).toBeInTheDocument()
  })

  it('applies correct data attributes for testing', () => {
    render(
      <DashboardGrid cols={4} testId="test-grid">
        <div>Content</div>
      </DashboardGrid>
    )

    const grid = screen.getByTestId('test-grid')
    expect(grid).toHaveAttribute('data-component', 'DashboardGrid')
    expect(grid).toHaveAttribute('data-cols', '4')
  })

  it('defaults to 3 columns when cols prop is not provided', () => {
    render(
      <DashboardGrid testId="default-grid">
        <div>Content</div>
      </DashboardGrid>
    )

    const grid = screen.getByTestId('default-grid')
    expect(grid).toHaveAttribute('data-cols', '3')
  })

  it('supports various column configurations', () => {
    const { rerender } = render(
      <DashboardGrid cols={1} testId="grid-1">
        <div>Content</div>
      </DashboardGrid>
    )
    expect(screen.getByTestId('grid-1')).toHaveAttribute('data-cols', '1')

    rerender(
      <DashboardGrid cols={6} testId="grid-6">
        <div>Content</div>
      </DashboardGrid>
    )
    expect(screen.getByTestId('grid-6')).toHaveAttribute('data-cols', '6')

    rerender(
      <DashboardGrid cols={12} testId="grid-12">
        <div>Content</div>
      </DashboardGrid>
    )
    expect(screen.getByTestId('grid-12')).toHaveAttribute('data-cols', '12')
  })
})

// =============================================================================
// KPICard Tests
// =============================================================================

describe('KPICard', () => {
  it('renders title and value', () => {
    render(<KPICard title="Revenue" value="$1,234,567" testId="kpi-revenue" />)

    expect(screen.getByTestId('dashboard-kpi-title')).toHaveTextContent('Revenue')
    expect(screen.getByTestId('dashboard-kpi-value')).toHaveTextContent('$1,234,567')
  })

  it('renders numeric value', () => {
    render(<KPICard title="Users" value={42000} testId="kpi-users" />)

    expect(screen.getByTestId('dashboard-kpi-value')).toHaveTextContent('42000')
  })

  it('renders positive trend with plus sign', () => {
    render(<KPICard title="Growth" value="100%" trend={25} testId="kpi-growth" />)

    const trend = screen.getByTestId('dashboard-kpi-trend')
    expect(trend).toHaveTextContent('+25%')
  })

  it('renders negative trend without plus sign', () => {
    render(<KPICard title="Churn" value="5%" trend={-10} testId="kpi-churn" />)

    const trend = screen.getByTestId('dashboard-kpi-trend')
    expect(trend).toHaveTextContent('-10%')
  })

  it('renders zero trend with plus sign', () => {
    render(<KPICard title="Stable" value="50%" trend={0} testId="kpi-stable" />)

    const trend = screen.getByTestId('dashboard-kpi-trend')
    expect(trend).toHaveTextContent('+0%')
  })

  it('renders string trend value', () => {
    render(<KPICard title="Status" value="Active" trend="Up from last week" testId="kpi-status" />)

    const trend = screen.getByTestId('dashboard-kpi-trend')
    expect(trend).toHaveTextContent('Up from last week')
  })

  it('renders icon when provided', () => {
    render(<KPICard title="Users" value={100} icon="Users" testId="kpi-icon" />)

    expect(screen.getByTestId('dashboard-kpi-icon')).toBeInTheDocument()
    expect(screen.getByTestId('dashboard-kpi-icon')).toHaveAttribute('data-icon', 'Users')
  })

  it('does not render trend when not provided', () => {
    render(<KPICard title="Simple" value="123" testId="kpi-simple" />)

    expect(screen.queryByTestId('dashboard-kpi-trend')).not.toBeInTheDocument()
  })

  it('applies correct component data attribute', () => {
    render(<KPICard title="Test" value="100" testId="kpi-attr" />)

    const card = screen.getByTestId('kpi-attr')
    expect(card).toHaveAttribute('data-component', 'KPICard')
  })

  it('has accessible role and label', () => {
    render(<KPICard title="Revenue" value="$1M" trend={15} testId="kpi-a11y" />)

    const card = screen.getByTestId('kpi-a11y')
    expect(card).toHaveAttribute('role', 'article')
    expect(card).toHaveAttribute('aria-label', 'Revenue: $1M, trend up')
  })
})

// =============================================================================
// ActivityFeed Tests
// =============================================================================

describe('ActivityFeed', () => {
  it('renders activity items', () => {
    render(<ActivityFeed items={mockActivities} />)

    const items = screen.getAllByTestId('activity-item')
    expect(items).toHaveLength(3)
  })

  it('displays activity item details', () => {
    render(<ActivityFeed items={mockActivities} />)

    expect(screen.getByText('Deployed v2.0.0')).toBeInTheDocument()
    expect(screen.getByText('deployment')).toBeInTheDocument()
    expect(screen.getByText('Production deployment completed')).toBeInTheDocument()
  })

  it('renders empty state when no items', () => {
    render(<ActivityFeed items={[]} />)

    expect(screen.getByTestId('activity-feed-empty')).toBeInTheDocument()
    expect(screen.getByText('No recent activity')).toBeInTheDocument()
  })

  it('renders empty state when items prop is undefined', () => {
    render(<ActivityFeed />)

    expect(screen.getByTestId('activity-feed-empty')).toBeInTheDocument()
  })

  it('applies correct data attributes', () => {
    render(<ActivityFeed items={mockActivities} />)

    const feed = document.querySelector('[data-component="ActivityFeed"]')
    expect(feed).toBeInTheDocument()
    expect(feed).toHaveAttribute('data-items-count', '3')
  })

  it('formats timestamps correctly', () => {
    render(<ActivityFeed items={mockActivities} />)

    const timestamps = screen.getAllByTestId('activity-item-timestamp')
    expect(timestamps.length).toBeGreaterThan(0)
    // Each timestamp should contain a time element
    timestamps.forEach((ts) => {
      expect(ts.querySelector('time')).toBeInTheDocument()
    })
  })

  it('displays optional description when present', () => {
    render(<ActivityFeed items={mockActivities} />)

    // First two items have descriptions
    expect(screen.getByText('Production deployment completed')).toBeInTheDocument()
    expect(screen.getByText('Theme switching support')).toBeInTheDocument()
  })

  it('handles items without description', () => {
    render(<ActivityFeed items={mockActivities} />)

    // Third item has no description
    const items = screen.getAllByTestId('activity-item')
    const lastItem = items[2]
    expect(within(lastItem).queryByTestId('activity-item-description')).not.toBeInTheDocument()
  })

  it('has accessible feed role and label', () => {
    render(<ActivityFeed items={mockActivities} />)

    const feed = document.querySelector('[data-component="ActivityFeed"]')
    expect(feed).toHaveAttribute('role', 'feed')
    expect(feed).toHaveAttribute('aria-label', 'Recent activity feed')
  })
})

// =============================================================================
// AgentStatus Tests
// =============================================================================

describe('AgentStatus', () => {
  it('renders all agents', () => {
    render(<AgentStatus agents={mockAgents} />)

    const items = screen.getAllByTestId('agent-status-item')
    expect(items).toHaveLength(4)
  })

  it('displays agent details', () => {
    render(<AgentStatus agents={mockAgents} />)

    expect(screen.getByText('Priya')).toBeInTheDocument()
    expect(screen.getByText('Product')).toBeInTheDocument()
    expect(screen.getByText('working')).toBeInTheDocument()
  })

  it('applies correct status indicator', () => {
    render(<AgentStatus agents={mockAgents} />)

    const priyaItem = screen.getByTestId('agent-status-item')
    expect(screen.getAllByTestId('agent-status-item')[0]).toHaveAttribute('data-status', 'working')
    expect(screen.getAllByTestId('agent-status-item')[1]).toHaveAttribute('data-status', 'idle')
    expect(screen.getAllByTestId('agent-status-item')[2]).toHaveAttribute('data-status', 'error')
  })

  it('renders avatar with first letter of name', () => {
    render(<AgentStatus agents={mockAgents} />)

    const avatars = screen.getAllByTestId('agent-status-avatar')
    expect(avatars[0]).toHaveTextContent('P')
    expect(avatars[1]).toHaveTextContent('R')
    expect(avatars[2]).toHaveTextContent('T')
    expect(avatars[3]).toHaveTextContent('M')
  })

  it('renders children as header content', () => {
    render(
      <AgentStatus agents={mockAgents}>
        <span data-testid="header">Team Status</span>
      </AgentStatus>
    )

    expect(screen.getByTestId('header')).toBeInTheDocument()
  })

  it('applies correct data attributes', () => {
    render(<AgentStatus agents={mockAgents} />)

    const container = document.querySelector('[data-component="AgentStatus"]')
    expect(container).toBeInTheDocument()
    expect(container).toHaveAttribute('data-agents-count', '4')
  })

  it('handles empty agents array', () => {
    render(<AgentStatus agents={[]} />)

    const container = document.querySelector('[data-component="AgentStatus"]')
    expect(container).toHaveAttribute('data-agents-count', '0')
    expect(screen.queryByTestId('agent-status-item')).not.toBeInTheDocument()
  })

  it('has accessible structure', () => {
    render(<AgentStatus agents={mockAgents} />)

    const container = document.querySelector('[data-component="AgentStatus"]')
    expect(container).toHaveAttribute('role', 'region')
    expect(container).toHaveAttribute('aria-label', 'Agent status')
  })
})

// =============================================================================
// AgentGrid and AgentCard Tests
// =============================================================================

describe('AgentGrid', () => {
  it('renders children in a grid layout', () => {
    render(
      <AgentGrid>
        <div data-testid="agent-1">Agent 1</div>
        <div data-testid="agent-2">Agent 2</div>
      </AgentGrid>
    )

    expect(screen.getByTestId('agent-1')).toBeInTheDocument()
    expect(screen.getByTestId('agent-2')).toBeInTheDocument()
  })

  it('has correct component attribute', () => {
    render(
      <AgentGrid>
        <div>Content</div>
      </AgentGrid>
    )

    const grid = document.querySelector('[data-component="AgentGrid"]')
    expect(grid).toBeInTheDocument()
  })

  it('has accessible list role', () => {
    render(
      <AgentGrid>
        <div>Content</div>
      </AgentGrid>
    )

    const grid = document.querySelector('[data-component="AgentGrid"]')
    expect(grid).toHaveAttribute('role', 'list')
    expect(grid).toHaveAttribute('aria-label', 'Agent grid')
  })
})

describe('AgentCard', () => {
  it('renders agent name and role', () => {
    render(<AgentCard agent={{ name: 'Priya', role: 'Product Manager' }} />)

    expect(screen.getByText('Priya')).toBeInTheDocument()
    expect(screen.getByText('Product Manager')).toBeInTheDocument()
  })

  it('renders status badge when provided', () => {
    render(<AgentCard agent={{ name: 'Ralph' }} status="working" />)

    expect(screen.getByText('working')).toBeInTheDocument()
  })

  it('renders avatar with first letter', () => {
    render(<AgentCard agent={{ name: 'Tom' }} />)

    const card = document.querySelector('[data-component="AgentCard"]')
    expect(card).toHaveTextContent('T')
  })

  it('renders custom avatar when provided', () => {
    render(<AgentCard agent={{ name: 'Sally', avatar: 'S' }} />)

    const card = document.querySelector('[data-component="AgentCard"]')
    expect(card).toHaveTextContent('S')
  })

  it('defaults to "Agent" when name not provided', () => {
    render(<AgentCard />)

    expect(screen.getByText('Agent')).toBeInTheDocument()
  })

  it('applies status data attribute', () => {
    render(<AgentCard agent={{ name: 'Test' }} status="idle" />)

    const card = document.querySelector('[data-component="AgentCard"]')
    expect(card).toHaveAttribute('data-status', 'idle')
  })
})

// =============================================================================
// WorkflowDashboard, WorkflowList, WorkflowTimeline Tests
// =============================================================================

describe('WorkflowDashboard', () => {
  it('renders children in a grid layout', () => {
    render(
      <WorkflowDashboard>
        <div data-testid="panel-1">Panel 1</div>
        <div data-testid="panel-2">Panel 2</div>
      </WorkflowDashboard>
    )

    expect(screen.getByTestId('panel-1')).toBeInTheDocument()
    expect(screen.getByTestId('panel-2')).toBeInTheDocument()
  })

  it('has correct component attribute', () => {
    render(
      <WorkflowDashboard>
        <div>Content</div>
      </WorkflowDashboard>
    )

    expect(document.querySelector('[data-component="WorkflowDashboard"]')).toBeInTheDocument()
  })
})

describe('WorkflowList', () => {
  it('renders workflow items', () => {
    render(<WorkflowList workflows={mockWorkflows} />)

    expect(screen.getByText('Customer Onboarding')).toBeInTheDocument()
    expect(screen.getByText('Payment Processing')).toBeInTheDocument()
    expect(screen.getByText('Order Fulfillment')).toBeInTheDocument()
  })

  it('displays workflow status', () => {
    render(<WorkflowList workflows={mockWorkflows} />)

    expect(screen.getByText('running')).toBeInTheDocument()
    expect(screen.getByText('pending')).toBeInTheDocument()
    expect(screen.getByText('completed')).toBeInTheDocument()
  })

  it('renders empty state when no workflows', () => {
    render(<WorkflowList workflows={[]} />)

    expect(screen.getByText('No active workflows')).toBeInTheDocument()
  })

  it('applies data attributes', () => {
    render(<WorkflowList workflows={mockWorkflows} />)

    const list = document.querySelector('[data-component="WorkflowList"]')
    expect(list).toHaveAttribute('data-workflows-count', '3')
  })
})

describe('WorkflowTimeline', () => {
  it('renders timeline events', () => {
    render(<WorkflowTimeline events={mockTimelineEvents} />)

    expect(screen.getByText('Workflow Started')).toBeInTheDocument()
    expect(screen.getByText('Step Completed')).toBeInTheDocument()
    expect(screen.getByText('Approval Received')).toBeInTheDocument()
  })

  it('renders empty state when no events', () => {
    render(<WorkflowTimeline events={[]} />)

    expect(screen.getByText('No events')).toBeInTheDocument()
  })

  it('applies data attributes', () => {
    render(<WorkflowTimeline events={mockTimelineEvents} />)

    const timeline = document.querySelector('[data-component="WorkflowTimeline"]')
    expect(timeline).toHaveAttribute('data-events-count', '3')
  })
})

// =============================================================================
// AnalyticsDashboard Tests
// =============================================================================

describe('AnalyticsDashboard', () => {
  it('renders children in a grid', () => {
    render(
      <AnalyticsDashboard>
        <div data-testid="chart-1">Chart 1</div>
        <div data-testid="chart-2">Chart 2</div>
      </AnalyticsDashboard>
    )

    expect(screen.getByTestId('chart-1')).toBeInTheDocument()
    expect(screen.getByTestId('chart-2')).toBeInTheDocument()
  })

  it('has correct component attribute', () => {
    render(
      <AnalyticsDashboard>
        <div>Content</div>
      </AnalyticsDashboard>
    )

    expect(document.querySelector('[data-component="AnalyticsDashboard"]')).toBeInTheDocument()
  })
})

// =============================================================================
// CommandPalette Tests
// =============================================================================

describe('CommandPalette', () => {
  it('renders children', () => {
    render(
      <CommandPalette>
        <div data-testid="command-content">Commands</div>
      </CommandPalette>
    )

    expect(screen.getByTestId('command-content')).toBeInTheDocument()
  })

  it('has correct component attribute', () => {
    render(
      <CommandPalette>
        <div>Content</div>
      </CommandPalette>
    )

    expect(document.querySelector('[data-component="CommandPalette"]')).toBeInTheDocument()
  })
})

describe('CommandGroup', () => {
  it('renders heading and children', () => {
    render(
      <CommandGroup heading="Actions">
        <div data-testid="action-1">Action 1</div>
      </CommandGroup>
    )

    expect(screen.getByText('Actions')).toBeInTheDocument()
    expect(screen.getByTestId('action-1')).toBeInTheDocument()
  })
})

describe('CommandItem', () => {
  let user: ReturnType<typeof userEvent.setup>

  beforeEach(() => {
    user = userEvent.setup()
  })

  it('renders children', () => {
    render(<CommandItem>Run Build</CommandItem>)

    expect(screen.getByText('Run Build')).toBeInTheDocument()
  })

  it('calls onSelect when clicked', async () => {
    const onSelect = vi.fn()
    render(<CommandItem onSelect={onSelect}>Execute</CommandItem>)

    await user.click(screen.getByRole('button'))
    expect(onSelect).toHaveBeenCalledOnce()
  })

  it('is a button element', () => {
    render(<CommandItem>Click Me</CommandItem>)

    expect(screen.getByRole('button')).toBeInTheDocument()
  })
})

// =============================================================================
// DataTable Tests
// =============================================================================

describe('DataTable', () => {
  const columns = [
    { accessorKey: 'name', header: 'Name' },
    { accessorKey: 'email', header: 'Email' },
    { accessorKey: 'status', header: 'Status' },
  ]

  const data = [
    { name: 'John', email: 'john@example.com', status: 'Active' },
    { name: 'Jane', email: 'jane@example.com', status: 'Pending' },
  ]

  it('renders table headers', () => {
    render(<DataTable columns={columns} data={data} />)

    expect(screen.getByText('Name')).toBeInTheDocument()
    expect(screen.getByText('Email')).toBeInTheDocument()
    expect(screen.getByText('Status')).toBeInTheDocument()
  })

  it('renders table data rows', () => {
    render(<DataTable columns={columns} data={data} />)

    expect(screen.getByText('John')).toBeInTheDocument()
    expect(screen.getByText('john@example.com')).toBeInTheDocument()
    expect(screen.getByText('Jane')).toBeInTheDocument()
  })

  it('renders search input when searchable', () => {
    render(<DataTable columns={columns} data={data} searchable />)

    expect(screen.getByPlaceholderText('Search...')).toBeInTheDocument()
  })

  it('does not render search input by default', () => {
    render(<DataTable columns={columns} data={data} />)

    expect(screen.queryByPlaceholderText('Search...')).not.toBeInTheDocument()
  })

  it('renders pagination when enabled', () => {
    render(<DataTable columns={columns} data={data} pagination />)

    expect(screen.getByText('Previous')).toBeInTheDocument()
    expect(screen.getByText('Next')).toBeInTheDocument()
    expect(screen.getByText(/Showing 2 results/)).toBeInTheDocument()
  })

  it('applies sortable attribute to headers when enabled', () => {
    render(<DataTable columns={columns} data={data} sortable />)

    const headers = document.querySelectorAll('th[data-sortable="true"]')
    expect(headers.length).toBe(3)
  })

  it('supports custom cell renderers', () => {
    const customColumns = [
      {
        accessorKey: 'name',
        header: 'Name',
        cell: ({ row }: { row: { original: { name: string } } }) => (
          <strong data-testid="custom-cell">{row.original.name}</strong>
        ),
      },
    ]

    render(<DataTable columns={customColumns} data={data} />)

    expect(screen.getAllByTestId('custom-cell')).toHaveLength(2)
  })

  it('renders children as description', () => {
    render(
      <DataTable columns={columns} data={data}>
        <span data-testid="description">User directory</span>
      </DataTable>
    )

    expect(screen.getByTestId('description')).toBeInTheDocument()
  })
})

// =============================================================================
// Tabs Tests
// =============================================================================

describe('Tabs', () => {
  let user: ReturnType<typeof userEvent.setup>

  beforeEach(() => {
    user = userEvent.setup()
  })

  it('renders tabs with default value selected', () => {
    render(
      <Tabs defaultValue="tab1">
        <TabsList>
          <TabsTrigger value="tab1">Tab 1</TabsTrigger>
          <TabsTrigger value="tab2">Tab 2</TabsTrigger>
        </TabsList>
        <TabsContent value="tab1">Content 1</TabsContent>
        <TabsContent value="tab2">Content 2</TabsContent>
      </Tabs>
    )

    expect(screen.getByText('Content 1')).toBeInTheDocument()
    expect(screen.queryByText('Content 2')).not.toBeInTheDocument()
  })

  it('switches tabs when trigger is clicked', async () => {
    render(
      <Tabs defaultValue="tab1">
        <TabsList>
          <TabsTrigger value="tab1">Tab 1</TabsTrigger>
          <TabsTrigger value="tab2">Tab 2</TabsTrigger>
        </TabsList>
        <TabsContent value="tab1">Content 1</TabsContent>
        <TabsContent value="tab2">Content 2</TabsContent>
      </Tabs>
    )

    expect(screen.getByText('Content 1')).toBeInTheDocument()
    expect(screen.queryByText('Content 2')).not.toBeInTheDocument()

    await user.click(screen.getByText('Tab 2'))

    expect(screen.queryByText('Content 1')).not.toBeInTheDocument()
    expect(screen.getByText('Content 2')).toBeInTheDocument()
  })

  it('applies active state to selected trigger', async () => {
    render(
      <Tabs defaultValue="tab1">
        <TabsList>
          <TabsTrigger value="tab1">Tab 1</TabsTrigger>
          <TabsTrigger value="tab2">Tab 2</TabsTrigger>
        </TabsList>
        <TabsContent value="tab1">Content 1</TabsContent>
        <TabsContent value="tab2">Content 2</TabsContent>
      </Tabs>
    )

    const tab1 = screen.getByText('Tab 1').closest('[data-component="TabsTrigger"]')
    const tab2 = screen.getByText('Tab 2').closest('[data-component="TabsTrigger"]')

    expect(tab1).toHaveAttribute('data-state', 'active')
    expect(tab2).toHaveAttribute('data-state', 'inactive')

    await user.click(screen.getByText('Tab 2'))

    expect(tab1).toHaveAttribute('data-state', 'inactive')
    expect(tab2).toHaveAttribute('data-state', 'active')
  })
})

// =============================================================================
// Settings Components Tests
// =============================================================================

describe('SettingsLayout', () => {
  it('renders children', () => {
    render(
      <SettingsLayout>
        <div data-testid="settings-content">Settings</div>
      </SettingsLayout>
    )

    expect(screen.getByTestId('settings-content')).toBeInTheDocument()
  })

  it('has correct component attribute', () => {
    render(
      <SettingsLayout>
        <div>Content</div>
      </SettingsLayout>
    )

    expect(document.querySelector('[data-component="SettingsLayout"]')).toBeInTheDocument()
  })
})

describe('SettingsSection', () => {
  it('renders title and children', () => {
    render(
      <SettingsSection title="Account">
        <div data-testid="section-content">Account settings</div>
      </SettingsSection>
    )

    expect(screen.getByText('Account')).toBeInTheDocument()
    expect(screen.getByTestId('section-content')).toBeInTheDocument()
  })
})

describe('UserProfile', () => {
  it('renders user information', () => {
    render(<UserProfile />)

    expect(screen.getByText('User Name')).toBeInTheDocument()
    expect(screen.getByText('user@dotdo.dev')).toBeInTheDocument()
  })

  it('has correct component attribute', () => {
    render(<UserProfile />)

    expect(document.querySelector('[data-component="UserProfile"]')).toBeInTheDocument()
  })
})

describe('APIKeyManager', () => {
  it('renders create key button', () => {
    render(<APIKeyManager />)

    expect(screen.getByText('Create Key')).toBeInTheDocument()
  })

  it('shows empty state message', () => {
    render(<APIKeyManager />)

    expect(screen.getByText('No API keys configured')).toBeInTheDocument()
  })
})

describe('IntegrationsList', () => {
  it('shows empty state message', () => {
    render(<IntegrationsList />)

    expect(screen.getByText('No integrations configured')).toBeInTheDocument()
  })
})

describe('BillingManager', () => {
  it('renders plan information', () => {
    render(<BillingManager />)

    expect(screen.getByText('Free Plan')).toBeInTheDocument()
    expect(screen.getByText('Upgrade for more features')).toBeInTheDocument()
  })

  it('renders upgrade button', () => {
    render(<BillingManager />)

    expect(screen.getByText('Upgrade')).toBeInTheDocument()
  })
})

// =============================================================================
// AgentChatModal Tests
// =============================================================================

describe('AgentChatModal', () => {
  let user: ReturnType<typeof userEvent.setup>

  beforeEach(() => {
    user = userEvent.setup()
  })

  it('renders nothing when not open', () => {
    render(<AgentChatModal agent="Priya" isOpen={false} onClose={vi.fn()} />)

    expect(screen.queryByText('Chat with Priya')).not.toBeInTheDocument()
  })

  it('renders modal content when open', () => {
    render(<AgentChatModal agent="Priya" isOpen={true} onClose={vi.fn()} />)

    expect(screen.getByText('Chat with Priya')).toBeInTheDocument()
    expect(screen.getByText('Starting conversation with Priya...')).toBeInTheDocument()
  })

  it('calls onClose when close button clicked', async () => {
    const onClose = vi.fn()
    render(<AgentChatModal agent="Ralph" isOpen={true} onClose={onClose} />)

    await user.click(screen.getByText('X'))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('calls onClose when backdrop clicked', async () => {
    const onClose = vi.fn()
    render(<AgentChatModal agent="Tom" isOpen={true} onClose={onClose} />)

    // Click the backdrop (the outer div)
    const backdrop = document.querySelector('[data-agent-chat="Tom"]')
    await user.click(backdrop!)
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('does not close when modal content clicked', async () => {
    const onClose = vi.fn()
    render(<AgentChatModal agent="Mark" isOpen={true} onClose={onClose} />)

    // Click inside the modal content
    await user.click(screen.getByText('Chat with Mark'))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('applies correct data attribute with agent name', () => {
    render(<AgentChatModal agent="Sally" isOpen={true} onClose={vi.fn()} />)

    expect(document.querySelector('[data-agent-chat="Sally"]')).toBeInTheDocument()
  })
})
