/**
 * Admin Activity Logs Route
 *
 * Displays system activity logs with filtering and search.
 */

import { createFileRoute } from '@tanstack/react-router'
import { Shell, DataTable } from '~/components/ui/shell'

export const Route = createFileRoute('/admin/activity/')({
  component: ActivityPage,
})

function ActivityPage() {
  const activities = [
    {
      id: 'log-1',
      timestamp: '2024-01-08 10:30:00',
      user: 'John Doe',
      action: 'Create',
      resource: 'Workflow',
    },
    {
      id: 'log-2',
      timestamp: '2024-01-08 09:15:00',
      user: 'Jane Smith',
      action: 'Update',
      resource: 'Integration',
    },
    {
      id: 'log-3',
      timestamp: '2024-01-08 08:00:00',
      user: 'John Doe',
      action: 'Login',
      resource: 'Session',
    },
  ]

  return (
    <Shell>
      <div className="p-6">
        <h1 className="text-2xl font-semibold mb-6">Activity Logs</h1>

        <div className="bg-white rounded-lg shadow mb-4 p-4">
          <div className="flex gap-4 flex-wrap">
            <input
              type="search"
              placeholder="Search logs..."
              aria-label="Search logs"
              className="flex-1 border rounded px-3 py-2 min-w-[200px]"
            />
            <select className="border rounded px-3 py-2" aria-label="Filter by action">
              <option value="">All Actions</option>
              <option value="create">Create</option>
              <option value="update">Update</option>
              <option value="delete">Delete</option>
              <option value="login">Login</option>
            </select>
            <select className="border rounded px-3 py-2" aria-label="Filter by user">
              <option value="">All Users</option>
              <option value="user-1">John Doe</option>
              <option value="user-2">Jane Smith</option>
            </select>
            <div className="flex gap-2 items-center">
              <input type="date" className="border rounded px-3 py-2" aria-label="From date" />
              <span>To</span>
              <input type="date" className="border rounded px-3 py-2" aria-label="To date" />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow">
          <DataTable
            columns={[
              { accessorKey: 'timestamp', header: 'Timestamp' },
              { accessorKey: 'user', header: 'User' },
              {
                accessorKey: 'action',
                header: 'Action',
                cell: ({ row }) => {
                  const action = row.original.action
                  const colors: Record<string, string> = {
                    Create: 'bg-green-100 text-green-800',
                    Update: 'bg-blue-100 text-blue-800',
                    Delete: 'bg-red-100 text-red-800',
                    Login: 'bg-purple-100 text-purple-800',
                  }
                  return (
                    <span className={`px-2 py-1 rounded text-sm ${colors[action] || ''}`}>{action}</span>
                  )
                },
              },
              { accessorKey: 'resource', header: 'Resource' },
              {
                id: 'actions',
                header: 'Details',
                cell: ({ row }) => (
                  <a href={`/admin/activity/${row.original.id}`} className="text-blue-600 hover:underline">
                    View
                  </a>
                ),
              },
            ]}
            data={activities}
            paginated
          />
        </div>
      </div>
    </Shell>
  )
}
