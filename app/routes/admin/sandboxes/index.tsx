/**
 * Admin Sandboxes List Route
 *
 * Displays a list of sandbox sessions with status, created date, and actions.
 * Supports viewing active sandboxes, opening terminals, and session management.
 *
 * Uses useCollection for real-time sync with the Sandbox collection via WebSocket.
 */

import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Shell, DataTable } from '~/components/ui/shell'
import { useCollection } from '~/lib/hooks/use-collection'
import { SandboxSchema, type Sandbox } from '~/collections'

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
 * Displays a list of sandboxes using useCollection for real-time sync.
 * The collection provides:
 * - Real-time updates via WebSocket (no polling needed)
 * - Optimistic updates for create/delete operations
 * - Loading/error states handled automatically
 */
function SandboxesListPage() {
  const navigate = useNavigate()

  // Use collection for real-time sandbox data
  const sandboxes = useCollection({
    name: 'sandboxes',
    schema: SandboxSchema,
  })

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this sandbox?')) return
    try {
      await sandboxes.delete(id)
    } catch (err) {
      console.error('Failed to delete sandbox:', err)
    }
  }

  const handleCreate = async () => {
    try {
      const newSandbox = await sandboxes.insert({
        $type: 'Sandbox',
        name: 'New Sandbox',
        description: '',
        ownerId: 'current-user', // TODO: Get from auth context
        status: 'active',
        runtime: 'v8',
        memory: 128,
        timeout: 30000,
        env: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } as Omit<Sandbox, '$id'>)
      navigate({ to: '/admin/sandboxes/$sandboxId', params: { sandboxId: newSandbox.$id } })
    } catch (err) {
      console.error('Failed to create sandbox:', err)
    }
  }

  if (sandboxes.isLoading) {
    return (
      <Shell>
        <div className='p-6'>
          <SandboxesListSkeleton />
        </div>
      </Shell>
    )
  }

  if (sandboxes.error) {
    return (
      <Shell>
        <div className='p-6'>
          <ErrorState error={sandboxes.error} />
        </div>
      </Shell>
    )
  }

  if (sandboxes.data.length === 0) {
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
            data={sandboxes.data}
          />
        </div>
      </div>
    </Shell>
  )
}

export default SandboxesListPage
