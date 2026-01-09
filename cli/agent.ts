/**
 * AI Agent with MCP Integration
 *
 * Provides AI SDK 6 ToolLoopAgent integration for CLI natural language processing.
 * Connects to Durable Object's MCP endpoint via HTTP transport.
 *
 * @see https://ai-sdk.dev/docs/agents/tool-loop-agent
 * @see https://modelcontextprotocol.io/docs/concepts/transports
 *
 * TODO: Implement in GREEN phase (see dotdo-i2fn)
 */

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
  _input: string,
  _doUrl: string,
  _config?: AgentConfig
): Promise<string> {
  // TODO: Implement in GREEN phase
  throw new Error('Not implemented: runAgent')
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
  _doUrl: string,
  _config?: AgentConfig
): Promise<{
  generate: (options: { prompt: string }) => Promise<{ text: string }>
  close: () => Promise<void>
}> {
  // TODO: Implement in GREEN phase
  throw new Error('Not implemented: createAgentWithMCP')
}
