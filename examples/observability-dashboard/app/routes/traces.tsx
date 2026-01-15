/**
 * Trace Explorer - Distributed tracing visualization
 *
 * Demonstrates:
 * - Querying traces by trace_id
 * - Waterfall visualization of spans
 * - Real-time trace updates
 */

import { createFileRoute } from '@tanstack/react-router'
import * as React from 'react'
import { TraceWaterfall } from '../components/TraceWaterfall'

export const Route = createFileRoute('/traces')({
  component: TraceExplorer,
})

interface Span {
  id: string
  trace_id: string
  span_id: string
  parent_id: string | null
  event_name: string
  service_name: string | null
  duration_ms: number | null
  started_at: string | null
  ended_at: string | null
  outcome: string | null
  http_method: string | null
  http_url: string | null
  http_status: number | null
}

interface Trace {
  trace_id: string
  spans: Span[]
  duration_ms: number
  service_count: number
  error_count: number
}

function TraceExplorer() {
  const [traceId, setTraceId] = React.useState('')
  const [traces, setTraces] = React.useState<Trace[]>([])
  const [selectedTrace, setSelectedTrace] = React.useState<Trace | null>(null)
  const [loading, setLoading] = React.useState(false)

  // Fetch recent traces
  React.useEffect(() => {
    const fetchTraces = async () => {
      try {
        const res = await fetch('/api/query/unified', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            event_type: 'trace',
            limit: 20,
          }),
        })
        if (res.ok) {
          const data = await res.json()
          // Group spans by trace_id
          const traceMap = new Map<string, Span[]>()
          for (const span of data.rows || []) {
            const tid = span.trace_id
            if (tid) {
              if (!traceMap.has(tid)) {
                traceMap.set(tid, [])
              }
              traceMap.get(tid)!.push(span)
            }
          }

          // Convert to Trace objects
          const traceList: Trace[] = []
          for (const [tid, spans] of traceMap) {
            const services = new Set(spans.map(s => s.service_name).filter(Boolean))
            const errors = spans.filter(s => s.outcome === 'error' || (s.http_status && s.http_status >= 400))
            const totalDuration = Math.max(...spans.map(s => s.duration_ms || 0))

            traceList.push({
              trace_id: tid,
              spans,
              duration_ms: totalDuration,
              service_count: services.size,
              error_count: errors.length,
            })
          }

          setTraces(traceList)
        }
      } catch {
        // Query endpoint may not be available in dev
      }
    }

    fetchTraces()
    const interval = setInterval(fetchTraces, 10000)
    return () => clearInterval(interval)
  }, [])

  // Search for specific trace
  const handleSearch = async () => {
    if (!traceId.trim()) return

    setLoading(true)
    try {
      const res = await fetch(`/api/query/trace?trace_id=${encodeURIComponent(traceId)}`)
      if (res.ok) {
        const data = await res.json()
        if (data.rows?.length > 0) {
          const spans = data.rows
          const services = new Set(spans.map((s: Span) => s.service_name).filter(Boolean))
          const errors = spans.filter((s: Span) =>
            s.outcome === 'error' || (s.http_status && s.http_status >= 400)
          )
          const totalDuration = Math.max(...spans.map((s: Span) => s.duration_ms || 0))

          setSelectedTrace({
            trace_id: traceId,
            spans,
            duration_ms: totalDuration,
            service_count: services.size,
            error_count: errors.length,
          })
        }
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <h1>Trace Explorer</h1>

      {/* Search Bar */}
      <div className="filter-bar">
        <input
          type="text"
          placeholder="Enter trace ID..."
          value={traceId}
          onChange={(e) => setTraceId(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          style={{ width: '400px' }}
        />
        <button onClick={handleSearch} disabled={loading}>
          {loading ? 'Searching...' : 'Search'}
        </button>
      </div>

      {/* Selected Trace Detail */}
      {selectedTrace && (
        <div className="card">
          <h2>Trace: {selectedTrace.trace_id.slice(0, 16)}...</h2>
          <div className="grid" style={{ marginBottom: '1rem' }}>
            <div>
              <span className="stat-label">Duration</span>
              <div style={{ fontSize: '1.25rem' }}>{selectedTrace.duration_ms}ms</div>
            </div>
            <div>
              <span className="stat-label">Spans</span>
              <div style={{ fontSize: '1.25rem' }}>{selectedTrace.spans.length}</div>
            </div>
            <div>
              <span className="stat-label">Services</span>
              <div style={{ fontSize: '1.25rem' }}>{selectedTrace.service_count}</div>
            </div>
            <div>
              <span className="stat-label">Errors</span>
              <div style={{ fontSize: '1.25rem', color: selectedTrace.error_count > 0 ? '#f85149' : 'inherit' }}>
                {selectedTrace.error_count}
              </div>
            </div>
          </div>
          <TraceWaterfall spans={selectedTrace.spans} totalDuration={selectedTrace.duration_ms} />
        </div>
      )}

      {/* Recent Traces List */}
      <div className="card">
        <h2>Recent Traces</h2>
        <div className="event-list">
          {traces.length === 0 && (
            <div className="event-item" style={{ color: '#8b949e' }}>
              No traces found. Send some trace events to see them here.
            </div>
          )}
          {traces.map((trace) => (
            <div
              key={trace.trace_id}
              className="event-item"
              style={{ cursor: 'pointer' }}
              onClick={() => setSelectedTrace(trace)}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <span style={{ color: '#58a6ff' }}>{trace.trace_id.slice(0, 16)}...</span>
                  <span style={{ marginLeft: '1rem', color: '#8b949e' }}>
                    {trace.spans.length} spans | {trace.service_count} services
                  </span>
                </div>
                <div>
                  <span style={{ marginRight: '1rem' }}>{trace.duration_ms}ms</span>
                  {trace.error_count > 0 && (
                    <span style={{ color: '#f85149' }}>{trace.error_count} errors</span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
