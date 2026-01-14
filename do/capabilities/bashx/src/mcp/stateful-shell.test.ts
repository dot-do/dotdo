/**
 * MCP Stateful Shell Tests
 *
 * Tests for the stateful shell MCP server implementation.
 * Demonstrates "SSH for AI agents" - persistent sessions across MCP calls.
 *
 * @packageDocumentation
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'

import {
  executeCommand,
  getSessionState,
  forkSession,
  listSessions,
  closeSession,
  clearAllSessions,
  getSessionCount,
  mcpTools,
} from './stateful-shell.js'

// ============================================================================
// Test Setup
// ============================================================================

describe('MCP Stateful Shell', () => {
  beforeEach(() => {
    // Clear all sessions before each test
    clearAllSessions()
  })

  afterEach(() => {
    // Ensure cleanup
    clearAllSessions()
  })

  // ==========================================================================
  // Core Functionality: Session Persistence
  // ==========================================================================

  describe('Session Persistence', () => {
    it('creates a new session when sessionId is not provided', async () => {
      const result = await executeCommand({ command: 'echo hello' })

      expect(result.sessionId).toBeDefined()
      expect(result.sessionId).toMatch(/^session-/)
      expect(getSessionCount()).toBe(1)
    })

    it('reuses existing session when sessionId is provided', async () => {
      // First command creates session
      const result1 = await executeCommand({ command: 'echo first' })

      // Second command uses same session
      const result2 = await executeCommand({
        command: 'echo second',
        sessionId: result1.sessionId,
      })

      expect(result2.sessionId).toBe(result1.sessionId)
      expect(getSessionCount()).toBe(1)
    })

    it('creates multiple independent sessions', async () => {
      const result1 = await executeCommand({ command: 'echo one' })
      const result2 = await executeCommand({ command: 'echo two' })

      expect(result1.sessionId).not.toBe(result2.sessionId)
      expect(getSessionCount()).toBe(2)
    })
  })

  // ==========================================================================
  // Key Test: cd Persistence Across Calls
  // ==========================================================================

  describe('Working Directory Persistence', () => {
    it('cd in one call affects pwd in next call', async () => {
      // This is THE key test for stateful shell
      // cd in one request should affect pwd in next request

      // Create session with initial cd
      const result1 = await executeCommand({
        command: 'cd /tmp',
        sessionId: 'cd-test',
      })

      expect(result1.cwd).toBe('/tmp')
      expect(result1.exitCode).toBe(0)

      // pwd in same session should return /tmp
      const result2 = await executeCommand({
        command: 'pwd',
        sessionId: 'cd-test',
      })

      expect(result2.cwd).toBe('/tmp')
      expect(result2.stdout.trim()).toBe('/tmp')
    })

    it('cd to nested directories works', async () => {
      const sessionId = 'nested-cd-test'

      await executeCommand({ command: 'cd /tmp', sessionId })
      const result = await executeCommand({ command: 'cd ..', sessionId })

      expect(result.cwd).toBe('/')
    })

    it('cd to invalid directory fails gracefully', async () => {
      const result = await executeCommand({
        command: 'cd /nonexistent/path/that/does/not/exist',
        sessionId: 'invalid-cd-test',
      })

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('no such file or directory')
    })

    it('failed cd does not change working directory', async () => {
      const sessionId = 'failed-cd-test'

      // Set initial directory
      await executeCommand({ command: 'cd /tmp', sessionId })

      // Try to cd to invalid path
      await executeCommand({ command: 'cd /nonexistent', sessionId })

      // cwd should still be /tmp
      const state = await getSessionState({ sessionId })
      expect(state.cwd).toBe('/tmp')
    })

    it('cd with home expansion works', async () => {
      const result = await executeCommand({
        command: 'cd ~',
        sessionId: 'home-cd-test',
      })

      // Should resolve to home directory
      expect(result.cwd).not.toBe('~')
      expect(result.exitCode).toBe(0)
    })
  })

  // ==========================================================================
  // Environment Variable Persistence
  // ==========================================================================

  describe('Environment Variable Persistence', () => {
    it('export sets env var that persists', async () => {
      const sessionId = 'env-test'

      await executeCommand({
        command: 'export MY_VAR=hello',
        sessionId,
      })

      const state = await getSessionState({ sessionId })
      expect(state.env['MY_VAR']).toBe('hello')
    })

    it('unset removes env var', async () => {
      const sessionId = 'unset-test'

      await executeCommand({ command: 'export TO_DELETE=value', sessionId })
      await executeCommand({ command: 'unset TO_DELETE', sessionId })

      const state = await getSessionState({ sessionId })
      expect(state.env['TO_DELETE']).toBeUndefined()
    })

    it('env vars persist across commands', async () => {
      const sessionId = 'env-persist-test'

      await executeCommand({ command: 'export TEST_VAR=persistent', sessionId })
      await executeCommand({ command: 'echo $TEST_VAR', sessionId })

      const state = await getSessionState({ sessionId })
      expect(state.env['TEST_VAR']).toBe('persistent')
    })
  })

  // ==========================================================================
  // Command History
  // ==========================================================================

  describe('Command History', () => {
    it('tracks command history in session', async () => {
      const sessionId = 'history-test'

      await executeCommand({ command: 'echo one', sessionId })
      await executeCommand({ command: 'echo two', sessionId })
      await executeCommand({ command: 'echo three', sessionId })

      const state = await getSessionState({ sessionId })

      expect(state.history.length).toBe(3)
      expect(state.history).toContain('echo one')
      expect(state.history).toContain('echo two')
      expect(state.history).toContain('echo three')
    })

    it('command count is accurate', async () => {
      const sessionId = 'count-test'

      await executeCommand({ command: 'echo 1', sessionId })
      await executeCommand({ command: 'echo 2', sessionId })

      const state = await getSessionState({ sessionId })
      expect(state.commandCount).toBe(2)
    })

    it('history is bounded to prevent memory issues', async () => {
      const sessionId = 'bounded-history-test'

      // Execute more than 100 commands (the limit)
      for (let i = 0; i < 110; i++) {
        await executeCommand({ command: `echo ${i}`, sessionId })
      }

      const state = await getSessionState({ sessionId })
      expect(state.history.length).toBeLessThanOrEqual(100)
    })
  })

  // ==========================================================================
  // Session State API
  // ==========================================================================

  describe('getSessionState', () => {
    it('returns full session state', async () => {
      const sessionId = 'state-test'

      await executeCommand({ command: 'cd /tmp', sessionId })
      await executeCommand({ command: 'export FOO=bar', sessionId })
      await executeCommand({ command: 'echo test', sessionId })

      const state = await getSessionState({ sessionId })

      expect(state.sessionId).toBe(sessionId)
      expect(state.cwd).toBe('/tmp')
      expect(state.env['FOO']).toBe('bar')
      expect(state.history.length).toBe(3)
      expect(state.createdAt).toBeDefined()
      expect(state.lastCommandAt).toBeDefined()
    })

    it('throws error for non-existent session', async () => {
      await expect(getSessionState({ sessionId: 'nonexistent' })).rejects.toThrow(
        'Session not found'
      )
    })

    it('returns timestamps', async () => {
      const beforeCreate = Date.now()
      const result = await executeCommand({
        command: 'echo test',
        sessionId: 'timestamp-test',
      })
      const afterCreate = Date.now()

      const state = await getSessionState({ sessionId: 'timestamp-test' })

      expect(state.createdAt).toBeGreaterThanOrEqual(beforeCreate)
      expect(state.createdAt).toBeLessThanOrEqual(afterCreate)
      expect(state.lastCommandAt).toBeGreaterThanOrEqual(state.createdAt)
    })
  })

  // ==========================================================================
  // Fork Session
  // ==========================================================================

  describe('forkSession', () => {
    it('creates new session from existing one', async () => {
      const sessionId = 'parent-session'

      // Set up parent session
      await executeCommand({ command: 'cd /tmp', sessionId })
      await executeCommand({ command: 'export PARENT_VAR=parent', sessionId })

      // Fork it
      const forkResult = await forkSession({ sessionId })

      expect(forkResult.newSessionId).toBeDefined()
      expect(forkResult.newSessionId).not.toBe(sessionId)
      expect(forkResult.cwd).toBe('/tmp')
      expect(forkResult.env['PARENT_VAR']).toBe('parent')
    })

    it('forked session inherits cwd', async () => {
      await executeCommand({ command: 'cd /tmp', sessionId: 'fork-parent' })
      const fork = await forkSession({ sessionId: 'fork-parent' })

      const state = await getSessionState({ sessionId: fork.newSessionId })
      expect(state.cwd).toBe('/tmp')
    })

    it('forked session inherits env vars', async () => {
      await executeCommand({
        command: 'export INHERITED=yes',
        sessionId: 'env-fork-parent',
      })
      const fork = await forkSession({ sessionId: 'env-fork-parent' })

      const state = await getSessionState({ sessionId: fork.newSessionId })
      expect(state.env['INHERITED']).toBe('yes')
    })

    it('forked session starts with empty history', async () => {
      await executeCommand({ command: 'echo 1', sessionId: 'history-fork-parent' })
      await executeCommand({ command: 'echo 2', sessionId: 'history-fork-parent' })
      const fork = await forkSession({ sessionId: 'history-fork-parent' })

      const state = await getSessionState({ sessionId: fork.newSessionId })
      expect(state.history.length).toBe(0)
    })

    it('forked session is independent from parent', async () => {
      await executeCommand({ command: 'cd /tmp', sessionId: 'independent-parent' })
      const fork = await forkSession({ sessionId: 'independent-parent' })

      // Modify forked session
      await executeCommand({ command: 'cd /', sessionId: fork.newSessionId })

      // Parent should be unchanged
      const parentState = await getSessionState({ sessionId: 'independent-parent' })
      expect(parentState.cwd).toBe('/tmp')

      // Fork should be modified
      const forkState = await getSessionState({ sessionId: fork.newSessionId })
      expect(forkState.cwd).toBe('/')
    })

    it('fork with custom name uses that name', async () => {
      await executeCommand({ command: 'echo test', sessionId: 'name-parent' })
      const fork = await forkSession({
        sessionId: 'name-parent',
        name: 'my-custom-fork',
      })

      expect(fork.newSessionId).toBe('my-custom-fork')
    })

    it('throws error when forking non-existent session', async () => {
      await expect(forkSession({ sessionId: 'nonexistent' })).rejects.toThrow(
        'Session not found'
      )
    })
  })

  // ==========================================================================
  // List and Close Sessions
  // ==========================================================================

  describe('listSessions', () => {
    it('lists all active sessions', async () => {
      await executeCommand({ command: 'echo 1', sessionId: 'list-test-1' })
      await executeCommand({ command: 'echo 2', sessionId: 'list-test-2' })
      await executeCommand({ command: 'echo 3', sessionId: 'list-test-3' })

      const sessions = await listSessions()

      expect(sessions.length).toBe(3)
      expect(sessions.map((s) => s.sessionId)).toContain('list-test-1')
      expect(sessions.map((s) => s.sessionId)).toContain('list-test-2')
      expect(sessions.map((s) => s.sessionId)).toContain('list-test-3')
    })

    it('returns empty array when no sessions exist', async () => {
      const sessions = await listSessions()
      expect(sessions).toEqual([])
    })

    it('includes session metadata', async () => {
      await executeCommand({ command: 'cd /tmp', sessionId: 'meta-test' })
      await executeCommand({ command: 'echo 1', sessionId: 'meta-test' })

      const sessions = await listSessions()
      const session = sessions.find((s) => s.sessionId === 'meta-test')

      expect(session?.cwd).toBe('/tmp')
      expect(session?.commandCount).toBe(2)
      expect(session?.lastCommandAt).toBeDefined()
    })
  })

  describe('closeSession', () => {
    it('closes and removes session', async () => {
      await executeCommand({ command: 'echo test', sessionId: 'close-test' })
      expect(getSessionCount()).toBe(1)

      const result = await closeSession({ sessionId: 'close-test' })

      expect(result.closed).toBe(true)
      expect(getSessionCount()).toBe(0)
    })

    it('returns false for non-existent session', async () => {
      const result = await closeSession({ sessionId: 'nonexistent' })
      expect(result.closed).toBe(false)
    })

    it('closed session cannot be accessed', async () => {
      await executeCommand({ command: 'echo test', sessionId: 'closed-access-test' })
      await closeSession({ sessionId: 'closed-access-test' })

      await expect(
        getSessionState({ sessionId: 'closed-access-test' })
      ).rejects.toThrow('Session not found')
    })
  })

  // ==========================================================================
  // MCP Tool Definitions
  // ==========================================================================

  describe('MCP Tool Definitions', () => {
    it('execute_command has correct schema', () => {
      const tool = mcpTools.execute_command

      expect(tool.name).toBe('execute_command')
      expect(tool.description).toBeDefined()
      expect(tool.inputSchema.type).toBe('object')
      expect(tool.inputSchema.properties.command).toBeDefined()
      expect(tool.inputSchema.properties.sessionId).toBeDefined()
      expect(tool.inputSchema.required).toContain('command')
    })

    it('get_session_state has correct schema', () => {
      const tool = mcpTools.get_session_state

      expect(tool.name).toBe('get_session_state')
      expect(tool.inputSchema.properties.sessionId).toBeDefined()
      expect(tool.inputSchema.required).toContain('sessionId')
    })

    it('fork_session has correct schema', () => {
      const tool = mcpTools.fork_session

      expect(tool.name).toBe('fork_session')
      expect(tool.inputSchema.properties.sessionId).toBeDefined()
      expect(tool.inputSchema.properties.name).toBeDefined()
      expect(tool.inputSchema.required).toContain('sessionId')
    })

    it('list_sessions has correct schema', () => {
      const tool = mcpTools.list_sessions

      expect(tool.name).toBe('list_sessions')
      expect(tool.inputSchema.type).toBe('object')
    })

    it('close_session has correct schema', () => {
      const tool = mcpTools.close_session

      expect(tool.name).toBe('close_session')
      expect(tool.inputSchema.properties.sessionId).toBeDefined()
      expect(tool.inputSchema.required).toContain('sessionId')
    })

    it('all tools have handlers', () => {
      expect(typeof mcpTools.execute_command.handler).toBe('function')
      expect(typeof mcpTools.get_session_state.handler).toBe('function')
      expect(typeof mcpTools.fork_session.handler).toBe('function')
      expect(typeof mcpTools.list_sessions.handler).toBe('function')
      expect(typeof mcpTools.close_session.handler).toBe('function')
    })
  })

  // ==========================================================================
  // Command Execution
  // ==========================================================================

  describe('Command Execution', () => {
    it('returns stdout', async () => {
      const result = await executeCommand({
        command: 'echo hello world',
        sessionId: 'stdout-test',
      })

      expect(result.stdout).toContain('hello world')
    })

    it('returns stderr', async () => {
      const result = await executeCommand({
        command: 'ls /nonexistent-path-12345',
        sessionId: 'stderr-test',
      })

      expect(result.stderr.length).toBeGreaterThan(0)
    })

    it('returns exit code', async () => {
      const success = await executeCommand({
        command: 'true',
        sessionId: 'exit-test-1',
      })
      expect(success.exitCode).toBe(0)

      const failure = await executeCommand({
        command: 'false',
        sessionId: 'exit-test-2',
      })
      expect(failure.exitCode).not.toBe(0)
    })

    it('returns duration', async () => {
      const result = await executeCommand({
        command: 'echo fast',
        sessionId: 'duration-test',
      })

      expect(result.duration).toBeGreaterThanOrEqual(0)
    })

    it('executes commands in session cwd', async () => {
      await executeCommand({ command: 'cd /tmp', sessionId: 'cwd-exec-test' })

      const result = await executeCommand({
        command: 'pwd',
        sessionId: 'cwd-exec-test',
      })

      expect(result.stdout.trim()).toBe('/tmp')
    })
  })

  // ==========================================================================
  // Integration Tests
  // ==========================================================================

  describe('Integration: Multi-Step Workflow', () => {
    it('simulates a development workflow', async () => {
      const sessionId = 'dev-workflow'

      // Navigate to project
      await executeCommand({ command: 'cd /tmp', sessionId })

      // Set environment
      await executeCommand({ command: 'export NODE_ENV=development', sessionId })

      // Check state
      const state = await getSessionState({ sessionId })
      expect(state.cwd).toBe('/tmp')
      expect(state.env['NODE_ENV']).toBe('development')

      // Fork for testing
      const testFork = await forkSession({ sessionId, name: 'test-env' })
      await executeCommand({
        command: 'export NODE_ENV=test',
        sessionId: testFork.newSessionId,
      })

      // Original session unchanged
      const originalState = await getSessionState({ sessionId })
      expect(originalState.env['NODE_ENV']).toBe('development')

      // Fork has test env
      const forkState = await getSessionState({ sessionId: testFork.newSessionId })
      expect(forkState.env['NODE_ENV']).toBe('test')
    })

    it('simulates session reconnection', async () => {
      const sessionId = 'reconnect-test'

      // Initial session setup
      await executeCommand({ command: 'cd /tmp', sessionId })
      await executeCommand({ command: 'export MY_STATE=persisted', sessionId })

      // "Disconnect" - just don't use the session for a while
      // In a real scenario, this would be across MCP requests

      // "Reconnect" - use the same session ID
      const result = await executeCommand({
        command: 'pwd',
        sessionId,
      })

      expect(result.stdout.trim()).toBe('/tmp')

      const state = await getSessionState({ sessionId })
      expect(state.env['MY_STATE']).toBe('persisted')
    })
  })

  // ==========================================================================
  // Edge Cases
  // ==========================================================================

  describe('Edge Cases', () => {
    it('handles empty command', async () => {
      const result = await executeCommand({
        command: '',
        sessionId: 'empty-cmd-test',
      })

      // Empty command should succeed but do nothing
      expect(result.exitCode).toBe(0)
    })

    it('handles whitespace-only command', async () => {
      const result = await executeCommand({
        command: '   ',
        sessionId: 'whitespace-cmd-test',
      })

      expect(result.exitCode).toBe(0)
    })

    it('handles multi-line commands', async () => {
      const result = await executeCommand({
        command: 'echo line1\necho line2',
        sessionId: 'multiline-test',
      })

      expect(result.stdout).toContain('line1')
      expect(result.stdout).toContain('line2')
    })

    it('handles commands with special characters', async () => {
      const result = await executeCommand({
        command: 'echo "hello$world"',
        sessionId: 'special-char-test',
      })

      expect(result.exitCode).toBe(0)
    })
  })
})
