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
import {
  ErrorState,
  EmptyState,
  ListSkeleton,
  PageHeader,
} from '~/components/admin/shared'

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
// Integrations Grid Skeleton Component
// ============================================================================

function IntegrationsGridSkeleton() {
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
      // OAuth flow would be handled by a separate auth service
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
          <IntegrationsGridSkeleton />
        </div>
      </Shell>
    )
  }

  if (integrations.error) {
    return (
      <Shell>
        <div className="p-6">
          <ErrorState error={integrations.error} title="Error loading integrations" />
        </div>
      </Shell>
    )
  }

  if (integrations.data.length === 0) {
    return (
      <Shell>
        <div className="p-6">
          <PageHeader title="Integrations" />
          <EmptyState
            icon="&#128279;"
            title="No integrations yet"
            description="Connect your first service to get started."
          />
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
