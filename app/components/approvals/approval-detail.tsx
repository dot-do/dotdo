/**
 * ApprovalDetail Component
 *
 * Displays detailed information about an approval request including:
 * - Header with title, status, priority, and navigation
 * - Requester information with avatar
 * - Request data in organized sections
 * - Time remaining / expiration countdown
 * - Escalation status and history
 * - Approval chain visualization
 * - Decision form with validation
 * - Related approvals and context
 *
 * @see app/tests/approvals/approval-detail.test.tsx
 */

import * as React from 'react'
import { Link } from '@tanstack/react-router'
import { cn } from '../../lib/utils'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { ApprovalForm } from './approval-form'
import { ApprovalChain } from './approval-chain'
import {
  formatRelativeTime,
  formatTimeRemaining,
  priorityConfig,
  statusConfig,
} from '../../lib/utils/approval'
import type {
  ApprovalRequest,
  EscalationInfo,
  ApprovalContext,
  AuditLogEntry,
} from '../../types/approval'
import { getMockApproval } from '../../../tests/mocks/approval'

// =============================================================================
// Helper Functions
// =============================================================================

function isUrgent(expiresAt?: Date): boolean {
  if (!expiresAt) return false
  const now = new Date()
  const diffMs = new Date(expiresAt).getTime() - now.getTime()
  return diffMs > 0 && diffMs < 60 * 60 * 1000 // Less than 1 hour
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(value)
}

function formatDataKey(key: string): string {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/_/g, ' ')
    .replace(/^\w/, (c) => c.toUpperCase())
    .trim()
}

function formatDataValue(value: unknown): string {
  if (value === null || value === undefined) return '-'
  if (typeof value === 'number' && (String(value).includes('.') || value >= 100)) {
    return formatCurrency(value)
  }
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (value instanceof Date) return new Date(value).toLocaleDateString()
  return String(value)
}

// =============================================================================
// Component Props
// =============================================================================

export interface ApprovalDetailPageProps {
  approval: ApprovalRequest
  onApprove: (data: { reason?: string; formData?: Record<string, unknown> }) => Promise<void>
  onReject: (data: { reason: string }) => Promise<void>
  onEscalate?: (data: { to: string; reason: string }) => Promise<void>
  isSubmitting?: boolean
}

interface ApprovalDetailProps {
  approvalId: string
}

// =============================================================================
// Subcomponents
// =============================================================================

