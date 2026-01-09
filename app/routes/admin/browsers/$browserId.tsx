/**
 * Admin Browser Detail Route
 *
 * Displays browser session detail with embedded live view and controls.
 * Provides real-time monitoring via SSE events and actions panel.
 *
 * Components:
 * - BrowserDetailPage: Main page with grid layout
 * - BrowserLiveView: iframe for Browserbase live view
 * - BrowserStateCard: Display all browser state fields
 * - BrowserControls: Pause/Stop/Restart controls
 * - BrowserActionsPanel: Forms for navigate/act/extract/agent
 * - BrowserEventsLog: SSE event stream display
 *
 * @see objects/Browser.ts - Browser Durable Object
 */

import { createFileRoute } from '@tanstack/react-router'
import { Shell } from '~/components/ui/shell'
import { useState, useEffect, useCallback, useRef } from 'react'
import { BrowserScreencast } from '~/components/BrowserScreencast'

// ============================================================================
// Types
// ============================================================================

interface BrowserState {
  status: 'idle' | 'active' | 'paused' | 'stopped'
  provider?: 'cloudflare' | 'browserbase'
  currentUrl?: string
  liveViewUrl?: string
  sessionId?: string
  lastActivity?: number
  viewport?: { width: number; height: number }
}

interface BrowserEvent {
  type: string
  data: Record<string, unknown>
  timestamp: number
}

// ============================================================================
// Route
// ============================================================================

export const Route = createFileRoute('/admin/browsers/$browserId')({
  component: BrowserDetailPage,
})

// ============================================================================
// Hooks
// ============================================================================

/**
 * Hook to fetch and manage browser state
 */
function useBrowserState(browserId: string) {
  const [state, setState] = useState<BrowserState | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchState = useCallback(async () => {
    try {
      const response = await fetch(`/api/browsers/${browserId}/state`)
      if (!response.ok) {
        throw new Error(`Failed to fetch state: ${response.statusText}`)
      }
      const data = await response.json()
      setState(data)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [browserId])

  useEffect(() => {
    fetchState()
    // Poll for state updates every 5 seconds
    const interval = setInterval(fetchState, 5000)
    return () => clearInterval(interval)
  }, [fetchState])

  return { state, loading, error, refetch: fetchState }
}

/**
 * Hook to subscribe to browser events via SSE
 */
function useBrowserEvents(browserId: string) {
  const [events, setEvents] = useState<BrowserEvent[]>([])
  const [connected, setConnected] = useState(false)
  const eventSourceRef = useRef<EventSource | null>(null)

  useEffect(() => {
    const eventSource = new EventSource(`/api/browsers/${browserId}/events`)
    eventSourceRef.current = eventSource

    eventSource.onopen = () => {
      setConnected(true)
    }

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        setEvents((prev) => [...prev.slice(-99), {
          type: data.type || 'message',
          data: data,
          timestamp: Date.now(),
        }])
      } catch {
        // Non-JSON message
        setEvents((prev) => [...prev.slice(-99), {
          type: 'message',
          data: { raw: event.data },
          timestamp: Date.now(),
        }])
      }
    }

    eventSource.onerror = () => {
      setConnected(false)
    }

    return () => {
      eventSource.close()
    }
  }, [browserId])

  return { events, connected }
}

// ============================================================================
// BrowserLiveView Component
// ============================================================================

interface BrowserLiveViewProps {
  liveViewUrl?: string
  provider?: 'cloudflare' | 'browserbase'
  browserId: string
}

