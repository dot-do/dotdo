/**
 * Log Viewer - Structured log aggregation
 *
 * Demonstrates:
 * - Real-time log streaming
 * - Log level filtering
 * - Search and filtering by service/message
 */

import { createFileRoute } from '@tanstack/react-router'
import * as React from 'react'
import { EventStream } from '../components/EventStream'

export const Route = createFileRoute('/logs')({
  component: LogViewer,
})

type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'all'

interface LogEvent {
  id: string
  event_type: 'log'
  event_name: string
  timestamp: string
  log_level: string
  log_message: string
  log_logger: string | null
  service_name: string | null
  trace_id: string | null
  span_id: string | null
}

function LogViewer() {
  const [logs, setLogs] = React.useState<LogEvent[]>([])
  const [levelFilter, setLevelFilter] = React.useState<LogLevel>('all')
  const [serviceFilter, setServiceFilter] = React.useState('')
  const [searchQuery, setSearchQuery] = React.useState('')
  const [isPaused, setIsPaused] = React.useState(false)

  // Fetch initial logs
  React.useEffect(() => {
    const fetchLogs = async () => {
      try {
        const res = await fetch('/api/query/unified', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            event_type: 'log',
            limit: 100,
          }),
        })
        if (res.ok) {
          const data = await res.json()
          setLogs(data.rows || [])
        }
      } catch {
        // Query endpoint may not be available in dev
      }
    }

    fetchLogs()
  }, [])

  // Handle new log events from stream
  const handleEvent = React.useCallback((event: any) => {
    if (isPaused) return
    if (event.event_type === 'log' || event.type === 'log') {
      setLogs(prev => [event, ...prev].slice(0, 500))
    }
  }, [isPaused])

  // Filter logs
  const filteredLogs = React.useMemo(() => {
    return logs.filter(log => {
      // Level filter
      if (levelFilter !== 'all' && log.log_level !== levelFilter) {
        return false
      }

      // Service filter
      if (serviceFilter && log.service_name !== serviceFilter) {
        return false
      }

      // Search query
      if (searchQuery) {
        const query = searchQuery.toLowerCase()
        const message = (log.log_message || '').toLowerCase()
        const logger = (log.log_logger || '').toLowerCase()
        if (!message.includes(query) && !logger.includes(query)) {
          return false
        }
      }

      return true
    })
  }, [logs, levelFilter, serviceFilter, searchQuery])

  // Get unique services for filter dropdown
  const services = React.useMemo(() => {
    const set = new Set(logs.map(l => l.service_name).filter(Boolean))
    return Array.from(set) as string[]
  }, [logs])

  // Format timestamp
  const formatTime = (ts: string) => {
    const date = new Date(ts)
    return date.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      fractionalSecondDigits: 3,
    })
  }

  return (
    <div>
      <h1>Log Viewer</h1>

      {/* Filters */}
      <div className="filter-bar">
        <select
          value={levelFilter}
          onChange={(e) => setLevelFilter(e.target.value as LogLevel)}
        >
          <option value="all">All Levels</option>
          <option value="debug">Debug</option>
          <option value="info">Info</option>
          <option value="warn">Warning</option>
          <option value="error">Error</option>
        </select>

        <select
          value={serviceFilter}
          onChange={(e) => setServiceFilter(e.target.value)}
        >
          <option value="">All Services</option>
          {services.map(service => (
            <option key={service} value={service}>{service}</option>
          ))}
        </select>

        <input
          type="text"
          placeholder="Search logs..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{ width: '300px' }}
        />

        <button
          className={isPaused ? '' : 'secondary'}
          onClick={() => setIsPaused(!isPaused)}
        >
          {isPaused ? 'Resume' : 'Pause'}
        </button>

        <button
          className="secondary"
          onClick={() => setLogs([])}
        >
          Clear
        </button>
      </div>

      {/* Log Stats */}
      <div className="grid" style={{ marginBottom: '1.5rem' }}>
        <div className="card" style={{ padding: '1rem' }}>
          <span className="log-level debug">DEBUG</span>
          <span style={{ marginLeft: '0.5rem' }}>
            {logs.filter(l => l.log_level === 'debug').length}
          </span>
        </div>
        <div className="card" style={{ padding: '1rem' }}>
          <span className="log-level info">INFO</span>
          <span style={{ marginLeft: '0.5rem' }}>
            {logs.filter(l => l.log_level === 'info').length}
          </span>
        </div>
        <div className="card" style={{ padding: '1rem' }}>
          <span className="log-level warn">WARN</span>
          <span style={{ marginLeft: '0.5rem' }}>
            {logs.filter(l => l.log_level === 'warn').length}
          </span>
        </div>
        <div className="card" style={{ padding: '1rem' }}>
          <span className="log-level error">ERROR</span>
          <span style={{ marginLeft: '0.5rem' }}>
            {logs.filter(l => l.log_level === 'error').length}
          </span>
        </div>
      </div>

      {/* Log Stream */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h2>Logs ({filteredLogs.length})</h2>
          <div className="connection-status">
            <EventStream
              topics={['log', 'logs', '*']}
              onEvent={handleEvent}
              maxEvents={0}
              showEvents={false}
            />
          </div>
        </div>

        <div className="event-list" style={{ maxHeight: '600px' }}>
          {filteredLogs.length === 0 && (
            <div className="event-item" style={{ color: '#8b949e' }}>
              No logs found. Adjust filters or send some log events.
            </div>
          )}
          {filteredLogs.map((log) => (
            <div key={log.id} className="event-item">
              <div style={{ display: 'flex', alignItems: 'flex-start' }}>
                <span className="timestamp" style={{ minWidth: '100px' }}>
                  {formatTime(log.timestamp)}
                </span>
                <span className={`log-level ${log.log_level}`}>
                  {log.log_level?.toUpperCase()}
                </span>
                {log.service_name && (
                  <span style={{ color: '#58a6ff', marginRight: '0.5rem', minWidth: '120px' }}>
                    [{log.service_name}]
                  </span>
                )}
                {log.log_logger && (
                  <span style={{ color: '#8b949e', marginRight: '0.5rem' }}>
                    {log.log_logger}:
                  </span>
                )}
                <span style={{ flex: 1 }}>{log.log_message}</span>
              </div>
              {log.trace_id && (
                <div style={{ marginTop: '0.25rem', marginLeft: '100px' }}>
                  <a
                    href={`/traces?trace_id=${log.trace_id}`}
                    style={{ color: '#58a6ff', fontSize: '0.75rem' }}
                  >
                    trace: {log.trace_id.slice(0, 16)}...
                  </a>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
