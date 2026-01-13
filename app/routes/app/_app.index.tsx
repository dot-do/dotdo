'use client'

/**
 * App Dashboard Index Route
 *
 * Main dashboard page for the user-facing app at /app.
 * Shows overview of user's projects, workflows, and activity.
 *
 * ## Features
 * - User metrics: projects, tasks, workflows counts
 * - Recent activity feed
 * - Quick action buttons
 * - Widget panels for recent projects, pending tasks, active workflows
 */

import { createFileRoute, Link } from '@tanstack/react-router'
import { useState, useEffect } from 'react'
import { FolderKanban, CheckSquare, Workflow, Plus, Eye, Clock, RefreshCw, UserPlus } from 'lucide-react'
import { Button } from '@mdxui/primitives/button'
import { PageHeader } from './_app'

export const Route = createFileRoute('/app/_app/')({
  component: AppDashboard,
})

// Mock data for the dashboard
const mockMetrics = {
  projects: 12,
  tasks: 24,
  workflows: 5,
}

const mockActivity = [
  {
    id: '1',
    description: 'Created new project "Marketing Campaign"',
    timestamp: new Date(Date.now() - 1000 * 60 * 30).toISOString(), // 30 min ago
  },
  {
    id: '2',
    description: 'Completed task "Review PR #42"',
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(), // 2 hours ago
  },
  {
    id: '3',
    description: 'Started workflow "Daily Report"',
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 5).toISOString(), // 5 hours ago
  },
  {
    id: '4',
    description: 'Updated team member in "Product Launch"',
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(), // 1 day ago
  },
]

const mockRecentProjects = [
  { id: '1', name: 'Marketing Campaign', updatedAt: '2 hours ago' },
  { id: '2', name: 'Product Launch', updatedAt: '1 day ago' },
  { id: '3', name: 'Q4 Planning', updatedAt: '3 days ago' },
]

const mockPendingTasks = [
  { id: '1', title: 'Review PR #42', priority: 'high' },
  { id: '2', title: 'Update documentation', priority: 'medium' },
  { id: '3', title: 'Fix login bug', priority: 'high' },
]

const mockActiveWorkflows = [
  { id: '1', name: 'Daily Report', status: 'running' },
  { id: '2', name: 'Weekly Sync', status: 'scheduled' },
]

function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / (1000 * 60))
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffMins < 60) {
    return `${diffMins}m ago`
  } else if (diffHours < 24) {
    return `${diffHours}h ago`
  } else {
    return `${diffDays}d ago`
  }
}

function formatLastUpdated(): string {
  const now = new Date()
  return `Last updated ${now.toLocaleTimeString()}`
}

/**
 * Loading skeleton for the dashboard
 */
function DashboardSkeleton() {
  return (
    <div data-testid="dashboard-skeleton" className="animate-pulse">
      <div className="h-8 bg-muted rounded w-48 mb-2" />
      <div className="h-4 bg-muted rounded w-64 mb-6" />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 mb-6">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-32 bg-muted rounded-lg" />
        ))}
      </div>
      <div className="h-48 bg-muted rounded-lg mb-6" />
      <div className="grid md:grid-cols-3 gap-6">
        <div className="h-64 bg-muted rounded-lg" />
        <div className="h-64 bg-muted rounded-lg" />
        <div className="h-64 bg-muted rounded-lg" />
      </div>
    </div>
  )
}

/**
 * Error state for the dashboard
 */
function DashboardError({ error, onRetry }: { error: Error; onRetry: () => void }) {
  return (
    <div data-testid="dashboard-error" className="text-center py-12">
      <div data-testid="error-message" className="text-destructive text-5xl mb-4">!</div>
      <h2 className="text-xl font-semibold text-destructive mb-2">Error loading dashboard</h2>
      <p className="text-muted-foreground mb-6">{error.message}</p>
      <Button
        data-testid="retry-button"
        type="button"
        variant="secondary"
        onClick={onRetry}
      >
        Try Again
      </Button>
    </div>
  )
}

