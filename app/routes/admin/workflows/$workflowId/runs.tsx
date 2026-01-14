/**
 * Admin Workflow Runs Route
 *
 * Displays all runs for a specific workflow.
 */

import { createFileRoute } from '@tanstack/react-router'
import { Shell, DataTable } from '~/components/ui/shell'

export const Route = createFileRoute('/admin/workflows/$workflowId/runs')({
  component: WorkflowRunsPage,
})

function WorkflowRunsPage() {
  const { workflowId } = Route.useParams()

  const runs = [
    { id: 'run-123', started: '2024-01-08 10:30:00', duration: '2m 30s', status: 'Success' },
    { id: 'run-122', started: '2024-01-08 09:30:00', duration: '3m 15s', status: 'Failed' },
    { id: 'run-121', started: '2024-01-08 08:30:00', duration: '2m 45s', status: 'Success' },
  ]

  return (
    <Shell>
      <div className="p-6">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-semibold">Workflow Runs</h1>
          <select className="border rounded px-3 py-2" aria-label="Filter by status">
            <option value="">All Status</option>
            <option value="success">Success</option>
            <option value="failed">Failed</option>
            <option value="running">Running</option>
            <option value="pending">Pending</option>
          </select>
        </div>

        <div className="bg-white rounded-lg shadow">
          <DataTable
            columns={[
              { accessorKey: 'id', header: 'Run ID' },
              { accessorKey: 'started', header: 'Started' },
              { accessorKey: 'duration', header: 'Duration' },
              {
                accessorKey: 'status',
                header: 'Status',
                cell: ({ row }) => {
                  const status = row.original.status
                  const color = status === 'Success' ? 'text-green-600' : 'text-red-600'
                  return <span className={color}>{status}</span>
                },
              },
              {
                id: 'actions',
                header: 'Actions',
                cell: ({ row }) => (
                  <a
                    href={`/admin/workflows/${workflowId}/runs/${row.original.id}`}
                    className="text-blue-600 hover:underline"
                  >
                    View Logs
                  </a>
                ),
              },
            ]}
            data={runs}
          />
        </div>
      </div>
    </Shell>
  )
}
