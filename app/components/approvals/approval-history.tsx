/**
 * ApprovalHistory Component
 *
 * Displays the history of past approvals with:
 * - Filtering by date range, user, and outcome
 * - Sorting by various fields
 * - Pagination
 * - Individual audit trail expansion
 * - Export functionality
 *
 * @see app/tests/approvals/approval-history.test.tsx
 */

import * as React from 'react'
import { cn } from '../../lib/utils'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Skeleton } from '../ui/skeleton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select'
import type {
  ApprovalHistoryItem,
  ApprovalPriority,
  AuditLogEntry,
  ApprovalFilters,
  ApprovalSort,
  PaginationInfo,
} from '../../types/approval'

// =============================================================================
// Helper Functions
// =============================================================================

function formatRelativeTime(date: Date): string {
  const now = new Date()
  const diffMs = now.getTime() - new Date(date).getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return 'just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  return new Date(date).toLocaleDateString()
}

function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / 60000)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (days > 0) return `${days}d ${hours % 24}h`
  if (hours > 0) return `${hours}h ${minutes % 60}m`
  return `${minutes}m`
}

const statusConfig: Record<string, { label: string; className: string }> = {
  approved: { label: 'Approved', className: 'bg-green-100 text-green-800' },
  rejected: { label: 'Rejected', className: 'bg-red-100 text-red-800' },
  expired: { label: 'Expired', className: 'bg-gray-100 text-gray-800' },
  cancelled: { label: 'Cancelled', className: 'bg-yellow-100 text-yellow-800' },
}

const priorityConfig: Record<ApprovalPriority, { label: string; className: string }> = {
  critical: { label: 'Critical', className: 'bg-red-100 text-red-800' },
  high: { label: 'High', className: 'bg-orange-100 text-orange-800' },
  normal: { label: 'Normal', className: 'bg-blue-100 text-blue-800' },
  low: { label: 'Low', className: 'bg-gray-100 text-gray-800' },
}

const actionConfig: Record<string, { label: string; className: string; icon?: string }> = {
  view: { label: 'Viewed', className: 'text-gray-600' },
  approve: { label: 'Approved', className: 'text-green-600' },
  reject: { label: 'Rejected', className: 'text-red-600' },
  escalate: { label: 'Escalated', className: 'text-purple-600' },
  expire: { label: 'Expired', className: 'text-gray-600' },
  comment: { label: 'Commented', className: 'text-blue-600' },
  reassign: { label: 'Reassigned', className: 'text-orange-600' },
  create: { label: 'Created', className: 'text-green-600' },
}

// =============================================================================
// Mock Data
// =============================================================================

