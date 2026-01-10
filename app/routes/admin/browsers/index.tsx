/**
 * Admin Browsers List Route
 *
 * Displays a list of browser sessions with status, provider, and actions.
 * Supports viewing active sessions, watch live functionality, and session management.
 *
 * Uses TanStack DB collection pattern for real-time sync via WebSocket.
 */

import { createFileRoute } from '@tanstack/react-router'
import { Shell, DataTable } from '~/components/ui/shell'
import { type Browser } from '~/collections'

// Collection will be used when useDotdoCollection is implemented
// import { browsersCollection } from '~/collections'

// ============================================================================
// Types
// ============================================================================

// Display types for UI badges
type DisplayStatus = 'idle' | 'active' | 'paused' | 'stopped'
type BrowserProvider = 'cloudflare' | 'browserbase'

// Map collection status to display status
function mapStatus(status: Browser['status']): DisplayStatus {
  switch (status) {
    case 'ready':
      return 'active'
    case 'loading':
      return 'paused'
    case 'error':
      return 'stopped'
    case 'idle':
    default:
      return 'idle'
  }
}

// ============================================================================
// Route Definition
// ============================================================================

export const Route = createFileRoute('/admin/browsers/')({
  component: BrowsersListPage,
})

// ============================================================================
// StatusBadge Component
// ============================================================================

export function StatusBadge({ status }: { status: DisplayStatus }) {
  const colors: Record<DisplayStatus, string> = {
    idle: 'bg-gray-200 text-gray-800',
    active: 'bg-green-500 text-white',
    paused: 'bg-yellow-500 text-white',
    stopped: 'bg-red-500 text-white',
  }

  return (
    <span className={`px-2 py-1 rounded text-sm font-medium ${colors[status]}`}>
      {status}
    </span>
  )
}

// ============================================================================
// ProviderBadge Component
// ============================================================================

export function ProviderBadge({ provider }: { provider: BrowserProvider }) {
  const icons: Record<BrowserProvider, string> = {
    cloudflare: '⚡',
    browserbase: '🌐',
  }

  return (
    <span className="inline-flex items-center gap-1 text-sm">
      <span>{icons[provider]}</span>
      <span className="capitalize">{provider}</span>
    </span>
  )
}

// ============================================================================
// Loading Skeleton Component
// ============================================================================

