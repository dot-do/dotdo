/**
 * Approval Queue Page Route
 *
 * Main approval queue listing pending HumanFunction approval requests.
 * Provides filtering, sorting, and quick actions for approvals.
 *
 * Uses useCollection for real-time sync with the Approval collection via WebSocket.
 *
 * @see app/tests/approvals/approval-queue.test.tsx
 */

import * as React from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Shell } from '~/components/ui/shell'
import { useCollection } from '~/lib/hooks/use-collection'
import { ApprovalSchema, type Approval } from '~/collections'
import { useAuth } from '~/src/admin/auth'
import {
  ErrorState,
  EmptyState,
  ListSkeleton,
  PageHeader,
} from '~/components/admin/shared'
import { Button } from '~/components/ui/button'

export const Route = createFileRoute('/admin/approvals/')({
  component: ApprovalQueuePage,
})

// ============================================================================
// Types
// ============================================================================

type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired'
type ApprovalPriority = 'low' | 'medium' | 'high' | 'urgent'

// ============================================================================
// Priority Badge Component
// ============================================================================

function PriorityBadge({ priority }: { priority: ApprovalPriority }) {
  const colors: Record<ApprovalPriority, string> = {
    low: 'bg-gray-200 text-gray-800',
    medium: 'bg-blue-200 text-blue-800',
    high: 'bg-orange-200 text-orange-800',
    urgent: 'bg-red-500 text-white',
  }

  return (
    <span className={`px-2 py-1 rounded text-xs font-medium uppercase ${colors[priority]}`}>
      {priority}
    </span>
  )
}

// ============================================================================
// Status Badge Component
// ============================================================================

function StatusBadge({ status }: { status: ApprovalStatus }) {
  const colors: Record<ApprovalStatus, string> = {
    pending: 'bg-yellow-200 text-yellow-800',
    approved: 'bg-green-200 text-green-800',
    rejected: 'bg-red-200 text-red-800',
    expired: 'bg-gray-200 text-gray-800',
  }

  return (
    <span className={`px-2 py-1 rounded text-xs font-medium capitalize ${colors[status]}`}>
      {status}
    </span>
  )
}

// ============================================================================
// Approvals Card Skeleton Component
// ============================================================================

