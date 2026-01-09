/**
 * Admin Integration Detail Route
 *
 * Configuration and status for a specific integration.
 */

import { createFileRoute } from '@tanstack/react-router'
import { Shell } from '~/components/ui/shell'

export const Route = createFileRoute('/admin/integrations/$integrationId')({
  component: IntegrationDetailPage,
})

function IntegrationDetailPage() {
  const { integrationId } = Route.useParams()

  return (
    <Shell>
      <div className="p-6">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-semibold">{integrationId.toUpperCase()} Configuration</h1>
          <button className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700">Test Connection</button>
        </div>

        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h3 className="text-lg font-semibold mb-4">Settings</h3>
          <dl className="grid grid-cols-2 gap-4">
            <div>
              <dt className="text-sm text-gray-500">Client ID</dt>
              <dd className="text-lg font-medium">gh_client_*****</dd>
            </div>
            <div>
              <dt className="text-sm text-gray-500">Token</dt>
              <dd className="text-lg font-medium">ghp_*****</dd>
            </div>
            <div>
              <dt className="text-sm text-gray-500">Credentials</dt>
              <dd className="text-lg font-medium">Configured</dd>
            </div>
          </dl>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold mb-4">Sync Status</h3>
          <dl className="grid grid-cols-2 gap-4">
            <div>
              <dt className="text-sm text-gray-500">Last Sync</dt>
              <dd className="text-lg font-medium">2 hours ago</dd>
            </div>
            <div>
              <dt className="text-sm text-gray-500">Status</dt>
              <dd className="text-lg font-medium text-green-600">Healthy</dd>
            </div>
          </dl>
        </div>
      </div>
    </Shell>
  )
}
