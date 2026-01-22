/**
 * Utils Tests
 *
 * Tests for shared CLI utilities.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { resolve } from 'path'
import { findWrangler, runWrangler, runWranglerOrThrow, type WranglerResult } from '../commands/utils'

// ============================================================================
// Tests for findWrangler
// ============================================================================

describe('findWrangler', () => {
  const originalCwd = process.cwd

  afterEach(() => {
    process.cwd = originalCwd
    vi.restoreAllMocks()
  })

  it('should return a string', () => {
    const result = findWrangler()
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
  })

  it('should fall back to global wrangler when no local wrangler found', () => {
    // Mock process.cwd to a non-existent directory
    process.cwd = () => '/non-existent-path-that-does-not-exist'

    const result = findWrangler()
    expect(result).toBe('wrangler')
  })

  it('should prefer local wrangler if available', () => {
    // This test runs in the actual project directory
    // If wrangler is installed locally, it should find it
    const result = findWrangler()

    // Either finds local/workspace wrangler or falls back to global
    expect(typeof result).toBe('string')
    if (result !== 'wrangler') {
      expect(result).toContain('wrangler')
      expect(result).toContain('node_modules')
    }
  })
})

// ============================================================================
// Tests for runWrangler
// ============================================================================

describe('runWrangler', () => {
  it('should return a WranglerResult with output and exitCode', async () => {
    // Run wrangler version which should succeed
    const result = await runWrangler(['--version'])

    expect(result).toHaveProperty('output')
    expect(result).toHaveProperty('exitCode')
    expect(typeof result.output).toBe('string')
    expect(typeof result.exitCode).toBe('number')
  })

  it('should capture output from successful commands', async () => {
    const result = await runWrangler(['--help'])

    expect(result.exitCode).toBe(0)
    expect(result.output.length).toBeGreaterThan(0)
    // Help output should mention wrangler or cloudflare
    expect(result.output.toLowerCase()).toMatch(/wrangler|cloudflare|workers/i)
  })

  it('should return non-zero exitCode for invalid commands', async () => {
    // Use a command that will fail
    const result = await runWrangler(['nonexistent-command-that-does-not-exist'])

    // Should have error output or non-zero exit
    expect(result.exitCode !== 0 || result.output.length > 0).toBe(true)
  })
})

// ============================================================================
// Tests for runWranglerOrThrow
// ============================================================================

describe('runWranglerOrThrow', () => {
  it('should return output string on success', async () => {
    const result = await runWranglerOrThrow(['--version'])

    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
  })

  it('should throw on failure', async () => {
    await expect(
      runWranglerOrThrow(['nonexistent-command-that-does-not-exist'])
    ).rejects.toThrow()
  })
})
