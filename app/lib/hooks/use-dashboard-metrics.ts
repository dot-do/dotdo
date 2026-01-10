/**
 * useDashboardMetrics Hook
 *
 * Provides aggregated dashboard metrics for the admin dashboard.
 * Combines data from multiple sources (agents, workflows, API calls, uptime)
 * and provides real-time updates, loading/error states, and refresh capability.
 *
 * @example
 * ```tsx
 * const { metrics, isLoading, error, refresh } = useDashboardMetrics()
 *
 * if (isLoading) return <Skeleton />
 * if (error) return <Error message={error.message} />
 *
 * return (
 *   <>
 *     <KPICard title="Active Agents" value={metrics.activeAgents} />
 *     <KPICard title="Workflows" value={metrics.totalWorkflows} />
 *   </>
 * )
 * ```
 */

import { useState, useEffect, useCallback, useMemo } from 'react'

// =============================================================================
// Types
// =============================================================================

/**
 * Activity item representing a recent event in the system
 */
export interface Activity {
  id: string
  type: string
  title: string
  description?: string
  timestamp: Date | string
}

/**
 * Agent status representing an AI agent's current state
 */
export interface AgentStatus {
  id: string
  name: string
  status: 'idle' | 'working' | 'error'
  role?: string
}

/**
 * API call metrics with trend calculation
 */
export interface ApiCallMetrics {
  today: number
  yesterday: number
  /** Percentage change from yesterday (positive = increase) */
  trend: number
}

/**
 * System uptime metrics
 */
export interface UptimeMetrics {
  /** Uptime percentage (0-100) */
  percentage: number
  /** Overall health status */
  status: 'healthy' | 'degraded' | 'down'
}

/**
 * Chart data for API usage visualization
 */
export interface ApiUsageDataPoint {
  date: string
  calls: number
}

/**
 * Chart data for workflow run visualization
 */
export interface WorkflowRunDataPoint {
  date: string
  success: number
  failed: number
}

/**
 * Complete dashboard metrics object
 */
export interface DashboardMetrics {
  /** Number of active AI agents */
  activeAgents: number
  /** Total number of workflows */
  totalWorkflows: number
  /** API call statistics */
  apiCalls: ApiCallMetrics
  /** System uptime information */
  uptime: UptimeMetrics
  /** Recent activity feed items */
  recentActivity: Activity[]
  /** Current status of all agents */
  agentStatuses: AgentStatus[]
  /** Chart data for visualizations */
  chartData: {
    apiUsage: ApiUsageDataPoint[]
    workflowRuns: WorkflowRunDataPoint[]
  }
}

/**
 * Return type for the useDashboardMetrics hook
 */
export interface UseDashboardMetricsReturn {
  /** Dashboard metrics, null while loading */
  metrics: DashboardMetrics | null
  /** True while fetching metrics */
  isLoading: boolean
  /** Error if fetch failed */
  error: Error | null
  /** Function to manually refresh metrics */
  refresh: () => void
}

// =============================================================================
// Default/Mock Data
// =============================================================================

/**
 * Named agents from dotdo
 */
const DEFAULT_AGENTS: AgentStatus[] = [
  { id: 'priya', name: 'Priya', status: 'idle', role: 'Product' },
  { id: 'ralph', name: 'Ralph', status: 'working', role: 'Engineering' },
  { id: 'tom', name: 'Tom', status: 'idle', role: 'Tech Lead' },
  { id: 'mark', name: 'Mark', status: 'idle', role: 'Marketing' },
  { id: 'sally', name: 'Sally', status: 'idle', role: 'Sales' },
  { id: 'quinn', name: 'Quinn', status: 'idle', role: 'QA' },
]

/**
 * Generate mock API usage data for the last 7 days
 */
function generateApiUsageData(): ApiUsageDataPoint[] {
  const data: ApiUsageDataPoint[] = []
  const now = new Date()

  for (let i = 6; i >= 0; i--) {
    const date = new Date(now)
    date.setDate(date.getDate() - i)
    data.push({
      date: date.toISOString().split('T')[0],
      calls: Math.floor(Math.random() * 500) + 100,
    })
  }

  return data
}

/**
 * Generate mock workflow run data for the last 7 days
 */
function generateWorkflowRunData(): WorkflowRunDataPoint[] {
  const data: WorkflowRunDataPoint[] = []
  const now = new Date()

  for (let i = 6; i >= 0; i--) {
    const date = new Date(now)
    date.setDate(date.getDate() - i)
    const total = Math.floor(Math.random() * 20) + 5
    const failed = Math.floor(Math.random() * 3)
    data.push({
      date: date.toISOString().split('T')[0],
      success: total - failed,
      failed,
    })
  }

  return data
}

