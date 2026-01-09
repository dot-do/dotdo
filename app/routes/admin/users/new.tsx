/**
 * Admin Create User Route
 *
 * Form for creating a new user.
 */

import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Shell } from '@mdxui/cockpit'

export const Route = createFileRoute('/admin/users/new')({
  component: CreateUserPage,
})

function CreateUserPage() {
  const navigate = useNavigate()

  return (
    <Shell>
      <div className="p-6">
        <h1 className="text-2xl font-semibold mb-6">Create New User</h1>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            navigate({ to: '/admin/users' })
          }}
          className="bg-white rounded-lg shadow p-6 max-w-lg"
        >
          <div className="mb-4">
            <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">
              Name
            </label>
            <input type="text" id="name" name="name" required className="w-full border rounded px-3 py-2" />
          </div>

          <div className="mb-4">
            <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
              Email
            </label>
            <input type="email" id="email" name="email" required className="w-full border rounded px-3 py-2" />
          </div>

          <div className="mb-4">
            <label htmlFor="role" className="block text-sm font-medium text-gray-700 mb-1">
              Role
            </label>
            <select id="role" name="role" className="w-full border rounded px-3 py-2">
              <option value="user">User</option>
              <option value="admin">Admin</option>
            </select>
          </div>

          <div className="flex gap-2">
            <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700">
              Create User
            </button>
            <a href="/admin/users" className="px-4 py-2 border rounded hover:bg-gray-50">
              Cancel
            </a>
          </div>
        </form>
      </div>
    </Shell>
  )
}
