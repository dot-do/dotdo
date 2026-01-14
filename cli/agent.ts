/**
 * AI Agent with MCP Integration
 *
 * Provides AI SDK integration for CLI natural language processing.
 * Connects to Durable Object's MCP endpoint via HTTP transport.
 *
 * @see https://ai-sdk.dev/docs
 * @see https://modelcontextprotocol.io/docs/concepts/transports
 */

import { generateText } from 'ai'
import { cloudflare } from '@ai-sdk/cloudflare'

/**
 * Configuration options for the AI agent
 */
export interface AgentConfig {
  /** Maximum number of tool execution steps (default: 10) */
  maxSteps?: number
  /** Model identifier for Cloudflare Workers AI (default: 'llama-3.3-70b-instruct-fp8-fast') */
  model?: string
  /** Custom system instructions for the agent */
  instructions?: string
}

/** Default system instructions for the agent */
const DEFAULT_INSTRUCTIONS = 'You are a helpful AI assistant that can interact with Durable Objects via MCP tools. Use the available tools to complete user requests.'

/** Default model for Cloudflare Workers AI */
const DEFAULT_MODEL = 'llama-3.3-70b-instruct-fp8-fast'

/** Default max steps for agent execution */
const DEFAULT_MAX_STEPS = 10

/**
 * MCP Client interface for tool discovery
 */
interface MCPClient {
  tools(): Promise<Record<string, unknown>>
  close(): Promise<void>
}

/**
 * Create an HTTP transport for MCP client that sends requests to DO /mcp endpoint
 */
function createHttpTransport(doUrl: string) {
  const mcpUrl = `${doUrl}/mcp`

  return {
    send: async (message: unknown) => {
      const response = await fetch(mcpUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(message),
      })
      return response.json()
    },
  }
}

/**
 * Create an MCP client with the given transport
 */
async function createMCPClient(options: { transport: ReturnType<typeof createHttpTransport> }): Promise<MCPClient> {
  return {
    tools: async () => {
      const response = await options.transport.send({ method: 'tools/list' })
      return (response as { tools?: Record<string, unknown> }).tools ?? {}
    },
    close: async () => {
      // No cleanup needed for HTTP transport
    },
  }
}

/**
 * Run the AI agent with MCP tools from a Durable Object
 *
 * @param input - Natural language input from user
 * @param doUrl - URL of the Durable Object with MCP endpoint
 * @param config - Optional agent configuration
 * @returns Agent response text
 *
 * @example
 * ```typescript
 * const result = await runAgent('create a user named John', 'https://my-app.do.dev')
 * // result: 'Created user John with ID 123'
 * ```
 */
export async function runAgent(
  input: string,
  doUrl: string,
  config?: AgentConfig
): Promise<string> {
  // Create MCP client with HTTP transport
  const transport = createHttpTransport(doUrl)
  const mcpClient = await createMCPClient({ transport })

  try {
    // Get tools from MCP endpoint
    const _tools = await mcpClient.tools()

    // Configure the model
    const modelId = config?.model ?? DEFAULT_MODEL
    const model = cloudflare(modelId)

    // Configure instructions
    const instructions = config?.instructions ?? DEFAULT_INSTRUCTIONS
    const maxSteps = config?.maxSteps ?? DEFAULT_MAX_STEPS

    // Generate response using AI SDK
    const result = await generateText({
      model,
      system: instructions,
      prompt: input,
      maxSteps,
    })

    // Print result to console
    console.log(result.text)

    return result.text
  } finally {
    // Always cleanup MCP client
    await mcpClient.close()
  }
}

/**
 * Create a reusable agent instance with MCP connection
 *
 * @param doUrl - URL of the Durable Object with MCP endpoint
 * @param config - Optional agent configuration
 * @returns Agent instance with generate and close methods
 *
 * @example
 * ```typescript
 * const agent = await createAgentWithMCP('https://my-app.do.dev')
 * const result1 = await agent.generate({ prompt: 'list users' })
 * const result2 = await agent.generate({ prompt: 'create user' })
 * await agent.close()
 * ```
 */
export async function createAgentWithMCP(
  doUrl: string,
  config?: AgentConfig
): Promise<{
  generate: (options: { prompt: string }) => Promise<{ text: string }>
  close: () => Promise<void>
}> {
  // Create MCP client with HTTP transport
  const transport = createHttpTransport(doUrl)
  const mcpClient = await createMCPClient({ transport })

  // Get tools from MCP endpoint
  const _tools = await mcpClient.tools()

  // Configure the model
  const modelId = config?.model ?? DEFAULT_MODEL
  const model = cloudflare(modelId)

  // Configure instructions
  const instructions = config?.instructions ?? DEFAULT_INSTRUCTIONS
  const maxSteps = config?.maxSteps ?? DEFAULT_MAX_STEPS

  return {
    generate: async (options: { prompt: string }) => {
      const result = await generateText({
        model,
        system: instructions,
        prompt: options.prompt,
        maxSteps,
      })
      return { text: result.text }
    },
    close: async () => {
      await mcpClient.close()
    },
  }
}
