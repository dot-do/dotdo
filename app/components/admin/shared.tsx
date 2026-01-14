/**
 * Shared Admin UI Components
 *
 * Reusable components for admin routes to ensure consistent UX:
 * - ErrorState: Error display with retry action
 * - EmptyState: No data message with CTA
 * - ListSkeleton: Loading placeholder for lists
 * - SyncStatus: Real-time sync indicator
 */

import * as React from 'react'
import { Skeleton } from '../ui/skeleton'

// =============================================================================
// Types
// =============================================================================

export interface ErrorStateProps {
  /** Error object or message */
  error: Error | string
  /** Optional custom title */
  title?: string
  /** Custom retry handler, defaults to page reload */
  onRetry?: () => void
  /** Custom retry button text */
  retryText?: string
}

export interface EmptyStateProps {
  /** Icon character (HTML entity or emoji) */
  icon?: string
  /** Main heading */
  title: string
  /** Description text */
  description: string
  /** Optional CTA button */
  action?: {
    label: string
    onClick: () => void
  }
}

export interface ListSkeletonProps {
  /** Number of skeleton rows to show */
  rows?: number
  /** Column widths as Tailwind classes */
  columns?: string[]
  /** Test ID for the skeleton */
  testId?: string
}

export interface SyncStatusProps {
  /** Whether data is currently syncing */
  isSyncing?: boolean
  /** Last successful sync time */
  lastSyncAt?: Date | null
  /** Error during sync */
  syncError?: Error | null
  /** Whether real-time is connected */
  isConnected?: boolean
}

// =============================================================================
// ErrorState Component
// =============================================================================

export function ErrorState({
  error,
  title = 'Something went wrong',
  onRetry,
  retryText = 'Try Again',
}: ErrorStateProps) {
  const message = error instanceof Error ? error.message : error

  const handleRetry = onRetry || (() => window.location.reload())

  return (
    <div data-testid="error-state" className="text-center py-12">
      <div className="text-red-400 text-5xl mb-4" aria-hidden="true">
        &#9888;
      </div>
      <h2 className="text-xl font-semibold text-red-700 mb-2">{title}</h2>
      <p className="text-gray-500 mb-6">{message}</p>
      <button
        type="button"
        onClick={handleRetry}
        className="inline-flex items-center px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700 transition-colors"
      >
        {retryText}
      </button>
    </div>
  )
}

// =============================================================================
// EmptyState Component
// =============================================================================

export function EmptyState({
  icon = '&#128196;',
  title,
  description,
  action,
}: EmptyStateProps) {
  return (
    <div data-testid="empty-state" className="text-center py-12">
      <div
        className="text-gray-400 text-5xl mb-4"
        aria-hidden="true"
        dangerouslySetInnerHTML={{ __html: icon }}
      />
      <h2 className="text-xl font-semibold text-gray-700 mb-2">{title}</h2>
      <p className="text-gray-500 mb-6">{description}</p>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
        >
          {action.label}
        </button>
      )}
    </div>
  )
}

// =============================================================================
// ListSkeleton Component
// =============================================================================

export function ListSkeleton({
  rows = 3,
  columns = ['w-32', 'w-24', 'w-48', 'w-20'],
  testId = 'loading',
}: ListSkeletonProps) {
  return (
    <div data-testid={testId} className="animate-pulse">
      <Skeleton className="h-8 w-48 mb-6" />
      <div className="bg-white rounded-lg shadow p-4">
        <div className="space-y-4">
          {Array.from({ length: rows }, (_, i) => (
            <div key={i} className="flex gap-4">
              {columns.map((width, j) => (
                <Skeleton key={j} className={`h-4 ${width}`} />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// =============================================================================
// SyncStatus Component
// =============================================================================

export function SyncStatus({
  isSyncing = false,
  lastSyncAt = null,
  syncError = null,
  isConnected = true,
}: SyncStatusProps) {
  // Format last sync time
  const formatLastSync = (date: Date): string => {
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffSecs = Math.floor(diffMs / 1000)
    const diffMins = Math.floor(diffMs / 60000)

    if (diffSecs < 60) return 'Just now'
    if (diffMins < 60) return `${diffMins}m ago`
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  // Determine status
  let statusColor = 'bg-green-500'
  let statusText = 'Synced'

  if (syncError) {
    statusColor = 'bg-red-500'
    statusText = 'Sync error'
  } else if (!isConnected) {
    statusColor = 'bg-yellow-500'
    statusText = 'Reconnecting...'
  } else if (isSyncing) {
    statusColor = 'bg-blue-500'
    statusText = 'Syncing...'
  }

  return (
    <div className="flex items-center gap-2 text-sm text-gray-500">
      <div
        className={`w-2 h-2 rounded-full ${statusColor} ${isSyncing ? 'animate-pulse' : ''}`}
        aria-hidden="true"
      />
      <span>{statusText}</span>
      {lastSyncAt && !isSyncing && !syncError && (
        <span className="text-gray-400">({formatLastSync(lastSyncAt)})</span>
      )}
    </div>
  )
}

// =============================================================================
// PageHeader Component
// =============================================================================

export interface PageHeaderProps {
  /** Page title */
  title: string
  /** Optional subtitle or count */
  subtitle?: string
  /** Right-side actions */
  actions?: React.ReactNode
  /** Sync status indicator */
  syncStatus?: SyncStatusProps
}

export function PageHeader({
  title,
  subtitle,
  actions,
  syncStatus,
}: PageHeaderProps) {
  return (
    <div className="flex justify-between items-center mb-6">
      <div>
        <h1 className="text-2xl font-semibold">{title}</h1>
        {subtitle && <p className="text-sm text-gray-500">{subtitle}</p>}
        {syncStatus && (
          <div className="mt-1">
            <SyncStatus {...syncStatus} />
          </div>
        )}
      </div>
      {actions && <div className="flex gap-4">{actions}</div>}
    </div>
  )
}

// =============================================================================
// Table Loading Overlay
// =============================================================================

export interface TableLoadingOverlayProps {
  isLoading: boolean
  children: React.ReactNode
}

export function TableLoadingOverlay({
  isLoading,
  children,
}: TableLoadingOverlayProps) {
  return (
    <div className="relative">
      {children}
      {isLoading && (
        <div className="absolute inset-0 bg-white/50 flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
        </div>
      )}
    </div>
  )
}

// =============================================================================
// Confirmation Dialog Hook
// =============================================================================

export interface UseConfirmOptions {
  title?: string
  message: string
  confirmText?: string
  cancelText?: string
}

export function useConfirm() {
  const confirm = React.useCallback(
    async ({ message }: UseConfirmOptions): Promise<boolean> => {
      // For now, use native confirm
      // In the future, this could render a Dialog component
      return window.confirm(message)
    },
    []
  )

  return confirm
}
