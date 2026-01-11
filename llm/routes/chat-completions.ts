/**
 * OpenAI-Compatible Chat Completions Endpoint
 *
 * POST /v1/chat/completions
 *
 * Provides full OpenAI API compatibility with multi-provider routing.
 *
 * @module llm/routes/chat-completions
 */

import { Hono } from 'hono'
import type {
  LLMEnv,
  LLMRequestContext,
  OpenAIChatCompletionRequest,
  OpenAIChatCompletionResponse,
} from '../types'
import { ModelRouter, createRouter } from '../router'
import { findProviderForModel, getProvider } from '../providers'
import { createSSEResponse, openAIChunksToSSE } from '../streaming'

// ============================================================================
// Types
// ============================================================================

type Bindings = LLMEnv

interface Variables {
  requestId: string
  startTime: number
}

// ============================================================================
// Route Handler
// ============================================================================

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// Request ID middleware
app.use('*', async (c, next) => {
  c.set('requestId', c.req.header('x-request-id') ?? `req_${Date.now()}_${Math.random().toString(36).slice(2)}`)
  c.set('startTime', Date.now())
  await next()
})

/**
 * POST /v1/chat/completions
 *
 * OpenAI-compatible chat completion endpoint
 */
app.post('/v1/chat/completions', async (c) => {
  try {
    const body = await c.req.json<OpenAIChatCompletionRequest>()

    // Validate request
    if (!body.model) {
      return c.json({
        error: {
          message: 'model is required',
          type: 'invalid_request_error',
          param: 'model',
          code: 'missing_required_parameter',
        },
      }, 400)
    }

    if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
      return c.json({
        error: {
          message: 'messages is required and must be a non-empty array',
          type: 'invalid_request_error',
          param: 'messages',
          code: 'missing_required_parameter',
        },
      }, 400)
    }

    // Create request context
    const ctx: LLMRequestContext = {
      requestId: c.get('requestId'),
      agentId: c.req.header('x-agent-id'),
      userId: c.req.header('x-user-id'),
      tenantId: c.req.header('x-tenant-id'),
      startTime: c.get('startTime'),
    }

    // Route the model to the appropriate provider
    const router = createRouter()
    const route = router.route(body.model)

    // Get the provider adapter
    const provider = getProvider(route.provider) ?? findProviderForModel(body.model, c.env)
    if (!provider) {
      return c.json({
        error: {
          message: `No provider available for model: ${body.model}`,
          type: 'invalid_request_error',
          param: 'model',
          code: 'model_not_found',
        },
      }, 400)
    }

    // Update model to provider-specific name
    const request: OpenAIChatCompletionRequest = {
      ...body,
      model: route.model,
    }

    // Handle streaming
    if (body.stream) {
      const stream = provider.streamChatCompletion(request, c.env, ctx)
      const sseStream = openAIChunksToSSE(stream)
      return createSSEResponse(sseStream)
    }

    // Non-streaming response
    const response = await provider.chatCompletion(request, c.env, ctx)

    // Restore original model name in response
    response.model = body.model

    return c.json(response)
  } catch (error) {
    console.error('Chat completion error:', error)

    const message = error instanceof Error ? error.message : 'Internal server error'
    const status = message.includes('API key') ? 401 : 500

    return c.json({
      error: {
        message,
        type: status === 401 ? 'authentication_error' : 'api_error',
        code: status === 401 ? 'invalid_api_key' : 'internal_error',
      },
    }, status)
  }
})

/**
 * GET /v1/models
 *
 * List available models
 */
app.get('/v1/models', (c) => {
  const router = createRouter()
  const models = router.getAllModels()

  return c.json({
    object: 'list',
    data: models.map((id) => ({
      id,
      object: 'model',
      created: 1686935002,
      owned_by: 'llm.do',
    })),
  })
})

/**
 * GET /v1/models/:model
 *
 * Get a specific model
 */
app.get('/v1/models/:model', (c) => {
  const modelId = c.req.param('model')
  const router = createRouter()
  const models = router.getAllModels()

  if (!models.includes(modelId)) {
    return c.json({
      error: {
        message: `Model '${modelId}' not found`,
        type: 'invalid_request_error',
        param: 'model',
        code: 'model_not_found',
      },
    }, 404)
  }

  const route = router.route(modelId)

  return c.json({
    id: modelId,
    object: 'model',
    created: 1686935002,
    owned_by: route.provider,
  })
})

export default app
