/**
 * Admin API Keys Management Route
 *
 * Manage API keys for programmatic access.
 */

import { createFileRoute } from '@tanstack/react-router'
import { Shell, DataTable, APIKeyManager } from '@mdxui/cockpit'

export const Route = createFileRoute('/admin/integrations/api-keys')({
  component: APIKeysPage,
})

function APIKeysPage() {
  const apiKeys = [
    { id: 'key-1', name: 'Production API Key', key: 'sk_live_****', created: 'Jan 1, 2024', lastUsed: '2 hours ago' },
    { id: 'key-2', name: 'Development Key', key: 'sk_test_****', created: 'Dec 15, 2023', lastUsed: '1 day ago' },
  ]

  return (
    <Shell>
      <div className="p-6">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-semibold">API Keys</h1>
          <button className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700">Generate New Key</button>
        </div>

        <div className="bg-white rounded-lg shadow">
          <DataTable
            columns={[
              { accessorKey: 'name', header: 'Name' },
              { accessorKey: 'key', header: 'Key' },
              { accessorKey: 'created', header: 'Created' },
              { accessorKey: 'lastUsed', header: 'Last Used' },
              {
                id: 'actions',
                header: 'Actions',
                cell: () => (
                  <button className="text-red-600 hover:underline">Revoke</button>
                ),
              },
            ]}
            data={apiKeys}
          />
        </div>
      </div>
    </Shell>
  )
}
