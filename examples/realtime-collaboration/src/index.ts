/**
 * Real-time Collaboration Example
 *
 * Entry point for the Cloudflare Worker.
 * Routes requests to appropriate Durable Objects.
 */

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { DocumentDO } from './objects/DocumentDO'
import { PresenceDO } from './objects/PresenceDO'
import { ChannelDO } from './objects/ChannelDO'
import { WhiteboardDO } from './objects/WhiteboardDO'

// Re-export Durable Objects
export { DocumentDO, PresenceDO, ChannelDO, WhiteboardDO }

// ============================================================================
// Types
// ============================================================================

interface Env {
  DOCUMENT_DO: DurableObjectNamespace<DocumentDO>
  PRESENCE_DO: DurableObjectNamespace<PresenceDO>
  CHANNEL_DO: DurableObjectNamespace<ChannelDO>
  WHITEBOARD_DO: DurableObjectNamespace<WhiteboardDO>
  ENVIRONMENT?: string
}

// ============================================================================
// Worker
// ============================================================================

const app = new Hono<{ Bindings: Env }>()

// CORS middleware
app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'Upgrade', 'Connection'],
}))

// Health check
app.get('/', (c) => {
  return c.json({
    name: 'realtime-collaboration',
    version: '0.1.0',
    endpoints: {
      documents: '/document/:id',
      presence: '/presence/:roomId',
      channels: '/channel/:channelId',
      whiteboards: '/whiteboard/:boardId',
    },
  })
})

// ============================================================================
// Document Routes
// ============================================================================

app.all('/document/:id/*', async (c) => {
  const id = c.req.param('id')
  const stub = c.env.DOCUMENT_DO.get(c.env.DOCUMENT_DO.idFromName(id))

  // Forward request to DO
  const url = new URL(c.req.url)
  url.pathname = url.pathname.replace(`/document/${id}`, `/${id}`)

  return stub.fetch(new Request(url.toString(), c.req.raw))
})

app.all('/document/:id', async (c) => {
  const id = c.req.param('id')
  const stub = c.env.DOCUMENT_DO.get(c.env.DOCUMENT_DO.idFromName(id))

  const url = new URL(c.req.url)
  url.pathname = `/${id}`

  return stub.fetch(new Request(url.toString(), c.req.raw))
})

// ============================================================================
// Presence Routes
// ============================================================================

app.all('/presence/:roomId/*', async (c) => {
  const roomId = c.req.param('roomId')
  const stub = c.env.PRESENCE_DO.get(c.env.PRESENCE_DO.idFromName(roomId))

  const url = new URL(c.req.url)
  url.pathname = url.pathname.replace(`/presence/${roomId}`, `/${roomId}`)

  return stub.fetch(new Request(url.toString(), c.req.raw))
})

app.all('/presence/:roomId', async (c) => {
  const roomId = c.req.param('roomId')
  const stub = c.env.PRESENCE_DO.get(c.env.PRESENCE_DO.idFromName(roomId))

  const url = new URL(c.req.url)
  url.pathname = `/${roomId}`

  return stub.fetch(new Request(url.toString(), c.req.raw))
})

// ============================================================================
// Channel Routes
// ============================================================================

app.all('/channel/:channelId/*', async (c) => {
  const channelId = c.req.param('channelId')
  const stub = c.env.CHANNEL_DO.get(c.env.CHANNEL_DO.idFromName(channelId))

  const url = new URL(c.req.url)
  url.pathname = url.pathname.replace(`/channel/${channelId}`, `/${channelId}`)

  return stub.fetch(new Request(url.toString(), c.req.raw))
})

app.all('/channel/:channelId', async (c) => {
  const channelId = c.req.param('channelId')
  const stub = c.env.CHANNEL_DO.get(c.env.CHANNEL_DO.idFromName(channelId))

  const url = new URL(c.req.url)
  url.pathname = `/${channelId}`

  return stub.fetch(new Request(url.toString(), c.req.raw))
})

// ============================================================================
// Whiteboard Routes
// ============================================================================

app.all('/whiteboard/:boardId/*', async (c) => {
  const boardId = c.req.param('boardId')
  const stub = c.env.WHITEBOARD_DO.get(c.env.WHITEBOARD_DO.idFromName(boardId))

  const url = new URL(c.req.url)
  url.pathname = url.pathname.replace(`/whiteboard/${boardId}`, `/${boardId}`)

  return stub.fetch(new Request(url.toString(), c.req.raw))
})

app.all('/whiteboard/:boardId', async (c) => {
  const boardId = c.req.param('boardId')
  const stub = c.env.WHITEBOARD_DO.get(c.env.WHITEBOARD_DO.idFromName(boardId))

  const url = new URL(c.req.url)
  url.pathname = `/${boardId}`

  return stub.fetch(new Request(url.toString(), c.req.raw))
})

// ============================================================================
// API Info
// ============================================================================

app.get('/api/info', (c) => {
  return c.json({
    name: 'Real-time Collaboration',
    description: 'Collaborative editing with Durable Objects',
    features: [
      'CRDT-based text editing',
      'User presence tracking',
      'Cursor synchronization',
      'Real-time messaging',
      'Whiteboard collaboration',
      'WebSocket hibernation',
      'Automatic reconnection',
      'Offline support',
    ],
    durableObjects: [
      {
        name: 'DocumentDO',
        description: 'Collaborative document with CRDT-based editing',
        routes: ['/document/:id'],
      },
      {
        name: 'PresenceDO',
        description: 'User presence and cursor tracking',
        routes: ['/presence/:roomId'],
      },
      {
        name: 'ChannelDO',
        description: 'Real-time messaging channels',
        routes: ['/channel/:channelId'],
      },
      {
        name: 'WhiteboardDO',
        description: 'Visual collaboration whiteboard',
        routes: ['/whiteboard/:boardId'],
      },
    ],
  })
})

// 404 handler
app.notFound((c) => {
  return c.json({ error: 'Not Found' }, 404)
})

// Error handler
app.onError((err, c) => {
  console.error('Error:', err)
  return c.json({ error: err.message }, 500)
})

export default app