function getMockHistoryItems(): ApprovalHistoryItem[] {
  return [
    {
      id: 'history-1',
      taskId: 'task-1',
      type: 'refund_request',
      title: 'Refund Request - Order #ORD-2025-9876',
      description: 'Customer refund for order #ORD-2025-9876',
      requester: { id: 'agent-1', name: 'Customer Service Bot', type: 'agent' },
      status: 'approved',
      priority: 'high',
      createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
      completedAt: new Date(Date.now() - 20 * 60 * 60 * 1000),
      completedBy: { id: 'user-1', name: 'Alice Manager', email: 'alice@company.com' },
      duration: 4 * 60 * 60 * 1000,
      escalationCount: 0,
      auditLog: [
        {
          id: 'log-1',
          timestamp: new Date(Date.now() - 24 * 60 * 60 * 1000),
          action: 'create',
          userId: 'agent-1',
          userName: 'Customer Service Bot',
          userEmail: 'cs-bot@dotdo.ai',
          details: { source: 'workflow' },
        },
        {
          id: 'log-2',
          timestamp: new Date(Date.now() - 22 * 60 * 60 * 1000),
          action: 'view',
          userId: 'user-1',
          userName: 'Alice Manager',
          userEmail: 'alice@company.com',
        },
        {
          id: 'log-3',
          timestamp: new Date(Date.now() - 20 * 60 * 60 * 1000),
          action: 'approve',
          userId: 'user-1',
          userName: 'Alice Manager',
          userEmail: 'alice@company.com',
          details: { formData: { refundAmount: 150 } },
        },
      ],
      outcome: {
        action: 'approve',
        formData: { refundAmount: 150 },
      },
      workflow: {
        type: 'sequential',
        levels: [
          { name: 'Manager Review', completedBy: 'Alice Manager', completedAt: new Date(Date.now() - 20 * 60 * 60 * 1000), action: 'approve' },
        ],
      },
    },
    {
      id: 'history-2',
      taskId: 'task-2',
      type: 'account_deletion',
      title: 'Account Deletion - User #789',
      description: 'User requested account deletion',
      requester: { id: 'workflow-1', name: 'Privacy Workflow', type: 'workflow' },
      status: 'rejected',
      priority: 'normal',
      createdAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
      completedAt: new Date(Date.now() - 44 * 60 * 60 * 1000),
      completedBy: { id: 'user-2', name: 'Bob Admin', email: 'bob@company.com' },
      duration: 4 * 60 * 60 * 1000,
      escalationCount: 1,
      auditLog: [
        {
          id: 'log-4',
          timestamp: new Date(Date.now() - 48 * 60 * 60 * 1000),
          action: 'create',
          userId: 'workflow-1',
          userName: 'Privacy Workflow',
          userEmail: 'privacy@dotdo.ai',
        },
        {
          id: 'log-5',
          timestamp: new Date(Date.now() - 46 * 60 * 60 * 1000),
          action: 'escalate',
          userId: 'system',
          userName: 'System',
          userEmail: 'system@dotdo.ai',
          details: { reason: 'No response within SLA' },
        },
        {
          id: 'log-6',
          timestamp: new Date(Date.now() - 44 * 60 * 60 * 1000),
          action: 'reject',
          userId: 'user-2',
          userName: 'Bob Admin',
          userEmail: 'bob@company.com',
          details: { reason: 'Active subscription exists' },
        },
      ],
      outcome: {
        action: 'reject',
        reason: 'Active subscription exists - cannot delete account',
      },
    },
    {
      id: 'history-3',
      taskId: 'task-3',
      type: 'access_request',
      title: 'Database Access - Dev Team',
      description: 'Production database read access request',
      requester: { id: 'human-1', name: 'Charlie Developer', type: 'human' },
      status: 'expired',
      priority: 'critical',
      createdAt: new Date(Date.now() - 72 * 60 * 60 * 1000),
      completedAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
      completedBy: { id: 'system', name: 'System', email: 'system@dotdo.ai' },
      duration: 24 * 60 * 60 * 1000,
      escalationCount: 2,
      auditLog: [
        {
          id: 'log-7',
          timestamp: new Date(Date.now() - 72 * 60 * 60 * 1000),
          action: 'create',
          userId: 'human-1',
          userName: 'Charlie Developer',
          userEmail: 'charlie@company.com',
        },
        {
          id: 'log-8',
          timestamp: new Date(Date.now() - 48 * 60 * 60 * 1000),
          action: 'expire',
          userId: 'system',
          userName: 'System',
          userEmail: 'system@dotdo.ai',
          details: { reason: 'SLA exceeded' },
        },
      ],
    },
  ]
}

// =============================================================================
// Subcomponents
// =============================================================================

interface HistoryItemProps {
  item: ApprovalHistoryItem
  isExpanded: boolean
  onToggle: () => void
}

