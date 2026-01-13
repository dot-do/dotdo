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
 * - Widget customization with drag-and-drop reordering
 * - Dashboard state persistence
 * - Keyboard shortcuts (R to refresh, ? for help)
 * - Polished loading states with staggered animations
 * - Empty states for new users with onboarding checklist
 */

import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  FolderKanban,
  CheckSquare,
  Workflow,
  Plus,
  Eye,
  Clock,
  RefreshCw,
  UserPlus,
  Settings2,
  GripVertical,
  X,
  Sparkles,
  Rocket,
  ChevronDown,
  ChevronUp,
  Keyboard,
  EyeOff,
} from 'lucide-react'
import { Button } from '@mdxui/primitives/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
} from '@mdxui/primitives/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@mdxui/primitives/dialog'
import { PageHeader } from './_app'
import { useDashboardPreferences, useKeyboardShortcuts } from '~/hooks'
import type { WidgetId } from '~/hooks'
import { appShortcuts, formatShortcut } from '~/config/shortcuts'

export const Route = createFileRoute('/app/_app/')({
  component: AppDashboard,
})

// =============================================================================
// Types
// =============================================================================

/** Metrics displayed on the dashboard */
interface DashboardMetrics {
  projects: number
  tasks: number
  workflows: number
}

/** Activity feed item */
interface ActivityItem {
  id: string
  description: string
  timestamp: string
}

/** Project list item */
interface ProjectItem {
  id: string
  name: string
  updatedAt: string
}

/** Task list item */
interface TaskItem {
  id: string
  title: string
  priority: 'high' | 'medium' | 'low'
}

/** Workflow list item */
interface WorkflowItem {
  id: string
  name: string
  status: 'running' | 'scheduled' | 'paused' | 'completed'
}

/** Metric card configuration */
interface MetricConfig {
  id: keyof DashboardMetrics
  label: string
  sublabel: string
  icon: React.ComponentType<{ className?: string }>
  testId: string
  valueTestId: string
}

// =============================================================================
// Mock Data
// =============================================================================

const mockMetrics: DashboardMetrics = {
  projects: 12,
  tasks: 24,
  workflows: 5,
}

const mockActivity: ActivityItem[] = [
  {
    id: '1',
    description: 'Created new project "Marketing Campaign"',
    timestamp: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
  },
  {
    id: '2',
    description: 'Completed task "Review PR #42"',
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(),
  },
  {
    id: '3',
    description: 'Started workflow "Daily Report"',
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 5).toISOString(),
  },
  {
    id: '4',
    description: 'Updated team member in "Product Launch"',
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(),
  },
]

const mockRecentProjects: ProjectItem[] = [
  { id: '1', name: 'Marketing Campaign', updatedAt: '2 hours ago' },
  { id: '2', name: 'Product Launch', updatedAt: '1 day ago' },
  { id: '3', name: 'Q4 Planning', updatedAt: '3 days ago' },
]

const mockPendingTasks: TaskItem[] = [
  { id: '1', title: 'Review PR #42', priority: 'high' },
  { id: '2', title: 'Update documentation', priority: 'medium' },
  { id: '3', title: 'Fix login bug', priority: 'high' },
]

const mockActiveWorkflows: WorkflowItem[] = [
  { id: '1', name: 'Daily Report', status: 'running' },
  { id: '2', name: 'Weekly Sync', status: 'scheduled' },
]

/** Metric cards configuration for reuse between desktop and mobile */
const METRIC_CONFIGS: MetricConfig[] = [
  {
    id: 'projects',
    label: 'Projects',
    sublabel: 'Active projects',
    icon: FolderKanban,
    testId: 'project-count',
    valueTestId: 'project-count-value',
  },
  {
    id: 'tasks',
    label: 'Tasks',
    sublabel: 'Pending tasks',
    icon: CheckSquare,
    testId: 'task-count',
    valueTestId: 'task-count-value',
  },
  {
    id: 'workflows',
    label: 'Workflows',
    sublabel: 'Active workflows',
    icon: Workflow,
    testId: 'workflow-count',
    valueTestId: 'workflow-count-value',
  },
]