function BrowserLiveView({ liveViewUrl, provider, browserId }: BrowserLiveViewProps) {
  const [isFullscreen, setIsFullscreen] = useState(false)

  const toggleFullscreen = useCallback(() => {
    setIsFullscreen((prev) => !prev)
  }, [])

  // Browserbase with liveViewUrl - use iframe
  if (provider === 'browserbase' && liveViewUrl) {
    return (
      <div className={`relative ${isFullscreen ? 'fixed inset-0 z-50 bg-black' : ''}`}>
        <div className="absolute top-2 right-2 z-10">
          <button
            onClick={toggleFullscreen}
            className="bg-white/90 hover:bg-white px-3 py-1 rounded shadow text-sm"
            aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
          >
            {isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
          </button>
        </div>
        <iframe
          src={liveViewUrl}
          title="Browser Live View"
          className={`w-full border rounded bg-white ${isFullscreen ? 'h-full' : 'h-[600px]'}`}
          sandbox="allow-scripts allow-same-origin"
        />
      </div>
    )
  }

  // Cloudflare - use BrowserScreencast for CDP-based live preview
  if (provider === 'cloudflare') {
    return <BrowserScreencast browserId={browserId} className="h-[600px]" />
  }

  // Fallback - no live view available
  return (
    <div className="bg-gray-100 rounded-lg border p-8 flex flex-col items-center justify-center h-[600px]">
      <svg className="w-16 h-16 text-gray-400 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
      </svg>
      <p className="text-gray-600 text-center">
        Live view not available for this session
      </p>
      <p className="text-gray-500 text-sm mt-2">
        Start a session with liveView enabled to see the browser
      </p>
    </div>
  )
}

// ============================================================================
// BrowserStateCard Component
// ============================================================================

interface BrowserStateCardProps {
  state: BrowserState | null
  loading: boolean
  error: string | null
}

function BrowserStateCard({ state, loading, error }: BrowserStateCardProps) {
  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold mb-4">Session State</h3>
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
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold mb-4">Session State</h3>
        <div className="text-red-600">Error: {error}</div>
      </div>
    )
  }

  const statusColors = {
    idle: 'text-gray-600 bg-gray-100',
    active: 'text-green-600 bg-green-100',
    paused: 'text-yellow-600 bg-yellow-100',
    stopped: 'text-red-600 bg-red-100',
  }

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h3 className="text-lg font-semibold mb-4">Session State</h3>
      <dl className="space-y-3">
        <div className="flex justify-between">
          <dt className="text-sm text-gray-500">Status</dt>
          <dd className={`text-sm font-medium px-2 py-0.5 rounded ${state?.status ? statusColors[state.status] : 'text-gray-500'}`}>
            {state?.status || 'Unknown'}
          </dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-sm text-gray-500">Provider</dt>
          <dd className="text-sm font-medium">{state?.provider || 'N/A'}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-sm text-gray-500">Session ID</dt>
          <dd className="text-sm font-mono text-gray-700 truncate max-w-[200px]">
            {state?.sessionId || 'N/A'}
          </dd>
        </div>
        <div className="flex flex-col">
          <dt className="text-sm text-gray-500">Current URL</dt>
          <dd className="text-sm text-blue-600 truncate mt-1">
            {state?.currentUrl || 'No URL'}
          </dd>
        </div>
        {state?.viewport && (
          <div className="flex justify-between">
            <dt className="text-sm text-gray-500">Viewport</dt>
            <dd className="text-sm font-medium">
              {state.viewport.width} x {state.viewport.height}
            </dd>
          </div>
        )}
        {state?.lastActivity && (
          <div className="flex justify-between">
            <dt className="text-sm text-gray-500">Last Activity</dt>
            <dd className="text-sm text-gray-700">
              {new Date(state.lastActivity).toLocaleTimeString()}
            </dd>
          </div>
        )}
      </dl>
    </div>
  )
}

// ============================================================================
// BrowserControls Component
// ============================================================================

interface BrowserControlsProps {
  session: BrowserState | null
  browserId: string
  onAction: () => void
}