function HistoryItem({ item, isExpanded, onToggle }: HistoryItemProps) {
  const statusCfg = statusConfig[item.status]
  const priorityCfg = priorityConfig[item.priority]

  return (
    <div className="bg-white rounded-lg border overflow-hidden">
      {/* Item Header */}
      <button
        onClick={onToggle}
        className="w-full text-left p-4 hover:bg-gray-50 transition-colors"
        aria-expanded={isExpanded}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="font-medium text-gray-900 truncate">{item.title}</h3>
            </div>
            <p className="text-sm text-gray-500 truncate">{item.description}</p>
            <div className="flex flex-wrap items-center gap-2 mt-2">
              <Badge className={statusCfg.className}>{statusCfg.label}</Badge>
              <Badge className={priorityCfg.className}>{priorityCfg.label}</Badge>
              <Badge variant="outline" className="capitalize text-xs">
                {item.type.replace(/_/g, ' ')}
              </Badge>
            </div>
          </div>
          <div className="text-right text-sm text-gray-500 shrink-0">
            <div>Completed {formatRelativeTime(item.completedAt)}</div>
            <div className="text-xs mt-1">Duration: {formatDuration(item.duration)}</div>
            <svg
              className={cn(
                'w-5 h-5 text-gray-400 mt-2 ml-auto transition-transform',
                isExpanded && 'rotate-180'
              )}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </div>
      </button>

      {/* Expanded Details */}
      {isExpanded && (
        <div className="border-t p-4 bg-gray-50">
          {/* Completion Info */}
          <div className="mb-4">
            <h4 className="text-sm font-medium text-gray-700 mb-2">Completion Details</h4>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-gray-500">Completed By:</span>
                <span className="ml-2 font-medium">{item.completedBy.name}</span>
              </div>
              <div>
                <span className="text-gray-500">Escalations:</span>
                <span className="ml-2 font-medium">{item.escalationCount}</span>
              </div>
            </div>
            {item.outcome?.reason && (
              <div className="mt-2">
                <span className="text-gray-500 text-sm">Reason:</span>
                <p className="text-sm mt-1">{item.outcome.reason}</p>
              </div>
            )}
          </div>

          {/* Workflow Levels */}
          {item.workflow?.levels && item.workflow.levels.length > 0 && (
            <div className="mb-4">
              <h4 className="text-sm font-medium text-gray-700 mb-2">Workflow Levels</h4>
              <div className="space-y-2">
                {item.workflow.levels.map((level, index) => (
                  <div key={index} className="flex items-center gap-2 text-sm">
                    <span
                      className={cn(
                        'w-2 h-2 rounded-full',
                        level.action === 'approve' && 'bg-green-500',
                        level.action === 'reject' && 'bg-red-500',
                        !level.action && 'bg-gray-300'
                      )}
                    />
                    <span className="font-medium">{level.name}</span>
                    {level.completedBy && (
                      <span className="text-gray-500">by {level.completedBy}</span>
                    )}
                    {level.completedAt && (
                      <span className="text-gray-400 text-xs ml-auto">
                        {formatRelativeTime(level.completedAt)}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Audit Log */}
          <div>
            <h4 className="text-sm font-medium text-gray-700 mb-2">Audit Trail</h4>
            <div className="space-y-2">
              {item.auditLog.map((entry) => (
                <AuditLogItem key={entry.id} entry={entry} />
              ))}
            </div>
          </div>

          {/* View Full Details Link */}
          <div className="mt-4 pt-4 border-t">
            <a
              href={`/admin/approvals/${item.id}/audit`}
              className="text-sm text-blue-600 hover:underline"
            >
              View Full Audit Trail
            </a>
          </div>
        </div>
      )}
    </div>
  )
}

function AuditLogItem({ entry }: { entry: AuditLogEntry }) {
  const actionCfg = actionConfig[entry.action] || { label: entry.action, className: 'text-gray-600' }

  return (
    <div className="flex items-start gap-3 text-sm">
      <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-xs font-medium shrink-0">
        {entry.userName.charAt(0).toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium">{entry.userName}</span>
          <span className={cn('text-xs', actionCfg.className)}>{actionCfg.label}</span>
        </div>
        {entry.details?.reason && (
          <p className="text-gray-600 text-xs mt-0.5">{entry.details.reason as string}</p>
        )}
        <span className="text-gray-400 text-xs">{formatRelativeTime(entry.timestamp)}</span>
      </div>
    </div>
  )
}

function HistorySkeleton() {
  return (
    <div className="space-y-4">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="bg-white rounded-lg border p-4 space-y-3">
          <div className="flex justify-between">
            <Skeleton className="h-5 w-1/2" />
            <Skeleton className="h-4 w-24" />
          </div>
          <Skeleton className="h-4 w-3/4" />
          <div className="flex gap-2">
            <Skeleton className="h-5 w-16" />
            <Skeleton className="h-5 w-16" />
          </div>
        </div>
      ))}
    </div>
  )
}

function EmptyHistoryState() {
  return (
    <div className="text-center py-12 bg-white rounded-lg border">
      <svg
        className="mx-auto h-12 w-12 text-gray-400"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
        />
      </svg>
      <h3 className="mt-2 text-sm font-medium text-gray-900">No approval history</h3>
      <p className="mt-1 text-sm text-gray-500">No completed approvals match your filters.</p>
    </div>
  )
}

// =============================================================================
// Component Props
// =============================================================================

export interface ApprovalHistoryPageProps {
  history: ApprovalHistoryItem[]
  onFilterChange?: (filters: ApprovalFilters) => void
  onSortChange?: (sort: ApprovalSort) => void
  isLoading?: boolean
  error?: Error | null
  pagination?: PaginationInfo
  onPageChange?: (page: number) => void
  onExport?: (format: 'csv' | 'json') => void
}

// =============================================================================
// Main Component (for testing)
// =============================================================================

export function ApprovalHistoryPage({
  history,
  onFilterChange,
  onSortChange,
  isLoading = false,
  error = null,
  pagination,
  onPageChange,
  onExport,
}: ApprovalHistoryPageProps) {
  const [filters, setFilters] = React.useState<ApprovalFilters>({})
  const [expandedId, setExpandedId] = React.useState<string | null>(null)
  const [dateRange, setDateRange] = React.useState({ fromDate: '', toDate: '' })

  const handleFilterChange = (key: keyof ApprovalFilters, value: string) => {
    const newFilters = {
      ...filters,
      [key]: value === 'all' ? undefined : value,
    }
    setFilters(newFilters)
    onFilterChange?.(newFilters)
  }

  const handleDateRangeChange = (key: 'fromDate' | 'toDate', value: string) => {
    const newDateRange = { ...dateRange, [key]: value }
    setDateRange(newDateRange)
    onFilterChange?.({
      ...filters,
      fromDate: newDateRange.fromDate || undefined,
      toDate: newDateRange.toDate || undefined,
    })
  }

  const handleClearFilters = () => {
    setFilters({})
    setDateRange({ fromDate: '', toDate: '' })
    onFilterChange?.({})
  }

  const toggleExpanded = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id))
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Approval History</h1>
          <p className="text-sm text-gray-500 mt-1">View past approval decisions and audit trails</p>
        </div>
        <div className="flex gap-2">
          <a
            href="/admin/approvals"
            className="text-sm text-blue-600 hover:underline flex items-center"
          >
            <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to Queue
          </a>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg border p-4">
        <div className="flex flex-col sm:flex-row gap-4 flex-wrap">
          {/* Status Filter */}
          <Select
            value={filters.status || 'all'}
            onValueChange={(v) => handleFilterChange('status', v)}
          >
            <SelectTrigger className="w-[140px]" aria-label="Status">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
              <SelectItem value="expired">Expired</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
            </SelectContent>
          </Select>

          {/* Priority Filter */}
          <Select
            value={filters.priority || 'all'}
            onValueChange={(v) => handleFilterChange('priority', v)}
          >
            <SelectTrigger className="w-[140px]" aria-label="Priority">
              <SelectValue placeholder="Priority" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Priority</SelectItem>
              <SelectItem value="critical">Critical</SelectItem>
              <SelectItem value="high">High</SelectItem>
              <SelectItem value="normal">Normal</SelectItem>
              <SelectItem value="low">Low</SelectItem>
            </SelectContent>
          </Select>

          {/* Type Filter */}
          <Select
            value={filters.type || 'all'}
            onValueChange={(v) => handleFilterChange('type', v)}
          >
            <SelectTrigger className="w-[160px]" aria-label="Type">
              <SelectValue placeholder="Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="refund_request">Refund Request</SelectItem>
              <SelectItem value="account_deletion">Account Deletion</SelectItem>
              <SelectItem value="access_request">Access Request</SelectItem>
            </SelectContent>
          </Select>

          {/* Date Range */}
          <div className="flex items-center gap-2">
            <Input
              type="date"
              value={dateRange.fromDate}
              onChange={(e) => handleDateRangeChange('fromDate', e.target.value)}
              className="w-[140px]"
              aria-label="From date"
            />
            <span className="text-gray-500">to</span>
            <Input
              type="date"
              value={dateRange.toDate}
              onChange={(e) => handleDateRangeChange('toDate', e.target.value)}
              className="w-[140px]"
              aria-label="To date"
            />
          </div>

          {/* Clear Filters */}
          <Button
            variant="outline"
            onClick={handleClearFilters}
            className="min-h-11"
            aria-label="Clear filters"
          >
            Reset
          </Button>

          {/* Export Buttons */}
          {onExport && (
            <div className="flex gap-2 ml-auto">
              <Button
                variant="outline"
                size="sm"
                onClick={() => onExport('csv')}
                aria-label="Export CSV"
              >
                Export CSV
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onExport('json')}
                aria-label="Export JSON"
              >
                Export JSON
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Loading State */}
      {isLoading && <HistorySkeleton />}

      {/* Error State */}
      {error && (
        <div role="alert" className="bg-red-50 border border-red-200 rounded-lg p-4">
          <h3 className="text-sm font-medium text-red-800">Failed to load history</h3>
          <p className="mt-1 text-sm text-red-700">{error.message}</p>
        </div>
      )}

      {/* Empty State */}
      {!isLoading && !error && history.length === 0 && <EmptyHistoryState />}

      {/* History List */}
      {!isLoading && !error && history.length > 0 && (
        <div className="space-y-4">
          {history.map((item) => (
            <HistoryItem
              key={item.id}
              item={item}
              isExpanded={expandedId === item.id}
              onToggle={() => toggleExpanded(item.id)}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {pagination && pagination.totalPages > 1 && (
        <nav aria-label="Pagination" className="flex items-center justify-between">
          <p className="text-sm text-gray-600">
            Page {pagination.page} of {pagination.totalPages} ({pagination.total} total)
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onPageChange?.(pagination.page - 1)}
              disabled={pagination.page <= 1}
              aria-label="Previous page"
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onPageChange?.(pagination.page + 1)}
              disabled={pagination.page >= pagination.totalPages}
              aria-label="Next page"
            >
              Next
            </Button>
          </div>
        </nav>
      )}
    </div>
  )
}

// =============================================================================
// Main Component (Route wrapper)
// =============================================================================

export function ApprovalHistory() {
  const [history, setHistory] = React.useState<ApprovalHistoryItem[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<Error | null>(null)
  const [page, setPage] = React.useState(1)
  const pageSize = 10

  React.useEffect(() => {
    const loadHistory = async () => {
      try {
        setIsLoading(true)
        // Simulate API call
        await new Promise((resolve) => setTimeout(resolve, 300))
        const data = getMockHistoryItems()
        setHistory(data)
        setError(null)
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Failed to load history'))
      } finally {
        setIsLoading(false)
      }
    }
    loadHistory()
  }, [])

  const handleFilterChange = (filters: ApprovalFilters) => {
    console.log('Filter changed:', filters)
    setPage(1)
  }

  const handleSortChange = (sort: ApprovalSort) => {
    console.log('Sort changed:', sort)
  }

  const handleExport = (format: 'csv' | 'json') => {
    console.log('Export:', format)
    // Implement export functionality
  }

  const pagination: PaginationInfo = {
    page,
    pageSize,
    total: history.length,
    totalPages: Math.ceil(history.length / pageSize),
  }

  return (
    <ApprovalHistoryPage
      history={history}
      onFilterChange={handleFilterChange}
      onSortChange={handleSortChange}
      isLoading={isLoading}
      error={error}
      pagination={pagination}
      onPageChange={setPage}
      onExport={handleExport}
    />
  )
}