function DataSection({
  title,
  data,
  expanded = true,
}: {
  title: string
  data: Record<string, unknown>
  expanded?: boolean
}) {
  const [isExpanded, setIsExpanded] = React.useState(expanded)

  return (
    <div className="border rounded-lg overflow-hidden">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between p-4 bg-gray-50 hover:bg-gray-100 transition-colors"
        aria-expanded={isExpanded}
        aria-label={isExpanded ? 'Collapse details' : 'View details'}
      >
        <span className="font-medium text-gray-900">{title}</span>
        <svg
          className={cn('w-5 h-5 text-gray-500 transition-transform', isExpanded && 'rotate-180')}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {isExpanded && (
        <div data-testid="expanded-data" className="p-4 space-y-3">
          {Object.entries(data).map(([key, value]) => (
            <div key={key} className="flex justify-between items-start">
              <span className="text-sm text-gray-600">{formatDataKey(key)}</span>
              <span className="text-sm font-medium text-gray-900 text-right max-w-[60%]">
                {formatDataValue(value)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function JsonViewer({ data }: { data: Record<string, unknown> }) {
  return (
    <div data-testid="json-viewer" className="bg-gray-900 rounded-lg p-4 overflow-auto max-h-96">
      <pre className="text-sm text-green-400 whitespace-pre-wrap">
        {JSON.stringify(data, null, 2)}
      </pre>
    </div>
  )
}

function EscalationStatus({ escalation }: { escalation: EscalationInfo }) {
  return (
    <div data-escalation className="bg-purple-50 border border-purple-200 rounded-lg p-4">
      <h3 className="font-medium text-purple-900 mb-3 flex items-center gap-2">
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
          <path
            fillRule="evenodd"
            d="M5 2a1 1 0 011 1v1h1a1 1 0 010 2H6v1a1 1 0 01-2 0V6H3a1 1 0 010-2h1V3a1 1 0 011-1zm0 10a1 1 0 011 1v1h1a1 1 0 110 2H6v1a1 1 0 11-2 0v-1H3a1 1 0 110-2h1v-1a1 1 0 011-1zM12 2a1 1 0 01.967.744L14.146 7.2 17.5 9.134a1 1 0 010 1.732l-3.354 1.935-1.18 4.455a1 1 0 01-1.933 0L9.854 12.8 6.5 10.866a1 1 0 010-1.732l3.354-1.935 1.18-4.455A1 1 0 0112 2z"
            clipRule="evenodd"
          />
        </svg>
        Escalation Status
      </h3>
      <div className="space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-purple-700">Current Level</span>
          <span className="font-medium">Level {escalation.level} of {escalation.maxLevel}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-purple-700">Escalated To</span>
          <span className="font-medium">{escalation.escalatedTo}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-purple-700">Escalated At</span>
          <span className="font-medium">{formatRelativeTime(escalation.escalatedAt)}</span>
        </div>
        <div>
          <span className="text-purple-700">Reason:</span>
          <p className="mt-1 text-purple-900">{escalation.reason}</p>
        </div>
      </div>

      {/* Escalation History */}
      {escalation.history && escalation.history.length > 0 && (
        <div className="mt-4 pt-4 border-t border-purple-200">
          <h4 className="text-sm font-medium text-purple-900 mb-2">Escalation History</h4>
          <div className="space-y-2">
            {escalation.history.map((entry, index) => (
              <div key={index} className="flex items-start gap-2 text-xs">
                <span className="bg-purple-200 text-purple-800 px-1.5 py-0.5 rounded">
                  L{entry.level}
                </span>
                <span className="text-purple-600">
                  {entry.from} &rarr; {entry.to}
                </span>
                <span className="text-purple-500 ml-auto">
                  {formatRelativeTime(entry.timestamp)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function EscalateDialog({
  isOpen,
  onClose,
  onConfirm,
}: {
  isOpen: boolean
  onClose: () => void
  onConfirm: (data: { to: string; reason: string }) => void
}) {
  const [target, setTarget] = React.useState('')
  const [reason, setReason] = React.useState('')

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" role="dialog">
      <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
        <h3 className="text-lg font-semibold mb-4">Escalate to</h3>
        <div className="space-y-4">
          <div>
            <label htmlFor="escalate-target" className="block text-sm font-medium mb-1">
              Escalate To
            </label>
            <select
              id="escalate-target"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              className="w-full border rounded-md p-2"
              aria-label="Escalate to"
            >
              <option value="">Select target</option>
              <option value="manager">Manager</option>
              <option value="director">Director</option>
              <option value="cto">CTO</option>
            </select>
          </div>
          <div>
            <label htmlFor="escalate-reason" className="block text-sm font-medium mb-1">
              Reason
            </label>
            <textarea
              id="escalate-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Enter escalation reason..."
              className="w-full border rounded-md p-2 min-h-[80px]"
              aria-label="Reason"
            />
          </div>
        </div>
        <div className="flex gap-2 justify-end mt-6">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              onConfirm({ to: target, reason })
              onClose()
            }}
            disabled={!target || !reason.trim()}
          >
            Confirm Escalation
          </Button>
        </div>
      </div>
    </div>
  )
}

function PreviousDecisions({
  decisions,
}: {
  decisions: NonNullable<ApprovalContext['previousDecisions']>
}) {
  return (
    <div className="border rounded-lg p-4">
      <h3 className="font-medium text-gray-900 mb-3">Previous Decisions</h3>
      <div className="space-y-3">
        {decisions.map((decision, index) => (
          <div key={index} className="flex items-start gap-3 text-sm">
            <span
              className={cn(
                'w-2 h-2 mt-1.5 rounded-full',
                decision.action === 'approve' && 'bg-green-500',
                decision.action === 'reject' && 'bg-red-500'
              )}
            />
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="font-medium">{decision.userName}</span>
                <span
                  className={cn(
                    'px-1.5 py-0.5 rounded text-xs',
                    decision.action === 'approve' && 'bg-green-100 text-green-800',
                    decision.action === 'reject' && 'bg-red-100 text-red-800'
                  )}
                >
                  {decision.action}
                </span>
              </div>
              {decision.reason && (
                <p className="text-gray-600 mt-1">{decision.reason}</p>
              )}
              <span className="text-gray-400 text-xs">
                {formatRelativeTime(decision.timestamp)}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function RelatedApprovals({
  approvals,
}: {
  approvals: NonNullable<ApprovalContext['relatedApprovals']>
}) {
  return (
    <div className="border rounded-lg p-4">
      <h3 className="font-medium text-gray-900 mb-3">Related Approvals</h3>
      <div className="space-y-2">
        {approvals.map((related) => (
          <a
            key={related.id}
            href={`/admin/approvals/${related.id}`}
            className="flex items-center justify-between p-2 rounded hover:bg-gray-50 transition-colors"
          >
            <span className="text-sm text-blue-600 hover:underline">{related.title}</span>
            <Badge
              className={cn(
                'text-xs',
                related.status === 'approved' && 'bg-green-100 text-green-800',
                related.status === 'rejected' && 'bg-red-100 text-red-800',
                related.status === 'pending' && 'bg-yellow-100 text-yellow-800'
              )}
            >
              {related.status}
            </Badge>
          </a>
        ))}
      </div>
    </div>
  )
}

// =============================================================================
// Main Detail Page Component (for testing)
// =============================================================================

export function ApprovalDetailPage({
  approval,
  onApprove,
  onReject,
  onEscalate,
  isSubmitting = false,
}: ApprovalDetailPageProps) {
  const [showJsonViewer, setShowJsonViewer] = React.useState(false)
  const [showEscalateDialog, setShowEscalateDialog] = React.useState(false)

  const priorityCfg = priorityConfig[approval.priority]
  const statusCfg = statusConfig[approval.status]
  const isPending = approval.status === 'pending'
  const isCompleted = ['approved', 'rejected', 'expired'].includes(approval.status)
  const urgent = isUrgent(approval.expiresAt)

  const handleFormSubmit = async (
    action: string,
    data: { formData?: Record<string, unknown>; reason?: string }
  ) => {
    if (action === 'reject') {
      await onReject({ reason: data.reason || '' })
    } else {
      await onApprove(data)
    }
  }

  const handleEscalate = (data: { to: string; reason: string }) => {
    onEscalate?.(data)
  }

  return (
    <div className="space-y-6">
      {/* Back Link */}
      <a href="/admin/approvals" className="inline-flex items-center text-sm text-blue-600 hover:underline">
        <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back to Queue
      </a>

      {/* Header */}
      <div className="bg-white rounded-lg border p-6">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div className="flex-1">
            <h1 className="text-2xl font-semibold text-gray-900 mb-2">{approval.title}</h1>
            <div className="flex flex-wrap items-center gap-2">
              <Badge className={statusCfg.className} aria-label={`Status: ${statusCfg.label}`}>
                {statusCfg.label}
              </Badge>
              <Badge className={priorityCfg.className} aria-label={`${priorityCfg.label} priority`}>
                {priorityCfg.label} Priority
              </Badge>
              <Badge variant="outline" className="capitalize">
                {approval.type.replace(/_/g, ' ')}
              </Badge>
            </div>
          </div>

          {/* Timing Information */}
          <div className="text-right text-sm text-gray-600">
            <div className="flex items-center gap-1 justify-end">
              <span>Created</span>
              <span className="font-medium">{formatRelativeTime(approval.createdAt)}</span>
            </div>
            {approval.expiresAt && (
              <div className="flex items-center gap-1 justify-end mt-1">
                <span>Expires</span>
                <span
                  role="status"
                  className={cn(
                    'font-medium',
                    urgent ? 'text-red-600' : 'text-gray-900'
                  )}
                >
                  in {formatTimeRemaining(approval.expiresAt)}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Urgent Warning */}
        {urgent && isPending && (
          <div role="alert" className="mt-4 bg-red-50 border border-red-200 rounded-lg p-3 flex items-center gap-2">
            <svg className="w-5 h-5 text-red-600 shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                clipRule="evenodd"
              />
            </svg>
            <span className="text-red-800 text-sm font-medium">
              Urgent: This approval expires soon and requires immediate attention
            </span>
          </div>
        )}

        {/* Expired State */}
        {approval.status === 'expired' && (
          <div className="mt-4 bg-gray-50 border border-gray-200 rounded-lg p-3">
            <span className="text-gray-600 text-sm">
              This approval expired at {approval.expiresAt ? new Date(approval.expiresAt).toLocaleString() : 'N/A'}
            </span>
          </div>
        )}

        {/* Completed State */}
        {isCompleted && approval.context?.previousDecisions?.[0] && (
          <div
            className={cn(
              'mt-4 rounded-lg p-4 border',
              approval.status === 'approved' && 'bg-green-50 border-green-200',
              approval.status === 'rejected' && 'bg-red-50 border-red-200'
            )}
          >
            <p
              className={cn(
                'font-medium',
                approval.status === 'approved' && 'text-green-900',
                approval.status === 'rejected' && 'text-red-900'
              )}
            >
              {approval.status === 'approved' ? 'Approved' : 'Rejected'} by{' '}
              {approval.context.previousDecisions[0].userName}
            </p>
            {approval.context.previousDecisions[0].reason && (
              <p
                className={cn(
                  'mt-1 text-sm',
                  approval.status === 'approved' && 'text-green-700',
                  approval.status === 'rejected' && 'text-red-700'
                )}
              >
                {approval.context.previousDecisions[0].reason}
              </p>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Requester Information */}
          <div className="bg-white rounded-lg border p-6">
            <h2 className="font-medium text-gray-900 mb-4">Requester</h2>
            <div className="flex items-start gap-4">
              {approval.requester.avatar ? (
                <img
                  src={approval.requester.avatar}
                  alt="Requester avatar"
                  className="w-12 h-12 rounded-full"
                />
              ) : (
                <div className="w-12 h-12 rounded-full bg-gray-200 flex items-center justify-center text-lg font-medium text-gray-600">
                  {approval.requester.name.charAt(0).toUpperCase()}
                </div>
              )}
              <div>
                <p className="font-medium text-gray-900">{approval.requester.name}</p>
                <p className="text-sm text-gray-500">{approval.requester.email}</p>
                {approval.requester.type && (
                  <Badge variant="outline" className="mt-1 text-xs capitalize">
                    {approval.requester.type === 'agent' ? 'AI Agent' : approval.requester.type}
                  </Badge>
                )}
              </div>
            </div>
            {approval.context?.workflow && (
              <a
                href={`/admin/workflows/${approval.context.workflow}`}
                className="inline-flex items-center mt-4 text-sm text-blue-600 hover:underline"
              >
                <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
                  />
                </svg>
                View Workflow
              </a>
            )}
          </div>

          {/* Description */}
          <div className="bg-white rounded-lg border p-6">
            <h2 className="font-medium text-gray-900 mb-3">Description</h2>
            <p className="text-gray-700 whitespace-pre-wrap">{approval.description}</p>
          </div>

          {/* Request Data */}
          <div className="bg-white rounded-lg border p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-medium text-gray-900">Request Details</h2>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowJsonViewer(!showJsonViewer)}
                aria-label={showJsonViewer ? 'Hide JSON' : 'View JSON'}
              >
                {showJsonViewer ? 'Hide JSON' : 'View JSON'}
              </Button>
            </div>
            {showJsonViewer ? (
              <JsonViewer data={approval.data} />
            ) : (
              <DataSection title="Details" data={approval.data} />
            )}
          </div>

          {/* Approval Workflow Chain */}
          {approval.approvalWorkflow && approval.approvalWorkflow.levels && (
            <div className="bg-white rounded-lg border p-6">
              <h2 className="font-medium text-gray-900 mb-4">Approval Chain</h2>
              <ApprovalChain workflow={approval.approvalWorkflow} />
            </div>
          )}

          {/* Escalation Status */}
          {approval.escalation && (
            <EscalationStatus escalation={approval.escalation} />
          )}

          {/* Reminder Status */}
          {approval.reminder?.sentAt && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm">
              <p className="text-blue-800">
                Reminder sent {formatRelativeTime(approval.reminder.sentAt)}
              </p>
              {approval.reminder.nextAt && (
                <p className="text-blue-600 mt-1">
                  Next reminder: {formatRelativeTime(approval.reminder.nextAt)}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Decision Form */}
          {isPending && (
            <div className="bg-white rounded-lg border p-6">
              <h2 className="font-medium text-gray-900 mb-4">Make Decision</h2>
              <ApprovalForm
                form={approval.form}
                actions={approval.actions}
                onSubmit={handleFormSubmit}
                isSubmitting={isSubmitting}
                requiresConfirmation={true}
                highValueThreshold={5000}
                formData={approval.data}
              />

              {/* Escalate Button */}
              {onEscalate && (
                <div className="mt-4 pt-4 border-t">
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => setShowEscalateDialog(true)}
                    disabled={isSubmitting}
                  >
                    Escalate
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* Previous Decisions */}
          {approval.context?.previousDecisions && approval.context.previousDecisions.length > 0 && (
            <PreviousDecisions decisions={approval.context.previousDecisions} />
          )}

          {/* Related Approvals */}
          {approval.context?.relatedApprovals && approval.context.relatedApprovals.length > 0 && (
            <RelatedApprovals approvals={approval.context.relatedApprovals} />
          )}

          {/* Audit Trail Link */}
          <div className="bg-white rounded-lg border p-4">
            <a
              href={`/admin/approvals/${approval.id}/audit`}
              className="flex items-center justify-between text-sm text-blue-600 hover:underline"
            >
              <span>View Audit Trail</span>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </a>
          </div>

          {/* Attachments placeholder */}
          <div className="bg-white rounded-lg border p-4">
            <h3 className="font-medium text-gray-900 mb-2">Attachments</h3>
            <p className="text-sm text-gray-500">No files attached</p>
          </div>
        </div>
      </div>

      {/* Escalate Dialog */}
      <EscalateDialog
        isOpen={showEscalateDialog}
        onClose={() => setShowEscalateDialog(false)}
        onConfirm={handleEscalate}
      />
    </div>
  )
}

// =============================================================================
// Main Component (Route wrapper)
// =============================================================================

export function ApprovalDetail({ approvalId }: ApprovalDetailProps) {
  const [approval, setApproval] = React.useState<ApprovalRequest | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const [error, setError] = React.useState<Error | null>(null)

  React.useEffect(() => {
    const loadApproval = async () => {
      try {
        setIsLoading(true)
        // Simulate API call
        await new Promise((resolve) => setTimeout(resolve, 300))
        const data = getMockApproval(approvalId)
        if (!data) {
          throw new Error('Approval not found')
        }
        setApproval(data)
        setError(null)
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Failed to load approval'))
      } finally {
        setIsLoading(false)
      }
    }
    loadApproval()
  }, [approvalId])

  const handleApprove = async (data: { reason?: string; formData?: Record<string, unknown> }) => {
    setIsSubmitting(true)
    try {
      await new Promise((resolve) => setTimeout(resolve, 1000))
      setApproval((prev) => prev ? { ...prev, status: 'approved' } : null)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleReject = async (data: { reason: string }) => {
    setIsSubmitting(true)
    try {
      await new Promise((resolve) => setTimeout(resolve, 1000))
      setApproval((prev) => prev ? { ...prev, status: 'rejected' } : null)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleEscalate = async (data: { to: string; reason: string }) => {
    setIsSubmitting(true)
    try {
      await new Promise((resolve) => setTimeout(resolve, 1000))
      setApproval((prev) =>
        prev
          ? {
              ...prev,
              status: 'escalated',
              escalationLevel: (prev.escalationLevel || 0) + 1,
            }
          : null
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-6 p-6">
        <div className="h-8 w-32 bg-gray-200 rounded animate-pulse" />
        <div className="h-40 bg-gray-200 rounded animate-pulse" />
        <div className="h-60 bg-gray-200 rounded animate-pulse" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-6">
        <div role="alert" className="bg-red-50 border border-red-200 rounded-lg p-4">
          <h2 className="text-lg font-medium text-red-800">Error</h2>
          <p className="text-red-600 mt-1">{error.message}</p>
          <a href="/admin/approvals" className="text-blue-600 hover:underline mt-2 inline-block">
            Back to Queue
          </a>
        </div>
      </div>
    )
  }

  if (!approval) {
    return (
      <div className="p-6">
        <div className="text-center py-12">
          <h2 className="text-lg font-medium text-gray-900">Approval not found</h2>
          <a href="/admin/approvals" className="text-blue-600 hover:underline mt-2 inline-block">
            Back to Queue
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6">
      <ApprovalDetailPage
        approval={approval}
        onApprove={handleApprove}
        onReject={handleReject}
        onEscalate={handleEscalate}
        isSubmitting={isSubmitting}
      />
    </div>
  )
}
