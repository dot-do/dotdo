/**
 * MCP Stateful Shell Server
 *
 * Provides persistent shell sessions for AI agents via MCP.
 * "SSH for AI agents" - session state persists across MCP requests.
 *
 * Features:
 * - Session ID persists across requests
 * - Working directory, env vars, history persist
 * - cd in one request affects pwd in next
 * - Session reconnection with full state recovery
 *
 * @module bashx/mcp/stateful-shell
 */

import { handleBash } from './index.js'
import type { BashResult } from '../types.js'

// ============================================================================
// Types
// ============================================================================

/**
 * Input for execute_command tool
 */
export interface ExecuteCommandInput {
  /** Command to execute */
  command: string
  /** Session ID - creates new if not provided */
  sessionId?: string
  /** Timeout in milliseconds */
  timeout?: number
  /** Confirm dangerous operations */
  confirm?: boolean
}

/**
 * Output from execute_command tool
 */
export interface ExecuteCommandOutput {
  /** Standard output */
  stdout: string
  /** Standard error */
  stderr: string
  /** Exit code */
  exitCode: number
  /** Session ID for reconnection */
  sessionId: string
  /** Current working directory after command */
  cwd: string
  /** Execution duration in milliseconds */
  duration: number
  /** Whether command was blocked */
  blocked?: boolean
  /** Reason for blocking */
  blockReason?: string
}

/**
 * Session state output
 */
export interface SessionStateOutput {
  /** Session ID */
  sessionId: string
  /** Current working directory */
  cwd: string
  /** Environment variables */
  env: Record<string, string>
  /** Command history (recent commands) */
  history: string[]
  /** Session creation timestamp */
  createdAt: number
  /** Last command timestamp */
  lastCommandAt: number
  /** Number of commands executed */
  commandCount: number
}

/**
 * Internal session state
 */
interface ShellSession {
  /** Session ID */
  id: string
  /** Current working directory */
  cwd: string
  /** Environment variables */
  env: Record<string, string>
  /** Command history */
  history: CommandRecord[]
  /** Session creation timestamp */
  createdAt: number
  /** Last command timestamp */
  lastCommandAt: number
}

/**
 * Command record in history
 */
interface CommandRecord {
  /** Command executed */
  command: string
  /** Exit code */
  exitCode: number
  /** Execution timestamp */
  timestamp: number
  /** Duration in ms */
  duration: number
}

// ============================================================================
// Session Storage (In-Memory for POC)
// ============================================================================

/**
 * In-memory session store.
 * For production, this would be backed by Durable Object storage.
 */
const sessions = new Map<string, ShellSession>()

/**
 * Generate a unique session ID
 */
function generateSessionId(): string {
  return `session-${crypto.randomUUID().slice(0, 12)}`
}

/**
 * Get or create a session
 */
function getOrCreateSession(sessionId?: string): ShellSession {
  if (sessionId && sessions.has(sessionId)) {
    return sessions.get(sessionId)!
  }

  const id = sessionId || generateSessionId()
  const session: ShellSession = {
    id,
    cwd: process.cwd?.() || '/',
    env: {},
    history: [],
    createdAt: Date.now(),
    lastCommandAt: Date.now(),
  }

  sessions.set(id, session)
  return session
}

/**
 * Get an existing session
 */
function getSession(sessionId: string): ShellSession | null {
  return sessions.get(sessionId) || null
}

/**
 * Delete a session
 */
function deleteSession(sessionId: string): boolean {
  return sessions.delete(sessionId)
}

// ============================================================================
// Command Execution with Session Context
// ============================================================================

/**
 * Execute a command in a session context.
 * Handles cd commands specially to update session cwd.
 */
