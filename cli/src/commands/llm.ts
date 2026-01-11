/**
 * LLM Command
 *
 * Make LLM requests via llm.do (with streaming)
 *
 * Usage:
 *   do llm "Summarize this document"
 *   do llm "Hello" --model claude-sonnet
 *   do llm "Hello" --system "You are a helpful assistant"
 *   do llm "Hello" --max-tokens 100
 *   do llm "Hello" --temperature 0.7
 *   do llm "Hello" --no-stream
 *   do llm "Hello" --json
 */

import { parseArgs, requirePositional, getStringFlag, getBooleanFlag, getNumberFlag } from '../args'
import { llmRequest } from '../rpc'
import { formatJson, parseSSEStream } from '../output'
import { getConfig } from '../config'

// ============================================================================
// Types
// ============================================================================

interface LLMRequest {
  prompt: string
  model?: string
  system?: string
  max_tokens?: number
  temperature?: number
  stream?: boolean
}

interface LLMResponse {
  response: string
  model?: string
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}

// ============================================================================
// Command
// ============================================================================

export async function run(rawArgs: string[]): Promise<void> {
  const args = parseArgs(rawArgs)

  // Validate required arguments
  const prompt = requirePositional(args, 0, 'prompt')

  // Build request
  const config = await getConfig()
  // --no-stream sets flags['stream'] = false, so check for that
  const streamFlag = args.flags['stream']
  const stream = streamFlag !== false

  const request: LLMRequest = {
    prompt,
    stream,
  }

  const model = getStringFlag(args, 'model') ?? config.default_model
  if (model) {
    request.model = model
  }

  const system = getStringFlag(args, 'system')
  if (system) {
    request.system = system
  }

  const maxTokens = getNumberFlag(args, 'max-tokens')
  if (maxTokens !== undefined) {
    request.max_tokens = maxTokens
  }

  const temperature = getNumberFlag(args, 'temperature')
  if (temperature !== undefined) {
    request.temperature = temperature
  }

  // Handle streaming
  if (stream) {
    const responseStream = await llmRequest<ReadableStream<Uint8Array>>('/completions', {
      method: 'POST',
      body: request,
      stream: true,
    })

    // Stream output to stdout
    for await (const chunk of parseSSEStream(responseStream)) {
      process.stdout.write(chunk)
    }
    process.stdout.write('\n')
    return
  }

  // Non-streaming request
  const response = await llmRequest<LLMResponse>('/completions', {
    method: 'POST',
    body: request,
  })

  // Output result
  const jsonOutput = getBooleanFlag(args, 'json') || config.json_output

  if (jsonOutput) {
    console.log(formatJson(response))
  } else {
    console.log(response.response)
  }
}
