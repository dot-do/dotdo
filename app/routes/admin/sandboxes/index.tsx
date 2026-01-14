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
import { Button } from '~/components/ui/button'
import { useCollection } from '~/lib/hooks/use-collection'
import { SandboxSchema, type Sandbox } from '~/collections'
import { useAuth } from '~/src/admin/auth'
import {
  ErrorState,
  EmptyState,
  ListSkeleton,
  PageHeader,
} from '~/components/admin/shared'

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
    stopped: 'bg-muted text-muted-foreground',
    error: 'bg-red-500 text-white',
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
  const { user } = useAuth()

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
        ownerId: user?.id ?? 'anonymous',
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
          <ListSkeleton rows={3} columns={['w-24', 'w-16', 'w-32', 'w-24']} />
        </div>
      </Shell>
    )
  }

  if (sandboxes.error) {
    return (
      <Shell>
        <div className='p-6'>
          <ErrorState error={sandboxes.error} title="Error loading sandboxes" />
        </div>
      </Shell>
    )
  }

  if (sandboxes.data.length === 0) {
    return (
      <Shell>
        <div className='p-6'>
          <PageHeader
            title="Sandboxes"
            actions={
              <Button onClick={handleCreate}>
                New Sandbox
              </Button>
            }
          />
          <EmptyState
            icon="&#128187;"
            title="No sandboxes yet"
            description="Get started by creating your first sandbox session."
            action={{ label: 'Create First Sandbox', onClick: handleCreate }}
          />
        </div>
      </Shell>
    )
  }

  return (
    <Shell>
      <div className='p-6'>
        <div className='flex justify-between items-center mb-6'>
          <h1 className='text-2xl font-semibold'>Sandboxes</h1>
          <Button onClick={handleCreate} data-testid='new-sandbox-button'>
            New Sandbox
          </Button>
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
                cell: ({ row }) => <span className='text-sm text-muted-foreground'>{formatDate(row.original.createdAt)}</span>,
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
                      <Button type='button' variant='link' className='text-destructive p-0 h-auto text-sm' onClick={() => handleDelete(sandbox.$id)}>
                        Delete
                      </Button>
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
