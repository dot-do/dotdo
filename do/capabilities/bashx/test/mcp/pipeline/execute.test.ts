/**
 * executeOrBlock Pipeline Stage Tests (RED phase)
 *
 * Tests for the execution pipeline stage that runs commands or returns
 * blocked status based on gate decisions.
 *
 * These tests document the expected behavior of an independently callable
 * pipeline stage. They are expected to FAIL initially because the module
 * `src/mcp/pipeline/execute.ts` does not exist yet.
 *
 * @module test/mcp/pipeline/execute.test.ts
 */

import { describe, it, expect } from 'vitest'
import { executeOrBlock } from '../../../src/mcp/pipeline/execute.js'
import type { ExecuteInput, ExecuteResult } from '../../../src/mcp/pipeline/execute.js'
import type { GateResult } from '../../../src/mcp/pipeline/gate.js'

describe('executeOrBlock stage', () => {
  describe('execution when not blocked', () => {
    it('should execute command when not blocked', async () => {
      const gateResult: GateResult = {
        blocked: false,
        requiresConfirm: false,
      }

      const result = await executeOrBlock({
        command: 'echo hello',
        gateResult,
      })

      expect(result.executed).toBe(true)
      expect(result.stdout).toContain('hello')
      expect(result.exitCode).toBe(0)
    })

    it('should capture stdout', async () => {
      const gateResult: GateResult = {
        blocked: false,
        requiresConfirm: false,
      }

      const result = await executeOrBlock({
        command: 'pwd',
        gateResult,
      })

      expect(result.executed).toBe(true)
      expect(result.stdout).toBeDefined()
      expect(result.stdout?.length).toBeGreaterThan(0)
    })

    it('should capture stderr', async () => {
      const gateResult: GateResult = {
        blocked: false,
        requiresConfirm: false,
      }

      const result = await executeOrBlock({
        command: 'ls /nonexistent 2>&1 || true',
        gateResult,
      })

      expect(result.executed).toBe(true)
      // Either stdout or stderr should contain error message
      const output = (result.stdout || '') + (result.stderr || '')
      expect(output.length).toBeGreaterThan(0)
    })

    it('should capture exit code', async () => {
      const gateResult: GateResult = {
        blocked: false,
        requiresConfirm: false,
      }

      const result = await executeOrBlock({
        command: 'false',
        gateResult,
      })

      expect(result.executed).toBe(true)
      expect(result.exitCode).toBe(1)
    })
  })

  describe('blocking when gate blocks', () => {
    it('should not execute when blocked', async () => {
      const gateResult: GateResult = {
        blocked: true,
        requiresConfirm: true,
        blockReason: 'Critical operation blocked',
      }

      const result = await executeOrBlock({
        command: 'rm -rf /',
        gateResult,
      })

      expect(result.executed).toBe(false)
      expect(result.blocked).toBe(true)
    })

    it('should return block reason', async () => {
      const gateResult: GateResult = {
        blocked: true,
        requiresConfirm: true,
        blockReason: 'Dangerous: recursive delete of root',
      }

      const result = await executeOrBlock({
        command: 'rm -rf /',
        gateResult,
      })

      expect(result.blockReason).toBe('Dangerous: recursive delete of root')
    })

    it('should not have execution output when blocked', async () => {
      const gateResult: GateResult = {
        blocked: true,
        requiresConfirm: true,
        blockReason: 'Blocked',
      }

      const result = await executeOrBlock({
        command: 'echo should not run',
        gateResult,
      })

      expect(result.executed).toBe(false)
      expect(result.stdout).toBeUndefined()
      expect(result.stderr).toBeUndefined()
      expect(result.exitCode).toBeUndefined()
    })
  })

  describe('execution options', () => {
    it('should respect timeout option', async () => {
      const gateResult: GateResult = {
        blocked: false,
        requiresConfirm: false,
      }

      const result = await executeOrBlock({
        command: 'sleep 10',
        gateResult,
        options: {
          timeout: 100,
        },
      })

      expect(result.executed).toBe(true)
      // Should have timed out
      expect(result.exitCode).not.toBe(0)
    })

    it('should respect cwd option', async () => {
      const gateResult: GateResult = {
        blocked: false,
        requiresConfirm: false,
      }

      const result = await executeOrBlock({
        command: 'pwd',
        gateResult,
        options: {
          cwd: '/tmp',
        },
      })

      expect(result.executed).toBe(true)
      expect(result.stdout).toContain('/tmp')
    })

    it('should respect env option', async () => {
      const gateResult: GateResult = {
        blocked: false,
        requiresConfirm: false,
      }

      const result = await executeOrBlock({
        command: 'echo $TEST_VAR',
        gateResult,
        options: {
          env: { TEST_VAR: 'test_value' },
        },
      })

      expect(result.executed).toBe(true)
      expect(result.stdout).toContain('test_value')
    })
  })

  describe('stage independence', () => {
    it('should be callable without other pipeline stages', async () => {
      const gateResult: GateResult = {
        blocked: false,
        requiresConfirm: false,
      }

      const result = await executeOrBlock({
        command: 'date',
        gateResult,
      })

      expect(result).toBeDefined()
      expect(result).toHaveProperty('executed')
    })

    it('should have correct type exports', () => {
      const input: ExecuteInput = {
        command: 'ls',
        gateResult: { blocked: false, requiresConfirm: false },
      }
      expect(input).toBeDefined()
    })

    it('should return consistent result structure for execution', async () => {
      const gateResult: GateResult = {
        blocked: false,
        requiresConfirm: false,
      }

      const result = await executeOrBlock({
        command: 'echo test',
        gateResult,
      })

      expect(result).toMatchObject({
        executed: true,
        stdout: expect.any(String),
        exitCode: expect.any(Number),
      })
    })

    it('should return consistent result structure for blocked', async () => {
      const gateResult: GateResult = {
        blocked: true,
        requiresConfirm: true,
        blockReason: 'Test block',
      }

      const result = await executeOrBlock({
        command: 'echo test',
        gateResult,
      })

      expect(result).toMatchObject({
        executed: false,
        blocked: true,
        blockReason: expect.any(String),
      })
    })
  })

  describe('edge cases', () => {
    it('should handle empty command', async () => {
      const gateResult: GateResult = {
        blocked: false,
        requiresConfirm: false,
      }

      const result = await executeOrBlock({
        command: '',
        gateResult,
      })

      expect(result.executed).toBe(true)
      expect(result.exitCode).toBe(0)
    })

    it('should handle command with special characters', async () => {
      const gateResult: GateResult = {
        blocked: false,
        requiresConfirm: false,
      }

      const result = await executeOrBlock({
        command: 'echo "hello world" | cat',
        gateResult,
      })

      expect(result.executed).toBe(true)
      expect(result.stdout).toContain('hello world')
    })

    it('should handle multiline output', async () => {
      const gateResult: GateResult = {
        blocked: false,
        requiresConfirm: false,
      }

      const result = await executeOrBlock({
        command: 'printf "line1\\nline2\\nline3"',
        gateResult,
      })

      expect(result.executed).toBe(true)
      expect(result.stdout?.split('\n').length).toBeGreaterThanOrEqual(3)
    })
  })
})
