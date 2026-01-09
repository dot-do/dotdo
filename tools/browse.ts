/**
 * Browse Tools for AgenticFunctionExecutor
 *
 * Provides browser automation tools that integrate with the Browser DO
 * for web automation tasks via Stagehand primitives.
 *
 * Tools:
 * - browseTool: Navigate to URL
 * - actTool: Execute natural language action
 * - extractTool: Pull structured data
 * - observeTool: Discover available actions
 * - screenshotTool: Capture page
 * - closeBrowserTool: End session
 */

import type {
  ToolDefinition,
  AgentContext,
} from '../objects/AgenticFunctionExecutor'

// ============================================================================
// CONSTANTS
// ============================================================================

const BROWSER_SESSION_KEY = 'browser:sessionId'
const BROWSER_DO_BASE_URL = '/api/browser' // Assumes routing through same worker

// ============================================================================
// ERROR CLASSES
// ============================================================================

export class BrowserToolError extends Error {
  constructor(
    public toolName: string,
    public sessionId: string | null,
    message: string,
    public cause?: Error
  ) {
    super(`[${toolName}] ${message}${sessionId ? ` (session: ${sessionId})` : ''}`)
    this.name = 'BrowserToolError'
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Validates a URL string
 */
function isValidUrl(value: string): boolean {
  try {
    new URL(value)
    return true
  } catch {
    return false
  }
}

/**
 * Gets or creates a browser session
 */
async function ensureSession(ctx: AgentContext): Promise<string> {
  // Check for existing session
  const existingSession = await ctx.state.get<string>(BROWSER_SESSION_KEY)
  if (existingSession) {
    return existingSession
  }

  // Create new session
  const response = await fetch(`${BROWSER_DO_BASE_URL}/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    throw new BrowserToolError(
      'session',
      null,
      `Failed to create session: ${response.status} ${response.statusText}. ${(errorData as Record<string, unknown>).error || 'Service unavailable or exhausted'}`
    )
  }

  const data = (await response.json()) as {
    success: boolean
    sessionId?: string
    error?: string
  }

  if (!data.success || !data.sessionId) {
    throw new BrowserToolError(
      'session',
      null,
      `Session creation failed: ${data.error || 'Unknown error'}`
    )
  }

  // Store session ID
  await ctx.state.set(BROWSER_SESSION_KEY, data.sessionId)

  return data.sessionId
}

/**
 * Makes a request to the Browser DO
 */
async function browserRequest<T>(
  ctx: AgentContext,
  toolName: string,
  endpoint: string,
  body: Record<string, unknown> = {}
): Promise<T> {
  const sessionId = await ensureSession(ctx)

  try {
    const response = await fetch(
      `${BROWSER_DO_BASE_URL}/${sessionId}${endpoint}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }
    )

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new BrowserToolError(
        toolName,
        sessionId,
        `Browser DO error: ${response.status} ${response.statusText}. ${(errorData as Record<string, unknown>).error || ''}`
      )
    }

    return (await response.json()) as T
  } catch (error) {
    if (error instanceof BrowserToolError) {
      ctx.log.error(`${toolName} error`, { error: error.message, sessionId })
      throw error
    }

    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error'
    ctx.log.error(`${toolName} error`, { error: errorMessage, sessionId })
    throw new BrowserToolError(toolName, sessionId, errorMessage, error as Error)
  }
}

// ============================================================================
// BROWSE TOOL - Navigate to URL
// ============================================================================

interface BrowseResult {
  success: boolean
  currentUrl?: string
  title?: string
  error?: string
}

export const browseTool: ToolDefinition = {
  name: 'browse',
  description:
    'Navigate to a URL in the browser. Opens the page and returns the current URL and page title.',
  parameters: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'The URL to navigate to',
      },
    },
    required: ['url'],
  },
  execute: async (
    params: Record<string, unknown>,
    ctx: AgentContext
  ): Promise<BrowseResult> => {
    const url = params.url as string | undefined

    // Validate URL parameter
    if (!url) {
      throw new BrowserToolError(
        'browse',
        await ctx.state.get<string>(BROWSER_SESSION_KEY),
        'url is required'
      )
    }

    if (!isValidUrl(url)) {
      throw new BrowserToolError(
        'browse',
        await ctx.state.get<string>(BROWSER_SESSION_KEY),
        'url must be a valid URL'
      )
    }

    return browserRequest<BrowseResult>(ctx, 'browse', '/navigate', { url })
  },
}

// ============================================================================
// ACT TOOL - Execute natural language action
// ============================================================================

interface ActResult {
  success: boolean
  action?: string
  element?: string
  text?: string
  error?: string
}

export const actTool: ToolDefinition = {
  name: 'act',
  description:
    'Execute a natural language action in the browser. For example: "Click the submit button" or "Type hello in the search field".',
  parameters: {
    type: 'object',
    properties: {
      instruction: {
        type: 'string',
        description:
          'Natural language instruction for the action to perform',
      },
    },
    required: ['instruction'],
  },
  execute: async (
    params: Record<string, unknown>,
    ctx: AgentContext
  ): Promise<ActResult> => {
    const instruction = params.instruction as string | undefined

    // Validate instruction parameter
    if (instruction === undefined || instruction === null) {
      throw new BrowserToolError(
        'act',
        await ctx.state.get<string>(BROWSER_SESSION_KEY),
        'instruction is required'
      )
    }

    if (instruction.trim() === '') {
      throw new BrowserToolError(
        'act',
        await ctx.state.get<string>(BROWSER_SESSION_KEY),
        'instruction is empty'
      )
    }

    return browserRequest<ActResult>(ctx, 'act', '/act', { instruction })
  },
}