async function executeInSession(
  session: ShellSession,
  command: string,
  options: { timeout?: number; confirm?: boolean } = {}
): Promise<BashResult & { duration: number }> {
  const startTime = Date.now()

  // Check if this is a cd command - needs special handling
  const cdMatch = command.match(/^\s*cd\s+(.+)$/m)
  const isCdCommand = !!cdMatch

  // For cd commands, we need to resolve the path and update session state
  if (isCdCommand) {
    const targetPath = cdMatch![1].trim().replace(/["']/g, '')
    const resolvedPath = resolvePath(session.cwd, targetPath)

    // Verify the directory exists using a real command
    const testResult = await handleBash({
      input: `test -d "${resolvedPath}" && echo "exists"`,
      confirm: options.confirm,
    })

    const duration = Date.now() - startTime

    if (testResult.stdout.trim() === 'exists') {
      // Directory exists, update session cwd
      session.cwd = resolvedPath
      session.lastCommandAt = Date.now()
      session.history.push({
        command,
        exitCode: 0,
        timestamp: Date.now(),
        duration,
      })

      return {
        ...testResult,
        stdout: '',
        stderr: '',
        exitCode: 0,
        duration,
      }
    } else {
      // Directory doesn't exist
      session.history.push({
        command,
        exitCode: 1,
        timestamp: Date.now(),
        duration,
      })

      return {
        ...testResult,
        stdout: '',
        stderr: `cd: no such file or directory: ${targetPath}`,
        exitCode: 1,
        duration,
      }
    }
  }

  // Check for export commands to track env var changes
  const exportMatch = command.match(/^\s*export\s+([A-Za-z_][A-Za-z0-9_]*)=(.*)$/m)
  if (exportMatch) {
    const [, name, value] = exportMatch
    session.env[name] = value.replace(/^["']|["']$/g, '') // Strip quotes
  }

  // Check for unset commands
  const unsetMatch = command.match(/^\s*unset\s+([A-Za-z_][A-Za-z0-9_]*)$/m)
  if (unsetMatch) {
    delete session.env[unsetMatch[1]]
  }

  // Execute the command with session context
  // Wrap the command to run in the session's cwd
  const wrappedCommand = `cd "${session.cwd}" && ${command}`

  const result = await handleBash({
    input: wrappedCommand,
    confirm: options.confirm,
  })

  const duration = Date.now() - startTime

  // Record in history
  session.lastCommandAt = Date.now()
  session.history.push({
    command,
    exitCode: result.exitCode,
    timestamp: Date.now(),
    duration,
  })

  // Keep history bounded (last 100 commands)
  if (session.history.length > 100) {
    session.history = session.history.slice(-100)
  }

  return {
    ...result,
    duration,
  }
}

/**
 * Resolve a path relative to a base directory
 */
function resolvePath(base: string, target: string): string {
  // Handle home directory expansion
  if (target.startsWith('~')) {
    const home = process.env?.HOME || '/home'
    target = home + target.slice(1)
  }

  // Handle absolute paths
  if (target.startsWith('/')) {
    return normalizePath(target)
  }

  // Handle relative paths
  const parts = base.split('/').filter(Boolean)

  for (const part of target.split('/')) {
    if (part === '..') {
      parts.pop()
    } else if (part !== '.' && part !== '') {
      parts.push(part)
    }
  }

  return '/' + parts.join('/')
}

/**
 * Normalize a path (resolve . and ..)
 */
function normalizePath(path: string): string {
  const parts: string[] = []

  for (const part of path.split('/')) {
    if (part === '..') {
      parts.pop()
    } else if (part !== '.' && part !== '') {
      parts.push(part)
    }
  }

  return '/' + parts.join('/')
}

// ============================================================================
// MCP Tool Handlers
// ============================================================================

/**
 * Execute a command in a persistent shell session
 */
export async function executeCommand(input: ExecuteCommandInput): Promise<ExecuteCommandOutput> {
  const session = getOrCreateSession(input.sessionId)

  const result = await executeInSession(session, input.command, {
    timeout: input.timeout,
    confirm: input.confirm,
  })

  return {
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
    sessionId: session.id,
    cwd: session.cwd,
    duration: result.duration,
    blocked: result.blocked,
    blockReason: result.blockReason,
  }
}

/**
 * Get current session state
 */
export async function getSessionState(input: { sessionId: string }): Promise<SessionStateOutput> {
  const session = getSession(input.sessionId)

  if (!session) {
    throw new Error(`Session not found: ${input.sessionId}`)
  }

  return {
    sessionId: session.id,
    cwd: session.cwd,
    env: { ...session.env },
    history: session.history.map((h) => h.command),
    createdAt: session.createdAt,
    lastCommandAt: session.lastCommandAt,
    commandCount: session.history.length,
  }
}

/**
 * Fork a session - create a new session from an existing one
 */
export async function forkSession(input: {
  sessionId: string
  name?: string
}): Promise<{ newSessionId: string; cwd: string; env: Record<string, string> }> {
  const sourceSession = getSession(input.sessionId)

  if (!sourceSession) {
    throw new Error(`Session not found: ${input.sessionId}`)
  }

  // Create new session with copied state
  const newId = input.name || generateSessionId()
  const newSession: ShellSession = {
    id: newId,
    cwd: sourceSession.cwd,
    env: { ...sourceSession.env },
    history: [], // Start fresh history for fork
    createdAt: Date.now(),
    lastCommandAt: Date.now(),
  }

  sessions.set(newId, newSession)

  return {
    newSessionId: newId,
    cwd: newSession.cwd,
    env: newSession.env,
  }
}

/**
 * List all active sessions
 */
export async function listSessions(): Promise<
  Array<{ sessionId: string; cwd: string; commandCount: number; lastCommandAt: number }>
> {
  return Array.from(sessions.values()).map((session) => ({
    sessionId: session.id,
    cwd: session.cwd,
    commandCount: session.history.length,
    lastCommandAt: session.lastCommandAt,
  }))
}

/**
 * Close and delete a session
 */
export async function closeSession(input: { sessionId: string }): Promise<{ closed: boolean }> {
  return { closed: deleteSession(input.sessionId) }
}

// ============================================================================
// MCP Tool Definitions
// ============================================================================

/**
 * MCP tool definitions for stateful shell
 */
export const mcpTools = {
  execute_command: {
    name: 'execute_command',
    description: `Execute a command in a persistent shell session.

Session state (cwd, env, history) persists across calls.
- cd in one call affects pwd in the next
- export sets env vars that persist
- Use sessionId to reconnect to an existing session

Example flow:
1. execute_command({ command: "cd /tmp" }) -> { sessionId: "abc123", cwd: "/tmp" }
2. execute_command({ command: "pwd", sessionId: "abc123" }) -> stdout: "/tmp"`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        command: {
          type: 'string' as const,
          description: 'The bash command to execute',
        },
        sessionId: {
          type: 'string' as const,
          description: 'Session ID for reconnection. Creates new session if not provided.',
        },
        timeout: {
          type: 'number' as const,
          description: 'Timeout in milliseconds (default: 30000)',
        },
        confirm: {
          type: 'boolean' as const,
          description: 'Confirm dangerous operations',
        },
      },
      required: ['command'] as const,
    },
    handler: executeCommand,
  },

  get_session_state: {
    name: 'get_session_state',
    description: `Get the current state of a shell session.

Returns:
- cwd: Current working directory
- env: Environment variables set in this session
- history: List of commands executed
- commandCount: Total commands executed
- timestamps for session creation and last command`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        sessionId: {
          type: 'string' as const,
          description: 'The session ID to query',
        },
      },
      required: ['sessionId'] as const,
    },
    handler: getSessionState,
  },

  fork_session: {
    name: 'fork_session',
    description: `Create a new session forked from an existing one.

The new session inherits:
- Current working directory
- Environment variables

The new session starts with:
- Fresh command history
- New session ID (or custom name if provided)`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        sessionId: {
          type: 'string' as const,
          description: 'The session ID to fork from',
        },
        name: {
          type: 'string' as const,
          description: 'Optional custom name for the new session',
        },
      },
      required: ['sessionId'] as const,
    },
    handler: forkSession,
  },

  list_sessions: {
    name: 'list_sessions',
    description: 'List all active shell sessions',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
    handler: listSessions,
  },

  close_session: {
    name: 'close_session',
    description: 'Close and delete a shell session',
    inputSchema: {
      type: 'object' as const,
      properties: {
        sessionId: {
          type: 'string' as const,
          description: 'The session ID to close',
        },
      },
      required: ['sessionId'] as const,
    },
    handler: closeSession,
  },
}

// ============================================================================
// Session Management Utilities
// ============================================================================

/**
 * Clear all sessions (for testing)
 */
export function clearAllSessions(): void {
  sessions.clear()
}

/**
 * Get session count (for testing/monitoring)
 */
export function getSessionCount(): number {
  return sessions.size
}

/**
 * Export session store for testing
 */
export function _getSessionStore(): Map<string, ShellSession> {
  return sessions
}