// =============================================================================
// Utility Functions
// =============================================================================

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

// =============================================================================
// Skeleton Components with Staggered Animation
// =============================================================================

function SkeletonPulse({ className, delay = 0 }: { className?: string; delay?: number }) {
  return (
    <div
      className={`bg-muted rounded animate-pulse ${className}`}
      style={{ animationDelay: `${delay}ms` }}
    />
  )
}

function DashboardSkeleton() {
  return (
    <div data-testid="dashboard-skeleton" className="space-y-6">
      {/* Header skeleton */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="space-y-2">
          <SkeletonPulse className="h-8 w-48" delay={0} />
          <SkeletonPulse className="h-4 w-64" delay={50} />
        </div>
        <SkeletonPulse className="h-9 w-24" delay={100} />
      </div>

      {/* Metrics skeleton with staggered animation */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {[0, 1, 2].map((i) => (
          <div key={i} className="rounded-lg border bg-card p-6">
            <div className="flex items-center justify-between mb-4">
              <SkeletonPulse className="h-4 w-20" delay={150 + i * 50} />
              <SkeletonPulse className="h-5 w-5 rounded" delay={150 + i * 50} />
            </div>
            <SkeletonPulse className="h-9 w-16" delay={200 + i * 50} />
            <SkeletonPulse className="h-3 w-24 mt-2" delay={250 + i * 50} />
          </div>
        ))}
      </div>

      {/* Quick actions skeleton */}
      <div className="space-y-4">
        <SkeletonPulse className="h-5 w-28" delay={350} />
        <div className="flex flex-wrap gap-3">
          {[0, 1, 2, 3].map((i) => (
            <SkeletonPulse key={i} className="h-11 w-36" delay={400 + i * 50} />
          ))}
        </div>
      </div>

      {/* Activity skeleton */}
      <div className="rounded-lg border bg-card">
        <div className="p-4 border-b">
          <SkeletonPulse className="h-5 w-32" delay={600} />
        </div>
        {[0, 1, 2].map((i) => (
          <div key={i} className="p-4 flex items-start gap-3 border-b last:border-0">
            <SkeletonPulse className="h-4 w-4 rounded mt-0.5" delay={650 + i * 50} />
            <div className="flex-1 space-y-2">
              <SkeletonPulse className="h-4 w-full max-w-[300px]" delay={700 + i * 50} />
              <SkeletonPulse className="h-3 w-16" delay={750 + i * 50} />
            </div>
          </div>
        ))}
      </div>

      {/* Widget grid skeleton */}
      <div className="grid gap-6 grid-cols-1 md:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="rounded-lg border bg-card">
            <div className="p-4 border-b">
              <SkeletonPulse className="h-5 w-32" delay={850 + i * 50} />
            </div>
            {[0, 1, 2].map((j) => (
              <div key={j} className="p-4 border-b last:border-0">
                <SkeletonPulse className="h-4 w-full max-w-[150px]" delay={900 + i * 50 + j * 25} />
                <SkeletonPulse className="h-3 w-20 mt-1" delay={925 + i * 50 + j * 25} />
              </div>
            ))}
            <div className="p-4 border-t">
              <SkeletonPulse className="h-8 w-full" delay={1000 + i * 50} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// =============================================================================
// MetricCard Component
// =============================================================================

interface MetricCardProps {
  config: MetricConfig
  value: number
  variant?: 'desktop' | 'mobile'
}

function MetricCard({ config, value, variant = 'desktop' }: MetricCardProps) {
  const Icon = config.icon
  const baseClasses = 'rounded-lg border bg-card p-6'
  const variantClasses = variant === 'desktop'
    ? 'hover:border-primary/50 transition-colors'
    : 'min-w-[280px] snap-start'

  return (
    <div
      data-testid={config.testId}
      role="status"
      className={`${baseClasses} ${variantClasses}`}
    >
      <div className="flex items-center justify-between mb-4">
        <h3 data-testid="metric-label" className="text-sm font-medium text-muted-foreground">
          {config.label}
        </h3>
        <Icon className="h-5 w-5 text-muted-foreground" />
      </div>
      <p data-testid={config.valueTestId} className="text-3xl font-bold">{value}</p>
      <p className="text-xs text-muted-foreground mt-1">{config.sublabel}</p>
    </div>
  )
}

// =============================================================================
// Error Component
// =============================================================================

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

// =============================================================================
// Empty State Components
// =============================================================================

function EmptyStateIllustration({ type }: { type: 'projects' | 'tasks' | 'workflows' | 'activity' }) {
  const icons = {
    projects: FolderKanban,
    tasks: CheckSquare,
    workflows: Workflow,
    activity: Clock,
  }
  const Icon = icons[type]

  return (
    <div className="flex flex-col items-center justify-center py-8 text-center">
      <div className="rounded-full bg-muted p-4 mb-4">
        <Icon className="h-8 w-8 text-muted-foreground" />
      </div>
    </div>
  )
}

function NewUserEmptyState({ onAction }: { onAction: (action: string) => void }) {
  return (
    <div data-testid="new-user-empty-state" className="text-center py-12">
      <div className="inline-flex items-center justify-center rounded-full bg-gradient-to-br from-primary/20 to-primary/5 p-6 mb-6">
        <Rocket className="h-12 w-12 text-primary" />
      </div>
      <h2 className="text-2xl font-bold mb-2">Welcome to your dashboard!</h2>
      <p className="text-muted-foreground mb-8 max-w-md mx-auto">
        This is where you'll see all your projects, tasks, and workflows at a glance.
        Let's get started by creating your first project.
      </p>
      <div className="flex flex-col sm:flex-row gap-3 justify-center">
        <Button onClick={() => onAction('create-project')}>
          <Plus className="mr-2 h-4 w-4" />
          Create Your First Project
        </Button>
        <Button variant="outline" onClick={() => onAction('explore')}>
          <Sparkles className="mr-2 h-4 w-4" />
          Explore Features
        </Button>
      </div>
    </div>
  )
}

// =============================================================================
// Onboarding Checklist Component
// =============================================================================

function OnboardingChecklist({
  steps,
  onComplete,
  onDismiss,
}: {
  steps: { id: string; label: string; completed: boolean }[]
  onComplete: (stepId: string) => void
  onDismiss: () => void
}) {
  const completedCount = steps.filter((s) => s.completed).length
  const progress = (completedCount / steps.length) * 100

  return (
    <section
      data-testid="onboarding-checklist"
      className="rounded-lg border bg-gradient-to-br from-primary/5 to-transparent p-6"
    >
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="font-semibold flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            Getting Started
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            Complete these steps to get the most out of your workspace
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onDismiss}
          className="text-muted-foreground hover:text-foreground"
          aria-label="Dismiss onboarding"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Progress bar */}
      <div className="h-2 bg-muted rounded-full mb-4 overflow-hidden">
        <div
          className="h-full bg-primary rounded-full transition-all duration-500"
          style={{ width: `${progress}%` }}
          role="progressbar"
          aria-valuenow={completedCount}
          aria-valuemin={0}
          aria-valuemax={steps.length}
        />
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        {completedCount} of {steps.length} completed
      </p>

      {/* Checklist */}
      <ul className="space-y-3">
        {steps.map((step) => (
          <li key={step.id} className="flex items-center gap-3">
            <button
              onClick={() => !step.completed && onComplete(step.id)}
              className={`flex items-center justify-center h-5 w-5 rounded border-2 transition-colors ${
                step.completed
                  ? 'bg-primary border-primary text-primary-foreground'
                  : 'border-muted-foreground/30 hover:border-primary'
              }`}
              aria-label={step.completed ? `${step.label} completed` : `Mark ${step.label} as complete`}
            >
              {step.completed && <CheckSquare className="h-3 w-3" />}
            </button>
            <span className={step.completed ? 'line-through text-muted-foreground' : ''}>
              {step.label}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

// =============================================================================
// Widget Customization Dialog
// =============================================================================

function WidgetCustomizationMenu({
  widgets,
  onToggle,
  onReset,
}: {
  widgets: { id: WidgetId; label: string; visible: boolean }[]
  onToggle: (id: WidgetId) => void
  onReset: () => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          data-testid="customize-dashboard"
          variant="outline"
          size="sm"
          aria-label="Customize dashboard"
        >
          <Settings2 className="h-4 w-4 mr-2" />
          Customize
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Show Widgets</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {widgets.map((widget) => (
          <DropdownMenuCheckboxItem
            key={widget.id}
            checked={widget.visible}
            onCheckedChange={() => onToggle(widget.id)}
            data-testid={`widget-toggle-${widget.id}`}
          >
            {widget.label}
          </DropdownMenuCheckboxItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onReset} className="text-muted-foreground">
          Reset to defaults
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// =============================================================================
// Keyboard Shortcuts Dialog
// =============================================================================

function KeyboardShortcutsDialog() {
  const [open, setOpen] = useState(false)

  // Group shortcuts by category
  const shortcutsByCategory = useMemo(() => {
    const grouped: Record<string, typeof appShortcuts> = {}
    appShortcuts.forEach((shortcut) => {
      const category = shortcut.category || 'general'
      if (!grouped[category]) grouped[category] = []
      grouped[category].push(shortcut)
    })
    return grouped
  }, [])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          data-testid="keyboard-shortcuts-button"
          variant="ghost"
          size="sm"
          aria-label="Keyboard shortcuts"
        >
          <Keyboard className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent data-testid="keyboard-shortcuts-dialog" className="max-w-md">
        <DialogHeader>
          <DialogTitle>Keyboard Shortcuts</DialogTitle>
          <DialogDescription>
            Quick actions to navigate and control the dashboard
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-6 mt-4">
          {Object.entries(shortcutsByCategory).map(([category, shortcuts]) => (
            <div key={category}>
              <h4 className="text-sm font-medium capitalize text-muted-foreground mb-2">
                {category}
              </h4>
              <div className="space-y-2">
                {shortcuts.map((shortcut) => (
                  <div key={shortcut.id} className="flex items-center justify-between">
                    <span className="text-sm">{shortcut.description}</span>
                    <kbd className="px-2 py-1 text-xs bg-muted rounded font-mono">
                      {formatShortcut(shortcut)}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}

// =============================================================================
// Widget Components
// =============================================================================

interface WidgetProps {
  isLoading?: boolean
  isEmpty?: boolean
}

function RecentProjectsWidget({ isLoading, isEmpty }: WidgetProps) {
  if (isEmpty && mockRecentProjects.length === 0) {
    return (
      <section data-testid="user-widget-recent-projects" className="rounded-lg border bg-card">
        <div className="p-4 border-b">
          <h3 className="font-semibold flex items-center gap-2">
            <FolderKanban className="h-4 w-4" />
            Recent Projects
          </h3>
        </div>
        <div className="p-8 text-center">
          <EmptyStateIllustration type="projects" />
          <p data-testid="empty-state" className="text-muted-foreground mb-4">No projects yet</p>
          <Button size="sm" asChild>
            <Link to="/app/projects/new" search={{ create: true }}>
              <Plus className="h-4 w-4 mr-2" />
              Create Project
            </Link>
          </Button>
        </div>
      </section>
    )
  }

  return (
    <section data-testid="user-widget-recent-projects" className="rounded-lg border bg-card">
      <div className="p-4 border-b">
        <h3 className="font-semibold flex items-center gap-2">
          <FolderKanban className="h-4 w-4" />
          Recent Projects
        </h3>
      </div>
      <div className="divide-y">
        {mockRecentProjects.map((project) => (
          <div key={project.id} data-testid="project-item" className="p-4 hover:bg-muted/50 transition-colors">
            <p className="text-sm font-medium">{project.name}</p>
            <p className="text-xs text-muted-foreground">{project.updatedAt}</p>
          </div>
        ))}
      </div>
      <div className="p-4 border-t">
        <Button variant="ghost" size="sm" asChild className="w-full">
          <Link to="/app/projects">View All</Link>
        </Button>
      </div>
    </section>
  )
}

function PendingTasksWidget({ isLoading, isEmpty }: WidgetProps) {
  if (isEmpty && mockPendingTasks.length === 0) {
    return (
      <section data-testid="user-widget-pending-tasks" className="rounded-lg border bg-card">
        <div className="p-4 border-b">
          <h3 className="font-semibold flex items-center gap-2">
            <CheckSquare className="h-4 w-4" />
            Pending Tasks
          </h3>
        </div>
        <div className="p-8 text-center">
          <EmptyStateIllustration type="tasks" />
          <p data-testid="empty-state" className="text-muted-foreground mb-4">No pending tasks</p>
          <p className="text-sm text-muted-foreground">
            Tasks will appear here when added to your projects
          </p>
        </div>
      </section>
    )
  }

  return (
    <section data-testid="user-widget-pending-tasks" className="rounded-lg border bg-card">
      <div className="p-4 border-b">
        <h3 className="font-semibold flex items-center gap-2">
          <CheckSquare className="h-4 w-4" />
          Pending Tasks
        </h3>
      </div>
      <div className="divide-y">
        {mockPendingTasks.map((task) => (
          <div key={task.id} data-testid="task-item" className="p-4 flex items-center justify-between hover:bg-muted/50 transition-colors">
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
      <div className="p-4 border-t">
        <Button variant="ghost" size="sm" asChild className="w-full">
          <Link to="/app/tasks">View All</Link>
        </Button>
      </div>
    </section>
  )
}

function ActiveWorkflowsWidget({ isLoading, isEmpty }: WidgetProps) {
  if (isEmpty && mockActiveWorkflows.length === 0) {
    return (
      <section data-testid="user-widget-active-workflows" className="rounded-lg border bg-card">
        <div className="p-4 border-b">
          <h3 className="font-semibold flex items-center gap-2">
            <Workflow className="h-4 w-4" />
            Active Workflows
          </h3>
        </div>
        <div className="p-8 text-center">
          <EmptyStateIllustration type="workflows" />
          <p data-testid="empty-state" className="text-muted-foreground mb-4">No active workflows</p>
          <Button size="sm" asChild>
            <Link to="/app/workflows/new" search={{ create: true }}>
              <Plus className="h-4 w-4 mr-2" />
              Create Workflow
            </Link>
          </Button>
        </div>
      </section>
    )
  }

  return (
    <section data-testid="user-widget-active-workflows" className="rounded-lg border bg-card">
      <div className="p-4 border-b">
        <h3 className="font-semibold flex items-center gap-2">
          <Workflow className="h-4 w-4" />
          Active Workflows
        </h3>
      </div>
      <div className="divide-y">
        {mockActiveWorkflows.map((workflow) => (
          <div key={workflow.id} className="p-4 flex items-center justify-between hover:bg-muted/50 transition-colors">
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
      <div className="p-4 border-t">
        <Button variant="ghost" size="sm" asChild className="w-full">
          <Link to="/app/workflows">View All</Link>
        </Button>
      </div>
    </section>
  )
}

// =============================================================================
// Main Dashboard Component
// =============================================================================

function AppDashboard() {
  const navigate = useNavigate()
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [lastUpdated, setLastUpdated] = useState(formatLastUpdated())
  const [activityLimit, setActivityLimit] = useState(4)
  const [userName] = useState('John') // Would come from auth context
  const [showShortcutsHint, setShowShortcutsHint] = useState(false)

  // Dashboard preferences hook
  const {
    widgets,
    toggleWidget,
    visibleWidgets,
    isNewUser,
    onboardingSteps,
    completeOnboardingStep,
    dismissOnboarding,
    resetPreferences,
    visitCount,
  } = useDashboardPreferences()

  // Determine if we should show empty state for truly new users
  const hasNoData = mockMetrics.projects === 0 && mockMetrics.tasks === 0 && mockMetrics.workflows === 0
  const showNewUserEmptyState = isNewUser && hasNoData && visitCount <= 1

  // Simulate initial data loading
  useEffect(() => {
    const timer = setTimeout(() => {
      setIsLoading(false)
      setLastUpdated(formatLastUpdated())
    }, 100) // Quick load for tests
    return () => clearTimeout(timer)
  }, [])

  // Show keyboard shortcuts hint for new users after first load
  useEffect(() => {
    if (!isLoading && isNewUser && visitCount <= 2) {
      const timer = setTimeout(() => {
        setShowShortcutsHint(true)
        const hideTimer = setTimeout(() => setShowShortcutsHint(false), 5000)
        return () => clearTimeout(hideTimer)
      }, 2000)
      return () => clearTimeout(timer)
    }
  }, [isLoading, isNewUser, visitCount])

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true)
    await new Promise((resolve) => setTimeout(resolve, 500))
    setLastUpdated(formatLastUpdated())
    setIsRefreshing(false)
  }, [])

  const handleRetry = useCallback(() => {
    setError(null)
    setIsLoading(true)
    setTimeout(() => {
      setIsLoading(false)
      setLastUpdated(formatLastUpdated())
    }, 100)
  }, [])

  const handleShowMoreActivity = useCallback(() => {
    setActivityLimit((prev) => prev + 4)
  }, [])

  const handleNewUserAction = useCallback((action: string) => {
    switch (action) {
      case 'create-project':
        completeOnboardingStep('create-project')
        navigate({ to: '/app/projects/new', search: { create: true } })
        break
      case 'explore':
        // Show keyboard shortcuts dialog
        break
    }
  }, [navigate, completeOnboardingStep])

  // Dashboard keyboard shortcuts
  useKeyboardShortcuts([
    {
      key: 'r',
      meta: true,
      shift: true,
      callback: handleRefresh,
      allowInInput: false,
    },
  ])

  const displayedActivity = mockActivity.slice(0, activityLimit)
  const hasMoreActivity = mockActivity.length > activityLimit

  // Widget visibility helpers
  const isWidgetVisible = useCallback((id: WidgetId) => {
    return widgets.find((w) => w.id === id)?.visible ?? true
  }, [widgets])

  // Loading state
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

  // Error state
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

  // New user empty state (only shown when there's truly no data)
  if (showNewUserEmptyState) {
    return (
      <>
        <PageHeader />
        <div data-testid="user-dashboard" className="flex-1 overflow-auto p-4 pt-0">
          <NewUserEmptyState onAction={handleNewUserAction} />
        </div>
      </>
    )
  }

  return (
    <>
      <PageHeader />
      <main data-testid="user-dashboard" className="flex-1 overflow-auto p-4 pt-0">
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
          <div className="flex items-center gap-2">
            <span data-testid="last-updated" className="text-sm text-muted-foreground hidden sm:inline">
              {lastUpdated}
            </span>
            <KeyboardShortcutsDialog />
            <WidgetCustomizationMenu
              widgets={widgets}
              onToggle={toggleWidget}
              onReset={resetPreferences}
            />
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

        {/* Keyboard shortcuts hint for new users */}
        {showShortcutsHint && (
          <div
            data-testid="shortcuts-hint"
            className="mb-4 p-3 rounded-lg bg-primary/5 border border-primary/20 flex items-center justify-between animate-in fade-in slide-in-from-top-2"
          >
            <div className="flex items-center gap-2 text-sm">
              <Keyboard className="h-4 w-4 text-primary" />
              <span>Pro tip: Press <kbd className="px-1.5 py-0.5 bg-muted rounded text-xs font-mono">Shift+?</kbd> to see keyboard shortcuts</span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowShortcutsHint(false)}
              className="h-6 w-6 p-0"
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
        )}

        {/* Onboarding Checklist (shown for new users who have some data) */}
        {isNewUser && !hasNoData && (
          <div className="mb-6">
            <OnboardingChecklist
              steps={onboardingSteps}
              onComplete={completeOnboardingStep}
              onDismiss={dismissOnboarding}
            />
          </div>
        )}

        {/* User Metrics Section */}
        <section data-testid="user-metrics" className="mb-8">
          <h2 className="text-lg font-semibold mb-4">Your Metrics</h2>
          {/* Desktop Grid */}
          <div
            data-testid="metrics-grid"
            className="hidden md:grid gap-6 md:grid-cols-3"
          >
            {METRIC_CONFIGS.map((config) => (
              <MetricCard
                key={config.id}
                config={config}
                value={mockMetrics[config.id]}
                variant="desktop"
              />
            ))}
          </div>
          {/* Mobile Carousel */}
          <div
            data-testid="metrics-carousel"
            className="md:hidden flex gap-4 overflow-x-auto snap-x snap-mandatory pb-4"
          >
            {METRIC_CONFIGS.map((config) => (
              <MetricCard
                key={config.id}
                config={config}
                value={mockMetrics[config.id]}
                variant="mobile"
              />
            ))}
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

        {/* Activity Feed Section (only show if visible) */}
        {isWidgetVisible('activity-feed') && (
          <section data-testid="user-activity-feed" className="mb-8">
            <h2 className="text-lg font-semibold mb-4">Recent Activity</h2>
            <div className="rounded-lg border bg-card overflow-y-auto max-h-[400px] md:max-h-none md:overflow-visible">
              {displayedActivity.length === 0 ? (
                <div className="p-8 text-center">
                  <EmptyStateIllustration type="activity" />
                  <p data-testid="activity-empty-state" className="text-muted-foreground">
                    No recent activity
                  </p>
                  <p className="text-sm text-muted-foreground mt-2">
                    Activity will appear here as you use the app
                  </p>
                </div>
              ) : (
                <ul role="list" className="divide-y">
                  {displayedActivity.map((item) => (
                    <li
                      key={item.id}
                      data-testid="activity-item"
                      className="p-4 flex items-start gap-3 hover:bg-muted/50 transition-colors"
                    >
                      <Clock className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p data-testid="activity-description" className="text-sm">
                          {item.description}
                        </p>
                        <p data-testid="activity-timestamp" className="text-xs text-muted-foreground mt-1">
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
                    <ChevronDown className="h-4 w-4 mr-2" />
                    Show More
                  </Button>
                </div>
              )}
            </div>
          </section>
        )}

        {/* Widget Panels - Only show visible widgets */}
        <div className="grid gap-6 grid-cols-1 md:grid-cols-3">
          {isWidgetVisible('recent-projects') && (
            <RecentProjectsWidget isEmpty={isNewUser} />
          )}
          {isWidgetVisible('pending-tasks') && (
            <PendingTasksWidget isEmpty={isNewUser} />
          )}
          {isWidgetVisible('active-workflows') && (
            <ActiveWorkflowsWidget isEmpty={isNewUser} />
          )}
        </div>

        {/* Hidden widgets indicator */}
        {widgets.some((w) => !w.visible) && (
          <div className="mt-6 text-center">
            <p className="text-sm text-muted-foreground flex items-center justify-center gap-2">
              <EyeOff className="h-4 w-4" />
              {widgets.filter((w) => !w.visible).length} widget(s) hidden.{' '}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className="text-primary hover:underline inline-flex items-center"
                  >
                    Show widgets
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="center" className="w-56">
                  <DropdownMenuLabel>Hidden Widgets</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {widgets.filter((w) => !w.visible).map((widget) => (
                    <DropdownMenuItem
                      key={widget.id}
                      onClick={() => toggleWidget(widget.id)}
                    >
                      <Eye className="h-4 w-4 mr-2" />
                      Show {widget.label}
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={resetPreferences} className="text-muted-foreground">
                    Reset to defaults
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </p>
          </div>
        )}
      </main>
    </>
  )
}
