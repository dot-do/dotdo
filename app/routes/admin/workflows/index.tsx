/**
 * Admin Workflows List Route
 *
 * Displays all workflows with filtering and search.
 * Uses useCollection for real-time sync with the Workflow collection.
 */

import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Shell, DataTable } from '~/components/ui/shell'
import { useCollection } from '~/lib/hooks/use-collection'
import { WorkflowSchema, type Workflow } from '~/collections'

export const Route = createFileRoute('/admin/workflows/')({
  component: WorkflowsPage,
})

// ============================================================================
// Status Badge Component
// ============================================================================

type WorkflowStatus = 'draft' | 'active' | 'paused' | 'completed' | 'failed'

function StatusBadge({ status }: { status: WorkflowStatus }) {
  const colors: Record<WorkflowStatus, string> = {
    draft: 'bg-gray-200 text-gray-800',
    active: 'bg-green-500 text-white',
    paused: 'bg-yellow-500 text-white',
    completed: 'bg-blue-500 text-white',
    failed: 'bg-red-500 text-white',
  }

  return (
    <span className={`px-2 py-1 rounded text-sm font-medium ${colors[status]}`}>
      {status}
    </span>
  )
}

// ============================================================================
// Loading Skeleton Component
// ============================================================================

function WorkflowsListSkeleton() {
  return (
    <div data-testid="loading" className="animate-pulse">
      <div className="h-8 bg-gray-200 rounded w-48 mb-6" />
      <div className="bg-white rounded-lg shadow p-4">
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex gap-4">
              <div className="h-4 bg-gray-200 rounded w-48" />
              <div className="h-4 bg-gray-200 rounded w-20" />
              <div className="h-4 bg-gray-200 rounded w-24" />
              <div className="h-4 bg-gray-200 rounded w-16" />
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
      <div className="text-gray-400 text-5xl mb-4">&#9881;</div>
      <h2 className="text-xl font-semibold text-gray-700 mb-2">No workflows yet</h2>
      <p className="text-gray-500 mb-6">Get started by creating your first workflow.</p>
      <button
        type="button"
        onClick={onCreate}
        className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
      >
        Create First Workflow
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
      <h2 className="text-xl font-semibold text-red-700 mb-2">Error loading workflows</h2>
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

function formatDate(dateString: string | null): string {
  if (!dateString) return 'Never'
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

function WorkflowsPage() {
  const navigate = useNavigate()

  // Use collection for real-time workflow data
  const workflows = useCollection({
    name: 'workflows',
    schema: WorkflowSchema,
  })

  const handleCreate = async () => {
    try {
      const newWorkflow = await workflows.insert({
        $type: 'Workflow',
        name: 'New Workflow',
        description: '',
        ownerId: 'current-user', // TODO: Get from auth context
        sandboxId: null,
        status: 'draft',
        trigger: { type: 'manual' },
        steps: [],
        lastRunAt: null,
        nextRunAt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } as Omit<Workflow, '$id'>)
      navigate({ to: '/admin/workflows/$workflowId', params: { workflowId: newWorkflow.$id } })
    } catch (err) {
      console.error('Failed to create workflow:', err)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this workflow?')) return
    try {
      await workflows.delete(id)
    } catch (err) {
      console.error('Failed to delete workflow:', err)
    }
  }

  if (workflows.isLoading) {
    return (
      <Shell>
        <div className="p-6">
          <WorkflowsListSkeleton />
        </div>
      </Shell>
    )
  }

  if (workflows.error) {
    return (
      <Shell>
        <div className="p-6">
          <ErrorState error={workflows.error} />
        </div>
      </Shell>
    )
  }

  if (workflows.data.length === 0) {
    return (
      <Shell>
        <div className="p-6">
          <div className="flex justify-between items-center mb-6">
            <h1 className="text-2xl font-semibold">Workflows</h1>
            <button
              type="button"
              onClick={handleCreate}
              className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
            >
              New Workflow
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
          <h1 className="text-2xl font-semibold">Workflows</h1>
          <div className="flex gap-4">
            <select className="border rounded px-3 py-2" aria-label="Filter by status">
              <option value="">All Status</option>
              <option value="draft">Draft</option>
              <option value="active">Active</option>
              <option value="paused">Paused</option>
              <option value="completed">Completed</option>
              <option value="failed">Failed</option>
            </select>
            <input
              type="search"
              placeholder="Search workflows..."
              aria-label="Search workflows"
              className="border rounded px-3 py-2"
            />
            <button
              type="button"
              onClick={handleCreate}
              data-testid="new-workflow-button"
              className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
            >
              New Workflow
            </button>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow">
          <DataTable
            columns={[
              {
                accessorKey: 'name',
                header: 'Name',
                cell: ({ row }) => (
                  <span className="font-medium">{row.original.name}</span>
                ),
              },
              {
                accessorKey: 'status',
                header: 'Status',
                cell: ({ row }) => <StatusBadge status={row.original.status} />,
              },
              {
                accessorKey: 'trigger',
                header: 'Trigger',
                cell: ({ row }) => (
                  <span className="text-sm text-gray-600 capitalize">
                    {row.original.trigger.type}
                  </span>
                ),
              },
              {
                accessorKey: 'lastRunAt',
                header: 'Last Run',
                cell: ({ row }) => (
                  <span className="text-sm text-gray-600">
                    {formatDate(row.original.lastRunAt)}
                  </span>
                ),
              },
              {
                id: 'actions',
                header: 'Actions',
                cell: ({ row }) => {
                  const workflow = row.original
                  return (
                    <div className="flex gap-2">
                      <a
                        href={`/admin/workflows/${workflow.$id}`}
                        className="text-blue-600 hover:underline text-sm"
                      >
                        Edit
                      </a>
                      <a
                        href={`/admin/workflows/${workflow.$id}/runs`}
                        className="text-blue-600 hover:underline text-sm"
                      >
                        Runs
                      </a>
                      <button
                        type="button"
                        onClick={() => handleDelete(workflow.$id)}
                        className="text-red-600 hover:underline text-sm"
                      >
                        Delete
                      </button>
                    </div>
                  )
                },
              },
            ]}
            data={workflows.data}
          />
        </div>
      </div>
    </Shell>
  )
}
