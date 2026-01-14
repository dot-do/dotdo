/**
 * Admin User Detail Route
 *
 * Displays details for a specific user with edit and delete actions.
 */

import { createFileRoute } from '@tanstack/react-router'
import { Shell } from '~/components/ui/shell'
import { Button } from '~/components/ui/button'
import { getMockUser, getMockUserActivity } from '../../../../tests/mocks/user'

export const Route = createFileRoute('/admin/users/$userId')({
  component: UserDetailPage,
})

function UserDetailPage() {
  const { userId } = Route.useParams()

  // TODO: Replace with real API call
  const user = getMockUser(userId)
  const activity = getMockUserActivity(userId)

  return (
    <Shell>
      <div className="p-6">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-semibold">User Details</h1>
          <div className="flex gap-2">
            <Button type="button">Edit</Button>
            <Button type="button" variant="destructive">Delete</Button>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <dl className="grid grid-cols-2 gap-4">
            <div>
              <dt className="text-sm text-gray-500">Name</dt>
              <dd className="text-lg font-medium">{user.name}</dd>
            </div>
            <div>
              <dt className="text-sm text-gray-500">Email</dt>
              <dd className="text-lg font-medium">{user.email}</dd>
            </div>
            <div>
              <dt className="text-sm text-gray-500">Role</dt>
              <dd className="text-lg font-medium">{user.role}</dd>
            </div>
            <div>
              <dt className="text-sm text-gray-500">Status</dt>
              <dd className="text-lg font-medium text-green-600">{user.status}</dd>
            </div>
          </dl>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold mb-4">Activity History</h3>
          <ul className="space-y-3">
            {activity.map((item) => (
              <li key={item.id} className="flex items-center gap-3">
                <span className="text-gray-500 text-sm">{item.timestamp}</span>
                <span>{item.description}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Shell>
  )
}