// ============================================================================
// EXTRACT TOOL - Pull structured data
// ============================================================================

interface ExtractResult {
  success: boolean
  data?: unknown
  error?: string
}

export const extractTool: ToolDefinition = {
  name: 'extract',
  description:
    'Extract structured data from the current page. Provide an instruction and optionally a JSON schema for the expected data format.',
  parameters: {
    type: 'object',
    properties: {
      instruction: {
        type: 'string',
        description: 'What data to extract from the page',
      },
      schema: {
        type: 'object',
        description: 'Optional JSON schema for the expected data structure',
      },
    },
    required: ['instruction'],
  },
  execute: async (
    params: Record<string, unknown>,
    ctx: AgentContext
  ): Promise<ExtractResult> => {
    const instruction = params.instruction as string | undefined
    const schema = params.schema as Record<string, unknown> | undefined

    // Validate instruction parameter
    if (!instruction) {
      throw new BrowserToolError(
        'extract',
        await ctx.state.get<string>(BROWSER_SESSION_KEY),
        'instruction is required'
      )
    }

    return browserRequest<ExtractResult>(ctx, 'extract', '/extract', {
      instruction,
      schema,
    })
  },
}

// ============================================================================
// OBSERVE TOOL - Discover available actions
// ============================================================================

interface ObserveAction {
  type: string
  selector: string
  description: string
}

interface ObserveResult {
  success: boolean
  actions: ObserveAction[]
  error?: string
}

export const observeTool: ToolDefinition = {
  name: 'observe',
  description:
    'Observe the current page and discover available actions. Returns a list of actionable elements like buttons, links, and input fields.',
  parameters: {
    type: 'object',
    properties: {
      instruction: {
        type: 'string',
        description:
          'Optional instruction to filter observations (e.g., "Find login related elements")',
      },
    },
  },
  execute: async (
    params: Record<string, unknown>,
    ctx: AgentContext
  ): Promise<ObserveResult> => {
    const instruction = params.instruction as string | undefined

    return browserRequest<ObserveResult>(ctx, 'observe', '/observe', {
      instruction,
    })
  },
}

// ============================================================================
// SCREENSHOT TOOL - Capture page
// ============================================================================

interface ScreenshotResult {
  success: boolean
  screenshot?: string
  format?: string
  fullPage?: boolean
  selector?: string
  error?: string
}

export const screenshotTool: ToolDefinition = {
  name: 'screenshot',
  description:
    'Capture a screenshot of the current page. Returns a base64 encoded PNG image.',
  parameters: {
    type: 'object',
    properties: {
      fullPage: {
        type: 'boolean',
        description: 'Capture the full scrollable page (default: false)',
      },
      selector: {
        type: 'string',
        description: 'CSS selector for a specific element to capture',
      },
    },
  },
  execute: async (
    params: Record<string, unknown>,
    ctx: AgentContext
  ): Promise<ScreenshotResult> => {
    const fullPage = params.fullPage as boolean | undefined
    const selector = params.selector as string | undefined

    // Validate selector if provided
    if (selector !== undefined && selector.trim() === '') {
      throw new BrowserToolError(
        'screenshot',
        await ctx.state.get<string>(BROWSER_SESSION_KEY),
        'selector cannot be empty'
      )
    }

    return browserRequest<ScreenshotResult>(ctx, 'screenshot', '/screenshot', {
      fullPage,
      selector,
    })
  },
}

// ============================================================================
// CLOSE BROWSER TOOL - End session
// ============================================================================

interface CloseResult {
  success: boolean
  sessionId?: string
  status?: string
  message?: string
  error?: string
}

export const closeBrowserTool: ToolDefinition = {
  name: 'closeBrowser',
  description:
    'Close the current browser session and free up resources.',
  parameters: {
    type: 'object',
    properties: {},
  },
  execute: async (
    _params: Record<string, unknown>,
    ctx: AgentContext
  ): Promise<CloseResult> => {
    const sessionId = await ctx.state.get<string>(BROWSER_SESSION_KEY)

    // If no session exists, return success with message
    if (!sessionId) {
      return {
        success: true,
        message: 'No active browser session to close',
      }
    }

    try {
      const response = await fetch(`${BROWSER_DO_BASE_URL}/${sessionId}/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new BrowserToolError(
          'closeBrowser',
          sessionId,
          `Failed to close session: ${response.status}. ${(errorData as Record<string, unknown>).error || ''}`
        )
      }

      const data = (await response.json()) as CloseResult

      // Clear session from state
      await ctx.state.delete(BROWSER_SESSION_KEY)

      return {
        success: true,
        sessionId,
        status: data.status || 'stopped',
      }
    } catch (error) {
      if (error instanceof BrowserToolError) {
        ctx.log.error('closeBrowser error', {
          error: error.message,
          sessionId,
        })
        throw error
      }

      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error'
      ctx.log.error('closeBrowser error', { error: errorMessage, sessionId })
      throw new BrowserToolError(
        'closeBrowser',
        sessionId,
        errorMessage,
        error as Error
      )
    }
  },
}

// ============================================================================
// EXPORTS
// ============================================================================

/**
 * All browse tools as a record for easy registration with AgenticFunctionExecutor
 */
export const browseTools: Record<string, ToolDefinition> = {
  browse: browseTool,
  act: actTool,
  extract: extractTool,
  observe: observeTool,
  screenshot: screenshotTool,
  closeBrowser: closeBrowserTool,
}

export default browseTools