function AppDashboard() {
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [lastUpdated, setLastUpdated] = useState(formatLastUpdated())
  const [activityLimit, setActivityLimit] = useState(4)
  const [userName] = useState('John') // Would come from auth context

  // Simulate initial data loading
  useEffect(() => {
    const timer = setTimeout(() => {
      setIsLoading(false)
      setLastUpdated(formatLastUpdated())
    }, 100) // Quick load for tests
    return () => clearTimeout(timer)
  }, [])

  const handleRefresh = async () => {
    setIsRefreshing(true)
    // Simulate refresh delay
    await new Promise((resolve) => setTimeout(resolve, 500))
    setLastUpdated(formatLastUpdated())
    setIsRefreshing(false)
  }

  const handleRetry = () => {
    setError(null)
    setIsLoading(true)
    setTimeout(() => {
      setIsLoading(false)
      setLastUpdated(formatLastUpdated())
    }, 100)
  }

  const handleShowMoreActivity = () => {
    setActivityLimit((prev) => prev + 4)
  }

  const displayedActivity = mockActivity.slice(0, activityLimit)
  const hasMoreActivity = mockActivity.length > activityLimit

  if (isLoading) {
    return (
      <>
        <PageHeader />
        <div data-testid="user-dashboard" className="flex-1 overflow-auto p-4 pt-0">
          <DashboardSkeleton />
        </div>
      </>
    )
  }

  if (error) {
    return (
      <>
        <PageHeader />
        <div data-testid="user-dashboard" className="flex-1 overflow-auto p-4 pt-0">
          <DashboardError error={error} onRetry={handleRetry} />
        </div>
      </>
    )
  }

  return (
    <>
      <PageHeader />
      <main
        data-testid="user-dashboard"
        className="flex-1 overflow-auto p-4 pt-0"
      >
        {/* Dashboard Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
          <div>
            <h1 data-testid="dashboard-title" className="text-2xl font-bold">
              Dashboard
            </h1>
            <p data-testid="welcome-message" className="text-muted-foreground">
              Welcome back, {userName}! Here's your overview.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span data-testid="last-updated" className="text-sm text-muted-foreground">
              {lastUpdated}
            </span>
            <Button
              data-testid="refresh-dashboard"
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              disabled={isRefreshing}
              data-loading={isRefreshing ? 'true' : 'false'}
              aria-label="Refresh dashboard"
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        </div>

        {/* User Metrics Section */}
        <section data-testid="user-metrics" className="mb-8">
          <h2 className="text-lg font-semibold mb-4">Your Metrics</h2>
          {/* Desktop Grid */}
          <div
            data-testid="metrics-grid"
            className="hidden md:grid gap-6 md:grid-cols-3"
          >
            <div
              data-testid="project-count"
              role="status"
              className="rounded-lg border bg-card p-6"
            >
              <div className="flex items-center justify-between mb-4">
                <h3 data-testid="metric-label" className="text-sm font-medium text-muted-foreground">Projects</h3>
                <FolderKanban className="h-5 w-5 text-muted-foreground" />
              </div>
              <p data-testid="project-count-value" className="text-3xl font-bold">{mockMetrics.projects}</p>
              <p className="text-xs text-muted-foreground mt-1">Active projects</p>
            </div>
            <div
              data-testid="task-count"
              role="status"
              className="rounded-lg border bg-card p-6"
            >
              <div className="flex items-center justify-between mb-4">
                <h3 data-testid="metric-label" className="text-sm font-medium text-muted-foreground">Tasks</h3>
                <CheckSquare className="h-5 w-5 text-muted-foreground" />
              </div>
              <p data-testid="task-count-value" className="text-3xl font-bold">{mockMetrics.tasks}</p>
              <p className="text-xs text-muted-foreground mt-1">Pending tasks</p>
            </div>
            <div
              data-testid="workflow-count"
              role="status"
              className="rounded-lg border bg-card p-6"
            >
              <div className="flex items-center justify-between mb-4">
                <h3 data-testid="metric-label" className="text-sm font-medium text-muted-foreground">Workflows</h3>
                <Workflow className="h-5 w-5 text-muted-foreground" />
              </div>
              <p data-testid="workflow-count-value" className="text-3xl font-bold">{mockMetrics.workflows}</p>
              <p className="text-xs text-muted-foreground mt-1">Active workflows</p>
            </div>
          </div>
          {/* Mobile Carousel */}
          <div
            data-testid="metrics-carousel"
            className="md:hidden flex gap-4 overflow-x-auto snap-x snap-mandatory pb-4"
          >
            <div
              data-testid="project-count"
              role="status"
              className="rounded-lg border bg-card p-6 min-w-[280px] snap-start"
            >
              <div className="flex items-center justify-between mb-4">
                <h3 data-testid="metric-label" className="text-sm font-medium text-muted-foreground">Projects</h3>
                <FolderKanban className="h-5 w-5 text-muted-foreground" />
              </div>
              <p data-testid="project-count-value" className="text-3xl font-bold">{mockMetrics.projects}</p>
              <p className="text-xs text-muted-foreground mt-1">Active projects</p>
            </div>
            <div
              data-testid="task-count"
              role="status"
              className="rounded-lg border bg-card p-6 min-w-[280px] snap-start"
            >
              <div className="flex items-center justify-between mb-4">
                <h3 data-testid="metric-label" className="text-sm font-medium text-muted-foreground">Tasks</h3>
                <CheckSquare className="h-5 w-5 text-muted-foreground" />
              </div>
              <p data-testid="task-count-value" className="text-3xl font-bold">{mockMetrics.tasks}</p>
              <p className="text-xs text-muted-foreground mt-1">Pending tasks</p>
            </div>
            <div
              data-testid="workflow-count"
              role="status"
              className="rounded-lg border bg-card p-6 min-w-[280px] snap-start"
            >
              <div className="flex items-center justify-between mb-4">
                <h3 data-testid="metric-label" className="text-sm font-medium text-muted-foreground">Workflows</h3>
                <Workflow className="h-5 w-5 text-muted-foreground" />
              </div>
              <p data-testid="workflow-count-value" className="text-3xl font-bold">{mockMetrics.workflows}</p>
              <p className="text-xs text-muted-foreground mt-1">Active workflows</p>
            </div>
          </div>
        </section>

        {/* Quick Actions Section */}
        <section data-testid="quick-actions" className="mb-8">
          <h2 className="text-lg font-semibold mb-4">Quick Actions</h2>
          <div className="flex flex-col sm:flex-row flex-wrap gap-3">
            <Button
              data-testid="quick-action-create-project"
              asChild
              className="w-full sm:w-auto min-h-[44px]"
            >
              <Link to="/app/projects/new" search={{ create: true }}>
                <Plus className="mr-2 h-4 w-4" />
                Create Project
              </Link>
            </Button>
            <Button
              data-testid="quick-action-create-workflow"
              variant="secondary"
              asChild
              className="w-full sm:w-auto min-h-[44px]"
            >
              <Link to="/app/workflows/new" search={{ create: true }}>
                <Plus className="mr-2 h-4 w-4" />
                Create Workflow
              </Link>
            </Button>
            <Button
              data-testid="quick-action-view-tasks"
              variant="outline"
              asChild
              className="w-full sm:w-auto min-h-[44px]"
            >
              <Link to="/app/tasks">
                <Eye className="mr-2 h-4 w-4" />
                View Tasks
              </Link>
            </Button>
            <Button
              data-testid="quick-action-invite-team"
              variant="outline"
              asChild
              className="w-full sm:w-auto min-h-[44px]"
            >
              <Link to="/app/settings" search={{ tab: 'team' }}>
                <UserPlus className="mr-2 h-4 w-4" />
                Invite Team Member
              </Link>
            </Button>
          </div>
        </section>

        {/* Activity Feed Section */}
        <section data-testid="user-activity-feed" className="mb-8">
          <h2 className="text-lg font-semibold mb-4">Recent Activity</h2>
          <div className="rounded-lg border bg-card overflow-y-auto max-h-[400px] md:max-h-none md:overflow-visible">
            {displayedActivity.length === 0 ? (
              <div data-testid="activity-empty-state" className="p-8 text-center text-muted-foreground">
                No recent activity
              </div>
            ) : (
              <ul role="list" className="divide-y">
                {displayedActivity.map((item) => (
                  <li
                    key={item.id}
                    data-testid="activity-item"
                    className="p-4 flex items-start gap-3"
                  >
                    <Clock className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p
                        data-testid="activity-description"
                        className="text-sm"
                      >
                        {item.description}
                      </p>
                      <p
                        data-testid="activity-timestamp"
                        className="text-xs text-muted-foreground mt-1"
                      >
                        {formatTimestamp(item.timestamp)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {hasMoreActivity && (
              <div className="p-4 border-t">
                <Button
                  data-testid="activity-show-more"
                  variant="ghost"
                  size="sm"
                  onClick={handleShowMoreActivity}
                  className="w-full"
                >
                  Show More
                </Button>
              </div>
            )}
          </div>
        </section>

        {/* Widget Panels */}
        <div className="grid gap-6 grid-cols-1 md:grid-cols-3">
          {/* Recent Projects Widget */}
          <section
            data-testid="user-widget-recent-projects"
            className="rounded-lg border bg-card"
          >
            <div className="p-4 border-b">
              <h3 className="font-semibold flex items-center gap-2">
                <FolderKanban className="h-4 w-4" />
                Recent Projects
              </h3>
            </div>
            {mockRecentProjects.length === 0 ? (
              <div data-testid="empty-state" className="p-8 text-center text-muted-foreground">
                No projects yet
              </div>
            ) : (
              <div className="divide-y">
                {mockRecentProjects.map((project) => (
                  <div key={project.id} data-testid="project-item" className="p-4">
                    <p className="text-sm font-medium">{project.name}</p>
                    <p className="text-xs text-muted-foreground">{project.updatedAt}</p>
                  </div>
                ))}
              </div>
            )}
            <div className="p-4 border-t">
              <Button variant="ghost" size="sm" asChild className="w-full">
                <Link to="/app/projects">View All</Link>
              </Button>
            </div>
          </section>

          {/* Pending Tasks Widget */}
          <section
            data-testid="user-widget-pending-tasks"
            className="rounded-lg border bg-card"
          >
            <div className="p-4 border-b">
              <h3 className="font-semibold flex items-center gap-2">
                <CheckSquare className="h-4 w-4" />
                Pending Tasks
              </h3>
            </div>
            {mockPendingTasks.length === 0 ? (
              <div data-testid="empty-state" className="p-8 text-center text-muted-foreground">
                No pending tasks
              </div>
            ) : (
              <div className="divide-y">
                {mockPendingTasks.map((task) => (
                  <div key={task.id} data-testid="task-item" className="p-4 flex items-center justify-between">
                    <p className="text-sm font-medium">{task.title}</p>
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full ${
                        task.priority === 'high'
                          ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                          : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
                      }`}
                    >
                      {task.priority}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <div className="p-4 border-t">
              <Button variant="ghost" size="sm" asChild className="w-full">
                <Link to="/app/tasks">View All</Link>
              </Button>
            </div>
          </section>

          {/* Active Workflows Widget */}
          <section
            data-testid="user-widget-active-workflows"
            className="rounded-lg border bg-card"
          >
            <div className="p-4 border-b">
              <h3 className="font-semibold flex items-center gap-2">
                <Workflow className="h-4 w-4" />
                Active Workflows
              </h3>
            </div>
            {mockActiveWorkflows.length === 0 ? (
              <div data-testid="empty-state" className="p-8 text-center text-muted-foreground">
                No active workflows
              </div>
            ) : (
              <div className="divide-y">
                {mockActiveWorkflows.map((workflow) => (
                  <div key={workflow.id} className="p-4 flex items-center justify-between">
                    <p className="text-sm font-medium">{workflow.name}</p>
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full ${
                        workflow.status === 'running'
                          ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                          : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                      }`}
                    >
                      {workflow.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <div className="p-4 border-t">
              <Button variant="ghost" size="sm" asChild className="w-full">
                <Link to="/app/workflows">View All</Link>
              </Button>
            </div>
          </section>
        </div>

        {/* Onboarding Widget (shown for new users) */}
        <section
          data-testid="user-widget-onboarding"
          className="mt-6 rounded-lg border bg-card p-6 hidden"
        >
          <h3 className="font-semibold mb-2">Getting Started</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Complete these steps to get the most out of your workspace.
          </p>
          <ul className="space-y-2">
            <li className="flex items-center gap-2 text-sm">
              <CheckSquare className="h-4 w-4 text-green-500" />
              <span className="line-through text-muted-foreground">Create your first project</span>
            </li>
            <li className="flex items-center gap-2 text-sm">
              <div className="h-4 w-4 border rounded" />
              <span>Invite a team member</span>
            </li>
            <li className="flex items-center gap-2 text-sm">
              <div className="h-4 w-4 border rounded" />
              <span>Set up your first workflow</span>
            </li>
          </ul>
        </section>
      </main>
    </>
  )
}
