/**
 * Language-Based Execution Routing Tests (RED Phase)
 *
 * Tests for integrating language detection into the execution path.
 * These tests verify that execute() detects the language of input
 * and routes to the appropriate executor.
 *
 * Current State: These tests are expected to FAIL (RED phase).
 * - The `language` field doesn't exist on ExecuteResult
 * - The `executor` field doesn't exist on ExecuteResult
 * - Language detection is not wired into the execution pipeline
 *
 * The GREEN phase (bashx-rl0j) will implement the integration.
 */

import { describe, it, expect } from 'vitest'
import { execute } from '../../src/execute.js'

describe('language-based execution routing', () => {
  it('should detect Python and route to Python executor', async () => {
    const pythonCode = '#!/usr/bin/env python\nprint("hello")'
    const result = await execute(pythonCode)

    expect(result.language).toBe('python')
    expect(result.executor).toBe('python')
  })

  it('should detect bash and route to bash executor', async () => {
    const bashCode = 'ls -la'
    const result = await execute(bashCode)

    expect(result.language).toBe('bash')
    expect(result.executor).toBe('bash')
  })

  it('should fall back to bash for ambiguous input', async () => {
    const result = await execute('echo hello')
    expect(result.language).toBe('bash')
  })

  it('should detect Python from syntax patterns', async () => {
    const pythonCode = 'print("hello world")'
    const result = await execute(pythonCode)

    expect(result.language).toBe('python')
  })

  it('should detect Node.js from interpreter command', async () => {
    const nodeCode = 'node script.js'
    const result = await execute(nodeCode)

    expect(result.language).toBe('node')
    expect(result.executor).toBe('node')
  })

  it('should include language in result even for failed commands', async () => {
    // This command will fail but should still have language detected
    const result = await execute('python -c "import nonexistent_module_xyz"')

    expect(result.language).toBe('python')
    expect(result.executor).toBe('python')
  })

  it('should detect Ruby from shebang', async () => {
    const rubyCode = '#!/usr/bin/env ruby\nputs "hello"'
    const result = await execute(rubyCode)

    expect(result.language).toBe('ruby')
    expect(result.executor).toBe('ruby')
  })

  it('should detect Go from interpreter command', async () => {
    const goCode = 'go run main.go'
    const result = await execute(goCode)

    expect(result.language).toBe('go')
    expect(result.executor).toBe('go')
  })

  it('should preserve language detection for dry-run mode', async () => {
    const pythonCode = 'python3 script.py'
    const result = await execute(pythonCode, { dryRun: true })

    expect(result.language).toBe('python')
    expect(result.dryRun).toBe(true)
  })

  it('should preserve language detection for blocked commands', async () => {
    // A command that would be blocked but should still have language detected
    const result = await execute('rm -rf /', { confirm: false })

    // Language should still be detected even for blocked commands
    expect(result.language).toBe('bash')
    expect(result.blocked).toBe(true)
  })
})
