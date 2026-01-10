/**
 * ApprovalCard Component
 *
 * Displays an individual approval request in the queue list.
 * Shows priority, status, time remaining, and quick action buttons.
 */

import * as React from 'react'
import { cn } from '../../lib/utils'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import {
  formatRelativeTime,
  formatTimeRemaining,
  priorityConfig,
  statusConfig,
} from '../../lib/utils/approval'
import type { ApprovalRequest } from '../../types/approval'

// =============================================================================
// Helper Functions
// =============================================================================

function formatApprovalType(type: string): string {
  return type
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

const channelLabels: Record<string, string> = {
  'in-app': 'In-app notification',
  email: 'Email notification',
  slack: 'Slack notification',
  custom: 'Custom notification',
}

// =============================================================================
// Component Props
// =============================================================================

export interface ApprovalCardProps {
  approval: ApprovalRequest
  onClick?: () => void
  onQuickApprove?: () => void
  onQuickReject?: () => void
  className?: string
}

// =============================================================================
// Component
// =============================================================================

export function ApprovalCard({
  approval,
  onClick,
  onQuickApprove,
  onQuickReject,
  className,
}: ApprovalCardProps) {
  const priorityCfg = priorityConfig[approval.priority]
  const statusCfg = statusConfig[approval.status]
  const isPending = approval.status === 'pending'
  const isEscalated = approval.status === 'escalated'

  const handleCardClick = (e: React.MouseEvent) => {
    // Don't trigger card click if clicking on action buttons
    if ((e.target as HTMLElement).closest('button')) return
    onClick?.()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onClick?.()
    }
  }

  return (
    <div
      data-approval-card
      data-testid="approval-card"
      role="button"
      tabIndex={0}
      onClick={handleCardClick}
      onKeyDown={handleKeyDown}
      className={cn(
        'bg-white rounded-lg border-2 p-4 shadow-sm hover:shadow-md transition-shadow cursor-pointer',
        'focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2',
        priorityCfg.borderClass,
        className
      )}
    >
      {/* Header Row */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex-1 min-w-0">
          <h3 className="font-medium text-gray-900 truncate">{approval.title}</h3>
          <p className="text-sm text-gray-500 truncate">{approval.description}</p>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <Badge className={statusCfg.className} aria-label={`Status: ${statusCfg.label}`}>
            {statusCfg.label}
          </Badge>
          {isEscalated && approval.escalationLevel && (
            <span className="text-xs text-purple-600 font-medium">
              Level {approval.escalationLevel}
            </span>
          )}
        </div>
      </div>

      {/* Metadata Row */}
      <div className="flex flex-wrap items-center gap-2 mb-3 text-sm">
        {/* Type Badge */}
        <Badge variant="outline" className="text-xs">
          {formatApprovalType(approval.type)}
        </Badge>

        {/* Priority Badge */}
        <Badge
          className={cn('text-xs', priorityCfg.className)}
          aria-label={`${priorityCfg.label} priority`}
        >
          {priorityCfg.label}
        </Badge>

        {/* Channel Indicator */}
        <span
          className="text-xs text-gray-500"
          aria-label={channelLabels[approval.channel] || approval.channel}
        >
          {approval.channel === 'in-app' && (
            <svg className="w-4 h-4 inline-block" fill="currentColor" viewBox="0 0 20 20">
              <path d="M10 2a6 6 0 00-6 6v3.586l-.707.707A1 1 0 004 14h12a1 1 0 00.707-1.707L16 11.586V8a6 6 0 00-6-6zM10 18a3 3 0 01-3-3h6a3 3 0 01-3 3z" />
            </svg>
          )}
        </span>
      </div>

      {/* Requester and Time Row */}
      <div className="flex items-center justify-between text-sm text-gray-600 mb-3">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center text-xs font-medium">
            {approval.requester.name.charAt(0).toUpperCase()}
          </div>
          <span>{approval.requester.name}</span>
        </div>
        <span className="text-gray-400">{formatRelativeTime(new Date(approval.createdAt))}</span>
      </div>

      {/* Expiration Warning */}
      {approval.expiresAt && isPending && (
        <div role="status" className="flex items-center gap-1 text-sm text-orange-600 mb-3">
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path
              fillRule="evenodd"
              d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z"
              clipRule="evenodd"
            />
          </svg>
          <span>Expires in {formatTimeRemaining(new Date(approval.expiresAt))}</span>
        </div>
      )}

      {/* Quick Action Buttons */}
      {isPending && (
        <div className="flex gap-2 pt-2 border-t">
          <Button
            variant="default"
            size="sm"
            onClick={(e) => {
              e.stopPropagation()
              onQuickApprove?.()
            }}
            className="flex-1 min-h-11 min-w-11 bg-green-600 hover:bg-green-700"
            aria-label="Approve"
          >
            Approve
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={(e) => {
              e.stopPropagation()
              onQuickReject?.()
            }}
            className="flex-1 min-h-11 min-w-11"
            aria-label="Reject"
          >
            Reject
          </Button>
        </div>
      )}
    </div>
  )
}
