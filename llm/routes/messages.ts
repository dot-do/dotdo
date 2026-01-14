/**
 * Anthropic-Compatible Messages Endpoint
 *
 * POST /v1/messages
 *
 * Provides full Anthropic API compatibility with multi-provider routing.
 *
 * @module llm/routes/messages
 */

import { Hono } from 'hono'
import type {
  LLMEnv,
  LLMRequestContext,
  AnthropicMessageRequest,
  AnthropicMessageResponse,
} from '../types'
import { createRouter } from '../router'
import { getProvider, findProviderForModel, anthropicAdapter } from '../providers'
import { createSSEResponse, anthropicEventsToSSE } from '../streaming'

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
  c.set('requestId', c.req.header('x-request-id') ?? `msg_${Date.now()}_${Math.random().toString(36).slice(2)}`)
  c.set('startTime', Date.now())
  await next()
})

/**
 * POST /v1/messages
 *
 * Anthropic-compatible messages endpoint
 */
app.post('/v1/messages', async (c) => {
  try {
    const body = await c.req.json<AnthropicMessageRequest>()

    // Validate request
    if (!body.model) {
      return c.json({
        type: 'error',
        error: {
          type: 'invalid_request_error',
          message: 'model is required',
        },
      }, 400)
    }

    if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
      return c.json({
        type: 'error',
        error: {
          type: 'invalid_request_error',
          message: 'messages is required and must be a non-empty array',
        },
      }, 400)
    }

    if (!body.max_tokens || body.max_tokens <= 0) {
      return c.json({
        type: 'error',
        error: {
          type: 'invalid_request_error',
          message: 'max_tokens is required and must be a positive integer',
        },
      }, 400)
    }

    // Create request context
    const ctx: LLMRequestContext = {
      requestId: c.get('requestId'),
      agentId: c.req.header('x-agent-id'),
      userId: c.req.header('x-user-id') ?? body.metadata?.user_id,
      tenantId: c.req.header('x-tenant-id'),
      startTime: c.get('startTime'),
    }

    // Route the model to the appropriate provider
    const router = createRouter()
    const route = router.route(body.model)

    // For Anthropic-compatible API, prefer using the Anthropic adapter directly
    // if the model is a Claude model, otherwise use the routed provider
    const isClaudeModel = body.model.toLowerCase().includes('claude')
    const provider = isClaudeModel
      ? anthropicAdapter
      : (getProvider(route.provider) ?? findProviderForModel(body.model, c.env))

    if (!provider) {
      return c.json({
        type: 'error',
        error: {
          type: 'invalid_request_error',
          message: `No provider available for model: ${body.model}`,
        },
      }, 400)
    }

    // Update model to provider-specific name
    const request: AnthropicMessageRequest = {
      ...body,
      model: isClaudeModel ? body.model : route.model,
    }

    // Handle streaming
    if (body.stream) {
      // Check if provider supports Anthropic streaming
      if (provider.streamAnthropicMessages) {
        const stream = provider.streamAnthropicMessages(request, c.env, ctx)
        const sseStream = anthropicEventsToSSE(stream)
        return createSSEResponse(sseStream)
      }

      // Fall back to non-streaming if provider doesn't support it
      console.warn(`Provider ${provider.name} does not support Anthropic streaming, falling back to non-streaming`)
    }

    // Non-streaming response
    if (provider.anthropicMessages) {
      const response = await provider.anthropicMessages(request, c.env, ctx)

      // Restore original model name
      response.model = body.model

      return c.json(response)
    }

    // If provider doesn't support native Anthropic format, this shouldn't happen
    // but return an error just in case
    return c.json({
      type: 'error',
      error: {
        type: 'api_error',
        message: `Provider ${provider.name} does not support Anthropic message format`,
      },
    }, 500)
  } catch (error) {
    console.error('Messages error:', error)

    const message = error instanceof Error ? error.message : 'Internal server error'
    const status = message.includes('API key') ? 401 : 500

    return c.json({
      type: 'error',
      error: {
        type: status === 401 ? 'authentication_error' : 'api_error',
        message,
      },
    }, status)
  }
})

/**
 * POST /v1/messages/count_tokens
 *
 * Count tokens for a message request (Anthropic compatibility)
 */
app.post('/v1/messages/count_tokens', async (c) => {
  try {
    const body = await c.req.json<AnthropicMessageRequest>()

    // Simple estimation based on character count
    // In production, you'd want to use tiktoken or similar
    const estimateTokens = (text: string): number => {
      // Rough estimate: ~4 characters per token for English
      return Math.ceil(text.length / 4)
    }

    let totalTokens = 0

    // Count system tokens
    if (body.system) {
      const systemText = typeof body.system === 'string'
        ? body.system
        : body.system.map((s) => s.text).join('\n')
      totalTokens += estimateTokens(systemText)
    }

    // Count message tokens
    for (const msg of body.messages) {
      if (typeof msg.content === 'string') {
        totalTokens += estimateTokens(msg.content)
      } else {
        for (const block of msg.content) {
          if (block.type === 'text') {
            totalTokens += estimateTokens(block.text)
          }
        }
      }
    }

    return c.json({
      input_tokens: totalTokens,
    })
  } catch (error) {
    console.error('Token counting error:', error)

    return c.json({
      type: 'error',
      error: {
        type: 'api_error',
        message: error instanceof Error ? error.message : 'Internal server error',
      },
    }, 500)
  }
})

export default app
