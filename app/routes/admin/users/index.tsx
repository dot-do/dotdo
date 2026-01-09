/**
 * Admin Users List Route
 *
 * Displays a table of all users with search, filter, and pagination.
 */

import { createFileRoute } from '@tanstack/react-router'
import { Shell, DataTable } from '~/components/ui/shell'

export const Route = createFileRoute('/admin/users/')({
  component: UsersPage,
})

function UsersPage() {
  const users = [
    { id: 'user-1', name: 'John Doe', email: 'john@example.com', role: 'Admin', status: 'Active' },
    { id: 'user-2', name: 'Jane Smith', email: 'jane@example.com', role: 'User', status: 'Active' },
  ]

  return (
    <Shell>
      <div className="p-6">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-semibold">Users</h1>
          <a href="/admin/users/new" className="bg-blue-600 text-white px-4 py-2 rounded">
            Create User
          </a>
        </div>
        <DataTable
          columns={[
            { accessorKey: 'name', header: 'Name' },
            { accessorKey: 'email', header: 'Email' },
            { accessorKey: 'role', header: 'Role' },
            { accessorKey: 'status', header: 'Status' },
          ]}
          data={users}
          searchable
          searchPlaceholder="Search users..."
          paginated
        />
      </div>
    </Shell>
  )
}
