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
// Loading Skeleton Component
// ============================================================================

function UsersListSkeleton() {
  return (
    <div data-testid="loading" className="animate-pulse">
      <div className="h-8 bg-gray-200 rounded w-32 mb-6" />
      <div className="bg-white rounded-lg shadow p-4">
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex gap-4">
              <div className="h-4 bg-gray-200 rounded w-32" />
              <div className="h-4 bg-gray-200 rounded w-48" />
              <div className="h-4 bg-gray-200 rounded w-20" />
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
      <div className="text-gray-400 text-5xl mb-4">&#128100;</div>
      <h2 className="text-xl font-semibold text-gray-700 mb-2">No users yet</h2>
      <p className="text-gray-500 mb-6">Get started by creating your first user.</p>
      <button
        type="button"
        onClick={onCreate}
        className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
      >
        Create First User
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
      <h2 className="text-xl font-semibold text-red-700 mb-2">Error loading users</h2>
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
          <UsersListSkeleton />
        </div>
      </Shell>
    )
  }

  if (users.error) {
    return (
      <Shell>
        <div className="p-6">
          <ErrorState error={users.error} />
        </div>
      </Shell>
    )
  }

  if (users.data.length === 0) {
    return (
      <Shell>
        <div className="p-6">
          <div className="flex justify-between items-center mb-6">
            <h1 className="text-2xl font-semibold">Users</h1>
            <a href="/admin/users/new" className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700">
              Create User
            </a>
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
          <h1 className="text-2xl font-semibold">Users</h1>
          <a
            href="/admin/users/new"
            data-testid="create-user-button"
            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
          >
            Create User
          </a>
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
                      <button
                        type="button"
                        onClick={() => handleDelete(user.$id)}
                        className="text-red-600 hover:underline text-sm"
                      >
                        Delete
                      </button>
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
