/**
 * Admin Workflows List Route
 *
 * Displays all workflows with filtering and search.
 */

import { createFileRoute } from '@tanstack/react-router'
import { Shell, DataTable } from '~/components/ui/shell'

export const Route = createFileRoute('/admin/workflows/')({
  component: WorkflowsPage,
})

function WorkflowsPage() {
  const workflows = [
    { id: 'workflow-1', name: 'Data Sync Workflow', status: 'Active', lastRun: '2 hours ago' },
    { id: 'workflow-2', name: 'Email Notification', status: 'Paused', lastRun: '1 day ago' },
    { id: 'workflow-3', name: 'Backup Job', status: 'Failed', lastRun: '3 hours ago' },
  ]

  return (
    <Shell>
      <div className="p-6">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-semibold">Workflows</h1>
          <div className="flex gap-4">
            <select className="border rounded px-3 py-2" aria-label="Filter by status">
              <option value="">All Status</option>
              <option value="active">Active</option>
              <option value="paused">Paused</option>
              <option value="failed">Failed</option>
            </select>
            <input
              type="search"
              placeholder="Search workflows..."
              aria-label="Search workflows"
              className="border rounded px-3 py-2"
            />
          </div>
        </div>

        <div className="bg-white rounded-lg shadow">
          <DataTable
            columns={[
              { accessorKey: 'name', header: 'Name' },
              {
                accessorKey: 'status',
                header: 'Status',
                cell: ({ row }) => {
                  const status = row.original.status
                  const colors: Record<string, string> = {
                    Active: 'text-green-600',
                    Paused: 'text-yellow-600',
                    Failed: 'text-red-600',
                  }
                  return <span className={colors[status]}>{status}</span>
                },
              },
              { accessorKey: 'lastRun', header: 'Last Run' },
              {
                id: 'actions',
                header: 'Actions',
                cell: ({ row }) => (
                  <a href={`/admin/workflows/${row.original.id}`} className="text-blue-600 hover:underline">
                    View
                  </a>
                ),
              },
            ]}
            data={workflows}
          />
        </div>
      </div>
    </Shell>
  )
}
