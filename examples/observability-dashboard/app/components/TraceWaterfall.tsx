/**
 * TraceWaterfall Component - Distributed trace visualization
 *
 * Renders a waterfall diagram showing the timeline of spans in a trace.
 * Demonstrates:
 * - Hierarchical span visualization
 * - Duration-based bar rendering
 * - Parent-child relationships
 * - Error highlighting
 */

import * as React from 'react'

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

interface TraceWaterfallProps {
  /** Spans in the trace */
  spans: Span[]
  /** Total trace duration in ms */
  totalDuration: number
}

interface SpanNode {
  span: Span
  children: SpanNode[]
  depth: number
  startOffset: number // ms from trace start
}

export function TraceWaterfall({ spans, totalDuration }: TraceWaterfallProps) {
  // Build span tree
  const spanTree = React.useMemo(() => {
    if (spans.length === 0) return []

    // Find the earliest start time
    const startTimes = spans
      .filter(s => s.started_at)
      .map(s => new Date(s.started_at!).getTime())
    const traceStart = startTimes.length > 0 ? Math.min(...startTimes) : Date.now()

    // Build lookup maps
    const spanMap = new Map<string, Span>()
    const childrenMap = new Map<string, Span[]>()

    for (const span of spans) {
      spanMap.set(span.span_id, span)
      if (span.parent_id) {
        if (!childrenMap.has(span.parent_id)) {
          childrenMap.set(span.parent_id, [])
        }
        childrenMap.get(span.parent_id)!.push(span)
      }
    }

    // Find root spans (no parent or parent not in trace)
    const roots = spans.filter(s =>
      !s.parent_id || !spanMap.has(s.parent_id)
    )

    // Build tree recursively
    function buildNode(span: Span, depth: number): SpanNode {
      const startTime = span.started_at
        ? new Date(span.started_at).getTime()
        : traceStart
      const startOffset = startTime - traceStart

      const children = (childrenMap.get(span.span_id) || [])
        .sort((a, b) => {
          const aStart = a.started_at ? new Date(a.started_at).getTime() : 0
          const bStart = b.started_at ? new Date(b.started_at).getTime() : 0
          return aStart - bStart
        })
        .map(child => buildNode(child, depth + 1))

      return {
        span,
        children,
        depth,
        startOffset,
      }
    }

    // Sort roots by start time
    roots.sort((a, b) => {
      const aStart = a.started_at ? new Date(a.started_at).getTime() : 0
      const bStart = b.started_at ? new Date(b.started_at).getTime() : 0
      return aStart - bStart
    })

    return roots.map(root => buildNode(root, 0))
  }, [spans])

  // Flatten tree for rendering
  const flatSpans = React.useMemo(() => {
    const result: SpanNode[] = []

    function flatten(node: SpanNode) {
      result.push(node)
      for (const child of node.children) {
        flatten(child)
      }
    }

    for (const root of spanTree) {
      flatten(root)
    }

    return result
  }, [spanTree])

  // Calculate bar position and width
  const getBarStyle = (node: SpanNode) => {
    const duration = node.span.duration_ms || 1
    const left = totalDuration > 0 ? (node.startOffset / totalDuration) * 100 : 0
    const width = totalDuration > 0 ? (duration / totalDuration) * 100 : 1

    return {
      left: `${Math.max(0, left)}%`,
      width: `${Math.max(0.5, width)}%`,
    }
  }

  // Determine if span has error
  const hasError = (span: Span) => {
    return span.outcome === 'error' ||
      (span.http_status != null && span.http_status >= 400)
  }

  // Get span display name
  const getSpanName = (span: Span) => {
    if (span.http_method && span.http_url) {
      const path = span.http_url.startsWith('http')
        ? new URL(span.http_url).pathname
        : span.http_url
      return `${span.http_method} ${path}`
    }
    return span.event_name || span.span_id.slice(0, 8)
  }

  if (flatSpans.length === 0) {
    return (
      <div className="trace-waterfall" style={{ color: '#8b949e', padding: '1rem' }}>
        No spans to display
      </div>
    )
  }

  return (
    <div className="trace-waterfall">
      {/* Timeline header */}
      <div style={{ display: 'flex', marginBottom: '0.5rem', paddingLeft: '200px' }}>
        <div style={{ flex: 1, display: 'flex', justifyContent: 'space-between', color: '#8b949e', fontSize: '0.75rem' }}>
          <span>0ms</span>
          <span>{Math.round(totalDuration / 4)}ms</span>
          <span>{Math.round(totalDuration / 2)}ms</span>
          <span>{Math.round(totalDuration * 3 / 4)}ms</span>
          <span>{totalDuration}ms</span>
        </div>
        <div style={{ width: '80px' }} />
      </div>

      {/* Span rows */}
      {flatSpans.map((node) => (
        <div key={node.span.span_id} className="span-row">
          {/* Span name with indentation */}
          <div
            className="span-name"
            style={{ paddingLeft: `${node.depth * 16}px` }}
            title={getSpanName(node.span)}
          >
            {node.span.service_name && (
              <span style={{ color: '#58a6ff', marginRight: '0.5rem' }}>
                {node.span.service_name}
              </span>
            )}
            {getSpanName(node.span)}
          </div>

          {/* Bar container */}
          <div className="span-bar-container">
            <div
              className={`span-bar ${hasError(node.span) ? 'error' : 'success'}`}
              style={getBarStyle(node)}
              title={`${node.span.duration_ms || 0}ms`}
            />
          </div>

          {/* Duration */}
          <div className="span-duration">
            {node.span.duration_ms != null ? `${node.span.duration_ms}ms` : '-'}
          </div>
        </div>
      ))}
    </div>
  )
}
