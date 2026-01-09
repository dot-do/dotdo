/**
 * ApprovalQueue Component
 *
 * Displays the queue of pending approvals with filtering, sorting,
 * and pagination capabilities.
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
import { ApprovalCard } from './approval-card'
import type { ApprovalRequest, ApprovalFilters, ApprovalSort } from '../../types/approval'

// =============================================================================
// Component Props
// =============================================================================

export interface ApprovalQueuePageProps {
  approvals: ApprovalRequest[]
  onApprovalClick: (id: string) => void
  onFilterChange?: (filters: ApprovalFilters) => void
  onSortChange?: (sort: ApprovalSort) => void
  onQuickApprove?: (id: string) => void
  onQuickReject?: (id: string) => void
  isLoading?: boolean
  error?: Error | null
  totalCount?: number
  page?: number
  pageSize?: number
  onPageChange?: (page: number) => void
}

// =============================================================================
// Subcomponents
// =============================================================================

function QueueSkeleton() {
  return (
    <div className="space-y-4">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} data-testid="skeleton" className="bg-white rounded-lg border p-4 space-y-3">
          <div className="flex justify-between">
            <Skeleton className="h-5 w-1/2" />
            <Skeleton className="h-5 w-20" />
          </div>
          <Skeleton className="h-4 w-3/4" />
          <div className="flex gap-2">
            <Skeleton className="h-6 w-16" />
            <Skeleton className="h-6 w-16" />
          </div>
          <div className="flex justify-between pt-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-20" />
          </div>
        </div>
      ))}
    </div>
  )
}

function EmptyState() {
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
          d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
        />
      </svg>
      <h3 className="mt-2 text-sm font-medium text-gray-900">No pending approvals</h3>
      <p className="mt-1 text-sm text-gray-500">All caught up! There are no approvals waiting for your review.</p>
    </div>
  )
}

function ErrorState({ error }: { error: Error }) {
  return (
    <div role="alert" className="bg-red-50 border border-red-200 rounded-lg p-4">
      <div className="flex">
        <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
          <path
            fillRule="evenodd"
            d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
            clipRule="evenodd"
          />
        </svg>
        <div className="ml-3">
          <h3 className="text-sm font-medium text-red-800">Failed to load approvals</h3>
          <p className="mt-1 text-sm text-red-700">{error.message}</p>
        </div>
      </div>
    </div>
  )
}

// =============================================================================
// Main Component
// =============================================================================

export function ApprovalQueuePage({
  approvals,
  onApprovalClick,
  onFilterChange,
  onSortChange,
  onQuickApprove,
  onQuickReject,
  isLoading = false,
  error = null,
  totalCount,
  page = 1,
  pageSize = 10,
  onPageChange,
}: ApprovalQueuePageProps) {
  const [filters, setFilters] = React.useState<ApprovalFilters>({})
  const [sortBy, setSortBy] = React.useState<string>('createdAt')
  const [searchValue, setSearchValue] = React.useState('')

  const pendingCount = approvals.filter((a) => a.status === 'pending').length
  const displayTotal = totalCount ?? approvals.length
  const totalPages = Math.ceil(displayTotal / pageSize)
  const showPagination = displayTotal > pageSize

  // Handle filter changes
  const handleFilterChange = (key: keyof ApprovalFilters, value: string) => {
    const newFilters = {
      ...filters,
      [key]: value === 'all' ? undefined : value,
    }
    setFilters(newFilters)
    onFilterChange?.(newFilters)
  }

  // Handle search with debounce
  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setSearchValue(value)
    // Debounce search
    const timer = setTimeout(() => {
      onFilterChange?.({ ...filters, search: value || undefined })
    }, 300)
    return () => clearTimeout(timer)
  }

  // Handle sort change
  const handleSortChange = (value: string) => {
    setSortBy(value)
    onSortChange?.({ sortBy: value as ApprovalSort['sortBy'], sortOrder: 'desc' })
  }

  // Handle clear filters
  const handleClearFilters = () => {
    setFilters({})
    setSearchValue('')
    setSortBy('createdAt')
    onFilterChange?.({})
  }

  // Sort approvals locally if no external handler
  const sortedApprovals = React.useMemo(() => {
    if (onSortChange) return approvals // External sorting

    return [...approvals].sort((a, b) => {
      switch (sortBy) {
        case 'priority': {
          const priorityOrder = { critical: 0, high: 1, normal: 2, low: 3 }
          return priorityOrder[a.priority] - priorityOrder[b.priority]
        }
        case 'expiresAt':
          if (!a.expiresAt) return 1
          if (!b.expiresAt) return -1
          return new Date(a.expiresAt).getTime() - new Date(b.expiresAt).getTime()
        case 'newest':
        default:
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      }
    })
  }, [approvals, sortBy, onSortChange])

  // Apply local pagination if no external handler
  const paginatedApprovals = React.useMemo(() => {
    if (onPageChange) return sortedApprovals // External pagination
    const start = (page - 1) * pageSize
    return sortedApprovals.slice(start, start + pageSize)
  }, [sortedApprovals, page, pageSize, onPageChange])

  return (
    <div data-testid="shell" className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold text-gray-900">Approval Queue</h1>
          <Badge className="bg-yellow-100 text-yellow-800">
            {pendingCount} pending
          </Badge>
        </div>
        <a
          href="/admin/approvals/history"
          className="text-blue-600 hover:underline text-sm"
        >
          View History
        </a>
      </div>

      {/* Live Update Indicator */}
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <span
          className="w-2 h-2 bg-green-500 rounded-full animate-pulse"
          aria-label="Live updates enabled"
        />
        <span>Live updates</span>
      </div>

      {/* Filters and Search */}
      <div className="flex flex-col sm:flex-row gap-4 flex-wrap">
        {/* Search */}
        <div className="flex-1 min-w-[200px]">
          <Input
            type="search"
            placeholder="Search approvals..."
            aria-label="Search"
            value={searchValue}
            onChange={handleSearchChange}
            className="w-full"
          />
        </div>

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
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="escalated">Escalated</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
            <SelectItem value="expired">Expired</SelectItem>
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

        {/* Sort */}
        <Select value={sortBy} onValueChange={handleSortChange}>
          <SelectTrigger className="w-[160px]" aria-label="Sort">
            <SelectValue placeholder="Sort by" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="newest">Newest First</SelectItem>
            <SelectItem value="priority">Priority</SelectItem>
            <SelectItem value="expiresAt">Expiring Soon</SelectItem>
          </SelectContent>
        </Select>

        {/* Clear Filters */}
        <Button
          variant="outline"
          onClick={handleClearFilters}
          className="min-h-11 min-w-11"
          aria-label="Clear filters"
        >
          Reset
        </Button>
      </div>

      {/* Loading State */}
      {isLoading && (
        <>
          <div role="progressbar" aria-label="Loading approvals" className="sr-only">
            Loading...
          </div>
          <QueueSkeleton />
        </>
      )}

      {/* Error State */}
      {error && <ErrorState error={error} />}

      {/* Empty State */}
      {!isLoading && !error && paginatedApprovals.length === 0 && <EmptyState />}

      {/* Approval List */}
      {!isLoading && !error && paginatedApprovals.length > 0 && (
        <div
          data-testid="approval-list"
          className="flex flex-col gap-4"
        >
          {paginatedApprovals.map((approval) => (
            <ApprovalCard
              key={approval.id}
              approval={approval}
              onClick={() => onApprovalClick(approval.id)}
              onQuickApprove={() => onQuickApprove?.(approval.id)}
              onQuickReject={() => onQuickReject?.(approval.id)}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {showPagination && !isLoading && !error && (
        <nav aria-label="Pagination" className="flex items-center justify-between">
          <p className="text-sm text-gray-600">
            Showing {(page - 1) * pageSize + 1} - {Math.min(page * pageSize, displayTotal)} of {displayTotal}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onPageChange?.(page - 1)}
              disabled={page <= 1}
              aria-label="Previous page"
              className="min-h-11 min-w-11"
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onPageChange?.(page + 1)}
              disabled={page >= totalPages}
              aria-label="Next page"
              className="min-h-11 min-w-11"
            >
              Next
            </Button>
          </div>
        </nav>
      )}

      {/* New Approval Toast Placeholder - would be managed by parent */}
      <div id="toast-container" aria-live="polite" className="sr-only" />
    </div>
  )
}
