/**
 * Admin Workflow Detail Route
 *
 * Displays workflow configuration and recent runs.
 */

import { createFileRoute } from '@tanstack/react-router'
import { Shell } from '@mdxui/cockpit'

export const Route = createFileRoute('/admin/workflows/$workflowId')({
  component: WorkflowDetailPage,
})

function WorkflowDetailPage() {
  const { workflowId } = Route.useParams()

  return (
    <Shell>
      <div className="p-6">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-semibold">Workflow Details</h1>
          <div className="flex gap-2">
            <button className="bg-yellow-600 text-white px-4 py-2 rounded hover:bg-yellow-700">Pause</button>
            <button className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700">Run Now</button>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h3 className="text-lg font-semibold mb-4">Configuration</h3>
          <dl className="grid grid-cols-2 gap-4">
            <div>
              <dt className="text-sm text-gray-500">Name</dt>
              <dd className="text-lg font-medium">Data Sync Workflow</dd>
            </div>
            <div>
              <dt className="text-sm text-gray-500">Status</dt>
              <dd className="text-lg font-medium text-green-600">Active</dd>
            </div>
            <div>
              <dt className="text-sm text-gray-500">Trigger</dt>
              <dd className="text-lg font-medium">Schedule (Every hour)</dd>
            </div>
            <div>
              <dt className="text-sm text-gray-500">Event</dt>
              <dd className="text-lg font-medium">on_data_change</dd>
            </div>
          </dl>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-semibold">Recent Runs</h3>
            <a href={`/admin/workflows/${workflowId}/runs`} className="text-blue-600 hover:underline">
              View All Executions
            </a>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between py-2 border-b">
              <span>Run #123</span>
              <span className="text-green-600">Success</span>
            </div>
            <div className="flex items-center justify-between py-2 border-b">
              <span>Run #122</span>
              <span className="text-green-600">Success</span>
            </div>
            <div className="flex items-center justify-between py-2">
              <span>Run #121</span>
              <span className="text-red-600">Failed</span>
            </div>
          </div>
        </div>
      </div>
    </Shell>
  )
}
