/**
 * Admin Activity Log Detail Route
 *
 * Displays detailed information about a specific activity log entry.
 */

import { createFileRoute } from '@tanstack/react-router'
import { Shell } from '~/components/ui/shell'

export const Route = createFileRoute('/admin/activity/$logId')({
  component: ActivityDetailPage,
})

function ActivityDetailPage() {
  const { logId } = Route.useParams()

  return (
    <Shell>
      <div className="p-6">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-semibold">Activity Details</h1>
          <a href="/admin/activity" className="text-blue-600 hover:underline">
            Back to Logs
          </a>
        </div>

        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h3 className="text-lg font-semibold mb-4">Information</h3>
          <dl className="grid grid-cols-2 gap-4">
            <div>
              <dt className="text-sm text-gray-500">Timestamp</dt>
              <dd className="text-lg font-medium">2024-01-08 10:30:00</dd>
            </div>
            <div>
              <dt className="text-sm text-gray-500">User</dt>
              <dd className="text-lg font-medium">John Doe</dd>
            </div>
            <div>
              <dt className="text-sm text-gray-500">Action</dt>
              <dd className="text-lg font-medium">Create</dd>
            </div>
            <div>
              <dt className="text-sm text-gray-500">Resource</dt>
              <dd className="text-lg font-medium">Workflow</dd>
            </div>
          </dl>
        </div>

        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h3 className="text-lg font-semibold mb-4">Request Metadata</h3>
          <dl className="grid grid-cols-2 gap-4">
            <div>
              <dt className="text-sm text-gray-500">IP Address</dt>
              <dd className="text-lg font-medium">192.168.1.1</dd>
            </div>
            <div>
              <dt className="text-sm text-gray-500">User Agent</dt>
              <dd className="text-lg font-medium">Mozilla/5.0 Chrome/120.0</dd>
            </div>
            <div>
              <dt className="text-sm text-gray-500">Request ID</dt>
              <dd className="text-lg font-medium">req_abc123</dd>
            </div>
          </dl>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold mb-4">Changes</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <h4 className="font-medium mb-2">Before</h4>
              <pre className="bg-gray-100 p-4 rounded text-sm overflow-auto">null</pre>
            </div>
            <div>
              <h4 className="font-medium mb-2">After</h4>
              <pre className="bg-gray-100 p-4 rounded text-sm overflow-auto">
                {JSON.stringify({ name: 'New Workflow', status: 'active' }, null, 2)}
              </pre>
            </div>
          </div>
          <p className="mt-4 text-sm text-gray-500">Modified fields: name, status</p>
        </div>
      </div>
    </Shell>
  )
}
