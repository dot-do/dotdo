/**
 * LLM.do API Routes
 *
 * Combines all LLM API routes into a single Hono app.
 *
 * @module llm/routes
 */

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import type { LLMEnv } from '../types'

import chatCompletions from './chat-completions'
import messages from './messages'

// ============================================================================
// Main Router
// ============================================================================

const app = new Hono<{ Bindings: LLMEnv }>()

// Global middleware
app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'x-api-key', 'anthropic-version', 'x-request-id', 'x-agent-id', 'x-user-id', 'x-tenant-id'],
  exposeHeaders: ['x-request-id'],
}))

// Logger in development
if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'development') {
  app.use('*', logger())
}

// Health check
app.get('/health', (c) => c.json({ status: 'ok', service: 'llm.do' }))

// API info
app.get('/', (c) => c.json({
  name: 'llm.do',
  version: '1.0.0',
  description: 'OpenAI and Anthropic compatible LLM routing service',
  endpoints: {
    openai: {
      'POST /v1/chat/completions': 'Chat completions (OpenAI format)',
      'GET /v1/models': 'List available models',
      'GET /v1/models/:model': 'Get model info',
    },
    anthropic: {
      'POST /v1/messages': 'Messages (Anthropic format)',
      'POST /v1/messages/count_tokens': 'Count tokens',
    },
  },
  providers: ['openai', 'anthropic', 'google', 'workers-ai', 'ollama'],
}))

// Mount route handlers
app.route('/', chatCompletions)
app.route('/', messages)

// 404 handler
app.notFound((c) => {
  return c.json({
    error: {
      message: `Not found: ${c.req.method} ${c.req.path}`,
      type: 'invalid_request_error',
      code: 'not_found',
    },
  }, 404)
})

// Error handler
app.onError((err, c) => {
  console.error('Unhandled error:', err)

  return c.json({
    error: {
      message: err.message || 'Internal server error',
      type: 'api_error',
      code: 'internal_error',
    },
  }, 500)
})

export default app

// Export individual route handlers for testing
export { chatCompletions, messages }