function BrowserControls({ session, browserId, onAction }: BrowserControlsProps) {
  const [loading, setLoading] = useState(false)

  const handleStop = async () => {
    setLoading(true)
    try {
      await fetch(`/api/browsers/${browserId}/stop`, { method: 'POST' })
      onAction()
    } catch (error) {
      console.error('Failed to stop session:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleRestart = async () => {
    setLoading(true)
    try {
      await fetch(`/api/browsers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: browserId,
          provider: session?.provider || 'cloudflare',
        }),
      })
      onAction()
    } catch (error) {
      console.error('Failed to restart session:', error)
    } finally {
      setLoading(false)
    }
  }

  const handlePause = async () => {
    setLoading(true)
    try {
      // Pause functionality - in a real implementation this would call a pause endpoint
      await fetch(`/api/browsers/${browserId}/pause`, { method: 'POST' })
      onAction()
    } catch (error) {
      console.error('Failed to pause session:', error)
    } finally {
      setLoading(false)
    }
  }

  const isActive = session?.status === 'active'
  const isStopped = session?.status === 'stopped'

  return (
    <div className="bg-white rounded-lg shadow p-4 mt-4">
      <h3 className="text-sm font-semibold text-gray-700 mb-3">Controls</h3>
      <div className="flex gap-2">
        {isActive && (
          <>
            <button
              onClick={handlePause}
              disabled={loading}
              className="bg-yellow-500 hover:bg-yellow-600 disabled:bg-yellow-300 text-white px-4 py-2 rounded text-sm font-medium"
            >
              Pause
            </button>
            <button
              onClick={handleStop}
              disabled={loading}
              className="bg-red-500 hover:bg-red-600 disabled:bg-red-300 text-white px-4 py-2 rounded text-sm font-medium"
            >
              Stop
            </button>
          </>
        )}
        {isStopped && (
          <button
            onClick={handleRestart}
            disabled={loading}
            className="bg-green-500 hover:bg-green-600 disabled:bg-green-300 text-white px-4 py-2 rounded text-sm font-medium"
          >
            Restart
          </button>
        )}
        {!isActive && !isStopped && (
          <span className="text-sm text-gray-500">Session is {session?.status || 'unknown'}</span>
        )}
      </div>
    </div>
  )
}

// ============================================================================
// BrowserActionsPanel Component
// ============================================================================

interface BrowserActionsPanelProps {
  browserId: string
  onAction?: () => void
}

function BrowserActionsPanel({ browserId, onAction }: BrowserActionsPanelProps) {
  const [url, setUrl] = useState('')
  const [instruction, setInstruction] = useState('')
  const [extractInstruction, setExtractInstruction] = useState('')
  const [goal, setGoal] = useState('')
  const [loading, setLoading] = useState<string | null>(null)
  const [result, setResult] = useState<{ type: string; data: unknown } | null>(null)

  const handleNavigate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!url.trim()) return

    setLoading('navigate')
    setResult(null)
    try {
      const response = await fetch(`/api/browsers/${browserId}/browse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      })
      const data = await response.json()
      setResult({ type: 'navigate', data })
      setUrl('')
      onAction?.()
    } catch (error) {
      setResult({ type: 'error', data: error instanceof Error ? error.message : 'Unknown error' })
    } finally {
      setLoading(null)
    }
  }

  const handleAct = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!instruction.trim()) return

    setLoading('act')
    setResult(null)
    try {
      const response = await fetch(`/api/browsers/${browserId}/act`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instruction }),
      })
      const data = await response.json()
      setResult({ type: 'act', data })
      setInstruction('')
      onAction?.()
    } catch (error) {
      setResult({ type: 'error', data: error instanceof Error ? error.message : 'Unknown error' })
    } finally {
      setLoading(null)
    }
  }

  const handleExtract = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!extractInstruction.trim()) return

    setLoading('extract')
    setResult(null)
    try {
      const response = await fetch(`/api/browsers/${browserId}/extract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instruction: extractInstruction }),
      })
      const data = await response.json()
      setResult({ type: 'extract', data })
      setExtractInstruction('')
      onAction?.()
    } catch (error) {
      setResult({ type: 'error', data: error instanceof Error ? error.message : 'Unknown error' })
    } finally {
      setLoading(null)
    }
  }

  const handleAgent = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!goal.trim()) return

    setLoading('agent')
    setResult(null)
    try {
      const response = await fetch(`/api/browsers/${browserId}/agent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goal }),
      })
      const data = await response.json()
      setResult({ type: 'agent', data })
      setGoal('')
      onAction?.()
    } catch (error) {
      setResult({ type: 'error', data: error instanceof Error ? error.message : 'Unknown error' })
    } finally {
      setLoading(null)
    }
  }

  return (
    <div className="bg-white rounded-lg shadow p-4 mt-4">
      <h3 className="text-sm font-semibold text-gray-700 mb-3">Actions</h3>

      {/* Navigate Form */}
      <form onSubmit={handleNavigate} className="mb-4">
        <label htmlFor="url" className="block text-xs text-gray-500 mb-1">Navigate to URL</label>
        <div className="flex gap-2">
          <input
            id="url"
            type="url"
            name="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com"
            className="flex-1 border rounded px-3 py-2 text-sm"
            aria-label="URL to navigate"
          />
          <button
            type="submit"
            disabled={loading === 'navigate' || !url.trim()}
            className="bg-blue-500 hover:bg-blue-600 disabled:bg-blue-300 text-white px-4 py-2 rounded text-sm font-medium"
          >
            Navigate
          </button>
        </div>
      </form>

      {/* Act Form */}
      <form onSubmit={handleAct} className="mb-4">
        <label htmlFor="instruction" className="block text-xs text-gray-500 mb-1">Execute Action</label>
        <div className="flex gap-2">
          <input
            id="instruction"
            type="text"
            name="instruction"
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            placeholder="Click the login button"
            className="flex-1 border rounded px-3 py-2 text-sm"
            aria-label="Action instruction"
          />
          <button
            type="submit"
            disabled={loading === 'act' || !instruction.trim()}
            className="bg-purple-500 hover:bg-purple-600 disabled:bg-purple-300 text-white px-4 py-2 rounded text-sm font-medium"
          >
            Act
          </button>
        </div>
      </form>

      {/* Extract Form */}
      <form onSubmit={handleExtract} className="mb-4">
        <label htmlFor="extractInstruction" className="block text-xs text-gray-500 mb-1">Extract Data</label>
        <div className="flex gap-2">
          <input
            id="extractInstruction"
            type="text"
            name="extractInstruction"
            value={extractInstruction}
            onChange={(e) => setExtractInstruction(e.target.value)}
            placeholder="Get the page title and main heading"
            className="flex-1 border rounded px-3 py-2 text-sm"
            aria-label="Extract instruction"
          />
          <button
            type="submit"
            disabled={loading === 'extract' || !extractInstruction.trim()}
            className="bg-green-500 hover:bg-green-600 disabled:bg-green-300 text-white px-4 py-2 rounded text-sm font-medium"
          >
            Extract
          </button>
        </div>
      </form>

      {/* Agent Form */}
      <form onSubmit={handleAgent}>
        <label htmlFor="goal" className="block text-xs text-gray-500 mb-1">Run Agent</label>
        <div className="flex gap-2">
          <input
            id="goal"
            type="text"
            name="goal"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder="Log in and check the dashboard"
            className="flex-1 border rounded px-3 py-2 text-sm"
            aria-label="Agent goal"
          />
          <button
            type="submit"
            disabled={loading === 'agent' || !goal.trim()}
            className="bg-orange-500 hover:bg-orange-600 disabled:bg-orange-300 text-white px-4 py-2 rounded text-sm font-medium"
          >
            Agent
          </button>
        </div>
      </form>

      {/* Result Display */}
      {result && (
        <div className={`mt-4 p-3 rounded text-sm ${result.type === 'error' ? 'bg-red-50 text-red-700' : 'bg-gray-50'}`}>
          <div className="font-medium mb-1 capitalize">{result.type} Result:</div>
          <pre className="text-xs overflow-auto max-h-32">
            {JSON.stringify(result.data, null, 2)}
          </pre>
        </div>
      )}
    </div>
  )
}

