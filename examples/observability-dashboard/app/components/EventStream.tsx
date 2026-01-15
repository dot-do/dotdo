/**
 * EventStream Component - Real-time WebSocket event streaming
 *
 * Connects to EventStreamDO via WebSocket and displays live events.
 * Demonstrates:
 * - WebSocket connection management
 * - Reconnection with exponential backoff
 * - Event buffering and display
 * - Connection status indication
 */

import * as React from 'react'

interface EventStreamProps {
  /** Topics to subscribe to (supports wildcards like '*' or 'orders.*') */
  topics: string[]
  /** Callback when an event is received */
  onEvent?: (event: any) => void
  /** Maximum events to display (0 = unlimited) */
  maxEvents?: number
  /** Whether to show the event list */
  showEvents?: boolean
  /** WebSocket endpoint URL */
  endpoint?: string
}

type ConnectionStatus = 'connecting' | 'connected' | 'disconnected'

export function EventStream({
  topics,
  onEvent,
  maxEvents = 100,
  showEvents = true,
  endpoint = '/api/events',
}: EventStreamProps) {
  const [status, setStatus] = React.useState<ConnectionStatus>('disconnected')
  const [events, setEvents] = React.useState<any[]>([])
  const [error, setError] = React.useState<string | null>(null)

  const wsRef = React.useRef<WebSocket | null>(null)
  const reconnectAttempts = React.useRef(0)
  const reconnectTimeout = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  // Build WebSocket URL
  const getWebSocketUrl = React.useCallback(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const host = window.location.host
    const topicParams = topics.map(t => `topic=${encodeURIComponent(t)}`).join('&')
    return `${protocol}//${host}${endpoint}?${topicParams}`
  }, [endpoint, topics])

  // Connect to WebSocket
  const connect = React.useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return
    }

    setStatus('connecting')
    setError(null)

    try {
      const ws = new WebSocket(getWebSocketUrl())
      wsRef.current = ws

      ws.onopen = () => {
        setStatus('connected')
        reconnectAttempts.current = 0
        setError(null)
      }

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)

          // Handle system messages
          if (data.type === 'connected') {
            console.log('Connected to EventStreamDO:', data.connectionId)
            return
          }

          if (data.type === 'warning') {
            console.warn('EventStreamDO warning:', data.message)
            return
          }

          // Handle event
          if (onEvent) {
            onEvent(data)
          }

          if (showEvents && maxEvents > 0) {
            setEvents(prev => [data, ...prev].slice(0, maxEvents))
          }
        } catch (err) {
          console.error('Failed to parse event:', err)
        }
      }

      ws.onerror = () => {
        setError('WebSocket error')
      }

      ws.onclose = (event) => {
        setStatus('disconnected')
        wsRef.current = null

        // Reconnect with exponential backoff
        const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 30000)
        reconnectAttempts.current++

        reconnectTimeout.current = setTimeout(() => {
          connect()
        }, delay)
      }
    } catch (err) {
      setStatus('disconnected')
      setError('Failed to connect')
    }
  }, [getWebSocketUrl, onEvent, showEvents, maxEvents])

  // Connect on mount
  React.useEffect(() => {
    connect()

    return () => {
      if (reconnectTimeout.current) {
        clearTimeout(reconnectTimeout.current)
      }
      if (wsRef.current) {
        wsRef.current.close()
      }
    }
  }, [connect])

  // Format timestamp for display
  const formatTime = (timestamp: string | number) => {
    const date = typeof timestamp === 'number'
      ? new Date(timestamp)
      : new Date(timestamp)
    return date.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  }

  // Get event type badge class
  const getEventTypeClass = (event: any) => {
    const type = event.event_type || event.type || 'unknown'
    if (['trace', 'log', 'metric', 'cdc', 'track'].includes(type)) {
      return type
    }
    return ''
  }

  // Get display label for event
  const getEventLabel = (event: any) => {
    const type = event.event_type || event.type || 'event'
    const name = event.event_name || event.topic || ''
    if (name && name !== type) {
      return `${type}: ${name}`
    }
    return type
  }

  return (
    <div>
      {/* Connection Status */}
      <div className="connection-status">
        <span className={`status-dot ${status}`} />
        <span style={{ fontSize: '0.875rem', color: '#8b949e' }}>
          {status === 'connected' && 'Connected'}
          {status === 'connecting' && 'Connecting...'}
          {status === 'disconnected' && (error || 'Disconnected')}
        </span>
      </div>

      {/* Event List */}
      {showEvents && (
        <div className="event-list">
          {events.length === 0 && (
            <div className="event-item" style={{ color: '#8b949e' }}>
              Waiting for events...
            </div>
          )}
          {events.map((event, idx) => (
            <div key={event.id || idx} className="event-item">
              <span className="timestamp">
                {formatTime(event.timestamp)}
              </span>
              <span className={`event-type ${getEventTypeClass(event)}`}>
                {(event.event_type || event.type || 'event').toUpperCase()}
              </span>
              <span style={{ color: '#c9d1d9' }}>
                {getEventLabel(event)}
              </span>
              {event.service_name && (
                <span style={{ color: '#8b949e', marginLeft: '0.5rem' }}>
                  ({event.service_name})
                </span>
              )}
              {event.duration_ms && (
                <span style={{ color: '#8b949e', marginLeft: '0.5rem' }}>
                  {event.duration_ms}ms
                </span>
              )}
              {event.log_message && (
                <div style={{ marginTop: '0.25rem', color: '#8b949e', fontSize: '0.8125rem' }}>
                  {event.log_message.slice(0, 100)}{event.log_message.length > 100 ? '...' : ''}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
