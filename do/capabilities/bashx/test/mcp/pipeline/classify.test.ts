/**
 * classifyAndGenerate Pipeline Stage Tests (RED phase)
 *
 * Tests for the first pipeline stage that classifies input as command or intent
 * and generates commands from natural language if needed.
 *
 * These tests document the expected behavior of an independently callable
 * pipeline stage. They are expected to FAIL initially because the module
 * `src/mcp/pipeline/classify.ts` does not exist yet.
 *
 * @module test/mcp/pipeline/classify.test.ts
 */

import { describe, it, expect } from 'vitest'
import { classifyAndGenerate } from '../../../src/mcp/pipeline/classify.js'
import type { ClassifyInput, ClassifyResult } from '../../../src/mcp/pipeline/classify.js'

describe('classifyAndGenerate stage', () => {
  describe('command classification', () => {
    it('should classify bash command', async () => {
      const result = await classifyAndGenerate({ input: 'ls -la' })
      expect(result.type).toBe('command')
      expect(result.command).toBe('ls -la')
      expect(result.wasGenerated).toBe(false)
    })

    it('should preserve original input for commands', async () => {
      const result = await classifyAndGenerate({ input: 'git status' })
      expect(result.originalInput).toBe('git status')
      expect(result.command).toBe('git status')
    })

    it('should classify complex pipeline as command', async () => {
      const result = await classifyAndGenerate({ input: 'cat file.txt | grep pattern | sort -u' })
      expect(result.type).toBe('command')
      expect(result.wasGenerated).toBe(false)
    })

    it('should classify command with redirects', async () => {
      const result = await classifyAndGenerate({ input: 'echo hello > output.txt' })
      expect(result.type).toBe('command')
      expect(result.wasGenerated).toBe(false)
    })

    it('should classify command with environment variables', async () => {
      const result = await classifyAndGenerate({ input: 'NODE_ENV=production npm start' })
      expect(result.type).toBe('command')
      expect(result.wasGenerated).toBe(false)
    })
  })

  describe('intent classification', () => {
    it('should classify natural language intent', async () => {
      const result = await classifyAndGenerate({ input: 'list all files' })
      expect(result.type).toBe('intent')
    })

    it('should classify question as intent', async () => {
      const result = await classifyAndGenerate({ input: 'what files are in this directory?' })
      expect(result.type).toBe('intent')
    })

    it('should classify descriptive request as intent', async () => {
      const result = await classifyAndGenerate({ input: 'find all TypeScript files larger than 1MB' })
      expect(result.type).toBe('intent')
    })

    it('should classify imperative request as intent', async () => {
      const result = await classifyAndGenerate({ input: 'count lines of code in src folder' })
      expect(result.type).toBe('intent')
    })
  })

  describe('stage independence', () => {
    it('should be callable without other pipeline stages', async () => {
      // This test verifies the stage is independently importable and callable
      const result = await classifyAndGenerate({ input: 'pwd' })
      expect(result).toBeDefined()
      expect(result).toHaveProperty('type')
      expect(result).toHaveProperty('command')
      expect(result).toHaveProperty('originalInput')
      expect(result).toHaveProperty('wasGenerated')
    })

    it('should have correct type exports', () => {
      // Verify types are exported properly
      const input: ClassifyInput = { input: 'ls' }
      expect(input).toBeDefined()
    })

    it('should return consistent result structure', async () => {
      const commands = ['ls', 'pwd', 'date']
      for (const cmd of commands) {
        const result = await classifyAndGenerate({ input: cmd })
        expect(result).toMatchObject({
          type: expect.stringMatching(/^(command|intent)$/),
          command: expect.any(String),
          originalInput: cmd,
          wasGenerated: expect.any(Boolean),
        })
      }
    })
  })

  describe('edge cases', () => {
    it('should handle empty input', async () => {
      const result = await classifyAndGenerate({ input: '' })
      expect(result.type).toBe('command')
      expect(result.command).toBe('')
    })

    it('should handle whitespace-only input', async () => {
      const result = await classifyAndGenerate({ input: '   ' })
      expect(result.type).toBe('command')
      expect(result.command).toBe('')
    })

    it('should handle comments-only input', async () => {
      const result = await classifyAndGenerate({ input: '# this is a comment' })
      expect(result.type).toBe('command')
    })
  })
})
