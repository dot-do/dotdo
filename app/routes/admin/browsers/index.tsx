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
import { Button } from '~/components/ui/button'
import { useCollection } from '~/lib/hooks/use-collection'
import { BrowserSchema, type Browser } from '~/collections'
import {
  ErrorState,
  EmptyState,
  ListSkeleton,
  PageHeader,
} from '~/components/admin/shared'

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
    idle: 'bg-muted text-muted-foreground',
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
        sandboxId: '',
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
          <ListSkeleton rows={3} columns={['w-24', 'w-16', 'w-20', 'flex-1', 'w-24']} />
        </div>
      </Shell>
    )
  }

  if (browsers.error) {
    return (
      <Shell>
        <div className="p-6">
          <ErrorState error={browsers.error} title="Error loading sessions" />
        </div>
      </Shell>
    )
  }

  if (browsers.data.length === 0) {
    return (
      <Shell>
        <div className="p-6">
          <PageHeader
            title="Browser Sessions"
            actions={
              <Button onClick={handleCreate}>
                New Session
              </Button>
            }
          />
          <EmptyState
            icon="&#127760;"
            title="No browser sessions"
            description="Get started by creating your first browser session."
            action={{ label: 'Create First Session', onClick: handleCreate }}
          />
        </div>
      </Shell>
    )
  }

  return (
    <Shell>
      <div className="p-6">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-semibold">Browser Sessions</h1>
          <Button
            onClick={handleCreate}
            data-testid="new-browser-button"
          >
            New Session
          </Button>
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
                  <span className="text-sm text-muted-foreground truncate max-w-xs block">
                    {row.original.url || '-'}
                  </span>
                ),
              },
              {
                accessorKey: 'createdAt',
                header: 'Created',
                cell: ({ row }) => (
                  <span className="text-sm text-muted-foreground">
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
                      <Button
                        type="button"
                        variant="link"
                        className="text-destructive p-0 h-auto text-sm"
                        onClick={() => handleDelete(session.$id)}
                      >
                        Delete
                      </Button>
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
