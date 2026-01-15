/**
 * Dashboard Home - Real-time observability overview
 *
 * Demonstrates:
 * - WebSocket connection to EventStreamDO
 * - Real-time event streaming with unified events
 * - Live statistics and event counts
 */

import { createFileRoute } from '@tanstack/react-router'
import * as React from 'react'
import { EventStream } from '../components/EventStream'

export const Route = createFileRoute('/')({
  component: Dashboard,
})

interface Stats {
  activeConnections: number
  messagesSent: number
  messagesPerSecond: number
  topicStats: Record<string, { subscribers: number }>
  eventCounts: {
    trace: number
    log: number
    metric: number
    cdc: number
    track: number
  }
}

function Dashboard() {
  const [stats, setStats] = React.useState<Stats>({
    activeConnections: 0,
    messagesSent: 0,
    messagesPerSecond: 0,
    topicStats: {},
    eventCounts: { trace: 0, log: 0, metric: 0, cdc: 0, track: 0 },
  })

  // Fetch stats periodically
  React.useEffect(() => {
    const fetchStats = async () => {
      try {
        const res = await fetch('/api/stats')
        if (res.ok) {
          const data = await res.json()
          setStats(prev => ({
            ...prev,
            activeConnections: data.activeConnections ?? prev.activeConnections,
            messagesSent: data.messagesSent ?? prev.messagesSent,
            messagesPerSecond: data.messagesPerSecond ?? prev.messagesPerSecond,
            topicStats: data.topicStats ?? prev.topicStats,
          }))
        }
      } catch {
        // Stats endpoint may not be available in dev
      }
    }

    fetchStats()
    const interval = setInterval(fetchStats, 5000)
    return () => clearInterval(interval)
  }, [])

  // Update event counts from stream
  const handleEvent = React.useCallback((event: any) => {
    const eventType = event.event_type || event.type
    if (eventType && ['trace', 'log', 'metric', 'cdc', 'track'].includes(eventType)) {
      setStats(prev => ({
        ...prev,
        eventCounts: {
          ...prev.eventCounts,
          [eventType]: prev.eventCounts[eventType as keyof typeof prev.eventCounts] + 1,
        },
      }))
    }
  }, [])

  return (
    <div>
      <h1>Observability Dashboard</h1>

      {/* Stats Grid */}
      <div className="grid">
        <div className="card">
          <div className="stat-value">{stats.activeConnections}</div>
          <div className="stat-label">Active Connections</div>
        </div>
        <div className="card">
          <div className="stat-value">{stats.messagesSent.toLocaleString()}</div>
          <div className="stat-label">Messages Sent</div>
        </div>
        <div className="card">
          <div className="stat-value">{stats.messagesPerSecond.toFixed(1)}/s</div>
          <div className="stat-label">Throughput</div>
        </div>
        <div className="card">
          <div className="stat-value">{Object.keys(stats.topicStats).length}</div>
          <div className="stat-label">Active Topics</div>
        </div>
      </div>

      {/* Event Type Breakdown */}
      <div className="card">
        <h2>Event Types</h2>
        <div className="grid">
          <div>
            <span className="event-type trace">TRACE</span>
            <span className="stat-value" style={{ fontSize: '1.5rem' }}>
              {stats.eventCounts.trace}
            </span>
          </div>
          <div>
            <span className="event-type log">LOG</span>
            <span className="stat-value" style={{ fontSize: '1.5rem' }}>
              {stats.eventCounts.log}
            </span>
          </div>
          <div>
            <span className="event-type metric">METRIC</span>
            <span className="stat-value" style={{ fontSize: '1.5rem' }}>
              {stats.eventCounts.metric}
            </span>
          </div>
          <div>
            <span className="event-type cdc">CDC</span>
            <span className="stat-value" style={{ fontSize: '1.5rem' }}>
              {stats.eventCounts.cdc}
            </span>
          </div>
          <div>
            <span className="event-type track">TRACK</span>
            <span className="stat-value" style={{ fontSize: '1.5rem' }}>
              {stats.eventCounts.track}
            </span>
          </div>
        </div>
      </div>

      {/* Live Event Stream */}
      <div className="card">
        <h2>Live Event Stream</h2>
        <EventStream
          topics={['*']}
          onEvent={handleEvent}
          maxEvents={50}
        />
      </div>
    </div>
  )
}
