/**
 * Admin Browsers List Route
 *
 * Displays a list of browser sessions with status, provider, and actions.
 * Supports viewing active sessions, watch live functionality, and session management.
 *
 * Uses useCollection for real-time sync with the Browser collection via WebSocket.
 */

import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Shell, DataTable } from '~/components/ui/shell'
import { useCollection } from '~/lib/hooks/use-collection'
import { BrowserSchema, type Browser } from '~/collections'

// ============================================================================
// Types
// ============================================================================

// Display types for UI badges
type DisplayStatus = 'idle' | 'active' | 'paused' | 'stopped'

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
    <span data-testid={`status-badge-${status}`} className={`px-2 py-1 rounded text-sm font-medium ${colors[status]}`}>
      {status}
    </span>
  )
}

// ============================================================================
// Loading Skeleton Component
// ============================================================================

function BrowsersListSkeleton() {
  return (
    <div data-testid="loading" className="animate-pulse">
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

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div data-testid="empty-state" className="text-center py-12">
      <div className="text-gray-400 text-5xl mb-4">&#127760;</div>
      <h2 className="text-xl font-semibold text-gray-700 mb-2">No browser sessions</h2>
      <p className="text-gray-500 mb-6">
        Get started by creating your first browser session.
      </p>
      <button
        type="button"
        onClick={onCreate}
        className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
      >
        Create First Session
      </button>
    </div>
  )
}

// ============================================================================
// Error State Component
// ============================================================================

function ErrorState({ error }: { error: Error }) {
  return (
    <div data-testid="error-state" className="text-center py-12">
      <div className="text-red-400 text-5xl mb-4">&#9888;</div>
      <h2 className="text-xl font-semibold text-red-700 mb-2">Error loading sessions</h2>
      <p className="text-gray-500 mb-6">{error.message}</p>
      <button
        type="button"
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
 * Displays a list of browser sessions using useCollection for real-time sync.
 * The collection provides:
 * - Real-time updates via WebSocket (no polling needed)
 * - Optimistic updates for create/delete operations
 * - Loading/error states handled automatically
 */
function BrowsersListPage() {
  const navigate = useNavigate()

  // Use collection for real-time browser data
  const browsers = useCollection({
    name: 'browsers',
    schema: BrowserSchema,
  })

  const handleCreate = async () => {
    try {
      const newBrowser = await browsers.insert({
        $type: 'Browser',
        name: 'New Session',
        url: undefined,
        sandboxId: '', // TODO: Get from context or let user select
        status: 'idle',
        viewport: { width: 1280, height: 720 },
        userAgent: undefined,
        cookies: [],
        localStorage: {},
        sessionStorage: {},
        lastActivityAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } as Omit<Browser, '$id'>)
      navigate({ to: '/admin/browsers/$browserId', params: { browserId: newBrowser.$id } })
    } catch (err) {
      console.error('Failed to create browser session:', err)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this browser session?')) return
    try {
      await browsers.delete(id)
    } catch (err) {
      console.error('Failed to delete browser session:', err)
    }
  }

  if (browsers.isLoading) {
    return (
      <Shell>
        <div className="p-6">
          <BrowsersListSkeleton />
        </div>
      </Shell>
    )
  }

  if (browsers.error) {
    return (
      <Shell>
        <div className="p-6">
          <ErrorState error={browsers.error} />
        </div>
      </Shell>
    )
  }

  if (browsers.data.length === 0) {
    return (
      <Shell>
        <div className="p-6">
          <div className="flex justify-between items-center mb-6">
            <h1 className="text-2xl font-semibold">Browser Sessions</h1>
            <button
              type="button"
              onClick={handleCreate}
              className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
            >
              New Session
            </button>
          </div>
          <EmptyState onCreate={handleCreate} />
        </div>
      </Shell>
    )
  }

  return (
    <Shell>
      <div className="p-6">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-semibold">Browser Sessions</h1>
          <button
            type="button"
            onClick={handleCreate}
            data-testid="new-browser-button"
            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
          >
            New Session
          </button>
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
                accessorKey: 'url',
                header: 'URL',
                cell: ({ row }) => (
                  <span className="text-sm text-gray-600 truncate max-w-xs block">
                    {row.original.url || '-'}
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
                  const canWatchLive = displayStatus === 'active'

                  return (
                    <div className="flex gap-2">
                      {canWatchLive && (
                        <a
                          href={`/admin/browsers/${session.$id}/live`}
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
                      <button
                        type="button"
                        onClick={() => handleDelete(session.$id)}
                        className="text-red-600 hover:underline text-sm"
                      >
                        Delete
                      </button>
                    </div>
                  )
                },
              },
            ]}
            data={browsers.data}
          />
        </div>
      </div>
    </Shell>
  )
}

export default BrowsersListPage
