/**
 * Admin Sandbox Detail Route
 *
 * Displays sandbox detail with embedded terminal and controls.
 * Provides real-time terminal access and port management.
 *
 * Components:
 * - SandboxDetailPage: Main page with sandbox info and terminal
 * - SandboxStateCard: Display status, created time, etc.
 * - ExposedPortsList: List of exposed ports with links
 *
 * @see objects/Sandbox.ts - Sandbox Durable Object
 * @see app/components/TerminalEmbed.tsx - Terminal component
 */

import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useCallback, useEffect, useState } from 'react'
import { TerminalEmbed } from '~/components/TerminalEmbed'
import { Shell } from '~/components/ui/shell'
import { Button } from '~/components/ui/button'

// ============================================================================
// Types
// ============================================================================

interface ExposedPort {
  port: number
  exposedAt: string
  name?: string
}

interface SandboxState {
  status: 'idle' | 'running' | 'stopped' | 'error'
  createdAt: string
  exposedPorts: Array<ExposedPort>
  lastActivityAt?: string
}

// ============================================================================
// Route
// ============================================================================

export const Route = createFileRoute('/admin/sandboxes/$sandboxId')({
  component: SandboxDetailPage,
})

// ============================================================================
// Hooks
// ============================================================================

/**
 * Hook to fetch and manage sandbox state
 */
function useSandboxState(sandboxId: string) {
  const [state, setState] = useState<SandboxState | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchState = useCallback(async () => {
    try {
      const response = await fetch(`/api/sandboxes/${sandboxId}/state`)
      if (!response.ok) {
        throw new Error('Not found')
      }
      const data = await response.json() as SandboxState
      setState(data)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [sandboxId])

  useEffect(() => {
    fetchState()
    // Poll for state updates every 5 seconds
    const interval = setInterval(fetchState, 5000)
    return () => clearInterval(interval)
  }, [fetchState])

  return { state, loading, error, setState, refetch: fetchState }
}

// ============================================================================
// SandboxStateCard Component
// ============================================================================

interface SandboxStateCardProps {
  state: SandboxState | null
  sandboxId: string
  loading: boolean
  error: string | null
}

function SandboxStateCard({ state, sandboxId, loading, error }: SandboxStateCardProps) {
  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow p-6" data-testid="loading">
        <h3 className="text-lg font-semibold mb-4">Sandbox State</h3>
        <div className="animate-pulse space-y-3">
          <div className="h-4 bg-gray-200 rounded w-3/4"></div>
          <div className="h-4 bg-gray-200 rounded w-1/2"></div>
          <div className="h-4 bg-gray-200 rounded w-2/3"></div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-white rounded-lg shadow p-6" data-testid="error">
        <h3 className="text-lg font-semibold mb-4">Sandbox State</h3>
        <div className="text-red-600">Error: {error}</div>
        <p className="text-gray-500 text-sm mt-2">Not found or failed to load sandbox.</p>
      </div>
    )
  }

  const statusColors: Record<SandboxState['status'], string> = {
    idle: 'text-gray-600 bg-gray-100',
    running: 'text-green-600 bg-green-100',
    stopped: 'text-yellow-600 bg-yellow-100',
    error: 'text-red-600 bg-red-100',
  }

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h3 className="text-lg font-semibold mb-4">Sandbox State</h3>
      <dl className="space-y-3">
        <div className="flex justify-between">
          <dt className="text-sm text-gray-500">Sandbox ID</dt>
          <dd className="text-sm font-mono text-gray-700 truncate max-w-[200px]">
            {sandboxId}
          </dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-sm text-gray-500">Status</dt>
          <dd className={`text-sm font-medium px-2 py-0.5 rounded ${state?.status ? statusColors[state.status] : 'text-gray-500'}`}>
            {state?.status || 'Unknown'}
          </dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-sm text-gray-500">Created</dt>
          <dd className="text-sm text-gray-700">
            {state?.createdAt ? new Date(state.createdAt).toLocaleString() : 'N/A'}
          </dd>
        </div>
        {state?.lastActivityAt && (
          <div className="flex justify-between">
            <dt className="text-sm text-gray-500">Last Activity</dt>
            <dd className="text-sm text-gray-700">
              {new Date(state.lastActivityAt).toLocaleString()}
            </dd>
          </div>
        )}
      </dl>
    </div>
  )
}

// ============================================================================
// ExposedPortsList Component
// ============================================================================

interface ExposedPortsListProps {
  ports: ExposedPort[]
  sandboxId: string
  onExposePort: (port: number) => void
}

