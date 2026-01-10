/**
 * Admin Integrations List Route
 *
 * Displays available integrations and their connection status.
 * Uses useCollection for real-time sync with the Integration collection via WebSocket.
 */

import { createFileRoute } from '@tanstack/react-router'
import { Shell } from '~/components/ui/shell'
import { useCollection } from '~/lib/hooks/use-collection'
import { IntegrationSchema, type Integration } from '~/collections'

export const Route = createFileRoute('/admin/integrations/')({
  component: IntegrationsPage,
})

// ============================================================================
// Status Badge Component
// ============================================================================

type IntegrationStatus = 'pending' | 'connected' | 'disconnected' | 'error'

function StatusBadge({ status }: { status: IntegrationStatus }) {
  const colors: Record<IntegrationStatus, string> = {
    connected: 'text-green-600',
    pending: 'text-yellow-600',
    disconnected: 'text-gray-500',
    error: 'text-red-600',
  }

  const labels: Record<IntegrationStatus, string> = {
    connected: 'Connected',
    pending: 'Pending',
    disconnected: 'Disconnected',
    error: 'Error',
  }

  return <span className={colors[status]}>{labels[status]}</span>
}

// ============================================================================
// Provider Icons
// ============================================================================

const providerIcons: Record<string, string> = {
  github: 'G',
  google: 'G',
  microsoft: 'M',
  slack: 'S',
  stripe: '$',
  discord: 'D',
  notion: 'N',
  linear: 'L',
  default: '?',
}

function getProviderIcon(provider: string): string {
  return providerIcons[provider.toLowerCase()] || providerIcons.default
}

// ============================================================================
// Loading Skeleton Component
// ============================================================================

function IntegrationsListSkeleton() {
  return (
    <div data-testid="loading" className="animate-pulse">
      <div className="h-8 bg-gray-200 rounded w-40 mb-6" />
      <div className="grid grid-cols-2 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-gray-200 rounded" />
              <div className="flex-1">
                <div className="h-4 bg-gray-200 rounded w-24 mb-2" />
                <div className="h-3 bg-gray-200 rounded w-16" />
              </div>
            </div>
            <div className="h-8 bg-gray-200 rounded w-20" />
          </div>
        ))}
      </div>
    </div>
  )
}

// ============================================================================
// Empty State Component
// ============================================================================

function EmptyState() {
  return (
    <div data-testid="empty-state" className="text-center py-12">
      <div className="text-gray-400 text-5xl mb-4">&#128279;</div>
      <h2 className="text-xl font-semibold text-gray-700 mb-2">No integrations yet</h2>
      <p className="text-gray-500 mb-6">Connect your first service to get started.</p>
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
      <h2 className="text-xl font-semibold text-red-700 mb-2">Error loading integrations</h2>
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
// Integration Card Component
// ============================================================================

interface IntegrationCardProps {
  integration: Integration
  onConnect: () => void
  onDisconnect: () => void
}

function IntegrationCard({ integration, onConnect, onDisconnect }: IntegrationCardProps) {
  const isConnected = integration.status === 'connected'

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gray-900 rounded flex items-center justify-center">
            <span className="text-white text-xl">{getProviderIcon(integration.provider)}</span>
          </div>
          <div>
            <h3 className="font-semibold">{integration.name}</h3>
            <p className="text-sm text-gray-500 capitalize">{integration.provider}</p>
          </div>
        </div>
        <StatusBadge status={integration.status} />
      </div>
      <div className="flex gap-2">
        {isConnected ? (
          <>
            <a
              href={`/admin/integrations/${integration.$id}`}
              className="text-blue-600 hover:underline"
            >
              Configure
            </a>
            <button
              type="button"
              onClick={onDisconnect}
              className="text-red-600 hover:underline"
            >
              Disconnect
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={onConnect}
            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
          >
            Connect
          </button>
        )}
      </div>
    </div>
  )
}

// ============================================================================
// Main Page Component
// ============================================================================

function IntegrationsPage() {
  // Use collection for real-time integration data
  const integrations = useCollection({
    name: 'integrations',
    schema: IntegrationSchema,
  })

  const handleConnect = async (integration: Integration) => {
    try {
      await integrations.update(integration.$id, {
        status: 'pending',
      })
      // TODO: Redirect to OAuth flow or show modal
      console.log('Connecting to:', integration.provider)
    } catch (err) {
      console.error('Failed to initiate connection:', err)
    }
  }

  const handleDisconnect = async (integration: Integration) => {
    if (!confirm(`Disconnect ${integration.name}?`)) return
    try {
      await integrations.update(integration.$id, {
        status: 'disconnected',
        credentials: undefined,
      })
    } catch (err) {
      console.error('Failed to disconnect:', err)
    }
  }

  if (integrations.isLoading) {
    return (
      <Shell>
        <div className="p-6">
          <IntegrationsListSkeleton />
        </div>
      </Shell>
    )
  }

  if (integrations.error) {
    return (
      <Shell>
        <div className="p-6">
          <ErrorState error={integrations.error} />
        </div>
      </Shell>
    )
  }

  if (integrations.data.length === 0) {
    return (
      <Shell>
        <div className="p-6">
          <h1 className="text-2xl font-semibold mb-6">Integrations</h1>
          <EmptyState />
        </div>
      </Shell>
    )
  }

  return (
    <Shell>
      <div className="p-6">
        <h1 className="text-2xl font-semibold mb-6">Integrations</h1>

        <div className="grid grid-cols-2 gap-4">
          {integrations.data.map((integration) => (
            <IntegrationCard
              key={integration.$id}
              integration={integration}
              onConnect={() => handleConnect(integration)}
              onDisconnect={() => handleDisconnect(integration)}
            />
          ))}
        </div>
      </div>
    </Shell>
  )
}