function BrowsersListSkeleton() {
  return (
    <div data-testid="browsers-list-skeleton" className="animate-pulse">
      <div className="h-8 bg-gray-200 rounded w-48 mb-6" />
      <div className="bg-white rounded-lg shadow p-4">
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex gap-4">
              <div className="h-4 bg-gray-200 rounded w-24" />
              <div className="h-4 bg-gray-200 rounded w-16" />
              <div className="h-4 bg-gray-200 rounded w-20" />
              <div className="h-4 bg-gray-200 rounded flex-1" />
              <div className="h-4 bg-gray-200 rounded w-24" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// Empty State Component
// ============================================================================

function EmptyState() {
  return (
    <div className="text-center py-12">
      <div className="text-gray-400 text-5xl mb-4">🌐</div>
      <h2 className="text-xl font-semibold text-gray-700 mb-2">No browser sessions</h2>
      <p className="text-gray-500 mb-6">
        Get started by creating your first browser session.
      </p>
      <a
        href="/admin/browsers/new"
        className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
      >
        Create First Session
      </a>
    </div>
  )
}

// ============================================================================
// Error State Component
// ============================================================================

function ErrorState({ error }: { error: Error }) {
  return (
    <div className="text-center py-12">
      <div className="text-red-400 text-5xl mb-4">⚠️</div>
      <h2 className="text-xl font-semibold text-red-700 mb-2">Error loading sessions</h2>
      <p className="text-gray-500 mb-6">{error.message}</p>
      <button
        onClick={() => window.location.reload()}
        className="inline-flex items-center px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700"
      >
        Try Again
      </button>
    </div>
  )
}

// ============================================================================
// Format Date Helper
// ============================================================================

function formatDate(dateString: string): string {
  const date = new Date(dateString)
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// ============================================================================
// Main Page Component
// ============================================================================

/**
 * BrowsersListPage
 *
 * This page displays a list of browser sessions. It uses static mock data for now
 * since the full TanStack DB sync is not yet implemented (see GREEN phase).
 *
 * When useDotdoCollection is implemented, this component will:
 * - Receive real-time updates via WebSocket (no polling needed)
 * - Use optimistic updates for create/delete operations
 * - Handle loading/error states automatically from the hook
 *
 * TODO: Replace mock data with useDotdoCollection when GREEN phase is complete:
 * ```typescript
 * const { data: browsers, isLoading, error, insert, delete: deleteBrowser } =
 *   useDotdoCollection({ collection: 'Browser', schema: BrowserSchema })
 * ```
 */
function BrowsersListPage() {
  // Mock data for now - will be replaced with useDotdoCollection
  // Real-time sync via WebSocket will handle updates automatically
  const sessions: Array<{
    $id: string
    status: Browser['status']
    provider: BrowserProvider
    name: string
    url?: string
    liveViewUrl?: string
    createdAt: string
  }> = [
    { $id: 'browser-1', status: 'ready', provider: 'cloudflare', name: 'Main Session', url: 'https://example.com', liveViewUrl: '/live/browser-1', createdAt: '2024-01-15T10:30:00Z' },
    { $id: 'browser-2', status: 'loading', provider: 'browserbase', name: 'Dev Session', url: 'https://dev.example.com', createdAt: '2024-01-14T14:20:00Z' },
    { $id: 'browser-3', status: 'idle', provider: 'cloudflare', name: 'Test Session', createdAt: '2024-01-13T09:15:00Z' },
  ]
  const isLoading = false
  const error: Error | null = null

  if (isLoading) {
    return (
      <Shell>
        <div className="p-6">
          <BrowsersListSkeleton />
        </div>
      </Shell>
    )
  }

  if (error) {
    return (
      <Shell>
        <div className="p-6">
          <ErrorState error={error} />
        </div>
      </Shell>
    )
  }

  if (sessions.length === 0) {
    return (
      <Shell>
        <div className="p-6">
          <div className="flex justify-between items-center mb-6">
            <h1 className="text-2xl font-semibold">Browser Sessions</h1>
            <a
              href="/admin/browsers/new"
              className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
            >
              New Session
            </a>
          </div>
          <EmptyState />
        </div>
      </Shell>
    )
  }

  return (
    <Shell>
      <div className="p-6">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-semibold">Browser Sessions</h1>
          <a
            href="/admin/browsers/new"
            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
          >
            New Session
          </a>
        </div>

        <div className="bg-white rounded-lg shadow">
          <DataTable
            columns={[
              {
                accessorKey: '$id',
                header: 'ID',
                cell: ({ row }) => (
                  <span className="font-mono text-sm">{row.original.$id}</span>
                ),
              },
              {
                accessorKey: 'name',
                header: 'Name',
                cell: ({ row }) => (
                  <span className="text-sm font-medium">{row.original.name}</span>
                ),
              },
              {
                accessorKey: 'status',
                header: 'Status',
                cell: ({ row }) => <StatusBadge status={mapStatus(row.original.status)} />,
              },
              {
                accessorKey: 'provider',
                header: 'Provider',
                cell: ({ row }) => <ProviderBadge provider={row.original.provider} />,
              },
              {
                accessorKey: 'url',
                header: 'URL',
                cell: ({ row }) => (
                  <span className="text-sm text-gray-600 truncate max-w-xs block">
                    {row.original.url || '—'}
                  </span>
                ),
              },
              {
                accessorKey: 'createdAt',
                header: 'Created',
                cell: ({ row }) => (
                  <span className="text-sm text-gray-600">
                    {formatDate(row.original.createdAt)}
                  </span>
                ),
              },
              {
                id: 'actions',
                header: 'Actions',
                cell: ({ row }) => {
                  const session = row.original
                  const displayStatus = mapStatus(session.status)
                  const canWatchLive = displayStatus === 'active' && session.liveViewUrl

                  return (
                    <div className="flex gap-2">
                      {canWatchLive && (
                        <a
                          href={session.liveViewUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-green-600 hover:underline text-sm"
                        >
                          Watch Live
                        </a>
                      )}
                      <a
                        href={`/admin/browsers/${session.$id}`}
                        className="text-blue-600 hover:underline text-sm"
                      >
                        View
                      </a>
                    </div>
                  )
                },
              },
            ]}
            data={sessions}
          />
        </div>
      </div>
    </Shell>
  )
}

export default BrowsersListPage
