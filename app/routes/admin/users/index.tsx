/**
 * Admin Users List Route
 *
 * Displays a table of all users with search, filter, and pagination.
 * Uses useCollection for real-time sync with the User collection via WebSocket.
 */

import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Shell, DataTable } from '~/components/ui/shell'
import { useCollection } from '~/lib/hooks/use-collection'
import { UserSchema, type User } from '~/collections'
import {
  ErrorState,
  EmptyState,
  ListSkeleton,
  PageHeader,
} from '~/components/admin/shared'
import { Button } from '~/components/ui/button'

export const Route = createFileRoute('/admin/users/')({
  component: UsersPage,
})

// ============================================================================
// Role Badge Component
// ============================================================================

type UserRole = 'admin' | 'member' | 'viewer'

function RoleBadge({ role }: { role: UserRole }) {
  const colors: Record<UserRole, string> = {
    admin: 'bg-purple-500 text-white',
    member: 'bg-blue-500 text-white',
    viewer: 'bg-gray-200 text-gray-800',
  }

  return (
    <span className={`px-2 py-1 rounded text-sm font-medium capitalize ${colors[role]}`}>
      {role}
    </span>
  )
}

// ============================================================================
// Main Page Component
// ============================================================================

function UsersPage() {
  const navigate = useNavigate()

  // Use collection for real-time user data
  const users = useCollection({
    name: 'users',
    schema: UserSchema,
  })

  const handleCreate = () => {
    navigate({ to: '/admin/users/new' })
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this user?')) return
    try {
      await users.delete(id)
    } catch (err) {
      console.error('Failed to delete user:', err)
    }
  }

  if (users.isLoading) {
    return (
      <Shell>
        <div className="p-6">
          <ListSkeleton rows={3} columns={['w-32', 'w-48', 'w-20', 'w-16']} />
        </div>
      </Shell>
    )
  }

  if (users.error) {
    return (
      <Shell>
        <div className="p-6">
          <ErrorState error={users.error} title="Error loading users" />
        </div>
      </Shell>
    )
  }

  if (users.data.length === 0) {
    return (
      <Shell>
        <div className="p-6">
          <PageHeader
            title="Users"
            actions={
              <Button asChild>
                <a href="/admin/users/new">Create User</a>
              </Button>
            }
          />
          <EmptyState
            icon="&#128100;"
            title="No users yet"
            description="Get started by creating your first user."
            action={{ label: 'Create First User', onClick: handleCreate }}
          />
        </div>
      </Shell>
    )
  }

  return (
    <Shell>
      <div className="p-6">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-semibold">Users</h1>
          <Button asChild data-testid="create-user-button">
            <a href="/admin/users/new">Create User</a>
          </Button>
        </div>
        <div className="bg-white rounded-lg shadow">
          <DataTable
            columns={[
              {
                accessorKey: 'name',
                header: 'Name',
                cell: ({ row }) => (
                  <div className="flex items-center gap-2">
                    {row.original.avatarUrl ? (
                      <img
                        src={row.original.avatarUrl}
                        alt=""
                        className="w-8 h-8 rounded-full"
                      />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-gray-600 text-sm">
                        {row.original.name.charAt(0).toUpperCase()}
                      </div>
                    )}
                    <span className="font-medium">{row.original.name}</span>
                  </div>
                ),
              },
              {
                accessorKey: 'email',
                header: 'Email',
                cell: ({ row }) => (
                  <span className="text-sm text-gray-600">{row.original.email}</span>
                ),
              },
              {
                accessorKey: 'role',
                header: 'Role',
                cell: ({ row }) => <RoleBadge role={row.original.role} />,
              },
              {
                id: 'actions',
                header: 'Actions',
                cell: ({ row }) => {
                  const user = row.original
                  return (
                    <div className="flex gap-2">
                      <a
                        href={`/admin/users/${user.$id}`}
                        className="text-blue-600 hover:underline text-sm"
                      >
                        Edit
                      </a>
                      <Button
                        type="button"
                        variant="link"
                        className="text-destructive p-0 h-auto text-sm"
                        onClick={() => handleDelete(user.$id)}
                      >
                        Delete
                      </Button>
                    </div>
                  )
                },
              },
            ]}
            data={users.data}
            searchable
            searchPlaceholder="Search users..."
            paginated
          />
        </div>
      </div>
    </Shell>
  )
}
