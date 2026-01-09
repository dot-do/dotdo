/**
 * Admin Integrations List Route
 *
 * Displays available integrations and their connection status.
 */

import { createFileRoute } from '@tanstack/react-router'
import { Shell } from '~/components/ui/shell'

export const Route = createFileRoute('/admin/integrations/')({
  component: IntegrationsPage,
})

function IntegrationsPage() {
  const integrations = [
    { id: 'github', name: 'GitHub', status: 'Connected', icon: 'G' },
    { id: 'google', name: 'Google', status: 'Disconnected', icon: 'G' },
    { id: 'microsoft', name: 'Microsoft', status: 'Disconnected', icon: 'M' },
    { id: 'slack', name: 'Slack', status: 'Disconnected', icon: 'S' },
  ]

  return (
    <Shell>
      <div className="p-6">
        <h1 className="text-2xl font-semibold mb-6">Integrations</h1>

        <div className="grid grid-cols-2 gap-4">
          {integrations.map((integration) => (
            <div key={integration.id} className="bg-white rounded-lg shadow p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-gray-900 rounded flex items-center justify-center">
                    <span className="text-white text-xl">{integration.icon}</span>
                  </div>
                  <div>
                    <h3 className="font-semibold">{integration.name}</h3>
                    <p className="text-sm text-gray-500">Provider</p>
                  </div>
                </div>
                <span className={integration.status === 'Connected' ? 'text-green-600' : 'text-gray-500'}>
                  {integration.status}
                </span>
              </div>
              <div className="flex gap-2">
                {integration.status === 'Connected' ? (
                  <>
                    <a href={`/admin/integrations/${integration.id}`} className="text-blue-600 hover:underline">
                      Configure
                    </a>
                    <button className="text-red-600 hover:underline">Disconnect</button>
                  </>
                ) : (
                  <button className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700">Connect</button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </Shell>
  )
}