/**
 * Default metrics to use when data is not yet loaded
 */
function getDefaultMetrics(): DashboardMetrics {
  const apiUsageData = generateApiUsageData()
  const todayCalls = apiUsageData[apiUsageData.length - 1]?.calls || 0
  const yesterdayCalls = apiUsageData[apiUsageData.length - 2]?.calls || 0
  const trend = yesterdayCalls > 0
    ? Math.round(((todayCalls - yesterdayCalls) / yesterdayCalls) * 100)
    : 0

  return {
    activeAgents: DEFAULT_AGENTS.filter(a => a.status === 'working').length,
    totalWorkflows: 12,
    apiCalls: {
      today: todayCalls,
      yesterday: yesterdayCalls,
      trend,
    },
    uptime: {
      percentage: 99.9,
      status: 'healthy',
    },
    recentActivity: [
      {
        id: '1',
        type: 'workflow',
        title: 'Deployment completed',
        description: 'Production deployment successful',
        timestamp: new Date(),
      },
      {
        id: '2',
        type: 'agent',
        title: 'Ralph completed task',
        description: 'Built feature branch',
        timestamp: new Date(Date.now() - 3600000),
      },
      {
        id: '3',
        type: 'api',
        title: 'API key created',
        description: 'New production API key generated',
        timestamp: new Date(Date.now() - 7200000),
      },
    ],
    agentStatuses: DEFAULT_AGENTS,
    chartData: {
      apiUsage: apiUsageData,
      workflowRuns: generateWorkflowRunData(),
    },
  }
}

// =============================================================================
// Hook Implementation
// =============================================================================

/**
 * Hook that provides dashboard metrics with loading/error states and refresh capability.
 *
 * Currently uses mock data, but designed to integrate with:
 * - useCollection for aggregating data from multiple collections
 * - use$ for direct RPC calls to a MetricsDO (Durable Object)
 *
 * When the data layer is fully implemented, this hook will:
 * 1. Subscribe to real-time updates via WebSocket
 * 2. Aggregate data from Agents, Workflows, and Metrics collections
 * 3. Compute trends and statistics from historical data
 *
 * @returns Dashboard metrics, loading state, error, and refresh function
 */
export function useDashboardMetrics(): UseDashboardMetricsReturn {
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  /**
   * Fetch metrics from the backend
   * Currently simulates an async fetch with mock data
   */
  const fetchMetrics = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      // TODO: Replace with actual data fetching when collections are implemented
      // Example implementation:
      // const { data: agents } = useCollection({ name: 'Agent', schema: AgentSchema })
      // const { data: workflows } = useCollection({ name: 'Workflow', schema: WorkflowSchema })
      // const metricsResponse = await $.Metrics('global').getDashboardMetrics()

      // Simulate network delay
      await new Promise(resolve => setTimeout(resolve, 100))

      const data = getDefaultMetrics()
      setMetrics(data)
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      setError(error)
    } finally {
      setIsLoading(false)
    }
  }, [])

  /**
   * Manual refresh function exposed to consumers
   */
  const refresh = useCallback(() => {
    setRefreshKey(k => k + 1)
  }, [])

  // Fetch metrics on mount and when refresh is triggered
  useEffect(() => {
    fetchMetrics()
  }, [fetchMetrics, refreshKey])

  // TODO: Set up real-time subscriptions when use$ is implemented
  // useEffect(() => {
  //   if (!$) return
  //
  //   const unsubscribes = [
  //     $.on.Agent.change(() => refresh()),
  //     $.on.Workflow.change(() => refresh()),
  //     $.on.Metrics.update((data) => {
  //       setMetrics(prev => prev ? { ...prev, ...data } : data)
  //     }),
  //   ]
  //
  //   return () => {
  //     unsubscribes.forEach(unsub => unsub())
  //   }
  // }, [$, refresh])

  return {
    metrics,
    isLoading,
    error,
    refresh,
  }
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Calculate the trend percentage between two values
 */
export function calculateTrend(current: number, previous: number): number {
  if (previous === 0) return current > 0 ? 100 : 0
  return Math.round(((current - previous) / previous) * 100)
}

/**
 * Determine uptime status based on percentage
 */
export function getUptimeStatus(percentage: number): UptimeMetrics['status'] {
  if (percentage >= 99.9) return 'healthy'
  if (percentage >= 95) return 'degraded'
  return 'down'
}

/**
 * Format a number for display (e.g., 1200 -> "1.2k")
 */
export function formatMetricValue(value: number): string {
  if (value >= 1000000) {
    return (value / 1000000).toFixed(1) + 'M'
  }
  if (value >= 1000) {
    return (value / 1000).toFixed(1) + 'k'
  }
  return value.toString()
}