function ApprovalsCardSkeleton() {
  return (
    <div data-testid="loading" className="animate-pulse">
      <div className="h-8 bg-gray-200 rounded w-48 mb-6" />
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="bg-white rounded-lg shadow p-4">
            <div className="flex gap-4 items-center">
              <div className="h-6 bg-gray-200 rounded w-16" />
              <div className="h-4 bg-gray-200 rounded flex-1" />
              <div className="h-6 bg-gray-200 rounded w-20" />
              <div className="h-8 bg-gray-200 rounded w-24" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ============================================================================
// Format Date Helper
// ============================================================================

function formatTimeAgo(dateString: string): string {
  const date = new Date(dateString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  return `${diffDays}d ago`
}

// ============================================================================
// Approval Card Component
// ============================================================================

interface ApprovalCardProps {
  approval: Approval
  onApprove: () => void
  onReject: () => void
  onClick: () => void
}

function ApprovalCard({ approval, onApprove, onReject, onClick }: ApprovalCardProps) {
  const isPending = approval.status === 'pending'

  return (
    <div
      className="bg-white rounded-lg shadow p-4 hover:shadow-md transition-shadow cursor-pointer"
      onClick={onClick}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <PriorityBadge priority={approval.priority} />
            <StatusBadge status={approval.status} />
            <span className="text-xs text-gray-500">{formatTimeAgo(approval.createdAt)}</span>
          </div>
          <h3 className="font-semibold text-gray-900 mb-1">{approval.title}</h3>
          {approval.description && (
            <p className="text-sm text-gray-600 line-clamp-2">{approval.description}</p>
          )}
          {approval.dueAt && (
            <p className="text-xs text-orange-600 mt-2">
              Due: {new Date(approval.dueAt).toLocaleString()}
            </p>
          )}
        </div>
        {isPending && (
          <div className="flex gap-2 ml-4" onClick={(e) => e.stopPropagation()}>
            <Button
              type="button"
              size="sm"
              onClick={onApprove}
            >
              Approve
            </Button>
            <Button
              type="button"
              size="sm"
              variant="destructive"
              onClick={onReject}
            >
              Reject
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

// ============================================================================
// Filter Bar Component
// ============================================================================

interface FilterBarProps {
  statusFilter: ApprovalStatus | ''
  priorityFilter: ApprovalPriority | ''
  onStatusChange: (status: ApprovalStatus | '') => void
  onPriorityChange: (priority: ApprovalPriority | '') => void
}

function FilterBar({ statusFilter, priorityFilter, onStatusChange, onPriorityChange }: FilterBarProps) {
  return (
    <div className="flex gap-4 mb-6">
      <select
        value={statusFilter}
        onChange={(e) => onStatusChange(e.target.value as ApprovalStatus | '')}
        className="border rounded px-3 py-2 text-sm"
        aria-label="Filter by status"
      >
        <option value="">All Status</option>
        <option value="pending">Pending</option>
        <option value="approved">Approved</option>
        <option value="rejected">Rejected</option>
        <option value="expired">Expired</option>
      </select>
      <select
        value={priorityFilter}
        onChange={(e) => onPriorityChange(e.target.value as ApprovalPriority | '')}
        className="border rounded px-3 py-2 text-sm"
        aria-label="Filter by priority"
      >
        <option value="">All Priority</option>
        <option value="urgent">Urgent</option>
        <option value="high">High</option>
        <option value="medium">Medium</option>
        <option value="low">Low</option>
      </select>
    </div>
  )
}

// ============================================================================
// Main Page Component
// ============================================================================

function ApprovalQueuePage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [statusFilter, setStatusFilter] = React.useState<ApprovalStatus | ''>('')
  const [priorityFilter, setPriorityFilter] = React.useState<ApprovalPriority | ''>('')

  // Use collection for real-time approval data
  const approvals = useCollection({
    name: 'approvals',
    schema: ApprovalSchema,
  })

  // Filter approvals based on current filters
  const filteredApprovals = React.useMemo(() => {
    let result = approvals.data

    if (statusFilter) {
      result = result.filter((a) => a.status === statusFilter)
    }

    if (priorityFilter) {
      result = result.filter((a) => a.priority === priorityFilter)
    }

    // Sort by priority (urgent first) and then by date
    const priorityOrder: Record<ApprovalPriority, number> = {
      urgent: 0,
      high: 1,
      medium: 2,
      low: 3,
    }

    return result.sort((a, b) => {
      const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority]
      if (priorityDiff !== 0) return priorityDiff
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    })
  }, [approvals.data, statusFilter, priorityFilter])

  const handleApprovalClick = (id: string) => {
    navigate({ to: '/admin/approvals/$approvalId', params: { approvalId: id } })
  }

  const handleQuickApprove = async (approval: Approval) => {
    try {
      await approvals.update(approval.$id, {
        status: 'approved',
        decision: {
          outcome: 'approved',
          decidedBy: user?.id ?? 'anonymous',
          decidedAt: new Date().toISOString(),
        },
      })
    } catch (err) {
      console.error('Failed to approve:', err)
    }
  }

  const handleQuickReject = async (approval: Approval) => {
    try {
      await approvals.update(approval.$id, {
        status: 'rejected',
        decision: {
          outcome: 'rejected',
          decidedBy: user?.id ?? 'anonymous',
          decidedAt: new Date().toISOString(),
        },
      })
    } catch (err) {
      console.error('Failed to reject:', err)
    }
  }

  if (approvals.isLoading) {
    return (
      <Shell>
        <div className="p-6">
          <ApprovalsCardSkeleton />
        </div>
      </Shell>
    )
  }

  if (approvals.error) {
    return (
      <Shell>
        <div className="p-6">
          <ErrorState error={approvals.error} title="Error loading approvals" />
        </div>
      </Shell>
    )
  }

  // Count pending approvals for display
  const pendingCount = approvals.data.filter((a) => a.status === 'pending').length

  return (
    <Shell>
      <div className="p-6">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-2xl font-semibold">Approval Queue</h1>
            {pendingCount > 0 && (
              <p className="text-sm text-gray-500">
                {pendingCount} pending approval{pendingCount !== 1 ? 's' : ''}
              </p>
            )}
          </div>
          <a
            href="/admin/approvals/history"
            className="text-blue-600 hover:underline text-sm"
          >
            View History
          </a>
        </div>

        <FilterBar
          statusFilter={statusFilter}
          priorityFilter={priorityFilter}
          onStatusChange={setStatusFilter}
          onPriorityChange={setPriorityFilter}
        />

        {filteredApprovals.length === 0 ? (
          <EmptyState
            icon="&#10004;"
            title="All caught up!"
            description="No pending approvals at the moment."
          />
        ) : (
          <div className="space-y-4">
            {filteredApprovals.map((approval) => (
              <ApprovalCard
                key={approval.$id}
                approval={approval}
                onApprove={() => handleQuickApprove(approval)}
                onReject={() => handleQuickReject(approval)}
                onClick={() => handleApprovalClick(approval.$id)}
              />
            ))}
          </div>
        )}
      </div>
    </Shell>
  )
}
