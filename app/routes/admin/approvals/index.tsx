/**
 * Approval Queue Page Route
 *
 * Main approval queue listing pending HumanFunction approval requests.
 * Provides filtering, sorting, and quick actions for approvals.
 *
 * @see app/tests/approvals/approval-queue.test.tsx
 */

import * as React from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Shell } from '~/components/ui/shell'
import { ApprovalQueuePage as ApprovalQueueComponent } from '../../../components/approvals/approval-queue'
import type { ApprovalRequest, ApprovalFilters, ApprovalSort } from '../../../types/approval'

export const Route = createFileRoute('/admin/approvals/')({
  component: ApprovalQueuePage,
})

// Mock data for demonstration - in production this would come from API
function getMockApprovals(): ApprovalRequest[] {
  return [
    {
      id: 'approval-1',
      taskId: 'task-1',
      type: 'refund_request',
      title: 'Large Refund Request - $5,000',
      description: 'Customer requesting refund for premium subscription',
      requester: {
        id: 'agent-1',
        name: 'AI Agent Alpha',
        email: 'agent-alpha@dotdo.ai',
        type: 'agent',
      },
      status: 'pending',
      priority: 'high',
      createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
      expiresAt: new Date(Date.now() + 10 * 60 * 60 * 1000),
      channel: 'in-app',
      data: {
        orderId: 'ORD-2026-12345',
        customerName: 'John Doe',
        orderAmount: 5000,
      },
    },
    {
      id: 'approval-2',
      taskId: 'task-2',
      type: 'account_deletion',
      title: 'Account Deletion Request',
      description: 'User requesting complete account and data deletion',
      requester: {
        id: 'agent-2',
        name: 'AI Agent Beta',
        email: 'agent-beta@dotdo.ai',
        type: 'agent',
      },
      status: 'pending',
      priority: 'normal',
      createdAt: new Date(Date.now() - 1 * 60 * 60 * 1000),
      channel: 'in-app',
      data: {
        userId: 'user-789',
        userName: 'Jane Smith',
      },
    },
    {
      id: 'approval-3',
      taskId: 'task-3',
      type: 'access_request',
      title: 'Critical System Access Request',
      description: 'Request for elevated permissions to production database',
      requester: {
        id: 'workflow-1',
        name: 'Security Workflow',
        email: 'security@dotdo.ai',
        type: 'workflow',
      },
      status: 'escalated',
      priority: 'critical',
      escalationLevel: 2,
      createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
      expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
      channel: 'in-app',
      data: {
        requestingUser: 'dev-team-lead',
        accessLevel: 'admin',
        duration: '24 hours',
      },
    },
  ]
}

function ApprovalQueuePage() {
  const navigate = useNavigate()
  const [approvals, setApprovals] = React.useState<ApprovalRequest[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<Error | null>(null)
  const [page, setPage] = React.useState(1)
  const [filters, setFilters] = React.useState<ApprovalFilters>({})

  React.useEffect(() => {
    const loadApprovals = async () => {
      try {
        setIsLoading(true)
        await new Promise((resolve) => setTimeout(resolve, 300))
        const data = getMockApprovals()
        setApprovals(data)
        setError(null)
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Failed to load approvals'))
      } finally {
        setIsLoading(false)
      }
    }
    loadApprovals()
  }, [])

  const handleApprovalClick = (id: string) => {
    navigate({ to: '/admin/approvals/$approvalId', params: { approvalId: id } })
  }

  const handleQuickApprove = async (id: string) => {
    setApprovals((prev) => prev.map((a) => (a.id === id ? { ...a, status: 'approved' as const } : a)))
  }

  const handleQuickReject = async (id: string) => {
    setApprovals((prev) => prev.map((a) => (a.id === id ? { ...a, status: 'rejected' as const } : a)))
  }

  const handleFilterChange = (newFilters: ApprovalFilters) => {
    setFilters(newFilters)
    setPage(1)
  }

  const handleSortChange = (sort: ApprovalSort) => {
    console.log('Sort changed:', sort)
  }

  return (
    <Shell>
      <div className='p-6'>
        <ApprovalQueueComponent
          approvals={approvals}
          onApprovalClick={handleApprovalClick}
          onFilterChange={handleFilterChange}
          onSortChange={handleSortChange}
          onQuickApprove={handleQuickApprove}
          onQuickReject={handleQuickReject}
          isLoading={isLoading}
          error={error}
          totalCount={approvals.length}
          page={page}
          pageSize={10}
          onPageChange={setPage}
        />
      </div>
    </Shell>
  )
}