// ============================================================================
// BrowserEventsLog Component
// ============================================================================

interface BrowserEventsLogProps {
  browserId: string
}

function BrowserEventsLog({ browserId }: BrowserEventsLogProps) {
  const { events, connected } = useBrowserEvents(browserId)
  const containerRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom on new events
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight
    }
  }, [events])

  return (
    <div className="bg-white rounded-lg shadow p-4 mt-4">
      <div className="flex justify-between items-center mb-3">
        <h3 className="text-sm font-semibold text-gray-700">Events Log</h3>
        <span className={`text-xs px-2 py-0.5 rounded ${connected ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
          {connected ? 'Connected' : 'Disconnected'}
        </span>
      </div>
      <div
        ref={containerRef}
        className="h-48 overflow-y-auto bg-gray-50 rounded p-2 font-mono text-xs"
      >
        {events.length === 0 ? (
          <div className="text-gray-400 text-center py-4">
            No events yet. Waiting for browser activity...
          </div>
        ) : (
          events.map((event, i) => (
            <div key={i} className="mb-2 pb-2 border-b border-gray-200 last:border-0">
              <div className="flex justify-between text-gray-500">
                <span className="font-semibold text-gray-700">{event.type}</span>
                <span>{new Date(event.timestamp).toLocaleTimeString()}</span>
              </div>
              <div className="text-gray-600 truncate mt-1">
                {JSON.stringify(event.data)}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

// ============================================================================
// BrowserDetailPage Component
// ============================================================================

function BrowserDetailPage() {
  const { browserId } = Route.useParams()
  const { state, loading, error, refetch } = useBrowserState(browserId)

  return (
    <Shell>
      <div className="p-6">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-2xl font-semibold">Browser Session</h1>
            <p className="text-sm text-gray-500 mt-1">ID: {browserId}</p>
          </div>
          <a
            href="/admin/browsers"
            className="text-blue-600 hover:text-blue-800 text-sm"
          >
            Back to Browsers
          </a>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left Column - Live View */}
          <div>
            <h2 className="text-lg font-medium mb-3">Live View</h2>
            <BrowserLiveView
              liveViewUrl={state?.liveViewUrl}
              provider={state?.provider}
              browserId={browserId}
            />
          </div>

          {/* Right Column - State, Controls, Actions, Events */}
          <div>
            <BrowserStateCard
              state={state}
              loading={loading}
              error={error}
            />

            <BrowserControls
              session={state}
              browserId={browserId}
              onAction={refetch}
            />

            <BrowserActionsPanel
              browserId={browserId}
              onAction={refetch}
            />

            <BrowserEventsLog browserId={browserId} />
          </div>
        </div>
      </div>
    </Shell>
  )
}

export default BrowserDetailPage
