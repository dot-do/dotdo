/**
 * Admin Sandboxes List Route
 *
 * Displays a list of sandbox sessions with status, created date, and actions.
 * Supports viewing active sandboxes, opening terminals, and session management.
 */

import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Shell, DataTable } from '~/components/ui/shell'
import { useState, useEffect } from 'react'

// ============================================================================
// Types
// ============================================================================

type SandboxStatus = 'running' | 'idle' | 'stopped' | 'error'

interface Sandbox {
  id: string
  status: SandboxStatus
  createdAt: string
  exposedPorts?: Array<{ port: number; exposedAt: string }>
}

interface SandboxesApiResponse {
  sandboxes: Sandbox[]
}

// ============================================================================
// Route Definition
// ============================================================================

export const Route = createFileRoute('/admin/sandboxes/')({
  component: SandboxesListPage,
})

// ============================================================================
// Custom Hook for Sandbox Sessions
// ============================================================================

function useSandboxes() {
  const [data, setData] = useState<SandboxesApiResponse | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  const refetch = async () => {
    try {
      setIsLoading(true)
      const response = await fetch('/api/sandboxes', {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      })

      if (!response.ok) {
        throw new Error('Failed to fetch sandboxes')
      }

      const json = await response.json()
      setData(json)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Unknown error'))
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    refetch()
  }, [])

  const setSandboxes = (updater: (sandboxes: Sandbox[]) => Sandbox[]) => {
    if (data) {
      setData({ sandboxes: updater(data.sandboxes) })
    }
  }

  return { data, isLoading, error, refetch, setSandboxes }
}

// ============================================================================
// StatusBadge Component
// ============================================================================

export function StatusBadge({ status }: { status: SandboxStatus }) {
  const colors: Record<SandboxStatus, string> = {
    running: 'bg-green-500 text-white',
    idle: 'bg-yellow-500 text-white',
    stopped: 'bg-gray-200 text-gray-800',
    error: 'bg-red-500 text-white',
  }

  return (
    <span
      data-testid={`status-badge-${status}`}
      className={`px-2 py-1 rounded text-sm font-medium ${colors[status]}`}
    >
      {status}
    </span>
  )
}

// ============================================================================
// Loading Skeleton Component
// ============================================================================

function SandboxesListSkeleton() {
  return (
    <div data-testid="loading" className="animate-pulse">
      <div className="h-8 bg-gray-200 rounded w-48 mb-6" />
      <div className="bg-white rounded-lg shadow p-4">
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex gap-4">
              <div className="h-4 bg-gray-200 rounded w-24" />
              <div className="h-4 bg-gray-200 rounded w-16" />
              <div className="h-4 bg-gray-200 rounded w-32" />
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
      <div className="text-gray-400 text-5xl mb-4">&#128187;</div>
      <h2 className="text-xl font-semibold text-gray-700 mb-2">No sandboxes yet</h2>
      <p className="text-gray-500 mb-6">
        Get started by creating your first sandbox session.
      </p>
      <button
        onClick={onCreate}
        className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
      >
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
    <div data-testid="error-state" className="text-center py-12">
      <div className="text-red-400 text-5xl mb-4">&#9888;</div>
      <h2 className="text-xl font-semibold text-red-700 mb-2">Error loading sandboxes</h2>
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

function SandboxesListPage() {
  const { data, isLoading, error, setSandboxes } = useSandboxes()
  const navigate = useNavigate()

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this sandbox?')) return

    try {
      const response = await fetch(`/api/sandboxes/${id}`, { method: 'DELETE' })
      if (!response.ok) {
        throw new Error('Failed to delete sandbox')
      }
      setSandboxes((sandboxes) => sandboxes.filter((s) => s.id !== id))
    } catch (err) {
      console.error('Error deleting sandbox:', err)
    }
  }

  const handleCreate = async () => {
    try {
      const response = await fetch('/api/sandboxes', { method: 'POST' })
      if (!response.ok) {
        throw new Error('Failed to create sandbox')
      }
      const { id } = await response.json()
      navigate({ to: `/admin/sandboxes/${id}` })
    } catch (err) {
      console.error('Error creating sandbox:', err)
    }
  }

  if (isLoading) {
    return (
      <Shell>
        <div className="p-6">
          <SandboxesListSkeleton />
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

  const sandboxes = data?.sandboxes || []

  if (sandboxes.length === 0) {
    return (
      <Shell>
        <div className="p-6">
          <div className="flex justify-between items-center mb-6">
            <h1 className="text-2xl font-semibold">Sandboxes</h1>
            <button
              onClick={handleCreate}
              className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
            >
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
      <div className="p-6">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-semibold">Sandboxes</h1>
          <button
            onClick={handleCreate}
            data-testid="new-sandbox-button"
            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
          >
            New Sandbox
          </button>
        </div>

        <div className="bg-white rounded-lg shadow">
          <DataTable
            columns={[
              {
                accessorKey: 'id',
                header: 'ID',
                cell: ({ row }) => (
                  <span className="font-mono text-sm">{row.original.id}</span>
                ),
              },
              {
                accessorKey: 'status',
                header: 'Status',
                cell: ({ row }) => <StatusBadge status={row.original.status} />,
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
                  const sandbox = row.original

                  return (
                    <div className="flex gap-2">
                      <a
                        href={`/admin/sandboxes/${sandbox.id}`}
                        className="text-blue-600 hover:underline text-sm"
                      >
                        Open Terminal
                      </a>
                      <button
                        onClick={() => handleDelete(sandbox.id)}
                        className="text-red-600 hover:underline text-sm"
                      >
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
