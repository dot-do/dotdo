/**
 * Code snippets for common Durable Object patterns
 *
 * - cache: Multi-layer caching (isolate + Cache API)
 * - events: Event normalizer (5W+H, EPCIS, Evalite) + ingest handler
 * - proxy: Config-driven edge proxy with policies
 */

export * from './cache'
export * from './events'
export * from './proxy'

// Re-export events ingest handler for workers.do/events
export { eventsIngestHandler } from './events'
