/**
 * Approval Utility Functions
 *
 * Shared utilities for formatting time and configuring approval display styles.
 * Extracted from approval-card.tsx and approval-detail.tsx to eliminate duplication.
 *
 * @see app/tests/utils/approval.test.ts
 */

import type { ApprovalPriority, ApprovalStatus } from '../../types/approval'

// =============================================================================
// Type Definitions
// =============================================================================

export interface PriorityConfig {
  label: string
  className: string
  borderClass?: string
}

export interface StatusConfig {
  label: string
  className: string
}

// =============================================================================
// Time Formatting Functions
// =============================================================================

/**
 * Formats a date as a relative time string (e.g., "5m ago", "2h ago").
 *
 * @param date - The date to format (Date, string, null, or undefined)
 * @returns A human-readable relative time string
 */
export function formatRelativeTime(date: Date | string | null | undefined): string {
  if (!date) {
    return 'Unknown'
  }

  const dateObj = typeof date === 'string' ? new Date(date) : date
  const now = new Date()
  const diffMs = now.getTime() - dateObj.getTime()

  // Handle future dates by showing "just now"
  if (diffMs < 0) {
    return 'Just now'
  }

  const diffSecs = Math.floor(diffMs / 1000)
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffSecs < 60) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) return `${diffDays}d ago`

  return dateObj.toLocaleDateString()
}

/**
 * Formats the time remaining until expiration.
 *
 * @param expiresAt - The expiration date (Date, string, null, or undefined)
 * @returns A human-readable time remaining string (e.g., "5m remaining", "Expired")
 */
export function formatTimeRemaining(expiresAt: Date | string | null | undefined): string {
  if (!expiresAt) {
    return 'Expired'
  }

  const dateObj = typeof expiresAt === 'string' ? new Date(expiresAt) : expiresAt
  const now = new Date()
  const diffMs = dateObj.getTime() - now.getTime()

  if (diffMs <= 0) return 'Expired'

  const diffSecs = Math.floor(diffMs / 1000)
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  // Handle under 1 minute
  if (diffSecs < 60) return `${Math.max(1, diffSecs)}s remaining`
  if (diffMins < 60) return `${diffMins}m remaining`
  if (diffHours < 24) return `${diffHours}h remaining`
  return `${diffDays}d remaining`
}

// =============================================================================
// Configuration Objects
// =============================================================================

/**
 * Priority display configuration with labels and Tailwind CSS classes.
 */
export const priorityConfig: Record<ApprovalPriority, PriorityConfig> = {
  critical: {
    label: 'Critical',
    className: 'bg-red-100 text-red-800 border-red-200',
    borderClass: 'border-red-500',
  },
  high: {
    label: 'High',
    className: 'bg-orange-100 text-orange-800 border-orange-200',
    borderClass: 'border-orange-500',
  },
  normal: {
    label: 'Normal',
    className: 'bg-blue-100 text-blue-800 border-blue-200',
    borderClass: 'border-blue-500',
  },
  low: {
    label: 'Low',
    className: 'bg-gray-100 text-gray-800 border-gray-200',
    borderClass: 'border-gray-500',
  },
}

/**
 * Status display configuration with labels and Tailwind CSS classes.
 */
export const statusConfig: Record<ApprovalStatus, StatusConfig> = {
  pending: {
    label: 'Pending',
    className: 'bg-yellow-100 text-yellow-800',
  },
  approved: {
    label: 'Approved',
    className: 'bg-green-100 text-green-800',
  },
  rejected: {
    label: 'Rejected',
    className: 'bg-red-100 text-red-800',
  },
  expired: {
    label: 'Expired',
    className: 'bg-gray-100 text-gray-800',
  },
  escalated: {
    label: 'Escalated',
    className: 'bg-purple-100 text-purple-800',
  },
}