function ExposedPortsList({ ports, sandboxId, onExposePort }: ExposedPortsListProps) {
  const [showModal, setShowModal] = useState(false)
  const [portInput, setPortInput] = useState('')

  const handleExposePort = () => {
    const port = parseInt(portInput)
    if (!Number.isNaN(port) && port > 0 && port < 65536) {
      onExposePort(port)
      setPortInput('')
      setShowModal(false)
    }
  }

  return (
    <div className="bg-white rounded-lg shadow p-6 mt-4">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-semibold">Exposed Ports</h3>
        <Button
          type="button"
          size="sm"
          onClick={() => setShowModal(true)}
        >
          Expose Port
        </Button>
      </div>

      {ports.length === 0 ? (
        <p className="text-gray-500 text-sm">No exposed ports</p>
      ) : (
        <ul className="space-y-2">
          {ports.map((p) => (
            <li key={p.port} className="flex items-center justify-between bg-gray-50 rounded p-2">
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm">{p.port}</span>
                {p.name && <span className="text-gray-500 text-xs">({p.name})</span>}
              </div>
              <a
                href={`https://${sandboxId}-${p.port}.sandbox.do.do`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:text-blue-800 text-sm"
              >
                Open
              </a>
            </li>
          ))}
        </ul>
      )}

      {/* Expose Port Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-80">
            <h4 className="text-lg font-semibold mb-4">Expose Port</h4>
            <input
              type="number"
              value={portInput}
              onChange={(e) => setPortInput(e.target.value)}
              placeholder="Port number (e.g., 3000)"
              className="w-full border rounded px-3 py-2 mb-4"
              min={1}
              max={65535}
            />
            <div className="flex gap-2">
              <Button
                type="button"
                variant="secondary"
                className="flex-1"
                onClick={() => setShowModal(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                className="flex-1"
                onClick={handleExposePort}
              >
                Expose
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ============================================================================
// SandboxDetailPage Component
// ============================================================================

function SandboxDetailPage() {
  const { sandboxId } = Route.useParams()
  const router = useRouter()
  const { state, loading, error, setState, refetch } = useSandboxState(sandboxId)
  const [destroying, setDestroying] = useState(false)

  const handleDestroy = async () => {
    if (!confirm('Are you sure you want to destroy this sandbox? This action cannot be undone.')) {
      return
    }

    setDestroying(true)
    try {
      const response = await fetch(`/api/sandboxes/${sandboxId}`, {
        method: 'DELETE',
      })
      if (response.ok) {
        router.navigate({ to: '/admin/sandboxes' })
      } else {
        throw new Error('Failed to destroy sandbox')
      }
    } catch (err) {
      console.error('Failed to destroy sandbox:', err)
      alert('Failed to destroy sandbox. Please try again.')
    } finally {
      setDestroying(false)
    }
  }

  const handleExposePort = async (port: number) => {
    try {
      const response = await fetch(`/api/sandboxes/${sandboxId}/port`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port }),
      })
      if (!response.ok) {
        throw new Error('Failed to expose port')
      }
      const newPort = await response.json() as ExposedPort
      setState((s) =>
        s ? { ...s, exposedPorts: [...(s.exposedPorts || []), newPort] } : null
      )
    } catch (err) {
      console.error('Failed to expose port:', err)
      alert('Failed to expose port. Please try again.')
    }
  }

  const handleError = (err: Error) => {
    console.error('Terminal error:', err)
  }

  return (
    <Shell>
      <div className="p-6">
        {/* Header */}
        <div className="flex justify-between items-center mb-6">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <a
                href="/admin/sandboxes"
                className="text-blue-600 hover:text-blue-800 text-sm"
              >
                &larr; Back to Sandboxes
              </a>
            </div>
            <h1 className="text-2xl font-semibold">Sandbox: {sandboxId}</h1>
          </div>
          <Button
            type="button"
            variant="destructive"
            onClick={handleDestroy}
            disabled={destroying}
          >
            {destroying ? 'Destroying...' : 'Destroy'}
          </Button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column - State and Ports */}
          <div className="lg:col-span-1 space-y-4">
            <SandboxStateCard
              state={state}
              sandboxId={sandboxId}
              loading={loading}
              error={error}
            />

            <ExposedPortsList
              ports={state?.exposedPorts || []}
              sandboxId={sandboxId}
              onExposePort={handleExposePort}
            />
          </div>

          {/* Right Column - Terminal */}
          <div className="lg:col-span-2">
            <h2 className="text-lg font-medium mb-3">Terminal</h2>
            <TerminalEmbed
              sandboxId={sandboxId}
              className="h-96"
              onError={handleError}
            />
          </div>
        </div>
      </div>
    </Shell>
  )
}

export default SandboxDetailPage
