/**
 * Admin Sandboxes List Route
 *
 * Displays a list of sandbox sessions with status, created date, and actions.
 * Supports viewing active sandboxes, opening terminals, and session management.
 *
 * Uses TanStack DB collection pattern for real-time sync via WebSocket.
 */

import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Shell, DataTable } from '~/components/ui/shell'
import { type Sandbox } from '~/collections'

// Collection will be used when useDotdoCollection is implemented
// import { sandboxesCollection } from '~/collections'

// ============================================================================
// Types
// ============================================================================

// Map collection status to display status for UI badge
type DisplayStatus = 'running' | 'idle' | 'stopped' | 'error'

function mapStatus(status: Sandbox['status']): DisplayStatus {
  switch (status) {
    case 'active':
      return 'running'
    case 'paused':
      return 'idle'
    case 'archived':
      return 'stopped'
    default:
      return 'idle'
  }
}

// ============================================================================
// Route Definition
// ============================================================================

export const Route = createFileRoute('/admin/sandboxes/')({
  component: SandboxesListPage,
})

// ============================================================================
// StatusBadge Component
// ============================================================================

export function StatusBadge({ status }: { status: DisplayStatus }) {
  const colors: Record<DisplayStatus, string> = {
    running: 'bg-green-500 text-white',
    idle: 'bg-yellow-500 text-white',
    stopped: 'bg-gray-200 text-gray-800',
    error: 'bg-red-500 text-white',
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

function SandboxesListSkeleton() {
  return (
    <div data-testid='loading' className='animate-pulse'>
      <div className='h-8 bg-gray-200 rounded w-48 mb-6' />
      <div className='bg-white rounded-lg shadow p-4'>
        <div className='space-y-4'>
          {[1, 2, 3].map((i) => (
            <div key={i} className='flex gap-4'>
              <div className='h-4 bg-gray-200 rounded w-24' />
              <div className='h-4 bg-gray-200 rounded w-16' />
              <div className='h-4 bg-gray-200 rounded w-32' />
              <div className='h-4 bg-gray-200 rounded w-24' />
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
    <div data-testid='empty-state' className='text-center py-12'>
      <div className='text-gray-400 text-5xl mb-4'>&#128187;</div>
      <h2 className='text-xl font-semibold text-gray-700 mb-2'>No sandboxes yet</h2>
      <p className='text-gray-500 mb-6'>Get started by creating your first sandbox session.</p>
      <button type='button' onClick={onCreate} className='inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700'>
        Create First Sandbox
      </button>
    </div>
  )
}

// ============================================================================
// Error State Component
// ============================================================================

function ErrorState({ error }: { error: Error }) {
  return (
    <div data-testid='error-state' className='text-center py-12'>
      <div className='text-red-400 text-5xl mb-4'>&#9888;</div>
      <h2 className='text-xl font-semibold text-red-700 mb-2'>Error loading sandboxes</h2>
      <p className='text-gray-500 mb-6'>{error.message}</p>
      <button type='button' onClick={() => window.location.reload()} className='inline-flex items-center px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700'>
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
 * SandboxesListPage
 *
 * This page displays a list of sandboxes. It uses static mock data for now
 * since the full TanStack DB sync is not yet implemented (see GREEN phase).
 *
 * When useDotdoCollection is implemented, this component will:
 * - Receive real-time updates via WebSocket (no polling needed)
 * - Use optimistic updates for create/delete operations
 * - Handle loading/error states automatically from the hook
 *
 * TODO: Replace mock data with useDotdoCollection when GREEN phase is complete:
 * ```typescript
 * const { data: sandboxes, isLoading, error, insert, delete: deleteSandbox } =
 *   useDotdoCollection({ collection: 'Sandbox', schema: SandboxSchema })
 * ```
 */
function SandboxesListPage() {
  const navigate = useNavigate()

  // Mock data for now - will be replaced with useDotdoCollection
  // Real-time sync via WebSocket will handle updates automatically
  const sandboxes: Array<{ $id: string; status: Sandbox['status']; name: string; createdAt: string }> = [
    { $id: 'sandbox-1', status: 'active', name: 'Development', createdAt: '2024-01-15T10:30:00Z' },
    { $id: 'sandbox-2', status: 'paused', name: 'Staging', createdAt: '2024-01-14T14:20:00Z' },
    { $id: 'sandbox-3', status: 'archived', name: 'Testing', createdAt: '2024-01-13T09:15:00Z' },
  ]
  const isLoading = false
  const error: Error | null = null

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this sandbox?')) return
    // TODO: Use collection.delete(id) when useDotdoCollection is implemented
    // Optimistic update will remove from UI immediately
    console.log('Delete sandbox:', id)
  }

  const handleCreate = () => {
    navigate({ to: '/admin/sandboxes/new' })
  }

  if (isLoading) {
    return (
      <Shell>
        <div className='p-6'>
          <SandboxesListSkeleton />
        </div>
      </Shell>
    )
  }

  if (error) {
    return (
      <Shell>
        <div className='p-6'>
          <ErrorState error={error} />
        </div>
      </Shell>
    )
  }

  if (sandboxes.length === 0) {
    return (
      <Shell>
        <div className='p-6'>
          <div className='flex justify-between items-center mb-6'>
            <h1 className='text-2xl font-semibold'>Sandboxes</h1>
            <button type='button' onClick={handleCreate} className='bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700'>
              New Sandbox
            </button>
          </div>
          <EmptyState onCreate={handleCreate} />
        </div>
      </Shell>
    )
  }

  return (
    <Shell>
      <div className='p-6'>
        <div className='flex justify-between items-center mb-6'>
          <h1 className='text-2xl font-semibold'>Sandboxes</h1>
          <button type='button' onClick={handleCreate} data-testid='new-sandbox-button' className='bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700'>
            New Sandbox
          </button>
        </div>

        <div className='bg-white rounded-lg shadow'>
          <DataTable
            columns={[
              {
                accessorKey: '$id',
                header: 'ID',
                cell: ({ row }) => <span className='font-mono text-sm'>{row.original.$id}</span>,
              },
              {
                accessorKey: 'name',
                header: 'Name',
                cell: ({ row }) => <span className='text-sm font-medium'>{row.original.name}</span>,
              },
              {
                accessorKey: 'status',
                header: 'Status',
                cell: ({ row }) => <StatusBadge status={mapStatus(row.original.status)} />,
              },
              {
                accessorKey: 'createdAt',
                header: 'Created',
                cell: ({ row }) => <span className='text-sm text-gray-600'>{formatDate(row.original.createdAt)}</span>,
              },
              {
                id: 'actions',
                header: 'Actions',
                cell: ({ row }) => {
                  const sandbox = row.original

                  return (
                    <div className='flex gap-2'>
                      <a href={`/admin/sandboxes/${sandbox.$id}`} className='text-blue-600 hover:underline text-sm'>
                        Open Terminal
                      </a>
                      <button type='button' onClick={() => handleDelete(sandbox.$id)} className='text-red-600 hover:underline text-sm'>
                        Delete
                      </button>
                    </div>
                  )
                },
              },
            ]}
            data={sandboxes}
          />
        </div>
      </div>
    </Shell>
  )
}

export default SandboxesListPage
